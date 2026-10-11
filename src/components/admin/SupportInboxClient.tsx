"use client";

/** `/admin/inbox` — contact-form messages and the public support contact details (B19, `support.manage`). */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { ContactMessagePage, ContactMessageRow, SupportContactAdmin } from "@/lib/api/b19-types";
import { formatDateTime } from "@/lib/format";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { ActionError, Card, PageHeader, Pagination, SuccessNote } from "./AdminUi";

const TABS = [
  { key: "NEW", label: "New" },
  { key: "READ", label: "Read" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "", label: "All" },
] as const;

export function SupportInboxClient() {
  const [status, setStatus] = useState<string>("NEW");
  const [page, setPage] = useState(1);
  const list = useAsync((signal) => adminApi.get<ContactMessagePage>("/contact-messages", { query: { ...(status ? { status } : {}), page, pageSize: 20 }, signal }), [status, page]);
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Support Inbox"
        icon={<Inbox className="h-5 w-5 text-rz-navy" strokeWidth={1.8} />}
        description={list.data ? `${list.data.newCount} new message${list.data.newCount === 1 ? "" : "s"} from the Contact page` : "Messages sent from the public Contact page"}
      />
      <ContactDetailsForm />
      <div role="tablist" aria-label="Message status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.label} role="tab" aria-selected={status === t.key} onClick={() => { setStatus(t.key); setPage(1); }}
            className={status === t.key ? "rounded-full bg-rz-navy px-4 py-1.5 text-sm font-semibold text-white" : "rounded-full border border-rz-border px-4 py-1.5 text-sm text-rz-text hover:bg-rz-cream"}>
            {t.label}
          </button>
        ))}
      </div>
      <AsyncView data={list.data} error={list.error} loading={list.loading} reload={list.reload} skeleton={<ListSkeleton rows={4} />}>
        {(d) =>
          d.items.length === 0 ? (
            <p className="rounded-lg border border-rz-border bg-white p-6 text-sm text-rz-muted" data-testid="inbox-empty">No messages here.</p>
          ) : (
            <>
              <ul className="space-y-3" data-testid="inbox-list">
                {d.items.map((m) => <MessageCard key={m.id} m={m} onChanged={list.reload} />)}
              </ul>
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} totalPages={Math.max(1, Math.ceil(d.total / d.pageSize))} onPage={setPage} />
            </>
          )
        }
      </AsyncView>
    </div>
  );
}

function MessageCard({ m, onChanged }: { m: ContactMessageRow; onChanged: () => void }) {
  const [note, setNote] = useState(m.adminNote ?? "");
  const save = useAction((body: Record<string, unknown>) => adminApi.patch(`/contact-messages/${m.id}`, body));
  async function apply(body: Record<string, unknown>) {
    const res = await save.run(body);
    if (res) onChanged();
  }
  return (
    <li className="rounded-lg border border-rz-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-rz-navy">{m.subject}</p>
          <p className="text-xs text-rz-muted">
            {m.name} · <a className="underline" href={`mailto:${m.email}`}>{m.email}</a> · {m.topic.toLowerCase()} · {formatDateTime(m.createdAt)}
          </p>
        </div>
        <span className="rounded-full bg-rz-cream px-2.5 py-0.5 text-xs font-semibold text-rz-navy">{m.status}</span>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-rz-text">{m.message}</p>
      <div className="mt-3">
        <FieldLabel htmlFor={`note-${m.id}`}>Internal note</FieldLabel>
        <Textarea id={`note-${m.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {m.status !== "READ" && <Button size="sm" variant="outline" disabled={save.pending} onClick={() => apply({ status: "READ", adminNote: note })}>Mark read</Button>}
        {m.status !== "RESOLVED" && <Button size="sm" disabled={save.pending} onClick={() => apply({ status: "RESOLVED", adminNote: note })}>Resolve</Button>}
        {m.status !== "NEW" && <Button size="sm" variant="ghost" disabled={save.pending} onClick={() => apply({ status: "NEW" })}>Reopen</Button>}
        {note !== (m.adminNote ?? "") && <Button size="sm" variant="ghost" disabled={save.pending} onClick={() => apply({ adminNote: note })}>Save note</Button>}
      </div>
      <ActionError error={save.error} className="mt-2" />
    </li>
  );
}

function ContactDetailsForm() {
  const view = useAsync((signal) => adminApi.get<SupportContactAdmin>("/support-contact", { signal }), []);
  return (
    <Card title="Public contact details" description="Shown on the Contact page. Leave a field empty to hide it.">
      <div className="p-5">
        <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={2} />}>
          {(v) => <DetailsBody view={v} onSaved={view.setData} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function DetailsBody({ view, onSaved }: { view: SupportContactAdmin; onSaved: (v: SupportContactAdmin) => void }) {
  const [c, setC] = useState(view.contact);
  const [saved, setSaved] = useState(false);
  const save = useAction((body: SupportContactAdmin["contact"]) => adminApi.patch<SupportContactAdmin>("/support-contact", body));
  const dirty = JSON.stringify(c) !== JSON.stringify(view.contact);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const res = await save.run(c);
    if (res) { onSaved(res); setSaved(true); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Public contact details" data-testid="support-details-form">
      <div className="grid gap-4 sm:grid-cols-3">
        <div><FieldLabel htmlFor="sc-email">Support e-mail</FieldLabel><Input id="sc-email" type="email" maxLength={200} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
        <div><FieldLabel htmlFor="sc-phone">Phone</FieldLabel><Input id="sc-phone" maxLength={40} value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
        <div><FieldLabel htmlFor="sc-hours">Hours</FieldLabel><Input id="sc-hours" maxLength={120} value={c.hours} onChange={(e) => setC({ ...c, hours: e.target.value })} placeholder="Mon–Sat, 10am–6pm" /></div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!dirty || save.pending}>{save.pending ? "Saving…" : "Save contact details"}</Button>
      </div>
      <ActionError error={save.error} />
      {saved && !dirty && <SuccessNote>Saved. The Contact page shows these details now.</SuccessNote>}
    </form>
  );
}
