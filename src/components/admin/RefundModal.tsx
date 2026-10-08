"use client";

/**
 * Refunds for one payment: history (from the gateway-backed refunds table) plus a new-refund form.
 * The refundable balance is computed by the server (captured amount minus refunds that are PENDING or
 * PROCESSED); the amount typed here is only a request — the server re-checks it under a row lock and
 * the gateway makes the final decision. "Processed" is shown only when the gateway confirmed it.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { RefundRowView, RefundsResponse } from "@/lib/api/pcp-types";
import { formatDateTime, formatMoney, humanize } from "@/lib/format";
import { useState } from "react";
import { ActionError, fieldIssue, Modal, SuccessNote } from "./AdminUi";

const TONE: Record<string, "success" | "gold" | "maroon" | "neutral"> = { PROCESSED: "success", PENDING: "gold", FAILED: "maroon" };

export function RefundModal({ paymentId, currency, onClose, onChanged }: { paymentId: string; currency: string; onClose: () => void; onChanged: () => void }) {
  const data = useAsync((signal) => adminApi.get<RefundsResponse>(`/payments/${paymentId}/refunds`, { signal }), [paymentId]);
  return (
    <Modal title="Refunds" onClose={onClose} variant="drawer">
      <AsyncView data={data.data} error={data.error} loading={data.loading} reload={data.reload} skeleton={<ListSkeleton rows={3} />}>
        {(d) => (
          <RefundBody
            data={d}
            paymentId={paymentId}
            currency={currency}
            onCreated={() => {
              data.reload();
              onChanged();
            }}
          />
        )}
      </AsyncView>
    </Modal>
  );
}

function RefundBody({ data, paymentId, currency, onCreated }: { data: RefundsResponse; paymentId: string; currency: string; onCreated: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const create = useAction((body: { amountInPaise?: number; reason: string }) => adminApi.post<{ refund: RefundRowView }>(`/payments/${paymentId}/refunds`, body));

  const trimmed = amount.trim();
  const rupees = trimmed === "" ? null : Number(trimmed);
  const paise = rupees === null ? null : Math.round(rupees * 100);
  const amountInvalid = rupees !== null && (!Number.isFinite(rupees) || rupees <= 0 || paise! > data.refundableInPaise || Math.abs(rupees * 100 - paise!) > 1e-6);
  const canRefund = data.refundableInPaise > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    const res = await create.run({ ...(paise !== null ? { amountInPaise: paise } : {}), reason: reason.trim() });
    if (!res) return;
    setNote(res.refund.status === "PROCESSED" ? "Refund processed." : "Refund initiated — the gateway has not confirmed it yet; its status will update automatically.");
    setAmount("");
    setReason("");
    onCreated();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm">
        Refundable balance: <strong>{formatMoney(data.refundableInPaise, currency)}</strong>
      </p>

      {data.refunds.length === 0 ? (
        <p className="text-sm text-rz-muted">No refunds yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.refunds.map((r) => (
            <li key={r.id} className="rounded-md border border-rz-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[r.status] ?? "neutral"}>{humanize(r.status)}</Badge>
                <span className="font-medium text-rz-navy">{formatMoney(r.amountInPaise, r.currency)}</span>
                <span className="text-[12px] text-rz-muted">{formatDateTime(r.createdAt)}</span>
              </div>
              <p className="mt-1 break-words text-rz-text">{r.reason}</p>
              {r.failureReason && <p className="mt-1 text-[12.5px] text-rz-danger">{r.failureReason}</p>}
            </li>
          ))}
        </ul>
      )}

      {note && <SuccessNote>{note}</SuccessNote>}

      {canRefund ? (
        <form onSubmit={onSubmit} className="space-y-4 border-t border-rz-border pt-4">
          <h3 className="font-serif text-base font-semibold text-rz-navy">New refund</h3>
          <div>
            <FieldLabel htmlFor="refund-amount">Amount (leave blank to refund the full balance)</FieldLabel>
            <Input id="refund-amount" inputMode="decimal" placeholder={(data.refundableInPaise / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amountInvalid || !!fieldIssue(create.error, "amountInPaise")} />
            {amountInvalid && <p className="mt-1 text-[12.5px] text-rz-danger">Enter an amount up to the refundable balance, with at most two decimals.</p>}
            {fieldIssue(create.error, "amountInPaise") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(create.error, "amountInPaise")}</p>}
          </div>
          <div>
            <FieldLabel htmlFor="refund-reason">Reason (recorded in the audit log)</FieldLabel>
            <Textarea id="refund-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
            {fieldIssue(create.error, "reason") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(create.error, "reason")}</p>}
          </div>
          <ActionError error={create.error} />
          <Button type="submit" disabled={create.pending || amountInvalid || reason.trim().length < 3}>
            {create.pending ? "Sending to gateway…" : "Issue refund"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-rz-muted">Nothing left to refund on this payment.</p>
      )}
    </div>
  );
}
