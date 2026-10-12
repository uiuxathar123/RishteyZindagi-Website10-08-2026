"use client";

/** `/admin/visibility-queue` — profiles waiting for manual approval (B19, `profiles.approve`). */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { ApprovalQueuePage, ApprovalQueueItem } from "@/lib/api/b19-types";
import { formatDateTime } from "@/lib/format";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActionError, Modal, PageHeader, Pagination } from "./AdminUi";

const TABS = [
  { key: "PENDING", label: "Waiting" },
  { key: "REJECTED", label: "Rejected" },
  { key: "APPROVED", label: "Approved" },
] as const;

export function VisibilityQueueClient() {
  const [status, setStatus] = useState<(typeof TABS)[number]["key"]>("PENDING");
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<ApprovalQueueItem | null>(null);
  const [reason, setReason] = useState("");
  const list = useAsync((signal) => adminApi.get<ApprovalQueuePage>("/profile-approvals", { query: { status, page, pageSize: 20 }, signal }), [status, page]);
  const decide = useAction((a: { id: string; decision: "APPROVE" | "REJECT"; reason?: string }) =>
    adminApi.post(`/profile-approvals/${a.id}`, { decision: a.decision, ...(a.reason ? { reason: a.reason } : {}) })
  );

  async function run(item: ApprovalQueueItem, decision: "APPROVE" | "REJECT", why?: string) {
    const res = await decide.run({ id: item.profileId, decision, reason: why });
    if (res !== null && res !== undefined) {
      setRejecting(null);
      setReason("");
      list.reload();
    }
  }

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title="Visibility Queue"
        icon={<ShieldCheck className="h-5 w-5 text-rz-navy" strokeWidth={1.8} />}
        description="When manual approval is on, a profile stays hidden from other members until you approve it. Rejected members are shown your reason and can edit to resubmit."
      />
      <div role="tablist" aria-label="Queue status" className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={status === t.key}
            onClick={() => { setStatus(t.key); setPage(1); }}
            className={status === t.key ? "rounded-full bg-rz-navy px-4 py-1.5 text-sm font-semibold text-white" : "rounded-full border border-rz-border px-4 py-1.5 text-sm text-rz-text hover:bg-rz-cream"}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ActionError error={decide.error} />
      <AsyncView data={list.data} error={list.error} loading={list.loading} reload={list.reload} skeleton={<ListSkeleton rows={4} />}>
        {(d) =>
          d.items.length === 0 ? (
            <p className="rounded-lg border border-rz-border bg-white p-6 text-sm text-rz-muted" data-testid="queue-empty">Nothing here.</p>
          ) : (
            <>
              <ul className="divide-y divide-rz-border rounded-lg border border-rz-border bg-white" data-testid="queue-list">
                {d.items.map((it) => (
                  <li key={it.profileId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-rz-navy">
                        {it.displayName} <span className="font-mono text-xs font-normal text-rz-muted">{it.publicId}</span>
                      </p>
                      <p className="text-xs text-rz-muted">
                        {it.gender === "FEMALE" ? "Bride" : "Groom"} · {it.profileCompletionPercent}% complete · updated {formatDateTime(it.submittedAt)}
                      </p>
                      {it.approvalReason && <p className="mt-1 text-xs text-rz-maroon">Reason: {it.approvalReason}</p>}
                      <Link href={`/admin/users?q=${encodeURIComponent(it.publicId)}`} className="text-xs text-rz-navy underline">Open in Users</Link>
                    </div>
                    <div className="flex gap-2">
                      {it.approvalStatus !== "APPROVED" && <Button size="sm" disabled={decide.pending} onClick={() => run(it, "APPROVE")}>Approve</Button>}
                      {it.approvalStatus !== "REJECTED" && <Button size="sm" variant="outline" disabled={decide.pending} onClick={() => { decide.clearError(); setRejecting(it); }}>Reject…</Button>}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} totalPages={Math.max(1, Math.ceil(d.total / d.pageSize))} onPage={setPage} />
            </>
          )
        }
      </AsyncView>
      {rejecting && (
        <Modal
          title={`Reject ${rejecting.displayName}'s profile?`}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button type="button" disabled={decide.pending || reason.trim().length < 5} onClick={() => run(rejecting, "REJECT", reason.trim())}>{decide.pending ? "Saving…" : "Reject profile"}</Button>
            </>
          }
        >
          <FieldLabel htmlFor="rej-reason">Reason (shown to the member)</FieldLabel>
          <Textarea id="rej-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Please upload a clear photo of yourself." />
          <ActionError error={decide.error} className="mt-3" />
        </Modal>
      )}
    </div>
  );
}
