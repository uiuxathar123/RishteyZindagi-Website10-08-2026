/**
 * PCP: inbound payment-gateway webhooks (Razorpay, PhonePe).
 *
 * Security model — the request is accepted only if it is AUTHENTICATED, and
 * even then its body is treated as a *hint*, never as truth:
 *
 *   1. Authenticate: Razorpay — HMAC-SHA256 (hex) of the RAW request bytes with
 *      the webhook secret, compared in constant time with `X-Razorpay-Signature`
 *      (official: razorpay.com/docs/webhooks/validate-test). PhonePe — the
 *      `Authorization` header must equal SHA-256(username:password) of the
 *      webhook credentials configured on the PhonePe dashboard (official:
 *      developer.phonepe.com … /webhook). Bad or missing → 401, nothing parsed.
 *   2. Idempotency: the (provider, event id) pair is claimed with an atomic
 *      INSERT … ON CONFLICT. Razorpay supplies `x-razorpay-event-id`; PhonePe
 *      documents no event id, so the SHA-256 of the raw body is used (a retry
 *      is byte-identical). A duplicate is acknowledged (200) and ignored. An
 *      event whose previous attempt FAILED is processed again, so the
 *      gateway's own retries can recover from a transient error.
 *   3. Never trust the body's amounts/status: the handler only extracts the
 *      order/refund REFERENCE, then re-reads the authoritative state from the
 *      gateway's API and runs the existing race-safe, amount-cross-checking
 *      resolution (payments.service.verifyPaymentInternal). A forged or
 *      replayed payload therefore cannot activate a membership or change an
 *      amount.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { AuthenticationError, ServiceUnavailableError, ValidationError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { record } from "@/server/modules/audit/audit.service";
import * as gatewaysRepo from "./gateways.repository";
import * as paymentsRepo from "./payments.repository";
import * as pcpRepo from "./payments-pcp.repository";
import { verifyPaymentInternal } from "./payments.service";
import { getPaymentGatewayProvider } from "./providers/factory";
import { loadPhonePeCredentials, loadRazorpayCredentials, PHONEPE_GATEWAY_NAME, RAZORPAY_GATEWAY_NAME } from "./credentials";
import { syncRefund } from "./refunds.service";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface WebhookResult {
  received: true;
  outcome: "PROCESSED" | "IGNORED" | "DUPLICATE";
}

function safeEqualText(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function parseJson(raw: Buffer): Record<string, unknown> {
  try {
    const value = JSON.parse(raw.toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fallthrough
  }
  throw new ValidationError("Webhook body must be a JSON object.");
}

function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Shared pipeline
// ---------------------------------------------------------------------------

async function processClaimed(
  provider: "RAZORPAY" | "PHONEPE",
  eventId: string,
  eventType: string | null,
  rawBody: Buffer,
  handler: () => Promise<{ paymentId?: string | null; ignored?: boolean }>
): Promise<WebhookResult> {
  const claimed = await pcpRepo.claimWebhookEvent({
    provider,
    eventId,
    eventType,
    payloadHash: createHash("sha256").update(rawBody).digest("hex"),
  });
  if (!claimed) return { received: true, outcome: "DUPLICATE" };

  try {
    const result = await handler();
    await pcpRepo.finishWebhookEvent(claimed.id, result.ignored ? "IGNORED" : "PROCESSED", { paymentId: result.paymentId });
    return { received: true, outcome: result.ignored ? "IGNORED" : "PROCESSED" };
  } catch (err) {
    logError("payment-webhook-processing-failed", err, { provider, eventType });
    await pcpRepo.finishWebhookEvent(claimed.id, "FAILED", { error: (err instanceof Error ? err.message : "error").slice(0, 300) });
    // 503 → the gateway retries later; the FAILED row lets the retry be processed.
    throw new ServiceUnavailableError("Webhook could not be processed right now.");
  }
}

/**
 * Reconciles one payment from the gateway's authoritative state. A payment
 * that is already closed as FAILED but turns out to be captured at the gateway
 * (a customer paying after our stale-order timeout) is flagged for manual
 * review in the audit log — money must never silently disappear.
 */
export async function reconcilePaymentFromGateway(payment: paymentsRepo.PaymentRow): Promise<{ status: string }> {
  if (payment.status === "PENDING") {
    const result = await verifyPaymentInternal(payment);
    return { status: result.status };
  }
  if (payment.status === "FAILED" && payment.gatewayReference) {
    const gateway = await gatewaysRepo.findById(payment.gatewayId);
    if (gateway) {
      const provider = getPaymentGatewayProvider(gateway.name, false);
      const check = await provider.verifyPayment({ providerOrderId: payment.gatewayReference });
      if (check.status === "SUCCESS") {
        await record({
          actorType: "SYSTEM",
          action: "payment.late_capture_detected",
          entityType: "payment",
          entityId: payment.id,
          metadata: {
            gateway: gateway.name,
            note: "Captured at the gateway after this payment was closed as FAILED. Needs manual review: activate (payments.review) or refund.",
            amountInPaise: payment.amountInPaise,
          },
        });
      }
    }
  }
  return { status: "ALREADY_RESOLVED" };
}

// ---------------------------------------------------------------------------
// Razorpay
// ---------------------------------------------------------------------------

export function razorpaySignature(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export async function handleRazorpayWebhook(rawBody: Buffer, headers: Headers): Promise<WebhookResult> {
  if (rawBody.length > MAX_WEBHOOK_BYTES) throw new ValidationError("Webhook body is too large.");
  const creds = await loadRazorpayCredentials();
  if (!creds?.webhookSecret) {
    throw new ServiceUnavailableError("Razorpay webhooks are not configured (no webhook secret).");
  }
  const provided = headers.get("x-razorpay-signature") ?? "";
  if (!provided || !safeEqualText(provided.toLowerCase(), razorpaySignature(rawBody, creds.webhookSecret))) {
    throw new AuthenticationError("Invalid webhook signature.");
  }

  const body = parseJson(rawBody);
  const eventType = typeof body.event === "string" ? body.event : null;
  const eventId = headers.get("x-razorpay-event-id") || `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;

  return processClaimed("RAZORPAY", eventId, eventType, rawBody, async () => {
    const gateway = await gatewaysRepo.findByName(RAZORPAY_GATEWAY_NAME);
    if (!gateway) return { ignored: true };

    if (eventType && eventType.startsWith("refund.")) {
      const refundId = get(body, "payload", "refund", "entity", "id");
      if (typeof refundId !== "string") return { ignored: true };
      const refund = await pcpRepo.findRefundByProviderRefundId("RAZORPAY", refundId);
      if (!refund) return { ignored: true };
      await syncRefund(refund.id);
      return { paymentId: refund.paymentId };
    }

    if (eventType && (eventType.startsWith("payment.") || eventType === "order.paid")) {
      const orderId = get(body, "payload", "payment", "entity", "order_id") ?? get(body, "payload", "order", "entity", "id");
      if (typeof orderId !== "string") return { ignored: true };
      const payment = await pcpRepo.findByGatewayReference(gateway.id, orderId);
      if (!payment) return { ignored: true }; // an order that is not ours (shared Razorpay account)
      await reconcilePaymentFromGateway(payment);
      return { paymentId: payment.id };
    }
    return { ignored: true };
  });
}

// ---------------------------------------------------------------------------
// PhonePe
// ---------------------------------------------------------------------------

export function phonepeAuthorizationValue(username: string, password: string): string {
  return createHash("sha256").update(`${username}:${password}`).digest("hex");
}

export async function handlePhonePeWebhook(rawBody: Buffer, headers: Headers): Promise<WebhookResult> {
  if (rawBody.length > MAX_WEBHOOK_BYTES) throw new ValidationError("Webhook body is too large.");
  const creds = await loadPhonePeCredentials();
  if (!creds?.webhookUsername || !creds?.webhookPassword) {
    throw new ServiceUnavailableError("PhonePe webhooks are not configured (no webhook username/password).");
  }
  const expected = phonepeAuthorizationValue(creds.webhookUsername, creds.webhookPassword);
  // The reference states the header carries SHA256(username:password) without fixing the encoding or an
  // optional scheme prefix; accept the lowercase-hex digest, with or without a "SHA256 " prefix.
  const rawHeader = (headers.get("authorization") ?? "").trim();
  const provided = rawHeader.replace(/^sha256\s+/i, "").toLowerCase();
  if (!provided || !safeEqualText(provided, expected)) {
    throw new AuthenticationError("Invalid webhook credentials.");
  }

  const body = parseJson(rawBody);
  const eventType = typeof body.event === "string" ? body.event : null;
  const eventId = `sha256:${createHash("sha256").update(rawBody).digest("hex")}`; // PhonePe documents no event id

  return processClaimed("PHONEPE", eventId, eventType, rawBody, async () => {
    const gateway = await gatewaysRepo.findByName(PHONEPE_GATEWAY_NAME);
    if (!gateway) return { ignored: true };
    const payload = get(body, "payload") ?? body;

    if (eventType && eventType.startsWith("pg.refund.")) {
      const merchantRefundId = get(payload, "merchantRefundId");
      const refundId = get(payload, "refundId");
      const refund =
        (typeof merchantRefundId === "string" ? await pcpRepo.findRefundByRef(merchantRefundId) : undefined) ??
        (typeof refundId === "string" ? await pcpRepo.findRefundByProviderRefundId("PHONEPE", refundId) : undefined);
      if (!refund) return { ignored: true };
      await syncRefund(refund.id);
      return { paymentId: refund.paymentId };
    }

    if (eventType && eventType.startsWith("checkout.order.")) {
      const merchantOrderId = get(payload, "merchantOrderId");
      if (typeof merchantOrderId !== "string") return { ignored: true };
      const payment = await pcpRepo.findByGatewayReference(gateway.id, merchantOrderId);
      if (!payment) return { ignored: true };
      await reconcilePaymentFromGateway(payment);
      return { paymentId: payment.id };
    }
    return { ignored: true };
  });
}
