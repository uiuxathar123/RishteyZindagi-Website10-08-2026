/**
 * PCP: admin OTP provider selection — EMAIL | FAST2SMS_SMS, exactly one active.
 *
 * Invariants
 *  - "Exactly one active" is structural: `otp_configs` is a one-row table with a
 *    single `active_method` column; the switch is one atomic UPDATE.
 *  - Switching only changes which channel NEW codes are sent through. It never
 *    touches the `otps` table, so a code that was already issued stays valid
 *    until it expires / is consumed, and verification does not depend on the
 *    provider (it is keyed by identifier + purpose).
 *  - In production an unconfigured provider cannot be activated (409) — an admin
 *    cannot lock every user out of sign-in by picking a provider with no
 *    credentials. Outside production the switch is allowed so local/dev flows
 *    (dev OTP mode) keep working.
 *  - Credentials live in the environment only. This API reports which variable
 *    NAMES are missing, never a value.
 *  - API value `FAST2SMS_SMS` is stored as the existing enum value `SMS`
 *    (no enum change, so existing rows and the frozen schema are untouched).
 *  - WHATSAPP remains in the legacy enum but is not a selectable provider here
 *    and is rejected by the legacy endpoint in production.
 */
import { getEnv } from "@/server/config/env";
import { ConflictError } from "@/server/lib/errors";
import { isMailerConfigured, missingMailerSettings } from "@/server/lib/mailer";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as otpConfigRepo from "./otp-config.repository";
import { SmsOtpProvider } from "./providers/sms.provider";
import type { OtpMethod } from "./otp.types";

const PERMISSION = "platform.settings.manage";

export type OtpProviderKey = "EMAIL" | "FAST2SMS_SMS";
export const OTP_PROVIDER_KEYS: readonly OtpProviderKey[] = ["EMAIL", "FAST2SMS_SMS"];

const METHOD_BY_KEY: Record<OtpProviderKey, OtpMethod> = { EMAIL: "EMAIL", FAST2SMS_SMS: "SMS" };
const LABEL: Record<OtpProviderKey, string> = { EMAIL: "E-mail (SMTP)", FAST2SMS_SMS: "SMS (Fast2SMS)" };

export interface OtpProviderStatus {
  key: OtpProviderKey;
  label: string;
  method: OtpMethod;
  active: boolean;
  /** All required environment variables are present. Says nothing about whether the vendor accepts them. */
  configured: boolean;
  /** Names (never values) of missing environment variables. */
  missing: string[];
}

export interface OtpProviderView {
  activeProvider: OtpProviderKey | null;
  /** Set when the stored method is not one of the selectable providers (legacy WHATSAPP). */
  unsupportedActiveMethod: string | null;
  enabled: boolean;
  devMode: boolean;
  providers: OtpProviderStatus[];
  updatedAt: string;
}

function status(key: OtpProviderKey, activeMethod: OtpMethod): OtpProviderStatus {
  if (key === "EMAIL") {
    const missing = missingMailerSettings();
    return { key, label: LABEL[key], method: "EMAIL", active: activeMethod === "EMAIL", configured: isMailerConfigured(), missing };
  }
  const sms = new SmsOtpProvider();
  return { key, label: LABEL[key], method: "SMS", active: activeMethod === "SMS", configured: sms.isConfigured(), missing: sms.missingSettings() };
}

async function buildView(): Promise<OtpProviderView> {
  const cfg = await otpConfigRepo.get();
  const activeKey = OTP_PROVIDER_KEYS.find((k) => METHOD_BY_KEY[k] === cfg.activeMethod) ?? null;
  return {
    activeProvider: activeKey,
    unsupportedActiveMethod: activeKey ? null : cfg.activeMethod,
    enabled: cfg.enabled,
    devMode: cfg.devMode,
    providers: OTP_PROVIDER_KEYS.map((k) => status(k, cfg.activeMethod)),
    updatedAt: cfg.updatedAt.toISOString(),
  };
}

export async function getOtpProviderView(ctx: AuthContext): Promise<OtpProviderView> {
  await requirePermission(ctx, PERMISSION);
  return buildView();
}

export async function setActiveOtpProvider(
  ctx: AuthContext,
  key: OtpProviderKey,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<OtpProviderView> {
  await requirePermission(ctx, PERMISSION);
  const before = await otpConfigRepo.get();
  const target = status(key, before.activeMethod);

  if (getEnv().NODE_ENV === "production" && !target.configured) {
    throw new ConflictError(`${LABEL[key]} is not configured (missing: ${target.missing.join(", ")}). Configure it before activating it.`, {
      missing: target.missing,
    });
  }

  const updated = await otpConfigRepo.update({ activeMethod: METHOD_BY_KEY[key], updatedByAdminId: ctx.subject.id });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "otp_config.provider_switched",
    entityType: "otp_config",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { from: before.activeMethod === "SMS" ? "FAST2SMS_SMS" : before.activeMethod, to: key, targetConfigured: target.configured },
  });
  void updated;
  return buildView();
}
