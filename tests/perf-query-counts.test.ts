/**
 * B13 (Performance/Scalability phase) regression test for the N+1 fix
 * disclosed in behaviour-events.repository.ts / real-behaviour-signal-
 * provider.ts / visibility-boost.ts / recommendations.service.ts (see
 * PERFORMANCE_REPORT.md / BACKEND.md's B13 section for the full
 * before/after evidence).
 *
 * Before this fix, `recommendations.service.ts`'s `getMyRecommendations`
 * called `behaviourSignalProvider.getInfluence` (2 DB round trips) AND
 * `getVisibilityBoost` (1 DB round trip) once PER SCORED CANDIDATE — up
 * to `CANDIDATE_FETCH_CAP` (2000) candidates, so as many as ~6000 extra
 * query round trips for a single request. After the fix, both are
 * computed from exactly THREE total queries (two for behaviour — one per
 * direction — one for visibility boost), via `getInfluenceBatch`/
 * `getVisibilityBoostBatch`, regardless of how many candidates are being
 * scored.
 *
 * This test proves the fix at the request level (not just by reading the
 * code): it drives the real `GET /profiles/me/recommendations` route,
 * using `db/client.ts`'s `getQueryCount()`/`resetQueryCount()` dev/test
 * instrumentation (a near-zero-cost counter of real `pool.query()` calls
 * — see that file's own doc comment) to record the EXACT number of DB
 * round trips one request issues, with a SMALL matching candidate pool
 * (4) vs. a LARGER one (10) — while holding the returned page size fixed
 * at 3, so the per-RESULT-ITEM enrichment cost (`toItem`'s
 * `resolveLookups`/`listPhotos` — confirmed bounded by page size, not by
 * candidate-pool size; see PERFORMANCE_REPORT.md's N+1 audit for why
 * that one is already fine as-is) stays constant between the two runs.
 * If the old per-candidate loop shape were still present, tripling the
 * matching pool (4 -> 10, +6 candidates) would add roughly
 * `6 * 3 = 18` extra queries; the batched fix adds (at most) a small,
 * constant handful unrelated to candidate count.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { db, getQueryCount, resetQueryCount } from "@/server/db/client";
import { behaviourEvents, memberships, membershipPlans } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function getReq(query: string, token?: string) {
  return req(`http://localhost/api/v1/profiles/me/recommendations${query}`, undefined, { token, method: "GET" });
}

async function setPreferences(token: string, body: Record<string, unknown>) {
  const res = await patchPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", body, { token, method: "PATCH" }));
  if (res.status !== 200) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`setPreferences failed (${res.status}): ${JSON.stringify(b)}`);
  }
}

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

function fullMatchPreferenceBody(refs: ReferenceIds) {
  return {
    ageMin: 24,
    ageMax: 30,
    heightMinCm: 160,
    heightMaxCm: 175,
    religionId: refs.religionId,
    maritalStatusIds: [refs.maritalStatusId],
    communityIds: [refs.communityId],
    motherTongueIds: [refs.motherTongueId],
    educationIds: [refs.educationId],
    professionIds: [refs.professionId],
    countryIds: [refs.countryId],
    cityIds: [refs.cityId],
    incomeMinAmount: 500000,
    incomeMaxAmount: 1500000,
    incomeCurrency: "INR",
  };
}

/** Builds `count` FEMALE candidates that all full-match `requesterPrefs`
 * (same shape recommendations.test.ts's own [B/D/N/O] full-match
 * scenario uses), gives roughly half of them real behaviour_events rows
 * (both directions, several event types — so the batched behaviour
 * query actually has real per-candidate data to dedupe/weight, not just
 * empty results) and one an ACTIVE six-month membership (so the batched
 * visibility-boost query also has a real row to match), and returns
 * their userIds. */
async function buildMatchingCandidatePool(prefix: string, refs: ReferenceIds, requesterUserId: string, count: number): Promise<string[]> {
  const userIds: string[] = [];
  for (let i = 0; i < count; i++) {
    // Each buildReadyProfile call registers a new member (POST
    // /auth/register, rate-limited at 10/60s per IP — see auth.
    // controller.ts) — reset before every one so this fixture-building
    // loop (which can register well past that limit for a larger pool)
    // never trips it; this is test-fixture setup, not the code path
    // under test.
    __resetRateLimitsForTests();
    const candidate = await buildReadyProfile(`${prefix}-${i}`, refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    userIds.push(candidate.member.userId);

    if (i % 2 === 0) {
      await db.insert(behaviourEvents).values([
        { actorUserId: requesterUserId, targetUserId: candidate.member.userId, eventType: "PROFILE_VIEW" },
        { actorUserId: requesterUserId, targetUserId: candidate.member.userId, eventType: "LIKE" },
        { actorUserId: candidate.member.userId, targetUserId: requesterUserId, eventType: "PROFILE_VIEW" },
      ]);
    }
    if (i === 0) {
      const [plan] = await db
        .insert(membershipPlans)
        .values({ code: `PERF_QC_6MO_${Date.now()}`, name: "Perf QC 6-month", priceInPaise: 0, durationDays: 180 })
        .returning();
      await db.insert(memberships).values({ userId: candidate.member.userId, planId: plan.id, status: "ACTIVE", startedAt: new Date() });
    }
  }
  return userIds;
}

describe("B13 N+1 regression — recommendations behaviour-influence + visibility-boost batching", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
  });

  it("[perf-qc-recommendations-batched] growing the matching candidate pool 4 -> 10 (same fixed page size) does not grow the per-request query count proportionally", async () => {
    const refs = await resolveReferenceIds();

    // --- Run 1: small pool (4 matching candidates), pageSize 3 ---
    const requesterA = await buildReadyProfile("perf-qc-req-a", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requesterA.member.sessionToken, fullMatchPreferenceBody(refs));
    await buildMatchingCandidatePool("perf-qc-cand-a", refs, requesterA.member.userId, 4);

    resetQueryCount();
    const res1 = await getRecommendations(getReq("?pageSize=3", requesterA.member.sessionToken));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.data.status).toBe("ok");
    expect(body1.data.items).toHaveLength(3); // pageSize cap, all 4 candidates are PRIMARY full matches
    const queryCount1 = getQueryCount();

    // --- Run 2: larger pool (10 matching candidates), SAME pageSize 3 ---
    __resetRateLimitsForTests();
    const requesterB = await buildReadyProfile("perf-qc-req-b", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requesterB.member.sessionToken, fullMatchPreferenceBody(refs));
    await buildMatchingCandidatePool("perf-qc-cand-b", refs, requesterB.member.userId, 10);

    resetQueryCount();
    const res2 = await getRecommendations(getReq("?pageSize=3", requesterB.member.sessionToken));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.status).toBe("ok");
    expect(body2.data.items).toHaveLength(3); // same fixed page size as run 1
    const queryCount2 = getQueryCount();

    // The returned page is the same size both times, so per-ITEM
    // enrichment cost (toItem's resolveLookups/listPhotos) is identical
    // between the two runs — any growth in total query count would have
    // to come from the candidate-POOL-scaling behaviour-influence /
    // visibility-boost calls this phase fixed. Un-batched, +6 matching
    // candidates would have cost at least `6 * 3 = 18` extra queries (2
    // behaviour + 1 boost, per extra candidate); measured against the
    // real batched code, the two runs issue the EXACT SAME query count
    // (confirmed: 37 == 37 — see PERFORMANCE_REPORT.md) — not just
    // "fewer than un-batched", genuinely flat regardless of candidate
    // pool size, which is the strongest form of this proof.
    expect(queryCount2).toBe(queryCount1);
  }, 60_000);
});
