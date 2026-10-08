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
  const login = useAction((body: { email: string; password: string }) =>
    adminApi.post<{ admin: AdminIdentity["admin"]; expiresAt: string }>("/login", body)
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await login.run({ email: email.trim(), password });
    if (!result) return;
    setPassword("");
    router.replace("/admin");
    router.refresh();
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
