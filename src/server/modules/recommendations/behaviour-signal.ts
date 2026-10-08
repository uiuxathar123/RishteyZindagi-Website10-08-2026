/**
 * B5 gap-fix §2/§4: behaviour-learning foundation.
 *
 * The gap-fix instruction is explicit: "Do NOT build a full ML system.
 * Do NOT invent fake behavioural data... Only use behaviour tables/
 * fields that actually exist in the current database. If the existing
 * schema does not yet have suitable behaviour records, do NOT fabricate
 * them."
 *
 * A direct inspection of the schema and every existing module (this was
 * re-verified while building this file) found:
 *
 *   - `likes`, `interests`, `matches`, and `shortlists` exist as B1
 *     schema-only foundation tables (the same pattern `partner_
 *     preferences` was in before B4 built real business logic on top of
 *     it) — but NO route, controller, service, or repository anywhere
 *     in B1-B5 ever INSERTs into any of them. There is no "profile
 *     view" table, and `chat_participants`/`messages` have no "accepted"
 *     concept and no "skip/reject" concept at all. B6 is explicitly the
 *     phase that will build likes/interests/shortlist/block/chat
 *     business logic (§17 of the B5 FINAL lock, reaffirmed by this
 *     gap-fix's own "DO NOT START B6").
 *   - In other words: there is currently no real, populated behavioural
 *     signal anywhere in this system to read. Reading one of those
 *     empty tables and presenting that as "behaviour learning" would
 *     itself be a form of fabrication — it would always return nothing,
 *     dressed up as a real data dependency, and would need to be
 *     rewired the moment B6 actually starts writing to them anyway.
 *
 * So this file is exactly what §4 asks for instead: a clean interface
 * (`BehaviourSignalProvider`) plus one concrete, honest implementation
 * (`NoBehaviourSignalProvider`) that deterministically reports "no
 * influence available" for every candidate, every time. It documents
 * the seven signal types the product intends to support eventually,
 * gives B6 (or a later phase) a single seam to implement against, and
 * guarantees — by construction, not by convention — that B5's
 * recommendation engine is byte-identical with and without this file's
 * involvement until a real provider replaces `NoBehaviourSignalProvider`.
 */

/** The behaviour signal types the product intends to eventually learn
 * from. Purely documentary until a real provider exists — no code path
 * currently produces any of these. */
export type BehaviourSignalType =
  | "PROFILE_VIEW"
  | "INTEREST_SENT"
  | "INTEREST_ACCEPTED"
  | "SHORTLISTED"
  | "CHAT_INITIATED"
  | "CHAT_ACCEPTED"
  | "SKIPPED_REJECTED";

/**
 * The result of asking "does behaviour data say anything about this
 * requester/candidate pair?". `available: false` means exactly that —
 * not "zero signal", but "nothing to say", which is the only honest
 * answer while no real signal source exists. `adjustment` is a bounded
 * nudge to the compatibility score, in the same 0-100 space as
 * `scoreCandidate`'s output; it is capped (see MAX_BEHAVIOUR_SCORE_
 * ADJUSTMENT) and — critically — never allowed to change a candidate's
 * PRIMARY/SECONDARY tier, which is decided purely from explicit-
 * preference category results before this is ever consulted. That
 * ordering is what makes "manual preference remains primary over
 * behaviour" true by construction rather than by convention: tier
 * classification (`scoring.ts`'s `classifyTier`) never sees behaviour
 * data at all.
 */
export interface BehaviourInfluence {
  available: boolean;
  /** Only meaningful when `available` is true. A signed adjustment in
   * [-MAX_BEHAVIOUR_SCORE_ADJUSTMENT, +MAX_BEHAVIOUR_SCORE_ADJUSTMENT]. */
  adjustment: number;
  /** Which signal types (if any) contributed — for future debugging/
   * explanation only, never serialized to the recommendation response
   * (the response's public breakdown stays explicit-preference-only,
   * per §10 of the original FINAL rules). */
  contributingSignals: BehaviourSignalType[];
}

/** The maximum a behaviour signal may ever move a compatibility score,
 * in either direction, once a real provider exists. Small and bounded
 * on purpose: "behaviour can refine ranking but cannot silently rewrite
 * the user's explicit preference configuration." Unused by
 * `NoBehaviourSignalProvider` (which never returns `available: true`),
 * but exported now so a future real provider — and its tests — inherit
 * the cap rather than each picking their own. */
export const MAX_BEHAVIOUR_SCORE_ADJUSTMENT = 5;

/** The service boundary every caller (recommendations.service.ts) goes
 * through — never a direct table read. Swapping `NoBehaviourSignalProvider`
 * for a real, data-backed implementation later is the entire integration
 * surface; nothing in scoring.ts or recommendations.service.ts needs to
 * change shape when that happens. */
export interface BehaviourSignalProvider {
  getInfluence(requesterUserId: string, candidateUserId: string): Promise<BehaviourInfluence>;
}

/**
 * The only implementation this phase ships. Always, deterministically,
 * reports no influence — not because behaviour learning was attempted
 * and produced nothing, but because there is no real signal source to
 * consult yet (see the file-level comment). Keeping this as an explicit,
 * named class (rather than e.g. a null passed around) makes the "there
 * is currently zero behavioural influence" fact visible at every call
 * site and in every test that constructs one.
 */
export class NoBehaviourSignalProvider implements BehaviourSignalProvider {
  async getInfluence(_requesterUserId: string, _candidateUserId: string): Promise<BehaviourInfluence> {
    return { available: false, adjustment: 0, contributingSignals: [] };
  }
}

/** The provider `recommendations.service.ts` actually uses. A single
 * shared instance is fine — the provider itself is stateless. */
export const behaviourSignalProvider: BehaviourSignalProvider = new NoBehaviourSignalProvider();

/**
 * Applies a behaviour influence to a base compatibility score. Pure and
 * deterministic: with `NoBehaviourSignalProvider` (`available: false`)
 * this is always a no-op — `applyBehaviourInfluence(score, {available:
 * false, ...})` returns `score` unchanged, for every score, every time,
 * which is what keeps "the recommendation engine must remain correct
 * with zero behaviour data" true today. When a real provider is wired
 * in later, the adjustment is clamped to +/-MAX_BEHAVIOUR_SCORE_ADJUSTMENT
 * and the result is re-clamped to [0,100] — it can nudge a score, it can
 * never flip a PRIMARY candidate's tier (tier is decided before this
 * runs, from `scoreCandidate`'s breakdown alone) and it can never push a
 * score outside the valid range.
 */
export function applyBehaviourInfluence(baseScore: number, influence: BehaviourInfluence): number {
  if (!influence.available) return baseScore;
  const clampedAdjustment = Math.max(-MAX_BEHAVIOUR_SCORE_ADJUSTMENT, Math.min(MAX_BEHAVIOUR_SCORE_ADJUSTMENT, influence.adjustment));
  return Math.max(0, Math.min(100, Math.round(baseScore + clampedAdjustment)));
}
