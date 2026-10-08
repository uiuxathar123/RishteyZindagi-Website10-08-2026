/**
 * B9: data access for the admin dashboard stats endpoint. Every function
 * here is a single efficient aggregate query (COUNT/SUM with GROUP BY
 * where needed) against already-indexed columns (`users.status`,
 * `profiles.profile_status`, `profiles.verification_status`,
 * `memberships.status`+`expires_at` — see schema.ts's own index list),
 * never a "load everything into JS and count in memory" query. No new
 * table or column is needed — this file only reads existing B1/B6/B8
 * tables.
 *
 * Deliberately no caching layer: at this project's data scale a handful
 * of indexed COUNT/SUM queries run in single-digit milliseconds — adding
 * a cache here would be premature complexity with no measured problem to
 * solve (see BACKEND.md's B9 section for the explicit disclosure asked
 * for by the brief).
 */
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { count, sum } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, profiles, memberships, payments, reports, accountSuspensions } from "@/server/db/schema";

export interface UserCounts {
  total: number;
  active: number;
  suspended: number;
}

export async function getUserCounts(): Promise<UserCounts> {
  const [[totalRow], [activeRow], [suspendedRow]] = await Promise.all([
    db.select({ c: count() }).from(users),
    db.select({ c: count() }).from(users).where(eq(users.status, "ACTIVE")),
    db.select({ c: count() }).from(users).where(eq(users.status, "SUSPENDED")),
  ]);
  return {
    total: Number(totalRow?.c ?? 0),
    active: Number(activeRow?.c ?? 0),
    suspended: Number(suspendedRow?.c ?? 0),
  };
}

export interface ProfileCounts {
  /** profileStatus === READY_FOR_VISIBILITY (the only state eligible for
   * normal visibility — see schema.ts's profileStatusEnum comment). This
   * is what the B9 brief means by "verified profiles". */
  readyForVisibility: number;
  pendingVerification: number;
}

export async function getProfileCounts(): Promise<ProfileCounts> {
  const [[readyRow], [pendingRow]] = await Promise.all([
    db.select({ c: count() }).from(profiles).where(eq(profiles.profileStatus, "READY_FOR_VISIBILITY")),
    db.select({ c: count() }).from(profiles).where(eq(profiles.verificationStatus, "PENDING")),
  ]);
  return {
    readyForVisibility: Number(readyRow?.c ?? 0),
    pendingVerification: Number(pendingRow?.c ?? 0),
  };
}

/** "Expiring soon" window — a documented 7-day judgment call (see
 * dashboard.service.ts's own doc comment for the disclosure), not a
 * value the brief specified. */
export const EXPIRING_SOON_WINDOW_DAYS = 7;

export interface MembershipCounts {
  active: number;
  expiringSoon: number;
}

export async function getMembershipCounts(): Promise<MembershipCounts> {
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [[activeRow], [expiringRow]] = await Promise.all([
    db.select({ c: count() }).from(memberships).where(eq(memberships.status, "ACTIVE")),
    db
      .select({ c: count() })
      .from(memberships)
      .where(and(eq(memberships.status, "ACTIVE"), gte(memberships.expiresAt, now), lte(memberships.expiresAt, soon))),
  ]);
  return {
    active: Number(activeRow?.c ?? 0),
    expiringSoon: Number(expiringRow?.c ?? 0),
  };
}

export interface PaymentCounts {
  total: number;
  successful: number;
  failed: number;
  pending: number;
  /** Revenue is currency-scoped — summing across INR/USD would be
   * meaningless, so this is a per-currency breakdown, not one number. */
  revenueByCurrency: Array<{ currency: string; totalInSmallestUnit: number }>;
}

export async function getPaymentCounts(): Promise<PaymentCounts> {
  const [[totalRow], [successRow], [failedRow], [pendingRow], revenueRows] = await Promise.all([
    db.select({ c: count() }).from(payments),
    db.select({ c: count() }).from(payments).where(eq(payments.status, "SUCCESS")),
    db.select({ c: count() }).from(payments).where(eq(payments.status, "FAILED")),
    db.select({ c: count() }).from(payments).where(eq(payments.status, "PENDING")),
    db
      .select({ currency: payments.currency, total: sum(payments.amountInPaise) })
      .from(payments)
      .where(eq(payments.status, "SUCCESS"))
      .groupBy(payments.currency),
  ]);
  return {
    total: Number(totalRow?.c ?? 0),
    successful: Number(successRow?.c ?? 0),
    failed: Number(failedRow?.c ?? 0),
    pending: Number(pendingRow?.c ?? 0),
    revenueByCurrency: revenueRows.map((r) => ({ currency: r.currency, totalInSmallestUnit: Number(r.total ?? 0) })),
  };
}

export async function getOpenReportsCount(): Promise<number> {
  const rows = await db.select({ c: count() }).from(reports).where(eq(reports.status, "OPEN"));
  const inReviewRows = await db.select({ c: count() }).from(reports).where(eq(reports.status, "IN_REVIEW"));
  return Number(rows[0]?.c ?? 0) + Number(inReviewRows[0]?.c ?? 0);
}

/**
 * `account_suspensions` rows are written ONLY by the B6 report-threshold
 * auto-suspension mechanism (see reports.service.ts's maybeAutoSuspend —
 * it is the sole caller of repo.createSuspension in this codebase), so
 * "currently un-lifted rows" is exactly "accounts currently suspended
 * after crossing the report threshold" — the B9 brief's
 * "suspended-after-threshold count".
 */
export async function getSuspendedAfterThresholdCount(): Promise<number> {
  const [row] = await db.select({ c: count() }).from(accountSuspensions).where(isNull(accountSuspensions.liftedAt));
  return Number(row?.c ?? 0);
}
