/**
 * PCP: browser-side confirmation for Razorpay Standard Checkout.
 *
 * After the customer pays, Checkout hands the browser
 * {razorpay_payment_id, razorpay_order_id, razorpay_signature}. The official
 * check (razorpay.com/docs/payments/payment-gateway/web-integration/standard)
 * is  HMAC-SHA256(order_id + "|" + razorpay_payment_id, key_secret)  compared
 * with razorpay_signature — using the order id *this server stored*, not the
 * one the browser sent.
 *
 * A valid signature does NOT activate anything by itself. It only proves the
 * browser's claim is consistent; the membership is activated by the same
 * server-to-server verification every other path uses (payment status read
 * from Razorpay, amount/currency cross-checked against the stored payment).
 * So the client-supplied fields can only ever make the server *reject*
 * earlier or *look sooner* — never grant.
 */
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as paymentsRepo from "./payments.repository";
import * as gatewaysRepo from "./gateways.repository";
import { verifyPaymentInternal, type VerifyResult } from "./payments.service";
import { loadRazorpayCredentials, RAZORPAY_GATEWAY_NAME } from "./credentials";

export interface RazorpayConfirmInput {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export function expectedRazorpayPaymentSignature(orderId: string, paymentId: string, keySecret: string): string {
  return createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export async function confirmRazorpayPayment(ctx: AuthContext, paymentId: string, input: RazorpayConfirmInput): Promise<VerifyResult> {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment || payment.userId !== ctx.subject.id) {
    throw new AuthorizationError("You do not have permission to access this payment.");
  }
  const gateway = await gatewaysRepo.findById(payment.gatewayId);
  if (!gateway || gateway.name !== RAZORPAY_GATEWAY_NAME) throw new ConflictError("This payment was not made through Razorpay.");
  if (!payment.gatewayReference) throw new ConflictError("This payment has no order reference.");
  if (input.razorpay_order_id !== payment.gatewayReference) {
    throw new ValidationError("The order does not belong to this payment.");
  }

  const creds = await loadRazorpayCredentials();
  if (!creds) throw new ConflictError("Razorpay is not configured.");
  if (creds.problem) throw new ConflictError(creds.problem);
  const expected = expectedRazorpayPaymentSignature(payment.gatewayReference, input.razorpay_payment_id, creds.keySecret);
  if (!constantTimeEqual(input.razorpay_signature.toLowerCase(), expected)) {
    await record({
      actorType: "USER",
      actorId: ctx.subject.id,
      action: "payment.signature_mismatch",
      entityType: "payment",
      entityId: payment.id,
    });
    // 400, not 401: the member's session is fine; a 401 would make the BFF discard it and sign them out.
    throw new ValidationError("The payment signature is invalid.");
  }

  return verifyPaymentInternal(payment);
}
