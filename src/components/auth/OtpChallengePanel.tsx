"use client";

/**
 * Shared "enter the code we sent you" step used by signup, new-device login,
 * OTP login and password reset. Everything shown (channel, expiry, resend
 * cooldown) comes from the OTP challenge the backend returned — nothing is
 * hard-coded. The code length is decided by the backend's OTP config
 * (6 by default); the field only accepts digits and the backend decides
 * whether the code is right.
 */
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { isApiError } from "@/lib/api/errors";
import type { OtpChallenge, OtpPurpose } from "@/lib/api/types";
import { DevOtpHelper } from "./DevOtpHelper";
import { FormAlert } from "./FormAlert";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

export interface ChallengeTimes {
  /** Local epoch ms when the code expires. */
  expiresAt: number;
  /** Local epoch ms when a new code may be requested. */
  resendAt: number;
}

export function timesFor(challenge: Pick<OtpChallenge, "expiresInSeconds" | "resendAvailableAt">): ChallengeTimes {
  const now = Date.now();
  const resend = Date.parse(challenge.resendAvailableAt);
  // Guard against clock skew between the server and this device: the
  // cooldown is never shown as longer than the code's own lifetime.
  const maxResend = now + challenge.expiresInSeconds * 1000;
  return {
    expiresAt: now + challenge.expiresInSeconds * 1000,
    resendAt: Number.isFinite(resend) ? Math.min(Math.max(resend, now), maxResend) : now,
  };
}

export function channelPhrase(channel: OtpChallenge["channel"] | string): string {
  switch (channel) {
    case "EMAIL":
      return "email";
    case "SMS":
      return "mobile number by SMS";
    case "WHATSAPP":
      return "WhatsApp number";
    default:
      return "registered contact";
  }
}

function useCountdown(target: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil((target - now) / 1000));
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function messageOf(e: unknown): string {
  if (isApiError(e)) {
    // Auth-entry 401s carry the real reason ("Invalid email or password.",
    // "Invalid or expired code.") — the generic "session ended" text would mislead.
    if (e.kind === "unauthorized" && e.message) return e.message;
    return e.friendlyMessage;
  }
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}

export function OtpChallengePanel({
  challenge,
  destination,
  purpose,
  devIdentifier,
  submitLabel,
  onSubmit,
  onResend,
  onBack,
  backLabel,
  children,
  idPrefix = "otp",
}: {
  challenge: Pick<OtpChallenge, "channel" | "expiresInSeconds" | "resendAvailableAt">;
  /** Where the code went, e.g. the email or phone the person typed. */
  destination: string;
  purpose: OtpPurpose;
  /** Identifier the backend keyed the OTP on (for the dev-only helper). */
  devIdentifier: string;
  submitLabel: string;
  /** Throw to show an error; resolve to continue. */
  onSubmit: (code: string) => Promise<void>;
  /** Request a fresh code; resolves with the new challenge. */
  onResend: () => Promise<Pick<OtpChallenge, "channel" | "expiresInSeconds" | "resendAvailableAt">>;
  onBack?: () => void;
  backLabel?: string;
  /** Extra fields rendered between the code and the submit button. */
  children?: ReactNode;
  idPrefix?: string;
}) {
  const [code, setCode] = useState("");
  const [times, setTimes] = useState<ChallengeTimes>(() => timesFor(challenge));
  const [channel, setChannel] = useState(challenge.channel);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const expiresIn = useCountdown(times.expiresAt);
  const resendIn = useCountdown(times.resendAt);
  const expired = expiresIn === 0;

  const digitsOk = useMemo(() => /^[0-9]{4,10}$/.test(code), [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!digitsOk) {
      setError("Enter the verification code we sent you (digits only).");
      return;
    }
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await onSubmit(code);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (resending || resendIn > 0) return;
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const next = await onResend();
      setChannel(next.channel);
      setTimes(timesFor(next));
      setCode("");
      setNotice("A new code has been sent.");
      inputRef.current?.focus();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <p className="text-sm text-rz-muted">
        We sent a verification code to your {channelPhrase(channel)}
        {destination ? (
          <>
            {" "}
            (<span className="break-all font-semibold text-rz-navy">{destination}</span>)
          </>
        ) : null}
        . Enter it below.
      </p>

      <div>
        <FieldLabel htmlFor={`${idPrefix}-code`}>Verification code</FieldLabel>
        <Input
          id={`${idPrefix}-code`}
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          aria-describedby={error ? `${idPrefix}-error` : `${idPrefix}-hint`}
          aria-invalid={error ? true : undefined}
          className="text-center font-mono text-xl tracking-[0.35em]"
        />
        <p id={`${idPrefix}-hint`} className="mt-1.5 text-xs text-rz-muted" aria-live="polite">
          {expired ? "This code has expired — request a new one." : `Code expires in ${mmss(expiresIn)}.`}
        </p>
      </div>

      {children}

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {notice && !error && <FormAlert tone="success">{notice}</FormAlert>}

      <Button type="submit" fullWidth size="lg" disabled={pending}>
        {pending ? "Please wait…" : submitLabel}
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={resend}
          disabled={resending || resendIn > 0}
          className="rz-focus font-semibold text-rz-maroon disabled:cursor-not-allowed disabled:text-rz-muted"
        >
          {resending ? "Sending…" : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </button>
        {onBack && (
          <button type="button" onClick={onBack} className="rz-focus font-semibold text-rz-muted hover:text-rz-maroon">
            {backLabel ?? "Back"}
          </button>
        )}
      </div>

      <DevOtpHelper identifier={devIdentifier} purpose={purpose} onCode={(c) => setCode(c)} />
    </form>
  );
}

