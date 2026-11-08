/**
 * B9: admin dashboard stats. Reuses the existing `users.view` permission
 * ("View member accounts") rather than adding a new one — a dashboard is
 * a read-only aggregate view of exactly the same account/profile/
 * membership/payment/report data `users.view`-gated endpoints already
 * expose individually; no new capability or blast radius is introduced
 * (see BACKEND.md's B9 section for the full reasoning).
 */
import type { AuthContext } from "@/server/middleware/authenticate";
import { hasPermission, requirePermission } from "@/server/middleware/rbac";
import * as repo from "./dashboard.repository";

const PERMISSION = "users.view";
/** Owner decision D-4 (2026-11-08): money figures are shown only to admins who may review payments (Super Admin by
 * default). Everyone else with users.view still gets every count, with the revenue amounts withheld. */
const REVENUE_PERMISSION = "payments.review";

export interface DashboardStats {
  users: { total: number; active: number; suspended: number };
  profiles: { readyForVisibility: number; pendingVerification: number };
  memberships: { active: number; expiringSoon: number; expiringSoonWindowDays: number };
  payments: {
    total: number;
    successful: number;
    failed: number;
    pending: number;
    revenueByCurrency: Array<{ currency: string; totalInSmallestUnit: number }>;
    /** False when this admin may not see money figures: revenueByCurrency is then always empty. */
    revenueVisible: boolean;
  };
  reports: { open: number };
  suspensions: { activeAfterThreshold: number };
}

export async function getDashboardStats(ctx: AuthContext): Promise<DashboardStats> {
  await requirePermission(ctx, PERMISSION);
  const revenueVisible = await hasPermission(ctx, REVENUE_PERMISSION);

  const [userCounts, profileCounts, membershipCounts, paymentCounts, openReports, suspendedAfterThreshold] = await Promise.all([
    repo.getUserCounts(),
    repo.getProfileCounts(),
    repo.getMembershipCounts(),
    repo.getPaymentCounts(),
    repo.getOpenReportsCount(),
    repo.getSuspendedAfterThresholdCount(),
  ]);

  return {
    users: userCounts,
    profiles: profileCounts,
    memberships: { ...membershipCounts, expiringSoonWindowDays: repo.EXPIRING_SOON_WINDOW_DAYS },
    payments: { ...paymentCounts, revenueByCurrency: revenueVisible ? paymentCounts.revenueByCurrency : [], revenueVisible },
    reports: { open: openReports },
    suspensions: { activeAfterThreshold: suspendedAfterThreshold },
  };
}

export interface DashboardTrends {
  days: number;
  timezone: "Asia/Kolkata";
  series: repo.TrendDay[];
  currencies: string[];
  /** False when this admin may not see money figures: every day's revenue is then empty and currencies is []. */
  revenueVisible: boolean;
}

/** B19: daily series behind the Overview charts. Same permission as the totals. `days` is 7–90 (default 30). */
export async function getDashboardTrends(ctx: AuthContext, daysInput?: number): Promise<DashboardTrends> {
  await requirePermission(ctx, PERMISSION);
  const days = Math.min(90, Math.max(7, Math.floor(daysInput ?? 30)));
  const revenueVisible = await hasPermission(ctx, REVENUE_PERMISSION);
  const raw = await repo.getDailyTrends(days);
  const series = revenueVisible ? raw : raw.map((d) => ({ ...d, revenue: {} }));
  const currencies = Array.from(new Set(series.flatMap((d) => Object.keys(d.revenue)))).sort();
  return { days, timezone: "Asia/Kolkata", series, currencies, revenueVisible };
}
