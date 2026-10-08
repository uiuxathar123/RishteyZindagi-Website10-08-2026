/**
 * B8: admin-facing gateway configuration — enable/disable, set the
 * single active gateway, set credentials (encrypted at rest), a "test
 * connection" endpoint, and the public read every checkout flow needs
 * (which gateway is currently active). Gated behind the EXISTING
 * `platform.settings.manage` permission — the same class of platform-
 * wide setting B2's OTP config and B5's matching weights already reuse
 * it for (see BACKEND.md's B8 section for why no new permission was
 * needed here).
 */
import { getEnv } from "@/server/config/env";
import { ConflictError, NotFoundError, ServiceUnavailableError } from "@/server/lib/errors";
import { encrypt } from "@/server/lib/crypto";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./gateways.repository";
import type { PaymentGatewayRow, GatewayConfig } from "./gateways.repository";
import { getPaymentGatewayProvider } from "./providers/factory";

const PERMISSION = "platform.settings.manage";

/** PCP: the gateways the business supports for real payments. */
export const PRODUCTION_SUPPORTED_GATEWAYS = ["Razorpay", "PhonePe Payment Gateway"];

export interface PublicGatewayView {
  id: string;
  name: string;
  isActive: boolean;
  mode: "test" | "live" | null;
  merchantIdLast4: string | null;
  /** True only when this gateway has SOME encrypted credential blob
   * stored via the admin config endpoint — never a claim that a real
   * vendor integration is wired in (see envConfigured below). */
  credentialsConfigured: boolean;
  /** True only when the real (non-dev) provider class for this gateway
   * reports isConfigured() against real environment variables — see
   * providers/*.provider.ts. This is the honest "could this gateway ever
   * actually attempt a real send" signal; it is FALSE for every gateway
   * in this sandbox today, since no real vendor SDK is wired in for any
   * of them regardless of env vars (see each provider's own comment). */
  envConfigured: boolean;
}

function toPublicView(row: PaymentGatewayRow): PublicGatewayView {
  const config = (row.config ?? {}) as GatewayConfig;
  let envConfigured = false;
  try {
    envConfigured = getPaymentGatewayProvider(row.name, false).isConfigured();
  } catch {
    envConfigured = false;
  }
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    mode: config.mode ?? null,
    merchantIdLast4: config.merchantIdLast4 ?? null,
    credentialsConfigured: Boolean(config.encrypted && Object.keys(config.encrypted).length > 0),
    envConfigured,
  };
}

export async function listGateways(ctx: AuthContext): Promise<PublicGatewayView[]> {
  await requirePermission(ctx, PERMISSION);
  const rows = await repo.listAll();
  return rows.map(toPublicView);
}

/** Read-only, no permission required — any authenticated caller (or
 * internal service call) needs to know "which gateway is active right
 * now" for checkout to work; only *changing* gateway config is an admin
 * action. Mirrors weights.service.ts's getActiveWeights's exact
 * reasoning. */
export async function getActiveGatewayRow(): Promise<PaymentGatewayRow> {
  const row = await repo.findActive();
  if (!row) {
    throw new ServiceUnavailableError("No payment gateway is currently active. An administrator must activate one before checkout can proceed.");
  }
  return row;
}

export interface UpdateGatewayInput {
  mode?: "test" | "live";
  apiKey?: string;
  apiSecret?: string;
  merchantId?: string;
  webhookSecret?: string;
}

/** Sets/updates this gateway's non-active-selection config: mode flag +
 * credentials (encrypted at rest — see crypto.ts). Never changes
 * `isActive` (see activateGateway/deactivateGateway below for that). */
export async function updateGatewayConfig(ctx: AuthContext, gatewayId: string, input: UpdateGatewayInput): Promise<PublicGatewayView> {
  await requirePermission(ctx, PERMISSION);
  const existing = await repo.findById(gatewayId);
  if (!existing) throw new NotFoundError("Payment gateway not found.");

  const currentConfig = (existing.config ?? {}) as GatewayConfig;
  const nextConfig: GatewayConfig = { ...currentConfig };
  if (input.mode) nextConfig.mode = input.mode;

  const hasCredentialInput = input.apiKey || input.apiSecret || input.merchantId || input.webhookSecret;
  if (hasCredentialInput) {
    const key = getEnv().PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    // encrypt() itself throws ServiceUnavailableError when `key` is
    // unset (see crypto.ts) — never silently stores plaintext. Caught
    // implicitly by letting it propagate: this function does no manual
    // try/catch, so the honest failure reaches the controller unchanged.
    const encrypted = { ...currentConfig.encrypted };
    if (input.apiKey) encrypted.apiKey = encrypt(input.apiKey, key);
    if (input.apiSecret) encrypted.apiSecret = encrypt(input.apiSecret, key);
    if (input.merchantId) encrypted.merchantId = encrypt(input.merchantId, key);
    if (input.webhookSecret) encrypted.webhookSecret = encrypt(input.webhookSecret, key);
    nextConfig.encrypted = encrypted;
    if (input.merchantId) nextConfig.merchantIdLast4 = input.merchantId.slice(-4);
  }

  const updated = await repo.updateConfig(gatewayId, nextConfig);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    action: "payment_gateway.config_updated",
    entityType: "payment_gateway",
    entityId: gatewayId,
    // Never the credential values themselves — only which fields changed.
    metadata: { fieldsChanged: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined) },
  });

  return toPublicView(updated);
}

/** Activates this gateway and deactivates every other one, atomically
 * (see gateways.repository.ts's setActiveGateway). "Exactly one active
 * gateway at a time" — enforced here, the one place this state can
 * change. */
export async function activateGateway(ctx: AuthContext, gatewayId: string): Promise<PublicGatewayView> {
  await requirePermission(ctx, PERMISSION);
  const existing = await repo.findById(gatewayId);
  if (!existing) throw new NotFoundError("Payment gateway not found.");
  // PCP product decision: only Razorpay and PhonePe may take real payments.
  // Enforced for the legacy endpoint in production only (the frozen B8 suite
  // exercises activation of every seeded gateway outside production); the
  // PCP admin API (payment-config.service.ts) enforces it in every environment.
  if (getEnv().NODE_ENV === "production" && !PRODUCTION_SUPPORTED_GATEWAYS.includes(existing.name)) {
    throw new ConflictError("Only Razorpay and PhonePe can be activated.");
  }
  const updated = await repo.setActiveGateway(gatewayId);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    action: "payment_gateway.activated",
    entityType: "payment_gateway",
    entityId: gatewayId,
    metadata: { name: existing.name },
  });

  return toPublicView(updated);
}

/** Disables this specific gateway. Unlike activation, this is not
 * transactional across rows — disabling the currently-active gateway
 * simply leaves zero gateways active (checkout then honestly fails with
 * ServiceUnavailableError via getActiveGatewayRow, rather than silently
 * falling back to a different gateway an admin didn't choose). */
export async function deactivateGateway(ctx: AuthContext, gatewayId: string): Promise<PublicGatewayView> {
  await requirePermission(ctx, PERMISSION);
  const existing = await repo.findById(gatewayId);
  if (!existing) throw new NotFoundError("Payment gateway not found.");
  const updated = await repo.setEnabled(gatewayId, false);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    action: "payment_gateway.deactivated",
    entityType: "payment_gateway",
    entityId: gatewayId,
    metadata: { name: existing.name },
  });

  return toPublicView(updated);
}

/**
 * "Test connection" — never fakes a successful live connection (see
 * providers/types.ts's TestConnectionResult contract). Always resolves
 * against the REAL provider class (devMode: false) regardless of
 * NODE_ENV, since this is an explicit admin action to verify real
 * credentials, not a checkout flow that should transparently fall back
 * to the dev/mock provider outside production.
 */
export async function testGatewayConnection(ctx: AuthContext, gatewayId: string): Promise<{ ok: boolean; message: string }> {
  await requirePermission(ctx, PERMISSION);
  const existing = await repo.findById(gatewayId);
  if (!existing) throw new NotFoundError("Payment gateway not found.");
  const provider = getPaymentGatewayProvider(existing.name, false);
  return provider.testConnection();
}

/** Used by tests / seed-adjacent code that needs to assert "exactly one
 * active gateway" without a full HTTP round trip through requirePermission. */
export async function assertSingleActiveGatewayInvariant(): Promise<void> {
  const rows = await repo.listAll();
  const activeCount = rows.filter((r) => r.isActive).length;
  if (activeCount > 1) {
    throw new ConflictError("Invariant violated: more than one payment gateway is active.");
  }
}
