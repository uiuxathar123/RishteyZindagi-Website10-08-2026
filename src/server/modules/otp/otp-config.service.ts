/**
 * Admin OTP configuration service (B2). This owns the single most
 * emphasized business rule in the B2 brief: exactly one active OTP
 * delivery method at any time. That invariant is structural, not
 * something this service has to police — `otp_configs` is a DB-level
 * singleton (one row, `CHECK (id = 1)`) with a single `active_method`
 * column, so there is no representable state with two active methods.
 * This service's job is narrower: gate access behind the existing
 * `platform.settings.manage` permission (already SUPER_ADMIN-only per the
 * B1 seed — see BACKEND.md — so a STAFF_ADMIN cannot reach this without
 * being explicitly granted the permission, satisfying the brief's "Staff
 * Admin must not automatically receive Super Admin privileges" rule with
 * zero new authorization code), validate a couple of things a DB
 * constraint can't (dev mode can never be enabled in production), and
 * audit-log every change.
 */
import { getEnv } from "@/server/config/env";
import { ValidationError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as otpConfigRepo from "./otp-config.repository";
import type { OtpConfigRow, OtpConfigUpdate } from "./otp-config.repository";

const PERMISSION = "platform.settings.manage";

export interface PublicOtpConfig {
  activeMethod: string;
  enabled: boolean;
  otpLength: number;
  otpExpirySeconds: number;
  maxVerifyAttempts: number;
  resendCooldownSeconds: number;
  maxResendAttempts: number;
  resendWindowSeconds: number;
  devMode: boolean;
  /** Whether each channel has *something* configured — never the actual
   * jsonb payload. Those columns are documented as non-secret dials, but
   * there's no reason an API response should ever round-trip them, so this
   * keeps the response shape safe even if a secret were ever mistakenly
   * placed there. */
  providers: { sms: boolean; whatsapp: boolean; email: boolean };
  updatedAt: string;
  updatedByAdminId: string | null;
}

function toPublic(row: OtpConfigRow): PublicOtpConfig {
  return {
    activeMethod: row.activeMethod,
    enabled: row.enabled,
    otpLength: row.otpLength,
    otpExpirySeconds: row.otpExpirySeconds,
    maxVerifyAttempts: row.maxVerifyAttempts,
    resendCooldownSeconds: row.resendCooldownSeconds,
    maxResendAttempts: row.maxResendAttempts,
    resendWindowSeconds: row.resendWindowSeconds,
    devMode: row.devMode,
    providers: {
      sms: row.smsConfig != null,
      whatsapp: row.whatsappConfig != null,
      email: row.emailConfig != null,
    },
    updatedAt: row.updatedAt.toISOString(),
    updatedByAdminId: row.updatedByAdminId ?? null,
  };
}

export async function getConfig(ctx: AuthContext): Promise<PublicOtpConfig> {
  await requirePermission(ctx, PERMISSION);
  return toPublic(await otpConfigRepo.get());
}

export type UpdateConfigInput = OtpConfigUpdate;

export async function updateConfig(
  ctx: AuthContext,
  input: UpdateConfigInput,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<PublicOtpConfig> {
  await requirePermission(ctx, PERMISSION);

  if (input.devMode === true && getEnv().NODE_ENV === "production") {
    throw new ValidationError("Dev OTP mode cannot be enabled in production.");
  }

  const before = await otpConfigRepo.get();
  const updated = await otpConfigRepo.update({ ...input, updatedByAdminId: ctx.subject.id });

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "otp_config.update",
    entityType: "otp_config",
    // otp_configs is a singleton keyed by a plain integer (always 1), not a
    // uuid — audit_logs.entity_id is uuid-typed, so there's no valid value
    // to put there; entityType alone is unambiguous for a singleton.
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    // Never the provider jsonb columns — same non-secret-only shape the
    // public response uses, so an audit log entry can't leak a credential
    // even if one were ever mistakenly stored there.
    metadata: { before: nonSecretSummary(before), after: nonSecretSummary(updated) },
  });

  return toPublic(updated);
}

function nonSecretSummary(row: OtpConfigRow) {
  return {
    activeMethod: row.activeMethod,
    enabled: row.enabled,
    otpLength: row.otpLength,
    otpExpirySeconds: row.otpExpirySeconds,
    maxVerifyAttempts: row.maxVerifyAttempts,
    resendCooldownSeconds: row.resendCooldownSeconds,
    maxResendAttempts: row.maxResendAttempts,
    resendWindowSeconds: row.resendWindowSeconds,
    devMode: row.devMode,
  };
}
