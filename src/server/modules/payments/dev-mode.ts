import { getEnv } from "@/server/config/env";

/**
 * True when the in-memory DEV payment gateway should stand in for the real
 * one. Never true in production. Outside production it is true by default
 * (local development / the frozen B8 test-suite) unless
 * PAYMENT_PROVIDER_MODE=real is set, which routes through the real
 * Razorpay/PhonePe adapters (sandbox credentials or a mock server).
 */
export function isPaymentDevMode(): boolean {
  const env = getEnv();
  if (env.NODE_ENV === "production") return false;
  return env.PAYMENT_PROVIDER_MODE !== "real";
}
