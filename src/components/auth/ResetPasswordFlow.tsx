"use client";

/**
 * Forgot / reset password, the only password-change path the backend has:
 *   POST /auth/forgot-password { email }            -> OTP challenge (same reply whether or not the account exists)
 *   POST /auth/reset-password { email, code, newPassword } -> password changed, ALL sessions revoked
 * Used on /forgot-password and (with the email locked) from Settings.
 */
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { OtpChallenge } from "@/lib/api/types";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { FieldError, FormAlert } from "./FormAlert";
import { OtpChallengePanel, messageOf } from "./OtpChallengePanel";

type Step = "email" | "reset" | "done";

export function ResetPasswordFlow({
  initialEmail = "",
  lockEmail = false,
  onDone,
}: {
  initialEmail?: string;
  /** Settings passes the signed-in email; the field is then read-only. */
  lockEmail?: boolean;
  /** Called once the backend confirmed the reset (sessions are gone by then). */
  onDone?: () => void;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setEmailError(null);
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setPending(true);
    try {
      const c = await api.post<Omit<OtpChallenge, "identifier">>("/auth/forgot-password", { email: value });
      setChallenge({ ...c, identifier: value });
      setEmail(value);
      setStep("reset");
    } catch (err) {
      if (isApiError(err) && err.kind === "validation" && err.details.find((d) => d.path === "email")) {
        setEmailError(err.details.find((d) => d.path === "email")!.message);
      } else {
        setError(messageOf(err));
      }
    } finally {
      setPending(false);
    }
  }

  async function reset(code: string) {
    setPwError(null);
    if (password.length < 8) {
      setPwError("Password must be at least 8 characters.");
      throw new Error("Choose a new password of at least 8 characters.");
    }
    if (password !== confirm) {
      setPwError("The two passwords don't match.");
      throw new Error("The two passwords don't match.");
    }
    try {
      await api.post("/auth/reset-password", { email, code, newPassword: password });
    } catch (err) {
      if (isApiError(err)) {
        const issue = err.details.find((d) => d.path === "newPassword");
        if (issue) setPwError(issue.message);
      }
      throw err;
    }
    setPassword("");
    setConfirm("");
    setStep("done");
    onDone?.();
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">Your password has been changed. For your security you were signed out everywhere.</FormAlert>
        <Link href="/login" className="rz-focus inline-block text-sm font-semibold text-rz-maroon">
          Go to log in →
        </Link>
      </div>
    );
  }

  if (step === "reset" && challenge) {
    return (
      <OtpChallengePanel
        idPrefix="reset"
        challenge={challenge}
        destination={email}
        purpose="FORGOT_PASSWORD"
        devIdentifier={email}
        submitLabel="Reset password"
        onSubmit={reset}
        onResend={async () => {
          const c = await api.post<Omit<OtpChallenge, "identifier">>("/auth/resend-otp", {
            identifier: email,
            purpose: "FORGOT_PASSWORD",
          });
          return c;
        }}
        onBack={() => setStep("email")}
        backLabel={lockEmail ? "Cancel" : "Use a different email"}
      >
        <p className="text-xs text-rz-muted">
          If an account exists for this email, a code was sent. Codes are only valid for a short time.
        </p>
        <div>
          <FieldLabel htmlFor="reset-new-password">New password</FieldLabel>
          <Input
            id="reset-new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            aria-invalid={pwError ? true : undefined}
            aria-describedby={pwError ? "reset-pw-error" : undefined}
          />
        </div>
        <div>
          <FieldLabel htmlFor="reset-confirm-password">Confirm new password</FieldLabel>
          <Input
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter password"
          />
          <FieldError id="reset-pw-error">{pwError}</FieldError>
        </div>
      </OtpChallengePanel>
    );
  }

  return (
    <form onSubmit={requestCode} className="space-y-5" noValidate>
      <div>
        <FieldLabel htmlFor="forgot-email">Email address</FieldLabel>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={lockEmail}
          placeholder="you@example.com"
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "forgot-email-error" : undefined}
        />
        <FieldError id="forgot-email-error">{emailError}</FieldError>
      </div>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button type="submit" fullWidth size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send verification code"}
      </Button>
    </form>
  );
}
