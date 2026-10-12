"use client";

/**
 * "Reconcile with the payment gateway" — runs the same job a scheduler runs (B18, `payments.review`).
 * It re-reads stale pending payments and refunds from the gateway; it never closes a payment the gateway could not be asked about.
 */
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { formatDateTime, humanize } from "@/lib/format";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, Modal, SuccessNote } from "./AdminUi";

interface Run {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  stats: Record<string, number> | null;
  error: string | null;
}

const LABELS: Record<string, string> = {
  checked: "Checked",
  resolved: "Settled",
  expiredClosed: "Closed as unpaid",
  stillPending: "Still pending",
  gatewayErrors: "Gateway unreachable",
  refundsChecked: "Refunds checked",
  refundsResolved: "Refunds settled",
  lateCaptureChecked: "Late-capture checks",
};

export function ReconcilePanel({ onDone }: { onDone?: () => void }) {
  const { can } = useAdminSession();
  const allowed = can("payments.review");
  const history = useAsync((signal) => (allowed ? adminApi.get<{ runs: Run[] }>("/payments/reconcile", { signal }) : Promise.resolve({ runs: [] as Run[] })), [allowed]);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const go = useAction(() => adminApi.post<{ status: string; stats: Record<string, number> | null; message: string }>("/payments/reconcile", {}));

  if (!allowed) return null;
  const last = history.data?.runs[0];

  return (
    <Card
      className="mt-6"
      title="Reconcile with the gateway"
      description="Re-checks payments and refunds that are still pending at the gateway. Safe to run any time; nothing is changed for a payment the gateway can't confirm."
      actions={
        <Button type="button" size="sm" variant="outline" onClick={() => { setNote(null); go.clearError(); setConfirm(true); }}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Run reconciliation
        </Button>
      }
    >
      <div className="p-5 text-sm">
        {note && <div className="mb-3"><SuccessNote>{note}</SuccessNote></div>}
        {history.error ? (
          <p role="alert" className="text-rz-danger">Couldn&apos;t load the run history: {history.error.friendlyMessage}</p>
        ) : !last ? (
          <p className="text-rz-muted" data-testid="reconcile-empty">{history.loading ? "Loading…" : "No reconciliation has run yet."}</p>
        ) : (
          <div data-testid="reconcile-last">
            <p className="flex flex-wrap items-center gap-2">
              Last run <span className="text-rz-muted">{formatDateTime(last.startedAt)}</span>
              <Badge tone={last.status === "SUCCEEDED" ? "success" : last.status === "FAILED" ? "maroon" : "neutral"}>{humanize(last.status)}</Badge>
            </p>
            {last.stats && (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                {Object.entries(last.stats).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[12px] text-rz-muted">{LABELS[k] ?? humanize(k)}</dt>
                    <dd className="font-semibold text-rz-navy">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {last.error && <p className="mt-2 text-rz-danger">Error: {last.error}</p>}
          </div>
        )}
      </div>
      {confirm && (
        <Modal
          title="Run reconciliation now?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                type="button"
                disabled={go.pending}
                onClick={async () => {
                  const res = await go.run();
                  if (!res) return;
                  setConfirm(false);
                  setNote(res.message);
                  history.reload();
                  onDone?.();
                }}
              >
                {go.pending ? "Running…" : "Run now"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-rz-text">
            This asks the payment gateway about payments and refunds that are still pending and updates them to match. It is the same check that can run on a schedule. It is recorded in the audit log under your name.
          </p>
          <ActionError error={go.error} className="mt-3" />
        </Modal>
      )}
    </Card>
  );
}
