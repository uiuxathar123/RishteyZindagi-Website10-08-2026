"use client";

/**
 * Real platform-configuration editors for the Admin Panel. Every value shown
 * is read from the API and every "saved" message appears only after the API
 * accepted the change; on failure the server's own message (including
 * per-field validation) is shown and the form keeps what the admin typed.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { MatchingWeights, OtpConfig, PaymentGatewayView } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, fieldIssue, NotAvailable, SuccessNote } from "./AdminUi";
import { WEIGHT_CATEGORIES } from "./adminTypes";

// ---------------------------------------------------------------------------
// OTP configuration
// ---------------------------------------------------------------------------

type OtpMethod = OtpConfig["activeMethod"];

const METHODS: Array<{ value: OtpMethod; label: string; key: keyof OtpConfig["providers"] }> = [
  { value: "SMS", label: "SMS", key: "sms" },
  { value: "WHATSAPP", label: "WhatsApp", key: "whatsapp" },
  { value: "EMAIL", label: "Email", key: "email" },
];

/** Numeric dials: key, label, hint, and the bounds the backend validates. */
const OTP_NUMBERS: Array<{ key: keyof OtpConfig; label: string; hint: string; min: number; max: number }> = [
  { key: "otpLength", label: "Code length (digits)", hint: "4–10", min: 4, max: 10 },
  { key: "otpExpirySeconds", label: "Code expires after (seconds)", hint: "30–3600", min: 30, max: 3600 },
  { key: "maxVerifyAttempts", label: "Wrong-code attempts allowed", hint: "1–20", min: 1, max: 20 },
  { key: "resendCooldownSeconds", label: "Wait before resend (seconds)", hint: "5–600", min: 5, max: 600 },
  { key: "maxResendAttempts", label: "Resends allowed per window", hint: "1–50", min: 1, max: 50 },
  { key: "resendWindowSeconds", label: "Resend window (seconds)", hint: "60–86400", min: 60, max: 86400 },
];

export function OtpConfigPanel() {
  const cfg = useAsync((signal) => adminApi.get<OtpConfig>("/otp/config", { signal }), []);
  return (
    <Card title="One-time passwords (OTP)" description="How sign-up, login on a new device and password-reset codes are delivered. Exactly one method is active at a time.">
      <div className="p-5">
        <AsyncView data={cfg.data} error={cfg.error} loading={cfg.loading} reload={cfg.reload} skeleton={<ListSkeleton rows={3} />}>
          {(config) => <OtpForm config={config} onSaved={(c) => cfg.setData(c)} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function OtpForm({ config, onSaved }: { config: OtpConfig; onSaved: (c: OtpConfig) => void }) {
  const { devToolsAllowed } = useAdminSession();
  const [method, setMethod] = useState<OtpMethod>(config.activeMethod);
  const [enabled, setEnabled] = useState(config.enabled);
  const [devMode, setDevMode] = useState(config.devMode);
  const [nums, setNums] = useState<Record<string, string>>(() =>
    Object.fromEntries(OTP_NUMBERS.map((n) => [n.key, String(config[n.key])]))
  );
  const [saved, setSaved] = useState(false);
  const save = useAction((body: Record<string, unknown>) => adminApi.patch<OtpConfig>("/otp/config", body));

  const patch = useMemo(() => {
    const body: Record<string, unknown> = {};
    if (method !== config.activeMethod) body.activeMethod = method;
    if (enabled !== config.enabled) body.enabled = enabled;
    if (devMode !== config.devMode) body.devMode = devMode;
    for (const n of OTP_NUMBERS) {
      const raw = nums[n.key];
      const v = raw.trim() === "" ? NaN : Number(raw);
      if (v !== config[n.key]) body[n.key] = v;
    }
    return body;
  }, [method, enabled, devMode, nums, config]);

  const dirty = Object.keys(patch).length > 0;
  const hasInvalidNumber = Object.values(patch).some((v) => typeof v === "number" && !Number.isInteger(v));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const res = await save.run(patch);
    if (!res) return;
    setSaved(true);
    onSaved(res);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-[12.5px] font-semibold text-rz-muted">Delivery method</legend>
        <div role="radiogroup" aria-label="Delivery method" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {METHODS.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
                method === m.value ? "border-rz-maroon bg-rz-maroon/5" : "border-rz-border hover:border-rz-maroon/40"
              )}
            >
              <input type="radio" name="otp-method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="rz-focus mt-1 accent-rz-maroon" />
              <span>
                <span className="block font-semibold text-rz-text">{m.label}</span>
                <span className="block text-[12px] text-rz-muted">
                  {config.providers[m.key] ? "Provider settings stored" : "No provider settings stored"}
                </span>
              </span>
            </label>
          ))}
        </div>
        {fieldIssue(save.error, "activeMethod") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(save.error, "activeMethod")}</p>}
        <p className="mt-2 text-[12.5px] text-rz-muted">
          Live SMS, WhatsApp and email delivery vendors are not connected in this build. With development mode off, requests on those channels are refused by the server.
        </p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OTP_NUMBERS.map((n) => {
          const issue = fieldIssue(save.error, n.key);
          return (
            <div key={n.key}>
              <FieldLabel htmlFor={`otp-${n.key}`}>
                {n.label} <span className="font-normal">({n.hint})</span>
              </FieldLabel>
              <Input
                id={`otp-${n.key}`}
                type="number"
                inputMode="numeric"
                min={n.min}
                max={n.max}
                step={1}
                value={nums[n.key]}
                onChange={(e) => setNums((p) => ({ ...p, [n.key]: e.target.value }))}
                aria-invalid={!!issue}
              />
              {issue && <p className="mt-1 text-[12.5px] text-rz-danger">{issue}</p>}
            </div>
          );
        })}
      </div>

      <div className="divide-y divide-rz-border rounded-md border border-rz-border px-4">
        <Toggle
          label="OTP delivery enabled"
          description="Master switch. When off, nobody can complete sign-up, new-device login or password reset (the server answers “OTP delivery is currently disabled”)."
          checked={enabled}
          onChange={setEnabled}
        />
        <div>
          <Toggle
            label="Development mode"
            description="Codes are kept in server memory and can be read by developers instead of being sent. For local testing only."
            checked={devMode}
            onChange={setDevMode}
            disabled={!devToolsAllowed && !devMode}
          />
          {(devMode || config.devMode) && (
            <p className="mb-3 flex items-start gap-2 rounded-md bg-rz-warning/10 px-3 py-2 text-[12.5px] text-rz-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Development mode is on: one-time codes are not delivered to members. Never leave this on in production.
            </p>
          )}
          {!devToolsAllowed && !devMode && (
            <p className="mb-3 text-[12.5px] text-rz-muted">This server runs in production, so development mode cannot be switched on.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || hasInvalidNumber || save.pending}>
          {save.pending ? "Saving…" : "Save OTP settings"}
        </Button>
        {dirty && !save.pending && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setMethod(config.activeMethod);
              setEnabled(config.enabled);
              setDevMode(config.devMode);
              setNums(Object.fromEntries(OTP_NUMBERS.map((n) => [n.key, String(config[n.key])])));
              save.clearError();
            }}
          >
            Discard changes
          </Button>
        )}
        <span className="text-[12px] text-rz-muted">Last changed {formatDateTime(config.updatedAt)}</span>
      </div>
      <ActionError error={save.error} />
      {saved && !dirty && <SuccessNote>OTP settings saved.</SuccessNote>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Matching weights
// ---------------------------------------------------------------------------

export function MatchingWeightsPanel() {
  const w = useAsync((signal) => adminApi.get<MatchingWeights>("/matching/weights", { signal }), []);
  return (
    <Card
      title="Matching weights"
      description="How much each criterion contributes to a match score. The ten weights are whole numbers (0 or more) and must add up to exactly 100."
    >
      <div className="p-5">
        <AsyncView data={w.data} error={w.error} loading={w.loading} reload={w.reload} skeleton={<ListSkeleton rows={3} />}>
          {(data) => <WeightsForm data={data} onSaved={(d) => w.setData(d)} />}
        </AsyncView>
      </div>
    </Card>
  );
}

function WeightsForm({ data, onSaved }: { data: MatchingWeights; onSaved: (d: MatchingWeights) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(WEIGHT_CATEGORIES.map((c) => [c.key, String(data.weights[c.key] ?? 0)]))
  );
  const [saved, setSaved] = useState(false);
  const save = useAction((body: Record<string, number>) => adminApi.patch<MatchingWeights>("/matching/weights", body));

  const parsed = WEIGHT_CATEGORIES.map((c) => {
    const raw = values[c.key].trim();
    return { key: c.key, n: raw === "" ? NaN : Number(raw) };
  });
  const allIntegers = parsed.every((p) => Number.isInteger(p.n) && p.n >= 0);
  const sum = parsed.reduce((acc, p) => acc + (Number.isFinite(p.n) ? p.n : 0), 0);
  const dirty = parsed.some((p) => p.n !== data.weights[p.key]);
  const valid = allIntegers && sum === 100;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaved(false);
    const res = await save.run(Object.fromEntries(parsed.map((p) => [p.key, p.n])));
    if (!res) return;
    setSaved(true);
    onSaved(res);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {WEIGHT_CATEGORIES.map((c) => (
          <div key={c.key}>
            <FieldLabel htmlFor={`w-${c.key}`}>{c.label}</FieldLabel>
            <Input
              id={`w-${c.key}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={values[c.key]}
              onChange={(e) => {
                setValues((p) => ({ ...p, [c.key]: e.target.value }));
                setSaved(false);
              }}
              aria-describedby={`w-${c.key}-hint`}
            />
            <p id={`w-${c.key}-hint`} className="mt-1 text-[11.5px] leading-snug text-rz-muted">
              {c.hint}
            </p>
          </div>
        ))}
      </div>

      <p
        aria-live="polite"
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
          valid ? "bg-rz-success/10 text-rz-success" : "bg-rz-warning/10 text-rz-warning"
        )}
      >
        {valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        Total: {Number.isFinite(sum) ? sum : "—"} / 100
        {!allIntegers ? " — every weight must be a whole number, 0 or more" : sum !== 100 ? ` — ${sum > 100 ? "remove" : "add"} ${Math.abs(100 - sum)}` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!valid || !dirty || save.pending}>
          {save.pending ? "Saving…" : "Save weights"}
        </Button>
        {dirty && !save.pending && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setValues(Object.fromEntries(WEIGHT_CATEGORIES.map((c) => [c.key, String(data.weights[c.key] ?? 0)])));
              save.clearError();
            }}
          >
            Discard changes
          </Button>
        )}
        <span className="text-[12px] text-rz-muted">Last changed {formatDateTime(data.updatedAt)}</span>
      </div>
      <ActionError error={save.error} />
      {saved && !dirty && <SuccessNote>Matching weights saved. New scores use them immediately.</SuccessNote>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Payment gateways
// ---------------------------------------------------------------------------

export function GatewaysPanel() {
  const list = useAsync(async (signal) => (await adminApi.get<{ gateways: PaymentGatewayView[] }>("/payment-gateways", { signal })).gateways, []);

  function replace(g: PaymentGatewayView) {
    list.setData((prev) => (prev ?? []).map((x) => (x.id === g.id ? g : g.isActive ? { ...x, isActive: false } : x)));
  }

  const active = list.data?.find((g) => g.isActive);

  return (
    <Card
      title="Payment gateways"
      description="Exactly one gateway takes member payments at a time. Credentials are write-only: they are encrypted when saved and never shown again."
    >
      <div className="p-5">
        <AsyncView
          data={list.data}
          error={list.error}
          loading={list.loading}
          reload={list.reload}
          skeleton={<ListSkeleton rows={3} />}
          isEmpty={(d) => d.length === 0}
          empty={{ title: "No gateways", description: "No payment gateway rows exist in the database." }}
        >
          {(gateways) => (
            <div className="space-y-4">
              {!active && (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-rz-warning/40 bg-rz-warning/10 px-3 py-2 text-[13px] text-rz-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  No gateway is active, so member checkout is currently unavailable.
                </p>
              )}
              <ul className="space-y-3">
                {gateways.map((g) => (
                  <GatewayRow key={g.id} gateway={g} onChanged={replace} />
                ))}
              </ul>
              <NotAvailable title="Live gateways">
                The gateway integrations are not wired to the vendors’ live APIs in this build, so “Test connection” reports exactly what the server can verify and activation does not by itself make real payments possible.
              </NotAvailable>
            </div>
          )}
        </AsyncView>
      </div>
    </Card>
  );
}

function GatewayRow({ gateway, onChanged }: { gateway: PaymentGatewayView; onChanged: (g: PaymentGatewayView) => void }) {
  const [confirm, setConfirm] = useState<"activate" | "deactivate" | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activate = useAction(() => adminApi.post<{ gateway: PaymentGatewayView }>(`/payment-gateways/${gateway.id}/activate`));
  const deactivate = useAction(() => adminApi.post<{ gateway: PaymentGatewayView }>(`/payment-gateways/${gateway.id}/deactivate`));
  const test = useAction(() => adminApi.post<{ ok: boolean; message: string }>(`/payment-gateways/${gateway.id}/test-connection`));

  async function doActivate() {
    setNotice(null);
    const res = await activate.run();
    if (!res) return;
    setConfirm(null);
    setNotice(`${gateway.name} is now the active gateway.`);
    onChanged(res.gateway);
  }
  async function doDeactivate() {
    setNotice(null);
    const res = await deactivate.run();
    if (!res) return;
    setConfirm(null);
    setNotice(`${gateway.name} deactivated. Checkout is unavailable until a gateway is active.`);
    onChanged(res.gateway);
  }
  async function doTest() {
    setTestResult(null);
    const res = await test.run();
    if (res) setTestResult(res);
  }

  const busy = activate.pending || deactivate.pending;
  const mutationError = activate.error ?? deactivate.error;

  return (
    <li className="rounded-md border border-rz-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-rz-navy">
            {gateway.name}
            <Badge tone={gateway.isActive ? "success" : "neutral"}>{gateway.isActive ? "Active" : "Inactive"}</Badge>
            {gateway.mode && <Badge tone={gateway.mode === "live" ? "gold" : "navy"}>{gateway.mode === "live" ? "Live mode" : "Test mode"}</Badge>}
          </p>
          <p className="mt-1 text-[12.5px] text-rz-muted">
            Credentials: {gateway.credentialsConfigured ? `stored (encrypted)${gateway.merchantIdLast4 ? ` · merchant id ending ${gateway.merchantIdLast4}` : ""}` : "none stored"} · Server environment:{" "}
            {gateway.envConfigured ? "configured" : "not configured"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={test.pending} onClick={doTest}>
            {test.pending ? "Testing…" : "Test connection"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfiguring((v) => !v)} aria-expanded={configuring}>
            {configuring ? "Close" : "Configure"}
          </Button>
          {gateway.isActive ? (
            <Button type="button" size="sm" variant="outline" className="!border-rz-danger !text-rz-danger hover:!bg-rz-danger/5" disabled={busy} onClick={() => setConfirm("deactivate")}>
              Deactivate
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={() => setConfirm("activate")}>
              Activate
            </Button>
          )}
        </div>
      </div>

      {confirm && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-rz-cream px-3 py-2 text-sm" role="group" aria-label="Confirm change">
          <span className="text-rz-text">
            {confirm === "activate"
              ? `Make ${gateway.name} the gateway for all new member payments? Any other active gateway is switched off.`
              : `Deactivate ${gateway.name}? Member checkout stops working until a gateway is active again.`}
          </span>
          <Button type="button" size="sm" disabled={busy} onClick={confirm === "activate" ? doActivate : doDeactivate}>
            {busy ? "Working…" : "Confirm"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setConfirm(null); activate.clearError(); deactivate.clearError(); }}>
            Cancel
          </Button>
        </div>
      )}

      <div className="mt-2 space-y-2">
        <ActionError error={mutationError} />
        {notice && <SuccessNote>{notice}</SuccessNote>}
        {test.error && <ActionError error={test.error} />}
        {testResult && (
          <p role="status" className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-[13px]", testResult.ok ? "bg-rz-success/10 text-rz-success" : "bg-rz-warning/10 text-rz-warning")}>
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              <strong>{testResult.ok ? "Connection OK." : "Connection not verified."}</strong> {testResult.message}
            </span>
          </p>
        )}
      </div>

      {configuring && <GatewayConfigForm gateway={gateway} onSaved={(g) => { onChanged(g); setConfiguring(false); setNotice("Gateway configuration saved."); }} />}
    </li>
  );
}

function GatewayConfigForm({ gateway, onSaved }: { gateway: PaymentGatewayView; onSaved: (g: PaymentGatewayView) => void }) {
  const [mode, setMode] = useState<string>(gateway.mode ?? "");
  const [fields, setFields] = useState({ apiKey: "", apiSecret: "", merchantId: "", webhookSecret: "" });
  const save = useAction((body: Record<string, string>) => adminApi.patch<{ gateway: PaymentGatewayView }>(`/payment-gateways/${gateway.id}`, body));

  const body: Record<string, string> = {};
  if (mode && mode !== gateway.mode) body.mode = mode;
  for (const [k, v] of Object.entries(fields)) if (v.trim()) body[k] = v.trim();
  const dirty = Object.keys(body).length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await save.run(body);
    if (!res) return;
    setFields({ apiKey: "", apiSecret: "", merchantId: "", webhookSecret: "" });
    onSaved(res.gateway);
  }

  const secretInputs: Array<[keyof typeof fields, string]> = [
    ["apiKey", "API key"],
    ["apiSecret", "API secret"],
    ["merchantId", "Merchant id"],
    ["webhookSecret", "Webhook secret"],
  ];

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4 border-t border-rz-border pt-4" autoComplete="off">
      <p className="text-[12.5px] text-rz-muted">
        Leave a credential blank to keep what is stored. Stored values are never displayed or returned by the API.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`gm-${gateway.id}`}>Mode</FieldLabel>
          <Select id={`gm-${gateway.id}`} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">{gateway.mode ? "Unchanged" : "Not set"}</option>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </Select>
        </div>
        {secretInputs.map(([k, label]) => (
          <div key={k}>
            <FieldLabel htmlFor={`g-${k}-${gateway.id}`}>
              {label} <span className="font-normal">(write-only)</span>
            </FieldLabel>
            <Input
              id={`g-${k}-${gateway.id}`}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={gateway.credentialsConfigured ? "•••••• stored — type to replace" : ""}
              value={fields[k]}
              onChange={(e) => setFields((p) => ({ ...p, [k]: e.target.value }))}
              aria-invalid={!!fieldIssue(save.error, k)}
            />
            {fieldIssue(save.error, k) && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(save.error, k)}</p>}
          </div>
        ))}
      </div>
      <Button type="submit" size="sm" disabled={!dirty || save.pending}>
        {save.pending ? "Saving…" : "Save configuration"}
      </Button>
      <ActionError error={save.error} />
    </form>
  );
}
