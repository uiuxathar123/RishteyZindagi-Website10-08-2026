"use client";

/**
 * Account settings built only from what the backend really offers:
 *   - account details (GET /users/me, read-only — there is no endpoint to change them)
 *   - password change via the OTP reset flow (the only password endpoint)
 *   - log out this device / all devices (POST /auth/logout, /auth/logout-all)
 *   - warnings from the team + acknowledge (GET /warnings/me, POST /warnings/{id}/acknowledge)
 *   - blocked members + unblock (GET /interactions/blocks, DELETE /interactions/blocks/{userId})
 *   - delete account (POST /users/me/delete-account): password + typed phrase; recoverable until the date the
 *     server returns, then permanently anonymised
 * Privacy / notification preferences and contact changes
 * have no backend yet and are listed honestly as "not available" instead of
 * as controls that would do nothing.
 */
import { FormAlert } from "@/components/auth/FormAlert";
import { FieldLabel, Input } from "@/components/ui/Input";
import { ResetPasswordFlow } from "@/components/auth/ResetPasswordFlow";
import { useSession } from "@/components/session/SessionProvider";
import { ApiErrorView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { BlockView, WarningView } from "@/lib/api/types";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { Ban, Info, KeyRound, LogOut, ShieldAlert, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { ReactNode, useState } from "react";

function Section({ id, title, icon, children }: { id?: string; title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border border-rz-border bg-white p-5 md:p-6">
      <h3 className="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-rz-navy">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-semibold text-rz-muted">{label}</dt>
      <dd className="mt-1 break-words text-[15px] text-rz-text">{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------- account */

function AccountSection() {
  const { user } = useSession();
  if (!user) return null;
  return (
    <Section title="Account" icon={<UserRound className="h-5 w-5 text-rz-maroon" />}>
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Row label="Name">{user.name}</Row>
        <Row label="Member since">{formatDate(user.createdAt)}</Row>
        <Row label="Email address">
          <span className="break-all">{user.email}</span>{" "}
          <Badge tone={user.emailVerified ? "success" : "neutral"}>{user.emailVerified ? "Verified" : "Not verified"}</Badge>
        </Row>
        <Row label="Mobile number">
          {user.countryCode} {user.mobileNumber}{" "}
          <Badge tone={user.mobileVerified ? "success" : "neutral"}>{user.mobileVerified ? "Verified" : "Not verified"}</Badge>
        </Row>
        <Row label="Account status">{humanize(user.status)}</Row>
      </dl>
      <p className="mt-4 text-xs text-rz-muted">
        Changing your email address or mobile number isn&apos;t available yet.
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------- password */

function PasswordSection() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <Section title="Change password" icon={<KeyRound className="h-5 w-5 text-rz-maroon" />}>
      <p className="mb-4 text-sm text-rz-muted">
        For your security, passwords are changed with a one-time code sent to <strong className="break-all text-rz-navy">{user.email}</strong>.
        Changing it signs you out of every device.
      </p>
      {open ? (
        <div className="max-w-md">
          <ResetPasswordFlow initialEmail={user.email} lockEmail />
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Send me a reset code
        </Button>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------- sessions */

function SessionsSection() {
  const { logout, logoutAll } = useSession();
  const [confirming, setConfirming] = useState(false);
  const out = useAction(async () => {
    await logout();
  });
  const outAll = useAction(async () => {
    await logoutAll(); // navigates away on success; throws (shown below) on failure
  });

  return (
    <Section title="Sessions" icon={<LogOut className="h-5 w-5 text-rz-maroon" />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-rz-text">Log out of this browser.</p>
          <Button variant="outline" size="sm" onClick={() => void out.run()} disabled={out.pending}>
            {out.pending ? "Logging out…" : "Log out"}
          </Button>
        </div>
        <div className="border-t border-rz-border pt-4">
          {confirming ? (
            <div className="rounded-md border border-rz-danger/30 bg-rz-danger/5 p-4">
              <p className="text-sm font-medium text-rz-text">
                This signs you out everywhere — this browser and every other device where you&apos;re logged in. Continue?
              </p>
              {outAll.error && (
                <FormAlert tone="error" className="mt-3">
                  {outAll.error.friendlyMessage}
                </FormAlert>
              )}
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={outAll.pending}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-rz-danger text-rz-danger hover:bg-rz-danger/10"
                  onClick={() => void outAll.run()}
                  disabled={outAll.pending}
                >
                  {outAll.pending ? "Logging out…" : "Yes, log out of all devices"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-rz-text">Lost a device or think someone else has access? Sign out everywhere.</p>
              <Button
                variant="outline"
                size="sm"
                className="border-rz-danger text-rz-danger hover:bg-rz-danger/10"
                onClick={() => setConfirming(true)}
              >
                Log out of all devices
              </Button>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- warnings */

function WarningsSection() {
  const state = useAsync((signal) => api.get<{ warnings: WarningView[] }>("/warnings/me", { signal }), []);
  const ack = useAction(async (id: string) => {
    const r = await api.post<{ warning: WarningView }>(`/warnings/${id}/acknowledge`);
    state.setData((prev) => (prev ? { warnings: prev.warnings.map((w) => (w.id === id ? { ...w, ...r.warning } : w)) } : prev));
  });

  return (
    <Section id="warnings" title="Warnings from our team" icon={<ShieldAlert className="h-5 w-5 text-rz-maroon" />}>
      {state.loading && !state.data ? (
        <ListSkeleton rows={2} />
      ) : state.error && !state.data ? (
        <ApiErrorView error={state.error} onRetry={state.reload} />
      ) : state.data && state.data.warnings.length === 0 ? (
        <p className="text-sm text-rz-muted">You have no warnings. Thank you for following the community guidelines.</p>
      ) : (
        <>
          {ack.error && (
            <FormAlert tone="error" className="mb-4">
              {ack.error.friendlyMessage}
            </FormAlert>
          )}
          <ul className="space-y-3">
            {state.data?.warnings.map((w) => (
              <li key={w.id} className="rounded-md border border-rz-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-rz-muted">Issued {formatDateTime(w.createdAt)}</span>
                  {w.acknowledgedAt ? (
                    <Badge tone="success">Acknowledged {formatDate(w.acknowledgedAt)}</Badge>
                  ) : (
                    <Badge tone="gold">Needs acknowledgement</Badge>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-line break-words text-sm text-rz-text">{w.message}</p>
                {!w.acknowledgedAt && (
                  <Button size="sm" variant="outline" className="mt-3" disabled={ack.pending} onClick={() => void ack.run(w.id)}>
                    I&apos;ve read this — acknowledge
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- blocked */

function BlockedSection() {
  const state = useAsync((signal) => api.get<{ blocks: BlockView[] }>("/interactions/blocks", { signal }), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const unblock = useAction(async (b: BlockView) => {
    setBusyId(b.blockedUserId);
    try {
      await api.delete(`/interactions/blocks/${b.blockedUserId}`);
      state.setData((prev) => (prev ? { blocks: prev.blocks.filter((x) => x.id !== b.id) } : prev));
    } finally {
      setBusyId(null);
    }
  });

  return (
    <Section id="blocked" title="Blocked members" icon={<Ban className="h-5 w-5 text-rz-maroon" />}>
      {state.loading && !state.data ? (
        <ListSkeleton rows={2} />
      ) : state.error && !state.data ? (
        <ApiErrorView error={state.error} onRetry={state.reload} />
      ) : state.data && state.data.blocks.length === 0 ? (
        <p className="text-sm text-rz-muted">You haven&apos;t blocked anyone. You can block a member from their profile page.</p>
      ) : (
        <>
          {unblock.error && (
            <FormAlert tone="error" className="mb-4">
              {unblock.error.friendlyMessage}
            </FormAlert>
          )}
          <ul className="divide-y divide-rz-border rounded-md border border-rz-border">
            {state.data?.blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-rz-navy">
                    {b.counterpart.profileId ? (
                      <Link href={`/dashboard/members/${b.counterpart.profileId}`} className="rz-focus hover:underline">
                        {b.counterpart.name ?? "Member"}
                      </Link>
                    ) : (
                      (b.counterpart.name ?? "Member")
                    )}
                  </p>
                  <p className="text-xs text-rz-muted">Blocked {formatDate(b.createdAt)}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busyId === b.blockedUserId} onClick={() => void unblock.run(b)}>
                  {busyId === b.blockedUserId ? "Unblocking…" : "Unblock"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------ delete account */

const DELETE_PHRASE = "DELETE MY ACCOUNT";

interface DeletionResult {
  status: "DELETED_PENDING";
  recoverUntil: string;
  recoveryWindowDays: number;
}

function DeleteAccountSection() {
  const { logout } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [result, setResult] = useState<DeletionResult | null>(null);
  const del = useAction((body: { password: string; confirmation: string }) => api.post<DeletionResult>("/users/me/delete-account", body));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await del.run({ password, confirmation: phrase });
    setPassword("");
    if (res) setResult(res);
  }

  if (result) {
    return (
      <Section title="Account scheduled for deletion" icon={<Trash2 className="h-5 w-5 text-rz-danger" />}>
        <FormAlert tone="success">
          Your account is scheduled for deletion and you have been signed out of every device. You can recover it until{" "}
          <strong>{formatDate(result.recoverUntil)}</strong> ({result.recoveryWindowDays} days). After that it is permanently anonymised and cannot be restored.
        </FormAlert>
        <p className="mt-3 text-sm text-rz-muted">To change your mind, use “Recover your account” on the log-in page.</p>
        <Button className="mt-4" onClick={() => void logout()}>
          Continue
        </Button>
      </Section>
    );
  }

  return (
    <Section title="Delete account" icon={<Trash2 className="h-5 w-5 text-rz-danger" />}>
      <p className="text-sm text-rz-text">
        Deleting your account hides your profile, ends your sessions and, after a recovery period, permanently removes your personal details and photos. Payment and invoice records the law requires us to keep are retained without your personal details.
      </p>
      {open ? (
        <form onSubmit={onSubmit} className="mt-4 max-w-md space-y-4 rounded-md border border-rz-danger/30 bg-rz-danger/5 p-4" autoComplete="off">
          <div>
            <FieldLabel htmlFor="del-password">Your password</FieldLabel>
            <Input id="del-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="del-phrase">
              Type <span className="font-mono">{DELETE_PHRASE}</span> to confirm
            </FieldLabel>
            <Input id="del-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} spellCheck={false} />
          </div>
          {del.error && <FormAlert tone="error">{del.error.friendlyMessage}</FormAlert>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={del.pending} onClick={() => { setOpen(false); setPassword(""); setPhrase(""); del.clearError(); }}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="!bg-rz-danger hover:!bg-rz-danger/90" disabled={del.pending || !password || phrase !== DELETE_PHRASE}>
              {del.pending ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="mt-4 border-rz-danger text-rz-danger hover:bg-rz-danger/10" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      )}
    </Section>
  );
}

/* ------------------------------------------------------- not available */

function UnavailableSection() {
  const items = [
    ["Privacy controls", "Choosing who can see your profile or photo, and hiding your last-active time."],
    ["Notification preferences", "Turning email, SMS or match-alert notifications on or off."],
    ["Changing email or mobile number", "Updating the contact details on your account."],
  ];
  return (
    <section className="rounded-lg border border-dashed border-rz-border bg-rz-cream/50 p-5 md:p-6">
      <h3 className="mb-1 flex items-center gap-2 font-serif text-lg font-semibold text-rz-navy">
        <Info className="h-5 w-5 text-rz-muted" />
        Not available yet
      </h3>
      <p className="mb-3 text-sm text-rz-muted">These settings aren&apos;t supported by the platform yet, so there are no controls for them here.</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-rz-text">
        {items.map(([title, text]) => (
          <li key={title}>
            <span className="font-semibold">{title}</span> — <span className="text-rz-muted">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsView() {
  return (
    <div className="space-y-8">
      <AccountSection />
      <PasswordSection />
      <SessionsSection />
      <WarningsSection />
      <BlockedSection />
      <DeleteAccountSection />
      <UnavailableSection />
    </div>
  );
}
