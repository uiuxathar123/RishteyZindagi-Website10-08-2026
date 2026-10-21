"use client";

import { GraduationCap, Loader2, MapPin, Star, User } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionError } from "@/components/profile/ActionError";
import { Pager } from "@/components/profile/Pager";
import { memberHref } from "@/components/profile/ProfileCard";
import { cardAvatar, locationLine } from "@/components/profile/cardModel";
import { invalidateRelations } from "@/components/profile/relations";
import { useProfileSummaries, type Summary } from "@/components/profile/useProfileSummaries";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { CompanyVerifiedBadge, VerifiedBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { EmptyState, ProfileCardSkeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";
import type { ShortlistView } from "@/lib/api/types";

const PAGE_SIZE = 12;

function ShortlistCard({ entry, summary, onRemoved }: { entry: ShortlistView; summary?: Summary; onRemoved: (targetUserId: string) => void }) {
  const remove = useAction(async () => {
    await api.delete(`/interactions/shortlist/${entry.targetUserId}`);
    return true as const;
  });
  const card = summary?.state === "ok" ? summary.card : undefined;
  const name = card?.displayName ?? entry.counterpart.name ?? "Member";
  const profileId = entry.counterpart.profileId;

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-rz-peach">
        {profileId ? (
          <Link href={memberHref(profileId)} aria-label={`View ${name}'s profile`} className="rz-focus absolute inset-0 block">
            <PhotoImage src={card?.photoSrc} alt={card?.photoSrc ? `Photo of ${name}` : `${name}`} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw" fallbackSrc={card ? cardAvatar(card) : undefined} />
          </Link>
        ) : (
          <PhotoImage src={card?.photoSrc} alt={name} fallbackSrc={card ? cardAvatar(card) : undefined} />
        )}
        {(card?.verified || card?.companyVerified) && (
          <div className="absolute left-3 top-3 flex flex-col items-start gap-1">
            {card?.verified && <VerifiedBadge />}
            {card?.companyVerified && <CompanyVerifiedBadge />}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-1 font-serif text-lg font-semibold text-rz-navy">
          {name}
          {card ? `, ${card.age}` : ""}
        </h3>
        {card && locationLine(card) && (
          <p className="mb-2 flex items-center gap-1 text-xs text-rz-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {locationLine(card)}
          </p>
        )}
        {card?.education && (
          <p className="mb-1 flex items-center gap-1.5 text-[13px] text-rz-text">
            <GraduationCap className="h-3.5 w-3.5 shrink-0 text-rz-muted" />
            {card.education}
          </p>
        )}
        {summary?.state === "unavailable" && <p className="mb-1 text-xs text-rz-muted">This profile isn&apos;t available to view right now.</p>}
        <p className="mb-3 text-xs text-rz-muted">Shortlisted {formatDate(entry.createdAt)}</p>
        <div className="mt-auto space-y-2 border-t border-rz-border pt-3">
          {profileId && (
            <ButtonLink href={memberHref(profileId)} size="sm" variant="outline" fullWidth icon={<User className="h-3.5 w-3.5" />}>
              View profile
            </ButtonLink>
          )}
          <Button
            variant="outline"
            size="sm"
            fullWidth
            disabled={remove.pending}
            className="border-rz-danger/40 text-rz-danger hover:bg-rz-danger/5"
            onClick={async () => {
              if (await remove.run()) onRemoved(entry.targetUserId);
            }}
            icon={remove.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
          >
            {remove.pending ? "Removing…" : "Remove from shortlist"}
          </Button>
          <ActionError error={remove.error} />
        </div>
      </div>
    </article>
  );
}

export function ShortlistGrid() {
  const list = useAsync((signal) => api.get<{ shortlist: ShortlistView[] }>("/interactions/shortlist", { signal }), []);
  const [page, setPage] = useState(1);
  const entries = useMemo(() => [...(list.data?.shortlist ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [list.data]);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = entries.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const summaries = useProfileSummaries(visible.map((e) => e.counterpart.profileId));

  if (list.data === null && list.loading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading shortlist">
        {Array.from({ length: 3 }).map((_, i) => (
          <ProfileCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (list.data === null && list.error) return <ApiErrorView error={list.error} onRetry={list.reload} />;
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Star className="h-6 w-6" strokeWidth={1.6} />}
        title="Your shortlist is empty"
        description="Profiles you shortlist while browsing matches will appear here for quick access."
        action={<ButtonLink href="/dashboard/matches" size="sm" variant="outline">Browse matches</ButtonLink>}
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((e) => (
          <ShortlistCard
            key={e.id}
            entry={e}
            summary={e.counterpart.profileId ? summaries[e.counterpart.profileId] : undefined}
            onRemoved={(id) => {
              list.setData((prev) => (prev ? { shortlist: prev.shortlist.filter((s) => s.targetUserId !== id) } : prev));
              invalidateRelations();
            }}
          />
        ))}
      </div>
      <Pager page={current} totalPages={totalPages} onPage={setPage} label="Shortlist pages" />
    </>
  );
}
