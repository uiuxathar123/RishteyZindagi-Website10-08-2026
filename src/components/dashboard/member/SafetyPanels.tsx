"use client";

import { Flag, Loader2, ShieldOff } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ActionError } from "@/components/profile/ActionError";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Select, Textarea } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { BlockView, ReportCategory } from "@/lib/api/types";

/** Confirm-then-block. `onBlocked` fires only after the API answered OK. */
export function BlockPanel({ userId, name, onClose, onBlocked }: { userId: string; name: string; onClose: () => void; onBlocked: () => void }) {
  const [reason, setReason] = useState("");
  const block = useAction(async () => {
    await api.post<{ block: BlockView }>("/interactions/blocks", { targetUserId: userId, reason: reason.trim() || undefined });
    return true as const;
  });
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (await block.run()) onBlocked();
  }

  return (
    <form onSubmit={confirm} className="mt-4 rounded-lg border border-rz-danger/30 bg-rz-danger/5 p-4" aria-label={`Block ${name}`}>
      <p className="font-serif text-base font-semibold text-rz-navy">Block {name}?</p>
      <p className="mt-1 text-sm text-rz-muted">
        You won&apos;t see each other in search, matches or chat, and neither of you will be able to open the other&apos;s profile. You can unblock later from Settings.
      </p>
      <FieldLabel htmlFor="block-reason" className="mt-3">
        Reason (optional, only you and our team see it)
      </FieldLabel>
      <Textarea ref={first} id="block-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[72px]" />
      <ActionError error={block.error} className="mt-2 text-sm text-rz-danger" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={block.pending} className="!bg-rz-danger hover:!bg-rz-danger/90" icon={block.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}>
          {block.pending ? "Blocking…" : `Block ${name}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={block.pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Report form: categories come from GET /reports/categories, submit is POST /reports. */
export function ReportPanel({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const cats = useAsync((signal) => api.get<{ categories: ReportCategory[] }>("/reports/categories", { signal }), []);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState(false);
  const submit = useAction(async () => {
    await api.post("/reports", { reportedUserId: userId, categoryId, description: description.trim() || undefined });
    return true as const;
  });
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), [cats.data]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) return;
    if (await submit.run()) setDone(true);
  }

  if (done) {
    return (
      <div className="mt-4 rounded-lg border border-rz-success/30 bg-rz-success/5 p-4" role="status">
        <p className="font-serif text-base font-semibold text-rz-navy">Report submitted</p>
        <p className="mt-1 text-sm text-rz-muted">Thank you. Our team will review your report about {name}.</p>
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="mt-4 rounded-lg border border-rz-border bg-white p-4" aria-label={`Report ${name}`}>
      <p className="font-serif text-base font-semibold text-rz-navy">Report {name}</p>
      <p className="mt-1 text-sm text-rz-muted">Tell us what&apos;s wrong. Reports are reviewed by our team and the member isn&apos;t told who reported them.</p>
      {cats.data === null && cats.loading ? (
        <div className="mt-3 h-12 animate-pulse rounded-md bg-rz-border/40" role="status" aria-label="Loading reasons" />
      ) : cats.data === null && cats.error ? (
        <div className="mt-3">
          <ApiErrorView error={cats.error} onRetry={cats.reload} />
        </div>
      ) : (
        <>
          <FieldLabel htmlFor="report-category" className="mt-3">
            Reason
          </FieldLabel>
          <Select ref={first} id="report-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">Select a reason</option>
            {(cats.data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {categoryId && <p className="mt-1.5 text-xs text-rz-muted">{cats.data?.categories.find((c) => c.id === categoryId)?.description}</p>}
          <FieldLabel htmlFor="report-description" className="mt-3">
            Details (optional)
          </FieldLabel>
          <Textarea id="report-description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[96px]" />
          <ActionError error={submit.error} className="mt-2 text-sm text-rz-danger" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!categoryId || submit.pending} icon={submit.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}>
              {submit.pending ? "Submitting…" : "Submit report"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={submit.pending}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
