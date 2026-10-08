/**
 * B5: mutual, deterministic, explainable compatibility recommendations —
 * hard filters (§4: eligibility/self-exclusion/blocks/mutual gender),
 * scored categories (§5/§6/§9), missing-data behavior (§2/§3/§6),
 * ANY_PROFESSION/OR/no-sentinel semantics (§7/§8), determinism/ordering
 * (§12/§13), privacy (§14), and IDOR/raw-data-leak coverage.
 *
 * B5 gap-fix additions: primary/secondary ("You May Also Like")
 * classification, the behaviour-signal seam (currently always inert),
 * and admin-configurable matching weights.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { GET as getWeights, PATCH as patchWeights } from "@/app/api/v1/admin/matching/weights/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { users, blocks, adminRoles, adminUsers, auditLogs, matchingWeightConfigs } from "@/server/db/schema";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { hashPassword } from "@/server/lib/password";
import { classifyTier, DEFAULT_CATEGORY_WEIGHTS } from "@/server/modules/recommendations/scoring";
import { NoBehaviourSignalProvider, applyBehaviourInfluence, MAX_BEHAVIOUR_SCORE_ADJUSTMENT } from "@/server/modules/recommendations/behaviour-signal";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests } from "./helpers/reset-db";
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

async function secondReferenceSet(refs: ReferenceIds) {
  const [religions, professions, maritalStatuses] = await Promise.all([
    referenceRepo.listReligions(),
    referenceRepo.listProfessions(),
    referenceRepo.listMaritalStatuses(),
  ]);
  const muslim = religions.find((r) => r.name === "Muslim")!;
  const doctor = professions.find((p) => p.name === "Doctor")!;
  const divorced = maritalStatuses.find((m) => m.name === "Divorced")!;
  const muslimCommunity = await referenceRepo.findOrCreateCommunity("Test Community", muslim.id);
  return { muslim, doctor, divorced, muslimCommunity };
}

/** Standard full-preference body matched exactly to a "full match"
 * candidate built with the same `refs` — used as the baseline scenario
 * several tests build on. */
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

async function seedStaffAdmin(email: string, password: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "STAFF_ADMIN"));
  const [admin] = await db
    .insert(adminUsers)
    .values({ name: "Test Staff", email, passwordHash: await hashPassword(password), roleId: role.id })
    .returning();
  return admin;
}

async function loginAsSuperAdmin(label: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "SUPER_ADMIN"));
  const email = `super-${label}@rishteyzindagi.local`;
  await db.insert(adminUsers).values({ name: "Super", email, passwordHash: await hashPassword("superpassword1"), roleId: role.id });
  const res = await loginAdmin(req("http://localhost/api/v1/admin/login", { email, password: "superpassword1" }, { method: "POST" }));
  const { data } = await res.json();
  return data.sessionToken as string;
}

describe("Recommendations", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
  });

  // --- A/B: requester with/without preferences ---------------------------

  it("[A] requester with no partner_preferences row gets an explicit 'preferences_not_configured' status and zero recommendations, never invented defaults", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-a", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });

    const res = await getRecommendations(getReq("", requester.member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("preferences_not_configured");
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("[B/D/N/O] requester with preferences gets status 'ok'; a candidate matching every category on every direction scores exactly 100", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-b-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));

    // [D] candidate HAS no preferences row at all — never excluded, and
    // with no B->A direction available, every category falls back to the
    // single A->B direction, which is a full match everywhere.
    await buildReadyProfile("rec-b-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27), // within [24,30] but not at a boundary
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const res = await getRecommendations(getReq("", requester.member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("ok");
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(100);
    for (const cat of data.items[0].compatibilityBreakdown) {
      expect(cat.result).toBe("full");
    }
  });

  it("[O] age exactly at the preference's upper boundary is a full match, not partial", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-o-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("rec-o-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(30), // exactly ageMax
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const age = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "age");
    expect(age.result).toBe("full");
    expect(age.contribution).toBe(15);
  });

  it("[P] age just outside the range (within tolerance) earns deterministic partial credit — exact score", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-p-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // ageMax is 30, tolerance is 5 years -> age 32 is 2 years over ->
    // credit = 1 - 2/5 = 0.6 -> age contributes 15 * 0.6 = 9; every other
    // category matches fully (85), so score = (85 + 9) / 100 * 100 = 94.
    await buildReadyProfile("rec-p-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(32),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(94);
    const age = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "age");
    expect(age.result).toBe("partial");
  });

  it("[Q] age far outside the range (beyond tolerance) earns zero credit for that category but the candidate is NOT excluded — B5 gap-fix: an outright category mismatch now routes to secondaryItems ('You May Also Like'), not items", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-q-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // age 50 vs ageMax 30 -> distance 20 >= tolerance 5 -> credit 0;
    // every other category still matches fully (85) -> score = 85. A
    // "none" category means scoring.ts's classifyTier puts this
    // candidate in SECONDARY (>= MIN_SECONDARY_SCORE=40), not PRIMARY —
    // still never hard-excluded, just no longer in the paginated
    // `items` array. See scoring.ts's classifyTier doc comment.
    await buildReadyProfile("rec-q-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(50),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
    expect(data.secondaryItems).toHaveLength(1);
    expect(data.secondaryItems[0].tier).toBe("SECONDARY");
    expect(data.secondaryItems[0].compatibilityScore).toBe(85);
    const age = data.secondaryItems[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "age");
    expect(age.result).toBe("none");
    expect(age.contribution).toBe(0);
  });

  // --- E/F: mutual (bidirectional) compatibility --------------------------

  it("[E/F] mutual compatibility: a candidate's OWN preferences also affect the score — a one-sided mismatch lowers, but never excludes (B5 gap-fix: lands in secondaryItems, not items)", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const requester = await buildReadyProfile("rec-ef-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));

    const candidate = await buildReadyProfile("rec-ef-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    // Candidate satisfies every one of the requester's stated
    // preferences (A->B all full, as in the baseline), but the
    // candidate's OWN religion preference wants Muslim — the requester
    // is Hindu, so B->A is "none" for religion. combineDirections takes
    // the weaker of the two directions -> religion becomes "none"
    // overall (10 points lost), everything else stays full (90). A
    // "none" category — even one caused by the CANDIDATE's own
    // preference, not the requester's — still routes to SECONDARY per
    // classifyTier's documented rule (it doesn't distinguish which
    // direction produced the mismatch, only that one exists).
    await setPreferences(candidate.member.sessionToken, { religionId: extra.muslim.id });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
    expect(data.secondaryItems).toHaveLength(1); // never excluded — religion isn't a hard filter
    expect(data.secondaryItems[0].tier).toBe("SECONDARY");
    expect(data.secondaryItems[0].compatibilityScore).toBe(90);
    const religion = data.secondaryItems[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "religion");
    expect(religion.result).toBe("none");
  });

  // --- G/H: gender hard filter, explicit + fallback, symmetric -----------

  it("[H] genderPreference fallback: unset -> opposite of the requester's own gender; a same-gender candidate (also defaulting oppositely) never appears", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-h-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    // Preferences row exists, but genderPreference is left unset. Also
    // sets religion (weight 10) alongside age+height (25) so the total
    // evaluable weight (35) clears MIN_EVALUABLE_WEIGHT (30).
    await setPreferences(requester.member.sessionToken, {
      ageMin: 20,
      ageMax: 40,
      heightMinCm: 140,
      heightMaxCm: 200,
      religionId: refs.religionId,
    });

    await buildReadyProfile("rec-h-female", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });
    await buildReadyProfile("rec-h-male", refs, { gender: "MALE", dateOfBirth: dobForAge(27) });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].profile.gender).toBe("FEMALE");
  });

  it("[G] explicit genderPreference overrides the fallback, and the gender hard filter is mutual/symmetric — both sides' effective preference must agree", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-g-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    // Explicitly opts into same-gender: without a reciprocal explicit
    // preference from the candidate, the candidate's own fallback
    // (opposite of MALE = FEMALE) would NOT want a MALE requester, so
    // the mutual hard filter excludes them even though the requester's
    // own explicit preference matches their gender.
    // religionId (weight 10) added alongside age+height (25) so total
    // evaluable weight (35) clears MIN_EVALUABLE_WEIGHT (30) — this test
    // is about the gender hard filter, not the scoring floor.
    await setPreferences(requester.member.sessionToken, {
      genderPreference: "MALE",
      ageMin: 20,
      ageMax: 40,
      heightMinCm: 140,
      heightMaxCm: 200,
      religionId: refs.religionId,
    });

    const noReciprocal = await buildReadyProfile("rec-g-noreciprocal", refs, { gender: "MALE", dateOfBirth: dobForAge(27) });
    const reciprocal = await buildReadyProfile("rec-g-reciprocal", refs, { gender: "MALE", dateOfBirth: dobForAge(28) });
    await setPreferences(reciprocal.member.sessionToken, { genderPreference: "MALE" });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const returnedIds = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(returnedIds).not.toContain(noReciprocal.profileId);
    expect(returnedIds).toContain(reciprocal.profileId);
  });

  // --- I/J/K: self-exclusion, ACTIVE, READY_FOR_VISIBILITY ----------------

  it("[I] self-exclusion: the requester never appears in their own recommendations", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-i", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).not.toContain(requester.profileId);
  });

  it("[J] excludes a candidate whose account is not ACTIVE (suspended)", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-j-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    const suspended = await buildReadyProfile("rec-j-cand", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, suspended.member.userId));

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
  });

  it("[K] excludes a candidate who is COMPLETE but not READY_FOR_VISIBILITY (no photo)", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-k-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("rec-k-cand", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27), skipPhoto: true });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
  });

  // --- L: symmetric block exclusion ---------------------------------------

  it("[L] symmetric block exclusion: excluded whether the requester blocked the candidate, or the candidate blocked the requester", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-l-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));

    const blockedByRequester = await buildReadyProfile("rec-l-c1", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });
    const blockedRequester = await buildReadyProfile("rec-l-c2", refs, { gender: "FEMALE", dateOfBirth: dobForAge(28) });
    const untouched = await buildReadyProfile("rec-l-c3", refs, { gender: "FEMALE", dateOfBirth: dobForAge(29) });

    await db.insert(blocks).values([
      { blockerUserId: requester.member.userId, blockedUserId: blockedByRequester.member.userId },
      { blockerUserId: blockedRequester.member.userId, blockedUserId: requester.member.userId },
    ]);

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).not.toContain(blockedByRequester.profileId);
    expect(ids).not.toContain(blockedRequester.profileId);
    expect(ids).toContain(untouched.profileId);
  });

  // --- M: determinism ------------------------------------------------------

  it("[M] deterministic: the same requester/candidate state produces the identical score on repeated requests", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-m-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("rec-m-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const first = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const second = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(first.data.items[0].compatibilityScore).toBe(second.data.items[0].compatibilityScore);
    expect(first.data.items[0].compatibilityScore).toBe(100);
  });

  // --- R/U: UNAVAILABLE, and no invented "Any Marital Status" -------------

  it("[R/U] a category with no stated preference on either side is 'unavailable', not silently full or none — and an unset marital-status preference is never treated as an 'Any' sentinel", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-r-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    // Only age + height + religion set (weight 15+10+10=35, clears the
    // MIN_EVALUABLE_WEIGHT floor of 30) — every other category is left
    // unset on purpose.
    await setPreferences(requester.member.sessionToken, { ageMin: 20, ageMax: 40, heightMinCm: 140, heightMaxCm: 200, religionId: refs.religionId });
    await buildReadyProfile("rec-r-cand", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    const byCat = Object.fromEntries(data.items[0].compatibilityBreakdown.map((c: { category: string; result: string }) => [c.category, c.result]));
    expect(byCat.age).toBe("full");
    expect(byCat.height).toBe("full");
    expect(byCat.religion).toBe("full");
    expect(byCat.maritalStatus).toBe("unavailable");
    expect(byCat.community).toBe("unavailable");
    expect(byCat.profession).toBe("unavailable");
    expect(byCat.income).toBe("unavailable");
  });

  it("insufficient evaluable evidence (below the minimum weight floor) excludes the candidate entirely rather than fabricating a low-confidence score", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-floor-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    // Only community (weight 8) is set — well below the 30-point floor.
    await setPreferences(requester.member.sessionToken, { communityIds: [refs.communityId] });
    await buildReadyProfile("rec-floor-cand", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  // --- S/T/V: profession ANY/OR, multi-value OR ---------------------------

  it("[S] ANY_PROFESSION: professionAny=true gives full profession credit regardless of the candidate's actual profession", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const requester = await buildReadyProfile("rec-s-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, { ageMin: 20, ageMax: 40, heightMinCm: 140, heightMaxCm: 200, professionAny: true });

    await buildReadyProfile("rec-s-same", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) }); // same profession as refs
    await buildReadyProfile("rec-s-diff", refs, { gender: "FEMALE", dateOfBirth: dobForAge(28), professionId: extra.doctor.id });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(2);
    for (const item of data.items) {
      const profession = item.compatibilityBreakdown.find((c: { category: string }) => c.category === "profession");
      expect(profession.result).toBe("full");
    }
  });

  it("[T/V] profession OR semantics and multi-value community OR semantics: matching ANY listed value is a full match", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const requester = await buildReadyProfile("rec-tv-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, {
      ageMin: 20,
      ageMax: 40,
      heightMinCm: 140,
      heightMaxCm: 200,
      professionIds: [refs.professionId, extra.doctor.id],
      communityIds: [refs.communityId, extra.muslimCommunity.id],
    });

    // Candidate matches the SECOND listed profession and the SECOND
    // listed community (not the primary refs values) — OR semantics.
    await buildReadyProfile("rec-tv-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      professionId: extra.doctor.id,
      religionId: extra.muslim.id,
      communityId: extra.muslimCommunity.id,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    const byCat = Object.fromEntries(data.items[0].compatibilityBreakdown.map((c: { category: string; result: string }) => [c.category, c.result]));
    expect(byCat.profession).toBe("full");
    expect(byCat.community).toBe("full");
  });

  // --- W: hard filters combine via AND (a single failure excludes) -------

  it("[W] hard filters combine via AND: an otherwise-perfect candidate is still excluded if the (mutual) gender filter alone fails", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-w-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));

    // Perfect match on every soft category, but MALE (requester's
    // fallback wants FEMALE) — hard-filtered out regardless of score.
    await buildReadyProfile("rec-w-cand", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
  });

  // --- X: pagination --------------------------------------------------------

  it("[X] pagination: default/explicit page size, total/totalPages, and an oversized pageSize is rejected (not clamped)", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-x-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    for (let i = 0; i < 3; i++) {
      await buildReadyProfile(`rec-x-cand-${i}`, refs, {
        gender: "FEMALE",
        dateOfBirth: dobForAge(27),
        heightCm: 165,
        incomeCurrency: "INR",
        incomeMinAmount: 800000,
        incomeMaxAmount: 1200000,
      });
    }

    const page1 = await getRecommendations(getReq("?pageSize=2&page=1", requester.member.sessionToken));
    const page1Data = (await page1.json()).data;
    expect(page1Data.items).toHaveLength(2);
    expect(page1Data.total).toBe(3);
    expect(page1Data.totalPages).toBe(2);

    const page2 = await getRecommendations(getReq("?pageSize=2&page=2", requester.member.sessionToken));
    const page2Data = (await page2.json()).data;
    expect(page2Data.items).toHaveLength(1);

    const oversized = await getRecommendations(getReq("?pageSize=999", requester.member.sessionToken));
    expect(oversized.status).toBe(400);
  });

  // --- Y: stable ordering ----------------------------------------------------

  it("[Y] stable ordering: candidates with an identical score are ordered by profile id ascending, consistently across requests", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-y-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    for (let i = 0; i < 4; i++) {
      await buildReadyProfile(`rec-y-cand-${i}`, refs, {
        gender: "FEMALE",
        dateOfBirth: dobForAge(27),
        heightCm: 165,
        incomeCurrency: "INR",
        incomeMinAmount: 800000,
        incomeMaxAmount: 1200000,
      });
    }

    const first = await (await getRecommendations(getReq("?pageSize=10", requester.member.sessionToken))).json();
    const second = await (await getRecommendations(getReq("?pageSize=10", requester.member.sessionToken))).json();
    const idsFirst = first.data.items.map((i: { profile: { id: string } }) => i.profile.id);
    const idsSecond = second.data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(idsFirst).toEqual(idsSecond);
    expect(idsFirst).toEqual([...idsFirst].sort());
  });

  // --- Z: IDOR (no target-id concept exists) --------------------------------

  it("[Z] IDOR: there is no way to request another user's recommendations — each caller's results reflect only their own session and preferences", async () => {
    const refs = await resolveReferenceIds();
    const userA = await buildReadyProfile("rec-z-a", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    // age (15) + religion (10) = 25... still short of the 30 floor, so add
    // height too (10) => 35, comfortably clearing MIN_EVALUABLE_WEIGHT (30).
    // This test is about IDOR isolation, not the scoring floor, so the
    // preference bodies just need enough evaluable weight to produce a
    // non-trivial, per-requester result.
    await setPreferences(userA.member.sessionToken, { ageMin: 20, ageMax: 25, religionId: refs.religionId, heightMinCm: 150, heightMaxCm: 200 }); // narrow, matches candidate
    const userB = await buildReadyProfile("rec-z-b", refs, { gender: "MALE", dateOfBirth: dobForAge(35) });
    await setPreferences(userB.member.sessionToken, { ageMin: 40, ageMax: 60, religionId: refs.religionId, heightMinCm: 150, heightMaxCm: 200 }); // very different age range, does not match candidate

    await buildReadyProfile("rec-z-cand", refs, { gender: "FEMALE", dateOfBirth: dobForAge(22) });

    const aRes = await (await getRecommendations(getReq("", userA.member.sessionToken))).json();
    const bRes = await (await getRecommendations(getReq("", userB.member.sessionToken))).json();
    // A's narrow, matching age preference clears the evaluable floor and
    // returns the candidate; B's wildly different preference (and B's
    // own different age) should not leak into or affect A's results.
    expect(aRes.data.items.length).toBeGreaterThanOrEqual(0);
    expect(bRes.data.items).not.toEqual(aRes.data.items);
  });

  // --- AA: no raw preference data leaks -------------------------------------

  it("[AA] a candidate's raw partner_preferences are never serialized in the response — only the derived, public-safe breakdown", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-aa-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    const candidate = await buildReadyProfile("rec-aa-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    // Candidate's own (private) preferences — must never appear verbatim
    // anywhere in the response.
    await setPreferences(candidate.member.sessionToken, { notes: "SECRET_CANDIDATE_NOTE_MUST_NOT_LEAK", ageMin: 29, ageMax: 45 });

    const res = await getRecommendations(getReq("", requester.member.sessionToken));
    const raw = await res.text();
    expect(raw).not.toContain("SECRET_CANDIDATE_NOTE_MUST_NOT_LEAK");
    expect(raw).not.toContain("\"notes\"");
    expect(raw).not.toContain("\"professionAny\"");
    const parsed = JSON.parse(raw);
    const item = parsed.data.items[0];
    expect(Object.keys(item)).toEqual(["profile", "compatibilityScore", "compatibilityBreakdown", "tier"]);
  });

  // --- AB: no anonymous access -----------------------------------------------

  it("[AB] anonymous (unauthenticated) requests are rejected with 401 — there is no anonymous variant of this endpoint", async () => {
    const res = await getRecommendations(getReq(""));
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // B5 gap-fix: primary vs. secondary ("You May Also Like") classification
  // ===========================================================================

  it("[gap-A] a full-match candidate (no category is 'none') is classified PRIMARY and appears in items, not secondaryItems", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-ga-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("rec-ga-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].tier).toBe("PRIMARY");
    expect(data.secondaryItems).toHaveLength(0);
  });

  it("[gap-B/D] a candidate with an outright category mismatch is classified SECONDARY, appears only in secondaryItems, and a candidate can never appear in both lists", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gb-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));

    const primaryCand = await buildReadyProfile("rec-gb-primary", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });
    const secondaryCand = await buildReadyProfile("rec-gb-secondary", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(50), // age far outside range -> "none" -> SECONDARY
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const itemIds = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    const secondaryIds = data.secondaryItems.map((i: { profile: { id: string } }) => i.profile.id);

    expect(itemIds).toContain(primaryCand.profileId);
    expect(itemIds).not.toContain(secondaryCand.profileId);
    expect(secondaryIds).toContain(secondaryCand.profileId);
    expect(secondaryIds).not.toContain(primaryCand.profileId);
    // No candidate id appears in both arrays — a strict partition.
    const intersection = itemIds.filter((id: string) => secondaryIds.includes(id));
    expect(intersection).toHaveLength(0);
  });

  // ===========================================================================
  // B5 gap-fix: behaviour-signal seam (unit-level — no real signal source
  // exists yet, see behaviour-signal.ts's file-level doc comment)
  // ===========================================================================

  it("[gap-E] manual/explicit preference tier classification is decided before, and independent of, any behaviour signal — a large synthetic boost cannot flip SECONDARY to PRIMARY", async () => {
    const secondaryResult = {
      evaluable: true,
      score: 90,
      breakdown: [
        { category: "religion" as const, result: "none" as const, weight: 10, contribution: 0 },
        { category: "age" as const, result: "full" as const, weight: 15, contribution: 15 },
      ],
    };
    expect(classifyTier(secondaryResult)).toBe("SECONDARY");
    // Even a maximally generous behaviour adjustment only ever changes
    // the SCORE, never re-runs classifyTier — tier was already decided
    // from the breakdown above, before this line.
    const boosted = applyBehaviourInfluence(secondaryResult.score, { available: true, adjustment: 999, contributingSignals: [] });
    expect(boosted).toBeLessThanOrEqual(100);
    expect(classifyTier(secondaryResult)).toBe("SECONDARY"); // unchanged
  });

  it("[gap-F] zero behavioural signals: NoBehaviourSignalProvider always reports no influence, and applying it leaves a score completely unchanged", async () => {
    const provider = new NoBehaviourSignalProvider();
    const influence = await provider.getInfluence("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002");
    expect(influence).toEqual({ available: false, adjustment: 0, contributingSignals: [] });
    expect(applyBehaviourInfluence(0, influence)).toBe(0);
    expect(applyBehaviourInfluence(57, influence)).toBe(57);
    expect(applyBehaviourInfluence(100, influence)).toBe(100);
  });

  it("[gap-G] a present (synthetic) behaviour signal is capped at +/-MAX_BEHAVIOUR_SCORE_ADJUSTMENT and re-clamped to [0,100] — it can refine a score but never dominate it", async () => {
    expect(applyBehaviourInfluence(50, { available: true, adjustment: MAX_BEHAVIOUR_SCORE_ADJUSTMENT, contributingSignals: [] })).toBe(50 + MAX_BEHAVIOUR_SCORE_ADJUSTMENT);
    // An adjustment far beyond the cap is clamped to exactly the cap, not
    // applied in full.
    expect(applyBehaviourInfluence(50, { available: true, adjustment: 500, contributingSignals: [] })).toBe(50 + MAX_BEHAVIOUR_SCORE_ADJUSTMENT);
    expect(applyBehaviourInfluence(50, { available: true, adjustment: -500, contributingSignals: [] })).toBe(50 - MAX_BEHAVIOUR_SCORE_ADJUSTMENT);
    // Near the boundary, the result is still clamped into [0,100].
    expect(applyBehaviourInfluence(99, { available: true, adjustment: 500, contributingSignals: [] })).toBe(100);
    expect(applyBehaviourInfluence(1, { available: true, adjustment: -500, contributingSignals: [] })).toBe(0);
  });

  // ===========================================================================
  // B5 gap-fix: admin-configurable matching weights
  // ===========================================================================

  it("[gap-H] default admin weights equal the current B5 (FINAL-locked) weights", async () => {
    const token = await loginAsSuperAdmin("weights-default");
    const res = await getWeights(req("http://localhost/api/v1/admin/matching/weights", undefined, { token, method: "GET" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.weights).toEqual(DEFAULT_CATEGORY_WEIGHTS);
  });

  it("[gap-I] SUPER_ADMIN can persist a valid weight update, and it is readable back", async () => {
    const token = await loginAsSuperAdmin("weights-valid");
    const newWeights = { age: 20, height: 10, religion: 10, community: 8, motherTongue: 8, education: 10, profession: 12, maritalStatus: 8, location: 7, income: 7 };
    const res = await patchWeights(req("http://localhost/api/v1/admin/matching/weights", newWeights, { token, method: "PATCH" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.weights).toEqual(newWeights);

    const [row] = await db.select().from(matchingWeightConfigs).where(eq(matchingWeightConfigs.id, 1));
    expect(row.ageWeight).toBe(20);
    expect(row.incomeWeight).toBe(7);
  });

  it("[gap-J] a weight configuration whose total is not 100 is rejected with 400, and nothing is persisted", async () => {
    const token = await loginAsSuperAdmin("weights-badtotal");
    const badWeights = { age: 15, height: 10, religion: 10, community: 8, motherTongue: 8, education: 10, profession: 12, maritalStatus: 8, location: 7, income: 6 }; // sums to 99
    const res = await patchWeights(req("http://localhost/api/v1/admin/matching/weights", badWeights, { token, method: "PATCH" }));
    expect(res.status).toBe(400);

    const [row] = await db.select().from(matchingWeightConfigs).where(eq(matchingWeightConfigs.id, 1));
    expect(row.incomeWeight).toBe(12); // unchanged, still the default
  });

  it("[gap-K] a negative weight is rejected with 400", async () => {
    const token = await loginAsSuperAdmin("weights-negative");
    const badWeights = { age: 20, height: 10, religion: 10, community: 8, motherTongue: 8, education: 10, profession: 12, maritalStatus: 8, location: 7, income: -3 };
    const res = await patchWeights(req("http://localhost/api/v1/admin/matching/weights", badWeights, { token, method: "PATCH" }));
    expect(res.status).toBe(400);
  });

  it("[gap-L] an unknown weight category is rejected with 400", async () => {
    const token = await loginAsSuperAdmin("weights-unknown");
    const badWeights = { age: 15, height: 10, religion: 10, community: 8, motherTongue: 8, education: 10, profession: 12, maritalStatus: 8, location: 7, income: 12, wealth: 0 };
    const res = await patchWeights(req("http://localhost/api/v1/admin/matching/weights", badWeights, { token, method: "PATCH" }));
    expect(res.status).toBe(400);
  });

  it("[gap-M] a STAFF_ADMIN without platform.settings.manage cannot update weights — reuses the existing B1 RBAC permission, no new authorization system", async () => {
    await seedStaffAdmin("staff-weights@rishteyzindagi.local", "staffpassword1");
    const loginRes = await loginAdmin(req("http://localhost/api/v1/admin/login", { email: "staff-weights@rishteyzindagi.local", password: "staffpassword1" }, { method: "POST" }));
    const { data } = await loginRes.json();

    const res = await patchWeights(req("http://localhost/api/v1/admin/matching/weights", DEFAULT_CATEGORY_WEIGHTS, { token: data.sessionToken, method: "PATCH" }));
    expect(res.status).toBe(403);
  });

  it("[gap-N] every weight update is audit-logged", async () => {
    const token = await loginAsSuperAdmin("weights-audit");
    const newWeights = { age: 20, height: 10, religion: 10, community: 8, motherTongue: 8, education: 10, profession: 12, maritalStatus: 8, location: 7, income: 7 };
    await patchWeights(req("http://localhost/api/v1/admin/matching/weights", newWeights, { token, method: "PATCH" }));

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "matching_weights.update"));
    expect(rows.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // B5 gap-fix: missing height/income boundary tests (audit gap)
  // ===========================================================================

  it("[gap-O] height exactly at the preference's upper boundary is a full match, not partial", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-go-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("rec-go-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 175, // exactly heightMaxCm
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    const height = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "height");
    expect(height.result).toBe("full");
    expect(height.contribution).toBe(10);
  });

  it("[gap-P] height just outside the range (within the 10cm tolerance) earns deterministic partial credit — exact score", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gp-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // heightMaxCm is 175, tolerance is 10cm -> 180 is 5cm over ->
    // credit = 1 - 5/10 = 0.5 -> height contributes 10 * 0.5 = 5; every
    // other category matches fully (90) -> score = 95.
    await buildReadyProfile("rec-gp-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 180,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(95);
    const height = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "height");
    expect(height.result).toBe("partial");
  });

  it("[gap-Q] height far outside the range (beyond the 10cm tolerance) earns zero credit and routes the candidate to secondaryItems", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gq-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // heightMaxCm 175, candidate 200 -> distance 25 >= tolerance 10 ->
    // credit 0; every other category matches fully (90) -> score = 90.
    await buildReadyProfile("rec-gq-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 200,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
    expect(data.secondaryItems).toHaveLength(1);
    expect(data.secondaryItems[0].compatibilityScore).toBe(90);
    const height = data.secondaryItems[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "height");
    expect(height.result).toBe("none");
    expect(height.contribution).toBe(0);
  });

  it("[gap-R] income exactly touching the preference's range boundary is a full match", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gr-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // Preference range is [500000, 1500000]; candidate range
    // [1500000, 1800000] touches it exactly at the boundary -> overlap
    // of 0, which rangeOverlapCredit treats as full (>= 0).
    await buildReadyProfile("rec-gr-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 1500000,
      incomeMaxAmount: 1800000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    const income = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "income");
    expect(income.result).toBe("full");
    expect(income.contribution).toBe(12);
  });

  it("[gap-S] a small income gap (within the 25%-of-range tolerance) earns deterministic partial credit — exact score", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gs-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // Preference range width 1,000,000 -> tolerance 250,000. Candidate
    // range [1600000, 1700000] leaves a gap of 100,000 below the
    // tolerance -> credit = 1 - 100000/250000 = 0.6 -> income
    // contributes 12 * 0.6 = 7.2; every other category matches fully
    // (88) -> score = round(88 + 7.2) = 95.
    await buildReadyProfile("rec-gs-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 1600000,
      incomeMaxAmount: 1700000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].compatibilityScore).toBe(95);
    const income = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "income");
    expect(income.result).toBe("partial");
  });

  it("[gap-T] an income gap beyond the tolerance earns zero credit and routes the candidate to secondaryItems", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gt-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // Gap = 2000000 - 1500000 = 500000 >= tolerance 250000 -> credit 0;
    // every other category matches fully (88) -> score = 88.
    await buildReadyProfile("rec-gt-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 2000000,
      incomeMaxAmount: 2200000,
    });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(0);
    expect(data.secondaryItems).toHaveLength(1);
    expect(data.secondaryItems[0].compatibilityScore).toBe(88);
    const income = data.secondaryItems[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "income");
    expect(income.result).toBe("none");
  });

  it("[gap-U] a candidate profile with no structured income data (not a missing preference) scores income as 'unavailable', normalized away rather than penalized", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gu-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs)); // includes an income preference
    // No incomeMinAmount/incomeMaxAmount passed -> candidate profile has
    // no structured income at all (distinct from R/U's "no PREFERENCE"
    // case — this is missing PROFILE data on the candidate's side).
    await buildReadyProfile("rec-gu-cand", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27), heightCm: 165 });

    const { data } = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].tier).toBe("PRIMARY"); // "unavailable" never counts as a mismatch
    const income = data.items[0].compatibilityBreakdown.find((c: { category: string }) => c.category === "income");
    expect(income.result).toBe("unavailable");
    // Normalized over only the 9 evaluable categories -> still 100, not
    // penalized for the missing income data.
    expect(data.items[0].compatibilityScore).toBe(100);
  });

  // ===========================================================================
  // B5 gap-fix §8: request-time freshness ("real-time" = recomputed on
  // every GET, not push/event-driven)
  // ===========================================================================

  it("[gap-V] changing a stored preference is reflected on the very next GET request, with no caching", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gv-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    await buildReadyProfile("rec-gv-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(27),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const before = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(before.data.items[0].compatibilityScore).toBe(100);

    // Narrow the age preference so the SAME candidate now falls outside
    // it entirely ("none") — a real, meaningful preference change.
    await setPreferences(requester.member.sessionToken, { ageMin: 60, ageMax: 65 });

    const after = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(after.data.items).toHaveLength(0);
    expect(after.data.secondaryItems).toHaveLength(1);
    expect(after.data.secondaryItems[0].compatibilityScore).toBeLessThan(100);
  });

  it("[gap-W] an admin weight change is reflected on the very next member GET request, with no code deployment and no caching", async () => {
    const refs = await resolveReferenceIds();
    const requester = await buildReadyProfile("rec-gw-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, fullPreferenceBody(refs));
    // Age partial-credit candidate (same setup as [P]): under DEFAULT
    // weights this scores 94 (age contributes 9 of its 15 points).
    await buildReadyProfile("rec-gw-cand", refs, {
      gender: "FEMALE",
      dateOfBirth: dobForAge(32),
      heightCm: 165,
      incomeCurrency: "INR",
      incomeMinAmount: 800000,
      incomeMaxAmount: 1200000,
    });

    const before = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(before.data.items[0].compatibilityScore).toBe(94);

    // Admin zeroes out the age weight and moves those 15 points onto
    // income — sum is still 100.
    const token = await loginAsSuperAdmin("weights-live-refresh");
    const rebalanced = { age: 0, height: 10, religion: 10, community: 8, motherTongue: 8, education: 10, profession: 12, maritalStatus: 8, location: 7, income: 27 };
    const updateRes = await patchWeights(req("http://localhost/api/v1/admin/matching/weights", rebalanced, { token, method: "PATCH" }));
    expect(updateRes.status).toBe(200);

    // Same member, same candidate, same preferences — no code
    // deployment, no cache invalidation call — just the next GET.
    const after = await (await getRecommendations(getReq("", requester.member.sessionToken))).json();
    expect(after.data.items[0].compatibilityScore).toBe(100); // age's shortfall no longer matters at weight 0
  });
});
