/**
 * B9: data access for the admin membership list/filter endpoint — a
 * genuinely new capability (B8 only ever exposed a member's own
 * membership + the admin payment/invoice surfaces, never a dedicated
 * admin membership lookup). Joins `memberships` -> `membership_plans`
 * for plan name/code. New file rather than an addition to the frozen
 * (B8) `memberships.repository.ts` — same "new admin concern, new file"
 * precedent as every other B9 repository in this directory.
 */
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships, membershipPlans } from "@/server/db/schema";

export interface AdminMembershipFilter {
  userId?: string;
  status?: (typeof memberships.$inferSelect)["status"];
  planId?: string;
}

export interface AdminMembershipRow {
  id: string;
  userId: string;
  planId: string;
  planCode: string | null;
  planName: string | null;
  status: string;
  startedAt: Date | null;
  expiresAt: Date | null;
  autoRenew: boolean;
  createdAt: Date;
}

export async function listMemberships(
  filter: AdminMembershipFilter,
  page: number,
  pageSize: number
): Promise<{ items: AdminMembershipRow[]; total: number }> {
  const conditions = [];
  if (filter.userId) conditions.push(eq(memberships.userId, filter.userId));
  if (filter.status) conditions.push(eq(memberships.status, filter.status));
  if (filter.planId) conditions.push(eq(memberships.planId, filter.planId));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const selection = {
    id: memberships.id,
    userId: memberships.userId,
    planId: memberships.planId,
    planCode: membershipPlans.code,
    planName: membershipPlans.name,
    status: memberships.status,
    startedAt: memberships.startedAt,
    expiresAt: memberships.expiresAt,
    autoRenew: memberships.autoRenew,
    createdAt: memberships.createdAt,
  };

  const [items, countRows] = await Promise.all([
    db
      .select(selection)
      .from(memberships)
      .leftJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .where(whereClause)
      // B13 (Performance/Scalability phase — disclosed, evidenced fix;
      // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section): same
      // pagination-drift fix as chat.repository.ts's listMessages (see
      // its doc comment) — `createdAt` alone is not a unique tiebreaker.
      .orderBy(desc(memberships.createdAt), desc(memberships.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: count() }).from(memberships).where(whereClause),
  ]);

  return { items, total: Number(countRows[0]?.c ?? 0) };
}
