"use client";

/**
 * Manual account moderation for the user drawer: suspend, lift suspension, ban, lift ban.
 * A reason of at least 5 characters is mandatory for every action (the server enforces it too) and
 * every action is audited. Buttons appear only for the permissions the signed-in role holds
 * (users.suspend / users.ban); the server re-checks on every call. Warnings stay in IssueWarning.
 */
import { AsyncView, ListSkeleton } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { ModerationView } from "@/lib/api/pcp-types";
import { formatDate, formatDateTime } from "@/lib/format";
import { useState } from "react";
import { useAdminSession } from "./AdminSessionProvider";
import { ActionError, fieldIssue, Modal, SuccessNote } from "./AdminUi";

type ActionKind = "suspend" | "lift-suspension" | "ban" | "unban";

const COPY: Record<ActionKind, { title: string; confirm: string; done: string; destructive: boolean; help: string }> = {
  suspend: {
    title: "Suspend account",
    confirm: "Suspend",
    done: "Account suspended.",
    destructive: true,
    help: "The member is signed out of every device and cannot sign in until the suspension is lifted.",
  },
  "lift-suspension": { title: "Lift suspension", confirm: "Lift suspension", done: "Suspension lifted.", destructive: false, help: "The member can sign in again." },
  ban: {
    title: "Ban account",
    confirm: "Ban",
    done: "Account banned.",
    destructive: true,
    help: "The member is signed out everywhere and blocked. Only a Super Admin can lift a ban.",
  },
  unban: { title: "Lift ban", confirm: "Lift ban", done: "Ban lifted.", destructive: false, help: "The account is restored to active." },
};

export function ModerationPanel({ userId, onDone }: { userId: string; onDone: () => void }) {
  const view = useAsync((signal) => adminApi.get<ModerationView>(`/users/${userId}/moderation`, { signal }), [userId]);
  return (
    <AsyncView data={view.data} error={view.error} loading={view.loading} reload={view.reload} skeleton={<ListSkeleton rows={2} />}>
      {(v) => (
        <ModerationBody
          view={v}
          userId={userId}
          onDone={() => {
            view.reload();
            onDone();
          }}
        />
      )}
    </AsyncView>
  );
}

function ModerationBody({ view, userId, onDone }: { view: ModerationView; userId: string; onDone: () => void }) {
  const { can } = useAdminSession();
  const [dialog, setDialog] = useState<ActionKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const history = [
    ...view.suspensions.filter((s) => s.liftedAt).map((s) => ({ id: s.id, kind: "Suspended", at: s.suspendedAt, liftedAt: s.liftedAt, reason: s.reason })),
    ...view.bans.filter((b) => b.liftedAt).map((b) => ({ id: b.id, kind: "Banned", at: b.bannedAt, liftedAt: b.liftedAt, reason: b.reason })),
  ];
  const deleted = view.status === "DELETED" || view.status === "DELETED_PENDING";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-rz-muted">Current status</span>
        <Badge tone={view.status === "ACTIVE" ? "success" : view.status === "DELETED" ? "neutral" : "maroon"}>{view.status.replace(/_/g, " ").toLowerCase()}</Badge>
      </div>

      {view.activeBan && (
        <div className="rounded-md border border-rz-danger/30 bg-rz-danger/5 p-3 text-sm">
          <p className="font-semibold text-rz-danger">Banned since {formatDateTime(view.activeBan.bannedAt)}</p>
          {view.activeBan.reason && <p className="mt-1 text-rz-text">{view.activeBan.reason}</p>}
        </div>
      )}
      {view.activeSuspension && (
        <div className="rounded-md border border-rz-danger/30 bg-rz-danger/5 p-3 text-sm">
          <p className="font-semibold text-rz-danger">Suspended since {formatDateTime(view.activeSuspension.suspendedAt)}</p>
          {view.activeSuspension.reason && <p className="mt-1 text-rz-text">{view.activeSuspension.reason}</p>}
        </div>
      )}
      {!view.activeBan && !view.activeSuspension && <p className="text-sm text-rz-muted">No active suspension or ban.</p>}

      <div className="flex flex-wrap gap-2">
        {can("users.suspend") && !view.activeSuspension && !view.activeBan && !deleted && (
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("suspend")}>
            Suspend…
          </Button>
        )}
        {can("users.suspend") && view.activeSuspension && !view.activeBan && (
          <Button type="button" size="sm" onClick={() => setDialog("lift-suspension")}>
            Lift suspension…
          </Button>
        )}
        {can("users.ban") && !view.activeBan && !deleted && (
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("ban")}>
            Ban…
          </Button>
        )}
        {can("users.ban") && view.activeBan && (
          <Button type="button" size="sm" onClick={() => setDialog("unban")}>
            Lift ban…
          </Button>
        )}
      </div>
      {!can("users.suspend") && <p className="text-[13px] text-rz-muted">Suspending or lifting a suspension requires the users.suspend permission.</p>}
      {!can("users.ban") && <p className="text-[13px] text-rz-muted">Banning requires the users.ban permission (Super Admin by default).</p>}
      {note && <SuccessNote>{note}</SuccessNote>}

      {history.length > 0 && (
        <ul className="space-y-1 text-[12.5px] text-rz-muted">
          {history.map((h) => (
            <li key={h.id}>
              {h.kind} {formatDate(h.at)}, lifted {formatDate(h.liftedAt)}
              {h.reason ? ` — ${h.reason}` : ""}
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <ReasonDialog
          kind={dialog}
          userId={userId}
          onClose={() => setDialog(null)}
          onDone={() => {
            setNote(COPY[dialog].done);
            setDialog(null);
            onDone();
          }}
        />
      )}
    </div>
  );
}

function ReasonDialog({ kind, userId, onClose, onDone }: { kind: ActionKind; userId: string; onClose: () => void; onDone: () => void }) {
  const copy = COPY[kind];
  const [reason, setReason] = useState("");
  const run = useAction((r: string) => adminApi.post<unknown>(`/users/${userId}/${kind}`, kind === "lift-suspension" ? {} : { reason: r }));
  const needsReason = kind !== "lift-suspension";
  const tooShort = needsReason && reason.trim().length < 5;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) return;
    if ((await run.run(reason.trim())) !== undefined) onDone();
  }

  return (
    <Modal title={copy.title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-rz-muted">{copy.help}</p>
        {needsReason && (
          <div>
            <FieldLabel htmlFor="mod-reason">Reason (required, at least 5 characters)</FieldLabel>
            <Textarea id="mod-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required aria-invalid={!!fieldIssue(run.error, "reason")} />
            {fieldIssue(run.error, "reason") && <p className="mt-1 text-[12.5px] text-rz-danger">{fieldIssue(run.error, "reason")}</p>}
            <p className="mt-1 text-[12px] text-rz-muted">The reason is stored in the audit log.</p>
          </div>
        )}
        <ActionError error={run.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={run.pending || tooShort}>
            {run.pending ? "Working…" : copy.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
