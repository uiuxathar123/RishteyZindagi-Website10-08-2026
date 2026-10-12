"use client";

import { GraduationCap, Heart, Loader2, Lock, MapPin, MessageCircle, Ruler, Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MatchScore, BreakdownRows } from "./MatchScore";
import { ActionError } from "./ActionError";
import { locationLine, type CardProfile } from "./cardModel";
import { useProfileActions } from "./useProfileActions";
import { Badge, VerifiedBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { formatHeight } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Member page for a profile id (signed-in members only). */
export const memberHref = (profileId: string) => `/dashboard/members/${profileId}`;

/**
 * The core profile card used in Search Results, Featured Profiles and
 * Recommendations. What it shows is decided by the API response it was built
 * from (`profile.audience`): the backend gives a signed-out visitor only an
 * age / location / education / profession summary and no photo, and the card
 * simply renders what it was given. Actions exist only for the full view.
 */
export function ProfileCard({ profile, loginNext }: { profile: CardProfile; loginNext?: string }) {
  return profile.audience === "anonymous" ? (
    <GatedCard profile={profile} loginNext={loginNext} />
  ) : (
    <MemberCard profile={profile} />
  );
}

function GatedCard({ profile, loginNext }: { profile: CardProfile; loginNext?: string }) {
  const pathname = usePathname();
  const next = encodeURIComponent(loginNext ?? pathname ?? "/search");
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white">
      <div className="relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-rz-peach to-rz-champagne text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-rz-maroon shadow-card-sm">
          <Lock className="h-5 w-5" strokeWidth={2} />
        </span>
        <p className="px-4 text-xs font-medium text-rz-navy/80">
          {profile.photoWithheld ? "Photo visible after you log in" : "No photo added yet"}
        </p>
        {profile.verified && (
          <div className="absolute left-3 top-3">
            <VerifiedBadge />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-1 font-serif text-lg font-semibold text-rz-navy">{profile.displayName}</h3>
        <p className="mb-2 flex items-center gap-1 text-xs text-rz-muted">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            {profile.age} yrs{locationLine(profile) ? ` · ${locationLine(profile)}` : ""}
          </span>
        </p>
        <ul className="mb-3 space-y-1 text-[13px] text-rz-text">
          {profile.education && (
            <li className="flex items-center gap-1.5">
              <GraduationCap className="h-3.5 w-3.5 shrink-0 text-rz-muted" />
              {profile.education}
            </li>
          )}
          {profile.profession && <li className="text-rz-muted">{profile.profession}</li>}
        </ul>
        <p className="mb-3 text-xs text-rz-muted">Log in or create a free profile to see photos, full details and connect.</p>
        <div className="mt-auto flex items-center gap-2 border-t border-rz-border pt-3">
          <ButtonLink href={`/login?next=${next}`} size="sm" variant="outline" fullWidth>
            Login
          </ButtonLink>
          <ButtonLink href="/signup" size="sm" variant="primary" fullWidth>
            Sign Up Free
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}

function IconToggle({
  label,
  pressed,
  pending,
  onClick,
  className,
  children,
}: {
  label: string;
  pressed: boolean;
  pending: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={pending}
      onClick={onClick}
      className={cn(
        "rz-focus absolute bottom-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-card-sm transition-transform hover:scale-105 disabled:opacity-60",
        className
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

function MemberCard({ profile }: { profile: CardProfile }) {
  const a = useProfileActions(profile.userId);
  const details = [profile.religion, profile.motherTongue].filter(Boolean).join(" · ");

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-rz-border bg-white transition-shadow duration-200 hover:shadow-card-sm">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-rz-peach">
        <Link href={memberHref(profile.profileId)} aria-label={`View ${profile.displayName}'s profile`} className="rz-focus absolute inset-0 block">
          <PhotoImage
            src={profile.photoSrc}
            alt={profile.photoSrc ? `Photo of ${profile.displayName}` : `${profile.displayName} has not added a photo`}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 45vw, 90vw"
            className="transition-transform duration-300 group-hover:scale-[1.03]"
          />
          {profile.photosRestricted && (
            <span className="absolute inset-x-0 bottom-0 bg-rz-navy/75 px-3 py-1.5 text-center text-[11px] font-medium text-white">
              Photos shared with accepted connections only
            </span>
          )}
        </Link>
        {profile.score !== undefined && (
          <div className="absolute right-3 top-3">
            <div className="rounded-full bg-white/95 p-1 shadow-card-sm">
              <MatchScore value={profile.score} size={40} />
            </div>
          </div>
        )}
        {profile.verified && (
          <div className="absolute left-3 top-3">
            <VerifiedBadge />
          </div>
        )}
        {profile.userId && (
          <>
            <IconToggle
              label={a.shortlisted ? `Remove ${profile.displayName} from shortlist` : `Shortlist ${profile.displayName}`}
              pressed={a.shortlisted}
              pending={a.busy === "shortlist"}
              onClick={() => void a.toggleShortlist()}
              className="left-3 text-rz-gold-deep"
            >
              <Star className={cn("h-4 w-4", a.shortlisted && "fill-rz-gold text-rz-gold")} strokeWidth={2} />
            </IconToggle>
            <IconToggle
              label={a.liked ? `Unlike ${profile.displayName}` : `Like ${profile.displayName}`}
              pressed={a.liked}
              pending={a.busy === "like"}
              onClick={() => void a.toggleLike()}
              className="right-3 text-rz-maroon"
            >
              <Heart className={cn("h-4 w-4", a.liked && "fill-rz-maroon")} strokeWidth={2} />
            </IconToggle>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-1 font-serif text-lg font-semibold text-rz-navy">
          {profile.displayName}, {profile.age}
        </h3>
        {profile.publicId && (
          <p className="mb-1 text-[11px] font-medium tracking-wide text-rz-muted" data-testid="profile-public-id">
            ID {profile.publicId}
            {profile.lastActive ? ` · ${profile.lastActive}` : ""}
          </p>
        )}
        {locationLine(profile) && (
          <p className="mb-2 flex items-center gap-1 text-xs text-rz-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {locationLine(profile)}
          </p>
        )}
        <ul className="mb-3 space-y-1 text-[13px] text-rz-text">
          {profile.education && (
            <li className="flex items-center gap-1.5">
              <GraduationCap className="h-3.5 w-3.5 shrink-0 text-rz-muted" />
              {profile.education}
            </li>
          )}
          {profile.profession && <li className="text-rz-muted">{profile.profession}</li>}
          {(profile.heightCm || details) && (
            <li className="flex items-center gap-1.5 text-rz-muted">
              {profile.heightCm ? <Ruler className="h-3.5 w-3.5 shrink-0" /> : null}
              <span className="min-w-0">{[profile.heightCm ? formatHeight(profile.heightCm) : null, details].filter(Boolean).join(" · ")}</span>
            </li>
          )}
        </ul>

        {profile.breakdown && profile.breakdown.some((r) => r.result !== "unavailable") && (
          <details className="mb-3 rounded-md border border-rz-border bg-rz-ivory/60 px-3 py-2 text-xs">
            <summary className="rz-focus cursor-pointer font-semibold text-rz-navy">Why this match</summary>
            <div className="pt-2">
              <BreakdownRows rows={profile.breakdown} />
            </div>
          </details>
        )}

        <div className="mt-auto border-t border-rz-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ButtonLink href={memberHref(profile.profileId)} size="sm" variant="outline">
              View profile
            </ButtonLink>
            {profile.userId && <InterestControl a={a} userId={profile.userId} />}
          </div>
          {a.notice && (
            <p role="status" className="mt-2 text-xs text-rz-success">
              {a.notice}
            </p>
          )}
          <ActionError error={a.error} />
        </div>
      </div>
    </article>
  );
}

/** The one primary action on a card, driven by the real relation state. */
export function InterestControl({ a, userId }: { a: ReturnType<typeof useProfileActions>; userId: string }) {
  switch (a.interest) {
    case "matched":
      return <ChatLink userId={userId} />;
    case "sent_pending":
      return <Badge tone="gold">Interest sent</Badge>;
    case "declined":
      return <Badge tone="neutral">Interest declined</Badge>;
    case "received_pending":
      return (
        <ButtonLink href="/dashboard/interests" size="sm" variant="primary">
          Respond to interest
        </ButtonLink>
      );
    default:
      return (
        <Button size="sm" variant="primary" disabled={a.busy === "interest"} onClick={() => void a.sendInterest()} icon={a.busy === "interest" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
          {a.busy === "interest" ? "Sending…" : "Send interest"}
        </Button>
      );
  }
}

function ChatLink({ userId }: { userId: string }) {
  return (
    <ButtonLink href={`/dashboard/messages?with=${userId}`} size="sm" variant="primary" icon={<MessageCircle className="h-3.5 w-3.5" />}>
      Message
    </ButtonLink>
  );
}
