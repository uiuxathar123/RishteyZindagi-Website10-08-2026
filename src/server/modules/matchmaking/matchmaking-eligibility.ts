/**
 * Candidate eligibility and scoring for Personal Matchmaking — the existing recommendation pipeline, reused as is:
 * recommendations.repository.ts's SQL hard filters (READY_FOR_VISIBILITY, APPROVED, ACTIVE account, VISIBLE
 * profile, mutual gender, self-exclusion, blocks in either direction), plus the matchmaking opt-out, and
 * scoring.ts's scorer with the live weights from weights.service.ts. Every caller (generate, add, send, read)
 * goes through `eligibleFor`, so a profile that became ineligible is never shown through an older suggestion.
 */
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import type { ProfileRow } from "@/server/modules/profiles/profiles.repository";
import * as preferencesRepo from "@/server/modules/preferences/preferences.repository";
import type { PartnerPreferenceRow } from "@/server/modules/preferences/preferences.repository";
import { fetchEligibleCandidates, type CandidateRow } from "@/server/modules/recommendations/recommendations.repository";
import { scoreCandidate, classifyTier, type CompatibilityResult } from "@/server/modules/recommendations/scoring";
import { getActiveWeights } from "@/server/modules/recommendations/weights.service";

export interface CaseOwner {
  userId: string;
  profile: ProfileRow;
  preferences: PartnerPreferenceRow | null;
}

export async function loadCaseOwner(userId: string): Promise<CaseOwner | null> {
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) return null;
  const preferences = (await preferencesRepo.findByProfileId(profile.id)) ?? null;
  return { userId, profile, preferences };
}

const opposite = (g: "MALE" | "FEMALE"): "MALE" | "FEMALE" => (g === "MALE" ? "FEMALE" : "MALE");

/** Eligible candidates for this case owner, optionally limited to `onlyUserIds` (same rules either way). */
export async function eligibleFor(owner: CaseOwner, onlyUserIds?: string[]): Promise<CandidateRow[]> {
  return fetchEligibleCandidates({
    requesterUserId: owner.userId,
    requesterProfileId: owner.profile.id,
    requesterGender: owner.profile.gender,
    requesterEffectiveGenderPreference: owner.preferences?.genderPreference ?? opposite(owner.profile.gender),
    excludeMatchmakingOptOut: true,
    onlyUserIds,
  });
}

export interface ScoredCandidate {
  candidate: CandidateRow;
  /** null when the owner has no partner preferences yet (nothing to score against). */
  result: CompatibilityResult | null;
  tier: "PRIMARY" | "SECONDARY" | null;
}

export async function scoreFor(owner: CaseOwner, candidates: CandidateRow[]): Promise<ScoredCandidate[]> {
  if (!owner.preferences) return candidates.map((candidate) => ({ candidate, result: null, tier: null }));
  const weights = await getActiveWeights();
  const prefs = owner.preferences;
  return candidates.map((candidate) => {
    const result = scoreCandidate(owner.profile, prefs, candidate.profile, candidate.preferences, weights);
    return { candidate, result, tier: result.evaluable ? classifyTier(result) : null };
  });
}
