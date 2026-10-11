"use client";

/**
 * Super Admin control for the OTP-required policy (B18).
 *
 * This is deliberately a separate panel from the delivery-provider panel: the provider decides HOW a code is sent
 * (Email or Fast2SMS, exactly one); the policy decides WHETHER a code is asked for in a workflow that is allowed to
 * go without one. The server decides what may be switched; the list of workflows that can never be switched off is
 * shown here so nobody assumes otherwise. Every change is audited with who / when / previous / new, and turning a
 * verification OFF needs a written reason and an explicit confirmation.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { OtpPolicyView, OtpPolicyWorkflow, OtpRequirement } from "@/lib/api/b18-types";
import { timeAgo } from "@/lib/format";
import { AlertTriangle, Lock } from "lucide-react";
import { useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, Modal, SuccessNote } from "./AdminUi";

export function OtpPolicyPanel() {
  const { isSuper } = useAdminSession();
  const view = useAsync((signal) => adminApi.get<OtpPolicyView>("/otp/policy", { signal }), []);
  return (
    <Card
      title="OTP requirement policy"
      description="Whether a one-time code is asked for. Separate from the delivery provider above. Password, account status and session checks always apply."
    >
      <div className="p-5">
        {!isSuper ? (
          <p className="flex items-start gap-2 text-sm text-rz-muted">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Only a Super Admin can view or change the OTP requirement policy.
          </p>
        ) : (
          <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={2} />}>
            {(v) => <PolicyBody view={v} onChanged={view.setData} />}
          </AsyncView>
        )}
      </div>
    </Card>
  );
}

function PolicyBody({ view, onChanged }: { view: OtpPolicyView; onChanged: (v: OtpPolicyView) => void }) {
  const [confirm, setConfirm] = useState<{ workflow: OtpPolicyWorkflow; requirement: OtpRequirement } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const save = useAction((workflow: OtpPolicyWorkflow, requirement: OtpRequirement, why: string) =>
    adminApi.patch<OtpPolicyView>("/otp/policy", { workflow, requirement, ...(why ? { reason: why } : {}) })
  );

  async function apply(workflow: OtpPolicyWorkflow, requirement: OtpRequirement, why = "") {
    setNote(null);
    const res = await save.run(workflow, requirement, why);
    if (!res) return;
    onChanged(res);
    setConfirm(null);
    setReason("");
    const label = res.workflows.find((w) => w.key === workflow)?.label ?? workflow;
    setNote(`${label}: ${requirement === "OTP_REQUIRED" ? "a code is now required." : "a code is no longer required."}`);
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {view.workflows.map((w) => {
          const required = w.requirement === "OTP_REQUIRED";
          return (
            <li key={w.key} className="rounded-lg border border-rz-border p-4" data-testid={`otp-policy-${w.key}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-serif text-base font-semibold text-rz-navy">{w.label}</h3>
                <Badge tone={required ? "success" : "gold"}>{required ? "ON · OTP required" : "OFF · OTP not required"}</Badge>
              </div>
              <p className="mt-1 text-[13px] text-rz-muted">{w.description}</p>
              {required && w.key === "SIGNUP_VERIFICATION" && !view.delivery.ready && (
                <p role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12.5px] text-red-900" data-testid="otp-delivery-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Codes cannot be delivered right now{view.delivery.missing.length ? ` (missing: ${view.delivery.missing.join(", ")})` : ""}, so new registrations will show an error until delivery is configured. Configure it
                    under “OTP delivery provider”, or switch this to OFF for local testing.
                  </span>
                </p>
              )}
              {!required && (
                <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{w.whenNotRequired}</span>
                </p>
              )}
              <div className="mt-3">
                {required ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirm({ workflow: w.key, requirement: "OTP_NOT_REQUIRED" })} disabled={save.pending}>
                    Stop requiring a code…
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={() => apply(w.key, "OTP_REQUIRED")} disabled={save.pending}>
                    {save.pending ? "Saving…" : "Require a code again"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-md bg-rz-cream px-3 py-3 text-[12.5px] text-rz-muted">
        <p className="font-semibold text-rz-navy">Always requires its existing proof — cannot be switched off here</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {view.neverConfigurable.map((n) => (
            <li key={n.key}>
              <span className="font-medium text-rz-text">{n.label}</span> — {n.reason}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[12.5px] text-rz-muted">
        {view.isDefault ? "Using the safe default (OTP required everywhere)." : `Last changed ${view.updatedAt ? timeAgo(view.updatedAt) : "—"}.`} Each change is written to the audit log with the previous and new value.
      </p>
      <ActionError error={confirm ? null : save.error} />
      {note && <SuccessNote>{note}</SuccessNote>}

      {confirm && (
        <Modal
          title={`Stop requiring a code for “${view.workflows.find((w) => w.key === confirm.workflow)?.label}”?`}
          onClose={() => { setConfirm(null); setReason(""); save.clearError(); }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void apply(confirm.workflow, confirm.requirement, reason.trim());
            }}
            className="space-y-4"
          >
            <p className="text-sm">{view.workflows.find((w) => w.key === confirm.workflow)?.whenNotRequired}</p>
            <div>
              <FieldLabel htmlFor="otp-policy-reason">Reason (kept in the audit log)</FieldLabel>
              <Textarea id="otp-policy-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} minLength={5} maxLength={300} required />
            </div>
            <ActionError error={save.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setConfirm(null); setReason(""); save.clearError(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.pending || reason.trim().length < 5}>
                {save.pending ? "Saving…" : "Yes, stop requiring a code"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
