/**
 * PCP sections A/I — payment reconciliation and account-deletion finalisation jobs.
 *
 * payment-reconcile
 *   1. PENDING payments older than PAYMENT_RECONCILE_MIN_AGE (10 min) are re-read from the
 *      gateway (recovers a missed webhook / abandoned redirect). SUCCESS goes through the
 *      exact same race-safe verify path as the member flow and webhooks.
 *   2. A payment still PENDING at the gateway after PAYMENT_PENDING_EXPIRY_MINUTES (default
 *      60) is closed as FAILED. Money safety: a payment is NEVER closed if the gateway could
 *      not be asked (outage / timeout) — only on a positive "not paid" answer, or when it
 *      was never handed a gateway order at all.
 *   3. PENDING refunds are re-read from the gateway (syncRefund).
 *   4. Payments closed as FAILED in the last 3 days are checked for a late capture and
 *      flagged once for manual review (audit action payment.late_capture_detected).
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { logError } from "@/server/lib/logger";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as paymentsRepo from "@/server/modules/payments/payments.repository";
import * as pcpRepo from "@/server/modules/payments/payments-pcp.repository";
import { reconcilePaymentFromGateway } from "@/server/modules/payments/webhooks.service";
import { syncRefund } from "@/server/modules/payments/refunds.service";
import { fulfilMatchmakingPayment } from "@/server/modules/matchmaking/matchmaking-fulfilment";
import { listPaidPaymentsAwaitingFulfilment } from "@/server/modules/matchmaking/matchmaking.repository";
import { finalizeExpiredDeletions } from "@/server/modules/account/account-deletion.service";
import type { JobDefinition } from "../types";

const RECONCILE_MIN_AGE_MINUTES = 10;
const MAX_PER_RUN = 200;

export function paymentExpiryMinutes(): number {
  return getEnv().PAYMENT_PENDING_EXPIRY_MINUTES ?? 60;
}

async function closeStalePayment(payment: paymentsRepo.PaymentRow): Promise<boolean> {
  const closed = await paymentsRepo.resolvePaymentOutcome(payment.id, { status: "FAILED", verifiedAt: null, verificationMethod: null });
  if (!closed) return false; // someone else resolved it first — fine
  const txn = await paymentsRepo.findLatestTransactionForPayment(payment.id);
  if (txn && txn.status === "PENDING") {
    await paymentsRepo.resolveTransactionOutcome(txn.id, {
      status: "FAILED",
      gatewayTransactionId: txn.gatewayTransactionId ?? null,
      rawResponse: { closedBy: "payment-reconcile", reason: "expired_unpaid" },
    });
  }
  await record({
    actorType: "SYSTEM",
    action: "payment.expired_unpaid",
    entityType: "payment",
    entityId: payment.id,
    metadata: { amountInPaise: payment.amountInPaise, expiryMinutes: paymentExpiryMinutes() },
  });
  await notify({
    userId: payment.userId,
    channel: "IN_APP",
    title: "Payment not completed",
    body: payment.matchmakingCaseId
      ? "Your Personal Matchmaking payment was not completed in time and has been closed. You can try again from the Personal Matchmaking page."
      : "Your membership payment was not completed in time and has been closed. You can try again from Membership plans.",
    dedupeKey: `payment_failed:${payment.id}`,
  });
  return true;
}

export const paymentReconcileJob: JobDefinition = {
  name: "payment-reconcile",
  description: "Re-reads stale PENDING payments and refunds from the gateway, closes unpaid expired orders, and flags late captures for review.",
  suggestedSchedule: "*/10 * * * *",
  async run() {
    const expiryMs = paymentExpiryMinutes() * 60_000;
    const stats = { checked: 0, resolved: 0, expiredClosed: 0, stillPending: 0, gatewayErrors: 0, refundsChecked: 0, refundsResolved: 0, lateCaptureChecked: 0, matchmakingFulfilled: 0 };

    // 1 + 2 -----------------------------------------------------------------
    const pending = await pcpRepo.listPendingOlderThan(new Date(Date.now() - RECONCILE_MIN_AGE_MINUTES * 60_000), MAX_PER_RUN);
    for (const payment of pending) {
      stats.checked++;
      const expired = Date.now() - payment.createdAt.getTime() >= expiryMs;
      try {
        if (!payment.gatewayReference) {
          // Never handed a gateway order — nothing can have been paid.
          if (expired && (await closeStalePayment(payment))) stats.expiredClosed++;
          else stats.stillPending++;
          continue;
        }
        const { status } = await reconcilePaymentFromGateway(payment);
        if (status === "PENDING") {
          if (expired && (await closeStalePayment(payment))) stats.expiredClosed++;
          else stats.stillPending++;
        } else {
          stats.resolved++;
        }
      } catch (err) {
        // Gateway unreachable / error: leave the payment untouched (it may well be paid).
        stats.gatewayErrors++;
        logError("job-payment-reconcile-item", err, { paymentId: payment.id });
      }
    }

    // 2b: a verified Personal Matchmaking payment whose (idempotent) fulfilment was interrupted is completed here.
    for (const paymentId of await listPaidPaymentsAwaitingFulfilment()) {
      try {
        const paid = await paymentsRepo.findById(paymentId);
        if (paid && (await fulfilMatchmakingPayment(paid)) === "ACTIVATED") stats.matchmakingFulfilled++;
      } catch (err) {
        logError("job-payment-reconcile-matchmaking", err, { paymentId });
      }
    }

    // 3 ---------------------------------------------------------------------
    const refunds = await db.execute(
      sql`SELECT id FROM payment_refunds WHERE status = 'PENDING' AND created_at < now() - interval '5 minutes' ORDER BY created_at LIMIT ${MAX_PER_RUN}`
    );
    for (const r of refunds.rows as unknown as Array<{ id: string }>) {
      stats.refundsChecked++;
      try {
        const updated = await syncRefund(r.id);
        if (updated.status !== "PENDING") stats.refundsResolved++;
      } catch (err) {
        stats.gatewayErrors++;
        logError("job-payment-reconcile-refund", err, { refundId: r.id });
      }
    }

    // 4 ---------------------------------------------------------------------
    // Throttled to once an hour (a previous run that checked something in the last hour
    // makes this run skip the step) so a closed payment is not re-queried every cycle.
    const recentCheck = await db.execute(sql`
      SELECT 1 FROM job_runs
      WHERE job_name = 'payment-reconcile' AND status = 'SUCCEEDED' AND started_at > now() - interval '1 hour'
        AND COALESCE((stats->>'lateCaptureChecked')::int, 0) > 0
      LIMIT 1`);
    if (recentCheck.rows.length === 0) {
      const failed = await db.execute(sql`
        SELECT p.id FROM payments p
        WHERE p.status = 'FAILED' AND p.gateway_reference IS NOT NULL AND p.updated_at > now() - interval '3 days'
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs a WHERE a.action = 'payment.late_capture_detected' AND a.entity_type = 'payment' AND a.entity_id = p.id
          )
        ORDER BY p.updated_at DESC LIMIT 50`);
      for (const row of failed.rows as unknown as Array<{ id: string }>) {
        stats.lateCaptureChecked++;
        try {
          const payment = await paymentsRepo.findById(row.id);
          if (payment) await reconcilePaymentFromGateway(payment);
        } catch (err) {
          stats.gatewayErrors++;
          logError("job-payment-reconcile-late-capture", err, { paymentId: row.id });
        }
      }
    }
    return stats;
  },
};

export const accountDeletionFinalizeJob: JobDefinition = {
  name: "account-deletion-finalize",
  description: "Anonymises accounts whose recovery window has passed and removes their photos (accounts in DELETED_PENDING for longer than ACCOUNT_RECOVERY_WINDOW_DAYS).",
  suggestedSchedule: "30 2 * * *",
  async run() {
    const r = await finalizeExpiredDeletions(MAX_PER_RUN);
    return { finalized: r.finalized, failed: r.failed, photosRemoved: r.photosRemoved };
  },
};
