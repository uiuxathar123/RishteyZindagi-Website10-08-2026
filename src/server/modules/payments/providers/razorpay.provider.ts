/**
 * Razorpay adapter — implemented against Razorpay's official REST API
 * (https://razorpay.com/docs/api/). Contract used, as documented there:
 *
 *  - Auth: HTTP Basic, key_id : key_secret.
 *  - Create order: POST /v1/orders {amount (paise), currency, receipt (<=40), notes}
 *      → {id: "order_…", status: created|attempted|paid, …}. An order maps 1:1 to
 *      a payment attempt flow.
 *  - Payments of an order: GET /v1/orders/{id}/payments → {items:[{id, status,
 *      amount, currency, order_id, …}]}; a payment is money-in only when its
 *      status is "captured".
 *  - Refund: POST /v1/payments/{payment_id}/refund {amount, speed, notes, receipt}
 *      → {id: "rfnd_…", status: pending|processed|failed}.
 *  - Refund status: GET /v1/refunds/{id}.
 *
 * STATUS: VERIFIED against a protocol-accurate local mock server
 * (tests/pcp-payments-razorpay.test.ts). NOT VERIFIED against the live
 * Razorpay service — that requires the owner's Razorpay account
 * (REQUIRES EXTERNAL CREDENTIALS).
 *
 * Amount is ALWAYS the one the caller passes (server-derived from the plan);
 * nothing in this file reads a client-supplied amount. Secrets are loaded per
 * call (see ../credentials.ts), used only to build the Authorization header,
 * and never logged or placed in a thrown message.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { loadRazorpayCredentials } from "../credentials";
import { httpRequest, pick, resolveBase } from "./http";
import type {
  PaymentGatewayProvider,
  CreateOrderParams,
  CreateOrderResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  TestConnectionResult,
  RefundParams,
  RefundResult,
  RefundOutcomeStatus,
} from "./types";

const DEFAULT_BASE = "https://api.razorpay.com";

function base(): string {
  return resolveBase(getEnv().RAZORPAY_API_BASE, DEFAULT_BASE);
}

function basicAuth(keyId: string, keySecret: string): string {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64");
}

function gatewayError(status: number, json: unknown, action: string): ServiceUnavailableError {
  if (status === 401) return new ServiceUnavailableError("Razorpay rejected the configured credentials.");
  const code = pick(json, "error", "code");
  return new ServiceUnavailableError(`Razorpay could not ${action} (HTTP ${status}${typeof code === "string" ? `, ${code}` : ""}).`);
}

async function requireCreds() {
  const creds = await loadRazorpayCredentials();
  if (!creds) {
    throw new ServiceUnavailableError("Razorpay is not configured. Save the key id/secret in Admin → Payments, or set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }
  return creds;
}

function refundStatus(raw: unknown): RefundOutcomeStatus {
  if (raw === "processed") return "PROCESSED";
  if (raw === "failed") return "FAILED";
  return "PENDING";
}

export class RazorpayProvider implements PaymentGatewayProvider {
  readonly name = "Razorpay";

  /** Sync, env-only signal (kept for the legacy admin view / prod-readiness). The accurate DB+env answer is in payment-config.service.ts. */
  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.RAZORPAY_KEY_ID) && Boolean(env.RAZORPAY_KEY_SECRET);
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const creds = await requireCreds();
    const receipt = params.receiptRef.slice(0, 40);
    const res = await httpRequest("Razorpay", `${base()}/v1/orders`, {
      method: "POST",
      headers: { Authorization: basicAuth(creds.keyId, creds.keySecret), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: params.amountInSmallestUnit,
        currency: params.currency,
        receipt,
        notes: { receipt },
      }),
    });
    const orderId = pick(res.json, "id");
    if (res.status !== 200 || typeof orderId !== "string") throw gatewayError(res.status, res.json, "create the order");
    // Defence in depth: the order the gateway created must be for exactly the amount we asked for.
    const amount = pick(res.json, "amount");
    if (amount !== params.amountInSmallestUnit) throw new ServiceUnavailableError("Razorpay created an order for an unexpected amount; checkout was aborted.");
    return {
      providerOrderId: orderId,
      raw: { id: orderId, status: pick(res.json, "status") },
      clientCheckout: { provider: "RAZORPAY", keyId: creds.keyId, orderId, amount: params.amountInSmallestUnit, currency: params.currency },
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const creds = await requireCreds();
    const res = await httpRequest("Razorpay", `${base()}/v1/orders/${encodeURIComponent(params.providerOrderId)}/payments`, {
      headers: { Authorization: basicAuth(creds.keyId, creds.keySecret) },
    });
    if (res.status !== 200) throw gatewayError(res.status, res.json, "read the order's payments");
    const items = pick(res.json, "items");
    const list = Array.isArray(items) ? items : [];
    const captured = list.find((p) => pick(p, "status") === "captured" && pick(p, "order_id") === params.providerOrderId);
    if (captured) {
      const amount = pick(captured, "amount");
      const currency = pick(captured, "currency");
      return {
        status: "SUCCESS",
        gatewayTransactionId: String(pick(captured, "id")),
        amountInSmallestUnit: typeof amount === "number" ? amount : undefined,
        currency: currency === "INR" || currency === "USD" ? currency : undefined,
        // Only non-PII fields are retained (the payment object also carries email/contact/vpa/card ids).
        rawResponse: {
          id: pick(captured, "id"),
          status: pick(captured, "status"),
          method: pick(captured, "method"),
          amount,
          currency,
          order_id: pick(captured, "order_id"),
          created_at: pick(captured, "created_at"),
        },
      };
    }
    // Not captured. An order can still be paid on a retry inside Checkout, so a failed attempt is NOT final:
    // report PENDING and let the reconciliation job close genuinely abandoned orders.
    return { status: "PENDING", rawResponse: { attempts: list.length } };
  }

  async testConnection(): Promise<TestConnectionResult> {
    const creds = await loadRazorpayCredentials();
    if (!creds) return { ok: false, message: "Razorpay is not configured." };
    try {
      // Read-only: lists at most one order. No money moves.
      const res = await httpRequest("Razorpay", `${base()}/v1/orders?count=1`, {
        headers: { Authorization: basicAuth(creds.keyId, creds.keySecret) },
        timeoutMs: 8000,
      });
      if (res.status === 200) return { ok: true, message: `Razorpay accepted the credentials (${creds.mode} mode key).` };
      if (res.status === 401) return { ok: false, message: "Razorpay rejected the credentials." };
      return { ok: false, message: `Razorpay answered HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Razorpay could not be reached." };
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const creds = await requireCreds();
    if (!params.providerPaymentId) throw new ServiceUnavailableError("This payment has no Razorpay payment id to refund.");
    const res = await httpRequest("Razorpay", `${base()}/v1/payments/${encodeURIComponent(params.providerPaymentId)}/refund`, {
      method: "POST",
      headers: { Authorization: basicAuth(creds.keyId, creds.keySecret), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: params.amountInSmallestUnit,
        speed: "normal",
        receipt: params.refundRef.slice(0, 40),
        notes: { reason: params.reason.slice(0, 200) },
      }),
    });
    const id = pick(res.json, "id");
    if (res.status !== 200 || typeof id !== "string") throw gatewayError(res.status, res.json, "create the refund");
    return { providerRefundId: id, status: refundStatus(pick(res.json, "status")) };
  }

  async getRefundStatus(params: { providerRefundId: string; refundRef: string }): Promise<RefundResult> {
    const creds = await requireCreds();
    const res = await httpRequest("Razorpay", `${base()}/v1/refunds/${encodeURIComponent(params.providerRefundId)}`, {
      headers: { Authorization: basicAuth(creds.keyId, creds.keySecret) },
    });
    if (res.status !== 200) throw gatewayError(res.status, res.json, "read the refund");
    return { providerRefundId: params.providerRefundId, status: refundStatus(pick(res.json, "status")) };
  }
}
