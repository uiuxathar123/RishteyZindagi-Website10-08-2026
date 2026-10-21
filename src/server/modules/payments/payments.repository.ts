/**
 * B8: data access for `payments` and `transactions` — B1 schema-only
 * foundation (never written by any code through B7) that this phase
 * turns into a real checkout/verify lifecycle.
 *
 * Three-id modeling (see schema.ts's own comments on these columns for
 * the full rationale): `transactions.transactionRef` is the INTERNAL
 * transaction id (generated here, unique); `payments.gatewayReference`
 * is the ORDER/REFERENCE id handed to the gateway at checkout;
 * `transactions.gatewayTransactionId` is the GATEWAY's own transaction
 * id, set only once a verify attempt has actually run.
 */
import { randomUUID } from "crypto";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { payments, transactions } from "@/server/db/schema";

/** The shared client, or a transaction from db.transaction(...), so a caller can create rows inside its own transaction. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PaymentRow = typeof payments.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type PaymentStatus = PaymentRow["status"];

export function generateInternalTransactionRef(): string {
  return `TXN-${randomUUID()}`;
}

/** A payment is for exactly one purchase: a membership, or a Personal Matchmaking case (DB check constraint too). */
export type PaymentPurpose = { membershipId: string; matchmakingCaseId?: undefined } | { matchmakingCaseId: string; membershipId?: undefined };

export type CreatePaymentInput = PaymentPurpose & {
  userId: string;
  gatewayId: string;
  amountInPaise: number;
  currency: string;
};

export async function createPayment(input: CreatePaymentInput, exec: DbExecutor = db): Promise<PaymentRow> {
  const [row] = await exec
    .insert(payments)
    .values({
      userId: input.userId,
      membershipId: input.membershipId ?? null,
      matchmakingCaseId: input.matchmakingCaseId ?? null,
      gatewayId: input.gatewayId,
      amountInPaise: input.amountInPaise,
      currency: input.currency,
      status: "PENDING",
    })
    .returning();
  return row;
}

export async function setGatewayReference(paymentId: string, gatewayReference: string): Promise<PaymentRow> {
  const [row] = await db
    .update(payments)
    .set({ gatewayReference, updatedAt: new Date() })
    .where(eq(payments.id, paymentId))
    .returning();
  return row;
}

export async function findById(id: string): Promise<PaymentRow | undefined> {
  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return row;
}

export interface ResolvePaymentOutcomeInput {
  status: PaymentStatus;
  verifiedAt: Date | null;
  verificationMethod: "AUTO" | "MANUAL" | null;
}

/**
 * B10: guarded by `AND status = 'PENDING'` — a genuine compare-and-swap,
 * not a plain unconditional update. Every existing caller (see
 * payments.service.ts's verifyPaymentInternal/manualVerifyPayment) only
 * ever reaches this after already confirming the payment was PENDING,
 * so this is a no-op change for the normal, non-racing path — it exists
 * to close a TOCTOU race: without it, two genuinely concurrent verify
 * calls on the same payment could BOTH read status="PENDING" before
 * either writes, and both would then proceed to activate the membership
 * and issue a SECOND invoice for the same payment (see
 * activateMembershipFromPayment's own call site). Returns `undefined`
 * when a concurrent call already won that race — the caller treats that
 * exactly like the sequential-replay case (ALREADY_RESOLVED), never
 * re-running activation/invoice issuance a second time. */
export async function resolvePaymentOutcome(paymentId: string, input: ResolvePaymentOutcomeInput): Promise<PaymentRow | undefined> {
  const [row] = await db
    .update(payments)
    .set({ status: input.status, verifiedAt: input.verifiedAt, verificationMethod: input.verificationMethod, updatedAt: new Date() })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "PENDING")))
    .returning();
  return row;
}

export async function listByUser(userId: string): Promise<PaymentRow[]> {
  return db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt));
}

/**
 * B13 (Performance/Scalability phase — disclosed, evidenced fix; see
 * PERFORMANCE_REPORT.md / BACKEND.md's B13 section for the full
 * before/after evidence): the paginated replacement for the old
 * `listByStatus`/`listAll` below, which this function supersedes (both
 * had exactly one caller — payments.service.ts's `listPaymentsForAdmin`
 * — confirmed by direct inspection before this change; no other caller
 * exists to break). The old functions fetched EVERY payment row
 * platform-wide with no `LIMIT`/`OFFSET` at all — the one genuinely
 * UNBOUNDED admin list endpoint found in the B13 pagination audit (every
 * other admin list — users, invoices, memberships, audit logs — was
 * already paginated; see users-admin/invoices-admin/memberships-admin/
 * audit-logs .repository.ts). This mirrors their exact shape: `{ items,
 * total }`, `desc(createdAt)` + `desc(id)` stable-ordering tiebreaker
 * (same pagination-drift fix as chat.repository.ts's listMessages —
 * see its own doc comment), `Promise.all([rows, count])`.
 */
export async function listForAdmin(
  filter: { status?: PaymentStatus },
  page: number,
  pageSize: number
): Promise<{ items: PaymentRow[]; total: number }> {
  const whereClause = filter.status ? eq(payments.status, filter.status) : undefined;
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(payments)
      .where(whereClause)
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: count() }).from(payments).where(whereClause),
  ]);
  return { items, total: Number(countRows[0]?.c ?? 0) };
}

/** Duplicate-checkout-prevention (see payments.service.ts's checkout doc
 * comment for the TTL judgment call): a PENDING payment for this exact
 * user+membership created within the window blocks a new checkout for
 * the same membership row's plan. Joins through `memberships` since
 * `payments` itself has no `planId` column — a payment's plan is always
 * reached via its `membershipId`. */
export async function findRecentPendingForUserAndMembership(userId: string, membershipId: string, since: Date): Promise<PaymentRow | undefined> {
  const [row] = await db
    .select()
    .from(payments)
    .where(
      and(eq(payments.userId, userId), eq(payments.membershipId, membershipId), eq(payments.status, "PENDING"), gt(payments.createdAt, since))
    )
    .limit(1);
  return row;
}

// --- Transactions ------------------------------------------------------

export interface CreateTransactionInput {
  paymentId: string;
  transactionRef: string;
  amountInPaise: number;
}

export async function createTransaction(input: CreateTransactionInput, exec: DbExecutor = db): Promise<TransactionRow> {
  const [row] = await exec
    .insert(transactions)
    .values({ paymentId: input.paymentId, transactionRef: input.transactionRef, amountInPaise: input.amountInPaise, status: "PENDING" })
    .returning();
  return row;
}

export async function findLatestTransactionForPayment(paymentId: string): Promise<TransactionRow | undefined> {
  const [row] = await db.select().from(transactions).where(eq(transactions.paymentId, paymentId)).orderBy(desc(transactions.createdAt)).limit(1);
  return row;
}

export interface ResolveTransactionOutcomeInput {
  status: PaymentStatus;
  gatewayTransactionId: string | null;
  rawResponse: unknown;
}

export async function resolveTransactionOutcome(transactionId: string, input: ResolveTransactionOutcomeInput): Promise<TransactionRow> {
  const [row] = await db
    .update(transactions)
    .set({ status: input.status, gatewayTransactionId: input.gatewayTransactionId, rawResponse: input.rawResponse as object })
    .where(eq(transactions.id, transactionId))
    .returning();
  return row;
}
