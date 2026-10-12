/**
 * PCP: admin payment configuration — Razorpay | PhonePe, exactly one active.
 *
 * Invariants:
 *  - Only RAZORPAY and PHONEPE are selectable here, in every environment.
 *  - Switching = the existing transactional `setActiveGateway` (deactivate all,
 *    activate one), so two active gateways cannot exist even under concurrent
 *    switches (the last committed transaction wins; the result is always one).
 *  - Credentials are write-only: saved encrypted (AES-256-GCM), never returned,
 *    never audited (the audit row lists field NAMES only).
 *  - Permission: the existing `platform.settings.manage` (same as OTP config and
 *    the legacy gateway admin API) — no new RBAC.
 */
import { getEnv } from "@/server/config/env";
import { ConflictError, NotFoundError } from "@/server/lib/errors";
import { encrypt } from "@/server/lib/crypto";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./gateways.repository";
import type { GatewayConfig, PaymentGatewayRow } from "./gateways.repository";
import { getPaymentGatewayProvider } from "./providers/factory";
import { loadPhonePeCredentials, loadRazorpayCredentials, PHONEPE_GATEWAY_NAME, RAZORPAY_GATEWAY_NAME } from "./credentials";

const PERMISSION = "platform.settings.manage";

export type GatewayKey = "RAZORPAY" | "PHONEPE";
export const GATEWAY_KEYS: readonly GatewayKey[] = ["RAZORPAY", "PHONEPE"];

const NAME_BY_KEY: Record<GatewayKey, string> = { RAZORPAY: RAZORPAY_GATEWAY_NAME, PHONEPE: PHONEPE_GATEWAY_NAME };
const LABEL_BY_KEY: Record<GatewayKey, string> = { RAZORPAY: "Razorpay", PHONEPE: "PhonePe" };

export interface GatewayConfigView {
  key: GatewayKey;
  label: string;
  id: string;
  isActive: boolean;
  status: "ACTIVE" | "INACTIVE";
  /** Credentials needed to attempt a real call exist (admin-saved or environment). Says nothing about whether the vendor accepts them — use test-connection. */
  configured: boolean;
  credentialSource: "admin" | "environment" | "none";
  /** The mode an admin saved as a label (may be null for environment-supplied keys). Display only. */
  mode: "test" | "live" | null;
  /** The mode the KEY itself declares (rzp_test_ / rzp_live_ prefix); null when no key exists or for PhonePe. This is what the guard uses. */
  detectedMode: "test" | "live" | "unknown" | null;
  /** Why the stored/configured credentials are refused in THIS environment (e.g. a test key in production); null when usable. Never contains key material. */
  problem: string | null;
  /** Which write-only fields currently have a stored value (never the values). */
  storedFields: string[];
  webhook: { configured: boolean; url: string };
}

export interface PaymentConfigView {
  activeGateway: GatewayKey | null;
  gateways: GatewayConfigView[];
  /** A legacy gateway (Cashfree/PayU/Paytm) is flagged active in the database. Checkout would use it — an admin should switch to a supported one. */
  unsupportedActiveGateway: string | null;
  /** True when the dev gateway stands in for the real one (never in production). */
  devGatewayInUse: boolean;
}

function webhookUrl(key: GatewayKey): string {
  return `${getEnv().APP_URL.replace(/\/+$/, "")}/api/v1/webhooks/${key.toLowerCase()}`;
}

async function viewFor(key: GatewayKey, row: PaymentGatewayRow): Promise<GatewayConfigView> {
  const cfg = (row.config ?? {}) as GatewayConfig;
  const stored = Object.keys(cfg.encrypted ?? {}).sort();
  let configured = false;
  let webhookConfigured = false;
  let envOnly = false;
  let detectedMode: GatewayConfigView["detectedMode"] = null;
  let problem: string | null = null;
  try {
    if (key === "RAZORPAY") {
      const c = await loadRazorpayCredentials();
      configured = Boolean(c) && !c?.problem;
      detectedMode = c?.mode ?? null;
      problem = c?.problem ?? null;
      webhookConfigured = Boolean(c?.webhookSecret);
      envOnly = configured && !(cfg.encrypted?.apiKey && cfg.encrypted?.apiSecret);
    } else {
      const c = await loadPhonePeCredentials();
      configured = Boolean(c);
      webhookConfigured = Boolean(c?.webhookUsername && c?.webhookPassword);
      envOnly = configured && !(cfg.encrypted?.apiKey && cfg.encrypted?.apiSecret && cfg.encrypted?.clientVersion);
    }
  } catch {
    // Undecryptable stored credentials ⇒ not usable.
    configured = false;
  }
  return {
    key,
    label: LABEL_BY_KEY[key],
    id: row.id,
    isActive: row.isActive,
    status: row.isActive ? "ACTIVE" : "INACTIVE",
    configured,
    credentialSource: !configured && !problem ? "none" : envOnly ? "environment" : "admin",
    mode: cfg.mode ?? null,
    detectedMode,
    problem,
    storedFields: stored,
    webhook: { configured: webhookConfigured, url: webhookUrl(key) },
  };
}

export async function getPaymentConfig(ctx: AuthContext): Promise<PaymentConfigView> {
  await requirePermission(ctx, PERMISSION);
  return buildView();
}

async function buildView(): Promise<PaymentConfigView> {
  const rows = await repo.listAll();
  const gateways: GatewayConfigView[] = [];
  for (const key of GATEWAY_KEYS) {
    const row = rows.find((r) => r.name === NAME_BY_KEY[key]);
    if (row) gateways.push(await viewFor(key, row));
  }
  const active = rows.find((r) => r.isActive);
  const activeKey = GATEWAY_KEYS.find((k) => NAME_BY_KEY[k] === active?.name) ?? null;
  const env = getEnv();
  return {
    activeGateway: activeKey,
    gateways,
    unsupportedActiveGateway: active && !activeKey ? active.name : null,
    devGatewayInUse: env.NODE_ENV !== "production" && env.PAYMENT_PROVIDER_MODE !== "real",
  };
}

async function requireRow(key: GatewayKey): Promise<PaymentGatewayRow> {
  const row = await repo.findByName(NAME_BY_KEY[key]);
  if (!row) throw new NotFoundError("Payment gateway not found.");
  return row;
}

export async function setActiveGateway(
  ctx: AuthContext,
  key: GatewayKey,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<PaymentConfigView> {
  await requirePermission(ctx, PERMISSION);
  const target = await requireRow(key);
  const before = (await repo.listAll()).find((r) => r.isActive)?.name ?? null;

  const gatewayView = await viewFor(key, target);
  // B-provider: a key this environment refuses (test key in production, live key outside it) can never be activated.
  if (gatewayView.problem) throw new ConflictError(gatewayView.problem);
  if (getEnv().NODE_ENV === "production" && !gatewayView.configured) {
    throw new ConflictError(`${LABEL_BY_KEY[key]} has no credentials configured. Save its credentials before activating it.`);
  }

  await repo.setActiveGateway(target.id);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "payment_gateway.switched",
    entityType: "payment_gateway",
    entityId: target.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { from: before, to: target.name },
  });
  return buildView();
}

export interface SaveCredentialsInput {
  mode?: "test" | "live";
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
  clientVersion?: string;
  webhookUsername?: string;
  webhookPassword?: string;
}

export async function saveCredentials(
  ctx: AuthContext,
  key: GatewayKey,
  input: SaveCredentialsInput,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<PaymentConfigView> {
  await requirePermission(ctx, PERMISSION);
  const row = await requireRow(key);
  const current = (row.config ?? {}) as GatewayConfig;
  const next: GatewayConfig = { ...current, encrypted: { ...(current.encrypted ?? {}) } };
  const encKey = getEnv().PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  const changed: string[] = [];

  const set = (field: keyof NonNullable<GatewayConfig["encrypted"]>, value: string | undefined, label: string) => {
    if (value === undefined) return;
    // encrypt() throws ServiceUnavailable when the encryption key is unset — a secret is never stored in plaintext.
    next.encrypted![field] = encrypt(value, encKey);
    changed.push(label);
  };

  if (key === "RAZORPAY") {
    set("apiKey", input.keyId, "keyId");
    set("apiSecret", input.keySecret, "keySecret");
    set("webhookSecret", input.webhookSecret, "webhookSecret");
  } else {
    set("apiKey", input.clientId, "clientId");
    set("apiSecret", input.clientSecret, "clientSecret");
    set("clientVersion", input.clientVersion, "clientVersion");
    set("webhookUsername", input.webhookUsername, "webhookUsername");
    set("webhookPassword", input.webhookPassword, "webhookPassword");
  }
  if (input.mode) {
    next.mode = input.mode;
    changed.push("mode");
  }

  await repo.updateConfig(row.id, next);
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "payment_gateway.credentials_updated",
    entityType: "payment_gateway",
    entityId: row.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    // Field NAMES only — never a value, never a hash of a value.
    metadata: { gateway: row.name, fieldsChanged: changed },
  });
  return buildView();
}

export async function testConnection(ctx: AuthContext, key: GatewayKey): Promise<{ ok: boolean; message: string }> {
  await requirePermission(ctx, PERMISSION);
  const row = await requireRow(key);
  const result = await getPaymentGatewayProvider(row.name, false).testConnection();
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "payment_gateway.connection_tested",
    entityType: "payment_gateway",
    entityId: row.id,
    metadata: { gateway: row.name, ok: result.ok },
  });
  return result;
}
