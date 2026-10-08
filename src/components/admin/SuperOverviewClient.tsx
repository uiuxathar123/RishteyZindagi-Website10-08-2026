"use client";

import { StatCard } from "@/components/admin/StatCard";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/States";
import { adminApi } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { AdminDashboardStats } from "@/lib/api/types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Crown, IndianRupee, ScrollText, UserCog } from "lucide-react";
import Link from "next/link";
import { Card, ShortId } from "./AdminUi";
import type { AdminAuditEntry, Page } from "./adminTypes";
import { revenueRows } from "./OverviewClient";

const QUICK_LINKS = [
  { href: "/admin/super/staff", icon: UserCog, title: "Staff & Roles", description: "Your role's permissions, and how staff accounts are created today." },
  { href: "/admin/super/settings", icon: Crown, title: "Platform Settings", description: "OTP delivery, matching weights and payment gateways for the whole platform." },
  { href: "/admin/super/revenue", icon: IndianRupee, title: "Revenue", description: "Payments, invoices and memberships, with manual verification." },
  { href: "/admin/super/audit-log", icon: ScrollText, title: "Audit Log", description: "Every recorded admin and system action, with who and when." },
];

export function SuperOverviewClient() {
  const dash = useAsync((signal) => adminApi.get<AdminDashboardStats>("/dashboard", { signal }), []);
  const audit = useAsync((signal) => adminApi.get<Page<AdminAuditEntry>>("/audit-logs", { query: { pageSize: 5 }, signal }), []);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2.5">
        <Crown className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />
        <h1 className="font-serif text-2xl font-bold text-rz-navy md:text-3xl">Super Admin</h1>
        <Badge tone="gold">Highest privilege</Badge>
      </div>
      <p className="-mt-4 mb-6 text-sm text-rz-muted">
        Platform-wide configuration, revenue, and the accountability trail for every admin action.
      </p>

      <AsyncView
        data={dash.data}
        error={dash.error}
        loading={dash.loading}
        reload={dash.reload}
        skeleton={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        }
      >
        {({ stats }) => {
          const revenue = revenueRows(stats);
          return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={IndianRupee}
                label="Total revenue"
                value={revenue.length === 0 ? "None yet" : revenue.map((r) => formatMoney(r.amount, r.currency)).join(" · ")}
                hint={`${stats.payments.successful} successful payments`}
              />
              <StatCard icon={IndianRupee} label="Pending payments" value={stats.payments.pending.toLocaleString("en-IN")} hint={`${stats.payments.failed} failed`} />
              <StatCard icon={ScrollText} label="Logged actions" value={audit.data ? audit.data.total.toLocaleString("en-IN") : audit.error ? "Unavailable" : "…"} hint="All recorded admin and system actions" />
              <StatCard icon={UserCog} label="Staff accounts" value="Not available" hint="The platform has no staff-listing endpoint" />
            </div>
          );
        }}
      </AsyncView>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {QUICK_LINKS.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="rz-focus group flex items-start gap-4 rounded-lg border border-rz-border bg-white p-5 shadow-card-sm transition-shadow hover:shadow-card"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rz-champagne text-rz-gold-deep">
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <span>
              <span className="block font-serif text-base font-semibold text-rz-navy group-hover:text-rz-maroon">{title}</span>
              <span className="mt-1 block text-[13px] leading-relaxed text-rz-muted">{description}</span>
            </span>
          </Link>
        ))}
      </div>

      <Card title="Latest activity" className="mt-8" actions={<Link href="/admin/super/audit-log" className="rz-focus text-[13px] font-semibold text-rz-maroon hover:underline">Full audit log</Link>}>
        <div className="p-4">
          <AsyncView
            data={audit.data}
            error={audit.error}
            loading={audit.loading}
            reload={audit.reload}
            skeleton={<ListSkeleton rows={3} />}
            isEmpty={(d) => d.items.length === 0}
            empty={{ title: "Nothing recorded yet" }}
          >
            {(d) => (
              <ul className="divide-y divide-rz-border">
                {d.items.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="font-mono text-[12.5px] text-rz-text">{e.action}</span>
                    <span className="text-rz-muted">
                      {e.actorRole ? e.actorRole.replace("_", " ").toLowerCase() : e.actorType.toLowerCase()} <ShortId id={e.actorId} />
                    </span>
                    <span className="text-[12.5px] text-rz-muted sm:ml-auto">{formatDateTime(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </AsyncView>
        </div>
      </Card>
    </div>
  );
}
