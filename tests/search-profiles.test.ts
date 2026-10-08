/**
 * B4: deterministic profile search — filters (§9), AND/OR semantics
 * (§10), eligibility (§11), self-exclusion (§12), anonymous/authenticated
 * gating (§13/§14/§16), pagination (§17), sorting (§18), age/DOB (§20),
 * income/currency (§21), location (§22), validation (§23), and IDOR/
 * visibility-bypass coverage (§27).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function getReq(query: string, token?: string) {
  return req(`http://localhost/api/v1/search/profiles${query}`, undefined, { token, method: "GET" });
}

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

async function secondReferenceSet(refs: ReferenceIds) {
  const [religions, educations, professions, maritalStatuses, countries] = await Promise.all([
    referenceRepo.listReligions(),
    referenceRepo.listEducations(),
    referenceRepo.listProfessions(),
    referenceRepo.listMaritalStatuses(),
    referenceRepo.listCountries(),
  ]);
  const muslim = religions.find((r) => r.name === "Muslim")!;
  const christian = religions.find((r) => r.name === "Christian")!;
  const mastersEng = educations.find((e) => e.name === "Master's — Engineering")!;
  const doctor = professions.find((p) => p.name === "Doctor")!;
  const divorced = maritalStatuses.find((m) => m.name === "Divorced")!;
  const uae = countries.find((c) => c.name === "United Arab Emirates")!;
  const dubai = await referenceRepo.findOrCreateCity("Dubai", uae.id);
  const delhi = await referenceRepo.findOrCreateCity("Delhi", refs.countryId);
  const muslimCommunity = await referenceRepo.findOrCreateCommunity("Test Community", muslim.id);
  const christianCommunity = await referenceRepo.findOrCreateCommunity("Test Community", christian.id);
  return { muslim, christian, mastersEng, doctor, divorced, uae, dubai, delhi, muslimCommunity, christianCommunity };
}

describe("Profile search", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("only returns READY_FOR_VISIBILITY profiles — an incomplete profile never appears", async () => {
    const refs = await resolveReferenceIds();
    const ready = await buildReadyProfile("search-ready", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });
    await buildReadyProfile("search-incomplete", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27), skipPhoto: true });

    const res = await searchProfiles(getReq("?gender=FEMALE"));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.total).toBe(1);
    expect(data.items[0].profile.id).toBe(ready.profileId);
  });

  it("excludes profiles whose account is not ACTIVE (suspended)", async () => {
    const refs = await resolveReferenceIds();
    const active = await buildReadyProfile("search-active", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    const suspended = await buildReadyProfile("search-suspended", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, suspended.member.userId));

    const res = await searchProfiles(getReq("?gender=MALE"));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toContain(active.profileId);
    expect(ids).not.toContain(suspended.profileId);
  });

  it("self-exclusion: a signed-in searcher never sees their own profile in results", async () => {
    const refs = await resolveReferenceIds();
    const searcher = await buildReadyProfile("search-self", refs, { gender: "FEMALE", dateOfBirth: dobForAge(28) });
    const other = await buildReadyProfile("search-self-other", refs, { gender: "FEMALE", dateOfBirth: dobForAge(28) });

    const res = await searchProfiles(getReq("?gender=FEMALE", searcher.member.sessionToken));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).not.toContain(searcher.profileId);
    expect(ids).toContain(other.profileId);
  });

  it("filters by age range using DOB boundaries (inclusive)", async () => {
    const refs = await resolveReferenceIds();
    const age30 = await buildReadyProfile("search-age30", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    const age40 = await buildReadyProfile("search-age40", refs, { gender: "MALE", dateOfBirth: dobForAge(40) });
    const age50 = await buildReadyProfile("search-age50", refs, { gender: "MALE", dateOfBirth: dobForAge(50) });

    const res = await searchProfiles(getReq("?minAge=30&maxAge=40"));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toEqual(expect.arrayContaining([age30.profileId, age40.profileId]));
    expect(ids).not.toContain(age50.profileId);
  });

  it("religion filter uses OR semantics across multiple ids", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const hindu = await buildReadyProfile("search-hindu", refs, { gender: "MALE", dateOfBirth: dobForAge(29), religionId: refs.religionId });
    const muslim = await buildReadyProfile("search-muslim", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      religionId: extra.muslim.id,
      communityId: extra.muslimCommunity.id,
    });
    const christian = await buildReadyProfile("search-christian", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      religionId: extra.christian.id,
      communityId: extra.christianCommunity.id,
    });

    const res = await searchProfiles(getReq(`?religionIds=${refs.religionId},${extra.muslim.id}`));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toEqual(expect.arrayContaining([hindu.profileId, muslim.profileId]));
    expect(ids).not.toContain(christian.profileId);
  });

  it("profession filter is OR across ids, and ANY_PROFESSION (anyProfession=true) ignores the professionIds restriction entirely", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const engineer = await buildReadyProfile("search-engineer", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    const doctor = await buildReadyProfile("search-doctor", refs, { gender: "MALE", dateOfBirth: dobForAge(29), professionId: extra.doctor.id });

    const filteredRes = await searchProfiles(getReq(`?professionIds=${extra.doctor.id}`));
    const { data: filteredData } = await filteredRes.json();
    const filteredIds = filteredData.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(filteredIds).toContain(doctor.profileId);
    expect(filteredIds).not.toContain(engineer.profileId);

    const anyRes = await searchProfiles(getReq(`?professionIds=${extra.doctor.id}&anyProfession=true`));
    const { data: anyData } = await anyRes.json();
    const anyIds = anyData.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(anyIds).toEqual(expect.arrayContaining([doctor.profileId, engineer.profileId]));
  });

  it("marital status: no 'Any' sentinel exists — supplying no filter returns every marital status, supplying one restricts", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const neverMarried = await buildReadyProfile("search-nevermarried", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    const divorced = await buildReadyProfile("search-divorced", refs, { gender: "MALE", dateOfBirth: dobForAge(29), maritalStatusId: extra.divorced.id });

    const unfiltered = await searchProfiles(getReq(""));
    const { data: unfilteredData } = await unfiltered.json();
    const unfilteredIds = unfilteredData.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(unfilteredIds).toEqual(expect.arrayContaining([neverMarried.profileId, divorced.profileId]));

    const filtered = await searchProfiles(getReq(`?maritalStatusIds=${extra.divorced.id}`));
    const { data: filteredData } = await filtered.json();
    const filteredIds = filteredData.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(filteredIds).toContain(divorced.profileId);
    expect(filteredIds).not.toContain(neverMarried.profileId);
  });

  it("location: country and city filters combine as AND, structured equality (not fuzzy)", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const mumbai = await buildReadyProfile("search-mumbai", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    const delhiProfile = await buildReadyProfile("search-delhi", refs, { gender: "MALE", dateOfBirth: dobForAge(29), cityId: extra.delhi.id });
    const dubaiProfile = await buildReadyProfile("search-dubai", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      countryId: extra.uae.id,
      cityId: extra.dubai.id,
    });

    const res = await searchProfiles(getReq(`?countryId=${refs.countryId}&cityId=${extra.delhi.id}`));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toEqual([delhiProfile.profileId]);
    expect(ids).not.toContain(mumbai.profileId);
    expect(ids).not.toContain(dubaiProfile.profileId);
  });

  it("height range filter", async () => {
    const refs = await resolveReferenceIds();
    const shortProfile = await buildReadyProfile("search-short", refs, { gender: "MALE", dateOfBirth: dobForAge(29), heightCm: 160 });
    const tallProfile = await buildReadyProfile("search-tall", refs, { gender: "MALE", dateOfBirth: dobForAge(29), heightCm: 190 });

    const res = await searchProfiles(getReq("?minHeightCm=185&maxHeightCm=200"));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toContain(tallProfile.profileId);
    expect(ids).not.toContain(shortProfile.profileId);
  });

  it("income range respects currency — never compares across currencies, and excludes profiles with no structured income", async () => {
    const refs = await resolveReferenceIds();
    const inr = await buildReadyProfile("search-inr", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      incomeCurrency: "INR",
      incomeMinAmount: 1000000,
      incomeMaxAmount: 1500000,
    });
    const usd = await buildReadyProfile("search-usd", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      incomeCurrency: "USD",
      incomeMinAmount: 1200000, // numerically within the INR search range, but a different currency
      incomeMaxAmount: 1500000,
    });
    const noStructuredIncome = await buildReadyProfile("search-noincome", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });

    const res = await searchProfiles(getReq("?minIncome=1100000&maxIncome=1400000&incomeCurrency=INR"));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toContain(inr.profileId);
    expect(ids).not.toContain(usd.profileId);
    expect(ids).not.toContain(noStructuredIncome.profileId);
  });

  it("combined AND across categories: age AND religion AND country all apply together", async () => {
    const refs = await resolveReferenceIds();
    const extra = await secondReferenceSet(refs);
    const matches = await buildReadyProfile("search-and-match", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    const wrongAge = await buildReadyProfile("search-and-wrongage", refs, { gender: "MALE", dateOfBirth: dobForAge(50) });
    const wrongReligion = await buildReadyProfile("search-and-wrongreligion", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      religionId: extra.muslim.id,
      communityId: extra.muslimCommunity.id,
    });

    const res = await searchProfiles(getReq(`?minAge=25&maxAge=35&religionIds=${refs.religionId}&countryId=${refs.countryId}`));
    const { data } = await res.json();
    const ids = data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(ids).toEqual([matches.profileId]);
    expect(ids).not.toContain(wrongAge.profileId);
    expect(ids).not.toContain(wrongReligion.profileId);
  });

  it("pagination: page/pageSize/total/totalPages, and pageSize is capped at the server-side maximum", async () => {
    const refs = await resolveReferenceIds();
    for (let i = 0; i < 5; i++) {
      await buildReadyProfile(`search-page-${i}`, refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    }

    const page1 = await searchProfiles(getReq("?gender=MALE&pageSize=2&page=1"));
    const { data: page1Data } = await page1.json();
    expect(page1Data.items.length).toBe(2);
    expect(page1Data.total).toBe(5);
    expect(page1Data.totalPages).toBe(3);

    const page2 = await searchProfiles(getReq("?gender=MALE&pageSize=2&page=2"));
    const { data: page2Data } = await page2.json();
    const page1Ids = page1Data.items.map((i: { profile: { id: string } }) => i.profile.id);
    const page2Ids = page2Data.items.map((i: { profile: { id: string } }) => i.profile.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);

    const oversizedRes = await searchProfiles(getReq("?pageSize=999"));
    expect(oversizedRes.status).toBe(400);
  });

  it("sorting is stable: the same query repeated returns results in the same order", async () => {
    const refs = await resolveReferenceIds();
    for (let i = 0; i < 4; i++) {
      await buildReadyProfile(`search-stable-${i}`, refs, { gender: "FEMALE", dateOfBirth: dobForAge(29) });
    }

    const first = await searchProfiles(getReq("?gender=FEMALE&pageSize=10"));
    const second = await searchProfiles(getReq("?gender=FEMALE&pageSize=10"));
    const { data: firstData } = await first.json();
    const { data: secondData } = await second.json();
    expect(firstData.items.map((i: { profile: { id: string } }) => i.profile.id)).toEqual(
      secondData.items.map((i: { profile: { id: string } }) => i.profile.id)
    );
  });

  it("anonymous results use the gated view (no photo URL, generic name); authenticated results get the fuller view with a verification badge", async () => {
    const refs = await resolveReferenceIds();
    const searcher = await buildReadyProfile("search-audience-viewer", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await buildReadyProfile("search-audience-target", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });

    const anonRes = await searchProfiles(getReq("?gender=FEMALE"));
    const { data: anonData } = await anonRes.json();
    expect(anonData.items[0].audience).toBe("anonymous");
    expect(anonData.items[0].profile.displayName).toBe("Member Profile");
    expect(anonData.items[0].profile.photos).toBeUndefined();
    expect(JSON.stringify(anonData.items[0].profile)).not.toMatch(/@example\.com/);

    const authRes = await searchProfiles(getReq("?gender=FEMALE", searcher.member.sessionToken));
    const { data: authData } = await authRes.json();
    expect(authData.items[0].audience).toBe("authenticated");
    expect(authData.items[0].profile.displayName).toBeTruthy();
    expect(authData.items[0].profile.displayName).not.toBe("Member Profile");
    expect(authData.items[0].profile.verificationStatus).toBe("UNVERIFIED");
    expect(authData.items[0].profile.photos[0].url).toMatch(/^\/api\/v1\/profiles\/photos\/.+\/file$/);
  });

  it("validation: rejects minAge > maxAge, an unknown reference id, an invalid gender, and an unsupported query key", async () => {
    const badRange = await searchProfiles(getReq("?minAge=40&maxAge=20"));
    expect(badRange.status).toBe(400);

    const badRef = await searchProfiles(getReq("?religionIds=00000000-0000-0000-0000-000000000000"));
    expect(badRef.status).toBe(400);

    const badGender = await searchProfiles(getReq("?gender=OTHER"));
    expect(badGender.status).toBe(400);

    const badKey = await searchProfiles(getReq("?unknownFilter=1"));
    expect(badKey.status).toBe(400);

    const missingCurrency = await searchProfiles(getReq("?minIncome=100000"));
    expect(missingCurrency.status).toBe(400);
  });
});
