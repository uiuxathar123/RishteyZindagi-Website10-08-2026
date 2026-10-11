"use client";

/** `/admin/stories` — real success stories shown on the public site (B19, `content.manage`). */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { StoryRow } from "@/lib/api/b19-types";
import { Heart, Plus } from "lucide-react";
import { useState } from "react";
import { ActionError, Modal, PageHeader, fieldIssue } from "./AdminUi";

type Draft = { coupleNames: string; location: string; year: string; story: string; sortOrder: string; consentConfirmed: boolean; isPublished: boolean };
const blank: Draft = { coupleNames: "", location: "", year: String(new Date().getFullYear()), story: "", sortOrder: "0", consentConfirmed: false, isPublished: false };

export function StoriesClient() {
  const list = useAsync((signal) => adminApi.get<{ stories: StoryRow[] }>("/success-stories", { signal }), []);
  const [editing, setEditing] = useState<StoryRow | "new" | null>(null);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Success Stories"
        icon={<Heart className="h-5 w-5 text-rz-maroon" strokeWidth={1.8} />}
        description="Add real stories with the couple's permission. Until at least one is published, the public page shows clearly-labelled sample stories."
        actions={<Button size="sm" onClick={() => setEditing("new")} icon={<Plus className="h-4 w-4" />}>Add story</Button>}
      />
      <AsyncView data={list.data} error={list.error} loading={list.loading} reload={list.reload} skeleton={<ListSkeleton rows={3} />}>
        {(d) =>
          d.stories.length === 0 ? (
            <p className="rounded-lg border border-rz-border bg-white p-6 text-sm text-rz-muted" data-testid="stories-empty">No stories yet.</p>
          ) : (
            <ul className="space-y-3" data-testid="stories-list">
              {d.stories.map((s) => (
                <li key={s.id} className="rounded-lg border border-rz-border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-rz-navy">{s.coupleNames} <span className="text-xs font-normal text-rz-muted">· {s.location} · {s.year}</span></p>
                    <span className={s.isPublished ? "rounded-full bg-rz-success/10 px-2.5 py-0.5 text-xs font-semibold text-rz-success" : "rounded-full bg-rz-cream px-2.5 py-0.5 text-xs font-semibold text-rz-muted"}>{s.isPublished ? "Published" : "Draft"}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-rz-text">{s.story}</p>
                  <div className="mt-3"><Button size="sm" variant="outline" onClick={() => setEditing(s)}>Edit</Button></div>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
      {editing && <StoryDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function StoryDialog({ row, onClose, onSaved }: { row: StoryRow | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(row ? { coupleNames: row.coupleNames, location: row.location, year: String(row.year), story: row.story, sortOrder: String(row.sortOrder), consentConfirmed: row.consentConfirmed, isPublished: row.isPublished } : blank);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAction((body: Record<string, unknown>) => (row ? adminApi.patch(`/success-stories/${row.id}`, body) : adminApi.post("/success-stories", body)));
  const del = useAction(() => adminApi.delete(`/success-stories/${row!.id}`));
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));

  async function submit() {
    const res = await save.run({ coupleNames: d.coupleNames.trim(), location: d.location.trim(), year: Number(d.year), story: d.story.trim(), sortOrder: Number(d.sortOrder) || 0, consentConfirmed: d.consentConfirmed, isPublished: d.isPublished });
    if (res) onSaved();
  }
  return (
    <Modal
      title={row ? "Edit story" : "Add story"}
      onClose={onClose}
      footer={
        <>
          {row && <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete…</Button>}
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={save.pending} onClick={submit}>{save.pending ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div><FieldLabel htmlFor="st-names">Couple</FieldLabel><Input id="st-names" maxLength={120} value={d.coupleNames} onChange={set("coupleNames")} placeholder="Priya & Rahul" />{fieldIssue(save.error, "coupleNames") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "coupleNames")}</p>}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><FieldLabel htmlFor="st-loc">Location</FieldLabel><Input id="st-loc" maxLength={120} value={d.location} onChange={set("location")} /></div>
          <div><FieldLabel htmlFor="st-year">Year</FieldLabel><Input id="st-year" inputMode="numeric" value={d.year} onChange={set("year")} /></div>
        </div>
        <div><FieldLabel htmlFor="st-story">Story (30–1500 characters)</FieldLabel><Textarea id="st-story" rows={6} maxLength={1500} value={d.story} onChange={set("story")} />{fieldIssue(save.error, "story") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "story")}</p>}</div>
        <div><FieldLabel htmlFor="st-order">Order (lower shows first)</FieldLabel><Input id="st-order" inputMode="numeric" value={d.sortOrder} onChange={set("sortOrder")} /></div>
        <Toggle checked={d.consentConfirmed} onChange={(v) => setD((x) => ({ ...x, consentConfirmed: v, ...(v ? {} : { isPublished: false }) }))} label="The couple has agreed to this story being shown publicly" description="Required before publishing. Do not tick this on someone's behalf." />
        <Toggle checked={d.isPublished} disabled={!d.consentConfirmed} onChange={(v) => setD((x) => ({ ...x, isPublished: v }))} label="Published on the public Success Stories page" />
        <ActionError error={save.error} />
        {confirmDelete && (
          <div className="rounded-md border border-rz-danger/30 bg-rz-danger/5 p-3 text-sm">
            <p className="text-rz-text">Delete this story permanently?</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={del.pending} onClick={async () => { const r = await del.run(); if (r) onSaved(); }}>{del.pending ? "Deleting…" : "Delete story"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </div>
            <ActionError error={del.error} className="mt-2" />
          </div>
        )}
      </div>
    </Modal>
  );
}
