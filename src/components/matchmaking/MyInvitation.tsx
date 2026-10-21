"use client";

import { useState } from "react";
import { Gift, HeartHandshake } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FormAlert } from "@/components/auth/FormAlert";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import type { MemberInvitation } from "@/lib/api/matchmaking-types";

/**
 * A pending invitation from the matchmaking team. A complimentary offer starts only when the member accepts it with
 * the same consent a purchase needs; a normal offer is accepted by starting the usual checkout.
 */
export function MyInvitation({ invitation, onDone }: { invitation: MemberInvitation; onDone: () => void }) {
  const [consented, setConsented] = useState(false);
  const [notes, setNotes] = useState("");
  const respond = useAction((body: Record<string, unknown>) => api.post<{ status: string; caseId: string | null }>(`/matchmaking/invitations/${invitation.id}/response`, body));
  const free = invitation.kind === "COMPLIMENTARY";

  async function accept() {
    const res = await respond.run({
      response: "ACCEPT",
      consent: true,
      consentVersion: invitation.consentVersion,
      ...(notes.trim() ? { customerNotes: notes.trim() } : {}),
    });
    if (res) onDone();
  }
  async function decline() {
    const res = await respond.run({ response: "DECLINE" });
    if (res) onDone();
  }

  return (
    <section className="rounded-lg border border-rz-gold/40 bg-rz-champagne/40 p-5">
      <p className="flex items-center gap-2 font-semibold text-rz-navy">
        {free ? <Gift className="h-5 w-5 text-rz-maroon" aria-hidden /> : <HeartHandshake className="h-5 w-5 text-rz-maroon" aria-hidden />}
        {free ? "A complimentary Personal Matchmaking offer for you" : "You're invited to Personal Matchmaking"}
      </p>
      <p className="mt-1 text-sm text-rz-text">
        {free
          ? `Our matchmaking team would like to offer you Personal Matchmaking free of charge${
              invitation.includedMembershipDays ? `, including ${invitation.includedMembershipDays} days of member access (interests and chat)` : ""
            }. No payment is needed.`
          : "Our matchmaking team thinks Personal Matchmaking could help you. A specialist reviews your profile and shares hand-picked suggestions."}
      </p>
      {invitation.messageFromTeam && <p className="mt-3 whitespace-pre-wrap rounded-md bg-white p-3 text-sm text-rz-text">{invitation.messageFromTeam}</p>}

      {free ? (
        <>
          <label htmlFor="mm-invite-notes" className="mt-4 block text-sm font-semibold text-rz-navy">
            Anything the matchmaking team should know? (optional)
          </label>
          <textarea
            id="mm-invite-notes"
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rz-focus mt-1.5 w-full rounded-md border border-rz-border bg-white p-3 text-sm"
          />
          <label className="mt-3 flex items-start gap-3 text-sm text-rz-text">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
            <span>{invitation.consentText}</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={!consented || respond.pending} onClick={() => void accept()}>
              Accept free Personal Matchmaking
            </Button>
            <Button size="sm" variant="ghost" disabled={respond.pending} onClick={() => void decline()}>
              No thanks
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/personal-matchmaking" size="sm">
            See the offer
          </ButtonLink>
          <Button size="sm" variant="ghost" disabled={respond.pending} onClick={() => void decline()}>
            No thanks
          </Button>
        </div>
      )}
      {respond.error && <FormAlert tone="error">{respond.error.message}</FormAlert>}
    </section>
  );
}
