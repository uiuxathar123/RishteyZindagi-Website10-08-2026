"use client";

import { StatCard } from "@/components/admin/StatCard";
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { AdminDashboardStats, PaymentGatewayView } from "@/lib/api/types";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/format";
import { CreditCard, IndianRupee, ReceiptText, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionError, fieldIssue, Modal, NotAvailable, PageHeader, Pagination, ShortId, SuccessNote, td, th, useDebounced } from "./AdminUi";
import type { AdminInvoiceRow, AdminMembershipRow, AdminPaymentRow, AdminPaymentsResponse, Page } from "./adminTypes";
import { revenueRows } from "./OverviewClient";
import { RefundModal } from "./RefundModal";
import { ReconcilePanel } from "./ReconcilePanel";

type Tone = "success" | "gold" | "maroon" | "neutral" | "navy";
const PAYMENT_TONE: Record<string, Tone> = { SUCCESS: "success", PENDING: "gold", FAILED: "maroon", REFUNDED: "navy" };
const INVOICE_TONE: Record<string, Tone> = { PAID: "success", ISSUED: "gold", VOID: "neutral" };
const PAGE_SIZE = 20;

function money(amount: number, currency: string | null | undefined) {
  return currency ? formatMoney(amount, currency) : `${(amount / 100).toLocaleString("en-IN")} (currency not recorded)`;
}

/** `/admin/super/revenue` — payments, invoices and memberships straight from the billing tables. */
export function RevenueClient() {
  const dash = useAsync((signal) => adminApi.get<AdminDashboardStats>("/dashboard", { signal }), []);

  return (
    <div>
      <PageHeader
        title="Revenue"
        icon={<IndianRupee className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="Payments, invoices and memberships as recorded by the billing system."
      />

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
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard icon={TrendingUp} label="Total revenue" value={revenue.length === 0 ? "None yet" : revenue.map((r) => formatMoney(r.amount, r.currency)).join(" · ")} hint="Successful payments, all time, per currency" />
                <StatCard icon={ReceiptText} label="Successful payments" value={stats.payments.successful.toLocaleString("en-IN")} />
                <StatCard icon={CreditCard} label="Pending payments" value={stats.payments.pending.toLocaleString("en-IN")} hint="Awaiting gateway confirmation" />
                <StatCard icon={CreditCard} label="Failed payments" value={stats.payments.failed.toLocaleString("en-IN")} />
              </div>
              <p className="mt-3 text-[12.5px] text-rz-muted">
                The tiles above are database totals across all payments. The tables below are paged: rows shown are only the loaded page. Refund totals are not available (the platform records no refund amounts).
              </p>
            </>
          );
        }}
      </AsyncView>

      <ReconcilePanel onDone={dash.reload} />
      <RenewalFollowUp />

      <div className="mt-8">
        <Tabs
          items={[
            { id: "payments", label: "Payments" },
            { id: "invoices", label: "Invoices" },
            { id: "memberships", label: "Memberships" },
          ]}
        >
          {(tab) => <div className="pt-5">{tab === "payments" ? <PaymentsTab /> : tab === "invoices" ? <InvoicesTab /> : <MembershipsTab />}</div>}
        </Tabs>
      </div>
    </div>
  );
}

/** Reason prompt used by manual-activate / cancel / regenerate. */
function ReasonModal({
  title,
  intro,
  confirmLabel,
  danger,
  extra,
  run,
  onClose,
  onDone,
  pendingLabel,
}: {
  title: string;
  intro: string;
  confirmLabel: string;
  pendingLabel: string;
  danger?: boolean;
  extra?: (v: { value: string; set: (v: string) => void }) => React.ReactNode;
  run: (reason: string, extra: string) => Promise<unknown>;
  onClose: () => void;
  onDone: (result: unknown) => void;
}) {
  const [reason, setReason] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const act = useAction((r: string, x: string) => run(r, x));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await act.run(reason.trim(), extraValue.trim());
    if (res === undefined) return;
    onDone(res);
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reason-form" disabled={act.pending || !reason.trim()} className={danger ? "!bg-rz-danger hover:!bg-rz-danger/90" : undefined}>
            {act.pending ? pendingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-rz-text">{intro}</p>
        <div>
          <FieldLabel htmlFor="reason-text">Reason (recorded in the audit log)</FieldLabel>
          <Textarea id="reason-text" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-0" aria-invalid={!!fieldIssue(act.error, "reason")} />
          {fieldIssue(act.error, "reason") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(act.error, "reason")}</p>}
        </div>
        {extra?.({ value: extraValue, set: setExtraValue })}
        <ActionError error={act.error} />
      </form>
    </Modal>
  );
}

function PaymentsTab() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [activating, setActivating] = useState<AdminPaymentRow | null>(null);
  const [refunding, setRefunding] = useState<AdminPaymentRow | null>(null);
  useEffect(() => setPage(1), [status]);

  const list = useAsync(
    (signal) => adminApi.get<AdminPaymentsResponse>("/payments", { query: { status: status || undefined, page, pageSize: PAGE_SIZE }, signal }),
    [status, page]
  );
  const gateways = useAsync(async (signal) => (await adminApi.get<{ gateways: PaymentGatewayView[] }>("/payment-gateways", { signal })).gateways, []);
  const gatewayName = (id: string) => gateways.data?.find((g) => g.id === id)?.name;

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <FieldLabel htmlFor="pay-status">Payment status</FieldLabel>
        <Select id="pay-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All payments</option>
          <option value="PENDING">Pending</option>
          <option value="SUCCESS">Successful</option>
          <option value="FAILED">Failed</option>
          <option value="REFUNDED">Refunded</option>
        </Select>
      </div>
      {notice && <SuccessNote>{notice}</SuccessNote>}
      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={5} />}
        isEmpty={(d) => d.payments.length === 0}
        empty={{ title: "No payments", description: status ? "No payments with this status." : "No member has started a payment yet." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Created</th>
                    <th className={th}>Amount</th>
                    <th className={th}>Status</th>
                    <th className={th}>Gateway</th>
                    <th className={th}>Reference</th>
                    <th className={th}>Verified</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} className="border-b border-rz-border last:border-0">
                      <td className={`${td} whitespace-nowrap text-rz-muted`}>{formatDateTime(p.createdAt)}</td>
                      <td className={`${td} font-medium text-rz-navy`}>{formatMoney(p.amountInPaise, p.currency)}</td>
                      <td className={td}>
                        <Badge tone={PAYMENT_TONE[p.status] ?? "neutral"}>{humanize(p.status)}</Badge>
                      </td>
                      <td className={`${td} text-rz-muted`}>{gatewayName(p.gatewayId) ?? <ShortId id={p.gatewayId} />}</td>
                      <td className={td}>
                        <ShortId id={p.gatewayReference} />
                      </td>
                      <td className={`${td} text-rz-muted`}>
                        {p.verifiedAt ? `${formatDate(p.verifiedAt)}${p.verificationMethod ? ` · ${humanize(p.verificationMethod)}` : ""}` : "—"}
                      </td>
                      <td className={td}>
                        {p.status === "PENDING" && (
                          <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setActivating(p); }}>
                            Verify manually
                          </Button>
                        )}
                        {(p.status === "SUCCESS" || p.status === "REFUNDED") && p.currency && (
                          <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setRefunding(p); }}>
                            Refunds
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} pageSize={data.pagination.pageSize} onPage={setPage} disabled={list.loading} />
          </div>
        )}
      </AsyncView>

      {refunding && refunding.currency && (
        <RefundModal paymentId={refunding.id} currency={refunding.currency} onClose={() => setRefunding(null)} onChanged={() => list.reload()} />
      )}

      {activating && (
        <ReasonModal
          title="Verify payment manually"
          intro={`Mark this ${formatMoney(activating.amountInPaise, activating.currency)} payment as successful and activate the member's membership. Use this only after confirming the money arrived in the gateway dashboard.`}
          confirmLabel="Verify and activate"
          pendingLabel="Verifying…"
          extra={({ value, set }) => (
            <div>
              <FieldLabel htmlFor="gw-txn">Gateway transaction id (optional)</FieldLabel>
              <Input id="gw-txn" value={value} onChange={(e) => set(e.target.value)} />
            </div>
          )}
          run={(reason, txn) =>
            adminApi.post<{ payment: AdminPaymentRow; status: string }>(`/payments/${activating.id}/manual-activate`, txn ? { reason, gatewayTransactionId: txn } : { reason })
          }
          onClose={() => setActivating(null)}
          onDone={(res) => {
            const r = res as { status: string };
            setNotice(r.status === "ALREADY_RESOLVED" ? "That payment had already been resolved; nothing changed." : "Payment verified and membership activated.");
            setActivating(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function InvoicesTab() {
  const [number, setNumber] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: "cancel" | "regenerate"; invoice: AdminInvoiceRow } | null>(null);
  const q = useDebounced(number.trim());
  useEffect(() => setPage(1), [q, paymentStatus]);

  const list = useAsync(
    (signal) =>
      adminApi.get<Page<AdminInvoiceRow>>("/invoices", {
        query: { invoiceNumber: q || undefined, paymentStatus: paymentStatus || undefined, page, pageSize: PAGE_SIZE },
        signal,
      }),
    [q, paymentStatus, page]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <FieldLabel htmlFor="inv-number">Invoice number</FieldLabel>
          <Input id="inv-number" placeholder="Exact invoice number" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="inv-pay">Payment status</FieldLabel>
          <Select id="inv-pay" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            <option value="">Any</option>
            <option value="SUCCESS">Successful</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="REFUNDED">Refunded</option>
          </Select>
        </div>
      </div>
      {notice && <SuccessNote>{notice}</SuccessNote>}
      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={5} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No invoices", description: "Invoices are issued automatically when a payment succeeds." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Invoice</th>
                    <th className={th}>Member</th>
                    <th className={th}>Plan</th>
                    <th className={th}>Amount</th>
                    <th className={th}>Invoice status</th>
                    <th className={th}>Payment</th>
                    <th className={th}>Issued</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id} className="border-b border-rz-border last:border-0">
                      <td className={`${td} font-mono text-[12.5px] text-rz-text`}>{i.invoiceNumber}</td>
                      <td className={td}>
                        <ShortId id={i.userId} href={`/admin/users?user=${i.userId}`} />
                      </td>
                      <td className={`${td} text-rz-muted`}>{i.planName ?? i.planCode ?? "—"}</td>
                      <td className={`${td} font-medium text-rz-navy`}>{money(i.amountInPaise, i.currency)}</td>
                      <td className={td}>
                        <Badge tone={INVOICE_TONE[i.status] ?? "neutral"}>{humanize(i.status)}</Badge>
                      </td>
                      <td className={td}>{i.paymentStatus ? <Badge tone={PAYMENT_TONE[i.paymentStatus] ?? "neutral"}>{humanize(i.paymentStatus)}</Badge> : "—"}</td>
                      <td className={`${td} whitespace-nowrap text-rz-muted`}>{formatDate(i.issuedAt)}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(null); setAction({ kind: "regenerate", invoice: i }); }}>
                            Regenerate PDF
                          </Button>
                          {i.status !== "VOID" && (
                            <Button type="button" size="sm" variant="outline" className="!border-rz-danger !text-rz-danger hover:!bg-rz-danger/5" onClick={() => { setNotice(null); setAction({ kind: "cancel", invoice: i }); }}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
          </div>
        )}
      </AsyncView>

      {action && (
        <ReasonModal
          title={action.kind === "cancel" ? `Cancel invoice ${action.invoice.invoiceNumber}` : `Regenerate PDF for ${action.invoice.invoiceNumber}`}
          intro={
            action.kind === "cancel"
              ? "The invoice is marked void. This does not refund the payment or end the membership."
              : "Rebuilds the invoice PDF from its stored snapshot. The invoice data itself does not change."
          }
          confirmLabel={action.kind === "cancel" ? "Cancel invoice" : "Regenerate"}
          pendingLabel="Working…"
          danger={action.kind === "cancel"}
          run={(reason) => adminApi.post(`/invoices/${action.invoice.id}/${action.kind === "cancel" ? "cancel" : "regenerate"}`, { reason })}
          onClose={() => setAction(null)}
          onDone={() => {
            setNotice(action.kind === "cancel" ? `Invoice ${action.invoice.invoiceNumber} cancelled.` : `PDF for ${action.invoice.invoiceNumber} regenerated.`);
            setAction(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function MembershipsTab() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const list = useAsync(
    (signal) => adminApi.get<Page<AdminMembershipRow>>("/memberships", { query: { status: status || undefined, page, pageSize: PAGE_SIZE }, signal }),
    [status, page]
  );

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <FieldLabel htmlFor="mem-status">Membership status</FieldLabel>
        <Select id="mem-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All memberships</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING">Pending</option>
          <option value="EXPIRED">Expired</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>
      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={5} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No memberships", description: status ? "No memberships with this status." : "No member has bought a plan yet." }}
      >
        {(data) => (
          <div className="overflow-hidden rounded-lg border border-rz-border bg-white shadow-card-sm">
            <div className="relative overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[700px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Member</th>
                    <th className={th}>Plan</th>
                    <th className={th}>Status</th>
                    <th className={th}>Started</th>
                    <th className={th}>Expires</th>
                    <th className={th}>Auto-renew</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id} className="border-b border-rz-border last:border-0">
                      <td className={td}>
                        <ShortId id={m.userId} href={`/admin/users?user=${m.userId}`} />
                      </td>
                      <td className={`${td} text-rz-text`}>{m.planName ?? m.planCode ?? "—"}</td>
                      <td className={td}>
                        <Badge tone={m.status === "ACTIVE" ? "success" : m.status === "PENDING" ? "gold" : "neutral"}>{humanize(m.status)}</Badge>
                      </td>
                      <td className={`${td} text-rz-muted`}>{m.startedAt ? formatDate(m.startedAt) : "—"}</td>
                      <td className={`${td} text-rz-muted`}>{m.expiresAt ? formatDate(m.expiresAt) : "—"}</td>
                      <td className={`${td} text-rz-muted`}>{m.autoRenew ? "On" : "Off"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
          </div>
        )}
      </AsyncView>
      <NotAvailable title="Granting a membership by hand">
        There is no “grant membership” action. A membership becomes active only when its payment succeeds — use “Verify manually” on the Payments tab for a payment that really arrived.
      </NotAvailable>
    </div>
  );
}


interface RenewalOverview {
  counts: Record<"LAPSED" | "FOLLOW_UP_SENT" | "RENEWED" | "CLOSED", number>;
  recent: Array<{ membershipId: string; userId: string; planName: string | null; state: string; lapsedAt: string; lastNoticeAt: string | null }>;
  note: string;
}

/** Renewal follow-up cycles (reminders only — the platform never charges a member automatically). */
function RenewalFollowUp() {
  const view = useAsync((signal) => adminApi.get<RenewalOverview>("/renewals", { signal }), []);
  return (
    <section className="mt-8" aria-label="Renewal follow-up" data-testid="renewal-followup">
      <h3 className="font-serif text-base font-semibold text-rz-navy">Renewal follow-up</h3>
      <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={2} />}>
        {(d) => (
          <>
            <p className="mt-1 text-[12.5px] text-rz-muted">{d.note}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["LAPSED", "Lapsed"], ["FOLLOW_UP_SENT", "Reminded"], ["RENEWED", "Renewed"], ["CLOSED", "Closed, no reply"]] as const).map(([k, label]) => (
                <div key={k} className="rounded-lg border border-rz-border bg-white p-3">
                  <dt className="text-xs text-rz-muted">{label}</dt>
                  <dd className="font-serif text-xl font-semibold text-rz-navy">{d.counts[k].toLocaleString("en-IN")}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </AsyncView>
    </section>
  );
}
