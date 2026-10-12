"use client";

/**
 * Real platform-configuration editors for the Admin Panel. Every value shown
 * is read from the API and every "saved" message appears only after the API
 * accepted the change; on failure the server's own message (including
 * per-field validation) is shown and the form keeps what the admin typed.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { cn } from "@/lib/utils";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { MatchingWeights, OtpConfig } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, Card, fieldIssue, SuccessNote } from "./AdminUi";
import { WEIGHT_CATEGORIES } from "./adminTypes";

// ---------------------------------------------------------------------------
// OTP configuration
// ---------------------------------------------------------------------------

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
    <Card title="One-time passwords (OTP)" description="Code length, expiry and attempt limits for sign-up, new-device login, password-reset and account-recovery codes.">
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
  const [enabled, setEnabled] = useState(config.enabled);
  const [devMode, setDevMode] = useState(config.devMode);
  const [nums, setNums] = useState<Record<string, string>>(() =>
    Object.fromEntries(OTP_NUMBERS.map((n) => [n.key, String(config[n.key])]))
  );
  const [saved, setSaved] = useState(false);
  const save = useAction((body: Record<string, unknown>) => adminApi.patch<OtpConfig>("/otp/config", body));

  const patch = useMemo(() => {
    const body: Record<string, unknown> = {};
    if (enabled !== config.enabled) body.enabled = enabled;
    if (devMode !== config.devMode) body.devMode = devMode;
    for (const n of OTP_NUMBERS) {
      const raw = nums[n.key];
      const v = raw.trim() === "" ? NaN : Number(raw);
      if (v !== config[n.key]) body[n.key] = v;
    }
    return body;
  }, [enabled, devMode, nums, config]);

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
      <p className="rounded-md bg-rz-cream px-3 py-2 text-[12.5px] text-rz-muted">
        The delivery provider (Email or Fast2SMS) is chosen in the “OTP delivery provider” card above. The settings below apply to whichever provider is active.
      </p>

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
