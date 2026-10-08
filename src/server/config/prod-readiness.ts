/**
 * B16: production-readiness env audit — a NEW, additive, read-only check
 * layered on top of the existing `getEnv()` (see ./env.ts), never replacing
 * or altering it. `getEnv()`'s own fail-fast only enforces that
 * `DATABASE_URL`/`AUTH_SECRET` are present and every field is well-formed
 * (B1 scope, unchanged) — it has no opinion on whether a given value is
 * *safe for a real production deployment* (e.g. a dev-only flag left on,
 * or a secret still holding its own placeholder string). This module adds
 * exactly that second, narrower check, as a pure function over an already-
 * validated `Env` — it reads no process.env itself, opens no connection,
 * and has no side effect, so it is trivially unit-testable and cannot
 * itself change any existing runtime behavior.
 *
 * Deliberately NOT wired into `getEnv()`, app startup, or any request path
 * — every dev/test run must keep behaving byte-for-byte as it did before
 * this file existed. The only caller is the new, opt-in
 * `scripts/check-prod-env.ts` CLI (`npm run check:prod-env`), which an
 * operator runs by hand before/as part of a real deployment — see
 * B16_PRODUCTION_INFRASTRUCTURE.md's deployment procedure for where this
 * fits (a new, additive pre-flight step, not a replacement for any
 * existing one).
 *
 * Severity split:
 *  - `errors`   — something that would make a real production deployment
 *                 unsafe or actively broken (e.g. NODE_ENV not set to
 *                 "production", the dev-seed-superadmin flag left on).
 *  - `warnings` — something genuinely optional that a real launch will
 *                 eventually need configured, but whose absence is already
 *                 handled honestly elsewhere in the codebase (every OTP/
 *                 payment/storage provider's own isConfigured()-at-
 *                 request-time pattern — see env.ts's own comments) rather
 *                 than a reason to block a deploy by itself.
 *
 * Never logs or returns a secret's actual value — only ever a variable
 * NAME and a human-readable reason, mirroring logger.ts's redaction
 * discipline.
 */
import type { Env } from "./env";

export interface ProdReadinessResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** A handful of obviously-placeholder values that have shown up in this
 * project's own `.env.example` / dev defaults over time — present only so
 * an operator who copy-pasted `.env.example` without editing it gets a
 * clear error instead of a silently-insecure production deployment. Never
 * exhaustive, never a substitute for real secret-strength validation. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-long-random-value",
  "test-secret",
  "test-secret-key-for-vitest-do-not-use-in-prod",
]);

export function checkProductionReadiness(env: Env, allowedOriginsRaw?: string): ProdReadinessResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (env.NODE_ENV !== "production") {
    errors.push(`NODE_ENV is "${env.NODE_ENV}", not "production" — every dev/mock provider double-guard in this codebase keys off this value.`);
  }

  if (KNOWN_PLACEHOLDER_SECRETS.has(env.AUTH_SECRET)) {
    errors.push("AUTH_SECRET is still set to a known placeholder/dev value — generate a real random secret before production use.");
  }

  if (env.SEED_DEV_SUPER_ADMIN) {
    errors.push("SEED_DEV_SUPER_ADMIN is true — must be false/unset outside development (see env.ts).");
  }

  if (env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY) {
    if (!/^[0-9a-f]{64}$/i.test(env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY)) {
      errors.push("PAYMENT_CREDENTIALS_ENCRYPTION_KEY is set but is not a 64-char hex string (32 bytes) — gateway-config.service.ts will reject it at use time.");
    }
  } else {
    warnings.push("PAYMENT_CREDENTIALS_ENCRYPTION_KEY is unset — no real payment-gateway credential can be saved until it is (gateway-config.service.ts throws honestly; this is not a startup failure).");
  }

  // ALLOWED_ORIGINS is deliberately NOT part of envSchema (src/middleware.ts
  // reads process.env.ALLOWED_ORIGINS directly — see that file's own
  // comment on why, Edge-runtime scoped) — passed in separately here
  // rather than added to `Env`/env.ts, which stays untouched.
  if (!allowedOriginsRaw || !allowedOriginsRaw.trim()) {
    warnings.push('ALLOWED_ORIGINS is unset — CORS currently allows every origin ("*"), the pre-B10 default. Set an explicit allowlist before a real frontend/Android origin is fixed.');
  }

  const otpConfigured = Boolean(env.EMAIL_API_KEY) || Boolean(env.SMS_API_KEY) || Boolean(env.WHATSAPP_API_KEY);
  if (!otpConfigured) {
    warnings.push("No OTP delivery channel (EMAIL_API_KEY / SMS_API_KEY / WHATSAPP_API_KEY) is configured — matches GET /api/v1/health/ready's own 'degraded' signal, not a new finding.");
  }

  const storageProvider = (env.STORAGE_PROVIDER || "local").toLowerCase();
  if (storageProvider === "local") {
    warnings.push('STORAGE_PROVIDER is unset or "local" — profile photos/invoices are written to local disk with no independent backup (see BACKUP_DR.md); fine for this sandbox, not recommended for a real multi-instance production deployment.');
  }

  const anyPaymentGatewayConfigured =
    (Boolean(env.RAZORPAY_KEY_ID) && Boolean(env.RAZORPAY_KEY_SECRET)) ||
    (Boolean(env.CASHFREE_APP_ID) && Boolean(env.CASHFREE_SECRET_KEY)) ||
    (Boolean(env.PAYU_MERCHANT_KEY) && Boolean(env.PAYU_SALT)) ||
    (Boolean(env.PHONEPE_MERCHANT_ID) && Boolean(env.PHONEPE_SALT_KEY)) ||
    (Boolean(env.PAYTM_MERCHANT_ID) && Boolean(env.PAYTM_MERCHANT_KEY));
  if (!anyPaymentGatewayConfigured) {
    warnings.push("No payment gateway has both of its credential vars set — every real gateway provider throws ServiceUnavailableError until real credentials are configured (see each provider's own file comment); checkout will not work for real money until then.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
