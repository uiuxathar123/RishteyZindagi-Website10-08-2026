/**
 * B9: admin dashboard stats. Reuses the existing `users.view` permission
 * ("View member accounts") rather than adding a new one — a dashboard is
 * a read-only aggregate view of exactly the same account/profile/
 * membership/payment/report data `users.view`-gated endpoints already
 * expose individually; no new capability or blast radius is introduced
 * (see BACKEND.md's B9 section for the full reasoning).
 */
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./dashboard.repository";

const PERMISSION = "users.view";

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
  };
  reports: { open: number };
  suspensions: { activeAfterThreshold: number };
}

export async function getDashboardStats(ctx: AuthContext): Promise<DashboardStats> {
  await requirePermission(ctx, PERMISSION);

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
    payments: paymentCounts,
    reports: { open: openReports },
    suspensions: { activeAfterThreshold: suspendedAfterThreshold },
  };
}
