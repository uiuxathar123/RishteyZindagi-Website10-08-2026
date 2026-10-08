/**
 * B8: membership plan catalog + region/currency selection
 * (India -> INR, Gulf [UAE/Saudi/Qatar/Kuwait] -> USD, default -> INR).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as listPlans } from "@/app/api/v1/membership-plans/route";
import { GET as listPlansForMyRegion } from "@/app/api/v1/membership-plans/me/route";
import { PATCH as updateProfile } from "@/app/api/v1/profiles/me/route";
import { db } from "@/server/db/client";
import { countries } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, createVerifiedMember, type ReferenceIds } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}

async function countryIdByIso(iso: string): Promise<string> {
  const [row] = await db.select().from(countries).where(eq(countries.isoCode, iso)).limit(1);
  if (!row) throw new Error(`Seeded country with iso "${iso}" not found — did db:seed run against the test DB?`);
  return row.id;
}

describe("B8 membership plan catalog + region currency", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  it("[plans-public-list] returns all 8 active plans (4 tiers x 2 currencies) with no auth required", async () => {
    const res = await listPlans(greq("http://localhost/api/v1/membership-plans"));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.plans.length).toBeGreaterThanOrEqual(8);
    const codes = data.plans.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["PLAN_7DAY_INR", "PLAN_7DAY_USD", "PLAN_MONTHLY_INR", "PLAN_6MONTH_USD"]));
  });

  it("[plans-currency-filter] ?currency=USD returns only USD plans", async () => {
    const res = await listPlans(greq("http://localhost/api/v1/membership-plans?currency=USD"));
    const { data } = await res.json();
    expect(data.plans.length).toBeGreaterThanOrEqual(4);
    expect(data.plans.every((p: { currency: string }) => p.currency === "USD")).toBe(true);
  });

  it("[plans-region-india-inr] a member with country=India resolves to INR plans", async () => {
    const member = await buildReadyProfile("plan-india", refs, { gender: "FEMALE" });
    const res = await listPlansForMyRegion(greq("http://localhost/api/v1/membership-plans/me", member.member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.currency).toBe("INR");
    expect(data.plans.every((p: { currency: string }) => p.currency === "INR")).toBe(true);
  });

  it("[plans-region-gulf-usd] a member with country=UAE/Saudi/Qatar/Kuwait resolves to USD plans", async () => {
    for (const iso of ["AE", "SA", "QA", "KW"]) {
      // Not every Gulf country has a seeded city (only AE/SA do — see
      // seed.ts's CITIES array), and region.ts's currency resolution only
      // reads profiles.countryId (never cityId — see its own file
      // comment), so this builds a normal (India-default) ready profile
      // first and then re-points just the countryId, exactly like
      // [plans-region-updates-with-profile] below — never sending a
      // cityId that wouldn't belong to the new country.
      const countryId = await countryIdByIso(iso);
      const member = await buildReadyProfile(`plan-gulf-${iso}`, refs, { gender: "FEMALE" });
      await updateProfile(req("http://localhost/api/v1/profiles/me", { countryId }, { token: member.member.sessionToken, method: "PATCH" }));
      const res = await listPlansForMyRegion(greq("http://localhost/api/v1/membership-plans/me", member.member.sessionToken));
      const { data } = await res.json();
      expect(data.currency).toBe("USD");
    }
  });

  it("[plans-region-default-no-profile] a member with no profile at all resolves to the documented default (INR)", async () => {
    const bare = await createVerifiedMember("plan-noprofile");
    const res = await listPlansForMyRegion(greq("http://localhost/api/v1/membership-plans/me", bare.sessionToken));
    const { data } = await res.json();
    expect(data.currency).toBe("INR");
  });

  it("[plans-region-updates-with-profile] changing a profile's country changes the resolved currency on the next call", async () => {
    const member = await buildReadyProfile("plan-switch", refs, { gender: "FEMALE" }); // defaults to India
    const before = await (await listPlansForMyRegion(greq("http://localhost/api/v1/membership-plans/me", member.member.sessionToken))).json();
    expect(before.data.currency).toBe("INR");

    const uaeCountryId = await countryIdByIso("AE");
    await updateProfile(req("http://localhost/api/v1/profiles/me", { countryId: uaeCountryId }, { token: member.member.sessionToken, method: "PATCH" }));

    const after = await (await listPlansForMyRegion(greq("http://localhost/api/v1/membership-plans/me", member.member.sessionToken))).json();
    expect(after.data.currency).toBe("USD");
  });
});
