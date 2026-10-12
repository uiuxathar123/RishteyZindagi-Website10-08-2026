"use client";

/**
 * Admin control for the payment gateway: Razorpay | PhonePe, exactly one ACTIVE.
 *
 *  - Everything shown comes from GET /admin/payments/config; "saved" messages appear only after the
 *    API accepted the change.
 *  - Credentials are WRITE-ONLY: the form can send new values, but the API never returns a stored
 *    secret, so fields are always blank and only show whether a value is stored.
 *  - "Test connection" makes one harmless authenticated read at the gateway (no money moves).
 *  - Every switch / credential change is audited server-side.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { GatewayConfigView, GatewayKey, PaymentConfigView } from "@/lib/api/pcp-types";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, KeyRound, PlugZap, XCircle } from "lucide-react";
import { useState } from "react";
import { ActionError, Card, fieldIssue, SuccessNote } from "./AdminUi";

const FIELDS: Record<GatewayKey, Array<{ key: string; label: string; secret: boolean; hint?: string }>> = {
  RAZORPAY: [
    { key: "keyId", label: "Key ID", secret: false, hint: "rzp_test_… / rzp_live_…" },
    { key: "keySecret", label: "Key secret", secret: true },
    { key: "webhookSecret", label: "Webhook secret", secret: true, hint: "The secret you set on the Razorpay webhook (min. 8 characters)." },
  ],
  PHONEPE: [
    { key: "clientId", label: "Client ID", secret: false },
    { key: "clientSecret", label: "Client secret", secret: true },
    { key: "clientVersion", label: "Client version", secret: false, hint: "Usually 1." },
    { key: "webhookUsername", label: "Webhook username", secret: false, hint: "From the PhonePe dashboard's callback (webhook) settings." },
    { key: "webhookPassword", label: "Webhook password", secret: true },
  ],
};

export function PaymentProviderPanel() {
  const cfg = useAsync((signal) => adminApi.get<PaymentConfigView>("/payments/config", { signal }), []);
  return (
    <Card
      title="Payment gateway"
      description="Razorpay or PhonePe — exactly one is active. Activating one deactivates the other. Credentials are stored encrypted on the server and are never shown again."
    >
      <div className="p-5">
        <AsyncView data={cfg.data} error={cfg.error} loading={cfg.loading} reload={cfg.reload} skeleton={<ListSkeleton rows={3} />}>
          {(config) => <PaymentConfigBody config={config} onChanged={(c) => cfg.setData(c)} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function PaymentConfigBody({ config, onChanged }: { config: PaymentConfigView; onChanged: (c: PaymentConfigView) => void }) {
  const activate = useAction((key: GatewayKey) => adminApi.patch<PaymentConfigView>("/payments/config", { activeGateway: key }));
  const [note, setNote] = useState<string | null>(null);

  async function onActivate(key: GatewayKey) {
    setNote(null);
    const res = await activate.run(key);
    if (!res) return;
    onChanged(res);
    setNote(`${res.gateways.find((g) => g.key === key)?.label ?? key} is now the active payment gateway.`);
  }

  return (
    <div className="space-y-5">
      {config.unsupportedActiveGateway && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            “{config.unsupportedActiveGateway}” is still flagged active from an earlier setup and is not supported. Activate Razorpay or PhonePe below to replace it.
          </span>
        </p>
      )}
      {!config.activeGateway && !config.unsupportedActiveGateway && (
        <p role="status" className="rounded-md border border-rz-border bg-rz-cream px-3 py-2 text-[13px] text-rz-muted">
          No payment gateway is active, so members cannot pay. Activate one below.
        </p>
      )}
      {config.devGatewayInUse && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Development build: checkout uses the built-in mock gateway (no real money). Set PAYMENT_PROVIDER_MODE=real on the server to talk to the real gateway APIs.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {config.gateways.map((g) => (
          <GatewayCard key={g.key} gateway={g} busy={activate.pending} onActivate={() => onActivate(g.key)} onChanged={onChanged} />
        ))}
      </div>
      <ActionError error={activate.error} />
      {note && <SuccessNote>{note}</SuccessNote>}
    </div>
  );
}

function GatewayCard({
  gateway,
  busy,
  onActivate,
  onChanged,
}: {
  gateway: GatewayConfigView;
  busy: boolean;
  onActivate: () => void;
  onChanged: (c: PaymentConfigView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const test = useAction(() => adminApi.post<{ ok: boolean; message: string }>(`/payments/config/${gateway.key.toLowerCase()}/test-connection`));
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onTest() {
    setTestResult(null);
    const res = await test.run();
    if (res) setTestResult(res);
  }

  return (
    <div className={cn("rounded-lg border p-4", gateway.isActive ? "border-rz-maroon bg-rz-maroon/5" : "border-rz-border bg-white")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-base font-semibold text-rz-navy">{gateway.label}</h3>
          <Badge tone={gateway.isActive ? "success" : "neutral"}>{gateway.isActive ? "Active" : "Inactive"}</Badge>
        </div>
        {(() => {
          // The mode the KEY declares wins over the label an admin saved.
          const shown = gateway.detectedMode === "test" || gateway.detectedMode === "live" ? gateway.detectedMode : gateway.mode;
          return shown ? <Badge tone={shown === "live" ? "maroon" : "gold"}>{shown === "live" ? "Live key" : "Test key"}</Badge> : null;
        })()}
      </div>
      {gateway.problem && (
        <p role="alert" className="mt-3 rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-[13px] text-rz-danger">
          {gateway.problem}
        </p>
      )}

      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-rz-muted">Credentials</dt>
          <dd className="font-medium text-rz-text">
            {gateway.configured || gateway.problem
              ? gateway.credentialSource === "admin"
                ? "Saved in admin panel"
                : "Set in server environment"
              : "Not configured"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-rz-muted">Webhook secret</dt>
          <dd className="font-medium text-rz-text">{gateway.webhook.configured ? "Configured" : "Missing"}</dd>
        </div>
        <div>
          <dt className="text-rz-muted">Webhook URL to enter at {gateway.label}</dt>
          <dd className="mt-0.5 break-all rounded bg-rz-cream px-2 py-1 font-mono text-[12px] text-rz-navy">{gateway.webhook.url}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {!gateway.isActive && (
          <Button type="button" size="sm" disabled={busy} onClick={onActivate}>
            {busy ? "Switching…" : `Activate ${gateway.label}`}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" icon={<KeyRound className="h-4 w-4" />} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          {editing ? "Close" : "Credentials"}
        </Button>
        <Button type="button" size="sm" variant="ghost" icon={<PlugZap className="h-4 w-4" />} disabled={test.pending || !gateway.configured} onClick={onTest}>
          {test.pending ? "Testing…" : "Test connection"}
        </Button>
      </div>

      <div aria-live="polite" className="mt-3 space-y-2">
        <ActionError error={test.error} />
        {testResult && (
          <p
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]",
              testResult.ok ? "border-rz-success/30 bg-rz-success/10 text-rz-success" : "border-rz-danger/30 bg-rz-danger/5 text-rz-danger"
            )}
          >
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{testResult.message}</span>
          </p>
        )}
      </div>

      {editing && <CredentialsForm gateway={gateway} onSaved={(c) => { onChanged(c); setEditing(false); }} />}
    </div>
  );
}

function CredentialsForm({ gateway, onSaved }: { gateway: GatewayConfigView; onSaved: (c: PaymentConfigView) => void }) {
  const fields = FIELDS[gateway.key];
  const [mode, setMode] = useState<"test" | "live">(gateway.mode ?? "test");
  const [values, setValues] = useState<Record<string, string>>({});
  const save = useAction((body: Record<string, string>) => adminApi.put<PaymentConfigView>(`/payments/config/${gateway.key.toLowerCase()}/credentials`, body));

  const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
  const dirty = Object.keys(filled).length > 0 || mode !== (gateway.mode ?? "test");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await save.run({ mode, ...filled });
    if (!res) return;
    setValues({}); // never keep a secret in component state longer than needed
    onSaved(res);
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-rz-border pt-4" autoComplete="off">
      <p className="text-[12.5px] text-rz-muted">
        Leave a field blank to keep its stored value. Values are encrypted on the server and cannot be read back.
      </p>
      <div>
        <FieldLabel htmlFor={`${gateway.key}-mode`}>Mode</FieldLabel>
        <Select id={`${gateway.key}-mode`} value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}>
          <option value="test">Test (sandbox)</option>
          <option value="live">Live (real money)</option>
        </Select>
      </div>
      {fields.map((f) => {
        const stored = gateway.storedFields.includes(f.key);
        const issue = fieldIssue(save.error, f.key);
        return (
          <div key={f.key}>
            <FieldLabel htmlFor={`${gateway.key}-${f.key}`}>
              {f.label} {stored && <span className="font-normal text-rz-success">(stored)</span>}
            </FieldLabel>
            <Input
              id={`${gateway.key}-${f.key}`}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              placeholder={stored ? "•••••••• (leave blank to keep)" : ""}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              aria-invalid={!!issue}
            />
            {f.hint && !issue && <p className="mt-1 text-[12px] text-rz-muted">{f.hint}</p>}
            {issue && <p className="mt-1 text-[12.5px] text-rz-danger">{issue}</p>}
          </div>
        );
      })}
      <ActionError error={save.error} />
      <Button type="submit" size="sm" disabled={save.pending || !dirty}>
        {save.pending ? "Saving…" : "Save credentials"}
      </Button>
    </form>
  );
}
