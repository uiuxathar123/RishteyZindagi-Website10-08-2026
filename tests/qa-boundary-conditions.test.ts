/**
 * B12 QA: exact boundary-value coverage for §8/§9 of the QA checklist
 * (age/height/income range filters) that B4's own search-profiles.test.ts
 * exercised only with wide margins (e.g. minAge=30/maxAge=40 vs. a
 * candidate at 50 — never the exact one-below/one-above edge). Every
 * business rule here (inclusive range, DOB-based age math, overlap-style
 * income comparison, NULL-excludes-naturally) is pre-existing, frozen
 * B4 `search.repository.ts`/`age-range.ts` behavior — this file adds
 * coverage only, touches zero production code.
 *
 * Mirrors search-profiles.test.ts's own fixtures/helpers exactly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, disableAdvancedSearchGateForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile } from "./helpers/profile-fixtures";

function getReq(query: string, token?: string) {
  return req(`http://localhost/api/v1/search/profiles${query}`, undefined, { token, method: "GET" });
}

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

async function idsFrom(res: Response): Promise<string[]> {
  const { data } = await res.json();
  return data.items.map((i: { profile: { id: string } }) => i.profile.id);
}

describe("QA boundary conditions — search range filters", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await disableAdvancedSearchGateForTests(); // B18: these suites test filter mechanics; the gate has its own tests
    __resetRateLimitsForTests();
  });

  it("[boundary-age-min] minAge=30: age 29 excluded, age 30 (exact boundary) included", async () => {
    const refs = await resolveReferenceIds();
    const below = await buildReadyProfile("qa-age-min-below", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    const exact = await buildReadyProfile("qa-age-min-exact", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });

    const ids = await idsFrom(await searchProfiles(getReq("?minAge=30")));
    expect(ids).not.toContain(below.profileId);
    expect(ids).toContain(exact.profileId);
  });

  it("[boundary-age-max] maxAge=40: age 40 (exact boundary) included, age 41 excluded", async () => {
    const refs = await resolveReferenceIds();
    const exact = await buildReadyProfile("qa-age-max-exact", refs, { gender: "MALE", dateOfBirth: dobForAge(40) });
    const above = await buildReadyProfile("qa-age-max-above", refs, { gender: "MALE", dateOfBirth: dobForAge(41) });

    const ids = await idsFrom(await searchProfiles(getReq("?maxAge=40")));
    expect(ids).toContain(exact.profileId);
    expect(ids).not.toContain(above.profileId);
  });

  it("[boundary-height-min] minHeightCm=170: 169cm excluded, 170cm (exact boundary) included", async () => {
    const refs = await resolveReferenceIds();
    const below = await buildReadyProfile("qa-height-min-below", refs, { gender: "MALE", dateOfBirth: dobForAge(29), heightCm: 169 });
    const exact = await buildReadyProfile("qa-height-min-exact", refs, { gender: "MALE", dateOfBirth: dobForAge(29), heightCm: 170 });

    const ids = await idsFrom(await searchProfiles(getReq("?minHeightCm=170")));
    expect(ids).not.toContain(below.profileId);
    expect(ids).toContain(exact.profileId);
  });

  it("[boundary-height-max] maxHeightCm=180: 180cm (exact boundary) included, 181cm excluded", async () => {
    const refs = await resolveReferenceIds();
    const exact = await buildReadyProfile("qa-height-max-exact", refs, { gender: "MALE", dateOfBirth: dobForAge(29), heightCm: 180 });
    const above = await buildReadyProfile("qa-height-max-above", refs, { gender: "MALE", dateOfBirth: dobForAge(29), heightCm: 181 });

    const ids = await idsFrom(await searchProfiles(getReq("?maxHeightCm=180")));
    expect(ids).toContain(exact.profileId);
    expect(ids).not.toContain(above.profileId);
  });

  it("[boundary-height-missing-excluded] a candidate with no heightCm set is naturally excluded by a height filter, never crashes or false-matches", async () => {
    const refs = await resolveReferenceIds();
    const noHeight = await buildReadyProfile("qa-height-missing", refs, { gender: "MALE", dateOfBirth: dobForAge(29) });
    // buildReadyProfile always writes a heightCm default (170) — directly
    // null it out at the DB level to exercise the genuinely-missing-data
    // case (a real candidate who never filled in height), same technique
    // the income "no structured income" case gets for free via the
    // fixture's own conditional income fields.
    await db.update(profiles).set({ heightCm: null }).where(eq(profiles.id, noHeight.profileId));

    const res = await searchProfiles(getReq("?minHeightCm=150&maxHeightCm=200"));
    expect(res.status).toBe(200);
    const ids = await idsFrom(res);
    expect(ids).not.toContain(noHeight.profileId);
  });

  it("[boundary-income-min] minIncome=1000000 INR: candidate whose incomeMaxAmount is exactly one below is excluded, exactly at the boundary is included", async () => {
    const refs = await resolveReferenceIds();
    const below = await buildReadyProfile("qa-income-min-below", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      incomeCurrency: "INR",
      incomeMinAmount: 500000,
      incomeMaxAmount: 999999,
    });
    const exact = await buildReadyProfile("qa-income-min-exact", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      incomeCurrency: "INR",
      incomeMinAmount: 900000,
      incomeMaxAmount: 1000000,
    });

    const ids = await idsFrom(await searchProfiles(getReq("?minIncome=1000000&incomeCurrency=INR")));
    expect(ids).not.toContain(below.profileId);
    expect(ids).toContain(exact.profileId);
  });

  it("[boundary-income-max] maxIncome=1400000 INR: candidate whose incomeMinAmount is exactly at the boundary is included, one above is excluded", async () => {
    const refs = await resolveReferenceIds();
    const exact = await buildReadyProfile("qa-income-max-exact", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      incomeCurrency: "INR",
      incomeMinAmount: 1400000,
      incomeMaxAmount: 1500000,
    });
    const above = await buildReadyProfile("qa-income-max-above", refs, {
      gender: "MALE",
      dateOfBirth: dobForAge(29),
      incomeCurrency: "INR",
      incomeMinAmount: 1400001,
      incomeMaxAmount: 1500000,
    });

    const ids = await idsFrom(await searchProfiles(getReq("?maxIncome=1400000&incomeCurrency=INR")));
    expect(ids).toContain(exact.profileId);
    expect(ids).not.toContain(above.profileId);
  });
});
