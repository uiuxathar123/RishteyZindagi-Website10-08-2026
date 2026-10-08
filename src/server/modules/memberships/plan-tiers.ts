/**
 * B8: the four membership tiers' canonical duration-in-days values —
 * seeded identically across both currencies (see seed.ts's
 * MEMBERSHIP_PLANS), so "which tier is this plan" and "is plan A higher
 * than plan B" can both be decided purely from `durationDays`, without
 * parsing a plan's `code` string. This is deliberately the ONE place
 * tier duration is defined — seed.ts, upgrade/downgrade logic
 * (memberships.service.ts), and the Visibility Boost eligibility check
 * (visibility-boost.ts) all read from here, so the three can never
 * silently drift out of sync with each other.
 *
 * Duration judgment call (documented again in BACKEND.md): "3 months"
 * and "6 months" are modeled as fixed day-counts (90 / 180) rather than
 * calendar-month arithmetic, matching `durationDays`'s existing integer-
 * days shape (no calendar-aware "add N months" concept exists anywhere
 * else in this schema) — a clearly-documented simplification, not a
 * hidden one.
 */
export const TIER_DURATION_DAYS = {
  SEVEN_DAY: 7,
  MONTHLY: 30,
  THREE_MONTH: 90,
  SIX_MONTH: 180,
} as const;

export type TierKey = keyof typeof TIER_DURATION_DAYS;

/** Ordered ascending — index position IS the tier rank, used by
 * memberships.service.ts to decide "is the new plan higher than the
 * current one" (upgrade) purely from durationDays comparison. */
export const TIER_ORDER: TierKey[] = ["SEVEN_DAY", "MONTHLY", "THREE_MONTH", "SIX_MONTH"];

export function tierRank(durationDays: number): number {
  const idx = TIER_ORDER.findIndex((k) => TIER_DURATION_DAYS[k] === durationDays);
  // A plan with a duration outside the four canonical tiers (should never
  // happen for a real, seeded plan) ranks below every real tier rather
  // than throwing — upgrade/downgrade comparisons degrade to "always
  // treat as an upgrade" rather than crashing checkout over an
  // unexpected admin-entered duration.
  return idx === -1 ? -1 : idx;
}

export function isSixMonthTier(durationDays: number): boolean {
  return durationDays === TIER_DURATION_DAYS.SIX_MONTH;
}
