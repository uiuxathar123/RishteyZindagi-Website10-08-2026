/**
 * B9: data access for the admin user search/list/detail endpoints — a
 * genuinely new admin capability (no `/admin/users` route existed
 * before). Queries `users`/`profiles` directly rather than adding to the
 * frozen `users.repository.ts` (B1) — the same "a new admin-facing
 * concern gets its own repository file that reads the tables it needs
 * directly" precedent `reports.repository.ts` already established for
 * `users.status` reads/writes (see its own top-of-file comment).
 */
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, profiles, reports, memberships } from "@/server/db/schema";

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;

export interface AdminUserSearchFilter {
  q?: string;
  status?: UserRow["status"];
  verificationStatus?: ProfileRow["verificationStatus"];
  /** B18: ACTIVE = has an active, unexpired membership; NONE = has none. */
  membership?: "ACTIVE" | "NONE";
  /** B18: true = only users with at least one OPEN report filed against them. */
  openReports?: boolean;
  sort?: "newest" | "oldest" | "name" | "lastActive";
}

/** B18: escapes LIKE metacharacters so a `%` or `_` typed in the search box is matched literally. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminUserListRow {
  user: UserRow;
  profile: ProfileRow | null;
}

/**
 * Search/list — LEFT JOIN so a user without a profile row yet still
 * appears (never silently dropped from the admin's view of "who exists").
 * `q` matches name/email/mobileNumber (partial, case-insensitive).
 */
function orderBy(sort: AdminUserSearchFilter["sort"]) {
  switch (sort) {
    case "oldest":
      return [asc(users.createdAt), asc(users.id)];
    case "name":
      return [asc(users.name), asc(users.id)];
    case "lastActive":
      return [sql`${users.lastActiveAt} DESC NULLS LAST`, desc(users.id)];
    default:
      return [desc(users.createdAt), desc(users.id)];
  }
}

export async function searchUsers(
  filter: AdminUserSearchFilter,
  page: number,
  pageSize: number
): Promise<{ items: AdminUserListRow[]; total: number }> {
  const conditions = [];
  if (filter.q && filter.q.trim()) {
    const raw = filter.q.trim();
    const term = `%${escapeLike(raw)}%`;
    const matchers = [ilike(users.name, term), ilike(users.email, term), ilike(users.mobileNumber, term), ilike(profiles.publicId, term)];
    if (UUID_RE.test(raw)) matchers.push(eq(users.id, raw.toLowerCase()), eq(profiles.id, raw.toLowerCase()));
    conditions.push(or(...matchers));
  }
  if (filter.membership) {
    const active = sql`EXISTS (SELECT 1 FROM ${memberships} m WHERE m.user_id = ${users.id} AND m.status = 'ACTIVE' AND (m.expires_at IS NULL OR m.expires_at > now()))`;
    conditions.push(filter.membership === "ACTIVE" ? active : sql`NOT ${active}`);
  }
  if (filter.openReports) {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${reports} r WHERE r.reported_user_id = ${users.id} AND r.status = 'OPEN')`);
  }
  if (filter.status) conditions.push(eq(users.status, filter.status));
  if (filter.verificationStatus) conditions.push(eq(profiles.verificationStatus, filter.verificationStatus));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select({ user: users, profile: profiles })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(whereClause)
      // B13 (Performance/Scalability phase — disclosed, evidenced fix;
      // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section): same
      // pagination-drift fix as chat.repository.ts's listMessages (see
      // its doc comment) — `createdAt` alone is not a unique tiebreaker.
      .orderBy(...orderBy(filter.sort))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ c: count() })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(whereClause),
  ]);

  return { items: rows, total: Number(countRows[0]?.c ?? 0) };
}

export async function findUserWithProfile(userId: string): Promise<AdminUserListRow | undefined> {
  const [row] = await db
    .select({ user: users, profile: profiles })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

// --- Reports involving this user (both directions) -------------------------
// Queried directly against `reports` here rather than extending
// reports.repository.ts's listReports (which only filters by
// reportedUserId) — an additive new function there would have been just
// as valid, but this keeps every B9-only query colocated in one new file
// per the same "new admin concern, new file" precedent noted above.
export type ReportRow = typeof reports.$inferSelect;

export async function listReportsAgainstUser(userId: string): Promise<ReportRow[]> {
  return db.select().from(reports).where(eq(reports.reportedUserId, userId)).orderBy(desc(reports.createdAt));
}

export async function listReportsFiledByUser(userId: string): Promise<ReportRow[]> {
  return db.select().from(reports).where(eq(reports.reporterUserId, userId)).orderBy(desc(reports.createdAt));
}

export async function countReportsAgainstUser(userId: string): Promise<number> {
  const [row] = await db.select({ c: count() }).from(reports).where(eq(reports.reportedUserId, userId));
  return Number(row?.c ?? 0);
}
