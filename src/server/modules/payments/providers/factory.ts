/**
 * Resolves the PaymentGatewayProvider to use for a given gateway name +
 * devMode flag. This is the ONE place that decides real-vs-dev, so
 * payments.service.ts never touches DevPaymentProvider directly. Mirrors
 * src/server/modules/otp/providers/factory.ts exactly, including its
 * defense-in-depth: devMode is only ever honored when
 * NODE_ENV !== "production" (checked here AND again inside
 * DevPaymentProvider itself).
 */
import { getEnv } from "@/server/config/env";
import type { PaymentGatewayProvider } from "./types";
import { RazorpayProvider } from "./razorpay.provider";
import { CashfreeProvider } from "./cashfree.provider";
import { PayUProvider } from "./payu.provider";
import { PhonePeProvider } from "./phonepe.provider";
import { PaytmProvider } from "./paytm.provider";
import { DevPaymentProvider } from "./dev.provider";

/** Keyed by the exact `payment_gateways.name` value seeded for each row
 * (see seed.ts's PAYMENT_GATEWAYS) — the one place that name-to-provider
 * mapping is decided. */
const realProviders: Record<string, PaymentGatewayProvider> = {
  Razorpay: new RazorpayProvider(),
  "Cashfree Payments": new CashfreeProvider(),
  PayU: new PayUProvider(),
  "PhonePe Payment Gateway": new PhonePeProvider(),
  "Paytm Payment Gateway": new PaytmProvider(),
};

export function getPaymentGatewayProvider(gatewayName: string, devMode: boolean): PaymentGatewayProvider {
  const env = getEnv();
  if (devMode && env.NODE_ENV !== "production") {
    return new DevPaymentProvider();
  }
  const provider = realProviders[gatewayName];
  if (!provider) {
    // An unrecognized gateway name is a data-integrity concern (a
    // payment_gateways row exists with a name this factory doesn't know)
    // rather than a normal "not configured" case — surfaced the same way
    // by the caller (gateway-config.service.ts / payments.service.ts),
    // which always wraps this in a try/catch around the whole checkout/
    // verify flow.
    throw new Error(`No payment gateway provider is registered for "${gatewayName}".`);
  }
  return provider;
}

/** Test-only: the real-provider map, for a test that wants to assert on
 * exactly which gateway names this factory recognizes. */
export function __realPaymentProviderNamesForTests(): string[] {
  return Object.keys(realProviders);
}
