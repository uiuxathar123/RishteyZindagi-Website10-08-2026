"use client";

import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import type { AsyncState } from "@/lib/api/hooks";
import type { PaymentView, VerifyPaymentResult } from "@/lib/api/types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AsyncView } from "@/components/ui/AsyncView";
import { cn } from "@/lib/utils";

export function PaymentStatusBadge({ status }: { status: PaymentView["status"] }) {
  switch (status) {
    case "SUCCESS":
      return <Badge tone="success">Paid</Badge>;
    case "PENDING":
      return <Badge tone="gold">Pending</Badge>;
    case "FAILED":
      return <Badge className="bg-rz-danger/10 text-rz-danger">Failed</Badge>;
    case "REFUNDED":
      return <Badge tone="neutral">Refunded</Badge>;
  }
}

export function PaymentsSection({ state, onVerified }: { state: AsyncState<PaymentView[]>; onVerified: () => void }) {
  const check = useAction(async (id: string) => {
    const res = await api.post<VerifyPaymentResult>(`/payments/${id}/verify`);
    onVerified();
    return res;
  });

  return (
    <AsyncView
      data={state.data}
      error={state.error}
      loading={state.loading}
      reload={state.reload}
      isEmpty={(rows) => rows.length === 0}
      empty={{ title: "No payments yet", description: "Payments you make for a membership will appear here." }}
    >
      {(rows) => (
        <>
          {check.error && (
            <p role="alert" className="mb-3 text-sm text-rz-danger">
              {check.error.friendlyMessage}
            </p>
          )}
          <ul className="divide-y divide-rz-border rounded-lg border border-rz-border bg-white">
            {[...rows]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((p) => (
                <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3")}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-rz-navy">{formatMoney(p.amountInPaise, p.currency)}</p>
                    <p className="text-xs text-rz-muted">{formatDateTime(p.createdAt)}</p>
                    {p.gatewayReference && <p className="max-w-full break-all text-[11px] text-rz-muted">Ref: {p.gatewayReference}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <PaymentStatusBadge status={p.status} />
                    {p.status === "PENDING" && (
                      <Button size="sm" variant="outline" disabled={check.pending} onClick={() => check.run(p.id)}>
                        {check.pending ? "Checking…" : "Check status"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
    </AsyncView>
  );
}
