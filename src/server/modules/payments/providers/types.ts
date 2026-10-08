/**
 * B8: payment-gateway provider abstraction. Mirrors B2's OTP provider
 * pattern deliberately (see src/server/modules/otp/providers/types.ts) —
 * one small interface, one class per gateway, a dev/mock double
 * structurally incapable of running in production, and one factory that
 * is the sole place deciding real-vs-dev.
 *
 * Contract every real implementation must honor (identical spirit to
 * OtpProvider's own contract):
 *  - `createOrder()`/`verifyPayment()` either genuinely talk to a real
 *    vendor integration, or they throw `ServiceUnavailableError` — never
 *    fabricate success. No real vendor SDK is wired into this sandbox
 *    for ANY of the five gateways (see each provider file's own
 *    comment), so every real provider class always throws — honestly,
 *    per this file's own contract, not a bug.
 *  - `isConfigured()` is cheap, synchronous-in-spirit, and only checks
 *    that this gateway's env-var credentials are present — never that
 *    they're valid, never a network call.
 *  - Nothing here ever logs or returns a raw secret.
 */

export type VerifyOutcomeStatus = "SUCCESS" | "FAILED" | "PENDING";

export interface CreateOrderParams {
  /** Smallest-currency-unit amount (paise for INR, cents for USD — see
   * membershipPlans.priceInPaise's B8 reuse note in schema.ts). */
  amountInSmallestUnit: number;
  currency: "INR" | "USD";
  /** The internal order/reference id this backend generated and will
   * store on `payments.gatewayReference` — handed to the gateway so its
   * own dashboard/webhook can be correlated back to this payment. */
  receiptRef: string;
  /** TEST-ONLY: which outcome DevPaymentProvider should deterministically
   * produce on verify (see dev.provider.ts's file comment for the full
   * convention — mirrors DevOtpProvider's getDevOtpCode-style test
   * readback). Every REAL gateway provider (razorpay/cashfree/payu/
   * phonepe/paytm) throws before ever reading this field — it has no
   * effect outside the dev/mock provider, and the dev/mock provider
   * itself is structurally incapable of running in production. Defaults
   * to "SUCCESS" when omitted. Never read by checkout.controller.ts's
   * production call sites — passing it is only ever a test convenience. */
  simulateOutcome?: VerifyOutcomeStatus;
  /** PCP: the internal payment row id — used by gateways that redirect the
   * browser back to the site (PhonePe) so the return page knows which payment
   * to verify. Never trusted for authorization (the verify route re-checks
   * ownership). Ignored by every other provider. */
  paymentId?: string;
}

export interface CreateOrderResult {
  /** The gateway's own order id, if one exists for this gateway's flow.
   * Purely informational for the dev/mock provider (see dev.provider.ts) —
   * a real gateway would return its own real order id here. */
  providerOrderId: string;
  raw?: unknown;
  /** PCP: what the browser needs to complete payment. Contains ONLY public
   * values (Razorpay's public key id, an order id, a redirect URL) — never a
   * secret. Absent for the dev provider. */
  clientCheckout?: ClientCheckoutData;
}

export type ClientCheckoutData =
  | { provider: "RAZORPAY"; keyId: string; orderId: string; amount: number; currency: string }
  | { provider: "PHONEPE"; redirectUrl: string };

export interface RefundParams {
  /** The gateway's own payment/transaction id (Razorpay `pay_…`). Unused by PhonePe, which refunds by merchant order id. */
  providerPaymentId?: string;
  /** The order/reference id stored on payments.gateway_reference. */
  providerOrderId: string;
  amountInSmallestUnit: number;
  /** Internal unique refund id, sent to the gateway as receipt / merchantRefundId. */
  refundRef: string;
  reason: string;
}

export type RefundOutcomeStatus = "PENDING" | "PROCESSED" | "FAILED";

export interface RefundResult {
  providerRefundId: string;
  status: RefundOutcomeStatus;
  failureReason?: string;
}

export interface VerifyPaymentParams {
  providerOrderId: string;
}

export interface VerifyPaymentResult {
  status: VerifyOutcomeStatus;
  /** The gateway's own transaction id — see transactions.gatewayTransactionId's
   * schema.ts comment for the full three-id mapping. Only meaningful when
   * status is SUCCESS or FAILED (a still-PENDING verify may not have one yet). */
  gatewayTransactionId?: string;
  /**
   * B10: the amount/currency the GATEWAY itself is confirming as paid,
   * when the gateway's verify response actually carries one (a real
   * vendor's webhook/verify payload always does). Optional because a
   * still-PENDING result may not have one yet — never optional in
   * spirit for a SUCCESS/FAILED result from a real integration.
   *
   * payments.service.ts's verifyPaymentInternal cross-checks this
   * against the `payments` row's own stored amountInPaise/currency
   * (set at checkout time, before any gateway round trip) before ever
   * treating a SUCCESS as genuine — the "amount/currency/gateway-
   * consistency verification" B10 explicitly adds on top of B8's
   * existing "never trust a client-claimed success" rule. Left
   * undefined here (never checked) only by DevPaymentProvider when no
   * caller asked it to simulate a mismatch — see that file's own
   * comment — since no real vendor SDK is wired into this sandbox for
   * any of the five gateways to exercise a genuine mismatch against.
   */
  amountInSmallestUnit?: number;
  currency?: "INR" | "USD";
  rawResponse?: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export interface PaymentGatewayProvider {
  readonly name: string;
  isConfigured(): boolean;
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  /** Admin-facing "test connection" — see gateway-config.service.ts.
   * Never fakes a successful connection; honestly reports "not
   * configured" or "configured but no real vendor SDK wired in" for
   * every real provider in this sandbox (see each provider's own file). */
  testConnection(): Promise<TestConnectionResult>;
  /** PCP (optional — only Razorpay/PhonePe implement it). Initiates a refund at the gateway. */
  refund?(params: RefundParams): Promise<RefundResult>;
  /** PCP (optional). Re-reads a refund's state from the gateway. */
  getRefundStatus?(params: { providerRefundId: string; refundRef: string }): Promise<RefundResult>;
}
