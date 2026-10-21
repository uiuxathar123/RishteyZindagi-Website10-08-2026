/**
 * Fulfilment of a verified Personal Matchmaking payment, and its reversal on a full refund.
 *
 * Called from payments.service.ts's single fulfilment dispatcher, only for a payment whose SUCCESS has already been
 * verified server-side (amount and currency checked against the immutable payment row). Idempotent by design:
 *   1. Activation runs in ONE database transaction with the case row locked (SELECT ... FOR UPDATE): status
 *      PENDING_PAYMENT -> ACTIVE, paid payment, paid time, included access period and the history event are all
 *      written together or not at all. A case that already records this payment as paid is left untouched.
 *   2. The invoice is issued by whoever claims `invoice_claimed_at` (compare-and-swap), and only if the payment has
 *      no invoice yet. A claim older than INVOICE_CLAIM_STALE_MS without an invoice may be re-claimed, so a crash
 *      between claiming and issuing is recovered by a later replay instead of being lost or duplicated.
 * Because every step is safe to repeat, a replayed verify / webhook / reconcile / manual verify of an already
 * successful payment simply completes whatever an earlier, interrupted attempt left undone.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invoices, matchmakingCaseEvents, matchmakingCases, matchmakingSuggestions } from "@/server/db/schema";
import { logError } from "@/server/lib/logger";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import { issueInvoice } from "@/server/modules/invoices/invoices.service";
import * as paymentsRepo from "@/server/modules/payments/payments.repository";
import type { PaymentRow } from "@/server/modules/payments/payments.repository";
import * as repo from "./matchmaking.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVOICE_CLAIM_STALE_MS = 10 * 60 * 1000;
export const MATCHMAKING_SERVICE_CODE = "PERSONAL_MATCHMAKING";
export const MATCHMAKING_SERVICE_NAME = "Personal Matchmaking";

export type FulfilmentOutcome = "ACTIVATED" | "ALREADY_FULFILLED" | "NOT_FULFILLABLE";

export async function fulfilMatchmakingPayment(payment: PaymentRow): Promise<FulfilmentOutcome> {
  if (payment.status !== "SUCCESS" || !payment.verifiedAt || !payment.matchmakingCaseId) return "NOT_FULFILLABLE";
  const caseId = payment.matchmakingCaseId;

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(matchmakingCases).where(eq(matchmakingCases.id, caseId)).for("update");
    if (!current || current.userId !== payment.userId) return { kind: "MISMATCH" as const };
    if (current.paidPaymentId === payment.id) return { kind: "ALREADY" as const, row: current };
    if (current.paidPaymentId || current.status !== "PENDING_PAYMENT") return { kind: "DUPLICATE" as const, row: current };

    const now = new Date();
    const [activated] = await tx
      .update(matchmakingCases)
      .set({
        status: "ACTIVE",
        paidPaymentId: payment.id,
        paidAt: now,
        // The verified payment is the source of truth for what was actually charged.
        priceInPaise: payment.amountInPaise,
        currency: payment.currency,
        includedAccessUntil: new Date(now.getTime() + current.includedMembershipDays * DAY_MS),
        updatedAt: now,
      })
      .where(eq(matchmakingCases.id, caseId))
      .returning();
    await tx.insert(matchmakingCaseEvents).values({
      caseId,
      actorType: "SYSTEM",
      kind: "STATUS_CHANGE",
      fromStatus: "PENDING_PAYMENT",
      toStatus: "ACTIVE",
      note: "Payment verified. Your Personal Matchmaking service has started.",
      customerVisible: true,
      metadata: { paymentId: payment.id },
    });
    return { kind: "ACTIVATED" as const, row: activated };
  });

  if (outcome.kind === "MISMATCH") {
    await record({ actorType: "SYSTEM", action: "matchmaking.payment_case_mismatch", entityType: "payment", entityId: payment.id, metadata: { caseId } });
    return "NOT_FULFILLABLE";
  }
  if (outcome.kind === "DUPLICATE") {
    // A second successful payment for a case that is already paid (or was closed before this payment was captured).
    // Nothing more is granted; the payment is flagged for a Super Admin to refund.
    await record({
      actorType: "SYSTEM",
      action: "matchmaking.duplicate_payment_captured",
      entityType: "payment",
      entityId: payment.id,
      metadata: { caseId, caseStatus: outcome.row.status, paidPaymentId: outcome.row.paidPaymentId },
    });
    return "NOT_FULFILLABLE";
  }

  if (outcome.kind === "ACTIVATED") {
    await record({
      actorType: "SYSTEM",
      action: "matchmaking.case_activated",
      entityType: "matchmaking_case",
      entityId: caseId,
      metadata: { paymentId: payment.id, includedAccessUntil: outcome.row.includedAccessUntil?.toISOString() ?? null },
    });
    await notify({
      userId: payment.userId,
      channel: "IN_APP",
      title: "Personal Matchmaking has started",
      body: "Your payment is verified. Our matchmaking team will review your profile and preferences and share suggestions with you.",
      dedupeKey: `matchmaking_activated:${caseId}`,
    });
  }

  await ensureInvoice(outcome.row, payment);
  return outcome.kind === "ACTIVATED" ? "ACTIVATED" : "ALREADY_FULFILLED";
}

async function ensureInvoice(paidCase: repo.MatchmakingCaseRow, payment: PaymentRow): Promise<void> {
  const staleBefore = new Date(Date.now() - INVOICE_CLAIM_STALE_MS);
  const [claimed] = await db
    .update(matchmakingCases)
    .set({ invoiceClaimedAt: new Date() })
    .where(
      and(
        eq(matchmakingCases.id, paidCase.id),
        eq(matchmakingCases.paidPaymentId, payment.id),
        or(
          isNull(matchmakingCases.invoiceClaimedAt),
          and(lt(matchmakingCases.invoiceClaimedAt, staleBefore), sql`NOT EXISTS (SELECT 1 FROM ${invoices} i WHERE i.payment_id = ${payment.id})`)
        )
      )
    )
    .returning();
  if (!claimed) return; // already issued, or another caller is issuing it right now

  try {
    const [existing] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.paymentId, payment.id)).limit(1);
    if (existing) return;
    const transaction = await paymentsRepo.findLatestTransactionForPayment(payment.id);
    if (!transaction) throw new Error("No transaction recorded for a verified matchmaking payment.");
    await issueInvoice({
      userId: payment.userId,
      payment,
      transaction,
      service: {
        name: MATCHMAKING_SERVICE_NAME,
        code: MATCHMAKING_SERVICE_CODE,
        includedAccessDays: claimed.includedMembershipDays,
        accessFrom: claimed.paidAt,
        accessUntil: claimed.includedAccessUntil,
      },
    });
  } catch (err) {
    // The claim stays; once it is older than INVOICE_CLAIM_STALE_MS a replay or the reconcile job retries.
    logError("matchmaking-invoice-issue-failed", err, { caseId: paidCase.id, paymentId: payment.id });
  }
}

/**
 * A payment that was FULLY refunded (refunds.service.ts, same rule as a membership: only a full refund acts).
 * The case it paid for becomes REFUNDED and closed, its included access ends now, and suggestions that were never
 * sent are withdrawn. Partial refunds change nothing here.
 */
export async function applyMatchmakingFullRefund(payment: PaymentRow): Promise<void> {
  if (!payment.matchmakingCaseId) return;
  const caseId = payment.matchmakingCaseId;
  const changed = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(matchmakingCases).where(eq(matchmakingCases.id, caseId)).for("update");
    if (!current || current.paidPaymentId !== payment.id || current.status === "REFUNDED") return null;
    const now = new Date();
    const [refunded] = await tx
      .update(matchmakingCases)
      .set({ status: "REFUNDED", includedAccessRevokedAt: now, closedAt: current.closedAt ?? now, updatedAt: now })
      .where(eq(matchmakingCases.id, caseId))
      .returning();
    await tx
      .update(matchmakingSuggestions)
      .set({ status: "WITHDRAWN", withdrawnAt: now, updatedAt: now })
      .where(and(eq(matchmakingSuggestions.caseId, caseId), sql`${matchmakingSuggestions.status} IN ('PROPOSED', 'APPROVED')`));
    await tx.insert(matchmakingCaseEvents).values({
      caseId,
      actorType: "SYSTEM",
      kind: "STATUS_CHANGE",
      fromStatus: current.status,
      toStatus: "REFUNDED",
      note: "Your payment was refunded in full, so the service and its included member access have ended.",
      customerVisible: true,
      metadata: { paymentId: payment.id },
    });
    return { from: current.status, refunded };
  });
  if (!changed) return;
  await record({
    actorType: "SYSTEM",
    action: "matchmaking.case_refunded",
    entityType: "matchmaking_case",
    entityId: caseId,
    metadata: { paymentId: payment.id, fromStatus: changed.from },
  });
}
