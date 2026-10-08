/**
 * Dev-only "payment gateway" — MOCKED FOR DEVELOPMENT, never a real
 * payment channel. Mirrors src/server/modules/otp/providers/dev.provider.ts's
 * exact structure: an in-process store, a real create-order -> verify
 * flow (not an unconditional auto-success), and a hard double guard
 * (this file's own check + factory.ts's own check) making it structurally
 * incapable of running in production.
 *
 * Deterministic outcome convention (see types.ts's `simulateOutcome`
 * doc): `createOrder({ simulateOutcome })` embeds the desired outcome in
 * the generated `providerOrderId` (`DEV_<OUTCOME>_<uuid>`) and records it
 * server-side in this file's in-memory store — `verifyPayment()` never
 * trusts a client-supplied flag at verify time, it only reads what this
 * same process already decided at order-creation time, the same
 * real-money discipline every other verify path in this codebase follows
 * (see payments.service.ts's own top-of-file comment: "never trust a
 * client-claimed success").
 *   - "SUCCESS" (the default when simulateOutcome is omitted): verify
 *     immediately reports SUCCESS with a fabricated-but-clearly-mock
 *     gateway transaction id.
 *   - "FAILED": verify immediately reports FAILED.
 *   - "PENDING": verify reports PENDING every time it's called — models a
 *     gateway that never resolves on its own, exactly the state the
 *     manual-admin-review path (payments.service.ts's manualVerifyPayment)
 *     exists to handle.
 */
import { randomUUID } from "crypto";
import { getEnv } from "@/server/config/env";
import type {
  PaymentGatewayProvider,
  CreateOrderParams,
  CreateOrderResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  VerifyOutcomeStatus,
  TestConnectionResult,
} from "./types";

interface DevOrderRecord {
  outcome: VerifyOutcomeStatus;
  /** B10: the amount/currency this order was actually CREATED for
   * (verbatim from createOrder's params — i.e. what checkout() itself
   * asked the gateway to charge, since no client input reaches this
   * provider directly). verifyPayment reports these back unchanged by
   * default, so the normal path never has a mismatch — see
   * __setDevPaymentMismatchForTests below for how a test simulates a
   * gateway confirming a different amount than it was asked to charge
   * (payments.service.ts's own B10 cross-check). */
  amountInSmallestUnit: number;
  currency: "INR" | "USD";
}

// In-memory only — intentionally never persisted, mirroring
// otp/providers/dev.provider.ts's devOtpStore exactly.
//
// B16: anchored on globalThis (same fix as otp/providers/dev.provider.ts).
// `next dev` can bundle the checkout and verify route handlers as separate
// module instances, which gave each its own Map and made verify() fail
// every order created by checkout(). Semantics are unchanged: still
// in-process only, never persisted, never reachable in production.
const globalForDevPayments = globalThis as unknown as { __rzDevOrderStore?: Map<string, DevOrderRecord> };
const devOrderStore: Map<string, DevOrderRecord> = (globalForDevPayments.__rzDevOrderStore ??= new Map<string, DevOrderRecord>());

function assertNotProduction(context: string) {
  if (getEnv().NODE_ENV === "production") {
    throw new Error(`${context} must never run when NODE_ENV=production.`);
  }
}

export class DevPaymentProvider implements PaymentGatewayProvider {
  readonly name = "Dev/Mock Gateway";

  isConfigured(): boolean {
    return getEnv().NODE_ENV !== "production";
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    assertNotProduction("DevPaymentProvider.createOrder");
    const outcome: VerifyOutcomeStatus = params.simulateOutcome ?? "SUCCESS";
    const providerOrderId = `DEV_${outcome}_${randomUUID()}`;
    devOrderStore.set(providerOrderId, {
      outcome,
      amountInSmallestUnit: params.amountInSmallestUnit,
      currency: params.currency,
    });
    return { providerOrderId, raw: { mock: true, outcome, receiptRef: params.receiptRef } };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    assertNotProduction("DevPaymentProvider.verifyPayment");
    const record = devOrderStore.get(params.providerOrderId);
    if (!record) {
      // Unknown order id — an honest FAILED, not a crash (mirrors a real
      // gateway not recognizing an order it never issued).
      return { status: "FAILED", rawResponse: { mock: true, reason: "unknown_order_id" } };
    }
    if (record.outcome === "PENDING") {
      return { status: "PENDING", rawResponse: { mock: true } };
    }
    return {
      status: record.outcome,
      gatewayTransactionId: `DEV_TXN_${randomUUID()}`,
      amountInSmallestUnit: record.amountInSmallestUnit,
      currency: record.currency,
      rawResponse: { mock: true, outcome: record.outcome },
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    assertNotProduction("DevPaymentProvider.testConnection");
    return { ok: true, message: "Dev/mock provider — always reachable outside production." };
  }
}

/** Test/dev-only accessor — reads back the simulated outcome for a given
 * providerOrderId, mirroring getDevOtpCode. */
export function getDevPaymentOutcome(providerOrderId: string): VerifyOutcomeStatus | undefined {
  assertNotProduction("getDevPaymentOutcome");
  return devOrderStore.get(providerOrderId)?.outcome;
}

/** Test-only: clears all stored dev orders between test cases. */
export function __clearDevPaymentStoreForTests() {
  devOrderStore.clear();
}

/**
 * B10, test-only: makes a subsequent verifyPayment() for this
 * providerOrderId report a DIFFERENT amount/currency than the order was
 * actually created for — simulating a gateway that confirms success for
 * an amount it was never asked to charge (e.g. a tampered checkout
 * widget, or a gateway-side bug). Every real gateway provider always
 * throws (see each provider's own file), so this is the only way this
 * codebase can exercise payments.service.ts's amount/currency-consistency
 * check without a real vendor integration. No production code path ever
 * calls this — assertNotProduction guards it exactly like every other
 * dev-only export in this file.
 */
export function __setDevPaymentMismatchForTests(
  providerOrderId: string,
  mismatch: { amountInSmallestUnit?: number; currency?: "INR" | "USD" }
): void {
  assertNotProduction("__setDevPaymentMismatchForTests");
  const existing = devOrderStore.get(providerOrderId);
  if (!existing) return;
  devOrderStore.set(providerOrderId, {
    ...existing,
    amountInSmallestUnit: mismatch.amountInSmallestUnit ?? existing.amountInSmallestUnit,
    currency: mismatch.currency ?? existing.currency,
  });
}
