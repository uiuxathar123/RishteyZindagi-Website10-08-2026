"use client";

import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { LoginResponse, OtpChallenge } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { FieldError, FormAlert } from "./FormAlert";
import { OtpChallengePanel, messageOf } from "./OtpChallengePanel";
import { safeNext } from "./safeNext";

type Mode = "password" | "otp";
type Verify = { kind: "device" | "login"; challenge: OtpChallenge } | null;

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Sign in with email + password, or with an emailed one-time code. The
 * backend identifies members by EMAIL only (mobile numbers are not a login
 * identifier). A password login from a browser the account has not used
 * before returns `deviceVerificationRequired`; the person then confirms with
 * a one-time code before a session is issued. The session itself is an
 * httpOnly cookie set by the /bff proxy — this component never sees a token.
 */
export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Only an explicit, valid destination is passed on to signup (not the /dashboard fallback).
  const requestedNext = safeNext(params.get("next"), "");
  const expired = params.get("expired") === "1";

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verify, setVerify] = useState<Verify>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  function enter() {
    // Hard navigation: the session cookie was just set, so every server
    // layout (header, dashboard guard) must render fresh.
    window.location.assign(next);
  }

  function setModeSafe(m: Mode) {
    setMode(m);
    setError(null);
    setFieldErrors({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const fe: typeof fieldErrors = {};
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) fe.email = "Enter the email address you registered with.";
    if (mode === "password" && !password) fe.password = "Enter your password.";
    setFieldErrors(fe);
    if (fe.email || fe.password) return;

    setPending(true);
    try {
      if (mode === "password") {
        const res = await api.post<LoginResponse>("/auth/login", { email: value, password });
        if ("deviceVerificationRequired" in res) {
          setVerify({ kind: "device", challenge: res });
        } else {
          enter();
          return;
        }
      } else {
        const c = await api.post<Omit<OtpChallenge, "identifier">>("/auth/request-login-otp", { email: value });
        setVerify({ kind: "login", challenge: { ...c, identifier: value } });
      }
      setEmail(value);
    } catch (err) {
      if (isApiError(err) && err.kind === "validation" && err.details.length) {
        const map: typeof fieldErrors = {};
        for (const d of err.details) {
          if (d.path === "email") map.email = d.message;
          if (d.path === "password") map.password = d.message;
        }
        setFieldErrors(map);
        if (!map.email && !map.password) setError(err.friendlyMessage);
      } else {
        // Wrong password is a 401 with a deliberately generic message — shown inline, no redirect.
        setError(messageOf(err));
      }
    } finally {
      setPending(false);
    }
  }

  if (verify) {
    const device = verify.kind === "device";
    return (
      <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:p-8">
        <h2 className="mb-1 font-serif text-xl font-semibold text-rz-navy">
          {device ? "Confirm this device" : "Enter your login code"}
        </h2>
        {device && (
          <p className="mb-4 text-sm text-rz-muted">
            This looks like a device or browser we haven&apos;t seen on your account. Confirm it&apos;s you to finish
            logging in.
          </p>
        )}
        <OtpChallengePanel
          idPrefix="login-otp"
          challenge={verify.challenge}
          destination={verify.challenge.identifier}
          purpose={device ? "NEW_DEVICE" : "LOGIN"}
          devIdentifier={verify.challenge.identifier}
          submitLabel={device ? "Verify & log in" : "Log in"}
          onSubmit={async (code) => {
            if (device) {
              await api.post("/auth/verify-device", { identifier: verify.challenge.identifier, code });
            } else {
              await api.post("/auth/verify-login-otp", { email: verify.challenge.identifier, code });
            }
            enter();
            // keep the button disabled while the browser navigates
            await new Promise(() => undefined);
          }}
          onResend={() =>
            api.post<Omit<OtpChallenge, "identifier">>("/auth/resend-otp", {
              identifier: verify.challenge.identifier,
              purpose: device ? "NEW_DEVICE" : "LOGIN",
            })
          }
          onBack={() => {
            setVerify(null);
            setError(null);
          }}
          backLabel="Back to log in"
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:p-8">
      {expired && (
        <FormAlert tone="info" className="mb-5">
          Your session has expired. Please log in again to continue.
        </FormAlert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-rz-cream p-1" role="tablist" aria-label="Login method">
        {(["password", "otp"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setModeSafe(m)}
            className={cn(
              "rz-focus rounded-full py-2 text-sm font-semibold transition-colors",
              mode === m ? "bg-white text-rz-maroon shadow-card-sm" : "text-rz-muted hover:text-rz-navy"
            )}
          >
            {m === "password" ? "Password" : "One-time code"}
          </button>
        ))}
      </div>

      <form className="space-y-5" onSubmit={submit} noValidate>
        <div>
          <FieldLabel htmlFor="login-email">Email address</FieldLabel>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
          />
          <FieldError id="login-email-error">{fieldErrors.email}</FieldError>
        </div>

        {mode === "password" ? (
          <div>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="login-password">Password</FieldLabel>
              <Link href="/forgot-password" className="rz-focus mb-1.5 text-xs font-semibold text-rz-maroon">
                Forgot password?
              </Link>
            </div>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
            />
            <FieldError id="login-password-error">{fieldErrors.password}</FieldError>
          </div>
        ) : (
          <p className="rounded-md bg-rz-peach/50 px-4 py-3 text-xs leading-relaxed text-rz-text">
            We&apos;ll send a one-time verification code to your registered contact to log you in — no password needed.
          </p>
        )}

        {error && <FormAlert tone="error">{error}</FormAlert>}

        <Button type="submit" fullWidth size="lg" disabled={pending}>
          {pending ? "Please wait…" : mode === "password" ? "Log In" : "Send Verification Code"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-rz-muted">
        New to RishteyZindagi?{" "}
        <Link href={requestedNext ? `/signup?next=${encodeURIComponent(requestedNext)}` : "/signup"} className="rz-focus font-semibold text-rz-maroon">
          Create a free profile
        </Link>
      </p>
    </div>
  );
}
