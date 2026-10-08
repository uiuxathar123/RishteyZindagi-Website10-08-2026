/**
 * B6: data access for `report_categories`, `reports`, and the new
 * `account_suspensions` table (see schema.ts's comment on why suspension
 * cycles get their own table instead of a frozen-`reports`-column
 * change).
 */
import { and, asc, countDistinct, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { reportCategories, reports, accountSuspensions, users } from "@/server/db/schema";

export type ReportCategoryRow = typeof reportCategories.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type AccountSuspensionRow = typeof accountSuspensions.$inferSelect;
export type ReportStatus = ReportRow["status"];

// --- Report categories -----------------------------------------------------

export async function listActiveReportCategories(): Promise<ReportCategoryRow[]> {
  return db.select().from(reportCategories).where(eq(reportCategories.isActive, true)).orderBy(asc(reportCategories.name));
}

export async function listAllReportCategories(): Promise<ReportCategoryRow[]> {
  return db.select().from(reportCategories).orderBy(asc(reportCategories.name));
}

export async function findReportCategoryById(id: string): Promise<ReportCategoryRow | undefined> {
  const [row] = await db.select().from(reportCategories).where(eq(reportCategories.id, id)).limit(1);
  return row;
}

export async function createReportCategory(data: { name: string; description?: string | null }): Promise<ReportCategoryRow> {
  const [row] = await db.insert(reportCategories).values({ name: data.name, description: data.description ?? null }).returning();
  return row;
}

export async function updateReportCategory(
  id: string,
  data: Partial<{ name: string; description: string | null; isActive: boolean }>
): Promise<ReportCategoryRow | undefined> {
  const [row] = await db.update(reportCategories).set(data).where(eq(reportCategories.id, id)).returning();
  return row;
}

// --- Reports ---------------------------------------------------------------

export async function createReport(data: {
  reporterUserId: string;
  reportedUserId: string;
  categoryId: string;
  description?: string | null;
}): Promise<ReportRow> {
  const [row] = await db
    .insert(reports)
    .values({
      reporterUserId: data.reporterUserId,
      reportedUserId: data.reportedUserId,
      categoryId: data.categoryId,
      description: data.description ?? null,
      status: "OPEN",
    })
    .returning();
  return row;
}

export async function findReportById(id: string): Promise<ReportRow | undefined> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  return row;
}

export interface ListReportsFilter {
  status?: ReportStatus;
  reportedUserId?: string;
}

export async function listReports(filter: ListReportsFilter, page: number, pageSize: number): Promise<{ items: ReportRow[]; total: number }> {
  const conditions = [];
  if (filter.status) conditions.push(eq(reports.status, filter.status));
  if (filter.reportedUserId) conditions.push(eq(reports.reportedUserId, filter.reportedUserId));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(reports)
      .where(whereClause)
      // B13 (Performance/Scalability phase — disclosed, evidenced fix;
      // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section): same
      // pagination-drift fix as chat.repository.ts's listMessages (see
      // its doc comment) — `createdAt` alone is not a unique tiebreaker.
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: countDistinct(reports.id) }).from(reports).where(whereClause),
  ]);
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

export async function dismissReport(id: string, adminId: string): Promise<ReportRow | undefined> {
  const [row] = await db
    .update(reports)
    .set({ status: "DISMISSED", resolvedByAdminId: adminId, resolvedAt: new Date() })
    .where(eq(reports.id, id))
    .returning();
  return row;
}

/**
 * The report-threshold rule's core query: how many DISTINCT reporters has
 * this reported user accumulated, counting only reports created after
 * `sinceExclusive` (the most recent lift, or `null` for "all-time, never
 * suspended before"). `countDistinct` on `reporterUserId` is exactly what
 * makes "the same user reporting 5 times must not trigger it" true —
 * this is a COUNT(DISTINCT ...), not a COUNT(*).
 */
export async function countUniqueReportersSince(reportedUserId: string, sinceExclusive: Date | null): Promise<number> {
  const conditions = [eq(reports.reportedUserId, reportedUserId)];
  if (sinceExclusive) conditions.push(gt(reports.createdAt, sinceExclusive));
  const [row] = await db
    .select({ count: countDistinct(reports.reporterUserId) })
    .from(reports)
    .where(and(...conditions));
  return Number(row?.count ?? 0);
}

// --- Account suspensions ----------------------------------------------------

/** The most recent suspension cycle for this user (lifted or not),
 * ordered by `suspendedAt` DESC — used both to find "is there a
 * currently-active suspension" (liftedAt null) and to find the most
 * recent lift timestamp for the threshold query above. */
export async function findLatestSuspension(userId: string): Promise<AccountSuspensionRow | undefined> {
  const [row] = await db
    .select()
    .from(accountSuspensions)
    .where(eq(accountSuspensions.userId, userId))
    .orderBy(desc(accountSuspensions.suspendedAt))
    .limit(1);
  return row;
}

export async function findActiveSuspension(userId: string): Promise<AccountSuspensionRow | undefined> {
  const [row] = await db
    .select()
    .from(accountSuspensions)
    .where(and(eq(accountSuspensions.userId, userId), isNull(accountSuspensions.liftedAt)))
    .orderBy(desc(accountSuspensions.suspendedAt))
    .limit(1);
  return row;
}

/**
 * B10: `onConflictDoNothing` against the partial unique index (see
 * schema.ts's `accountSuspensions.activeSuspensionIdx`) makes "at most
 * one active suspension per user" a DB-level guarantee, closing a race
 * in reports.service.ts's maybeAutoSuspend where two near-simultaneous
 * report submissions could both observe "not suspended yet" and both
 * try to create one. Returns `undefined` when a concurrent call already
 * won that race — the caller treats that as "already handled", not an
 * error (see maybeAutoSuspend). */
export async function createSuspension(userId: string, reason: string | null): Promise<AccountSuspensionRow | undefined> {
  const [row] = await db
    .insert(accountSuspensions)
    .values({ userId, reason })
    .onConflictDoNothing({ target: accountSuspensions.userId, where: sql`${accountSuspensions.liftedAt} IS NULL` })
    .returning();
  return row;
}

export async function liftSuspension(id: string, adminId: string): Promise<AccountSuspensionRow | undefined> {
  const [row] = await db
    .update(accountSuspensions)
    .set({ liftedAt: new Date(), liftedByAdminId: adminId })
    .where(eq(accountSuspensions.id, id))
    .returning();
  return row;
}

export async function listSuspensionsForUser(userId: string): Promise<AccountSuspensionRow[]> {
  return db.select().from(accountSuspensions).where(eq(accountSuspensions.userId, userId)).orderBy(desc(accountSuspensions.suspendedAt));
}

// --- Account status (read-only-elsewhere `users.status` write) -------------

/**
 * The only place in B6 that writes `users.status` (to `SUSPENDED` on
 * auto-suspension, back to `ACTIVE` on an admin lift). Deliberately a
 * function in THIS new B6 file, not an addition to the frozen
 * `users.repository.ts` — avoids touching a B1 file at all for a
 * two-line update, since nothing about "who is allowed to change a
 * user's status" needed to change in that file's existing exports.
 */
export async function setUserAccountStatus(userId: string, status: "ACTIVE" | "SUSPENDED"): Promise<void> {
  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function findUserAccountStatus(userId: string): Promise<string | undefined> {
  const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.status;
}
