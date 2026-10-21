/** Data access for Personal Matchmaking cases, suggestions and case events. No business rules here. */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { matchmakingCaseEvents, matchmakingCases, matchmakingSuggestions, payments, users } from "@/server/db/schema";

export type MatchmakingCaseRow = typeof matchmakingCases.$inferSelect;
export type MatchmakingSuggestionRow = typeof matchmakingSuggestions.$inferSelect;
export type MatchmakingCaseEventRow = typeof matchmakingCaseEvents.$inferSelect;

export const CASE_STATUSES = ["PENDING_PAYMENT", "ACTIVE", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REFUNDED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const OPEN_CASE_STATUSES: CaseStatus[] = ["PENDING_PAYMENT", "ACTIVE", "IN_PROGRESS"];
/** A paid case whose service is (or was) running — the only states in which suggestions are worked on or shown. */
export const SERVICE_CASE_STATUSES: CaseStatus[] = ["ACTIVE", "IN_PROGRESS", "COMPLETED"];

export const SUGGESTION_STATUSES = ["PROPOSED", "APPROVED", "SENT", "WITHDRAWN"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const SUGGESTION_RESPONSES = ["PENDING", "INTERESTED", "NOT_INTERESTED"] as const;
export type SuggestionResponse = (typeof SUGGESTION_RESPONSES)[number];

export type CaseEventInput = Omit<typeof matchmakingCaseEvents.$inferInsert, "id" | "createdAt">;

// --- cases -----------------------------------------------------------------

export async function insertCase(values: typeof matchmakingCases.$inferInsert): Promise<MatchmakingCaseRow> {
  const [row] = await db.insert(matchmakingCases).values(values).returning();
  return row;
}

export async function findCaseById(id: string): Promise<MatchmakingCaseRow | undefined> {
  const [row] = await db.select().from(matchmakingCases).where(eq(matchmakingCases.id, id)).limit(1);
  return row;
}

export async function findOpenCaseForUser(userId: string): Promise<MatchmakingCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(matchmakingCases)
    .where(and(eq(matchmakingCases.userId, userId), inArray(matchmakingCases.status, OPEN_CASE_STATUSES)))
    .limit(1);
  return row;
}

export async function findLatestCaseForUser(userId: string): Promise<MatchmakingCaseRow | undefined> {
  const [row] = await db.select().from(matchmakingCases).where(eq(matchmakingCases.userId, userId)).orderBy(desc(matchmakingCases.createdAt)).limit(1);
  return row;
}

/** Compare-and-swap status change: only applies while the case is still in one of `from`. */
export async function transitionCase(
  id: string,
  from: CaseStatus[],
  to: CaseStatus,
  extra: Partial<typeof matchmakingCases.$inferInsert> = {}
): Promise<MatchmakingCaseRow | undefined> {
  const [row] = await db
    .update(matchmakingCases)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(and(eq(matchmakingCases.id, id), inArray(matchmakingCases.status, from)))
    .returning();
  return row;
}

export async function updateCustomerNotes(id: string, customerNotes: string | null): Promise<MatchmakingCaseRow | undefined> {
  const [row] = await db
    .update(matchmakingCases)
    .set({ customerNotes, updatedAt: new Date() })
    .where(and(eq(matchmakingCases.id, id), inArray(matchmakingCases.status, OPEN_CASE_STATUSES)))
    .returning();
  return row;
}

export interface CaseListRow {
  case: MatchmakingCaseRow;
  customerName: string;
  customerEmail: string;
  suggestionsSent: number;
  suggestionsTotal: number;
  duplicateCaptures: number;
}

export async function listCases(filter: { status?: CaseStatus; limit: number; offset: number }): Promise<{ rows: CaseListRow[]; total: number }> {
  const where = filter.status ? eq(matchmakingCases.status, filter.status) : undefined;
  const sent = sql<number>`(SELECT count(*)::int FROM ${matchmakingSuggestions} s WHERE s.case_id = ${matchmakingCases.id} AND s.status = 'SENT')`;
  const total = sql<number>`(SELECT count(*)::int FROM ${matchmakingSuggestions} s WHERE s.case_id = ${matchmakingCases.id})`;
  const duplicates = sql<number>`(SELECT count(*)::int FROM ${payments} p WHERE p.matchmaking_case_id = ${matchmakingCases.id} AND ${isDuplicateCapture(sql`p`)})`;
  const rows = await db
    .select({ case: matchmakingCases, customerName: users.name, customerEmail: users.email, suggestionsSent: sent, suggestionsTotal: total, duplicateCaptures: duplicates })
    .from(matchmakingCases)
    .innerJoin(users, eq(users.id, matchmakingCases.userId))
    .where(where)
    .orderBy(desc(matchmakingCases.updatedAt))
    .limit(filter.limit)
    .offset(filter.offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(matchmakingCases).where(where);
  return { rows, total: count };
}

/**
 * A captured (SUCCESS) payment that is NOT the one that paid for its case, on a case that is already paid or was
 * closed: a member charged twice. fulfilMatchmakingPayment grants nothing for it; a Super Admin must refund it.
 * (A SUCCESS payment on a still-unpaid PENDING_PAYMENT case is merely awaiting fulfilment, not a duplicate.)
 * `p` is the alias of the payments row being tested; the case row is the outer matchmaking_cases.
 */
function isDuplicateCapture(p: ReturnType<typeof sql>) {
  return sql`${p}.status = 'SUCCESS' AND ${p}.id IS DISTINCT FROM ${matchmakingCases.paidPaymentId} AND (${matchmakingCases.paidPaymentId} IS NOT NULL OR ${matchmakingCases.status} <> 'PENDING_PAYMENT')`;
}

export interface CasePaymentRow {
  id: string;
  status: (typeof payments.$inferSelect)["status"];
  amountInPaise: number;
  currency: string;
  gatewayReference: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  isPaidPayment: boolean;
  duplicateCapture: boolean;
}

/** Every payment attempt for a case, newest first, each flagged if it is a duplicate capture needing a refund. */
export async function listCasePayments(caseId: string): Promise<CasePaymentRow[]> {
  return db
    .select({
      id: payments.id,
      status: payments.status,
      amountInPaise: payments.amountInPaise,
      currency: payments.currency,
      gatewayReference: payments.gatewayReference,
      verifiedAt: payments.verifiedAt,
      createdAt: payments.createdAt,
      isPaidPayment: sql<boolean>`(${payments.id} = ${matchmakingCases.paidPaymentId}) IS TRUE`,
      duplicateCapture: sql<boolean>`(${isDuplicateCapture(sql`${payments}`)})`,
    })
    .from(payments)
    .innerJoin(matchmakingCases, eq(matchmakingCases.id, payments.matchmakingCaseId))
    .where(eq(payments.matchmakingCaseId, caseId))
    .orderBy(desc(payments.createdAt));
}

/**
 * Successful matchmaking payments whose case was never activated (a fulfilment that failed part-way). The
 * payment-reconcile job re-runs the idempotent fulfilment for these.
 */
export async function listPaidPaymentsAwaitingFulfilment(limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(matchmakingCases, eq(matchmakingCases.id, payments.matchmakingCaseId))
    .where(and(eq(payments.status, "SUCCESS"), eq(matchmakingCases.status, "PENDING_PAYMENT"), isNull(matchmakingCases.paidPaymentId)))
    .limit(limit);
  return rows.map((r) => r.id);
}

// --- included access ---------------------------------------------------------

/** True while the included member access of a verified, unrefunded purchase (or an accepted complimentary case) is still running. */
export async function hasIncludedAccess(userId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: matchmakingCases.id })
    .from(matchmakingCases)
    .where(
      and(
        eq(matchmakingCases.userId, userId),
        sql`(${matchmakingCases.paidAt} IS NOT NULL OR ${matchmakingCases.complimentary})`,
        isNull(matchmakingCases.includedAccessRevokedAt),
        sql`${matchmakingCases.includedAccessUntil} > ${now}`
      )
    )
    .limit(1);
  return !!row;
}

export async function latestIncludedAccessUntil(userId: string, now = new Date()): Promise<Date | null> {
  const [row] = await db
    .select({ until: sql<Date | null>`max(${matchmakingCases.includedAccessUntil})` })
    .from(matchmakingCases)
    .where(
      and(
        eq(matchmakingCases.userId, userId),
        sql`(${matchmakingCases.paidAt} IS NOT NULL OR ${matchmakingCases.complimentary})`,
        isNull(matchmakingCases.includedAccessRevokedAt),
        sql`${matchmakingCases.includedAccessUntil} > ${now}`
      )
    );
  return row?.until ? new Date(row.until) : null;
}

// --- events ----------------------------------------------------------------

export async function insertEvent(values: CaseEventInput): Promise<MatchmakingCaseEventRow> {
  const [row] = await db.insert(matchmakingCaseEvents).values(values).returning();
  return row;
}

export async function listEvents(caseId: string, opts: { customerVisibleOnly: boolean }): Promise<MatchmakingCaseEventRow[]> {
  const where = opts.customerVisibleOnly
    ? and(eq(matchmakingCaseEvents.caseId, caseId), eq(matchmakingCaseEvents.customerVisible, true))
    : eq(matchmakingCaseEvents.caseId, caseId);
  return db.select().from(matchmakingCaseEvents).where(where).orderBy(matchmakingCaseEvents.createdAt);
}

// --- suggestions -------------------------------------------------------------

export async function insertSuggestion(values: typeof matchmakingSuggestions.$inferInsert): Promise<MatchmakingSuggestionRow> {
  const [row] = await db.insert(matchmakingSuggestions).values(values).returning();
  return row;
}

export async function findSuggestionById(id: string): Promise<MatchmakingSuggestionRow | undefined> {
  const [row] = await db.select().from(matchmakingSuggestions).where(eq(matchmakingSuggestions.id, id)).limit(1);
  return row;
}

export async function listSuggestions(caseId: string, opts: { status?: SuggestionStatus } = {}): Promise<MatchmakingSuggestionRow[]> {
  const where = opts.status
    ? and(eq(matchmakingSuggestions.caseId, caseId), eq(matchmakingSuggestions.status, opts.status))
    : eq(matchmakingSuggestions.caseId, caseId);
  return db.select().from(matchmakingSuggestions).where(where).orderBy(desc(matchmakingSuggestions.createdAt));
}

export async function suggestedCandidateIds(caseId: string): Promise<string[]> {
  const rows = await db.select({ id: matchmakingSuggestions.candidateUserId }).from(matchmakingSuggestions).where(eq(matchmakingSuggestions.caseId, caseId));
  return rows.map((r) => r.id);
}

/** Compare-and-swap suggestion workflow step. */
export async function transitionSuggestion(
  id: string,
  from: SuggestionStatus[],
  to: SuggestionStatus,
  extra: Partial<typeof matchmakingSuggestions.$inferInsert> = {}
): Promise<MatchmakingSuggestionRow | undefined> {
  const [row] = await db
    .update(matchmakingSuggestions)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(and(eq(matchmakingSuggestions.id, id), inArray(matchmakingSuggestions.status, from)))
    .returning();
  return row;
}

export async function setSuggestionResponse(id: string, response: SuggestionResponse): Promise<MatchmakingSuggestionRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(matchmakingSuggestions)
    .set({ response, respondedAt: now, updatedAt: now })
    .where(and(eq(matchmakingSuggestions.id, id), eq(matchmakingSuggestions.status, "SENT")))
    .returning();
  return row;
}
