"use client";

/** `/dashboard/groups` — admin-curated community groups: join, read, post, report (B19). */
import { ArrowLeft, Flag, Loader2, Trash2, Users } from "lucide-react";
import { FormEvent, useState } from "react";
import { ActionError } from "@/components/profile/ActionError";
import { ApiErrorView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { GroupPostView, GroupView } from "@/lib/api/b19-types";
import type { Page } from "@/lib/api/types";
import { timeAgo } from "@/lib/format";

export function GroupsView() {
  const list = useAsync((signal) => api.get<{ groups: GroupView[] }>("/groups", { signal }), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const join = useAction((id: string) => api.post<{ group: GroupView }>(`/groups/${id}/join`));
  const leave = useAction((id: string) => api.post(`/groups/${id}/leave`));
  const open = list.data?.groups.find((g) => g.id === openId);

  if (open && open.joined) {
    return (
      <GroupThread
        group={open}
        onBack={() => setOpenId(null)}
        onLeave={async () => {
          if (await leave.run(open.id)) {
            setOpenId(null);
            list.reload();
          }
        }}
        leaveError={leave.error}
      />
    );
  }
  if (list.loading && !list.data) return <ListSkeleton rows={3} />;
  if (list.error && !list.data) return <ApiErrorView error={list.error} onRetry={list.reload} />;
  const groups = list.data?.groups ?? [];
  if (groups.length === 0) return <EmptyState title="No groups yet" description="Groups are created by our team. Check back soon." />;
  return (
    <div className="space-y-3" data-testid="groups-list">
      <ActionError error={join.error} />
      {groups.map((g) => (
        <article key={g.id} className="rounded-lg border border-rz-border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-serif text-base font-semibold text-rz-navy">{g.name}</h3>
              {g.description && <p className="mt-1 text-sm text-rz-text">{g.description}</p>}
              <p className="mt-1 flex items-center gap-1 text-xs text-rz-muted"><Users className="h-3.5 w-3.5" aria-hidden /> {g.memberCount} member{g.memberCount === 1 ? "" : "s"}</p>
            </div>
            {g.joined ? (
              <Button size="sm" onClick={() => setOpenId(g.id)}>Open</Button>
            ) : g.removed ? (
              <span className="text-xs text-rz-muted">Removed by a moderator</span>
            ) : (
              <Button size="sm" variant="outline" disabled={join.pending} onClick={async () => { if (await join.run(g.id)) { list.reload(); setOpenId(g.id); } }}>Join</Button>
            )}
          </div>
        </article>
      ))}
      <p className="text-xs text-rz-muted">You need a complete, approved profile to join. Other members see only your first name and last initial. Never share phone numbers, payment details or one-time codes in a group.</p>
    </div>
  );
}

function GroupThread({ group, onBack, onLeave, leaveError }: { group: GroupView; onBack: () => void; onLeave: () => void; leaveError: Parameters<typeof ActionError>[0]["error"] }) {
  const [page, setPage] = useState(1);
  const posts = useAsync((signal) => api.get<Page<GroupPostView>>(`/groups/${group.id}/posts`, { query: { page, pageSize: 20 }, signal }), [group.id, page]);
  const [draft, setDraft] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const send = useAction((body: string) => api.post(`/groups/${group.id}/posts`, { body }));
  const del = useAction((id: string) => api.delete(`/group-posts/${id}`));
  const report = useAction((id: string, r: string) => api.post(`/group-posts/${id}/report`, { reason: r }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (await send.run(text)) {
      setDraft("");
      if (page !== 1) setPage(1);
      else posts.reload();
    }
  }
  return (
    <div className="rounded-lg border border-rz-border bg-white" data-testid="group-thread">
      <div className="flex items-center gap-3 border-b border-rz-border px-4 py-3">
        <button type="button" aria-label="Back to groups" onClick={onBack} className="rz-focus flex h-9 w-9 items-center justify-center rounded-full text-rz-navy"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-sm font-semibold text-rz-navy">{group.name}</p>
          <p className="text-xs text-rz-muted">{group.memberCount} members</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onLeave}>Leave</Button>
      </div>
      <div className="space-y-3 px-4 py-4">
        <ActionError error={leaveError} />
        <form onSubmit={submit} className="space-y-2">
          <Textarea aria-label="Write a post" rows={3} maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Share something with the group…" />
          <ActionError error={send.error} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-rz-muted">{draft.length}/1000</span>
            <Button type="submit" size="sm" disabled={send.pending || draft.trim().length === 0}>{send.pending ? "Posting…" : "Post"}</Button>
          </div>
        </form>
        {note && <p role="status" className="rounded bg-rz-success/10 px-3 py-2 text-sm text-rz-success">{note}</p>}
        <ActionError error={del.error ?? report.error} />
        {posts.loading && !posts.data ? (
          <div className="flex justify-center py-6 text-rz-muted" role="status"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : posts.error && !posts.data ? (
          <ApiErrorView error={posts.error} onRetry={posts.reload} />
        ) : posts.data && posts.data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-rz-muted">No posts yet. Start the conversation.</p>
        ) : (
          <ul className="space-y-3">
            {posts.data?.items.map((p) => (
              <li key={p.id} className="rounded-md border border-rz-border/70 p-3">
                <div className="flex items-center justify-between gap-2 text-xs text-rz-muted">
                  <span className="font-semibold text-rz-navy">{p.authorName}</span>
                  <span>{timeAgo(p.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-rz-text">{p.body}</p>
                <div className="mt-2 flex gap-3 text-xs">
                  {p.mine ? (
                    <button type="button" className="rz-focus inline-flex items-center gap-1 text-rz-muted hover:text-rz-danger" disabled={del.pending} onClick={async () => { if (await del.run(p.id)) posts.reload(); }}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</button>
                  ) : (
                    <button type="button" className="rz-focus inline-flex items-center gap-1 text-rz-muted hover:text-rz-maroon" onClick={() => { setReporting(reporting === p.id ? null : p.id); setReason(""); setNote(null); }}><Flag className="h-3.5 w-3.5" aria-hidden /> Report</button>
                  )}
                </div>
                {reporting === p.id && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input aria-label="Reason for reporting" className="rz-focus flex-1 rounded border border-rz-border px-3 py-1.5 text-sm" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong with this post?" />
                    <Button size="sm" disabled={report.pending || reason.trim().length < 3} onClick={async () => { if (await report.run(p.id, reason.trim())) { setReporting(null); setNote("Thank you — a moderator will look at it."); } }}>Send report</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {posts.data && posts.data.totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-rz-muted">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
            <span>Page {page} of {posts.data.totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= posts.data.totalPages} onClick={() => setPage(page + 1)}>Older</Button>
          </div>
        )}
      </div>
    </div>
  );
}
