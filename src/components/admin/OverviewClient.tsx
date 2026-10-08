"use client";

import { StatCard } from "@/components/admin/StatCard";
import { Avatar } from "@/components/ui/Avatar";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/States";
import { adminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { AdminDashboardStats, AdminUserSummary, Page } from "@/lib/api/types";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { CreditCard, Flag, Hourglass, IndianRupee, ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import Link from "next/link";
import { Card, NotAvailable, PageHeader, td, th } from "./AdminUi";
import { STATUS_TONE } from "./UsersClient";

export function revenueRows(stats: AdminDashboardStats["stats"]) {
  return stats.payments.revenueByCurrency.map((r) => ({
    currency: r.currency,
    amount: r.totalInSmallestUnit ?? r.amountInPaise ?? r.total ?? 0,
  }));
}

export function OverviewClient() {
  const dash = useAsync((signal) => adminApi.get<AdminDashboardStats>("/dashboard", { signal }), []);
  const recent = useAsync(
    (signal) => adminApi.get<Page<AdminUserSummary>>("/users", { query: { pageSize: 8 }, signal }),
    []
  );

  return (
    <div>
      <PageHeader title="Overview" description="Live counts from the platform database. Nothing on this page is estimated." />

      <AsyncView
        data={dash.data}
        error={dash.error}
        loading={dash.loading}
        reload={dash.reload}
        skeleton={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        }
      >
        {({ stats }) => {
          const revenue = revenueRows(stats);
          return (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard icon={Users} label="Total Users" value={stats.users.total.toLocaleString("en-IN")} hint={`${stats.users.active.toLocaleString("en-IN")} active`} />
                <StatCard icon={UserX} label="Suspended Accounts" value={stats.users.suspended.toLocaleString("en-IN")} hint={`${stats.suspensions.activeAfterThreshold} suspended by the report threshold`} />
                <StatCard icon={UserCheck} label="Pending Verification" value={stats.profiles.pendingVerification.toLocaleString("en-IN")} hint="Profiles awaiting manual review" />
                <StatCard icon={ShieldCheck} label="Visible Profiles" value={stats.profiles.readyForVisibility.toLocaleString("en-IN")} hint="Ready for visibility" />
                <StatCard icon={Hourglass} label="Active Memberships" value={stats.memberships.active.toLocaleString("en-IN")} hint={`${stats.memberships.expiringSoon} expiring within ${stats.memberships.expiringSoonWindowDays} days`} />
                <StatCard icon={Flag} label="Open Reports" value={stats.reports.open.toLocaleString("en-IN")} hint="Open or in review" />
                <StatCard
                  icon={CreditCard}
                  label="Payments"
                  value={stats.payments.total.toLocaleString("en-IN")}
                  hint={`${stats.payments.successful} successful · ${stats.payments.pending} pending · ${stats.payments.failed} failed`}
                />
                <StatCard
                  icon={IndianRupee}
                  label="Revenue (successful payments)"
                  value={revenue.length === 0 ? "None yet" : revenue.map((r) => formatMoney(r.amount, r.currency)).join(" · ")}
                  hint="All time, per currency"
                />
              </div>
              <p className="mt-3 text-[12.5px] text-rz-muted">
                Not tracked by the platform, so not shown: members active today, signups this week, revenue per calendar month.
              </p>
            </>
          );
        }}
      </AsyncView>

      <Card title="Recent signups" className="mt-8" actions={<Link href="/admin/users" className="rz-focus text-[13px] font-semibold text-rz-maroon hover:underline">All users</Link>}>
        <AsyncView
          data={recent.data}
          error={recent.error}
          loading={recent.loading}
          reload={recent.reload}
          skeleton={<div className="p-4"><ListSkeleton rows={3} /></div>}
          isEmpty={(d) => d.items.length === 0}
          empty={{ title: "No members yet", description: "Members appear here as soon as they register." }}
        >
          {(page) => (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Member</th>
                    <th className={th}>Email</th>
                    <th className={th}>Joined</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((u) => (
                    <tr key={u.id} className="border-b border-rz-border last:border-0">
                      <td className={td}>
                        <Link href={`/admin/users?user=${u.id}`} className="rz-focus flex items-center gap-3 hover:underline">
                          <Avatar alt={u.name} size="sm" />
                          <span className="font-medium text-rz-text">{u.name}</span>
                        </Link>
                      </td>
                      <td className={`${td} text-rz-muted`}>{u.email}</td>
                      <td className={`${td} text-rz-muted`}>{formatDate(u.createdAt)}</td>
                      <td className={td}>
                        <Badge tone={STATUS_TONE[u.status] ?? "neutral"}>{humanize(u.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncView>
      </Card>

      <div className="mt-6">
        <NotAvailable title="Charts">
          The dashboard endpoint returns point-in-time totals only (no time series), so no trend charts are drawn.
        </NotAvailable>
      </div>
    </div>
  );
}

