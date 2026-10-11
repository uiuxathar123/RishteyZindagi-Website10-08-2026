"use client";

/** `/admin/groups` — create community groups and moderate their posts and members (B19, `groups.manage`). */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { AdminGroupMember, AdminGroupPost, AdminGroupView } from "@/lib/api/b19-types";
import type { Page } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { MessagesSquare, Plus } from "lucide-react";
import { useState } from "react";
import { ActionError, Modal, PageHeader, Pagination, fieldIssue } from "./AdminUi";

export function GroupsClient() {
  const list = useAsync((signal) => adminApi.get<{ groups: AdminGroupView[] }>("/groups", { signal }), []);
  const [editing, setEditing] = useState<AdminGroupView | "new" | null>(null);
  const [moderating, setModerating] = useState<AdminGroupView | null>(null);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Community Groups"
        icon={<MessagesSquare className="h-5 w-5 text-rz-maroon" strokeWidth={1.8} />}
        description="Create the discussion circles members can join, and moderate what is posted in them."
        actions={<Button size="sm" onClick={() => setEditing("new")} icon={<Plus className="h-4 w-4" />}>New group</Button>}
      />
      <AsyncView data={list.data} error={list.error} loading={list.loading} reload={list.reload} skeleton={<ListSkeleton rows={3} />}>
        {(d) =>
          d.groups.length === 0 ? (
            <p className="rounded-lg border border-rz-border bg-white p-6 text-sm text-rz-muted" data-testid="groups-empty">No groups yet.</p>
          ) : (
            <ul className="space-y-3" data-testid="admin-groups-list">
              {d.groups.map((g) => (
                <li key={g.id} className="rounded-lg border border-rz-border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-rz-navy">{g.name}</p>
                    <span className={g.isActive ? "rounded-full bg-rz-success/10 px-2.5 py-0.5 text-xs font-semibold text-rz-success" : "rounded-full bg-rz-cream px-2.5 py-0.5 text-xs font-semibold text-rz-muted"}>{g.isActive ? "Active" : "Inactive"}</span>
                  </div>
                  {g.description && <p className="mt-1 text-sm text-rz-text">{g.description}</p>}
                  <p className="mt-2 text-xs text-rz-muted">{g.memberCount} members · {g.postCount} posts{g.openReportCount > 0 && <> · <strong className="text-rz-maroon">{g.openReportCount} reported</strong></>}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setModerating(g)}>Moderate</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Edit</Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
      {editing && <GroupDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {moderating && <ModerationDialog group={moderating} onClose={() => { setModerating(null); list.reload(); }} />}
    </div>
  );
}

function GroupDialog({ row, onClose, onSaved }: { row: AdminGroupView | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [isActive, setActive] = useState(row?.isActive ?? true);
  const save = useAction((body: Record<string, unknown>) => (row ? adminApi.patch(`/groups/${row.id}`, body) : adminApi.post("/groups", body)));
  return (
    <Modal
      title={row ? "Edit group" : "New group"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={save.pending} onClick={async () => { if (await save.run({ name: name.trim(), description: description.trim(), isActive })) onSaved(); }}>{save.pending ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <FieldLabel htmlFor="gr-name">Name</FieldLabel>
          <Input id="gr-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          {fieldIssue(save.error, "name") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "name")}</p>}
        </div>
        <div>
          <FieldLabel htmlFor="gr-desc">Description</FieldLabel>
          <Textarea id="gr-desc" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Toggle checked={isActive} onChange={setActive} label="Active" description="Inactive groups disappear from members' lists. Nothing is deleted." />
        <ActionError error={save.error} />
      </div>
    </Modal>
  );
}

type Tab = "all" | "reported" | "hidden" | "members";

function ModerationDialog({ group, onClose }: { group: AdminGroupView; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("reported");
  const [page, setPage] = useState(1);
  const posts = useAsync(
    (signal) => (tab === "members" ? Promise.resolve(null) : adminApi.get<Page<AdminGroupPost>>(`/groups/${group.id}/posts`, { query: { filter: tab, page, pageSize: 10 }, signal })),
    [group.id, tab, page]
  );
  const members = useAsync((signal) => (tab === "members" ? adminApi.get<{ members: AdminGroupMember[] }>(`/groups/${group.id}/members`, { signal }) : Promise.resolve(null)), [group.id, tab]);
  const [target, setTarget] = useState<{ kind: "post"; id: string; hide: boolean } | { kind: "member"; id: string; remove: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const act = useAction(async () => {
    if (!target) return;
    if (target.kind === "post") await adminApi.patch(`/group-posts/${target.id}`, { hidden: target.hide, ...(target.hide ? { reason: reason.trim() } : {}) });
    else await adminApi.patch(`/groups/${group.id}/members/${target.id}`, { removed: target.remove, ...(target.remove ? { reason: reason.trim() } : {}) });
    return true;
  });
  async function confirm() {
    if (await act.run()) {
      setTarget(null);
      setReason("");
      posts.reload();
      members.reload();
    }
  }
  const needsReason = (target?.kind === "post" && target.hide) || (target?.kind === "member" && target.remove);
  const tabs: Tab[] = ["reported", "all", "hidden", "members"];
  return (
    <Modal title={`Moderate: ${group.name}`} onClose={onClose} footer={<Button type="button" variant="ghost" onClick={onClose}>Close</Button>}>
      <div role="tablist" aria-label="Moderation view" className="mb-3 flex gap-2">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => { setTab(t); setPage(1); setTarget(null); }} className={tab === t ? "rounded-full bg-rz-maroon px-3 py-1 text-xs font-semibold text-white" : "rounded-full bg-rz-cream px-3 py-1 text-xs font-semibold text-rz-navy"}>
            {t === "all" ? "All posts" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {target && (
        <div className="mb-3 rounded border border-rz-border bg-rz-cream/50 p-3" data-testid="group-action-box">
          {needsReason ? (
            <>
              <FieldLabel htmlFor="gr-reason">Reason (kept in the audit log)</FieldLabel>
              <Input id="gr-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </>
          ) : (
            <p className="text-sm text-rz-text">Restore this {target.kind === "post" ? "post" : "member"}?</p>
          )}
          <ActionError error={act.error} className="mt-2" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={act.pending || (needsReason && reason.trim().length < 5)} onClick={confirm}>{act.pending ? "Saving…" : "Confirm"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {tab === "members" ? (
        <AsyncView data={members.data} error={members.error} loading={members.loading} reload={members.reload} skeleton={<ListSkeleton rows={3} />}>
          {(d) =>
            d.members.length === 0 ? (
              <p className="text-sm text-rz-muted">No members yet.</p>
            ) : (
              <ul className="divide-y divide-rz-border">
                {d.members.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span><strong className="text-rz-navy">{m.name}</strong> <span className="text-xs text-rz-muted">· joined {formatDateTime(m.joinedAt)}{m.status === "REMOVED" && m.removedReason ? ` · removed: ${m.removedReason}` : ""}</span></span>
                    <Button size="sm" variant="outline" onClick={() => { setTarget({ kind: "member", id: m.userId, remove: m.status === "ACTIVE" }); setReason(""); }}>{m.status === "ACTIVE" ? "Remove" : "Restore"}</Button>
                  </li>
                ))}
              </ul>
            )
          }
        </AsyncView>
      ) : (
        <AsyncView data={posts.data} error={posts.error} loading={posts.loading} reload={posts.reload} skeleton={<ListSkeleton rows={3} />}>
          {(d) =>
            d.items.length === 0 ? (
              <p className="text-sm text-rz-muted">{tab === "reported" ? "No reported posts." : "Nothing here."}</p>
            ) : (
              <>
                <ul className="space-y-3">
                  {d.items.map((p) => (
                    <li key={p.id} className="rounded border border-rz-border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-rz-muted">
                        <span><strong className="text-rz-navy">{p.authorName}</strong> · {formatDateTime(p.createdAt)}</span>
                        <span>{p.reportCount > 0 && <strong className="mr-2 text-rz-maroon">{p.reportCount} report{p.reportCount === 1 ? "" : "s"}</strong>}{p.status === "HIDDEN" ? "Hidden" : "Visible"}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-rz-text">{p.body}</p>
                      {p.status === "HIDDEN" && p.hiddenReason && <p className="mt-1 text-xs text-rz-muted">Reason: {p.hiddenReason}</p>}
                      <div className="mt-2">
                        <Button size="sm" variant="outline" onClick={() => { setTarget({ kind: "post", id: p.id, hide: p.status !== "HIDDEN" }); setReason(""); }}>{p.status === "HIDDEN" ? "Restore" : "Hide…"}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Pagination page={d.page} totalPages={d.totalPages} total={d.total} pageSize={d.pageSize} onPage={setPage} disabled={posts.loading} />
              </>
            )
          }
        </AsyncView>
      )}
    </Modal>
  );
}
