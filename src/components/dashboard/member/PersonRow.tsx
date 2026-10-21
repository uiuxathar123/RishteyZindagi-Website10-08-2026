"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { memberHref } from "@/components/profile/ProfileCard";
import { cardAvatar, locationLine } from "@/components/profile/cardModel";
import type { Summary } from "@/components/profile/useProfileSummaries";
import { Avatar } from "@/components/ui/Avatar";
import { CompanyVerifiedBadge, VerifiedBadge } from "@/components/ui/Badge";
import type { CounterpartRef } from "@/lib/api/types";

/**
 * One person in a list (interests, matches, ...). The list APIs give a name and
 * a profile id; the photo, age and city come from that profile's own view when
 * the backend lets us see it. With no profile id, or when the profile isn't
 * visible, the row shows the name alone and is not a link.
 */
export function PersonRow({
  counterpart,
  summary,
  meta,
  children,
}: {
  counterpart: CounterpartRef;
  summary?: Summary;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const card = summary?.state === "ok" ? summary.card : undefined;
  const name = card?.displayName ?? counterpart.name ?? "Member";
  const place = card ? locationLine(card) : "";

  const identity = (
    <>
      <Avatar src={card?.photoSrc} alt={card?.photoSrc ? `Photo of ${name}` : name} size="lg" fallbackSrc={card ? cardAvatar(card) : undefined} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="block truncate font-serif text-base font-semibold text-rz-navy">
            {name}
            {card ? `, ${card.age}` : ""}
          </span>
          {card?.verified && <VerifiedBadge />}
          {card?.companyVerified && <CompanyVerifiedBadge />}
        </span>
        {place && (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-rz-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{place}</span>
          </span>
        )}
        {card && (card.profession || card.education) && <span className="mt-0.5 block truncate text-xs text-rz-muted">{card.profession ?? card.education}</span>}
        {meta && <span className="mt-0.5 block text-xs text-rz-muted">{meta}</span>}
      </span>
    </>
  );

  return (
    <li className="flex flex-col gap-3 border-b border-rz-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between md:p-5">
      {counterpart.profileId ? (
        <Link href={memberHref(counterpart.profileId)} className="rz-focus flex min-w-0 items-center gap-3 rounded-md">
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-3">{identity}</div>
      )}
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[60px] sm:pl-0">{children}</div>}
    </li>
  );
}
