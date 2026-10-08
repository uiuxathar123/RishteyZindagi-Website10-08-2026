/**
 * PCP additions to payment data access (kept in a new file so the frozen
 * B8 payments.repository.ts is not edited).
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { payments, paymentRefunds, paymentWebhookEvents, transactions, invoices } from "@/server/db/schema";
import type { PaymentRow } from "./payments.repository";

export type RefundRow = typeof paymentRefunds.$inferSelect;
export type WebhookEventRow = typeof paymentWebhookEvents.$inferSelect;

export async function findByGatewayReference(gatewayId: string, gatewayReference: string): Promise<PaymentRow | undefined> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.gatewayId, gatewayId), eq(payments.gatewayReference, gatewayReference)))
    .limit(1);
  return row;
}

/** PENDING payments created before `cutoff` (oldest first), for the reconciliation job. */
export async function listPendingOlderThan(cutoff: Date, limit: number): Promise<PaymentRow[]> {
  return db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "PENDING"), lt(payments.createdAt, cutoff)))
    .orderBy(payments.createdAt)
    .limit(limit);
}

/** Atomically claim a webhook event for processing. Returns the row only if it is new, or a previous attempt FAILED (so gateway retries are processed). */
export async function claimWebhookEvent(input: {
  provider: string;
  eventId: string;
  eventType: string | null;
  payloadHash: string;
}): Promise<WebhookEventRow | undefined> {
  const [row] = await db
    .insert(paymentWebhookEvents)
    .values({ provider: input.provider, eventId: input.eventId, eventType: input.eventType, payloadHash: input.payloadHash })
    .onConflictDoUpdate({
      target: [paymentWebhookEvents.provider, paymentWebhookEvents.eventId],
      set: { status: "RECEIVED", error: null, receivedAt: new Date() },
      setWhere: eq(paymentWebhookEvents.status, "FAILED"),
    })
    .returning();
  return row;
}

export async function finishWebhookEvent(
  id: string,
  status: "PROCESSED" | "IGNORED" | "FAILED",
  extra: { paymentId?: string | null; error?: string | null }
): Promise<void> {
  await db
    .update(paymentWebhookEvents)
    .set({ status, paymentId: extra.paymentId ?? null, error: extra.error ?? null, processedAt: new Date() })
    .where(eq(paymentWebhookEvents.id, id));
}

// --- refunds ---------------------------------------------------------------

export async function lockPayment(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], paymentId: string): Promise<PaymentRow | undefined> {
  const res = await tx.execute(sql`SELECT * FROM payments WHERE id = ${paymentId} FOR UPDATE`);
  if (res.rows.length === 0) return undefined;
  const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  return row;
}

export async function listRefundsForPayment(paymentId: string): Promise<RefundRow[]> {
  return db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, paymentId)).orderBy(paymentRefunds.createdAt);
}

export async function findRefundById(id: string): Promise<RefundRow | undefined> {
  const [row] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, id)).limit(1);
  return row;
}

export async function findRefundByProviderRefundId(provider: string, providerRefundId: string): Promise<RefundRow | undefined> {
  const [row] = await db
    .select()
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.provider, provider), eq(paymentRefunds.providerRefundId, providerRefundId)))
    .limit(1);
  return row;
}

export async function findRefundByRef(refundRef: string): Promise<RefundRow | undefined> {
  const [row] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.refundRef, refundRef)).limit(1);
  return row;
}

export async function updateRefund(
  id: string,
  patch: Partial<Pick<RefundRow, "status" | "providerRefundId" | "failureReason">>
): Promise<RefundRow> {
  const [row] = await db
    .update(paymentRefunds)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(paymentRefunds.id, id))
    .returning();
  return row;
}

/** payments.status = REFUNDED, only from SUCCESS (compare-and-swap). */
export async function markPaymentRefunded(paymentId: string): Promise<PaymentRow | undefined> {
  const [row] = await db
    .update(payments)
    .set({ status: "REFUNDED", updatedAt: new Date() })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "SUCCESS")))
    .returning();
  return row;
}

export async function latestSuccessfulGatewayTransactionId(paymentId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: transactions.gatewayTransactionId })
    .from(transactions)
    .where(and(eq(transactions.paymentId, paymentId), eq(transactions.status, "SUCCESS")))
    .orderBy(sql`${transactions.createdAt} desc`)
    .limit(1);
  return row?.id ?? null;
}

export async function invoiceForPayment(paymentId: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId)).limit(1);
  return row;
}
