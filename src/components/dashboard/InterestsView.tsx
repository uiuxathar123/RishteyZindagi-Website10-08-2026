"use client";

import { Heart, Loader2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MutualMatches } from "./member/MatchesView";
import { PersonRow } from "./member/PersonRow";
import { ActionError } from "@/components/profile/ActionError";
import { Pager } from "@/components/profile/Pager";
import { invalidateRelations } from "@/components/profile/relations";
import { useProfileSummaries } from "@/components/profile/useProfileSummaries";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";
import type { InterestStatus, InterestView, LikeView } from "@/lib/api/types";

const PAGE_SIZE = 10;

function StatusBadge({ status }: { status: InterestStatus }) {
  if (status === "ACCEPTED") return <Badge tone="success">Accepted</Badge>;
  if (status === "DECLINED") return <Badge tone="neutral">Declined</Badge>;
  if (status === "WITHDRAWN") return <Badge tone="neutral">Withdrawn</Badge>;
  return <Badge tone="gold">Pending</Badge>;
}

function sortInterests(list: InterestView[]): InterestView[] {
  return [...list].sort((a, b) => {
    const pa = a.status === "PENDING" ? 0 : 1;
    const pb = b.status === "PENDING" ? 0 : 1;
    return pa - pb || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** One interest with its own real accept / decline / withdraw calls. */
function InterestItem({
  interest,
  direction,
  summary,
  onChanged,
}: {
  interest: InterestView;
  direction: "received" | "sent";
  summary: ReturnType<typeof useProfileSummaries>[string] | undefined;
  onChanged: (updated: InterestView) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const respond = useAction(async (status: "ACCEPTED" | "DECLINED" | "WITHDRAWN") => {
    const res = await api.patch<{ interest: InterestView }>(`/interactions/interests/${interest.id}`, { status });
    return res.interest;
  });

  async function act(status: "ACCEPTED" | "DECLINED" | "WITHDRAWN") {
    setNotice(null);
    const updated = await respond.run(status);
    if (!updated) return;
    onChanged(updated);
    invalidateRelations();
    setNotice(
      status === "ACCEPTED"
        ? `You're now matched with ${interest.counterpart.name ?? "this member"}.`
        : status === "DECLINED"
          ? "Interest declined."
          : "Interest withdrawn."
    );
  }

  const when = formatDate(interest.createdAt);
  const pending = interest.status === "PENDING";
  const busy = respond.pending;

  return (
    <>
      <PersonRow counterpart={interest.counterpart} summary={summary} meta={direction === "received" ? `Received ${when}` : `Sent ${when}`}>
        {direction === "received" && pending ? (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("DECLINED")}>
              Decline
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act("ACCEPTED")} icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
              Accept
            </Button>
          </>
        ) : direction === "sent" && pending ? (
          <>
            <StatusBadge status={interest.status} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("WITHDRAWN")}>
              {busy ? "Withdrawing…" : "Withdraw"}
            </Button>
          </>
        ) : (
          <>
            <StatusBadge status={interest.status} />
            {interest.status === "ACCEPTED" && (
              <ButtonLink href={`/dashboard/messages?with=${interest.counterpart.userId}`} size="sm" variant="outline" icon={<MessageCircle className="h-3.5 w-3.5" />}>
                Message
              </ButtonLink>
            )}
          </>
        )}
      </PersonRow>
      {(notice || respond.error) && (
        <li className="list-none border-b border-rz-border px-4 pb-3 last:border-b-0 md:px-5" aria-live="polite">
          {notice && !respond.error && (
            <p role="status" className="text-xs text-rz-success">
              {notice}
              {interest.status === "ACCEPTED" && " "}
              {interest.status === "ACCEPTED" && (
                <Link href={`/dashboard/messages?with=${interest.counterpart.userId}`} className="rz-focus font-semibold underline underline-offset-2">
                  Start chatting
                </Link>
              )}
            </p>
          )}
          <ActionError error={respond.error} className="text-xs text-rz-danger" />
        </li>
      )}
    </>
  );
}

function InterestList({ direction, onPendingCount }: { direction: "received" | "sent"; onPendingCount?: (n: number) => void }) {
  const query = useAsync((signal) => api.get<{ interests: InterestView[] }>("/interactions/interests", { query: { direction }, signal }), [direction]);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => sortInterests(query.data?.interests ?? []), [query.data]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const summaries = useProfileSummaries(visible.map((i) => i.counterpart.profileId));
  const pendingNow = sorted.filter((i) => i.status === "PENDING").length;
  useEffect(() => {
    if (query.data) onPendingCount?.(pendingNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNow, query.data]);

  if (query.data === null && query.loading) return <div className="h-40 animate-pulse rounded-lg bg-rz-border/40" role="status" aria-label="Loading interests" />;
  if (query.data === null && query.error) return <ApiErrorView error={query.error} onRetry={query.reload} />;
  if (sorted.length === 0) {
    return direction === "received" ? (
      <EmptyState icon={<Heart className="h-6 w-6" strokeWidth={1.6} />} title="No interests received yet" description="When someone sends you an interest, it will show up here." />
    ) : (
      <EmptyState
        icon={<Heart className="h-6 w-6" strokeWidth={1.6} />}
        title="No interests sent yet"
        description="Interests you send to other members will show up here with their current status."
        action={<ButtonLink href="/dashboard/matches" size="sm" variant="outline">Browse your matches</ButtonLink>}
      />
    );
  }

  const replace = (updated: InterestView) =>
    query.setData((prev) => (prev ? { interests: prev.interests.map((i) => (i.id === updated.id ? { ...updated, counterpart: updated.counterpart ?? i.counterpart } : i)) } : prev));

  return (
    <>
      <ul className="overflow-hidden rounded-lg border border-rz-border bg-white">
        {visible.map((interest) => (
          <InterestItem
            key={interest.id}
            interest={interest}
            direction={direction}
            summary={interest.counterpart.profileId ? summaries[interest.counterpart.profileId] : undefined}
            onChanged={replace}
          />
        ))}
      </ul>
      <Pager page={current} totalPages={totalPages} onPage={setPage} label={`${direction} interests pages`} />
    </>
  );
}

function LikesList() {
  const [direction, setDirection] = useState<"received" | "sent">("received");
  const query = useAsync((signal) => api.get<{ likes: LikeView[] }>("/interactions/likes", { query: { direction }, signal }), [direction]);
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => [...(query.data?.likes ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [query.data]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const summaries = useProfileSummaries(visible.map((l) => l.counterpart.profileId));

  return (
    <div>
      <div className="mb-4 inline-flex rounded-full border border-rz-border bg-white p-1" role="group" aria-label="Likes direction">
        {(["received", "sent"] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={direction === d}
            onClick={() => {
              setDirection(d);
              setPage(1);
            }}
            className={`rz-focus rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${direction === d ? "bg-rz-maroon text-white" : "text-rz-muted hover:text-rz-text"}`}
          >
            {d === "received" ? "Liked you" : "You liked"}
          </button>
        ))}
      </div>
      {query.data === null && query.loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-rz-border/40" role="status" aria-label="Loading likes" />
      ) : query.data === null && query.error ? (
        <ApiErrorView error={query.error} onRetry={query.reload} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-6 w-6" strokeWidth={1.6} />}
          title={direction === "received" ? "No likes yet" : "You haven't liked anyone yet"}
          description={direction === "received" ? "When a member likes your profile, it will show up here." : "Tap the heart on a profile to like it."}
        />
      ) : (
        <>
          <ul className="overflow-hidden rounded-lg border border-rz-border bg-white">
            {visible.map((l) => (
              <PersonRow key={l.id} counterpart={l.counterpart} summary={l.counterpart.profileId ? summaries[l.counterpart.profileId] : undefined} meta={formatDate(l.createdAt)} />
            ))}
          </ul>
          <Pager page={current} totalPages={totalPages} onPage={setPage} label="Likes pages" />
        </>
      )}
    </div>
  );
}

export function InterestsView() {
  const [pending, setPending] = useState(0);
  return (
    <Tabs
      items={[
        { id: "received", label: "Received", badge: pending },
        { id: "sent", label: "Sent" },
        { id: "likes", label: "Likes" },
        { id: "matches", label: "Matches" },
      ]}
      defaultTab="received"
    >
      {(active) =>
        active === "received" ? (
          <InterestList direction="received" onPendingCount={setPending} />
        ) : active === "sent" ? (
          <InterestList direction="sent" />
        ) : active === "likes" ? (
          <LikesList />
        ) : (
          <MutualMatches />
        )
      }
    </Tabs>
  );
}
