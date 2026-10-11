/**
 * B7: the chat-eligibility membership check — "Chat eligibility = Mutual
 * Match + Active Membership" (see BACKEND.md's B7 section for the full
 * design note). B8 (Membership + Payment Foundation) has not been built
 * yet, but the `memberships` table it will populate already exists in the
 * frozen B1 schema (empty, unused, per every earlier phase's own scan —
 * same situation B6 found `likes`/`interests`/`matches`/etc. in before it
 * built real logic on top of them).
 *
 * This is deliberately the ONE small, dedicated, well-documented function
 * every membership-gated check in this codebase calls — never a stub,
 * never a fake "let everyone through for now" bypass. Today it always
 * returns `false` for every user, because `memberships` is genuinely
 * empty — that is the CORRECT, HONEST answer given the real state of the
 * data, not a bug: it means chat is currently gated shut behind
 * membership, exactly as the product rule specifies. The moment B8 ships
 * and inserts/updates a real `memberships` row to `status = 'ACTIVE'` for
 * a user, this exact same, unchanged function starts returning `true` for
 * them — zero code changes required anywhere that calls it.
 *
 * B8 never needs to write to anything in this file — it only ever writes
 * to the existing `memberships` table via its own module. This file is
 * read-only with respect to that table, by design: a stable, obvious
 * place for B8 (and any future membership-gated feature) to read
 * "is this user's membership active right now" from, with no coupling in
 * the other direction.
 *
 * No caching: every call queries the database fresh. Membership state can
 * change at any moment (a payment succeeds, an admin cancels a plan, a
 * membership's `expiresAt` passes) and every gated action (message-send,
 * new-chat-initiation) must reflect that immediately — the same
 * real-time-read discipline B5's weight config and B6's suspension-state
 * checks already established in this codebase, not a new pattern.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships, membershipPlans } from "@/server/db/schema";

/**
 * True only when this user has a `memberships` row with `status =
 * 'ACTIVE'` AND (`expiresAt IS NULL` OR `expiresAt` is still in the
 * future). A membership that is PENDING/EXPIRED/CANCELLED, or that has no
 * row at all, returns false — never throws, never assumes.
 */
export async function hasActiveMembership(userId: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "ACTIVE"),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now))
      )
    )
    .limit(1);
  return !!row;
}

/**
 * B18: true only when the user has an ACTIVE, unexpired membership whose
 * plan's `features.advancedSearch` is `true`. Read fresh on every call
 * (same no-caching discipline as `hasActiveMembership`). Never throws.
 */
export async function hasAdvancedSearchEntitlement(userId: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "ACTIVE"),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)),
        sql`(${membershipPlans.features} ->> 'advancedSearch') = 'true'`
      )
    )
    .limit(1);
  return !!row;
}
