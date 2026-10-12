/**
 * B9: admin membership list/filter. Reuses the existing `payments.review`
 * permission — memberships in this system exist entirely as the product
 * of the checkout/payment lifecycle (see memberships.service.ts /
 * payments.service.ts's activateMembershipFromPayment), so an admin
 * membership lookup is the same billing-admin surface as invoice search
 * and pending-payment review, not a separate "member account" concern
 * (`users.view`'s domain — identity/status, not billing state). See
 * BACKEND.md's B9 section for the full reasoning.
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./memberships-admin.repository";
import type { AdminMembershipRow } from "./memberships-admin.repository";

const PERMISSION = "payments.review";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface ListMembershipsInput {
  userId?: string;
  status?: "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  planId?: string;
  page?: number;
  pageSize?: number;
}

export interface MembershipView {
  id: string;
  userId: string;
  planId: string;
  planCode: string | null;
  planName: string | null;
  status: string;
  startedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  createdAt: string;
}

function toView(row: AdminMembershipRow): MembershipView {
  return {
    ...row,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface MembershipsPage {
  items: MembershipView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listMembershipsForAdmin(ctx: AuthContext, input: ListMembershipsInput): Promise<MembershipsPage> {
  await requirePermission(ctx, PERMISSION);
  if (input.page !== undefined && input.page < 1) throw new ValidationError("page must be >= 1.");

  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { items, total } = await repo.listMemberships({ userId: input.userId, status: input.status, planId: input.planId }, page, pageSize);
  return { items: items.map(toView), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface RenewalOverview {
  counts: Record<"LAPSED" | "FOLLOW_UP_SENT" | "RENEWED" | "CLOSED", number>;
  recent: Array<{ membershipId: string; userId: string; planName: string | null; state: string; lapsedAt: string; lastNoticeAt: string | null }>;
  /** Plain statement shown next to the numbers so nobody reads them as automatic charging. */
  note: string;
}

/** B19: read-only view of the renewal follow-up cycles (see jobs/definitions/dunning.ts). */
export async function getRenewalOverview(ctx: AuthContext): Promise<RenewalOverview> {
  await requirePermission(ctx, PERMISSION);
  const [c, r] = await Promise.all([
    db.execute(sql`SELECT state, count(*)::int AS n FROM renewal_cycles GROUP BY state`),
    db.execute(sql`
      SELECT c.membership_id, c.user_id, p.name AS plan_name, c.state, c.lapsed_at, c.last_notice_at
      FROM renewal_cycles c JOIN memberships m ON m.id = c.membership_id LEFT JOIN membership_plans p ON p.id = m.plan_id
      ORDER BY c.lapsed_at DESC LIMIT 20`),
  ]);
  const counts = { LAPSED: 0, FOLLOW_UP_SENT: 0, RENEWED: 0, CLOSED: 0 } as RenewalOverview["counts"];
  for (const row of c.rows as Array<{ state: string; n: number }>) if (row.state in counts) counts[row.state as keyof typeof counts] = Number(row.n);
  return {
    counts,
    recent: (r.rows as Array<Record<string, unknown>>).map((x) => ({
      membershipId: String(x.membership_id),
      userId: String(x.user_id),
      planName: x.plan_name ? String(x.plan_name) : null,
      state: String(x.state),
      lapsedAt: new Date(String(x.lapsed_at)).toISOString(),
      lastNoticeAt: x.last_notice_at ? new Date(String(x.last_notice_at)).toISOString() : null,
    })),
    note: "These are reminders only. The platform does not store cards or mandates and never charges a member automatically.",
  };
}
