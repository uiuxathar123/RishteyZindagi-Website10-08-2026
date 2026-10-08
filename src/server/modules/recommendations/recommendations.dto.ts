/**
 * B5: response shaping. Reuses B3/B4's existing authenticated-public
 * profile view (profiles.dto.ts's toAuthenticatedPublicView + its
 * resolveLookups dependency, both already exported for exactly this kind
 * of reuse — see B4's own search.service.ts) rather than building a
 * fourth profile view. There is no anonymous variant here at all: this
 * endpoint is authenticated-only by construction (§12/§14 — a
 * recommendation only has meaning relative to a signed-in requester's
 * own stored preferences).
 */
import type { AuthenticatedPublicProfileView } from "@/server/modules/profiles/profiles.dto";
import type { CategoryScoreResult, RecommendationTier } from "./scoring";

export interface RecommendationItem {
  profile: AuthenticatedPublicProfileView;
  /** 0-100, deterministic — see scoring.ts. May include a small, bounded
   * behaviour-signal adjustment on top of the pure preference-based
   * score (see behaviour-signal.ts) — currently always a no-op, since no
   * real behaviour signal exists yet, but the field name stays
   * `compatibilityScore` (not `preferenceScore`) so the response shape
   * doesn't need to change again once a real provider ships. */
  compatibilityScore: number;
  /** §10: public-safe breakdown only — category name, four-state
   * result, the category's fixed weight, and the points it actually
   * contributed. Never the raw preference values behind it. Always
   * reflects the explicit-preference score only, never a behaviour
   * adjustment — see scoring.ts's classifyTier doc comment. */
  compatibilityBreakdown: Array<{ category: string; result: string; weight: number; contribution: number }>;
  /** B5 gap-fix §1: explicit, backend-decided classification — the
   * client is never expected to infer this from `compatibilityScore`.
   * Decided purely from `compatibilityBreakdown` (no category "none")
   * before any behaviour signal is considered — see scoring.ts's
   * `classifyTier`. */
  tier: RecommendationTier;
}

export type RecommendationsStatus = "ok" | "preferences_not_configured";

export interface RecommendationsPage {
  /** §2/§6: lets a client tell "you haven't set partner preferences yet"
   * apart from "you have preferences, but nobody currently matches" —
   * both return an empty `items` array, only `status` differs. */
  status: RecommendationsStatus;
  /** PRIMARY-tier candidates only (every item has `tier: "PRIMARY"`),
   * paginated per `page`/`pageSize`/`total`/`totalPages` below — same
   * contract as before the B5 gap-fix. */
  items: RecommendationItem[];
  /** B5 gap-fix §2 ("You May Also Like"): SECONDARY-tier candidates —
   * every item has `tier: "SECONDARY"`. NOT paginated — see
   * recommendations.service.ts's MAX_SECONDARY_ITEMS/MIN_SECONDARY_SCORE
   * and the "only on page 1" note there. A candidate appears in either
   * `items` or `secondaryItems`, never both (tier classification is a
   * strict partition — see scoring.ts's classifyTier). */
  secondaryItems: RecommendationItem[];
  /** Total SECONDARY-tier candidates that cleared MIN_SECONDARY_SCORE,
   * before the MAX_SECONDARY_ITEMS cap was applied — lets a client show
   * "+N more" without a second request. 0 on any page other than 1
   * (secondaryItems itself is also empty there — see the service). */
  secondaryTotal: number;
  page: number;
  pageSize: number;
  /** Total PRIMARY-tier candidates (what `items` is paginated over). */
  total: number;
  totalPages: number;
}

export function toRecommendationItem(
  profileView: AuthenticatedPublicProfileView,
  score: number,
  breakdown: CategoryScoreResult[],
  tier: RecommendationTier
): RecommendationItem {
  return {
    profile: profileView,
    compatibilityScore: score,
    compatibilityBreakdown: breakdown.map((b) => ({
      category: b.category,
      result: b.result,
      weight: b.weight,
      contribution: b.contribution,
    })),
    tier,
  };
}
