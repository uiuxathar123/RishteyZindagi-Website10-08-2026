/**
 * B18: member privacy controls — one place that decides what a *viewing member* may see of another
 * member's profile, so search cards, recommendation cards, the profile page and the photo file
 * route can never disagree.
 *
 *  - profileVisibility HIDDEN  → not discoverable (search, recommendations) and the profile page
 *    answers 404; the only exceptions are the owner, admins (moderation) and members who already have
 *    an ACCEPTED interest with the owner (an existing connection is not "discovery").
 *  - photoVisibility ACCEPTED_ONLY → photos (cards, profile page, photo file route) are served only to
 *    the owner, admins and ACCEPTED partners. Fail-closed: a caller that does not say otherwise gets none.
 *  - showLastActive false → no activity hint is ever returned; true → a coarse label only (never a timestamp).
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { interests, users } from "@/server/db/schema";
import type { ProfileRow } from "./profiles.repository";

export interface ViewerExtras {
  photosVisible: boolean;
  lastActive: string | null;
}

/** Subset of `candidateUserIds` that have an ACCEPTED interest with `viewerUserId` (either direction). */
export async function acceptedPartnerIds(viewerUserId: string, candidateUserIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(candidateUserIds)].filter((i) => i !== viewerUserId);
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ from: interests.fromUserId, to: interests.toUserId })
    .from(interests)
    .where(
      and(
        eq(interests.status, "ACCEPTED"),
        or(
          and(eq(interests.fromUserId, viewerUserId), inArray(interests.toUserId, ids)),
          and(eq(interests.toUserId, viewerUserId), inArray(interests.fromUserId, ids))
        )
      )
    );
  return new Set(rows.map((r) => (r.from === viewerUserId ? r.to : r.from)));
}

export async function isAcceptedPartner(viewerUserId: string, otherUserId: string): Promise<boolean> {
  return (await acceptedPartnerIds(viewerUserId, [otherUserId])).has(otherUserId);
}

/** Coarse, privacy-preserving label — never an exact time. */
export function lastActiveLabel(lastActiveAt: Date | null | undefined, now = new Date()): string | null {
  if (!lastActiveAt) return null;
  const days = (now.getTime() - lastActiveAt.getTime()) / 86_400_000;
  if (days < 1) return "Active today";
  if (days < 7) return "Active this week";
  if (days < 30) return "Active this month";
  return "Active a while ago";
}

/** Per-profile extras for one page of rows viewed by a signed-in member. */
export async function viewerExtrasFor(viewerUserId: string, profilesOnPage: ProfileRow[]): Promise<Map<string, ViewerExtras>> {
  const out = new Map<string, ViewerExtras>();
  if (profilesOnPage.length === 0) return out;
  const userIds = profilesOnPage.map((p) => p.userId);
  const [partners, activity] = await Promise.all([
    acceptedPartnerIds(viewerUserId, userIds),
    db.select({ id: users.id, lastActiveAt: users.lastActiveAt }).from(users).where(inArray(users.id, userIds)),
  ]);
  const activeBy = new Map(activity.map((a) => [a.id, a.lastActiveAt]));
  for (const p of profilesOnPage) {
    const isPartner = partners.has(p.userId);
    out.set(p.id, {
      photosVisible: p.userId === viewerUserId || p.photoVisibility === "MEMBERS" || isPartner,
      lastActive: p.showLastActive ? lastActiveLabel(activeBy.get(p.userId)) : null,
    });
  }
  return out;
}
