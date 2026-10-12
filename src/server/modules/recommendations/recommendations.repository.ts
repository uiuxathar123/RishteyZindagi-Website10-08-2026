/**
 * B5: candidate fetch. Everything expressible as a single SQL predicate —
 * eligibility, self-exclusion, symmetric block-exclusion, and the mutual
 * gender hard-filter (§4) — is applied here, at the database layer, so
 * the application-code scorer (scoring.ts) only ever runs over an
 * already-narrow, already-eligible candidate set (per the FINAL rules'
 * §16 "do not fetch the entire population into JS" instruction). The
 * candidate's own partner_preferences row (needed for mutual scoring,
 * §1) is fetched in the same query via a LEFT JOIN — no second,
 * per-candidate query, so there is no N+1 here.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { profiles, users, partnerPreferences, blocks } from "@/server/db/schema";
import type { ProfileRow } from "@/server/modules/profiles/profiles.repository";
import type { PartnerPreferenceRow } from "@/server/modules/preferences/preferences.repository";

/**
 * Hard cap on how many eligible candidates are pulled into application
 * code for scoring in one request. Every other narrowing (eligibility,
 * gender, blocks, self-exclusion) already happens in this same SQL
 * query — this cap is a deliberate, documented safety bound against a
 * pathological worst case (e.g. a very large pool of same-gender,
 * mutually-unblocked, eligible profiles) rather than a silent limit on
 * correctness: candidates are taken in a stable `profiles.id` order, so
 * the same cap always admits the same set for a given pool, and a future
 * phase can raise it or replace it with true DB-level score-aware
 * pagination without changing this function's contract. Documented as a
 * known scaling boundary in the B5 completion report, not hidden.
 */
export const CANDIDATE_FETCH_CAP = 2000;

export interface CandidateRow {
  profile: ProfileRow;
  displayName: string;
  /** `null` when the candidate has no partner_preferences row at all —
   * §3: never excluded, just imposes no additional constraint. */
  preferences: PartnerPreferenceRow | null;
}

export interface HardFilterInput {
  requesterUserId: string;
  requesterProfileId: string;
  /** The requester's own gender (§4D's fallback needs it to compute the
   * *candidate's* default preferred gender when the candidate hasn't set
   * genderPreference explicitly). */
  requesterGender: "MALE" | "FEMALE";
  /** The requester's *effective* desired gender — either their own
   * explicit genderPreference, or (§7) the opposite of their own gender
   * when unset. Computed by the caller (recommendations.service.ts) so
   * this repository function stays a pure "apply these conditions" query
   * builder, matching search.repository.ts's own separation of concerns. */
  requesterEffectiveGenderPreference: "MALE" | "FEMALE";
}

/**
 * §4: the four hard, non-scored eligibility gates, applied entirely in
 * SQL:
 *   A. candidate ACTIVE + READY_FOR_VISIBILITY
 *   B. self-exclusion
 *   C. symmetric block-exclusion (NOT EXISTS, checked both directions —
 *      `blocks` stores one directional row per block, so "either
 *      direction" needs both orderings checked, not a single symmetric
 *      FK)
 *   D. mutual gender compatibility — the candidate's *effective*
 *      preferred gender (their own explicit genderPreference, defaulted
 *      via the same §7 opposite-gender rule when unset) must be the
 *      requester's gender, computed with COALESCE/CASE so no per-
 *      candidate follow-up query is needed.
 */
export async function fetchEligibleCandidates(input: HardFilterInput): Promise<CandidateRow[]> {
  // The CASE branches must be explicitly cast to the profile_gender enum
  // type — otherwise Postgres treats the 'FEMALE'/'MALE' literals as text
  // and COALESCE(enum, text) is rejected ("COALESCE types profile_gender
  // and text cannot be matched", confirmed against the real test DB).
  const candidateEffectiveGenderPref = sql<string>`COALESCE(${partnerPreferences.genderPreference}, CASE WHEN ${profiles.gender} = 'MALE' THEN 'FEMALE'::profile_gender ELSE 'MALE'::profile_gender END)`;

  const notBlocked = sql`NOT EXISTS (
    SELECT 1 FROM ${blocks} b
    WHERE (b.blocker_user_id = ${input.requesterUserId} AND b.blocked_user_id = ${users.id})
       OR (b.blocker_user_id = ${users.id} AND b.blocked_user_id = ${input.requesterUserId})
  )`;

  const rows = await db
    .select({ profile: profiles, displayName: users.name, preferences: partnerPreferences })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .leftJoin(partnerPreferences, eq(partnerPreferences.profileId, profiles.id))
    .where(
      and(
        eq(profiles.profileStatus, "READY_FOR_VISIBILITY"),
        // B19: manual-approval queue.
        eq(profiles.approvalStatus, "APPROVED"),
        eq(users.status, "ACTIVE"),
        // B18: a member who chose "hide my profile" is not recommended to anyone.
        eq(profiles.profileVisibility, "VISIBLE"),
        ne(profiles.userId, input.requesterUserId),
        eq(profiles.gender, input.requesterEffectiveGenderPreference),
        sql`${candidateEffectiveGenderPref} = ${input.requesterGender}`,
        notBlocked
      )
    )
    .orderBy(asc(profiles.id))
    .limit(CANDIDATE_FETCH_CAP);

  // Defensive normalization: a LEFT JOIN with no match should already
  // come back as `null` for the whole nested `preferences` object, but
  // this guards against a driver/version returning an all-null-fields
  // object instead — either way, "no real preferences row" collapses to
  // `null` here so every caller only has one shape to handle.
  return rows.map((row) => ({
    profile: row.profile,
    displayName: row.displayName,
    preferences: row.preferences && row.preferences.id ? row.preferences : null,
  }));
}
