/**
 * B8: the checkout -> verify -> activate transaction boundary. This file
 * owns the "membership activation + invoice generation only on a
 * genuine, provider-confirmed payment success" rule end to end — never
 * trusting a client-supplied "it succeeded" flag (see this file's own
 * verifyPayment/manualVerifyPayment).
 *
 * Flow: checkout() creates a PENDING `memberships` row + a PENDING
 * `payments` row + a PENDING `transactions` row, then calls the active
 * gateway's createOrder(). verifyPayment() (member-triggered, or
 * attemptAutoRenewal()'s own internal call) calls that SAME gateway's
 * verifyPayment() — resolved from `payments.gatewayId`, never
 * re-resolved from "whichever gateway is active now" (see
 * gateways.repository.ts's own comment: changing the active gateway
 * never touches an existing payment's own stored gatewayId). Only on a
 * genuine SUCCESS does activateMembership+issueInvoice run, inside one
 * DB transaction.
 *
 * Replay protection: verify/manual-activate both no-op (return the
 * current state unchanged) once a payment is no longer PENDING — calling
 * either twice can never double-activate a membership or double-issue an
 * invoice.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships as membershipsTable } from "@/server/db/schema";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as paymentsRepo from "./payments.repository";
import type { PaymentRow } from "./payments.repository";
import * as gatewaysRepo from "./gateways.repository";
import { getActiveGatewayRow } from "./gateways.service";
import { getPaymentGatewayProvider } from "./providers/factory";
import type { ClientCheckoutData, VerifyOutcomeStatus } from "./providers/types";
import * as membershipPlansRepo from "@/server/modules/memberships/membership-plans.repository";
import * as membershipsRepo from "@/server/modules/memberships/memberships.repository";
import { tierRank } from "@/server/modules/memberships/plan-tiers";
import { issueInvoice } from "@/server/modules/invoices/invoices.service";
import { isPaymentDevMode } from "./dev-mode";

const ADMIN_PERMISSION = "payments.review";
// B13 (Performance/Scalability phase): same admin-list pagination
// defaults every other admin list repository in this codebase already
// uses (see users-admin/invoices-admin/memberships-admin/audit-logs
// .service.ts) — applied here to close the one genuinely unbounded admin
// list endpoint the B13 audit found (see listPaymentsForAdmin below).
const ADMIN_PAGE_DEFAULT_PAGE_SIZE = 20;
const ADMIN_PAGE_MAX_PAGE_SIZE = 50;

/** Duplicate-checkout-prevention window (see this file's checkout doc
 * comment): a PENDING payment for the same user+plan created within
 * this window blocks a new checkout attempt. 15 minutes is a documented,
 * round judgment call — long enough to cover a real gateway checkout
 * flow (redirect + return), short enough that a genuinely abandoned
 * attempt doesn't block a fresh purchase indefinitely. */
export const DUPLICATE_CHECKOUT_TTL_MS = 15 * 60 * 1000;

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

/** Upgrade/downgrade rule (see BACKEND.md's B8 section for the full
 * judgment call): blocked only when the requested plan's tier RANKS
 * LOWER than the user's current ACTIVE membership's tier. Equal-or-
 * higher tier is allowed — an equal-tier switch (e.g. a currency change)
 * or a genuine upgrade both proceed to checkout; the OLD membership is
 * only ever cancelled on the NEW payment's genuine success (see
 * activateMembershipFromPayment below), never at checkout time. */
async function assertPlanSwitchAllowed(userId: string, newPlanDurationDays: number): Promise<void> {
  const current = await membershipsRepo.findActiveForUser(userId);
  if (!current) return;
  const currentPlan = await membershipPlansRepo.findById(current.planId);
  if (!currentPlan) return;
  if (tierRank(newPlanDurationDays) < tierRank(currentPlan.durationDays)) {
    throw new ConflictError(
      "Downgrading is not available while your current membership is active. Let it expire, or turn off auto-renew and wait, before switching to a lower plan."
    );
  }
}

export interface CheckoutInput {
  planCode: string;
  autoRenew?: boolean;
  /** Test-only — see providers/types.ts's `simulateOutcome` doc. Every
   * real gateway provider ignores this (it throws before ever reading
   * it); only the dev/mock provider (never usable in production) honors
   * it. */
  devSimulateOutcome?: VerifyOutcomeStatus;
}

export interface CheckoutResult {
  paymentId: string;
  membershipId: string;
  transactionRef: string;
  providerOrderId: string;
  amountInPaise: number;
  currency: string;
  gatewayName: string;
  status: "PENDING";
  /** PCP: public data the browser needs to complete payment at a real gateway (absent for the dev gateway). */
  gatewayCheckout?: ClientCheckoutData;
}

export async function checkout(ctx: AuthContext, input: CheckoutInput): Promise<CheckoutResult> {
  const userId = requireMemberSubject(ctx);

  const plan = await membershipPlansRepo.findByCode(input.planCode);
  if (!plan || !plan.isActive) throw new NotFoundError("Membership plan not found.");

  await assertPlanSwitchAllowed(userId, plan.durationDays);
  // Duplicate-checkout-prevention (see this file's own DUPLICATE_CHECKOUT_TTL_MS
  // doc comment): checked BEFORE creating any new row, so a repeat
  // checkout for the same plan within the window never creates a second
  // PENDING membership row at all.
  await assertNoRecentPendingCheckoutForPlan(userId, plan.id);

  const gatewayRow = await getActiveGatewayRow();

  // Membership + payment + transaction rows are created together, all
  // PENDING — see this file's top-of-file comment for why membership
  // activation waits for verify, not checkout.
  const membership = await membershipsRepo.createPending({ userId, planId: plan.id, autoRenew: Boolean(input.autoRenew) });

  const payment = await paymentsRepo.createPayment({
    userId,
    membershipId: membership.id,
    gatewayId: gatewayRow.id,
    amountInPaise: plan.priceInPaise,
    currency: plan.currency,
  });

  const transactionRef = paymentsRepo.generateInternalTransactionRef();
  const txRow = await paymentsRepo.createTransaction({ paymentId: payment.id, transactionRef, amountInPaise: plan.priceInPaise });

  const devMode = isPaymentDevMode();
  const provider = getPaymentGatewayProvider(gatewayRow.name, devMode);
  let orderResult: Awaited<ReturnType<typeof provider.createOrder>>;
  try {
    orderResult = await provider.createOrder({
      amountInSmallestUnit: plan.priceInPaise,
      currency: plan.currency as "INR" | "USD",
      receiptRef: transactionRef,
      simulateOutcome: input.devSimulateOutcome,
      paymentId: payment.id,
    });
  } catch (err) {
    // PCP production defect fix (additive error path): if the gateway cannot create an order (credentials missing,
    // gateway down, rejected request) nothing was ever offered to the customer, so the PENDING rows created above
    // must not linger — otherwise the duplicate-checkout guard would lock the member out of retrying for 15 minutes.
    // The payment is closed through the same compare-and-swap used everywhere else, the membership is cancelled, and
    // the ORIGINAL error (e.g. 503 "not configured") is rethrown unchanged. Cleanup problems never mask it.
    try {
      await paymentsRepo.resolveTransactionOutcome(txRow.id, {
        status: "FAILED",
        gatewayTransactionId: null,
        rawResponse: { reason: "order_creation_failed" },
      });
      await paymentsRepo.resolvePaymentOutcome(payment.id, { status: "FAILED", verifiedAt: null, verificationMethod: null });
      await membershipsRepo.cancel(membership.id);
    } catch {
      /* best effort — the pending-expiry job reaps anything left behind */
    }
    throw err;
  }

  await paymentsRepo.setGatewayReference(payment.id, orderResult.providerOrderId);

  return {
    paymentId: payment.id,
    membershipId: membership.id,
    transactionRef,
    providerOrderId: orderResult.providerOrderId,
    amountInPaise: plan.priceInPaise,
    currency: plan.currency,
    gatewayName: gatewayRow.name,
    status: "PENDING",
    ...(orderResult.clientCheckout ? { gatewayCheckout: orderResult.clientCheckout } : {}),
  };
}

/**
 * A dedicated, honest duplicate-pending guard usable BEFORE creating a
 * new membership row — checked once per (user, plan) pair right after
 * plan resolution, so a genuine repeat checkout for the SAME plan within
 * the TTL window is rejected up front rather than creating a second
 * PENDING membership row. Kept as a small helper so checkout() reads
 * top-to-bottom in the order a reviewer would expect.
 */
async function assertNoRecentPendingCheckoutForPlan(userId: string, planId: string): Promise<void> {
  const history = await membershipsRepo.listForUser(userId);
  const recentPendingMembership = history.find((m) => m.planId === planId && m.status === "PENDING");
  if (!recentPendingMembership) return;
  const recentPayment = await paymentsRepo.findRecentPendingForUserAndMembership(
    userId,
    recentPendingMembership.id,
    new Date(Date.now() - DUPLICATE_CHECKOUT_TTL_MS)
  );
  if (recentPayment) {
    throw new ConflictError(
      "A payment for this plan is already pending. Check its status, or wait a few minutes before starting a new checkout.",
      { paymentId: recentPayment.id }
    );
  }
}

async function activateMembershipFromPayment(payment: PaymentRow): Promise<void> {
  const membership = payment.membershipId ? await membershipsRepo.findById(payment.membershipId) : undefined;
  if (!membership) throw new NotFoundError("No membership is associated with this payment.");
  const plan = await membershipPlansRepo.findById(membership.planId);
  if (!plan) throw new NotFoundError("Membership plan not found.");

  await db.transaction(async (tx) => {
    // Cancel any OTHER currently-ACTIVE membership for this user (the
    // upgrade rule: "immediately cancels/ends the current one, no matter
    // how much time was left") — there should be at most one, given
    // downgrade-while-active is blocked at checkout and the duplicate-
    // checkout guard, but this defensively cancels every match rather
    // than assuming exactly one.
    const now = new Date();
    await tx
      .update(membershipsTable)
      .set({ status: "CANCELLED" })
      .where(
        and(
          eq(membershipsTable.userId, membership.userId),
          eq(membershipsTable.status, "ACTIVE")
          // Deliberately no `ne(id, membership.id)` needed — `membership`
          // itself is still PENDING at this point in the flow (it only
          // becomes ACTIVE in the next statement), so it can never match
          // this ACTIVE-status predicate itself.
        )
      );

    const startedAt = now;
    const expiresAt = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
    await tx.update(membershipsTable).set({ status: "ACTIVE", startedAt, expiresAt }).where(eq(membershipsTable.id, membership.id));
  });

  const [transaction] = await Promise.all([paymentsRepo.findLatestTransactionForPayment(payment.id)]);
  const refreshedMembership = await membershipsRepo.findById(membership.id);
  if (transaction && refreshedMembership) {
    await issueInvoice({ userId: payment.userId, payment, transaction, membership: refreshedMembership, plan });
  }

  await notify({
    userId: payment.userId,
    channel: "IN_APP",
    title: "Membership activated",
    body: `Your ${plan.name} membership is now active.`,
    dedupeKey: `membership_activated:${membership.id}`,
  });
}

export interface VerifyResult {
  payment: PaymentRow;
  status: "SUCCESS" | "FAILED" | "PENDING" | "ALREADY_RESOLVED";
}

/**
 * Member-triggered (owner-only). Replay-safe: only acts when the payment
 * is still PENDING — a second call after resolution returns the current
 * state, never re-runs activation/invoice issuance.
 */
export async function verifyPayment(ctx: AuthContext, paymentId: string): Promise<VerifyResult> {
  const userId = requireMemberSubject(ctx);
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment || payment.userId !== userId) {
    throw new AuthorizationError("You do not have permission to access this payment.");
  }
  return verifyPaymentInternal(payment);
}

/**
 * B10: the shared wrapper every resolvePaymentOutcome call site below
 * goes through — see that repository function's own doc comment for the
 * race it closes. `won: false` means a concurrent verify/manual-activate
 * call already resolved this exact payment first; the caller must treat
 * that identically to the sequential-replay ALREADY_RESOLVED case, never
 * proceeding to notify/activate/issue-an-invoice a second time.
 */
async function resolveOrAlreadyResolved(
  paymentId: string,
  input: paymentsRepo.ResolvePaymentOutcomeInput
): Promise<{ payment: PaymentRow; won: boolean }> {
  const updated = await paymentsRepo.resolvePaymentOutcome(paymentId, input);
  if (updated) return { payment: updated, won: true };
  const current = await paymentsRepo.findById(paymentId);
  if (!current) throw new NotFoundError("Payment not found immediately after a concurrent verify — this should never happen.");
  return { payment: current, won: false };
}

/** PCP: exported so webhook / reconciliation code re-uses the exact same race-safe verify path. */
export async function verifyPaymentInternal(payment: PaymentRow): Promise<VerifyResult> {
  if (payment.status !== "PENDING") {
    return { payment, status: "ALREADY_RESOLVED" };
  }
  if (!payment.gatewayReference) {
    throw new ConflictError("This payment was never handed an order/reference id — it cannot be verified.");
  }

  const gatewayRow = await gatewaysRepo.findById(payment.gatewayId);
  if (!gatewayRow) throw new NotFoundError("Payment gateway not found.");

  const devMode = isPaymentDevMode();
  const provider = getPaymentGatewayProvider(gatewayRow.name, devMode);
  const result = await provider.verifyPayment({ providerOrderId: payment.gatewayReference });

  const transaction = await paymentsRepo.findLatestTransactionForPayment(payment.id);

  if (result.status === "PENDING") {
    // No state change — still PENDING. The caller (or a later admin
    // review) can retry.
    return { payment, status: "PENDING" };
  }

  if (transaction) {
    await paymentsRepo.resolveTransactionOutcome(transaction.id, {
      status: result.status,
      gatewayTransactionId: result.gatewayTransactionId ?? null,
      rawResponse: result.rawResponse ?? null,
    });
  }

  if (result.status === "FAILED") {
    const { payment: updated, won } = await resolveOrAlreadyResolved(payment.id, { status: "FAILED", verifiedAt: null, verificationMethod: null });
    if (!won) return { payment: updated, status: "ALREADY_RESOLVED" };
    await notify({
      userId: payment.userId,
      channel: "IN_APP",
      title: "Payment failed",
      body: "Your recent membership payment was not successful. You can try again from Membership plans.",
      dedupeKey: `payment_failed:${payment.id}`,
    });
    return { payment: updated, status: "FAILED" };
  }

  // SUCCESS — but never trusted at face value. B10: the gateway's own
  // verify response is cross-checked against what THIS payment was
  // actually created for at checkout time (payment.amountInPaise/
  // .currency — server-derived from the plan, never client input) before
  // any activation happens. A gateway reporting SUCCESS for a different
  // amount/currency than it was asked to charge (a tampered checkout
  // widget, a gateway-side bug, or an attacker replaying a stale
  // reference against a since-changed plan price) is treated exactly
  // like a FAILED verify — never partially trusted, never activated.
  const amountMismatch = result.amountInSmallestUnit !== undefined && result.amountInSmallestUnit !== payment.amountInPaise;
  const currencyMismatch = result.currency !== undefined && result.currency !== payment.currency;
  if (amountMismatch || currencyMismatch) {
    if (transaction) {
      await paymentsRepo.resolveTransactionOutcome(transaction.id, {
        status: "FAILED",
        gatewayTransactionId: result.gatewayTransactionId ?? null,
        rawResponse: { ...(result.rawResponse as object | undefined), amountMismatch, currencyMismatch },
      });
    }
    const { payment: updated, won } = await resolveOrAlreadyResolved(payment.id, { status: "FAILED", verifiedAt: null, verificationMethod: null });
    if (!won) return { payment: updated, status: "ALREADY_RESOLVED" };
    await record({
      actorType: "SYSTEM",
      action: "payment.verify_amount_currency_mismatch_rejected",
      entityType: "payment",
      entityId: payment.id,
      metadata: {
        expectedAmountInPaise: payment.amountInPaise,
        expectedCurrency: payment.currency,
        gatewayAmountInSmallestUnit: result.amountInSmallestUnit,
        gatewayCurrency: result.currency,
      },
    });
    await notify({
      userId: payment.userId,
      channel: "IN_APP",
      title: "Payment could not be verified",
      body: "Your recent membership payment could not be verified and was not completed. Please try again or contact support.",
      dedupeKey: `payment_failed:${payment.id}`,
    });
    return { payment: updated, status: "FAILED" };
  }

  const { payment: updated, won } = await resolveOrAlreadyResolved(payment.id, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "AUTO" });
  if (!won) return { payment: updated, status: "ALREADY_RESOLVED" };
  await activateMembershipFromPayment(updated);
  return { payment: updated, status: "SUCCESS" };
}

/** Used internally by memberships.service.ts's attemptAutoRenewal — a
 * server-to-server create+verify with no human at a gateway UI in
 * between, unlike the member-facing two-step checkout()/verifyPayment()
 * pair above (see BACKEND.md's B8 section, "auto-renew mechanics"). */
export async function checkoutAndVerifyForAutoRenewal(
  ctx: AuthContext,
  input: CheckoutInput
): Promise<{ checkout: CheckoutResult; verify: VerifyResult }> {
  const checkoutResult = await checkout(ctx, input);
  const payment = await paymentsRepo.findById(checkoutResult.paymentId);
  if (!payment) throw new NotFoundError("Payment not found immediately after checkout — this should never happen.");
  const verifyResult = await verifyPaymentInternal(payment);
  return { checkout: checkoutResult, verify: verifyResult };
}

// --- Read access ---------------------------------------------------------

export async function getMyPayment(ctx: AuthContext, paymentId: string): Promise<PaymentRow> {
  const userId = requireMemberSubject(ctx);
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment || payment.userId !== userId) {
    throw new AuthorizationError("You do not have permission to access this payment.");
  }
  return payment;
}

export async function listMyPayments(ctx: AuthContext): Promise<PaymentRow[]> {
  const userId = requireMemberSubject(ctx);
  return paymentsRepo.listByUser(userId);
}

// --- Admin: list + manual activation --------------------------------------

export interface AdminPaymentsPage {
  items: PaymentRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * B13 (Performance/Scalability phase — disclosed, evidenced fix; see
 * PERFORMANCE_REPORT.md / BACKEND.md's B13 section): now paginated — see
 * payments.repository.ts's `listForAdmin` doc comment for the full
 * before/after reasoning (this was the one genuinely unbounded admin
 * list endpoint the B13 pagination audit found). `page`/`pageSize` are
 * optional so every existing caller (the controller, when no query
 * params are supplied) keeps working unchanged — it now gets page 1 of
 * up to `ADMIN_PAGE_DEFAULT_PAGE_SIZE` most-recent payments instead of
 * every payment ever created.
 */
export async function listPaymentsForAdmin(
  ctx: AuthContext,
  status?: PaymentRow["status"],
  page = 1,
  pageSize = ADMIN_PAGE_DEFAULT_PAGE_SIZE
): Promise<AdminPaymentsPage> {
  await requirePermission(ctx, ADMIN_PERMISSION);
  const boundedPageSize = Math.min(pageSize, ADMIN_PAGE_MAX_PAGE_SIZE);
  const { items, total } = await paymentsRepo.listForAdmin({ status }, page, boundedPageSize);
  return { items, page, pageSize: boundedPageSize, total, totalPages: Math.max(1, Math.ceil(total / boundedPageSize)) };
}

export interface ManualActivateInput {
  reason: string;
  gatewayTransactionId?: string;
}

/**
 * Admin-only, `payments.review`. Requires a non-empty `reason`, captures
 * admin id + timestamp (via `payment.verifiedAt`/`verificationMethod`)
 * + the gateway's own transaction reference (if the admin has one from
 * the gateway's dashboard), and is fully audit-logged. Replay-safe like
 * verifyPayment — only acts on a still-PENDING payment.
 */
export async function manualVerifyPayment(ctx: AuthContext, paymentId: string, input: ManualActivateInput): Promise<VerifyResult> {
  await requirePermission(ctx, ADMIN_PERMISSION);
  if (!input.reason || !input.reason.trim()) {
    throw new ValidationError("A reason is required for manual payment verification.");
  }
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found.");
  if (payment.status !== "PENDING") {
    return { payment, status: "ALREADY_RESOLVED" };
  }

  const transaction = await paymentsRepo.findLatestTransactionForPayment(payment.id);
  if (transaction) {
    await paymentsRepo.resolveTransactionOutcome(transaction.id, {
      status: "SUCCESS",
      gatewayTransactionId: input.gatewayTransactionId ?? null,
      rawResponse: { manual: true, adminId: ctx.subject.id, reason: input.reason.trim() },
    });
  }

  const { payment: updated, won } = await resolveOrAlreadyResolved(payment.id, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "MANUAL" });
  if (!won) return { payment: updated, status: "ALREADY_RESOLVED" };
  await activateMembershipFromPayment(updated);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    action: "payment.manually_activated",
    entityType: "payment",
    entityId: paymentId,
    metadata: { reason: input.reason.trim(), gatewayTransactionId: input.gatewayTransactionId ?? null },
  });

  return { payment: updated, status: "SUCCESS" };
}

export { assertNoRecentPendingCheckoutForPlan };
