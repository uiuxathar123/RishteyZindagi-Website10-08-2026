/**
 * Centralized, validated environment configuration. Every module reads
 * config through this file — nothing reaches into `process.env` directly
 * elsewhere in `src/server/`, so a missing/malformed variable fails fast
 * at startup with a clear message instead of surfacing as a confusing
 * runtime error three layers down.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().default("http://localhost:3000"),
  API_URL: z.string().default("http://localhost:3000/api/v1"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  SEED_DEV_SUPER_ADMIN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SEED_DEV_SUPER_ADMIN_EMAIL: z.string().optional(),
  SEED_DEV_SUPER_ADMIN_PASSWORD: z.string().optional(),

  // B2: OTP provider credentials. All optional at the env-schema level —
  // whether a given channel is actually usable is decided at request time
  // by each provider's own isConfigured() check (empty string counts as
  // "not set"), never by throwing at startup, since an environment is
  // allowed to have zero, one, or all three configured depending on which
  // channel the Super Admin has activated via /admin/otp/config.
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  SMS_PROVIDER: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  WHATSAPP_PROVIDER: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),

  // B7: push-notification provider credentials — same optional-at-schema-
  // level, decided-at-request-time-by-isConfigured() posture as the three
  // OTP channel vars above (see notifications/providers/push.provider.ts).
  PUSH_PROVIDER: z.string().optional(),
  PUSH_API_KEY: z.string().optional(),

  // B3: profile-photo storage provider. Optional — unset (or "local")
  // means the local-disk dev adapter (see
  // src/server/modules/storage/factory.ts); any other value must name a
  // real, implemented provider or every upload fails loudly rather than
  // silently falling back.
  STORAGE_PROVIDER: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),

  // B8: AES-256-GCM key used to encrypt payment-gateway credentials at
  // rest in `payment_gateways.config` (see src/server/lib/crypto.ts).
  // Optional at the schema level (same posture as every other credential
  // in this file) — gateway-config.service.ts throws ServiceUnavailableError
  // rather than ever storing a real credential in plaintext if this is
  // unset. Expected as a 64-char hex string (32 raw bytes) when set.
  PAYMENT_CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),

  // B8: per-gateway credential presence checks, mirroring OTP's own
  // per-channel EMAIL_PROVIDER/EMAIL_API_KEY pattern exactly — optional
  // at the schema level, decided at request time by each gateway
  // provider's own isConfigured() (see
  // src/server/modules/payments/providers/*.provider.ts). No real vendor
  // SDK is wired in for any of them in this sandbox (see each provider's
  // own file comment) — these vars only ever let isConfigured() report
  // honestly, never enable a real send.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  CASHFREE_APP_ID: z.string().optional(),
  CASHFREE_SECRET_KEY: z.string().optional(),
  PAYU_MERCHANT_KEY: z.string().optional(),
  PAYU_SALT: z.string().optional(),
  PHONEPE_MERCHANT_ID: z.string().optional(),
  PHONEPE_SALT_KEY: z.string().optional(),
  PAYTM_MERCHANT_ID: z.string().optional(),
  PAYTM_MERCHANT_KEY: z.string().optional(),

  // B8: the GST rate applied to INR invoices' tax line (see
  // invoice-pdf.ts / tax-config.ts) — a placeholder, configurable value,
  // never presented as researched real-world tax law (see BACKEND.md's
  // B8 section). Non-INR invoices always use 0% (documented judgment
  // call, also in BACKEND.md). Defaults to 18 (a commonly-cited Indian
  // GST slab, chosen only as a clearly-labeled round placeholder, not
  // asserted as legally authoritative for this business).
  GST_RATE_PERCENT: z.coerce.number().min(0).max(100).default(18),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parses and validates process.env once, memoizing the result. Throws a
 * single, readable error listing every problem if anything is missing or
 * malformed — never logs the values themselves. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
