"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BadgeCheck, HeartHandshake, Hourglass, Sparkles, UserCheck, Users } from "lucide-react";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import {
  CASE_STATUS_LABEL,
  type AdminCaseListItem,
  type IntroductionStatus,
  type MatchmakingCaseStatus,
  type MatchmakingOverview,
  type MatchmakingSettings,
} from "@/lib/api/matchmaking-types";
import { formatDate, formatMoney } from "@/lib/format";
import { ActionError, Card, PageHeader, SuccessNote, td, th } from "./AdminUi";
import { MatchmakingIntroductionsClient } from "./MatchmakingIntroductionsClient";
import { CompanyVerificationClient } from "./CompanyVerificationClient";
import { MatchmakingMembersClient } from "./MatchmakingMembersClient";

const STATUSES = Object.keys(CASE_STATUS_LABEL) as MatchmakingCaseStatus[];

/** Prices are edited in whole rupees / dollars and stored in the smallest unit. */
const toMajor = (v: number | null) => (v === null ? "" : String(v / 100));
const toMinor = (v: string): number | null => (v.trim() === "" ? null : Math.round(Number(v) * 100));

function SettingsCard() {
  const settings = useAsync((signal) => adminApi.get<{ settings: MatchmakingSettings }>("/matchmaking/settings", { signal }), []);
  const [form, setForm] = useState({ enabled: false, inr: "", usd: "", days: "30" });
  const [saved, setSaved] = useState(false);
  const save = useAction((body: MatchmakingSettings) => adminApi.put<{ settings: MatchmakingSettings }>("/matchmaking/settings", body));

  useEffect(() => {
    const s = settings.data?.settings;
    if (s) setForm({ enabled: s.enabled, inr: toMajor(s.prices.INR), usd: toMajor(s.prices.USD), days: String(s.includedMembershipDays) });
  }, [settings.data]);

  async function submit() {
    setSaved(false);
    const res = await save.run({ enabled: form.enabled, prices: { INR: toMinor(form.inr), USD: toMinor(form.usd) }, includedMembershipDays: Number(form.days) });
    if (res) {
      setSaved(true);
      settings.reload();
    }
  }

  return (
    <Card title="Service settings" description="What the service costs and how much member access (interests and chat) it includes. Only Super Admins can see or change this.">
      <div className="grid gap-4 p-4 sm:grid-cols-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-rz-navy sm:col-span-4">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> On sale
        </label>
        <div>
          <FieldLabel htmlFor="mm-price-inr">Price (INR)</FieldLabel>
          <Input id="mm-price-inr" inputMode="decimal" value={form.inr} onChange={(e) => setForm({ ...form, inr: e.target.value })} placeholder="not sold" />
        </div>
        <div>
          <FieldLabel htmlFor="mm-price-usd">Price (USD)</FieldLabel>
          <Input id="mm-price-usd" inputMode="decimal" value={form.usd} onChange={(e) => setForm({ ...form, usd: e.target.value })} placeholder="not sold" />
        </div>
        <div>
          <FieldLabel htmlFor="mm-days">Included access (days)</FieldLabel>
          <Input id="mm-days" inputMode="numeric" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="button" disabled={save.pending || settings.loading} onClick={() => void submit()}>
            Save settings
          </Button>
        </div>
      </div>
      <div className="px-4 pb-4">
        <ActionError error={save.error} />
        {saved && <SuccessNote>Saved. New checkouts use these terms; existing payments keep theirs.</SuccessNote>}
      </div>
    </Card>
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "cases", label: "Paid cases" },
  { key: "introductions", label: "Introductions" },
  { key: "verification", label: "Company Verified" },
  { key: "settings", label: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function CasesPanel({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState<string>(initialStatus);
  useEffect(() => setStatus(initialStatus), [initialStatus]);
  const list = useAsync(
    (signal) => adminApi.get<{ items: AdminCaseListItem[]; total: number }>("/matchmaking/cases", { query: { status: status || undefined, pageSize: 100 }, signal }),
    [status]
  );

  return (
    <>
      <Card
        title="Paid cases"
        description="Members who bought Personal Matchmaking. Open a case to send them hand-picked suggestions."
        actions={
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {CASE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        }
      >
        <AsyncView
          {...list}
          skeleton={<ListSkeleton />}
          isEmpty={(d) => d.items.length === 0}
          empty={{
            title: status ? "No cases with this status" : "No cases yet",
            description: "A case appears here as soon as a member starts Personal Matchmaking checkout.",
          }}
        >
          {(data) => (
            <>
              <ul className="divide-y divide-rz-border md:hidden">
                {data.items.map((c) => (
                  <li key={c.id} className="p-4 text-sm">
                    <Link href={`/admin/super/matchmaking/${c.id}`} className="font-medium text-rz-maroon hover:underline">
                      {c.customer.name}
                    </Link>
                    <span className="block text-[12px] text-rz-muted">{c.customer.email}</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={c.status === "ACTIVE" || c.status === "IN_PROGRESS" ? "success" : c.status === "PENDING_PAYMENT" ? "gold" : "neutral"}>{CASE_STATUS_LABEL[c.status]}</Badge>
                      {c.duplicateCaptures > 0 && <Badge tone="maroon">Duplicate payment — refund</Badge>}
                    </div>
                    <p className="mt-1 text-[12px] text-rz-muted">
                      {c.complimentary ? "Complimentary (free)" : c.paidAt ? `Paid ${formatMoney(c.priceInSmallestUnit, c.currency)} · ${formatDate(c.paidAt)}` : "Not paid yet"} · {c.suggestionsSent} sent / {c.suggestionsTotal}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-rz-border bg-rz-cream text-left">
                      <th className={th}>Member</th>
                      <th className={th}>Status</th>
                      <th className={th}>Paid</th>
                      <th className={th}>Access until</th>
                      <th className={th}>Suggestions</th>
                      <th className={th}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((c) => (
                      <tr key={c.id} className="border-b border-rz-border last:border-0">
                        <td className={td}>
                          <Link href={`/admin/super/matchmaking/${c.id}`} className="font-medium text-rz-maroon hover:underline">
                            {c.customer.name}
                          </Link>
                          <span className="block text-[11px] text-rz-muted">{c.customer.email}</span>
                        </td>
                        <td className={td}>
                          <Badge tone={c.status === "ACTIVE" || c.status === "IN_PROGRESS" ? "success" : c.status === "PENDING_PAYMENT" ? "gold" : "neutral"}>{CASE_STATUS_LABEL[c.status]}</Badge>
                          {c.duplicateCaptures > 0 && (
                            <span className="mt-1 block">
                              <Badge tone="maroon">{c.duplicateCaptures === 1 ? "Duplicate payment — refund" : `${c.duplicateCaptures} duplicate payments — refund`}</Badge>
                            </span>
                          )}
                        </td>
                        <td className={td}>{c.complimentary ? "Complimentary" : c.paidAt ? `${formatMoney(c.priceInSmallestUnit, c.currency)} · ${formatDate(c.paidAt)}` : "—"}</td>
                        <td className={td}>{c.includedAccessUntil ? formatDate(c.includedAccessUntil) : "—"}</td>
                        <td className={td}>
                          {c.suggestionsSent} sent / {c.suggestionsTotal}
                        </td>
                        <td className={td}>{formatDate(c.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </AsyncView>
      </Card>
      <p className="flex items-center gap-2 text-[13px] text-rz-muted">
        <HeartHandshake className="h-4 w-4" aria-hidden /> A suggestion is an introduction only: it never creates an interest, a match or a chat.
      </p>
    </>
  );
}

/** One "needs attention" tile: a number, what it means, and where clicking it takes you. */
function OverviewTile({ icon, value, label, hint, urgent, onOpen }: { icon: ReactNode; value: number; label: string; hint: string; urgent?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rz-focus flex w-full items-start gap-3 rounded-lg border bg-white p-4 text-left shadow-card-sm transition hover:bg-rz-cream ${urgent && value > 0 ? "border-rz-maroon/40" : "border-rz-border"}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${urgent && value > 0 ? "bg-rz-maroon/10 text-rz-maroon" : "bg-rz-cream text-rz-navy"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-serif text-2xl font-bold text-rz-navy">{value}</span>
        <span className="block text-sm font-semibold text-rz-navy">{label}</span>
        <span className="block text-[12px] text-rz-muted">{hint}</span>
      </span>
    </button>
  );
}

function OverviewPanel({ go }: { go: (tab: TabKey, status?: string) => void }) {
  const overview = useAsync((signal) => adminApi.get<{ overview: MatchmakingOverview }>("/matchmaking/overview", { signal }), []);
  return (
    <AsyncView {...overview} skeleton={<ListSkeleton />}>
      {({ overview: o }) => (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-serif text-lg font-semibold text-rz-navy">Needs your attention</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <OverviewTile icon={<Sparkles className="h-4 w-4" />} value={o.cases.ACTIVE} label="New paid cases" hint="Paid and waiting for you to start" urgent onOpen={() => go("cases", "ACTIVE")} />
              <OverviewTile icon={<UserCheck className="h-4 w-4" />} value={o.introductions.MUTUALLY_ACCEPTED} label="Both accepted" hint="Introductions both members accepted" onOpen={() => go("introductions", "MUTUALLY_ACCEPTED")} />
              <OverviewTile icon={<BadgeCheck className="h-4 w-4" />} value={o.verificationReviewsOpen} label="Verification reviews open" hint="Waiting for approve or reject" urgent onOpen={() => go("verification")} />
              <OverviewTile icon={<AlertTriangle className="h-4 w-4" />} value={o.duplicateCaptures} label="Duplicate payments" hint="Charged twice — refund from Revenue" urgent onOpen={() => go("cases")} />
            </div>
          </section>
          <section>
            <h2 className="mb-3 font-serif text-lg font-semibold text-rz-navy">In progress</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <OverviewTile icon={<Users className="h-4 w-4" />} value={o.cases.IN_PROGRESS} label="Cases in progress" hint="You are sending suggestions" onOpen={() => go("cases", "IN_PROGRESS")} />
              <OverviewTile icon={<Hourglass className="h-4 w-4" />} value={o.introductions.PENDING} label="Introductions waiting" hint="Waiting for members to answer" onOpen={() => go("introductions", "PENDING")} />
              <OverviewTile icon={<Hourglass className="h-4 w-4" />} value={o.cases.PENDING_PAYMENT} label="Checkouts not paid" hint="Started but not paid yet" onOpen={() => go("cases", "PENDING_PAYMENT")} />
            </div>
          </section>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => go("members")}>Members: invite or introduce</Button>
            <Button variant="outline" onClick={() => go("introductions")}>
              Create an introduction
            </Button>
            <Button variant="outline" onClick={() => go("verification")}>
              Review a profile
            </Button>
          </div>
        </div>
      )}
    </AsyncView>
  );
}

/**
 * Personal Matchmaking admin, one page with tabs. The tab and its filter live in the URL (?tab=…&status=…), so a
 * tab can be bookmarked or linked, and the browser back button works.
 */
export function MatchmakingAdminClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : "overview";
  const status = params.get("status") ?? "";

  function go(next: TabKey, nextStatus?: string) {
    const q = new URLSearchParams({ tab: next });
    if (nextStatus) q.set("status", nextStatus);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Personal Matchmaking" description="Paid cases, introductions and Company Verified reviews — Super Admins only." />
      <nav aria-label="Personal Matchmaking sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-rz-border px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => go(t.key)}
            className={`rz-focus -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.key ? "border-rz-maroon text-rz-maroon" : "border-transparent text-rz-muted hover:text-rz-navy"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "overview" && <OverviewPanel go={go} />}
      {tab === "members" && <MatchmakingMembersClient />}
      {tab === "cases" && <CasesPanel initialStatus={status} />}
      {tab === "introductions" && <MatchmakingIntroductionsClient embedded initialStatus={(status as IntroductionStatus) || ""} />}
      {tab === "verification" && <CompanyVerificationClient embedded />}
      {tab === "settings" && <SettingsCard />}
    </div>
  );
}
