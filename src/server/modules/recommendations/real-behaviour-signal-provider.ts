/**
 * B6: the first REAL `BehaviourSignalProvider` (see
 * `behaviour-signal.ts`'s interface, frozen/untouched — this file only
 * *implements* it, from a new, separate file, so nothing in B5's own
 * behaviour-signal.ts needs to change). Reads only `behaviour_events`
 * rows that a real B6 action actually wrote (interactions.service.ts /
 * profiles.service.ts's profile-view hook) — never fabricated, never
 * batched.
 *
 * Hard guarantees this file relies on rather than re-implements (see
 * BACKEND.md's B6 section for the full reasoning):
 *   - It can NEVER override hard eligibility, block, self-exclusion, or
 *     gender compatibility — those are decided entirely upstream in
 *     `recommendations.repository.ts`'s SQL, before this provider is
 *     ever consulted for a given candidate. This file adds no
 *     eligibility/block checks of its own because doing so would be
 *     redundant, not because the guarantee is weaker without them.
 *   - It can NEVER move a candidate across the PRIMARY/SECONDARY tier
 *     boundary — `recommendations.service.ts` calls `classifyTier`
 *     BEFORE this provider is ever consulted (see that file's top-of-
 *     file hierarchy comment), and this provider's return value
 *     (`BehaviourInfluence`) has no way to reach `classifyTier` at all.
 *   - Its `adjustment` is re-clamped to
 *     +/-`MAX_BEHAVIOUR_SCORE_ADJUSTMENT` by `applyBehaviourInfluence`
 *     (behaviour-signal.ts, unchanged) regardless of what this file
 *     computes — the local clamp below is defense in depth, not the
 *     only guard.
 *
 * Decay model (documented here, not just in code): a signal's raw weight
 * decays LINEARLY to zero over `DECAY_WINDOW_DAYS` days —
 * `decayFactor = max(0, 1 - ageDays / DECAY_WINDOW_DAYS)` — so an event
 * from yesterday counts close to full weight and one older than the
 * window contributes nothing. Simple and explicit, per the brief's "no
 * need for anything fancy" instruction.
 *
 * Repeated-action / dedup model: for a given (requester, candidate) pair,
 * only the MOST RECENT event of each type counts (see
 * `behaviour-events.repository.ts`'s `fetchLatestPerTypeForPair`) — e.g.
 * liking the same profile ten times still contributes exactly one LIKE
 * signal, not ten. This is what keeps "one repeated action must not
 * produce unlimited score inflation" true independently of the final
 * score clamp.
 */
import * as behaviourEventsRepo from "@/server/modules/behaviour-events/behaviour-events.repository";
import type { BehaviourEventRow, BehaviourEventType } from "@/server/modules/behaviour-events/behaviour-events.repository";
import type { BehaviourInfluence, BehaviourSignalProvider, BehaviourSignalType } from "./behaviour-signal";
import { MAX_BEHAVIOUR_SCORE_ADJUSTMENT } from "./behaviour-signal";

/** Linear decay window — a signal loses all influence once it's this old. */
export const DECAY_WINDOW_DAYS = 60;

/** Raw per-signal weights, BEFORE decay and before the final +/-5 clamp
 * (`applyBehaviourInfluence` clamps regardless, so these can be generous
 * without risking an out-of-range adjustment). Two separate weight maps
 * because "I already showed interest in this candidate" and "this
 * candidate already showed interest in me" are both meaningful but not
 * identical signals — mutual/received interest is weighted slightly
 * higher, since it reflects the *candidate's* independent behaviour, not
 * just the requester's own repeat browsing. A rejection in either
 * direction is a strong negative signal, deliberately larger in
 * magnitude than any single positive signal. */
const MY_ACTION_WEIGHTS: Partial<Record<BehaviourEventType, number>> = {
  PROFILE_VIEW: 1,
  LIKE: 3,
  SHORTLIST: 3,
  INTEREST_SENT: 2,
  INTEREST_ACCEPTED: 6,
  INTEREST_REJECTED: -8,
  MATCH_CREATED: 6,
};

const THEIR_ACTION_WEIGHTS: Partial<Record<BehaviourEventType, number>> = {
  PROFILE_VIEW: 0.5,
  LIKE: 2,
  SHORTLIST: 2,
  INTEREST_SENT: 3,
  INTEREST_ACCEPTED: 6,
  INTEREST_REJECTED: -8,
  MATCH_CREATED: 6,
};

function decayFactor(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - ageDays / DECAY_WINDOW_DAYS);
}

function weightedSum(rows: BehaviourEventRow[], weights: Partial<Record<BehaviourEventType, number>>): { total: number; types: BehaviourSignalType[] } {
  let total = 0;
  const types: BehaviourSignalType[] = [];
  for (const row of rows) {
    const weight = weights[row.eventType];
    if (weight === undefined) continue; // e.g. SEARCH_INTERACTION/CHAT_INITIATED — no B6 writer yet, ignored if ever present
    const decay = decayFactor(row.createdAt);
    if (decay <= 0) continue;
    total += weight * decay;
    types.push(row.eventType as BehaviourSignalType);
  }
  return { total, types };
}

export class RealBehaviourSignalProvider implements BehaviourSignalProvider {
  async getInfluence(requesterUserId: string, candidateUserId: string): Promise<BehaviourInfluence> {
    const [myActions, theirActions] = await Promise.all([
      behaviourEventsRepo.fetchLatestPerTypeForPair(requesterUserId, candidateUserId),
      behaviourEventsRepo.fetchLatestPerTypeForPair(candidateUserId, requesterUserId),
    ]);

    const mine = weightedSum(myActions, MY_ACTION_WEIGHTS);
    const theirs = weightedSum(theirActions, THEIR_ACTION_WEIGHTS);

    const contributingSignals = [...mine.types, ...theirs.types];
    if (contributingSignals.length === 0) {
      return { available: false, adjustment: 0, contributingSignals: [] };
    }

    // Local clamp (defense in depth — applyBehaviourInfluence clamps
    // again regardless, see this file's top-of-file comment).
    const rawAdjustment = mine.total + theirs.total;
    const adjustment = Math.max(-MAX_BEHAVIOUR_SCORE_ADJUSTMENT, Math.min(MAX_BEHAVIOUR_SCORE_ADJUSTMENT, rawAdjustment));

    return { available: true, adjustment, contributingSignals };
  }
}

/**
 * B13 (Performance/Scalability phase — genuine, evidenced N+1 fix; full
 * before/after evidence in PERFORMANCE_REPORT.md / BACKEND.md's B13
 * section): the batched counterpart to `getInfluence` above.
 * `recommendations.service.ts` used to call `getInfluence` once per
 * candidate (inside a `Promise.all` over the whole scored candidate set),
 * which meant `fetchLatestPerTypeForPair` ran twice per candidate — up to
 * `CANDIDATE_FETCH_CAP` (2000) candidates, so as many as 4000 extra query
 * round trips for a single recommendations request. This computes the
 * exact same per-candidate `BehaviourInfluence` result (identical
 * decay/weight/clamp math, unchanged) but from exactly TWO underlying
 * queries total (behaviour-events.repository.ts's
 * `fetchLatestPerTypeForPairsBatch`), not `2 * candidates.length`.
 *
 * This is a NEW function, not a signature change to `getInfluence` or to
 * the `BehaviourSignalProvider` interface (behaviour-signal.ts, B5,
 * untouched) — `recommendations.service.ts` already imports this file's
 * concrete `behaviourSignalProvider`/functions directly (a disclosed B6
 * integration point, see this file's top-of-file comment), so adding a
 * second, batched entry point here is the narrowest possible fix: no
 * other caller of `getInfluence` exists to break, and `NoBehaviourSignalProvider`
 * (B5's fallback/test double) is untouched.
 */
export async function getInfluenceBatch(requesterUserId: string, candidateUserIds: string[]): Promise<Map<string, BehaviourInfluence>> {
  const result = new Map<string, BehaviourInfluence>();
  if (candidateUserIds.length === 0) return result;

  const { myActionsByCandidate, theirActionsByCandidate } = await behaviourEventsRepo.fetchLatestPerTypeForPairsBatch(
    requesterUserId,
    candidateUserIds
  );

  for (const candidateUserId of candidateUserIds) {
    const mine = weightedSum(myActionsByCandidate.get(candidateUserId) ?? [], MY_ACTION_WEIGHTS);
    const theirs = weightedSum(theirActionsByCandidate.get(candidateUserId) ?? [], THEIR_ACTION_WEIGHTS);

    const contributingSignals = [...mine.types, ...theirs.types];
    if (contributingSignals.length === 0) {
      result.set(candidateUserId, { available: false, adjustment: 0, contributingSignals: [] });
      continue;
    }

    const rawAdjustment = mine.total + theirs.total;
    const adjustment = Math.max(-MAX_BEHAVIOUR_SCORE_ADJUSTMENT, Math.min(MAX_BEHAVIOUR_SCORE_ADJUSTMENT, rawAdjustment));
    result.set(candidateUserId, { available: true, adjustment, contributingSignals });
  }

  return result;
}

/** The active provider `recommendations.service.ts` imports instead of
 * B5's `NoBehaviourSignalProvider` (which stays exported, unused, from
 * behaviour-signal.ts as a documented fallback/test double — see
 * BACKEND.md's B6 section for the disclosed one-line import swap this
 * required in recommendations.service.ts). */
export const behaviourSignalProvider: BehaviourSignalProvider = new RealBehaviourSignalProvider();
