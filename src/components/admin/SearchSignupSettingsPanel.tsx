"use client";

/**
 * Super Admin controls for search and sign-up (B18, `platform.settings.manage`):
 * page sizes, whether advanced-search filters need a plan, and whether new sign-ups are open.
 * The server validates every value (and audits previous → new); this form only shows what it returns.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { PlatformSettingsView } from "@/lib/api/b18-types";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { ActionError, Card, fieldIssue, Modal, SuccessNote } from "./AdminUi";

export function SearchSignupSettingsPanel() {
  const view = useAsync((signal) => adminApi.get<PlatformSettingsView>("/platform-settings", { signal }), []);
  return (
    <Card title="Search and sign-up" description="How many profiles a search page shows, whether advanced filters need a plan, and whether new members can register.">
      <div className="p-5">
        <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={3} />}>
          {(v) => <Body view={v} onSaved={view.setData} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function Body({ view, onSaved }: { view: PlatformSettingsView; onSaved: (v: PlatformSettingsView) => void }) {
  return (
    <div className="space-y-8">
      <SearchForm view={view} onSaved={onSaved} />
      <SignupForm view={view} onSaved={onSaved} />
    </div>
  );
}

function SearchForm({ view, onSaved }: { view: PlatformSettingsView; onSaved: (v: PlatformSettingsView) => void }) {
  const [def, setDef] = useState(String(view.search.defaultPageSize));
  const [max, setMax] = useState(String(view.search.maxPageSize));
  const [enforce, setEnforce] = useState(view.search.enforceAdvancedSearchEntitlement);
  const [saved, setSaved] = useState(false);
  const save = useAction((search: Record<string, unknown>) => adminApi.patch<PlatformSettingsView>("/platform-settings", { search }));
  const dirty = def !== String(view.search.defaultPageSize) || max !== String(view.search.maxPageSize) || enforce !== view.search.enforceAdvancedSearchEntitlement;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const res = await save.run({ defaultPageSize: Number(def), maxPageSize: Number(max), enforceAdvancedSearchEntitlement: enforce });
    if (res) {
      onSaved(res);
      setSaved(true);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Search settings" data-testid="search-settings">
      <h3 className="font-serif text-base font-semibold text-rz-navy">Search</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="set-default-page">Profiles per page (default)</FieldLabel>
          <Input id="set-default-page" inputMode="numeric" value={def} onChange={(e) => setDef(e.target.value)} />
          <p className="mt-1 text-xs text-rz-muted">5–50. Used when the app doesn&apos;t ask for a size.</p>
          {fieldIssue(save.error, "defaultPageSize") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "defaultPageSize")}</p>}
        </div>
        <div>
          <FieldLabel htmlFor="set-max-page">Profiles per page (maximum)</FieldLabel>
          <Input id="set-max-page" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
          <p className="mt-1 text-xs text-rz-muted">10–50. Larger requests are cut down to this.</p>
          {fieldIssue(save.error, "maxPageSize") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "maxPageSize")}</p>}
        </div>
      </div>
      <Toggle
        checked={enforce}
        onChange={setEnforce}
        label="Advanced search needs a plan that includes it"
        description="Height, education, profession, income and profile-ID filters. Switch off to open them to every member (for example during a promotion). Plans are edited under Membership Plans."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!dirty || save.pending}>{save.pending ? "Saving…" : "Save search settings"}</Button>
        {view.updatedAt.search && <span className="text-[12px] text-rz-muted">Last changed {formatDateTime(view.updatedAt.search)}</span>}
      </div>
      <ActionError error={save.error} />
      {saved && !dirty && <SuccessNote>Search settings saved. They apply to the next search.</SuccessNote>}
    </form>
  );
}

function SignupForm({ view, onSaved }: { view: PlatformSettingsView; onSaved: (v: PlatformSettingsView) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState(view.signup.closedMessage);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction((signup: Record<string, unknown>) => adminApi.patch<PlatformSettingsView>("/platform-settings", { signup }));
  const open = view.signup.open;

  async function apply(next: boolean) {
    setSaved(null);
    const res = await save.run({ open: next, closedMessage: message.trim() });
    if (res) {
      onSaved(res);
      setConfirm(false);
      setSaved(next ? "Sign-ups are open." : "Sign-ups are closed. Existing members can still sign in.");
    }
  }

  return (
    <section className="space-y-3" aria-label="Sign-up" data-testid="signup-settings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-base font-semibold text-rz-navy">New sign-ups</h3>
        <span className={open ? "rounded-full bg-rz-success/10 px-2.5 py-0.5 text-xs font-semibold text-rz-success" : "rounded-full bg-rz-maroon/10 px-2.5 py-0.5 text-xs font-semibold text-rz-maroon"}>
          {open ? "Open" : "Closed"}
        </span>
      </div>
      <p className="text-[13px] text-rz-muted">Closing sign-ups stops new registrations only. Sign-in, password reset, payments and everything for existing members keep working.</p>
      <div>
        <FieldLabel htmlFor="set-closed-message">Message shown when closed (optional)</FieldLabel>
        <Textarea id="set-closed-message" rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We are not accepting new registrations right now." />
        {fieldIssue(save.error, "closedMessage") && <p role="alert" className="mt-1 text-xs text-rz-danger">{fieldIssue(save.error, "closedMessage")}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {open ? (
          <Button type="button" size="sm" variant="outline" onClick={() => { save.clearError(); setConfirm(true); }}>Close sign-ups…</Button>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => apply(true)} disabled={save.pending}>{save.pending ? "Saving…" : "Open sign-ups"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => apply(false)} disabled={save.pending || message.trim() === view.signup.closedMessage}>Update message</Button>
          </>
        )}
        {view.updatedAt.signup && <span className="text-[12px] text-rz-muted">Last changed {formatDateTime(view.updatedAt.signup)}</span>}
      </div>
      <ActionError error={save.error} />
      {saved && <SuccessNote>{saved}</SuccessNote>}
      {confirm && (
        <Modal
          title="Close new sign-ups?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button type="button" disabled={save.pending} onClick={() => apply(false)}>{save.pending ? "Saving…" : "Close sign-ups"}</Button>
            </>
          }
        >
          <p className="text-sm text-rz-text">Visitors who try to register will see {message.trim() ? `“${message.trim()}”` : "a message that registrations are closed"}. Existing members are not affected. You can reopen at any time.</p>
          <ActionError error={save.error} className="mt-3" />
        </Modal>
      )}
    </section>
  );
}
