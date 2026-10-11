"use client";

/**
 * `/admin/super/membership-plans` — create and edit membership plans (B18, `plans.manage`).
 * Everything shown comes from GET /admin/membership-plans; every change goes through the API, which validates and audits it.
 * Code, currency and duration are fixed once a plan exists (members, payments and invoices refer to them).
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { AdminPlanRow } from "@/lib/api/b18-types";
import { formatMoney } from "@/lib/format";
import { BadgePercent, Plus } from "lucide-react";
import { useState } from "react";
import { ActionError, Card, fieldIssue, Modal, PageHeader, SuccessNote, td, th } from "./AdminUi";
import { formatDuration } from "@/components/membership/planUtils";

type Editing = { mode: "create" } | { mode: "edit"; plan: AdminPlanRow } | { mode: "toggle"; plan: AdminPlanRow };

const toMajor = (smallest: number) => (smallest / 100).toFixed(2);
function toSmallest(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function PlansClient() {
  const list = useAsync((signal) => adminApi.get<{ plans: AdminPlanRow[] }>("/membership-plans", { signal }), []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const done = (message: string) => {
    setEditing(null);
    setNote(message);
    list.reload();
  };

  return (
    <div>
      <PageHeader
        title="Membership Plans"
        icon={<BadgePercent className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="Prices, durations and what each plan unlocks. A price change applies to new purchases only; members keep what they already paid for."
        actions={
          <Button type="button" size="sm" onClick={() => { setNote(null); setEditing({ mode: "create" }); }}>
            <Plus className="h-4 w-4" aria-hidden /> New plan
          </Button>
        }
      />
      {note && <div className="mb-4"><SuccessNote>{note}</SuccessNote></div>}
      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={6} />}
        isEmpty={(d) => d.plans.length === 0}
        empty={{ title: "No plans yet", description: "Create the first plan to start selling memberships." }}
      >
        {(data) => (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm" data-testid="plans-table">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Plan</th>
                    <th className={th}>Price</th>
                    <th className={th}>Duration</th>
                    <th className={th}>Unlocks</th>
                    <th className={th}>Active members</th>
                    <th className={th}>Status</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.plans.map((p) => (
                    <tr key={p.id} className="border-b border-rz-border last:border-0" data-testid={`plan-${p.code}`}>
                      <td className={td}>
                        <span className="block font-medium text-rz-text">{p.name}</span>
                        <span className="block text-[11px] tracking-wide text-rz-muted">{p.code} · {p.currency}</span>
                      </td>
                      <td className={td}>{formatMoney(p.priceInSmallestUnit, p.currency)}</td>
                      <td className={td}>{formatDuration(p.durationDays)}</td>
                      <td className={`${td} text-[13px] text-rz-muted`}>
                        Chat{p.features.advancedSearch ? ", advanced search" : ""}{p.features.visibilityBoost ? ", visibility boost" : ""}
                      </td>
                      <td className={td}>{p.activeMembers}</td>
                      <td className={td}><Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "On sale" : "Not on sale"}</Badge></td>
                      <td className={td}>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => { setNote(null); setEditing({ mode: "edit", plan: p }); }} aria-label={`Edit ${p.name}`}>Edit</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setNote(null); setEditing({ mode: "toggle", plan: p }); }} aria-label={`${p.isActive ? "Stop selling" : "Resume selling"} ${p.name}`}>
                            {p.isActive ? "Stop selling" : "Resume"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </AsyncView>
      <p className="mt-4 max-w-3xl text-[13px] text-rz-muted">
        Chat is included in every active plan. Advanced search is the one entitlement you can switch per plan. The visibility boost comes with the 6-month (180-day) duration.
        Shortlist and interests are open to all members and are not plan features.
      </p>

      {editing?.mode === "create" && <PlanForm onClose={() => setEditing(null)} onDone={done} />}
      {editing?.mode === "edit" && <PlanForm plan={editing.plan} onClose={() => setEditing(null)} onDone={done} />}
      {editing?.mode === "toggle" && <ToggleDialog plan={editing.plan} onClose={() => setEditing(null)} onDone={done} />}
    </div>
  );
}

function PlanForm({ plan, onClose, onDone }: { plan?: AdminPlanRow; onClose: () => void; onDone: (m: string) => void }) {
  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [currency, setCurrency] = useState(plan?.currency ?? "INR");
  const [price, setPrice] = useState(plan ? toMajor(plan.priceInSmallestUnit) : "");
  const [days, setDays] = useState(plan ? String(plan.durationDays) : "30");
  const [adv, setAdv] = useState(plan?.features.advancedSearch ?? false);
  const [local, setLocal] = useState<string | null>(null);
  const save = useAction((body: Record<string, unknown>) =>
    plan ? adminApi.patch(`/membership-plans/${plan.id}`, body) : adminApi.post("/membership-plans", body)
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const smallest = toSmallest(price);
    if (smallest === null || smallest < 100) return setLocal("Enter a price of at least 1.00, with at most two decimals.");
    const d = Number(days);
    if (!plan && (!Number.isInteger(d) || d < 1 || d > 730)) return setLocal("Duration must be a whole number of days between 1 and 730.");
    setLocal(null);
    const body = plan
      ? { name: name.trim(), priceInSmallestUnit: smallest, advancedSearch: adv }
      : { code: code.trim(), name: name.trim(), currency, priceInSmallestUnit: smallest, durationDays: d, advancedSearch: adv };
    const res = await save.run(body);
    if (res !== undefined) onDone(plan ? `Saved “${name.trim()}”.` : `Created “${name.trim()}”.`);
  }

  return (
    <Modal
      title={plan ? `Edit ${plan.name}` : "New membership plan"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plan-form" disabled={save.pending}>{save.pending ? "Saving…" : plan ? "Save changes" : "Create plan"}</Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="space-y-4">
        {!plan && (
          <div>
            <FieldLabel htmlFor="plan-code">Plan code</FieldLabel>
            <Input id="plan-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PLAN_2MONTH_INR" maxLength={40} />
            <p className="mt-1 text-xs text-rz-muted">Letters, digits and underscores. It cannot be changed later.</p>
            {fieldIssue(save.error, "code") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "code")}</p>}
          </div>
        )}
        <div>
          <FieldLabel htmlFor="plan-name">Name shown to members</FieldLabel>
          <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel htmlFor="plan-currency">Currency</FieldLabel>
            <Select id="plan-currency" value={currency} disabled={!!plan} onChange={(e) => setCurrency(e.target.value)}>
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
            </Select>
          </div>
          <div>
            <FieldLabel htmlFor="plan-price">Price</FieldLabel>
            <Input id="plan-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="499.00" />
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="plan-days">Duration (days)</FieldLabel>
          <Input id="plan-days" inputMode="numeric" value={days} disabled={!!plan} onChange={(e) => setDays(e.target.value)} />
          {plan && <p className="mt-1 text-xs text-rz-muted">Fixed once a plan exists — members and invoices refer to it.</p>}
        </div>
        <label className="flex items-start gap-2 text-sm text-rz-text">
          <input type="checkbox" className="rz-focus mt-0.5 h-4 w-4 accent-rz-maroon" checked={adv} onChange={(e) => setAdv(e.target.checked)} />
          <span>
            Includes advanced search
            <span className="block text-xs text-rz-muted">Height, education, profession, income and profile-ID filters. Takes effect immediately for members on this plan.</span>
          </span>
        </label>
        {local && <p role="alert" className="text-sm text-rz-danger">{local}</p>}
        <ActionError error={save.error} />
      </form>
    </Modal>
  );
}

function ToggleDialog({ plan, onClose, onDone }: { plan: AdminPlanRow; onClose: () => void; onDone: (m: string) => void }) {
  const turningOff = plan.isActive;
  const act = useAction(() => adminApi.patch(`/membership-plans/${plan.id}`, { isActive: !plan.isActive }));
  return (
    <Modal
      title={turningOff ? `Stop selling ${plan.name}?` : `Resume selling ${plan.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant={turningOff ? "outline" : "primary"}
            disabled={act.pending}
            onClick={async () => {
              const res = await act.run();
              if (res !== undefined) onDone(turningOff ? `“${plan.name}” is no longer on sale.` : `“${plan.name}” is on sale again.`);
            }}
          >
            {act.pending ? "Working…" : turningOff ? "Stop selling" : "Resume selling"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-rz-text">
        {turningOff
          ? `It disappears from the plan list and from checkout and renewal. ${plan.activeMembers} member${plan.activeMembers === 1 ? "" : "s"} currently on this plan keep their benefits until it expires.`
          : "It appears in the plan list again and can be bought and renewed."}
      </p>
      <ActionError error={act.error} className="mt-3" />
    </Modal>
  );
}
