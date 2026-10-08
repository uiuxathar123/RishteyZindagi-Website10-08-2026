/**
 * B5: the deterministic compatibility scorer. Pure functions only — no DB
 * access here, same "logic is testable/reviewable without a database"
 * posture as profiles/completion.ts. Given a requester's profile+
 * preferences and one candidate's profile+preferences (the candidate's
 * preferences row may be `null` — B5 §3: a candidate with no saved
 * preferences is never excluded, just imposes no additional constraint),
 * this computes one deterministic 0-100 score plus a per-category
 * breakdown. No randomness, no ML, no learned weights, no persistence —
 * every call with the same inputs returns the same output.
 *
 * ---------------------------------------------------------------------
 * INTERPRETATION NOTE (documented per the B5 FINAL rules' own
 * instruction to "document the exact mathematical rule... before coding
 * the scorer", and per §19's "report any ambiguity" spirit — this is not
 * a conflict with frozen B1-B4 architecture, just a resolution of an
 * internal tension in the new B5 rules themselves, applied rather than
 * asked about again since the rules say not to re-litigate approved
 * decisions):
 *
 * The FINAL rules describe compatibility both as a binary "recommendable
 * only when X satisfies Y" (§1) AND as something scored on a 0-100 scale
 * across ten categories with FULL/PARTIAL/NONE/UNAVAILABLE states (§5/
 * §6). Taken together with §4's explicit, exhaustively-enumerated "Hard
 * filters ... NOT scored ... either passes or excluded" list (account
 * eligibility, self-exclusion, blocks, gender) and §3's "[a preference-
 * less candidate] imposes no additional constraint" language, the
 * consistent reading applied here is:
 *
 *   - Only §4's four items (A-D) are hard/excluding gates, applied at
 *     the SQL layer in recommendations.repository.ts before any
 *     candidate reaches this scorer.
 *   - All ten §5 categories are *scored*, never gating — a mismatch on
 *     e.g. religion lowers the score, it does not remove the candidate
 *     from the result set. "Mutual" (§1) means both parties' *stated*
 *     preferences for a category feed into that category's score (when
 *     both have one), not that any one mismatch is disqualifying.
 *
 * This keeps §1, §3, §4, §5, and §6 all literally true simultaneously,
 * and is the interpretation recorded in the B5 completion report.
 * ---------------------------------------------------------------------
 */
import type { ProfileRow } from "@/server/modules/profiles/profiles.repository";
import type { PartnerPreferenceRow } from "@/server/modules/preferences/preferences.repository";
import { computeAge } from "@/server/modules/profiles/completion";

// ---------------------------------------------------------------------------
// Default category weights — the FINAL, per the B5 FINAL PRODUCT DECISIONS
// §9 values. Sums to exactly 100. These remain the fixed fallback and the
// fresh-environment seed values; §7 of the B5 gap-fix instruction moves the
// *active* weights an admin can configure behind `weights.service.ts` /
// `matching_weight_configs` (see below, "Admin-configurable weights"), but
// this constant itself is unchanged from the original FINAL lock and is
// still what a request scores with whenever no admin override applies (a
// missing config row, or the config equal to these defaults) — "the
// default output MUST remain identical when using the default
// configuration" is satisfied by construction, since the DB seed row's
// values are copied from this exact object (see drizzle migration
// 0004_b5_gap_fixes.sql).
// ---------------------------------------------------------------------------
export const DEFAULT_CATEGORY_WEIGHTS = {
  age: 15,
  height: 10,
  religion: 10,
  community: 8,
  motherTongue: 8,
  education: 10,
  profession: 12,
  maritalStatus: 8,
  location: 7,
  income: 12,
} as const;

/** @deprecated kept as an alias so nothing that already referenced the
 * original constant name breaks; use `DEFAULT_CATEGORY_WEIGHTS`. */
export const CATEGORY_WEIGHTS = DEFAULT_CATEGORY_WEIGHTS;

export type ScoreCategory = keyof typeof DEFAULT_CATEGORY_WEIGHTS;

/** The shape `weights.repository.ts`'s config row (or the default
 * constant above) is converted into before reaching the scorer — plain
 * category -> weight, not tied to either source. */
export type WeightMap = Record<ScoreCategory, number>;

const CATEGORY_ORDER: ScoreCategory[] = [
  "age",
  "height",
  "religion",
  "community",
  "motherTongue",
  "education",
  "profession",
  "maritalStatus",
  "location",
  "income",
];

const TOTAL_WEIGHT = (Object.values(DEFAULT_CATEGORY_WEIGHTS) as number[]).reduce((a, b) => a + b, 0); // 100

/**
 * §9: "if there is insufficient usable preference/profile data to
 * produce a meaningful compatibility score, handle it deterministically
 * and document the rule." Rule adopted here: a candidate is only scored
 * (and therefore only ever returned) if the categories with usable
 * evidence together carry at least this much of the total 100-point
 * weight. Below this floor, a score would be extrapolated from too thin
 * a slice of evidence (e.g. a single 10-point category standing in for
 * the whole 100-point scale) — rather than fabricate that, the candidate
 * is treated as not evaluable and is excluded from the page entirely
 * (never shown with a low-confidence or partial score).
 */
export const MIN_EVALUABLE_WEIGHT = 30;

// Range-category tolerance constants — how far outside a stated range a
// value can fall before it earns zero credit (linear decay from the
// range boundary to the tolerance distance). These are B5-original,
// deterministic constants (not "category weights" — §9 only locks the
// ten category weights above), documented here as the FINAL rules
// require ("document the exact mathematical rule... before coding").
const AGE_TOLERANCE_YEARS = 5;
const HEIGHT_TOLERANCE_CM = 10;
/** Income has no fixed unit (currency varies), so its tolerance is
 * relative: 25% of the preference's own stated range width (or, for a
 * one-sided range, 25% of the one bound given), floored so a
 * zero-or-near-zero-width range still has a small, non-degenerate
 * tolerance window. */
const INCOME_TOLERANCE_FRACTION = 0.25;

export type CategoryResultLabel = "full" | "partial" | "none" | "unavailable";

export interface CategoryScoreResult {
  category: ScoreCategory;
  result: CategoryResultLabel;
  weight: number;
  /** Points actually earned toward the final score from this category
   * (0 when unavailable or "none"; up to `weight` when "full"). */
  contribution: number;
}

export interface CompatibilityResult {
  /** `false` when total available weight fell below MIN_EVALUABLE_WEIGHT
   * — the caller must exclude this candidate from the result page rather
   * than show a fabricated score (see MIN_EVALUABLE_WEIGHT's comment). */
  evaluable: boolean;
  /** 0-100 integer, rounded; only meaningful when `evaluable` is true. */
  score: number;
  breakdown: CategoryScoreResult[];
}

function asIdArray(value: unknown): string[] {
  // Small local duplicate of the same helper already private to
  // profiles.dto.ts / preferences.dto.ts — kept local rather than
  // exporting either of those (no B3/B4 file needs to widen its
  // exports for a five-line, side-effect-free helper). Same precedent
  // search.controller.ts set for tryAuthenticate.
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Credit in [0,1] for a single point value against a preferred
 * [min,max] range, with linear partial credit out to `tolerance` beyond
 * whichever bound was missed. Either bound may be absent (one-sided
 * range). Returns `null` when neither bound is given (nothing to
 * evaluate) or the value itself is missing. */
function pointRangeCredit(value: number | null, min: number | null, max: number | null, tolerance: number): number | null {
  if (value === null) return null;
  if (min === null && max === null) return null;
  const effMin = min ?? -Infinity;
  const effMax = max ?? Infinity;
  if (value >= effMin && value <= effMax) return 1;
  const distance = value < effMin ? effMin - value : value - effMax;
  if (distance >= tolerance) return 0;
  return 1 - distance / tolerance;
}

/** Credit in [0,1] for overlap between two ranges (used for income,
 * where both the candidate's own income and the preference are ranges,
 * unlike age/height where only the preference is a range). Any overlap
 * (including touching) is full credit; otherwise linear partial credit
 * out to `tolerance` beyond the gap between the ranges. */
function rangeOverlapCredit(
  prefMin: number | null,
  prefMax: number | null,
  candMin: number | null,
  candMax: number | null,
  tolerance: number
): number | null {
  if (prefMin === null && prefMax === null) return null;
  if (candMin === null && candMax === null) return null;
  const pMin = prefMin ?? -Infinity;
  const pMax = prefMax ?? Infinity;
  const cMin = candMin ?? -Infinity;
  const cMax = candMax ?? Infinity;
  const overlap = Math.min(pMax, cMax) - Math.max(pMin, cMin);
  if (overlap >= 0) return 1;
  const gap = -overlap;
  if (gap >= tolerance) return 0;
  return 1 - gap / tolerance;
}

/** Binary set-membership credit: 1 if `value` is in `set`, 0 if not,
 * `null` (N/A) if `set` is empty/unset — §8's "OR within a category"
 * applied as a match/no-match check rather than a filter. */
function setMembershipCredit(value: string | null, set: string[]): number | null {
  if (set.length === 0) return null;
  if (value === null) return null;
  return set.includes(value) ? 1 : 0;
}

/** Combines the two directions of a mutual check (A's stated preference
 * evaluated against B's value, and B's stated preference evaluated
 * against A's value) into one credit. §1: both parties' stated wishes
 * matter, so when both directions have evidence the weaker (lower
 * credit) one governs — a category that's a full match one-way but a
 * miss the other way is not a full match overall. `null` in, `null`
 * out (both sides had nothing to say about this category). When only
 * one direction has evidence, that direction alone determines the
 * result — §3: a party with no preference on a category imposes no
 * *additional* constraint, it doesn't cancel the other party's. */
function combineDirections(creditAtoB: number | null, creditBtoA: number | null): number | null {
  if (creditAtoB === null && creditBtoA === null) return null;
  if (creditAtoB === null) return creditBtoA;
  if (creditBtoA === null) return creditAtoB;
  return Math.min(creditAtoB, creditBtoA);
}

function labelFor(credit: number): CategoryResultLabel {
  if (credit >= 1) return "full";
  if (credit <= 0) return "none";
  return "partial";
}

// ---------------------------------------------------------------------------
// Per-category evaluators. Each takes both profiles and both (possibly
// null) preference rows and returns a combined credit in [0,1] or null
// (unavailable). "requester"/"candidate" naming is only for readability
// — every evaluator is symmetric: it checks requester-preference-vs-
// candidate-profile AND candidate-preference-vs-requester-profile.
// ---------------------------------------------------------------------------

function evaluateAge(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  const requesterAge = computeAge(requester.dateOfBirth);
  const candidateAge = computeAge(candidate.dateOfBirth);
  const aToB = requesterPrefs ? pointRangeCredit(candidateAge, requesterPrefs.ageMin, requesterPrefs.ageMax, AGE_TOLERANCE_YEARS) : null;
  const bToA = candidatePrefs ? pointRangeCredit(requesterAge, candidatePrefs.ageMin, candidatePrefs.ageMax, AGE_TOLERANCE_YEARS) : null;
  return combineDirections(aToB, bToA);
}

function evaluateHeight(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  const aToB = requesterPrefs ? pointRangeCredit(candidate.heightCm, requesterPrefs.heightMinCm, requesterPrefs.heightMaxCm, HEIGHT_TOLERANCE_CM) : null;
  const bToA = candidatePrefs ? pointRangeCredit(requester.heightCm, candidatePrefs.heightMinCm, candidatePrefs.heightMaxCm, HEIGHT_TOLERANCE_CM) : null;
  return combineDirections(aToB, bToA);
}

function evaluateReligion(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  // Single-select on both the preference and the profile side (B4 §4) —
  // exact-match binary, no partial state is meaningful here.
  const aToB = requesterPrefs?.religionId ? (candidate.religionId === requesterPrefs.religionId ? 1 : 0) : null;
  const bToA = candidatePrefs?.religionId ? (requester.religionId === candidatePrefs.religionId ? 1 : 0) : null;
  return combineDirections(aToB, bToA);
}

function evaluateCommunity(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  const aToB = requesterPrefs ? setMembershipCredit(candidate.communityId, asIdArray(requesterPrefs.communityIds)) : null;
  const bToA = candidatePrefs ? setMembershipCredit(requester.communityId, asIdArray(candidatePrefs.communityIds)) : null;
  return combineDirections(aToB, bToA);
}

function evaluateMotherTongue(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  // Primary selection only — B4's own documented decision (not the
  // optional "additional selections" jsonb array on profiles), kept
  // consistent with how search.repository.ts already filters.
  const aToB = requesterPrefs ? setMembershipCredit(candidate.motherTongueId, asIdArray(requesterPrefs.motherTongueIds)) : null;
  const bToA = candidatePrefs ? setMembershipCredit(requester.motherTongueId, asIdArray(candidatePrefs.motherTongueIds)) : null;
  return combineDirections(aToB, bToA);
}

function evaluateEducation(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  const aToB = requesterPrefs ? setMembershipCredit(candidate.educationId, asIdArray(requesterPrefs.educationIds)) : null;
  const bToA = candidatePrefs ? setMembershipCredit(requester.educationId, asIdArray(candidatePrefs.educationIds)) : null;
  return combineDirections(aToB, bToA);
}

/** §7: preserves B4's ANY_PROFESSION semantics exactly — `professionAny`
 * means "no profession restriction" and always evaluates to full credit
 * for that direction, taking priority over professionIds (which the B4
 * controller already keeps mutually exclusive with professionAny at the
 * data-entry layer). No new sentinel is introduced. */
function evaluateProfession(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  function direction(prefs: PartnerPreferenceRow | null, otherProfessionId: string | null): number | null {
    if (!prefs) return null;
    if (prefs.professionAny) return 1;
    return setMembershipCredit(otherProfessionId, asIdArray(prefs.professionIds));
  }
  const aToB = direction(requesterPrefs, candidate.professionId);
  const bToA = direction(candidatePrefs, requester.professionId);
  return combineDirections(aToB, bToA);
}

/** §8: no fake/sentinel "Any Marital Status" value — an unset
 * maritalStatusIds list is simply N/A for that direction, exactly like
 * B4 search/preferences already treat it. */
function evaluateMaritalStatus(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  const aToB = requesterPrefs ? setMembershipCredit(candidate.maritalStatusId, asIdArray(requesterPrefs.maritalStatusIds)) : null;
  const bToA = candidatePrefs ? setMembershipCredit(requester.maritalStatusId, asIdArray(candidatePrefs.maritalStatusIds)) : null;
  return combineDirections(aToB, bToA);
}

/** Country + City combined into one "Location" category (§5 lists them
 * as one line item). City is more specific, so when a preference states
 * cityIds, that's what governs; otherwise fall back to countryIds. */
function evaluateLocation(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  function direction(prefs: PartnerPreferenceRow | null, otherCityId: string | null, otherCountryId: string | null): number | null {
    if (!prefs) return null;
    const cityIds = asIdArray(prefs.cityIds);
    if (cityIds.length > 0) return setMembershipCredit(otherCityId, cityIds);
    const countryIds = asIdArray(prefs.countryIds);
    if (countryIds.length > 0) return setMembershipCredit(otherCountryId, countryIds);
    return null;
  }
  const aToB = direction(requesterPrefs, candidate.cityId, candidate.countryId);
  const bToA = direction(candidatePrefs, requester.cityId, requester.countryId);
  return combineDirections(aToB, bToA);
}

/** Income is the one category where both sides carry a *range* (B4 added
 * incomeMinAmount/incomeMaxAmount to profiles itself, alongside the
 * preference's own min/max) — so this uses range-overlap credit, not
 * point-in-range. Same-currency-only, no conversion, exactly mirroring
 * B4 search's §21 rule: a currency mismatch (or the candidate having no
 * structured income at all) makes that direction structurally
 * incomparable, treated as N/A for that direction rather than a hard
 * "none" — the other direction, or the overall UNAVAILABLE state, takes
 * over per combineDirections. */
function evaluateIncome(requester: ProfileRow, requesterPrefs: PartnerPreferenceRow | null, candidate: ProfileRow, candidatePrefs: PartnerPreferenceRow | null): number | null {
  function direction(
    prefMin: number | null,
    prefMax: number | null,
    prefCurrency: string | null,
    otherMin: number | null,
    otherMax: number | null,
    otherCurrency: string | null
  ): number | null {
    if (prefMin === null && prefMax === null) return null;
    if (!prefCurrency || !otherCurrency || prefCurrency !== otherCurrency) return null;
    if (otherMin === null && otherMax === null) return null;
    const width = (prefMax ?? prefMin ?? 0) - (prefMin ?? prefMax ?? 0);
    const tolerance = Math.max(width, prefMin ?? prefMax ?? 0, 1) * INCOME_TOLERANCE_FRACTION;
    return rangeOverlapCredit(prefMin, prefMax, otherMin, otherMax, tolerance);
  }
  const aToB = requesterPrefs
    ? direction(requesterPrefs.incomeMinAmount, requesterPrefs.incomeMaxAmount, requesterPrefs.incomeCurrency, candidate.incomeMinAmount, candidate.incomeMaxAmount, candidate.incomeCurrency)
    : null;
  const bToA = candidatePrefs
    ? direction(candidatePrefs.incomeMinAmount, candidatePrefs.incomeMaxAmount, candidatePrefs.incomeCurrency, requester.incomeMinAmount, requester.incomeMaxAmount, requester.incomeCurrency)
    : null;
  return combineDirections(aToB, bToA);
}

const EVALUATORS: Record<ScoreCategory, typeof evaluateAge> = {
  age: evaluateAge,
  height: evaluateHeight,
  religion: evaluateReligion,
  community: evaluateCommunity,
  motherTongue: evaluateMotherTongue,
  education: evaluateEducation,
  profession: evaluateProfession,
  maritalStatus: evaluateMaritalStatus,
  location: evaluateLocation,
  income: evaluateIncome,
};

/**
 * Computes the full mutual compatibility result for one requester/
 * candidate pair. Never throws; always returns a breakdown for all ten
 * categories (§10: the explanation is derived only from the requester's
 * preferences and the candidate's public/authenticated-visible profile
 * attributes — this function never returns or logs either party's raw
 * preference row, only the four-state outcome + numeric contribution).
 */
export function scoreCandidate(
  requesterProfile: ProfileRow,
  requesterPrefs: PartnerPreferenceRow,
  candidateProfile: ProfileRow,
  candidatePrefs: PartnerPreferenceRow | null,
  // B5 gap-fix §7: "move the current hardcoded weights behind a
  // configuration provider only where necessary" — the scorer itself
  // stays untouched except for accepting weights as data instead of a
  // module-level constant. Every existing call site (and every existing
  // test) that omits this argument gets DEFAULT_CATEGORY_WEIGHTS, so
  // default output is byte-identical to before this change.
  weights: WeightMap = DEFAULT_CATEGORY_WEIGHTS
): CompatibilityResult {
  const breakdown: CategoryScoreResult[] = [];
  let earned = 0;
  let availableWeight = 0;

  for (const category of CATEGORY_ORDER) {
    const weight = weights[category];
    const credit = EVALUATORS[category](requesterProfile, requesterPrefs, candidateProfile, candidatePrefs);
    if (credit === null) {
      breakdown.push({ category, result: "unavailable", weight, contribution: 0 });
      continue;
    }
    const contribution = weight * credit;
    earned += contribution;
    availableWeight += weight;
    breakdown.push({ category, result: labelFor(credit), weight, contribution: Math.round(contribution * 100) / 100 });
  }

  if (availableWeight < MIN_EVALUABLE_WEIGHT) {
    return { evaluable: false, score: 0, breakdown };
  }

  // Normalize to the 0-100 scale using only the weight that was actually
  // evaluable, so missing categories don't unfairly drag the score down
  // (§9) — but the TOTAL_WEIGHT constant is kept (and asserted) as a
  // sanity check that CATEGORY_WEIGHTS still sums to 100.
  const score = Math.round((earned / availableWeight) * 100);
  return { evaluable: true, score: Math.max(0, Math.min(100, score)), breakdown };
}

// ---------------------------------------------------------------------------
// B5 gap-fix §1: primary vs. secondary classification.
//
// A candidate is PRIMARY when none of the ten scored categories came back
// "none" — i.e. every category is "full", "partial", or "unavailable", so
// no explicit/mutual preference was outright violated (an "unavailable"
// category was never evaluated at all, so it can't count as a violation;
// a "partial" is within the documented range tolerance, not a violation
// either — see the range-credit functions above). A candidate with at
// least one "none" category — a real, evaluated, zero-credit mismatch —
// is SECONDARY instead: they satisfy every hard filter and clear the
// evaluable-evidence floor, but fall outside at least one stated
// preference beyond what graduated scoring treats as "close enough".
//
// This is deliberately built from data `scoreCandidate` already computes
// (the per-category `result` label), not a second evaluation pass or a
// new per-category rule — "do NOT rewrite the scoring engine
// unnecessarily". It is also a strict partition: every evaluable
// candidate is classified into exactly one tier, so a candidate can
// never appear in both (recommendations.service.ts relies on this rather
// than de-duplicating after the fact).
// ---------------------------------------------------------------------------
export type RecommendationTier = "PRIMARY" | "SECONDARY";

export function classifyTier(result: CompatibilityResult): RecommendationTier {
  const hasOutrightMismatch = result.breakdown.some((entry) => entry.result === "none");
  return hasOutrightMismatch ? "SECONDARY" : "PRIMARY";
}

// ---------------------------------------------------------------------------
// B5 gap-fix §5/§6: admin-configurable weight validation. Pure, DB-free —
// `weights.service.ts` calls this before ever writing a candidate
// configuration, and it is exercised directly by scoring tests too. Kept
// here (not in weights.service.ts) because "what makes a WeightMap valid"
// is a scoring-engine concern, the same way the category list and the
// requirement that weights sum to 100 already were.
// ---------------------------------------------------------------------------
export interface WeightValidationResult {
  valid: boolean;
  /** Present only when `valid` is false — one human-readable reason,
   * deterministic and specific enough to show an admin directly. */
  error?: string;
  /** Present only when `valid` is true — the same weights, narrowed to
   * `WeightMap` (every key present, every value a finite integer). */
  weights?: WeightMap;
}

/**
 * Validates a candidate weight configuration before it's ever persisted
 * or used to score anything. Requirements (per the B5 gap-fix
 * instruction's "weight safety" section): every one of the ten known
 * categories must be present (no missing category, no unknown/extra
 * category — "total must equal 100" is only meaningful across the
 * complete set, so a partial update is not accepted here; the admin
 * route requires all ten in one request); every weight must be a finite
 * integer >= 0 (no negative, no NaN, no Infinity, no fractional weight);
 * and the ten weights must sum to exactly 100. Never throws — returns a
 * typed result so the caller (weights.service.ts) decides how to surface
 * a rejection (a ValidationError, in practice).
 */
export function validateWeightMap(input: Record<string, unknown>): WeightValidationResult {
  const keys = Object.keys(input);
  const unknown = keys.filter((k) => !CATEGORY_ORDER.includes(k as ScoreCategory));
  if (unknown.length > 0) {
    return { valid: false, error: `Unknown weight category: ${unknown.join(", ")}.` };
  }
  const missing = CATEGORY_ORDER.filter((c) => !(c in input));
  if (missing.length > 0) {
    return { valid: false, error: `Missing weight for category: ${missing.join(", ")}. All ten categories must be provided together.` };
  }

  const weights = {} as WeightMap;
  let total = 0;
  for (const category of CATEGORY_ORDER) {
    const value = input[category];
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { valid: false, error: `Weight for "${category}" must be a finite integer.` };
    }
    if (value < 0) {
      return { valid: false, error: `Weight for "${category}" cannot be negative.` };
    }
    weights[category] = value;
    total += value;
  }

  if (total !== 100) {
    return { valid: false, error: `Weights must sum to exactly 100 (got ${total}).` };
  }

  return { valid: true, weights };
}

// Sanity-checked at module load: the FINAL weights must sum to 100.
if (TOTAL_WEIGHT !== 100) {
  throw new Error(`B5 scoring.ts: CATEGORY_WEIGHTS must sum to 100, got ${TOTAL_WEIGHT}.`);
}
