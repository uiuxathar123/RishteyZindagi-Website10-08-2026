"use client";

/**
 * Admin control for the OTP delivery provider: Email | Fast2SMS SMS, exactly one ACTIVE.
 * Provider credentials live in the server environment; this panel shows only whether they are
 * present (and the NAMES of any that are missing), never a value. Every switch is audited.
 * Codes already issued stay valid after a switch (their expiry and attempt limits are unchanged).
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { OtpProviderKey, OtpProviderView } from "@/lib/api/pcp-types";
import { cn } from "@/lib/utils";
import { AlertTriangle, Mail, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { ActionError, Card, SuccessNote } from "./AdminUi";

const ICON: Record<OtpProviderKey, typeof Mail> = { EMAIL: Mail, FAST2SMS_SMS: MessageSquareText };
const BLURB: Record<OtpProviderKey, string> = {
  EMAIL: "Sends the code to the member's email address through the server's SMTP relay.",
  FAST2SMS_SMS: "Sends the code as an SMS to the member's Indian mobile number through Fast2SMS. Codes are generated and checked by this platform.",
};

export function OtpProviderPanel({ onSwitched }: { onSwitched?: () => void }) {
  const view = useAsync((signal) => adminApi.get<OtpProviderView>("/otp/provider", { signal }), []);
  return (
    <Card title="OTP delivery provider" description="Email or Fast2SMS — exactly one is active. Switching takes effect immediately for new codes; codes already sent stay valid.">
      <div className="p-5">
        <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={2} />}>
          {(v) => <ProviderBody view={v} onChanged={(n) => { view.setData(n); onSwitched?.(); }} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function ProviderBody({ view, onChanged }: { view: OtpProviderView; onChanged: (v: OtpProviderView) => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState<OtpProviderKey | null>(null);
  const sw = useAction((key: OtpProviderKey) => adminApi.patch<OtpProviderView>("/otp/provider", { activeProvider: key }));

  async function onSwitch(key: OtpProviderKey) {
    setNote(null);
    setTarget(key);
    const res = await sw.run(key);
    setTarget(null);
    if (!res) return;
    onChanged(res);
    setNote(`${res.providers.find((p) => p.key === key)?.label ?? key} is now the active OTP provider.`);
  }

  return (
    <div className="space-y-4">
      {view.unsupportedActiveMethod && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The stored method “{view.unsupportedActiveMethod}” is no longer supported. Choose Email or Fast2SMS below.</span>
        </p>
      )}
      {view.devMode && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Development mode is on: codes are not delivered externally. It can only exist outside production.
        </p>
      )}
      <div role="radiogroup" aria-label="OTP delivery provider" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {view.providers.map((p) => {
          const Icon = ICON[p.key];
          return (
            <div key={p.key} className={cn("rounded-lg border p-4", p.active ? "border-rz-maroon bg-rz-maroon/5" : "border-rz-border bg-white")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-rz-maroon" aria-hidden />
                  <h3 className="font-serif text-base font-semibold text-rz-navy">{p.label}</h3>
                </div>
                <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="mt-2 text-[12.5px] text-rz-muted">{BLURB[p.key]}</p>
              <p className="mt-2 text-[13px]">
                <span className="text-rz-muted">Server configuration: </span>
                <span className={cn("font-medium", p.configured ? "text-rz-success" : "text-rz-danger")}>{p.configured ? "complete" : "incomplete"}</span>
              </p>
              {!p.configured && p.missing.length > 0 && (
                <p className="mt-1 text-[12px] text-rz-muted">
                  Missing on the server: <span className="font-mono">{p.missing.join(", ")}</span>
                </p>
              )}
              {!p.active && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={false}
                  disabled={sw.pending}
                  onClick={() => onSwitch(p.key)}
                  className="rz-focus mt-3 inline-flex h-9 items-center rounded-full border border-rz-maroon px-4 text-sm font-semibold text-rz-maroon hover:bg-rz-maroon/5 disabled:opacity-60"
                >
                  {sw.pending && target === p.key ? "Switching…" : `Switch to ${p.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[12.5px] text-rz-muted">
        Whether the vendor accepts the configured credentials is only known when a real code is sent. API keys are held by the server and are never displayed here.
      </p>
      <ActionError error={sw.error} />
      {note && <SuccessNote>{note}</SuccessNote>}
    </div>
  );
}
