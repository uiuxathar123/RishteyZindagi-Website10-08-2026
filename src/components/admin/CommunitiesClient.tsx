"use client";

/**
 * `/admin/super/communities` — the community / caste pick-list members choose on their profile (B18, `communities.manage`).
 * This is a lookup list, not a social-group feature. Entries are never deleted: a retired one leaves the pick-lists and
 * can't be newly chosen, while profiles that already use it keep it.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { useReference } from "@/lib/api/lookups";
import type { AdminCommunityRow } from "@/lib/api/b18-types";
import type { Page } from "@/lib/api/types";
import { Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionError, Card, Modal, PageHeader, Pagination, SuccessNote, td, th, useDebounced } from "./AdminUi";

const PAGE_SIZE = 50;
type Dialog = { mode: "create" } | { mode: "rename"; row: AdminCommunityRow } | { mode: "toggle"; row: AdminCommunityRow };

export function CommunitiesClient() {
  const ref = useReference();
  const [query, setQuery] = useState("");
  const [religionId, setReligionId] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const q = useDebounced(query.trim());
  useEffect(() => setPage(1), [q, religionId, active]);

  const list = useAsync(
    (signal) =>
      adminApi.get<Page<AdminCommunityRow>>("/communities", {
        query: { q: q || undefined, religionId: religionId || undefined, active: active || undefined, page, pageSize: PAGE_SIZE },
        signal,
      }),
    [q, religionId, active, page]
  );
  const done = (m: string) => {
    setDialog(null);
    setNote(m);
    list.reload();
  };

  return (
    <div>
      <PageHeader
        title="Communities"
        icon={<Users className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="The community / caste choices members can pick within their religion. This is a pick-list — the product has no social groups."
        actions={
          <Button type="button" size="sm" onClick={() => { setNote(null); setDialog({ mode: "create" }); }}>
            <Plus className="h-4 w-4" aria-hidden /> Add community
          </Button>
        }
      />
      {note && <div className="mb-4"><SuccessNote>{note}</SuccessNote></div>}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_180px] sm:items-end">
        <div>
          <FieldLabel htmlFor="comm-search">Search</FieldLabel>
          <Input id="comm-search" placeholder="Community name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="comm-religion">Religion</FieldLabel>
          <Select id="comm-religion" value={religionId} onChange={(e) => setReligionId(e.target.value)}>
            <option value="">All religions</option>
            {ref.data?.religions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="comm-active">Status</FieldLabel>
          <Select id="comm-active" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">All</option>
            <option value="true">In use</option>
            <option value="false">Retired</option>
          </Select>
        </div>
      </div>
      <AsyncView
        data={list.data}
        error={list.error}
        loading={list.loading}
        reload={list.reload}
        skeleton={<ListSkeleton rows={6} />}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: "No communities found", description: "Change the filters, or add one." }}
      >
        {(data) => (
          <Card>
            <div className="overflow-x-auto" aria-busy={list.loading}>
              <table className="w-full min-w-[680px] border-collapse text-sm" data-testid="communities-table">
                <thead>
                  <tr className="border-b border-rz-border bg-rz-cream text-left">
                    <th className={th}>Community</th>
                    <th className={th}>Religion</th>
                    <th className={th}>Profiles</th>
                    <th className={th}>Status</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id} className="border-b border-rz-border last:border-0">
                      <td className={`${td} font-medium text-rz-text`}>{c.name}</td>
                      <td className={`${td} text-rz-muted`}>{c.religionName ?? "—"}</td>
                      <td className={td}>{c.profileCount}</td>
                      <td className={td}><Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "In use" : "Retired"}</Badge></td>
                      <td className={td}>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => { setNote(null); setDialog({ mode: "rename", row: c }); }} aria-label={`Rename ${c.name}`}>Rename</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setNote(null); setDialog({ mode: "toggle", row: c }); }} aria-label={`${c.isActive ? "Retire" : "Restore"} ${c.name}`}>{c.isActive ? "Retire" : "Restore"}</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} disabled={list.loading} />
          </Card>
        )}
      </AsyncView>

      {dialog?.mode === "create" && <NameDialog religions={ref.data?.religions ?? []} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.mode === "rename" && <NameDialog row={dialog.row} religions={[]} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.mode === "toggle" && <ToggleDialog row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function NameDialog({ row, religions, onClose, onDone }: { row?: AdminCommunityRow; religions: Array<{ id: string; name: string }>; onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [religionId, setReligionId] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  const save = useAction((body: Record<string, unknown>) => (row ? adminApi.patch(`/communities/${row.id}`, body) : adminApi.post("/communities", body)));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return setLocal("Enter a name of at least 2 characters.");
    if (!row && !religionId) return setLocal("Choose the religion this community belongs to.");
    setLocal(null);
    const res = await save.run(row ? { name: n } : { name: n, religionId });
    if (res !== undefined) onDone(row ? `Renamed to “${n}”.` : `Added “${n}”.`);
  }
  return (
    <Modal
      title={row ? `Rename ${row.name}` : "Add a community"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="community-form" disabled={save.pending}>{save.pending ? "Saving…" : row ? "Save" : "Add"}</Button>
        </>
      }
    >
      <form id="community-form" onSubmit={submit} className="space-y-4">
        {!row && (
          <div>
            <FieldLabel htmlFor="community-religion">Religion</FieldLabel>
            <Select id="community-religion" value={religionId} onChange={(e) => setReligionId(e.target.value)}>
              <option value="">Select…</option>
              {religions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
        )}
        <div>
          <FieldLabel htmlFor="community-name">Name</FieldLabel>
          <Input id="community-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1 text-xs text-rz-muted">Existing entries use the form “Group › Sub-group”.</p>
        </div>
        {local && <p role="alert" className="text-sm text-rz-danger">{local}</p>}
        <ActionError error={save.error} />
      </form>
    </Modal>
  );
}

function ToggleDialog({ row, onClose, onDone }: { row: AdminCommunityRow; onClose: () => void; onDone: (m: string) => void }) {
  const retiring = row.isActive;
  const act = useAction(() => adminApi.patch(`/communities/${row.id}`, { isActive: !row.isActive }));
  return (
    <Modal
      title={retiring ? `Retire ${row.name}?` : `Restore ${row.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant={retiring ? "outline" : "primary"}
            disabled={act.pending}
            onClick={async () => {
              const res = await act.run();
              if (res !== undefined) onDone(retiring ? `“${row.name}” retired.` : `“${row.name}” restored.`);
            }}
          >
            {act.pending ? "Working…" : retiring ? "Retire" : "Restore"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-rz-text">
        {retiring
          ? `Members can no longer pick it. ${row.profileCount} profile${row.profileCount === 1 ? "" : "s"} that already use it keep it, and search by it keeps working.`
          : "Members can pick it again."}
      </p>
      <ActionError error={act.error} className="mt-3" />
    </Modal>
  );
}
