/**
 * B8: the Visibility Boost membership benefit — "6-month plan members'
 * profiles are boosted in others' search/recommendation results." This
 * is the ONE genuinely real, enforced membership-benefit signal this
 * phase adds to the recommendations pipeline (see BACKEND.md's B8
 * section, and recommendations.service.ts's disclosed, pre-approved
 * one-line integration — the second of the two frozen-file touches this
 * phase makes).
 *
 * Mirrors behaviour-signal.ts's own clamp discipline deliberately —
 * `MAX_VISIBILITY_BOOST_ADJUSTMENT` plays the exact role
 * `MAX_BEHAVIOUR_SCORE_ADJUSTMENT` does there: a small, fixed, positive-
 * only cap on how much a score can move, applied strictly AFTER tier
 * classification (never able to move a candidate across PRIMARY/
 * SECONDARY) and never able to bypass hard eligibility/blocks (this
 * module adds no eligibility logic of its own — it is only ever
 * consulted for candidates the SQL repository already hard-filtered,
 * the identical structural guarantee the B6 behaviour provider already
 * proved out).
 *
 * Semantic judgment call: `getVisibilityBoost(userId)` takes the
 * CANDIDATE's own userId, not the requester's — visibility is a
 * property of the profile being shown (its own 6-month-membership
 * status), independent of who is viewing it. So in
 * recommendations.service.ts this is called once per candidate in the
 * result set, not once per requester.
 */
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships, membershipPlans } from "@/server/db/schema";
import { TIER_DURATION_DAYS } from "./plan-tiers";

/** Deliberately smaller than behaviour-signal.ts's own +/-5 cap — a paid
 * membership benefit is meant to be a modest, honest nudge ("appear
 * slightly more often"), not a mechanism that can meaningfully outrank
 * genuine compatibility on its own. Positive-only (a boost, never a
 * penalty) — see applyVisibilityBoost's clamp below. */
export const MAX_VISIBILITY_BOOST_ADJUSTMENT = 3;

/**
 * True only when `userId` has a `memberships` row with `status =
 * 'ACTIVE'` AND not-yet-expired AND whose plan's `durationDays` is the
 * six-month tier (see plan-tiers.ts) — never cached, same real-time-read
 * discipline `membership-gate.ts`'s `hasActiveMembership` already
 * established. Never throws.
 */
export async function getVisibilityBoost(userId: string): Promise<number> {
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
        eq(membershipPlans.durationDays, TIER_DURATION_DAYS.SIX_MONTH)
      )
    )
    .limit(1);
  return row ? MAX_VISIBILITY_BOOST_ADJUSTMENT : 0;
}

/**
 * B13 (Performance/Scalability phase — genuine, evidenced N+1 fix; full
 * before/after evidence in PERFORMANCE_REPORT.md / BACKEND.md's B13
 * section): the batched counterpart to `getVisibilityBoost` above.
 * `recommendations.service.ts` used to call `getVisibilityBoost` once per
 * candidate in the scored result set (a second, separate per-candidate
 * `Promise.all` loop, alongside the behaviour-signal one this same phase
 * batches in real-behaviour-signal-provider.ts) — up to
 * `CANDIDATE_FETCH_CAP` (2000) extra one-row queries against
 * `memberships`/`membership_plans` for a single request. This computes
 * the identical "does this candidate have an ACTIVE, unexpired SIX_MONTH
 * membership" boolean per candidate, from exactly ONE query
 * (`userId IN (...)`) instead of one query per candidate.
 *
 * New function, not a signature change to `getVisibilityBoost` — no other
 * caller exists to break.
 */
export async function getVisibilityBoostBatch(userIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const now = new Date();
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
    .where(
      and(
        inArray(memberships.userId, userIds),
        eq(memberships.status, "ACTIVE"),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)),
        eq(membershipPlans.durationDays, TIER_DURATION_DAYS.SIX_MONTH)
      )
    );

  const boosted = new Set(rows.map((r) => r.userId));
  for (const userId of userIds) {
    result.set(userId, boosted.has(userId) ? MAX_VISIBILITY_BOOST_ADJUSTMENT : 0);
  }
  return result;
}

/**
 * Applies a visibility boost to an already-tier-classified compatibility
 * score. Pure and deterministic, mirroring
 * behaviour-signal.ts's applyBehaviourInfluence exactly: the boost is
 * clamped to [0, MAX_VISIBILITY_BOOST_ADJUSTMENT] and the result is
 * re-clamped to [0,100] — it can nudge a score, it can never flip a
 * candidate's tier (tier is decided before this ever runs) and it can
 * never push a score outside the valid range.
 */
export function applyVisibilityBoost(baseScore: number, boost: number): number {
  if (boost <= 0) return baseScore;
  const clamped = Math.max(0, Math.min(MAX_VISIBILITY_BOOST_ADJUSTMENT, boost));
  return Math.max(0, Math.min(100, Math.round(baseScore + clamped)));
}
