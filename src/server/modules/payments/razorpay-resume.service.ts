/**
 * PCP: resume an unpaid Razorpay checkout.
 *
 * Problem this solves: a member closes the Razorpay popup (or a card is declined) and presses "Pay" again. The
 * duplicate-checkout guard (15 minutes, per plan — B8) rejects a second checkout while one is still pending, so
 * without a way back into the *same* order the member would have to wait. Razorpay orders stay payable until they
 * are paid or expire, so the safe fix is to hand the SAME order back to the browser.
 *
 * Nothing here creates a payment, grants a membership or trusts the browser:
 *   - only the owner of the payment can ask (IDOR → 403, same message as every other payments route);
 *   - the payment must still be PENDING, belong to Razorpay and carry the order id the server stored;
 *   - the amount/currency returned come from the stored payment row, never from the request;
 *   - activation still happens only through `razorpay/confirm`, a webhook or the reconcile job.
 * Only PUBLIC values leave the server (key id, order id, amount, currency).
 */
import { AuthorizationError, ConflictError, ServiceUnavailableError } from "@/server/lib/errors";
import { getEnv } from "@/server/config/env";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as paymentsRepo from "./payments.repository";
import * as gatewaysRepo from "./gateways.repository";
import { loadRazorpayCredentials, RAZORPAY_GATEWAY_NAME } from "./credentials";

export interface RazorpayResumeResult {
  paymentId: string;
  gatewayCheckout: { provider: "RAZORPAY"; keyId: string; orderId: string; amount: number; currency: string };
}

export async function resumeRazorpayCheckout(ctx: AuthContext, paymentId: string): Promise<RazorpayResumeResult> {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment || payment.userId !== ctx.subject.id) {
    throw new AuthorizationError("You do not have permission to access this payment.");
  }
  const gateway = await gatewaysRepo.findById(payment.gatewayId);
  if (!gateway || gateway.name !== RAZORPAY_GATEWAY_NAME) {
    throw new ConflictError("This payment was not started with Razorpay, so it cannot be reopened here. Check its status, or wait a few minutes and start a new checkout.");
  }
  if (payment.status !== "PENDING") throw new ConflictError("This payment is no longer pending.");
  if (!payment.gatewayReference) throw new ConflictError("This payment has no order reference.");

  const expiryMs = (getEnv().PAYMENT_PENDING_EXPIRY_MINUTES ?? 60) * 60_000;
  if (Date.now() - payment.createdAt.getTime() > expiryMs) {
    throw new ConflictError("This payment has expired. Start a new checkout.");
  }

  const creds = await loadRazorpayCredentials();
  if (!creds) throw new ServiceUnavailableError("Razorpay is not configured on this server.");
  if (creds.problem) throw new ServiceUnavailableError(creds.problem);

  await record({
    actorType: "USER",
    actorId: ctx.subject.id,
    action: "payment.checkout_resumed",
    entityType: "payment",
    entityId: payment.id,
  });

  return {
    paymentId: payment.id,
    gatewayCheckout: { provider: "RAZORPAY", keyId: creds.keyId, orderId: payment.gatewayReference, amount: payment.amountInPaise, currency: payment.currency },
  };
}
