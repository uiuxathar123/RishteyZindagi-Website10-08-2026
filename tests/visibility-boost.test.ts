/**
 * B8: regression coverage for the two disclosed, pre-approved touches to
 * frozen B5/B6 files (see BACKEND.md's B8 section):
 *
 *  1. recommendations.service.ts — the Visibility Boost signal for
 *     6-month members (visibility-boost.ts). Mirrors
 *     tests/recommendations.test.ts's own [gap-G] (behaviour-signal cap)
 *     pattern exactly, using the same fixture scenarios ([B/D/N/O]'s
 *     100-score full match, [P]'s 94-score PRIMARY partial-credit match,
 *     [Q]'s 85-score SECONDARY outright-mismatch candidate) — proving the
 *     boost nudges score, is capped, is clamped to [0,100], and can never
 *     move a candidate across the PRIMARY/SECONDARY boundary that B5's
 *     own classifyTier already fixed.
 *  2. interactions.service.ts — the sendInterest membership gate. Already
 *     covered by tests/interactions.test.ts's own
 *     [interest-requires-membership] / [interest-received-still-
 *     actionable-without-membership] — not duplicated here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { db } from "@/server/db/client";
import { memberships, membershipPlans } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { MAX_VISIBILITY_BOOST_ADJUSTMENT } from "@/server/modules/memberships/visibility-boost";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function getReq(query: string, token?: string) {
  return req(`http://localhost/api/v1/profiles/me/recommendations${query}`, undefined, { token, method: "GET" });
}

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

async function setPreferences(token: string, body: Record<string, unknown>) {
  const res = await patchPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", body, { token, method: "PATCH" }));
  if (res.status !== 200) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`setPreferences failed (${res.status}): ${JSON.stringify(b)}`);
  }
}

function fullPreferenceBody(refs: ReferenceIds) {
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

/** Grants `userId` a real membership row against a real seeded plan
 * (by code), directly via the DB — same direct-table-write posture
 * tests/recommendations.test.ts's own behaviour-signal fixtures and
 * tests/behaviour-events.test.ts's tier-boundary fixtures already use. */
async function grantMembership(userId: string, planCode: string, opts?: { status?: "ACTIVE" | "EXPIRED"; expiresAt?: Date | null }) {
  const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, planCode)).limit(1);
  if (!plan) throw new Error(`Seeded membership plan "${planCode}" not found — did db:seed run against the test DB?`);
  await db.insert(memberships).values({
    userId,
    planId: plan.id,
    status: opts?.status ?? "ACTIVE",
    startedAt: new Date(),
    expiresAt: opts?.expiresAt !== undefined ? opts.expiresAt : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

describe("B8 Visibility Boost (recommendations.service.ts disclosed touch)", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
  });

  it("[vb-primary-nudge] a PRIMARY-tier candidate with an active 6-month membership gets its score nudged up by exactly the boost, tier unchanged", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("vb-p-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // Same scenario as recommendations.test.ts's [P]: age just outside
    // tolerance -> partial credit -> unboosted score is exactly 94,
    // still PRIMARY (no category is "none").
    const candidate = await buildReadyProfile("vb-p-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(32),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    await grantMembership(candidate.member.userId, "PLAN_6MONTH_INR");

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].tier).toBe("PRIMARY");
    expect(data.items[0].compatibilityScore).toBe(94 + MAX_VISIBILITY_BOOST_ADJUSTMENT);
  });

  it("[vb-secondary-nudge-never-crosses-tier] a SECONDARY-tier candidate boosted by a 6-month membership stays in secondaryItems, never crosses into items/PRIMARY", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("vb-q-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // Same scenario as recommendations.test.ts's [Q]: an outright age
    // mismatch ("none" category) -> unboosted score 85, SECONDARY tier —
    // tier is decided before the boost ever runs (see
    // recommendations.service.ts's own comment), so boosting the score
    // can never move this candidate into `items`.
    const candidate = await buildReadyProfile("vb-q-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(50),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    await grantMembership(candidate.member.userId, "PLAN_6MONTH_INR");

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
    expect(data.secondaryItems).toHaveLength(1);
    expect(data.secondaryItems[0].tier).toBe("SECONDARY");
    expect(data.secondaryItems[0].compatibilityScore).toBe(85 + MAX_VISIBILITY_BOOST_ADJUSTMENT);
  });

  it("[vb-capped-at-100] a already-100 candidate's boosted score is clamped at 100, never exceeding it", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("vb-cap-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    const candidate = await buildReadyProfile("vb-cap-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    await grantMembership(candidate.member.userId, "PLAN_6MONTH_INR");

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(100); // 100 + boost, clamped
  });

  it("[vb-no-boost-non-6month-plan] an active membership on a shorter tier (e.g. Monthly) grants no boost", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("vb-short-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    const candidate = await buildReadyProfile("vb-short-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(32),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    await grantMembership(candidate.member.userId, "PLAN_MONTHLY_INR");

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(94); // unboosted — not a 6-month plan
  });

  it("[vb-no-boost-expired-6month] an EXPIRED 6-month membership grants no boost", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("vb-exp-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    const candidate = await buildReadyProfile("vb-exp-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(32),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    await grantMembership(candidate.member.userId, "PLAN_6MONTH_INR", { status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(94); // unboosted — membership no longer active
  });

  it("[vb-requester-membership-irrelevant] the REQUESTER's own membership status never affects their own results (boost is about the candidate being shown, not the viewer)", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("vb-viewer-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await grantMembership(requester.member.userId, "PLAN_6MONTH_INR"); // requester (viewer) has a 6-month membership
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("vb-viewer-cand", refs, {
      // candidate has NO membership at all
      gender: "FEMALE",
      dateOfBirth: dobForAge(32),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(94); // unboosted — the CANDIDATE has no membership
  });
});
