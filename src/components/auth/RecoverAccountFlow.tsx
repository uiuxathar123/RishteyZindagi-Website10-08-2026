"use client";

/**
 * Recover an account that is pending deletion (signed out, so it uses the auth-entry endpoints):
 *   POST /auth/recover-account/request { email, password }  -> code sent only if the account is recoverable
 *   POST /auth/recover-account/confirm { email, code }      -> account restored; the member then logs in normally
 * The reply to step 1 is identical whether or not the account exists or is eligible, so this screen can
 * not be used to discover accounts. The password is kept in memory only for the length of the flow
 * (it is needed again to resend a code) and is cleared when the flow finishes or is abandoned.
 */
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { api } from "@/lib/api/client";
import type { OtpChallenge } from "@/lib/api/types";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { FieldError, FormAlert } from "./FormAlert";
import { OtpChallengePanel, messageOf } from "./OtpChallengePanel";

type Step = "credentials" | "code" | "done";
type Challenge = Omit<OtpChallenge, "identifier">;

export function RecoverAccountFlow() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function request(): Promise<Challenge> {
    return api.post<Challenge>("/auth/recover-account/request", { email: email.trim().toLowerCase(), password });
  }

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setEmailError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    try {
      setChallenge(await request());
      setEmail(email.trim().toLowerCase());
      setStep("code");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function confirm(code: string) {
    await api.post("/auth/recover-account/confirm", { email, code });
    setPassword("");
    setStep("done");
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">Your account has been recovered. You can log in again.</FormAlert>
        <Link href="/login" className="rz-focus inline-block text-sm font-semibold text-rz-maroon">
          Go to log in →
        </Link>
      </div>
    );
  }

  if (step === "code" && challenge) {
    return (
      <OtpChallengePanel
        idPrefix="recover"
        challenge={challenge}
        destination={email}
        purpose="ACCOUNT_RECOVERY"
        devIdentifier={email}
        submitLabel="Recover my account"
        onSubmit={confirm}
        onResend={request}
        onBack={() => {
          setPassword("");
          setStep("credentials");
        }}
        backLabel="Start over"
      >
        <p className="text-xs text-rz-muted">
          If this account can be recovered, a code was sent. If you do not receive one, check the email address and password, and that the recovery period has not ended.
        </p>
      </OtpChallengePanel>
    );
  }

  return (
    <form onSubmit={onRequest} className="space-y-5" noValidate>
      <div>
        <FieldLabel htmlFor="recover-email">Email address</FieldLabel>
        <Input
          id="recover-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "recover-email-error" : undefined}
        />
        <FieldError id="recover-email-error">{emailError}</FieldError>
      </div>
      <div>
        <FieldLabel htmlFor="recover-password">Password</FieldLabel>
        <Input id="recover-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <Button type="submit" fullWidth size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send verification code"}
      </Button>
    </form>
  );
}
