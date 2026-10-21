"use client";

import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FormAlert } from "@/components/auth/FormAlert";
import { Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import type { MemberIntroduction } from "@/lib/api/matchmaking-types";
import { formatDate } from "@/lib/format";

type Answer = "ACCEPT" | "DECLINE" | "WITHDRAW";

function IntroductionCard({ intro, onChange }: { intro: MemberIntroduction; onChange: (next: MemberIntroduction | null) => void }) {
  const respond = useAction((response: Answer) =>
    api.post<{ introduction: MemberIntroduction | null }>(`/matchmaking/introductions/${intro.id}/response`, { response })
  );
  const p = intro.profile;
  const facts = [p.age ? `${p.age} yrs` : null, p.religion, p.motherTongue, p.profession, p.city ?? null].filter(Boolean).join(" · ");
  async function answer(response: Answer) {
    if (response === "DECLINE" && !window.confirm("Decline this introduction? It will close for both of you.")) return;
    if (response === "WITHDRAW" && !window.confirm("Withdraw your acceptance? The introduction will close for both of you.")) return;
    const res = await respond.run(response);
    if (res) onChange(res.introduction);
  }
  const mutual = intro.status === "MUTUALLY_ACCEPTED";
  return (
    <li className="rounded-lg border border-rz-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-serif text-lg font-semibold text-rz-navy">{p.displayName}</p>
          <p className="text-sm text-rz-muted">{facts}</p>
          <p className="mt-1 text-xs text-rz-muted">Introduced {formatDate(intro.createdAt)}</p>
        </div>
        {mutual ? <Badge tone="success">You both accepted</Badge> : intro.myResponse === "ACCEPTED" ? <Badge tone="gold">You accepted</Badge> : null}
      </div>
      {intro.messageFromTeam && <p className="mt-3 whitespace-pre-wrap rounded-md bg-rz-cream p-3 text-sm text-rz-text">{intro.messageFromTeam}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <ButtonLink href={`/dashboard/members/${p.id}`} size="sm" variant="outline">
          View profile
        </ButtonLink>
        {intro.myResponse === "PENDING" && (
          <>
            <Button size="sm" disabled={respond.pending} onClick={() => void answer("ACCEPT")}>
              Accept introduction
            </Button>
            <Button size="sm" variant="ghost" disabled={respond.pending} onClick={() => void answer("DECLINE")}>
              Decline
            </Button>
          </>
        )}
        {intro.myResponse === "ACCEPTED" && (
          <Button size="sm" variant="ghost" disabled={respond.pending} onClick={() => void answer("WITHDRAW")}>
            Withdraw acceptance
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-rz-muted">
        {mutual
          ? "To connect, send an interest from their profile. You can chat once an interest is accepted."
          : intro.myResponse === "ACCEPTED"
            ? "We'll let you know if they accept too. Accepting does not share your contact details."
            : "Accepting only says you are open to this introduction. It does not share your contact details or start a chat."}
      </p>
      {respond.error && <FormAlert tone="error">{respond.error.message}</FormAlert>}
    </li>
  );
}

/** Introductions proposed by the RishteyZindagi matchmaking team. No purchase is needed to receive or answer one. */
export function MyIntroductions() {
  const list = useAsync((signal) => api.get<{ introductions: MemberIntroduction[] }>("/matchmaking/introductions", { signal }), []);
  if (list.loading && !list.data) return <Skeleton className="h-24 w-full" />;
  if (list.error && !list.data) return null; // never block the rest of the page
  const items = list.data?.introductions ?? [];
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 font-serif text-xl font-semibold text-rz-navy">Introductions from our team</h2>
      <p className="mb-3 text-sm text-rz-muted">Our matchmaking team thinks you may get on. Each of you decides separately.</p>
      <ul className="space-y-3">
        {items.map((i) => (
          <IntroductionCard
            key={i.id}
            intro={i}
            onChange={(next) =>
              list.setData((d) => d && { introductions: next ? d.introductions.map((x) => (x.id === next.id ? next : x)) : d.introductions.filter((x) => x.id !== i.id) })
            }
          />
        ))}
      </ul>
    </section>
  );
}
