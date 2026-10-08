"use client";

import { ProfileCard } from "@/components/profile/ProfileCard";
import { fromSearchItem } from "@/components/profile/cardModel";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { ProfileCardSkeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { Page, SearchItem } from "@/lib/api/types";

/**
 * A small sample straight from GET /search/profiles (the most recently
 * updated profiles). Signed-out visitors get the API's gated summaries,
 * signed-in members the full cards — the card renders whichever it receives.
 * With no members yet it says so instead of showing placeholders.
 */
export function FeaturedProfiles() {
  const sample = useAsync((signal) => api.get<Page<SearchItem>>("/search/profiles", { query: { pageSize: 4 }, signal }), []);
  const items = sample.data?.items ?? [];

  return (
    <Section className="bg-white">
      <Container>
        <SectionHeading
          eyebrow="Featured Profiles"
          title="Meet some of our members"
          description="A small sample of recently updated profiles. Create a free profile to see photos and recommendations tailored to your own preferences."
        />

        {sample.data === null && sample.loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading profiles">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProfileCardSkeleton key={i} />
            ))}
          </div>
        ) : sample.data === null && sample.error ? (
          <div className="mx-auto max-w-md rounded-lg border border-rz-border bg-rz-ivory px-6 py-8 text-center" role="alert">
            <p className="text-sm text-rz-muted">Profiles can&apos;t be shown right now. {sample.error.friendlyMessage}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={sample.reload}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-md rounded-lg border border-dashed border-rz-border bg-rz-ivory px-6 py-8 text-center">
            <p className="font-serif text-lg font-semibold text-rz-navy">No profiles to show yet</p>
            <p className="mt-1.5 text-sm text-rz-muted">Be among the first members. Create your free profile and start your search.</p>
            <ButtonLink href="/signup" size="sm" className="mt-4">
              Create free profile
            </ButtonLink>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((item) => {
              const card = fromSearchItem(item);
              return <ProfileCard key={card.profileId} profile={card} loginNext="/" />;
            })}
          </div>
        )}

        <div className="mt-10 text-center">
          <ButtonLink href="/search" variant="outline">
            Explore all profiles
          </ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
