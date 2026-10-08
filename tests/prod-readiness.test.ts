/**
 * B16: unit tests for the new, pure `checkProductionReadiness()`
 * (src/server/config/prod-readiness.ts). Pure function over an already-
 * validated `Env` object — no env stubbing, no database, no network call
 * needed; every case below constructs its own `Env` value directly, which
 * is also why this file needs no `beforeEach`/`vi.stubEnv` isolation
 * dance unlike the three *-production-guard.test.ts files.
 */
import { describe, it, expect } from "vitest";
import { checkProductionReadiness } from "@/server/config/prod-readiness";
import type { Env } from "@/server/config/env";

/** A minimal, otherwise-production-safe baseline Env — each test overrides
 * only the field(s) it's exercising. */
function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@real-host:5432/rishteyzindagi_prod",
    APP_URL: "https://app.rishteyzindagi.com",
    API_URL: "https://app.rishteyzindagi.com/api/v1",
    AUTH_SECRET: "a-real-long-randomly-generated-secret-value-not-a-placeholder",
    SESSION_TTL_HOURS: 720,
    SEED_DEV_SUPER_ADMIN: false,
    SEED_DEV_SUPER_ADMIN_EMAIL: undefined,
    SEED_DEV_SUPER_ADMIN_PASSWORD: undefined,
    EMAIL_PROVIDER: "sendgrid",
    EMAIL_API_KEY: "real-email-key",
    SMS_PROVIDER: undefined,
    SMS_API_KEY: undefined,
    WHATSAPP_PROVIDER: undefined,
    WHATSAPP_API_KEY: undefined,
    PUSH_PROVIDER: undefined,
    PUSH_API_KEY: undefined,
    STORAGE_PROVIDER: "s3",
    STORAGE_BUCKET: "rishteyzindagi-prod-photos",
    PAYMENT_CREDENTIALS_ENCRYPTION_KEY: "a".repeat(64),
    RAZORPAY_KEY_ID: "real-key-id",
    RAZORPAY_KEY_SECRET: "real-key-secret",
    CASHFREE_APP_ID: undefined,
    CASHFREE_SECRET_KEY: undefined,
    PAYU_MERCHANT_KEY: undefined,
    PAYU_SALT: undefined,
    PHONEPE_MERCHANT_ID: undefined,
    PHONEPE_SALT_KEY: undefined,
    PAYTM_MERCHANT_ID: undefined,
    PAYTM_MERCHANT_KEY: undefined,
    GST_RATE_PERCENT: 18,
    ...overrides,
  };
}

describe("B16 checkProductionReadiness (pure, no DB/env access)", () => {
  it("[prodready-clean] a fully-configured production-shaped Env with ALLOWED_ORIGINS set reports ok:true, zero errors, zero warnings", () => {
    const result = checkProductionReadiness(baseEnv(), "https://app.rishteyzindagi.com");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("[prodready-nodeenv] NODE_ENV !== production is a blocking error", () => {
    const result = checkProductionReadiness(baseEnv({ NODE_ENV: "development" }), "https://app.rishteyzindagi.com");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /NODE_ENV/.test(e))).toBe(true);
  });

  it("[prodready-placeholder-secret] a known placeholder AUTH_SECRET is a blocking error", () => {
    const result = checkProductionReadiness(
      baseEnv({ AUTH_SECRET: "replace-with-a-long-random-value" }),
      "https://app.rishteyzindagi.com"
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /AUTH_SECRET/.test(e))).toBe(true);
  });

  it("[prodready-seed-admin] SEED_DEV_SUPER_ADMIN=true is a blocking error", () => {
    const result = checkProductionReadiness(baseEnv({ SEED_DEV_SUPER_ADMIN: true }), "https://app.rishteyzindagi.com");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /SEED_DEV_SUPER_ADMIN/.test(e))).toBe(true);
  });

  it("[prodready-bad-enc-key] a malformed (non-64-hex) PAYMENT_CREDENTIALS_ENCRYPTION_KEY is a blocking error", () => {
    const result = checkProductionReadiness(
      baseEnv({ PAYMENT_CREDENTIALS_ENCRYPTION_KEY: "too-short" }),
      "https://app.rishteyzindagi.com"
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /PAYMENT_CREDENTIALS_ENCRYPTION_KEY/.test(e))).toBe(true);
  });

  it("[prodready-warnings-only] missing optional config (ALLOWED_ORIGINS, encryption key, OTP channel, gateway, local storage) produces warnings, not errors, and ok stays true", () => {
    const result = checkProductionReadiness(
      baseEnv({
        PAYMENT_CREDENTIALS_ENCRYPTION_KEY: undefined,
        EMAIL_API_KEY: undefined,
        STORAGE_PROVIDER: undefined,
        RAZORPAY_KEY_ID: undefined,
        RAZORPAY_KEY_SECRET: undefined,
      }),
      undefined
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(5);
    expect(result.warnings.some((w) => /ALLOWED_ORIGINS/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /PAYMENT_CREDENTIALS_ENCRYPTION_KEY/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /OTP delivery channel/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /STORAGE_PROVIDER/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /payment gateway/.test(w))).toBe(true);
  });

  it("[prodready-partial-gateway-creds] a gateway with only one of its two required credential vars set still counts as not-configured (warns, matches each provider's own isConfigured())", () => {
    const result = checkProductionReadiness(
      baseEnv({ RAZORPAY_KEY_ID: "only-id-set", RAZORPAY_KEY_SECRET: undefined }),
      "https://app.rishteyzindagi.com"
    );
    expect(result.warnings.some((w) => /payment gateway/.test(w))).toBe(true);
  });

  it("[prodready-never-leaks-secret-values] no error or warning message ever contains the actual secret/key values passed in", () => {
    const secretAuth = "super-secret-auth-value-xyz123";
    const secretKey = "b".repeat(64);
    const result = checkProductionReadiness(
      baseEnv({ AUTH_SECRET: secretAuth, PAYMENT_CREDENTIALS_ENCRYPTION_KEY: secretKey }),
      "https://app.rishteyzindagi.com"
    );
    const allMessages = [...result.errors, ...result.warnings].join(" ");
    expect(allMessages).not.toContain(secretAuth);
    expect(allMessages).not.toContain(secretKey);
  });
});
