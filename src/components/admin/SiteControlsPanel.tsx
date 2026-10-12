"use client";

/**
 * Super Admin site controls (B19): maintenance mode, manual profile approval and the weekly digest master switch.
 * The server enforces both (Super Admin only, audited); this form only shows what it returns.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { SiteControlsView } from "@/lib/api/b19-types";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { ActionError, Card, Modal, SuccessNote } from "./AdminUi";

interface AdminSecurityView {
  mfaRequired: boolean;
  updatedAt: string | null;
  emailDeliveryReady: boolean;
}

/** Admin sign-in second factor (B19). Switch-on is refused by the server when e-mail codes cannot be delivered. */
export function AdminSecurityPanel() {
  const view = useAsync((signal) => adminApi.get<AdminSecurityView>("/security-settings", { signal }), []);
  return (
    <Card title="Admin security" description="Require every Super Admin and Staff Admin to enter an e-mailed code after their password.">
      <div className="p-5">
        <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={2} />}>
          {(v) => <AdminSecurityBody view={v} onSaved={view.setData} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function AdminSecurityBody({ view, onSaved }: { view: AdminSecurityView; onSaved: (v: AdminSecurityView) => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction((mfaRequired: boolean) => adminApi.patch<AdminSecurityView>("/security-settings", { mfaRequired }));
  async function change(next: boolean) {
    setSaved(null);
    const res = await save.run(next);
    if (res) {
      onSaved(res);
      setSaved(next ? "Admin MFA is ON. Every admin now needs an e-mailed code at sign-in." : "Admin MFA is OFF.");
    }
  }
  return (
    <section className="space-y-3" aria-label="Admin MFA" data-testid="admin-mfa-settings">
      <Toggle
        checked={view.mfaRequired}
        onChange={change}
        disabled={save.pending || (!view.mfaRequired && !view.emailDeliveryReady)}
        label="Require an e-mailed code at admin sign-in"
        description="The code goes to the admin's own e-mail address through the SMTP provider. If e-mail ever stops working, someone with server access can switch this off with `npm run admin:disable-mfa`."
      />
      {!view.mfaRequired && !view.emailDeliveryReady && (
        <p role="alert" className="text-xs text-rz-danger">E-mail codes cannot be delivered right now (OTP disabled or SMTP not configured), so this cannot be switched on yet.</p>
      )}
      <ActionError error={save.error} />
      {saved && <SuccessNote>{saved}</SuccessNote>}
    </section>
  );
}

export function SiteControlsPanel() {
  const view = useAsync((signal) => adminApi.get<SiteControlsView>("/site-controls", { signal }), []);
  return (
    <Card title="Site controls" description="Take the member site offline for maintenance, and decide whether new profiles need manual approval before other members can see them.">
      <div className="p-5">
        <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={3} />}>
          {(v) => (
            <div className="space-y-8">
              <MaintenanceForm view={v} onSaved={view.setData} />
              <ApprovalForm view={v} onSaved={view.setData} />
              <DigestForm view={v} onSaved={view.setData} />
            </div>
          )}
        </AsyncView>
      </div>
    </Card>
  );
}

function MaintenanceForm({ view, onSaved }: { view: SiteControlsView; onSaved: (v: SiteControlsView) => void }) {
  const on = view.maintenance.enabled;
  const [message, setMessage] = useState(view.maintenance.message);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction((body: Record<string, unknown>) => adminApi.patch<SiteControlsView>("/site-controls", body));

  async function apply(enabled: boolean) {
    setSaved(null);
    const res = await save.run({ maintenance: { enabled, message: message.trim() }, ...(enabled ? { reason: reason.trim() } : {}) });
    if (res) {
      onSaved(res);
      setConfirm(false);
      setReason("");
      setSaved(enabled ? "Maintenance mode is ON. Members and visitors see the message; the Admin Panel keeps working." : "Maintenance mode is OFF. The site is back for everyone.");
    }
  }

  return (
    <section className="space-y-3" aria-label="Maintenance mode" data-testid="maintenance-settings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-base font-semibold text-rz-navy">Maintenance mode</h3>
        <span className={on ? "rounded-full bg-rz-maroon/10 px-2.5 py-0.5 text-xs font-semibold text-rz-maroon" : "rounded-full bg-rz-success/10 px-2.5 py-0.5 text-xs font-semibold text-rz-success"}>{on ? "ON — site offline for members" : "Off"}</span>
      </div>
      <p className="text-[13px] text-rz-muted">While on, every member and visitor request is answered with the message below. The Admin Panel, payment-provider callbacks and scheduled jobs are not affected. It takes effect on the next request.</p>
      <div>
        <FieldLabel htmlFor="mm-message">Message shown to visitors (optional)</FieldLabel>
        <Textarea id="mm-message" rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We are upgrading RishteyZindagi and will be back shortly." />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {on ? (
          <>
            <Button type="button" size="sm" onClick={() => apply(false)} disabled={save.pending}>{save.pending ? "Saving…" : "Turn maintenance off"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => save.run({ maintenance: { message: message.trim() } }).then((r) => r && onSaved(r))} disabled={save.pending || message.trim() === view.maintenance.message}>Update message</Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => { save.clearError(); setConfirm(true); }}>Turn maintenance on…</Button>
        )}
        {view.maintenance.updatedAt && <span className="text-[12px] text-rz-muted">Last changed {formatDateTime(view.maintenance.updatedAt)}</span>}
      </div>
      <ActionError error={save.error} />
      {saved && <SuccessNote>{saved}</SuccessNote>}
      {confirm && (
        <Modal
          title="Take the site offline for members?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button type="button" disabled={save.pending || reason.trim().length < 5} onClick={() => apply(true)}>{save.pending ? "Saving…" : "Turn maintenance on"}</Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-rz-text">Every member and visitor will see a maintenance message until you turn this off. Members already signed in are not signed out.</p>
          <FieldLabel htmlFor="mm-reason">Reason (kept in the audit log)</FieldLabel>
          <Input id="mm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Database upgrade" />
          <ActionError error={save.error} className="mt-3" />
        </Modal>
      )}
    </section>
  );
}

function ApprovalForm({ view, onSaved }: { view: SiteControlsView; onSaved: (v: SiteControlsView) => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction((manualApproval: boolean) => adminApi.patch<SiteControlsView>("/site-controls", { approval: { manualApproval } }));
  const value = view.approval.manualApproval;

  async function change(next: boolean) {
    setSaved(null);
    const res = await save.run(next);
    if (res) {
      onSaved(res);
      setSaved(next ? "Manual approval is ON. Profiles that become ready from now on wait in the Visibility Queue." : "Manual approval is OFF. New profiles are visible as soon as they are complete. Profiles already waiting stay in the queue until decided.");
    }
  }

  return (
    <section className="space-y-3" aria-label="Manual profile approval" data-testid="approval-settings">
      <h3 className="font-serif text-base font-semibold text-rz-navy">Manual profile approval</h3>
      <Toggle
        checked={value}
        onChange={change}
        disabled={save.pending}
        label="New profiles must be approved before other members can see them"
        description="Applies to profiles that become complete (all required fields and a photo) after you switch it on. Profiles already visible stay visible. Approve or reject in Visibility Queue; a rejected member sees the reason and can edit to resubmit."
      />
      {view.approval.updatedAt && <p className="text-[12px] text-rz-muted">Last changed {formatDateTime(view.approval.updatedAt)}</p>}
      <ActionError error={save.error} />
      {saved && <SuccessNote>{saved}</SuccessNote>}
    </section>
  );
}

function DigestForm({ view, onSaved }: { view: SiteControlsView; onSaved: (v: SiteControlsView) => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction((enabled: boolean) => adminApi.patch<SiteControlsView>("/site-controls", { digest: { enabled } }));
  async function change(next: boolean) {
    setSaved(null);
    const res = await save.run(next);
    if (res) {
      onSaved(res);
      setSaved(next ? "Weekly digests are allowed. Only members who opted in receive one." : "Weekly digests are OFF for everyone.");
    }
  }
  return (
    <section className="space-y-3" aria-label="Weekly e-mail digest" data-testid="digest-settings">
      <h3 className="font-serif text-base font-semibold text-rz-navy">Weekly e-mail digest</h3>
      <Toggle
        checked={view.digest.enabled}
        onChange={change}
        disabled={save.pending}
        label="Allow the weekly summary e-mail"
        description="Master switch. Members must also opt in under Settings → Notification preferences. A member with nothing new (no pending interests, matches or unread messages) is skipped. The `member-digest` scheduled job sends them."
      />
      {!view.digest.mailerConfigured && <p className="text-xs text-rz-muted">SMTP is not configured on the server, so no digest can be sent yet.</p>}
      <ActionError error={save.error} />
      {saved && <SuccessNote>{saved}</SuccessNote>}
    </section>
  );
}
