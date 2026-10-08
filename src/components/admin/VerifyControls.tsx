"use client";

import { Button } from "@/components/ui/Button";
import { FieldLabel, Textarea } from "@/components/ui/Input";
import { adminApi } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ActionError, fieldIssue, SuccessNote } from "./AdminUi";

export type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

const SET_LABEL: Record<"VERIFIED" | "REJECTED" | "UNVERIFIED", string> = {
  VERIFIED: "verified",
  REJECTED: "rejected",
  UNVERIFIED: "reset to unverified",
};

/**
 * Approve / reject / reset a profile's verification:
 * `PATCH /admin/profiles/{profileId}/verify` with `{ status, notes? }`
 * (permission `profiles.verify`). The reason is stored in the audit log
 * only — the backend keeps no per-profile review note — so it is required
 * for a rejection so the trail explains it. Success is announced only
 * after the API answered.
 */
export function VerifyControls({
  profileId,
  current,
  onChanged,
  compact,
}: {
  profileId: string;
  current: string;
  onChanged: (next: "VERIFIED" | "REJECTED" | "UNVERIFIED") => void;
  compact?: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = useAction((status: "VERIFIED" | "REJECTED" | "UNVERIFIED", n: string) =>
    adminApi.patch(`/profiles/${profileId}/verify`, n.trim() ? { status, notes: n.trim() } : { status })
  );
  const [missingReason, setMissingReason] = useState(false);

  async function submit(status: "VERIFIED" | "REJECTED" | "UNVERIFIED") {
    setDone(null);
    if (status === "REJECTED" && !notes.trim()) {
      setMissingReason(true);
      return;
    }
    setMissingReason(false);
    const res = await act.run(status, notes);
    if (res === undefined) return;
    setDone(`Profile ${SET_LABEL[status]}.`);
    setNotes("");
    onChanged(status);
  }

  const notesId = `verify-notes-${profileId}`;
  const issue = fieldIssue(act.error, "notes");

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel htmlFor={notesId}>Reviewer note {` `}<span className="font-normal">(required to reject; kept in the audit log)</span></FieldLabel>
        <Textarea
          id={notesId}
          rows={compact ? 2 : 3}
          maxLength={1000}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setMissingReason(false);
          }}
          className={cn("min-h-0", compact && "text-sm")}
          aria-invalid={missingReason || !!issue}
        />
        {missingReason && <p className="mt-1 text-[12.5px] text-rz-danger" role="alert">Add a short reason before rejecting.</p>}
        {issue && <p className="mt-1 text-[12.5px] text-rz-danger">{issue}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="!border-rz-danger !text-rz-danger hover:!bg-rz-danger/5"
          disabled={act.pending || current === "REJECTED"}
          onClick={() => submit("REJECTED")}
        >
          Reject
        </Button>
        <Button type="button" size="sm" disabled={act.pending || current === "VERIFIED"} onClick={() => submit("VERIFIED")}>
          {act.pending ? "Saving…" : "Approve"}
        </Button>
        {current !== "UNVERIFIED" && current !== "PENDING" && (
          <Button type="button" size="sm" variant="ghost" disabled={act.pending} onClick={() => submit("UNVERIFIED")}>
            Reset to unverified
          </Button>
        )}
      </div>
      <ActionError error={act.error} />
      {done && <SuccessNote>{done}</SuccessNote>}
    </div>
  );
}
