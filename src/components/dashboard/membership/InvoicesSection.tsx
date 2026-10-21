"use client";

import type { AsyncState } from "@/lib/api/hooks";
import type { InvoiceDetail, InvoiceSummary } from "@/lib/api/types";
import { formatDate, formatMoney } from "@/lib/format";
import { AsyncView } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { InvoiceDownloadButton } from "@/components/membership/InvoiceDownloadButton";

/** A listed invoice plus its stored snapshot (for plan name / currency), when it could be loaded. */
export type InvoiceRow = InvoiceSummary & { detail: InvoiceDetail | null };

interface Snapshot {
  membership?: { planName?: string };
  service?: { name?: string };
  amountTax?: { currency?: string; taxAmountInSmallestUnit?: number; taxRatePercent?: number };
}

export function InvoicesSection({ state }: { state: AsyncState<InvoiceRow[]> }) {
  return (
    <AsyncView
      data={state.data}
      error={state.error}
      loading={state.loading}
      reload={state.reload}
      isEmpty={(rows) => rows.length === 0}
      empty={{ title: "No invoices yet", description: "An invoice is issued after each verified payment." }}
    >
      {(rows) => (
        <ul className="divide-y divide-rz-border rounded-lg border border-rz-border bg-white">
          {[...rows]
            .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
            .map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-rz-navy">{inv.invoiceNumber}</p>
                  <p className="text-xs text-rz-muted">
                    {[
                      formatDate(inv.issuedAt),
                      (inv.detail?.snapshot as Snapshot | undefined)?.membership?.planName ?? (inv.detail?.snapshot as Snapshot | undefined)?.service?.name,
                      currencyOf(inv) ? `Total ${formatMoney(inv.amountInPaise, currencyOf(inv)!)}${taxNote(inv)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {inv.status === "VOID" ? (
                    <Badge tone="neutral">Void</Badge>
                  ) : (
                    <Badge tone="success">{inv.status === "PAID" ? "Paid" : "Issued"}</Badge>
                  )}
                  <InvoiceDownloadButton invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} />
                </div>
              </li>
            ))}
        </ul>
      )}
    </AsyncView>
  );
}

function currencyOf(inv: InvoiceRow): string | null {
  return (inv.detail?.snapshot as Snapshot | undefined)?.amountTax?.currency ?? null;
}

function taxNote(inv: InvoiceRow): string {
  const t = (inv.detail?.snapshot as Snapshot | undefined)?.amountTax;
  return t?.taxRatePercent ? ` (incl. ${t.taxRatePercent}% tax)` : "";
}
