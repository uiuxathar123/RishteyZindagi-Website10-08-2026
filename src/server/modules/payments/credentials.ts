/**
 * PCP: server-side resolution of payment-gateway credentials.
 *
 * Order of precedence: credentials an admin saved through the admin API
 * (stored AES-256-GCM encrypted in `payment_gateways.config`, decrypted here,
 * in memory, only for the duration of a call) → environment variables (the
 * path for deployments that prefer a secrets manager). Plaintext secrets are
 * never returned by any API, logged, audited, or placed in an error message.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { decrypt } from "@/server/lib/crypto";
import * as gatewaysRepo from "./gateways.repository";
import type { GatewayConfig } from "./gateways.repository";

export const RAZORPAY_GATEWAY_NAME = "Razorpay";
export const PHONEPE_GATEWAY_NAME = "PhonePe Payment Gateway";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  /** Detected from the key id prefix (rzp_test_ / rzp_live_) — never from a label an admin typed. */
  mode: "test" | "live" | "unknown";
  /**
   * Set when this key must NOT be used in this environment (see `razorpayKeyModeProblem`). Callers that would
   * create an order, confirm, resume or refund a payment refuse to proceed while it is set; the admin status
   * shows it. Never contains key material.
   */
  problem?: string;
}

export interface PhonePeCredentials {
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  environment: "sandbox" | "production";
  webhookUsername?: string;
  webhookPassword?: string;
}

/**
 * Key-mode guard (fail closed). This deployment pairs Razorpay TEST keys with non-production environments and
 * LIVE keys with production, and never the other way round:
 *  - production + anything other than an `rzp_live_` key → refused (a test key must not run a production checkout);
 *  - any other environment + an `rzp_live_` key → refused (local/staging runs must never be able to move real money).
 * Unprefixed key ids are tolerated outside production only (protocol mocks and legacy fixtures use them).
 */
export function razorpayKeyModeProblem(mode: "test" | "live" | "unknown", nodeEnv: string): string | undefined {
  if (nodeEnv === "production") {
    if (mode === "live") return undefined;
    return mode === "test"
      ? "A Razorpay TEST key is configured but this server runs in production. Replace it with the account's LIVE key before taking real payments."
      : "The configured Razorpay key id is not a recognised live key (rzp_live_…). Production only accepts live keys.";
  }
  if (mode === "live") {
    return "A Razorpay LIVE key is configured but this is not a production environment. Use a TEST key (rzp_test_…): non-production environments are never allowed to move real money.";
  }
  return undefined;
}

async function storedConfig(name: string): Promise<GatewayConfig> {
  const row = await gatewaysRepo.findByName(name);
  return ((row?.config ?? {}) as GatewayConfig) ?? {};
}

function decryptField(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  try {
    return decrypt(value, getEnv().PAYMENT_CREDENTIALS_ENCRYPTION_KEY);
  } catch {
    throw new ServiceUnavailableError(`Stored ${label} credentials could not be decrypted. Check PAYMENT_CREDENTIALS_ENCRYPTION_KEY and re-save the credentials.`);
  }
}

export async function loadRazorpayCredentials(): Promise<RazorpayCredentials | null> {
  const env = getEnv();
  const cfg = await storedConfig(RAZORPAY_GATEWAY_NAME);
  const enc = cfg.encrypted ?? {};
  const keyId = decryptField(enc.apiKey, "Razorpay") ?? env.RAZORPAY_KEY_ID;
  const keySecret = decryptField(enc.apiSecret, "Razorpay") ?? env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const webhookSecret = decryptField(enc.webhookSecret, "Razorpay") ?? env.RAZORPAY_WEBHOOK_SECRET;
  const mode = keyId.startsWith("rzp_live_") ? "live" : keyId.startsWith("rzp_test_") ? "test" : "unknown";
  return { keyId, keySecret, webhookSecret: webhookSecret || undefined, mode, problem: razorpayKeyModeProblem(mode, env.NODE_ENV) };
}

export async function loadPhonePeCredentials(): Promise<PhonePeCredentials | null> {
  const env = getEnv();
  const cfg = await storedConfig(PHONEPE_GATEWAY_NAME);
  const enc = cfg.encrypted ?? {};
  const clientId = decryptField(enc.apiKey, "PhonePe") ?? env.PHONEPE_CLIENT_ID;
  const clientSecret = decryptField(enc.apiSecret, "PhonePe") ?? env.PHONEPE_CLIENT_SECRET;
  const clientVersion = decryptField(enc.clientVersion, "PhonePe") ?? env.PHONEPE_CLIENT_VERSION;
  if (!clientId || !clientSecret || !clientVersion) return null;
  // Environment: the admin's saved mode wins ("live" → production), else PHONEPE_ENV, else sandbox (fail-safe: never charge real money by accident).
  const environment: "sandbox" | "production" =
    cfg.mode === "live" ? "production" : cfg.mode === "test" ? "sandbox" : env.PHONEPE_ENV === "production" ? "production" : "sandbox";
  return {
    clientId,
    clientSecret,
    clientVersion,
    environment,
    webhookUsername: decryptField(enc.webhookUsername, "PhonePe") ?? env.PHONEPE_WEBHOOK_USERNAME,
    webhookPassword: decryptField(enc.webhookPassword, "PhonePe") ?? env.PHONEPE_WEBHOOK_PASSWORD,
  };
}
