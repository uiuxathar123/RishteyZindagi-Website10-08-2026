/**
 * B9: data access for the admin invoice search/filter/list endpoint — a
 * genuinely new capability (B8 only ever shipped single-invoice lookup
 * by id, never a search/list). Joins `invoices` -> `payments` (via
 * invoices.paymentId) -> `transactions` (via transactions.paymentId,
 * one row per payment in every real code path — see payments.repository
 * .ts's createTransaction, called exactly once per checkout) ->
 * `memberships` (via payments.membershipId) -> `membership_plans` (via
 * memberships.planId) -> `payment_gateways` (via payments.gatewayId), so
 * every filter the B9 brief asks for (invoice number, user, date range,
 * plan, amount range, payment status, gateway, currency, transaction id)
 * can be expressed as a single indexed query rather than N+1 lookups.
 *
 * New file rather than an addition to the frozen (B8) `invoices
 * .repository.ts` — same "new admin concern, new file" precedent as
 * every other B9 repository in this directory.
 */
import { and, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invoices, payments, transactions, memberships, membershipPlans, paymentGateways } from "@/server/db/schema";

export interface AdminInvoiceSearchFilter {
  invoiceNumber?: string;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  planId?: string;
  amountMin?: number;
  amountMax?: number;
  paymentStatus?: (typeof payments.$inferSelect)["status"];
  gatewayId?: string;
  currency?: string;
  transactionId?: string;
}

export interface AdminInvoiceSearchRow {
  id: string;
  invoiceNumber: string;
  userId: string;
  amountInPaise: number;
  status: string;
  issuedAt: Date;
  cancelledAt: Date | null;
  paymentId: string | null;
  paymentStatus: string | null;
  currency: string | null;
  gatewayId: string | null;
  gatewayName: string | null;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  transactionRef: string | null;
  gatewayTransactionId: string | null;
}

export async function searchInvoices(
  filter: AdminInvoiceSearchFilter,
  page: number,
  pageSize: number
): Promise<{ items: AdminInvoiceSearchRow[]; total: number }> {
  const conditions = [];
  if (filter.invoiceNumber) conditions.push(ilike(invoices.invoiceNumber, `%${filter.invoiceNumber}%`));
  if (filter.userId) conditions.push(eq(invoices.userId, filter.userId));
  if (filter.dateFrom) conditions.push(gte(invoices.issuedAt, filter.dateFrom));
  if (filter.dateTo) conditions.push(lte(invoices.issuedAt, filter.dateTo));
  if (filter.amountMin !== undefined) conditions.push(gte(invoices.amountInPaise, filter.amountMin));
  if (filter.amountMax !== undefined) conditions.push(lte(invoices.amountInPaise, filter.amountMax));
  if (filter.planId) conditions.push(eq(memberships.planId, filter.planId));
  if (filter.paymentStatus) conditions.push(eq(payments.status, filter.paymentStatus));
  if (filter.gatewayId) conditions.push(eq(payments.gatewayId, filter.gatewayId));
  if (filter.currency) conditions.push(eq(payments.currency, filter.currency));
  if (filter.transactionId) {
    conditions.push(or(ilike(transactions.transactionRef, `%${filter.transactionId}%`), ilike(transactions.gatewayTransactionId, `%${filter.transactionId}%`)));
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const selection = {
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    userId: invoices.userId,
    amountInPaise: invoices.amountInPaise,
    status: invoices.status,
    issuedAt: invoices.issuedAt,
    cancelledAt: invoices.cancelledAt,
    paymentId: payments.id,
    paymentStatus: payments.status,
    currency: payments.currency,
    gatewayId: payments.gatewayId,
    gatewayName: paymentGateways.name,
    planId: memberships.planId,
    planCode: membershipPlans.code,
    planName: membershipPlans.name,
    transactionRef: transactions.transactionRef,
    gatewayTransactionId: transactions.gatewayTransactionId,
  };

  const [items, countRows] = await Promise.all([
    db
      .select(selection)
      .from(invoices)
      .leftJoin(payments, eq(invoices.paymentId, payments.id))
      .leftJoin(transactions, eq(transactions.paymentId, payments.id))
      .leftJoin(memberships, eq(payments.membershipId, memberships.id))
      .leftJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .leftJoin(paymentGateways, eq(payments.gatewayId, paymentGateways.id))
      .where(whereClause)
      // B13 (Performance/Scalability phase — disclosed, evidenced fix;
      // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section): same
      // pagination-drift fix as chat.repository.ts's listMessages (see
      // its doc comment) — `issuedAt` alone is not a unique tiebreaker.
      .orderBy(desc(invoices.issuedAt), desc(invoices.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ c: count() })
      .from(invoices)
      .leftJoin(payments, eq(invoices.paymentId, payments.id))
      .leftJoin(transactions, eq(transactions.paymentId, payments.id))
      .leftJoin(memberships, eq(payments.membershipId, memberships.id))
      .leftJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .leftJoin(paymentGateways, eq(payments.gatewayId, paymentGateways.id))
      .where(whereClause),
  ]);

  return { items, total: Number(countRows[0]?.c ?? 0) };
}
