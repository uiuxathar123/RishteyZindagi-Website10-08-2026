/**
 * PCP: refunds against a SUCCESS payment, initiated by an admin holding the
 * existing `payments.review` permission (same permission as manual activation
 * and invoice cancel/regenerate — a money-moving review action).
 *
 * Rules:
 *  - Only a payment whose status is SUCCESS can be refunded.
 *  - The refundable balance (payment amount − refunds that are PENDING or
 *    PROCESSED) is computed while holding a row lock on the payment, so two
 *    concurrent refund requests can never over-refund.
 *  - The refund row is written PENDING *before* the gateway call; a gateway
 *    error marks it FAILED (releasing the balance). The gateway's own refund
 *    status is re-read (webhook or `syncRefund`) before a refund is treated as
 *    PROCESSED — the immediate API response is never trusted as final.
 *  - A refund that brings total PROCESSED refunds to the full amount flips the
 *    payment to REFUNDED, ends the linked membership and voids the invoice. A
 *    partial refund changes none of those (the admin decides what the member
 *    keeps).
 */
import { randomUUID } from "crypto";
import { ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from "@/server/lib/errors";
import { db } from "@/server/db/client";
import { paymentRefunds } from "@/server/db/schema";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as membershipsRepo from "@/server/modules/memberships/memberships.repository";
import * as invoicesRepo from "@/server/modules/invoices/invoices.repository";
import * as paymentsRepo from "./payments.repository";
import * as gatewaysRepo from "./gateways.repository";
import * as pcpRepo from "./payments-pcp.repository";
import type { RefundRow } from "./payments-pcp.repository";
import { getPaymentGatewayProvider } from "./providers/factory";
import { PHONEPE_GATEWAY_NAME, RAZORPAY_GATEWAY_NAME } from "./credentials";

const PERMISSION = "payments.review";

function providerKey(gatewayName: string): "RAZORPAY" | "PHONEPE" {
  if (gatewayName === RAZORPAY_GATEWAY_NAME) return "RAZORPAY";
  if (gatewayName === PHONEPE_GATEWAY_NAME) return "PHONEPE";
  throw new ConflictError("Refunds are only supported for Razorpay and PhonePe payments.");
}

export interface RefundInput {
  amountInPaise?: number;
  reason: string;
}

function committed(rows: RefundRow[]): number {
  return rows.filter((r) => r.status === "PENDING" || r.status === "PROCESSED").reduce((n, r) => n + r.amountInPaise, 0);
}

export async function listRefunds(ctx: AuthContext, paymentId: string): Promise<{ refunds: RefundRow[]; refundableInPaise: number }> {
  await requirePermission(ctx, PERMISSION);
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found.");
  const refunds = await pcpRepo.listRefundsForPayment(paymentId);
  const refundable = payment.status === "SUCCESS" ? payment.amountInPaise - committed(refunds) : 0;
  return { refunds, refundableInPaise: Math.max(0, refundable) };
}

export async function requestRefund(
  ctx: AuthContext,
  paymentId: string,
  input: RefundInput,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<RefundRow> {
  await requirePermission(ctx, PERMISSION);

  const reserved = await db.transaction(async (tx) => {
    const payment = await pcpRepo.lockPayment(tx, paymentId);
    if (!payment) throw new NotFoundError("Payment not found.");
    if (payment.status !== "SUCCESS") throw new ConflictError("Only a successful payment can be refunded.");

    const gateway = await gatewaysRepo.findById(payment.gatewayId);
    if (!gateway) throw new NotFoundError("Payment gateway not found.");
    const provider = providerKey(gateway.name);

    const existing = await pcpRepo.listRefundsForPayment(paymentId);
    const refundable = payment.amountInPaise - committed(existing);
    const amount = input.amountInPaise ?? refundable;
    if (amount <= 0 || refundable <= 0) throw new ConflictError("This payment has no refundable balance left.");
    if (amount > refundable) {
      throw new ConflictError(`The refund exceeds the refundable balance of ${refundable} paise.`, { refundableInPaise: refundable });
    }

    const [row] = await tx
      .insert(paymentRefunds)
      .values({
        paymentId,
        provider,
        refundRef: `RFD-${randomUUID()}`,
        amountInPaise: amount,
        currency: payment.currency,
        status: "PENDING",
        reason: input.reason,
        requestedByAdminId: ctx.subject.id,
      })
      .returning();
    return { row, payment, gatewayName: gateway.name };
  });

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "payment.refund_requested",
    entityType: "payment",
    entityId: paymentId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { refundId: reserved.row.id, amountInPaise: reserved.row.amountInPaise, reason: input.reason },
  });

  const provider = getPaymentGatewayProvider(reserved.gatewayName, false);
  if (!provider.refund) {
    await pcpRepo.updateRefund(reserved.row.id, { status: "FAILED", failureReason: "Gateway does not support refunds." });
    throw new ServiceUnavailableError("This gateway does not support refunds.");
  }

  try {
    const gatewayTxn = await pcpRepo.latestSuccessfulGatewayTransactionId(paymentId);
    const result = await provider.refund({
      providerPaymentId: gatewayTxn ?? undefined,
      providerOrderId: reserved.payment.gatewayReference ?? "",
      amountInSmallestUnit: reserved.row.amountInPaise,
      refundRef: reserved.row.refundRef,
      reason: input.reason,
    });
    const updated = await pcpRepo.updateRefund(reserved.row.id, { providerRefundId: result.providerRefundId, status: result.status, failureReason: result.failureReason ?? null });
    if (result.status !== "PENDING") await applyRefundOutcome(updated);
    return updated;
  } catch (err) {
    await pcpRepo.updateRefund(reserved.row.id, { status: "FAILED", failureReason: (err instanceof Error ? err.message : "Gateway error").slice(0, 300) });
    await record({
      actorType: "ADMIN",
      actorId: ctx.subject.id,
      action: "payment.refund_failed",
      entityType: "payment",
      entityId: paymentId,
      metadata: { refundId: reserved.row.id },
    });
    throw err;
  }
}

/** Re-reads a refund's state from the gateway and applies the outcome. Used by webhooks and the reconcile job. */
export async function syncRefund(refundId: string): Promise<RefundRow> {
  const refund = await pcpRepo.findRefundById(refundId);
  if (!refund) throw new NotFoundError("Refund not found.");
  if (refund.status !== "PENDING") return refund;
  const payment = await paymentsRepo.findById(refund.paymentId);
  if (!payment) throw new NotFoundError("Payment not found.");
  const gateway = await gatewaysRepo.findById(payment.gatewayId);
  if (!gateway) throw new NotFoundError("Payment gateway not found.");
  const provider = getPaymentGatewayProvider(gateway.name, false);
  if (!provider.getRefundStatus || !refund.providerRefundId) return refund;
  const result = await provider.getRefundStatus({ providerRefundId: refund.providerRefundId, refundRef: refund.refundRef });
  if (result.status === refund.status) return refund;
  const updated = await pcpRepo.updateRefund(refund.id, { status: result.status, failureReason: result.failureReason ?? null });
  await applyRefundOutcome(updated);
  return updated;
}

async function applyRefundOutcome(refund: RefundRow): Promise<void> {
  if (refund.status === "FAILED") {
    await record({ actorType: "SYSTEM", action: "payment.refund_failed", entityType: "payment", entityId: refund.paymentId, metadata: { refundId: refund.id } });
    return;
  }
  if (refund.status !== "PROCESSED") return;

  const payment = await paymentsRepo.findById(refund.paymentId);
  if (!payment) return;
  const all = await pcpRepo.listRefundsForPayment(refund.paymentId);
  const processed = all.filter((r) => r.status === "PROCESSED").reduce((n, r) => n + r.amountInPaise, 0);

  await record({
    actorType: "SYSTEM",
    action: "payment.refund_processed",
    entityType: "payment",
    entityId: refund.paymentId,
    metadata: { refundId: refund.id, amountInPaise: refund.amountInPaise, totalRefundedInPaise: processed },
  });
  await notify({
    userId: payment.userId,
    channel: "IN_APP",
    title: "Refund processed",
    body: `A refund of ${(refund.amountInPaise / 100).toFixed(2)} ${refund.currency} has been issued to your original payment method.`,
    dedupeKey: `refund_processed:${refund.id}`,
  });

  if (processed >= payment.amountInPaise) {
    const flipped = await pcpRepo.markPaymentRefunded(payment.id);
    if (flipped) {
      if (payment.membershipId) {
        const membership = await membershipsRepo.findById(payment.membershipId);
        if (membership && membership.status === "ACTIVE") await membershipsRepo.cancel(membership.id);
      }
      const invoice = await pcpRepo.invoiceForPayment(payment.id);
      if (invoice && invoice.status !== "VOID") await invoicesRepo.voidInvoice(invoice.id, "Payment fully refunded.");
      await record({ actorType: "SYSTEM", action: "payment.fully_refunded", entityType: "payment", entityId: payment.id });
    }
  }
}

export function validateRefundInput(input: RefundInput): void {
  if (input.amountInPaise !== undefined && (!Number.isInteger(input.amountInPaise) || input.amountInPaise < 1)) {
    throw new ValidationError("amountInPaise must be a positive integer.");
  }
}
