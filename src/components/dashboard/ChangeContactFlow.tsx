"use client";

/**
 * Change e-mail / mobile (B19). Step 1: new value + current password → a code is sent to the NEW contact.
 * Step 2: enter the code. On success the account is updated, other devices are signed out and the session is refreshed.
 */
import { FormAlert } from "@/components/auth/FormAlert";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import { FormEvent, useState } from "react";

type Kind = "EMAIL" | "MOBILE";

export function ChangeContactFlow({ kind }: { kind: Kind }) {
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const label = kind === "EMAIL" ? "e-mail address" : "mobile number";

  const request = useAction((body: Record<string, unknown>) => api.post<{ sentTo: string }>("/users/me/contact-change/request", body));
  const confirm = useAction((body: Record<string, unknown>) => api.post<{ otherSessionsRevoked: number }>("/users/me/contact-change/confirm", body));

  function reset() {
    setOpen(false);
    setValue("");
    setPassword("");
    setCode("");
    setSentTo(null);
    request.clearError();
    confirm.clearError();
  }

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    const res = await request.run({ type: kind, newValue: value.trim(), ...(kind === "MOBILE" ? { countryCode: "+91" } : {}), password });
    if (res) {
      setPassword("");
      setSentTo(res.sentTo);
    }
  }
  async function onConfirm(e: FormEvent) {
    e.preventDefault();
    const res = await confirm.run({ type: kind, newValue: value.trim(), ...(kind === "MOBILE" ? { countryCode: "+91" } : {}), code: code.trim() });
    if (res) {
      setDone(res.otherSessionsRevoked > 0 ? `Your ${label} was updated. We signed you out on ${res.otherSessionsRevoked} other device${res.otherSessionsRevoked === 1 ? "" : "s"}.` : `Your ${label} was updated.`);
      reset();
      await refresh();
    }
  }

  if (done && !open) {
    return (
      <p role="status" className="mt-2 text-sm text-rz-success" data-testid={`contact-${kind.toLowerCase()}-done`}>
        {done}{" "}
        <button type="button" className="underline" onClick={() => setDone(null)}>OK</button>
      </p>
    );
  }
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)} data-testid={`change-${kind.toLowerCase()}`}>
        Change {label}
      </Button>
    );
  }

  return (
    <div className="mt-3 max-w-md rounded-md border border-rz-border bg-rz-ivory p-4" data-testid={`contact-${kind.toLowerCase()}-flow`}>
      {!sentTo ? (
        <form onSubmit={onRequest} className="space-y-3" noValidate>
          <div>
            <FieldLabel htmlFor={`cc-${kind}-new`}>New {label}</FieldLabel>
            <Input id={`cc-${kind}-new`} type={kind === "EMAIL" ? "email" : "tel"} inputMode={kind === "EMAIL" ? "email" : "numeric"} required value={value} onChange={(e) => setValue(e.target.value)} />
            {kind === "MOBILE" && <p className="mt-1 text-xs text-rz-muted">10-digit Indian mobile number, without +91.</p>}
          </div>
          <div>
            <FieldLabel htmlFor={`cc-${kind}-pw`}>Your password</FieldLabel>
            <Input id={`cc-${kind}-pw`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {request.error && <FormAlert tone="error">{request.error.kind === "unauthorized" ? "That password is not correct." : request.error.kind === "rate_limited" ? "Too many attempts. Please try again later." : request.error.firstIssue ?? request.error.friendlyMessage}</FormAlert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={request.pending || !value.trim() || !password}>{request.pending ? "Sending…" : "Send code"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={onConfirm} className="space-y-3" noValidate>
          <p className="text-sm text-rz-text">We sent a code to <strong>{sentTo}</strong>. Enter it to confirm the change.</p>
          <div>
            <FieldLabel htmlFor={`cc-${kind}-code`}>Verification code</FieldLabel>
            <Input id={`cc-${kind}-code`} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {confirm.error && <FormAlert tone="error">{confirm.error.kind === "unauthorized" ? "That code is invalid or has expired." : confirm.error.friendlyMessage}</FormAlert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={confirm.pending || code.trim().length < 4}>{confirm.pending ? "Checking…" : "Confirm change"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
