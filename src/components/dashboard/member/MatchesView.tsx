"use client";

import { MessageCircle, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PersonRow } from "./PersonRow";
import { Pager } from "@/components/profile/Pager";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { fromRecommendation } from "@/components/profile/cardModel";
import { useProfileSummaries } from "@/components/profile/useProfileSummaries";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ProfileCardSkeleton } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";
import type { MatchView, RecommendationsPage } from "@/lib/api/types";

const PAGE_SIZE = 12;

function Recommended() {
  const [page, setPage] = useState(1);
  const recs = useAsync(
    (signal) => api.get<RecommendationsPage>("/profiles/me/recommendations", { query: { page, pageSize: PAGE_SIZE }, signal }),
    [page]
  );

  if (recs.data === null && recs.loading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading matches">
        {Array.from({ length: 3 }).map((_, i) => (
          <ProfileCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (recs.data === null && recs.error) {
    // 404 here is the backend's "no profile exists for this account yet".
    if (recs.error.kind === "not_found") {
      return (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" strokeWidth={1.6} />}
          title="Create your profile first"
          description="Recommendations are based on your own profile and partner preferences."
          action={<ButtonLink href="/dashboard/profile" size="sm">Create my profile</ButtonLink>}
        />
      );
    }
    return <ApiErrorView error={recs.error} onRetry={recs.reload} />;
  }
  const data = recs.data;
  if (!data) return null;

  if (data.status === "preferences_not_configured") {
    return (
      <EmptyState
        icon={<Sparkles className="h-6 w-6" strokeWidth={1.6} />}
        title="Set your partner preferences"
        description="We recommend matches from the preferences you set. Tell us who you're looking for and we'll start matching."
        action={<ButtonLink href="/dashboard/profile?tab=preferences" size="sm">Set partner preferences</ButtonLink>}
      />
    );
  }

  const hasSecondary = data.secondaryItems.length > 0;
  return (
    <div className={recs.loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={recs.loading}>
      {data.items.length === 0 && !hasSecondary ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" strokeWidth={1.6} />}
          title="No matches right now"
          description="Nobody currently fits your preferences. Widening your partner preferences, or checking back as new members join, can help."
          action={<ButtonLink href="/dashboard/profile?tab=preferences" size="sm" variant="outline">Review my preferences</ButtonLink>}
        />
      ) : (
        <>
          {data.items.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((item) => (
                <ProfileCard key={item.profile.id} profile={fromRecommendation(item)} />
              ))}
            </div>
          )}
          {data.items.length === 0 && (
            <p className="mb-5 text-sm text-rz-muted">No profiles match all of your preferences yet. Here are some that match some of them.</p>
          )}
          <Pager page={data.page} totalPages={data.totalPages} disabled={recs.loading} onPage={setPage} label="Matches pages" />

          {hasSecondary && (
            <section className="mt-10" aria-labelledby="also-like">
              <h3 id="also-like" className="mb-1 font-serif text-xl font-bold text-rz-navy">
                You may also like
              </h3>
              <p className="mb-5 text-sm text-rz-muted">
                These match some of your preferences but not all.
                {data.secondaryTotal > data.secondaryItems.length ? ` Showing ${data.secondaryItems.length} of ${data.secondaryTotal}.` : ""}
              </p>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {data.secondaryItems.map((item) => (
                  <ProfileCard key={item.profile.id} profile={fromRecommendation(item)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function MutualMatches() {
  const matches = useAsync((signal) => api.get<{ matches: MatchView[] }>("/interactions/matches", { signal }), []);
  const list = matches.data?.matches ?? [];
  const summaries = useProfileSummaries(list.map((m) => m.counterpart.profileId));

  if (matches.data === null && matches.loading) {
    return <div className="h-40 animate-pulse rounded-lg bg-rz-border/40" role="status" aria-label="Loading matches" />;
  }
  if (matches.data === null && matches.error) return <ApiErrorView error={matches.error} onRetry={matches.reload} />;
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" strokeWidth={1.6} />}
        title="No mutual matches yet"
        description="When you and another member both show interest, you're matched and can chat."
        action={<ButtonLink href="/dashboard/interests" size="sm" variant="outline">See my interests</ButtonLink>}
      />
    );
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-rz-border bg-white">
      {list.map((m) => (
        <PersonRow key={m.id} counterpart={m.counterpart} summary={m.counterpart.profileId ? summaries[m.counterpart.profileId] : undefined} meta={`Matched on ${formatDate(m.matchedAt)}`}>
          <ButtonLink href={`/dashboard/messages?with=${m.counterpart.userId}`} size="sm" icon={<MessageCircle className="h-3.5 w-3.5" />}>
            Message
          </ButtonLink>
          {m.counterpart.profileId && (
            <Link href={`/dashboard/members/${m.counterpart.profileId}`} className="rz-focus rounded-full px-3 py-1.5 text-sm font-semibold text-rz-maroon hover:bg-rz-maroon/5">
              View profile
            </Link>
          )}
        </PersonRow>
      ))}
    </ul>
  );
}

export function MatchesView() {
  return (
    <Tabs
      items={[
        { id: "recommended", label: "Recommended" },
        { id: "mutual", label: "Mutual matches" },
      ]}
      defaultTab="recommended"
    >
      {(active) => (active === "recommended" ? <Recommended /> : <MutualMatches />)}
    </Tabs>
  );
}
