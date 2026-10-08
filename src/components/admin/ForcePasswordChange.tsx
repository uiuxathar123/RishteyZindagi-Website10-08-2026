"use client";

/**
 * Blocking screen shown instead of the admin panel while the signed-in admin is still on a
 * temporary password (set when an account is created or reset by a Super Admin). The server also
 * refuses every permission-gated admin action until the password is changed, so this is the
 * friendly counterpart of an enforced rule, not the rule itself.
 */
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionError, fieldIssue } from "./AdminUi";

export function ForcePasswordChange({ name, onLogout }: { name: string; onLogout: () => void }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useAction((body: { currentPassword: string; newPassword: string }) => adminApi.post<{ changed: true }>("/me/password", body));

  const mismatch = confirm !== "" && confirm !== next;
  const tooShort = next !== "" && next.length < 10;
  const sameAsOld = next !== "" && next === current;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch || tooShort || sameAsOld) return;
    const res = await change.run({ currentPassword: current, newPassword: next });
    if (!res) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-rz-cream px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-rz-border bg-white p-6 shadow-card-sm">
        <h1 className="flex items-center gap-2 font-serif text-xl font-bold text-rz-navy">
          <KeyRound className="h-5 w-5 text-rz-gold-rich" aria-hidden /> Choose a new password
        </h1>
        <p className="mt-2 text-sm text-rz-muted">
          Hello {name}. You are signed in with a temporary password. Choose your own password before using the admin panel.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4" autoComplete="off">
          <div>
            <FieldLabel htmlFor="fp-current">Temporary password</FieldLabel>
            <Input id="fp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div>
            <FieldLabel htmlFor="fp-new">New password (at least 10 characters)</FieldLabel>
            <Input id="fp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} aria-invalid={tooShort || sameAsOld || !!fieldIssue(change.error, "newPassword")} />
            {tooShort && <p className="mt-1 text-[12.5px] text-rz-danger">Use at least 10 characters.</p>}
            {sameAsOld && <p className="mt-1 text-[12.5px] text-rz-danger">Choose a password different from the temporary one.</p>}
            {fieldIssue(change.error, "newPassword") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(change.error, "newPassword")}</p>}
          </div>
          <div>
            <FieldLabel htmlFor="fp-confirm">Repeat new password</FieldLabel>
            <Input id="fp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required aria-invalid={mismatch} />
            {mismatch && <p className="mt-1 text-[12.5px] text-rz-danger">The passwords do not match.</p>}
          </div>
          <ActionError error={change.error} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="submit" disabled={change.pending || !current || !next || !confirm || mismatch || tooShort || sameAsOld}>
              {change.pending ? "Saving…" : "Change password"}
            </Button>
            <button type="button" onClick={onLogout} className="rz-focus text-sm text-rz-muted underline">
              Sign out
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
