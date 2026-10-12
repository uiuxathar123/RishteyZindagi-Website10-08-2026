/**
 * B5: orchestrates the recommendations pipeline in the order the FINAL
 * rules specify (§13): SQL-level hard filtering (recommendations.
 * repository.ts) -> mutual compatibility evaluation + deterministic
 * scoring (scoring.ts) -> ranking -> explanation/breakdown -> response
 * shaping (reusing B3/B4's own privacy-view mapper). Nothing here writes
 * to any table, matches, likes, interests, shortlists, or blocks (§2/
 * §17) — this module only ever reads.
 *
 * B5 gap-fix additions (all documented at their point of use below):
 * admin-configurable weights (weights.service.ts's getActiveWeights),
 * the primary/secondary (§1) / "You May Also Like" (§2) split, and the
 * behaviour-signal seam (behaviour-signal.ts) — currently always inert.
 *
 * Priority hierarchy (documented once here, referenced from BACKEND.md):
 *
 *     Hard eligibility (recommendations.repository.ts, SQL, unchanged)
 *           |
 *     Explicit/manual preference compatibility (scoreCandidate + the
 *     active weight configuration — classifyTier decides PRIMARY vs.
 *     SECONDARY from THIS ALONE, before behaviour is ever consulted)
 *           |
 *     Behavioural signals (behaviour-signal.ts — a bounded score nudge
 *     only; see applyBehaviourInfluence's doc comment for why it can
 *     never flip a tier)
 *           |
 *     Secondary discovery (the SECONDARY/"You May Also Like" tier
 *     itself — not a further layer beyond what's built above)
 *
 * This ordering is what makes "explicit preferences remain the primary
 * signal, behaviour can refine ranking but cannot silently rewrite it"
 * true by construction: tier is computed from scoreCandidate's breakdown
 * alone (step 2), and behaviour (step 3) only ever adjusts the already-
 * decided score within a small cap, after tier is fixed.
 */
import { NotFoundError, AuthorizationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import * as preferencesRepo from "@/server/modules/preferences/preferences.repository";
import { resolveLookups } from "@/server/modules/profiles/profiles.service";
import { toAuthenticatedPublicView } from "@/server/modules/profiles/profiles.dto";
import * as recommendationsRepo from "./recommendations.repository";
import type { CandidateRow } from "./recommendations.repository";
import { scoreCandidate, classifyTier, type CompatibilityResult } from "./scoring";
import { getActiveWeights } from "./weights.service";
import { applyBehaviourInfluence } from "./behaviour-signal";
// B6 (disclosed, additive, one-line import swap — see BACKEND.md's B6
// section, "B5 behaviour-provider integration"): this is the only change
// to this file. `behaviour-signal.ts` itself (its interface,
// `NoBehaviourSignalProvider`, `applyBehaviourInfluence`, the +/-5 cap)
// is completely untouched. The real provider only reads `behaviour_events`
// rows that B6's own new code writes; it cannot affect tier classification
// (already fixed above, before this import's value is ever consulted) or
// eligibility/blocks (decided entirely upstream in the SQL repository).
import { getInfluenceBatch } from "./real-behaviour-signal-provider";
// B8 (disclosed, additive, one-line-shape integration — see BACKEND.md's
// B8 section, "B5 recommendations Visibility Boost integration"): applied
// AFTER tier is fixed and AFTER the (still-inert-by-default) behaviour
// influence above, in the exact same "bounded nudge to an already-
// decided score" shape — see visibility-boost.ts for the full clamp
// discipline this mirrors from behaviour-signal.ts. Nothing else in this
// file changes: hard-filter query, preferences-not-configured short-
// circuit, primary/secondary split (classifyTier), and pagination math
// are all untouched.
import { getVisibilityBoostBatch, applyVisibilityBoost } from "@/server/modules/memberships/visibility-boost";
import { viewerExtrasFor, type ViewerExtras } from "@/server/modules/profiles/privacy";
import { toRecommendationItem, type RecommendationsPage, type RecommendationItem } from "./recommendations.dto";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/**
 * B5 gap-fix §2 ("You May Also Like" must be limited): the secondary
 * tier never returns more than this many candidates, regardless of how
 * many are eligible — "a large number of poor matches cannot dominate
 * the response." Deliberately small and fixed (not tied to `pageSize`),
 * since secondaryItems is a bounded discovery shelf, not a paginated
 * feed.
 */
export const MAX_SECONDARY_ITEMS = 10;

/**
 * B5 gap-fix §2: a SECONDARY-tier candidate (one with at least one
 * outright category mismatch — see scoring.ts's classifyTier) must
 * still clear this overall score floor to be shown at all. This is
 * deliberately higher than scoring.ts's MIN_EVALUABLE_WEIGHT (which
 * only asks "is there enough evidence to trust a score", not "is the
 * score itself good"): a candidate could clear the evidence floor with
 * a very low score (e.g. one full-match category and several
 * mismatches) and still not be a reasonable "you may also like"
 * suggestion. 40 was chosen as a clear majority-of-categories-still-
 * matching bar without being so high it collapses to nearly the same
 * set PRIMARY already returns.
 */
export const MIN_SECONDARY_SCORE = 40;

export interface RecommendationsInput {
  page?: number;
  pageSize?: number;
}

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

async function requireOwnedProfile(ctx: AuthContext) {
  const userId = requireMemberSubject(ctx);
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new NotFoundError("No profile exists for this account yet. Create one first.");
  return { userId, profile };
}

/** §7: deterministic, defined only over the schema's two actual gender
 * values (MALE/FEMALE — verified against profileGenderEnum in
 * schema.ts, no third value exists), so the swap is unambiguous. This is
 * new B5 logic — B4 documented this fallback intent in a schema comment
 * but never implemented it anywhere; nothing in B4 itself changes here. */
function oppositeGender(gender: "MALE" | "FEMALE"): "MALE" | "FEMALE" {
  return gender === "MALE" ? "FEMALE" : "MALE";
}

function emptyPage(page: number, pageSize: number, status: RecommendationsPage["status"]): RecommendationsPage {
  return { status, items: [], secondaryItems: [], secondaryTotal: 0, page, pageSize, total: 0, totalPages: 1 };
}

/** Stable tie-break shared by both tiers: score DESC, then candidate
 * profile id ASC — same discipline B4 search already established for
 * its own (different) sort keys. */
function byScoreThenId(a: { candidate: CandidateRow; result: CompatibilityResult }, b: { candidate: CandidateRow; result: CompatibilityResult }): number {
  if (b.result.score !== a.result.score) return b.result.score - a.result.score;
  const aId = a.candidate.profile.id;
  const bId = b.candidate.profile.id;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

async function toItem(candidate: CandidateRow, result: CompatibilityResult, tier: "PRIMARY" | "SECONDARY", extras?: ViewerExtras): Promise<RecommendationItem> {
  const [lookups, photos] = await Promise.all([resolveLookups(candidate.profile), profilesRepo.listPhotos(candidate.profile.id)]);
  const profileView = toAuthenticatedPublicView(candidate.profile, candidate.displayName, lookups, photos, extras);
  return toRecommendationItem(profileView, result.score, result.breakdown, tier);
}

export async function getMyRecommendations(ctx: AuthContext, input: RecommendationsInput): Promise<RecommendationsPage> {
  const { userId, profile: requesterProfile } = await requireOwnedProfile(ctx);

  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  // §2/§6: no partner_preferences row at all -> explicit "not configured"
  // state, zero recommendations, no invented defaults. This is checked
  // before any candidate query runs at all.
  const requesterPrefs = await preferencesRepo.findByProfileId(requesterProfile.id);
  if (!requesterPrefs) {
    return emptyPage(page, pageSize, "preferences_not_configured");
  }

  const requesterEffectiveGenderPreference = requesterPrefs.genderPreference ?? oppositeGender(requesterProfile.gender);

  // B5 gap-fix §8 ("real-time" = request-time freshness): the active
  // weight configuration is read fresh on every request, exactly like
  // the profile/preference/candidate data below — no caching, so an
  // admin weight change is reflected on the very next GET, with zero
  // code deployment.
  const [candidates, weights] = await Promise.all([
    recommendationsRepo.fetchEligibleCandidates({
      requesterUserId: userId,
      requesterProfileId: requesterProfile.id,
      requesterGender: requesterProfile.gender,
      requesterEffectiveGenderPreference,
    }),
    getActiveWeights(),
  ]);

  const scored = candidates
    .map((candidate) => ({
      candidate,
      result: scoreCandidate(requesterProfile, requesterPrefs, candidate.profile, candidate.preferences, weights),
    }))
    // scoring.ts's MIN_EVALUABLE_WEIGHT floor: a candidate with too
    // little usable evidence is excluded outright rather than shown
    // with a fabricated/low-confidence score (§9).
    .filter((entry) => entry.result.evaluable);

  // B5 gap-fix §1/§3: tier is decided from the explicit-preference
  // breakdown ALONE, before behaviour is ever consulted (see this
  // file's top-of-file hierarchy comment) — a strict partition, so a
  // candidate lands in exactly one of the two arrays below.
  const primary = scored.filter((entry) => classifyTier(entry.result) === "PRIMARY");
  const secondaryEligible = scored.filter((entry) => classifyTier(entry.result) === "SECONDARY");

  // Behaviour influence (currently always a no-op with zero real signals
  // — see behaviour-signal.ts) is applied AFTER tier is fixed, to both
  // tiers, as a bounded nudge to the already-computed score only.
  //
  // B13 (Performance/Scalability phase — disclosed, evidenced N+1 fix;
  // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section for the full
  // before/after query-count evidence): this used to be a per-candidate
  // `Promise.all(...map(async entry => behaviourSignalProvider.getInfluence(...)))`
  // loop — one call, and therefore two DB round trips
  // (behaviour-events.repository.ts's `fetchLatestPerTypeForPair`, once
  // per direction) PER CANDIDATE, up to `CANDIDATE_FETCH_CAP` (2000)
  // candidates. Replaced with a single batched call
  // (`getInfluenceBatch`, real-behaviour-signal-provider.ts — new
  // function, computes byte-identical per-candidate results from exactly
  // two underlying queries total) over the whole scored candidate set at
  // once. Everything else — the decay math, the +/-5 clamp, tier already
  // being fixed before this runs — is completely unchanged.
  const allScored = [...primary, ...secondaryEligible];
  const candidateUserIds = allScored.map((entry) => entry.candidate.profile.userId);
  const influenceMap = await getInfluenceBatch(userId, candidateUserIds);
  for (const entry of allScored) {
    const influence = influenceMap.get(entry.candidate.profile.userId) ?? { available: false, adjustment: 0, contributingSignals: [] };
    entry.result = { ...entry.result, score: applyBehaviourInfluence(entry.result.score, influence) };
  }

  // B8: Visibility Boost — a candidate's OWN 6-month-membership status
  // (never the requester's), applied after behaviour influence, still
  // strictly after tier is fixed. See visibility-boost.ts's doc comment
  // for why this reads the candidate's userId, not the requester's.
  //
  // B13: same fix shape as behaviour influence above — was one
  // `getVisibilityBoost` DB round trip per candidate, now one batched
  // `getVisibilityBoostBatch` query over the whole candidate set.
  const boostMap = await getVisibilityBoostBatch(candidateUserIds);
  for (const entry of allScored) {
    const boost = boostMap.get(entry.candidate.profile.userId) ?? 0;
    entry.result = { ...entry.result, score: applyVisibilityBoost(entry.result.score, boost) };
  }

  primary.sort(byScoreThenId);
  secondaryEligible.sort(byScoreThenId);

  const total = primary.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const primaryPageSlice = primary.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // §2 ("minimum secondary score") + ("maximum secondary candidates"):
  // filtered and capped independently of primary's pagination.
  // "Only on page 1": secondaryItems is a discovery shelf shown
  // alongside the first page of primary results, not a second paginated
  // feed re-sent on every page — documented in recommendations.dto.ts.
  const secondaryFiltered = page === 1 ? secondaryEligible.filter((entry) => entry.result.score >= MIN_SECONDARY_SCORE) : [];
  const secondaryTotal = secondaryFiltered.length;
  const secondarySlice = secondaryFiltered.slice(0, MAX_SECONDARY_ITEMS);

  const extras = await viewerExtrasFor(userId, [...primaryPageSlice, ...secondarySlice].map(({ candidate }) => candidate.profile));
  const [items, secondaryItems] = await Promise.all([
    Promise.all(primaryPageSlice.map(({ candidate, result }) => toItem(candidate, result, "PRIMARY", extras.get(candidate.profile.id)))),
    Promise.all(secondarySlice.map(({ candidate, result }) => toItem(candidate, result, "SECONDARY", extras.get(candidate.profile.id)))),
  ]);

  return { status: "ok", items, secondaryItems, secondaryTotal, page, pageSize, total, totalPages };
}
