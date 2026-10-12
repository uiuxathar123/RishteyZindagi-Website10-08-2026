"use client";

import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import type { AdminIdentity } from "@/lib/api/types";
import { Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ActionError, fieldIssue } from "./AdminUi";

/**
 * Admin sign-in. Posts to `POST /admin/login` through the proxy, which keeps
 * the session token in an httpOnly ADMIN cookie (separate from the member
 * cookie) and returns only the admin identity.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<{ sentTo: string } | null>(null);
  const [code, setCode] = useState("");
  const login = useAction((body: { email: string; password: string }) =>
    adminApi.post<{ admin: AdminIdentity["admin"]; expiresAt: string } | { mfaRequired: true; sentTo: string }>("/login", body)
  );
  const verify = useAction((body: { email: string; code: string }) =>
    adminApi.post<{ admin: AdminIdentity["admin"]; expiresAt: string }>("/login/verify-mfa", body)
  );

  function done() {
    setPassword("");
    setCode("");
    router.replace("/admin");
    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await login.run({ email: email.trim(), password });
    if (!result) return;
    if ("mfaRequired" in result) {
      setMfa({ sentTo: result.sentTo });
      return;
    }
    done();
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    const result = await verify.run({ email: email.trim(), code: code.trim() });
    if (result) done();
  }

  if (mfa) {
    return (
      <form onSubmit={onVerify} className="mt-6 space-y-4" noValidate aria-label="Verification code" data-testid="admin-mfa-form">
        <p className="text-[13.5px] text-rz-text">
          We e-mailed a verification code to <strong>{mfa.sentTo}</strong>. Enter it to finish signing in.
        </p>
        <div>
          <FieldLabel htmlFor="admin-mfa-code">Verification code</FieldLabel>
          <Input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div aria-live="polite">
          {verify.error && (
            <p role="alert" className="rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-[13px] text-rz-danger">
              {verify.error.kind === "unauthorized" ? "That code is invalid or has expired. Go back and sign in again for a new one." : verify.error.friendlyMessage}
            </p>
          )}
        </div>
        <Button type="submit" fullWidth disabled={verify.pending || code.trim().length < 4}>
          {verify.pending ? "Verifying…" : "Verify and sign in"}
        </Button>
        <Button type="button" variant="ghost" fullWidth onClick={() => { setMfa(null); setCode(""); verify.clearError(); login.clearError(); }}>
          Back
        </Button>
      </form>
    );
  }

  const err = login.error;
  const emailIssue = fieldIssue(err, "email");
  const wrongCredentials = err?.kind === "unauthorized";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <FieldLabel htmlFor="admin-email">Email</FieldLabel>
        <Input
          id="admin-email"
          type="email"
          autoComplete="username"
          required
          icon={<Mail className="h-4 w-4" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!emailIssue}
          aria-describedby={emailIssue ? "admin-email-err" : undefined}
        />
        {emailIssue && (
          <p id="admin-email-err" className="mt-1 text-[12.5px] text-rz-danger">
            {emailIssue}
          </p>
        )}
      </div>
      <div>
        <FieldLabel htmlFor="admin-password">Password</FieldLabel>
        <Input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          required
          icon={<Lock className="h-4 w-4" />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div aria-live="polite">
        {err && (
          <p role="alert" className="rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-[13px] text-rz-danger">
            {wrongCredentials
              ? err.message || "That email and password don't match an admin account."
              : err.kind === "rate_limited"
              ? "Too many sign-in attempts. Please wait a minute and try again."
              : err.kind === "validation"
              ? err.firstIssue ?? "Enter a valid email address and your password."
              : err.friendlyMessage}
          </p>
        )}
      </div>

      <Button type="submit" fullWidth disabled={login.pending || !email.trim() || !password}>
        {login.pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
