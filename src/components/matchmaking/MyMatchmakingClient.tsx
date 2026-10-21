"use client";

import Link from "next/link";
import { useState } from "react";
import { HeartHandshake } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/States";
import { FormAlert } from "@/components/auth/FormAlert";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { CASE_STATUS_LABEL, type MemberSuggestion, type MyMatchmaking } from "@/lib/api/matchmaking-types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { MyIntroductions } from "./MyIntroductions";
import { MyInvitation } from "./MyInvitation";

function SuggestionCard({ s, onChange }: { s: MemberSuggestion; onChange: (s: MemberSuggestion) => void }) {
  const respond = useAction((response: "INTERESTED" | "NOT_INTERESTED") =>
    api.post<{ suggestion: MemberSuggestion }>(`/matchmaking/me/suggestions/${s.id}/response`, { response })
  );
  const p = s.profile;
  const facts = [p.age ? `${p.age} yrs` : null, p.religion, p.motherTongue, p.profession, p.city ?? null].filter(Boolean).join(" · ");
  async function answer(response: "INTERESTED" | "NOT_INTERESTED") {
    const res = await respond.run(response);
    if (res) onChange(res.suggestion);
  }
  return (
    <li className="rounded-lg border border-rz-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-serif text-lg font-semibold text-rz-navy">{p.displayName}</p>
          <p className="text-sm text-rz-muted">{facts}</p>
          {s.sentAt && <p className="mt-1 text-xs text-rz-muted">Shared {formatDate(s.sentAt)}</p>}
        </div>
        {s.response !== "PENDING" && <Badge tone={s.response === "INTERESTED" ? "success" : "neutral"}>{s.response === "INTERESTED" ? "Interested" : "Not interested"}</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ButtonLink href={`/dashboard/members/${p.id}`} size="sm" variant="outline">
          View profile
        </ButtonLink>
        <Button size="sm" disabled={respond.pending} onClick={() => void answer("INTERESTED")}>
          I&apos;m interested
        </Button>
        <Button size="sm" variant="ghost" disabled={respond.pending} onClick={() => void answer("NOT_INTERESTED")}>
          Not for me
        </Button>
      </div>
      {s.response === "INTERESTED" && (
        <p className="mt-2 text-xs text-rz-muted">To connect, send an interest from their profile. You can chat once it is accepted.</p>
      )}
      {respond.error && <FormAlert tone="error">{respond.error.message}</FormAlert>}
    </li>
  );
}

/** The member's own Personal Matchmaking: case status, included access, history, suggestions, notes and opt-out. */
export function MyMatchmakingClient() {
  const mine = useAsync((signal) => api.get<MyMatchmaking>("/matchmaking/me", { signal }), []);
  const [notes, setNotes] = useState<string | null>(null);
  const saveNotes = useAction((customerNotes: string) => api.patch("/matchmaking/me", { customerNotes: customerNotes.trim() || null }));
  const optOut = useAction((value: boolean) => api.put<{ optOut: boolean }>("/matchmaking/me/opt-out", { optOut: value }));

  if (mine.loading && !mine.data) return <Skeleton className="h-64 w-full" />;
  if (mine.error && !mine.data) return <ApiErrorView error={mine.error} onRetry={mine.reload} />;
  const data = mine.data!;
  const c = data.case;
  const open = c && ["PENDING_PAYMENT", "ACTIVE", "IN_PROGRESS"].includes(c.status);

  return (
    <div className="space-y-6">
      {data.invitation && <MyInvitation invitation={data.invitation} onDone={() => mine.reload()} />}

      <MyIntroductions />

      {(!c || !open) && !data.invitation ? (
        <section className="rounded-lg border border-rz-border bg-white p-5">
          <p className="flex items-center gap-2 font-semibold text-rz-navy">
            <HeartHandshake className="h-5 w-5 text-rz-maroon" aria-hidden /> {c ? "Start a new Personal Matchmaking" : "Personal Matchmaking"}
          </p>
          <p className="mt-1 text-sm text-rz-muted">
            {data.offer.available && data.offer.priceInSmallestUnit !== null
              ? `A matchmaking specialist shares hand-picked suggestions with you · ${formatMoney(data.offer.priceInSmallestUnit, data.offer.currency)}`
              : "The service is not open for new members right now."}
          </p>
          {data.offer.available && (
            <ButtonLink href="/personal-matchmaking" size="sm" className="mt-3">
              Learn more
            </ButtonLink>
          )}
        </section>
      ) : null}

      {c && (
        <section className="rounded-lg border border-rz-border bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-semibold text-rz-navy">Your case</h2>
            <Badge tone={c.status === "ACTIVE" || c.status === "IN_PROGRESS" ? "success" : c.status === "PENDING_PAYMENT" ? "gold" : "neutral"}>{CASE_STATUS_LABEL[c.status]}</Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-rz-muted">Price</dt>
              <dd>{c.complimentary ? "Complimentary (no payment)" : formatMoney(c.priceInSmallestUnit, c.currency)}</dd>
            </div>
            <div>
              <dt className="text-rz-muted">Included member access</dt>
              <dd>
                {c.accessRevoked
                  ? "Ended (refunded)"
                  : c.includedAccessUntil
                    ? `Until ${formatDate(c.includedAccessUntil)}`
                    : `${c.includedMembershipDays} days, from payment`}
              </dd>
            </div>
          </dl>
          {c.status === "PENDING_PAYMENT" && (
            <p className="mt-3 text-sm text-rz-muted">
              Waiting for your payment to be confirmed. <Link href="/personal-matchmaking" className="font-semibold text-rz-maroon underline">Return to checkout</Link>
            </p>
          )}
          {open && (
            <div className="mt-4">
              <label htmlFor="mm-my-notes" className="text-sm font-semibold text-rz-navy">
                Notes for your matchmaking team
              </label>
              <textarea
                id="mm-my-notes"
                rows={3}
                maxLength={2000}
                className="rz-focus mt-1.5 w-full rounded-md border border-rz-border p-3 text-sm"
                value={notes ?? c.customerNotes ?? ""}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button size="sm" className="mt-2" disabled={saveNotes.pending || notes === null} onClick={() => void saveNotes.run(notes ?? "").then((r) => r && mine.reload())}>
                Save notes
              </Button>
              {saveNotes.error && <FormAlert tone="error">{saveNotes.error.message}</FormAlert>}
            </div>
          )}
        </section>
      )}

      {c && (
        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold text-rz-navy">Suggestions for you</h2>
          {data.suggestions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-rz-border bg-white p-5 text-sm text-rz-muted">
              {open ? "Your matchmaking team will share profiles here." : "No suggestions to show."}
            </p>
          ) : (
            <ul className="space-y-3">
              {data.suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} onChange={(next) => mine.setData((d) => d && { ...d, suggestions: d.suggestions.map((x) => (x.id === next.id ? next : x)) })} />
              ))}
            </ul>
          )}
        </section>
      )}

      {c && data.history.length > 0 && (
        <section className="rounded-lg border border-rz-border bg-white p-5">
          <h2 className="font-serif text-lg font-semibold text-rz-navy">Updates</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {[...data.history].reverse().map((h) => (
              <li key={h.id}>
                <span className="text-rz-muted">{formatDateTime(h.createdAt)}</span> — {h.note ?? (h.toStatus ? CASE_STATUS_LABEL[h.toStatus as keyof typeof CASE_STATUS_LABEL] : "")}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-lg border border-rz-border bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-rz-navy">Being suggested to others</h2>
        <label className="mt-2 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={data.optOut}
            disabled={optOut.pending}
            onChange={(e) => void optOut.run(e.target.checked).then((r) => r && mine.setData((d) => d && { ...d, optOut: r.optOut }))}
          />
          <span>Don&apos;t include me in Personal Matchmaking: my profile is not suggested to other members and our team will not propose introductions for me. (Search and recommendations are not affected.)</span>
        </label>
        {optOut.error && <FormAlert tone="error">{optOut.error.message}</FormAlert>}
      </section>
    </div>
  );
}
