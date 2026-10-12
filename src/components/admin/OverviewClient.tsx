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
import { useState } from "react";
import { Card, PageHeader, td, th } from "./AdminUi";
import { TrendChart } from "./TrendChart";
import type { DashboardTrends } from "@/lib/api/b19-types";
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

      <Trends />
    </div>
  );
}


function Trends() {
  const [days, setDays] = useState(30);
  const t = useAsync((signal) => adminApi.get<DashboardTrends>("/dashboard/trends", { query: { days }, signal }), [days]);
  return (
    <section className="mt-6" aria-label="Trends" data-testid="trends">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-rz-navy">Trends</h2>
        <div role="group" aria-label="Period" className="flex gap-2">
          {[7, 30, 90].map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}
              className={days === n ? "rounded-full bg-rz-navy px-3 py-1 text-xs font-semibold text-white" : "rounded-full border border-rz-border px-3 py-1 text-xs text-rz-text hover:bg-rz-cream"}>
              {n} days
            </button>
          ))}
        </div>
      </div>
      <AsyncView data={t.data} error={t.error} loading={t.loading} reload={t.reload} skeleton={<Skeleton className="h-40 w-full" />}>
        {(d) => (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TrendChart title="New sign-ups" points={d.series.map((x) => ({ date: x.date, value: x.signups }))} />
            <TrendChart title="Successful payments" points={d.series.map((x) => ({ date: x.date, value: x.paymentsSucceeded }))} color="#1f3a5f" />
            {d.currencies.map((cur) => (
              <TrendChart key={cur} title={`Revenue (${cur})`} points={d.series.map((x) => ({ date: x.date, value: x.revenue[cur] ?? 0 }))} format={(n) => formatMoney(n, cur)} color="#b8860b" />
            ))}
            <TrendChart title="New reports" points={d.series.map((x) => ({ date: x.date, value: x.reportsOpened }))} color="#a33" />
          </div>
        )}
      </AsyncView>
      <p className="mt-2 text-xs text-rz-muted">Daily totals by India time. Revenue counts only payments verified as successful.</p>
    </section>
  );
}
