/**
 * B14 §33/§42: the "dev/mock payment gateway can never run in production"
 * guarantee — structurally identical to tests/otp-production-guard.test.ts
 * and tests/notifications-production-guard.test.ts (same isolated-from-
 * the-database rationale: providers/factory.ts and providers/dev.provider.ts
 * only ever read env config, so NODE_ENV can be safely stubbed to
 * "production" per test without disturbing the shared test-database
 * connection every other suite in this run relies on).
 *
 * This is the one guard test the B14 pre-inspection flagged as missing —
 * payments/providers/dev.provider.ts and providers/factory.ts already had
 * the exact same double-guard structure as OTP/notifications (see both
 * files' own comments — "mirrors ... exactly"), it simply had no
 * dedicated regression test proving it, unlike its two siblings. This
 * file closes that gap; it adds a NEW test file only — nothing in
 * dev.provider.ts or factory.ts needed to change.
 *
 * Two independent layers, matching factory.ts's own "defense in depth"
 * comment:
 *  1. The factory refuses to hand out DevPaymentProvider at all when
 *     NODE_ENV=production, even if devMode=true is passed in (as it
 *     would be if a payment_gateways row's dev-mode flag were ever left
 *     on by mistake).
 *  2. DevPaymentProvider's own methods (createOrder/verifyPayment/
 *     testConnection) refuse to run under NODE_ENV=production even if
 *     something bypassed the factory and constructed one directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Payment dev/mock-gateway production guard (isolated — no DB)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder");
    vi.stubEnv("AUTH_SECRET", process.env.AUTH_SECRET ?? "test-secret");
  });

  it("getPaymentGatewayProvider never returns DevPaymentProvider when NODE_ENV=production, even with devMode=true", async () => {
    const { getPaymentGatewayProvider } = await import("@/server/modules/payments/providers/factory");
    // "Razorpay" is one of the real, seeded gateway names this factory
    // recognizes (see factory.ts's realProviders map) — devMode=true
    // must still be refused under NODE_ENV=production.
    const provider = getPaymentGatewayProvider("Razorpay", true);
    expect(provider.constructor.name).not.toBe("DevPaymentProvider");
  });

  it("DevPaymentProvider.createOrder refuses to run under NODE_ENV=production even if constructed directly", async () => {
    const { DevPaymentProvider } = await import("@/server/modules/payments/providers/dev.provider");
    const provider = new DevPaymentProvider();
    await expect(
      provider.createOrder({ amountInSmallestUnit: 100000, currency: "INR", receiptRef: "test-ref" })
    ).rejects.toThrow(/production/);
  });

  it("DevPaymentProvider.verifyPayment refuses to run under NODE_ENV=production even if constructed directly", async () => {
    const { DevPaymentProvider } = await import("@/server/modules/payments/providers/dev.provider");
    const provider = new DevPaymentProvider();
    await expect(provider.verifyPayment({ providerOrderId: "DEV_SUCCESS_whatever" })).rejects.toThrow(/production/);
  });

  it("DevPaymentProvider.testConnection refuses to run under NODE_ENV=production even if constructed directly", async () => {
    const { DevPaymentProvider } = await import("@/server/modules/payments/providers/dev.provider");
    const provider = new DevPaymentProvider();
    await expect(provider.testConnection()).rejects.toThrow(/production/);
  });

  it("DevPaymentProvider.isConfigured() is false under NODE_ENV=production", async () => {
    const { DevPaymentProvider } = await import("@/server/modules/payments/providers/dev.provider");
    const provider = new DevPaymentProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it("getDevPaymentOutcome/__clearDevPaymentStoreForTests/__setDevPaymentMismatchForTests also refuse to run under NODE_ENV=production", async () => {
    const {
      getDevPaymentOutcome,
      __setDevPaymentMismatchForTests,
    } = await import("@/server/modules/payments/providers/dev.provider");
    expect(() => getDevPaymentOutcome("anything")).toThrow(/production/);
    expect(() => __setDevPaymentMismatchForTests("anything", { amountInSmallestUnit: 1 })).toThrow(/production/);
  });
});
