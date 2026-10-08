"use client";

import { ArrowLeft, Flag, Heart, Loader2, MapPin, MessageCircle, ShieldOff, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BlockPanel, ReportPanel } from "./SafetyPanels";
import { ActionError } from "@/components/profile/ActionError";
import { InterestControl } from "@/components/profile/ProfileCard";
import { fromProfileView, locationLine, type CardProfile } from "@/components/profile/cardModel";
import { useProfileActions } from "@/components/profile/useProfileActions";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { VerifiedBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAction, useAsync } from "@/lib/api/hooks";
import { formatHeight, genderLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProfileViewResponse } from "@/lib/api/types";

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-rz-border/70 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-[13px] font-semibold text-rz-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-rz-text">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-rz-border bg-white p-5">
      <h3 className="mb-2 font-serif text-lg font-semibold text-rz-navy">{title}</h3>
      {children}
    </section>
  );
}

function Gallery({ card }: { card: CardProfile }) {
  const [index, setIndex] = useState(0);
  const current = card.photos[Math.min(index, Math.max(card.photos.length - 1, 0))];
  return (
    <div>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg border border-rz-border bg-rz-peach">
        <PhotoImage
          src={current?.src}
          alt={current ? `Photo ${index + 1} of ${card.displayName}` : `${card.displayName} has not added a photo yet`}
          sizes="(min-width: 1024px) 380px, 90vw"
          priority
        />
        {card.verified && (
          <div className="absolute left-3 top-3">
            <VerifiedBadge />
          </div>
        )}
      </div>
      {card.photos.length === 0 && <p className="mt-2 text-center text-xs text-rz-muted">No photos added yet.</p>}
      {card.photos.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Photos">
          {card.photos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === index}
                className={cn("rz-focus relative block h-16 w-14 overflow-hidden rounded-md border-2", i === index ? "border-rz-maroon" : "border-transparent opacity-80 hover:opacity-100")}
              >
                <PhotoImage src={p.src} alt="" sizes="56px" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Loaded({ card }: { card: CardProfile }) {
  const a = useProfileActions(card.userId);
  const [panel, setPanel] = useState<null | "block" | "report">(null);
  const [blocked, setBlocked] = useState(false);
  const unblock = useAction(async () => {
    await api.delete(`/interactions/blocks/${card.userId}`);
    return true as const;
  });
  const userId = card.userId;
  const place = locationLine(card);

  if (blocked) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="rounded-lg border border-rz-border bg-white p-6 text-center" role="status">
          <ShieldOff className="mx-auto mb-3 h-8 w-8 text-rz-muted" />
          <p className="font-serif text-lg font-semibold text-rz-navy">You blocked {card.displayName}</p>
          <p className="mt-1 text-sm text-rz-muted">They won&apos;t appear in your search, matches or chat, and you won&apos;t see each other&apos;s profiles.</p>
          <ActionError error={unblock.error} className="mt-3 text-sm text-rz-danger" />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={unblock.pending}
              onClick={async () => {
                if (await unblock.run()) setBlocked(false);
              }}
              icon={unblock.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
            >
              {unblock.pending ? "Unblocking…" : "Undo block"}
            </Button>
            <ButtonLink href="/dashboard/matches" size="sm">
              Back to matches
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link href="/dashboard/matches" className="rz-focus mb-4 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-rz-muted hover:text-rz-maroon">
        <ArrowLeft className="h-4 w-4" /> Back to matches
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Gallery card={card} />

        <div className="min-w-0 space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-serif text-2xl font-bold text-rz-navy md:text-3xl">
                {card.displayName}, {card.age}
              </h1>
              {card.gender && <span className="rounded-full bg-rz-border/60 px-2.5 py-0.5 text-xs font-semibold text-rz-muted">{genderLabel(card.gender)}</span>}
            </div>
            {place && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-rz-muted">
                <MapPin className="h-4 w-4 shrink-0" /> {place}
              </p>
            )}
          </div>

          {userId && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={a.liked}
                  disabled={a.busy === "like"}
                  onClick={() => void a.toggleLike()}
                  icon={a.busy === "like" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className={cn("h-3.5 w-3.5", a.liked && "fill-rz-maroon")} />}
                >
                  {a.liked ? "Liked" : "Like"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={a.shortlisted}
                  disabled={a.busy === "shortlist"}
                  onClick={() => void a.toggleShortlist()}
                  icon={a.busy === "shortlist" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className={cn("h-3.5 w-3.5", a.shortlisted && "fill-rz-gold text-rz-gold")} />}
                >
                  {a.shortlisted ? "Shortlisted" : "Shortlist"}
                </Button>
                <InterestControl a={a} userId={userId} />
                {a.interest === "matched" && (
                  <ButtonLink href={`/dashboard/messages?with=${userId}`} size="sm" variant="outline" icon={<MessageCircle className="h-3.5 w-3.5" />}>
                    Open chat
                  </ButtonLink>
                )}
              </div>
              {a.notice && (
                <p role="status" className="mt-2 text-sm text-rz-success">
                  {a.notice}
                </p>
              )}
              <ActionError error={a.error} className="mt-2 text-sm text-rz-danger" />
              {a.interest === "sent_pending" && <p className="mt-2 text-xs text-rz-muted">Your interest is waiting for a reply. You can withdraw it from the Interests page.</p>}

              <div className="mt-4 flex flex-wrap gap-4 border-t border-rz-border pt-3 text-[13px]">
                <button type="button" onClick={() => setPanel(panel === "report" ? null : "report")} aria-expanded={panel === "report"} className="rz-focus inline-flex items-center gap-1.5 rounded text-rz-muted hover:text-rz-maroon">
                  <Flag className="h-3.5 w-3.5" /> Report
                </button>
                <button type="button" onClick={() => setPanel(panel === "block" ? null : "block")} aria-expanded={panel === "block"} className="rz-focus inline-flex items-center gap-1.5 rounded text-rz-muted hover:text-rz-danger">
                  <ShieldOff className="h-3.5 w-3.5" /> Block
                </button>
              </div>
              {panel === "block" && <BlockPanel userId={userId} name={card.displayName} onClose={() => setPanel(null)} onBlocked={() => { setPanel(null); setBlocked(true); }} />}
              {panel === "report" && <ReportPanel userId={userId} name={card.displayName} onClose={() => setPanel(null)} />}
            </div>
          )}

          {card.aboutMe && (
            <Section title="About">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-rz-text">{card.aboutMe}</p>
            </Section>
          )}

          <Section title="Basic details">
            <dl>
              <Detail label="Age" value={`${card.age} years`} />
              <Detail label="Height" value={card.heightCm ? formatHeight(card.heightCm) : null} />
              <Detail label="Marital status" value={card.maritalStatus} />
              <Detail label="Religion" value={card.religion} />
              <Detail label="Community / caste" value={card.community} />
              <Detail label="Mother tongue" value={card.motherTongue} />
              <Detail label="Location" value={place} />
            </dl>
          </Section>

          <Section title="Education & career">
            <dl>
              <Detail label="Education" value={card.education} />
              <Detail label="Profession" value={card.profession} />
              <Detail label="Income" value={card.incomeRange} />
            </dl>
            {!card.education && !card.profession && !card.incomeRange && <p className="text-sm text-rz-muted">Not shared.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}

export function MemberProfileView({ profileId }: { profileId: string }) {
  const view = useAsync((signal) => api.get<ProfileViewResponse>(`/profiles/${profileId}`, { signal }), [profileId]);

  if (view.data === null && view.loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]" role="status" aria-label="Loading profile">
        <Skeleton className="aspect-[4/5] w-full" />
        <div className="space-y-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }
  if (view.data === null && view.error) {
    const e = view.error;
    // 404 is the backend's single answer for "doesn't exist / not visible yet / blocked" (it never says which).
    if (e.kind === "not_found" || e.kind === "validation") {
      return (
        <EmptyState
          title="This profile isn't available"
          description="It may have been removed, isn't visible yet, or you and this member can't see each other's profiles."
          action={<ButtonLink href="/dashboard/matches" size="sm" variant="outline">Back to matches</ButtonLink>}
        />
      );
    }
    if (e.kind === "forbidden") {
      return <ErrorState title="Not allowed" description={e.message || "You don't have permission to view this profile."} />;
    }
    return <ApiErrorView error={e} onRetry={view.reload} />;
  }
  const data = view.data;
  if (!data) return null;

  if (data.audience === "owner" || data.audience === "admin") {
    return (
      <EmptyState
        title="This is your own profile"
        description="Members see the profile you've built here. You can edit it any time."
        action={<ButtonLink href="/dashboard/profile" size="sm">Edit my profile</ButtonLink>}
      />
    );
  }
  if (data.audience === "anonymous") {
    return (
      <EmptyState
        title="Log in to see this profile"
        description="Your session may have ended, so only a limited summary is available."
        action={<ButtonLink href={`/login?next=${encodeURIComponent(`/dashboard/members/${profileId}`)}`} size="sm">Log in</ButtonLink>}
      />
    );
  }
  const card = fromProfileView(data);
  return card ? <Loaded card={card} /> : null;
}
