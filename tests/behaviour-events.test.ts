/**
 * B6: real behaviour-event creation at each real trigger point, plus the
 * real `BehaviourSignalProvider` (`real-behaviour-signal-provider.ts`)
 * integrated into B5's recommendations pipeline — the "capstone" of B6
 * per the master brief. Proves, end to end: behaviour affects ranking;
 * manual preference still dominates tier; behaviour cannot change tier;
 * behaviour cannot bypass blocks; behaviour cannot bypass eligibility;
 * behaviour cannot exceed the score-adjustment cap. Also proves the
 * decay and dedup rules directly against the provider.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { GET as getProfile } from "@/app/api/v1/profiles/[profileId]/route";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { POST as blockUser } from "@/app/api/v1/interactions/blocks/route";
import { db } from "@/server/db/client";
import { behaviourEvents } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { RealBehaviourSignalProvider, DECAY_WINDOW_DAYS } from "@/server/modules/recommendations/real-behaviour-signal-provider";
import { MAX_BEHAVIOUR_SCORE_ADJUSTMENT } from "@/server/modules/recommendations/behaviour-signal";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

async function insertEvent(actorUserId: string, targetUserId: string, eventType: string, createdAt?: Date) {
  const [row] = await db
    .insert(behaviourEvents)
    .values({ actorUserId, targetUserId, eventType: eventType as never, createdAt: createdAt ?? new Date() })
    .returning();
  return row;
}

/** A full preference body matching `refs` exactly on every categorical
 * field — used so a candidate comfortably clears MIN_EVALUABLE_WEIGHT
 * and is scored, isolating what changes to the behaviour adjustment
 * alone. */
function fullPreferenceBody(refs: ReferenceIds) {
  return {
    ageMin: 18,
    ageMax: 60,
    heightMinCm: 100,
    heightMaxCm: 220,
    religionId: refs.religionId,
    maritalStatusIds: [refs.maritalStatusId],
    communityIds: [refs.communityId],
    motherTongueIds: [refs.motherTongueId],
    educationIds: [refs.educationId],
    professionIds: [refs.professionId],
    countryIds: [refs.countryId],
    cityIds: [refs.cityId],
  };
}

describe("B6 behaviour events + real behaviour-signal provider", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  // --- Real event creation at trigger points --------------------------------

  it("[event-profile-view] viewing another member's profile records a real PROFILE_VIEW event (not for the owner viewing their own)", async () => {
    const viewer = await buildReadyProfile("bev-view-viewer", refs, { gender: "FEMALE" });
    const target = await buildReadyProfile("bev-view-target", refs, { gender: "MALE" });

    // The owner viewing their own profile must NOT create a PROFILE_VIEW
    // event (see profiles.service.ts's disclosed hook — only the
    // non-owner "authenticated" branch fires it).
    await getProfile(greq(`http://localhost/api/v1/profiles/${target.profileId}`, target.member.sessionToken), { params: { profileId: target.profileId } });
    const ownerEvents = await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "PROFILE_VIEW"));
    expect(ownerEvents).toHaveLength(0);

    const res = await getProfile(greq(`http://localhost/api/v1/profiles/${target.profileId}`, viewer.member.sessionToken), { params: { profileId: target.profileId } });
    expect(res.status).toBe(200);

    const events = await db
      .select()
      .from(behaviourEvents)
      .where(and(eq(behaviourEvents.actorUserId, viewer.member.userId), eq(behaviourEvents.eventType, "PROFILE_VIEW")));
    expect(events).toHaveLength(1);
    expect(events[0].targetUserId).toBe(target.member.userId);
  });

  // --- Decay and dedup, tested directly against the real provider -----------

  it("[decay] a recent signal contributes more than an old one, and a signal older than DECAY_WINDOW_DAYS contributes nothing", async () => {
    const a = await buildReadyProfile("bev-decay-a", refs, { gender: "FEMALE" });
    const b = await buildReadyProfile("bev-decay-b", refs, { gender: "MALE" });

    await insertEvent(a.member.userId, b.member.userId, "LIKE", new Date());
    const provider = new RealBehaviourSignalProvider();
    const recentInfluence = await provider.getInfluence(a.member.userId, b.member.userId);
    expect(recentInfluence.available).toBe(true);
    expect(recentInfluence.adjustment).toBeGreaterThan(0);

    // Now push the same event far beyond the decay window.
    await db.delete(behaviourEvents).where(eq(behaviourEvents.actorUserId, a.member.userId));
    const oldDate = new Date(Date.now() - (DECAY_WINDOW_DAYS + 10) * 24 * 60 * 60 * 1000);
    await insertEvent(a.member.userId, b.member.userId, "LIKE", oldDate);
    const oldInfluence = await provider.getInfluence(a.member.userId, b.member.userId);
    expect(oldInfluence).toEqual({ available: false, adjustment: 0, contributingSignals: [] });
  });

  it("[dedup] repeating the same action many times contributes the same as doing it once (most-recent-per-type only, no unlimited inflation)", async () => {
    const a = await buildReadyProfile("bev-dedup-a", refs, { gender: "FEMALE" });
    const b = await buildReadyProfile("bev-dedup-b", refs, { gender: "MALE" });
    const provider = new RealBehaviourSignalProvider();

    await insertEvent(a.member.userId, b.member.userId, "LIKE");
    const once = await provider.getInfluence(a.member.userId, b.member.userId);

    for (let i = 0; i < 20; i++) {
      await insertEvent(a.member.userId, b.member.userId, "LIKE");
    }
    const repeated = await provider.getInfluence(a.member.userId, b.member.userId);

    // Both computed from the same DECAY_WINDOW_DAYS linear formula a few
    // milliseconds apart — compare with tolerance rather than exact
    // float equality, which the tiny elapsed-time difference would fail.
    expect(repeated.adjustment).toBeCloseTo(once.adjustment, 6);
    expect(repeated.contributingSignals).toEqual(once.contributingSignals);
  });

  it("[cap] the provider's adjustment never exceeds +/-MAX_BEHAVIOUR_SCORE_ADJUSTMENT even with many strong positive signals", async () => {
    const a = await buildReadyProfile("bev-cap-a", refs, { gender: "FEMALE" });
    const b = await buildReadyProfile("bev-cap-b", refs, { gender: "MALE" });
    const provider = new RealBehaviourSignalProvider();

    for (const type of ["LIKE", "SHORTLIST", "INTEREST_SENT", "INTEREST_ACCEPTED", "MATCH_CREATED", "PROFILE_VIEW"]) {
      await insertEvent(a.member.userId, b.member.userId, type);
      await insertEvent(b.member.userId, a.member.userId, type);
    }
    const influence = await provider.getInfluence(a.member.userId, b.member.userId);
    expect(influence.available).toBe(true);
    expect(influence.adjustment).toBeLessThanOrEqual(MAX_BEHAVIOUR_SCORE_ADJUSTMENT);
    expect(influence.adjustment).toBeGreaterThanOrEqual(-MAX_BEHAVIOUR_SCORE_ADJUSTMENT);
  });

  // --- End-to-end: recommendations pipeline proofs ---------------------------

  it("[e2e-affects-ranking] a real behaviour signal changes the reported compatibilityScore for that candidate", async () => {
    const requester = await buildReadyProfile("bev-e2e-rank-req", refs, { gender: "MALE" });
    // Candidate's default dateOfBirth (from buildReadyProfile) is
    // "1994-03-10" — age 32 as of the date this suite runs. Capping
    // ageMax at 30 gives a PARTIAL (not full) age-category credit, so
    // the pure-preference base score lands below 100, leaving headroom
    // for a positive behaviour adjustment to actually move it — a
    // same-refs full match would already be capped at 100 and mask the
    // effect entirely.
    const candidate = await buildReadyProfile("bev-e2e-rank-cand", refs, { gender: "FEMALE" });
    await patchPreferences(
      preq("http://localhost/api/v1/profiles/me/partner-preferences", { ...fullPreferenceBody(refs), ageMin: 18, ageMax: 30 }, requester.member.sessionToken)
    );

    const before = await (await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", requester.member.sessionToken))).json();
    const beforeItem = before.data.items.find((i: { profile: { id: string } }) => i.profile.id === candidate.profileId);
    expect(beforeItem).toBeTruthy();
    expect(beforeItem.compatibilityScore).toBeLessThan(100); // sanity: there is headroom to move

    // Strong positive real signal: requester already liked and sent an
    // interest to this candidate before.
    await insertEvent(requester.member.userId, candidate.member.userId, "LIKE");
    await insertEvent(requester.member.userId, candidate.member.userId, "INTEREST_SENT");

    const after = await (await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", requester.member.sessionToken))).json();
    const afterItem = after.data.items.find((i: { profile: { id: string } }) => i.profile.id === candidate.profileId);
    expect(afterItem).toBeTruthy();
    expect(afterItem.compatibilityScore).toBeGreaterThan(beforeItem.compatibilityScore);
    // Never exceeds the documented cap relative to the pure-preference score.
    expect(afterItem.compatibilityScore - beforeItem.compatibilityScore).toBeLessThanOrEqual(MAX_BEHAVIOUR_SCORE_ADJUSTMENT);
  });

  it("[e2e-tier-stable-secondary] heavy positive behaviour cannot promote a SECONDARY (mismatched) candidate into PRIMARY/items", async () => {
    const requester = await buildReadyProfile("bev-e2e-tier-sec-req", refs, { gender: "MALE", dateOfBirth: "1994-01-01" });
    await patchPreferences(
      preq("http://localhost/api/v1/profiles/me/partner-preferences", { ...fullPreferenceBody(refs), ageMin: 24, ageMax: 30 }, requester.member.sessionToken)
    );
    // Age far outside the preferred range -> "none" category -> SECONDARY.
    const candidate = await buildReadyProfile("bev-e2e-tier-sec-cand", refs, { gender: "FEMALE", dateOfBirth: "1970-01-01" });

    for (const type of ["LIKE", "SHORTLIST", "INTEREST_SENT", "INTEREST_ACCEPTED", "MATCH_CREATED"]) {
      await insertEvent(requester.member.userId, candidate.member.userId, type);
      await insertEvent(candidate.member.userId, requester.member.userId, type);
    }

    const res = await (await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", requester.member.sessionToken))).json();
    const itemIds = res.data.items.map((i: { profile: { id: string } }) => i.profile.id);
    const secondaryIds = res.data.secondaryItems.map((i: { profile: { id: string } }) => i.profile.id);
    expect(itemIds).not.toContain(candidate.profileId);
    // (it may or may not clear MIN_SECONDARY_SCORE after the small boost —
    // the point proven is that it never crosses into `items`.)
    if (secondaryIds.includes(candidate.profileId)) {
      const item = res.data.secondaryItems.find((i: { profile: { id: string } }) => i.profile.id === candidate.profileId);
      expect(item.tier).toBe("SECONDARY");
    }
  });

  it("[e2e-tier-stable-primary] heavy negative behaviour cannot demote a PRIMARY (fully matching) candidate into SECONDARY", async () => {
    const requester = await buildReadyProfile("bev-e2e-tier-pri-req", refs, { gender: "MALE" });
    await patchPreferences(preq("http://localhost/api/v1/profiles/me/partner-preferences", fullPreferenceBody(refs), requester.member.sessionToken));
    const candidate = await buildReadyProfile("bev-e2e-tier-pri-cand", refs, { gender: "FEMALE" });

    // Strong negative real signal both directions.
    await insertEvent(requester.member.userId, candidate.member.userId, "INTEREST_REJECTED");
    await insertEvent(candidate.member.userId, requester.member.userId, "INTEREST_REJECTED");

    const res = await (await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", requester.member.sessionToken))).json();
    const item = res.data.items.find((i: { profile: { id: string } }) => i.profile.id === candidate.profileId);
    expect(item).toBeTruthy();
    expect(item.tier).toBe("PRIMARY");
  });

  it("[e2e-cannot-bypass-block] behaviour signals cannot resurface a blocked candidate in recommendations", async () => {
    const requester = await buildReadyProfile("bev-e2e-block-req", refs, { gender: "MALE" });
    await patchPreferences(preq("http://localhost/api/v1/profiles/me/partner-preferences", fullPreferenceBody(refs), requester.member.sessionToken));
    const candidate = await buildReadyProfile("bev-e2e-block-cand", refs, { gender: "FEMALE" });

    for (const type of ["LIKE", "SHORTLIST", "INTEREST_SENT", "INTEREST_ACCEPTED", "MATCH_CREATED"]) {
      await insertEvent(requester.member.userId, candidate.member.userId, type);
      await insertEvent(candidate.member.userId, requester.member.userId, type);
    }
    await blockUser(preq("http://localhost/api/v1/interactions/blocks", { targetUserId: candidate.member.userId }, requester.member.sessionToken));

    const res = await (await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", requester.member.sessionToken))).json();
    const allIds = [...res.data.items, ...res.data.secondaryItems].map((i: { profile: { id: string } }) => i.profile.id);
    expect(allIds).not.toContain(candidate.profileId);
  });

  it("[e2e-cannot-bypass-eligibility] behaviour signals cannot surface a not-yet-visible (incomplete) candidate", async () => {
    const requester = await buildReadyProfile("bev-e2e-elig-req", refs, { gender: "MALE" });
    await patchPreferences(preq("http://localhost/api/v1/profiles/me/partner-preferences", fullPreferenceBody(refs), requester.member.sessionToken));
    // skipPhoto: true -> COMPLETE, not READY_FOR_VISIBILITY -> ineligible.
    const candidate = await buildReadyProfile("bev-e2e-elig-cand", refs, { gender: "FEMALE", skipPhoto: true });

    for (const type of ["LIKE", "SHORTLIST", "INTEREST_SENT", "INTEREST_ACCEPTED", "MATCH_CREATED"]) {
      await insertEvent(requester.member.userId, candidate.member.userId, type);
      await insertEvent(candidate.member.userId, requester.member.userId, type);
    }

    const res = await (await getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations", requester.member.sessionToken))).json();
    const allIds = [...res.data.items, ...res.data.secondaryItems].map((i: { profile: { id: string } }) => i.profile.id);
    expect(allIds).not.toContain(candidate.profileId);
  });
});
