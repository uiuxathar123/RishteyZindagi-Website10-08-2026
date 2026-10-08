/**
 * B3: public reference/lookup data used to populate profile onboarding
 * forms — no authentication required, no PII.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getReferenceOptions } from "@/app/api/v1/reference/profile-options/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetOtpConfigForTests } from "./helpers/reset-db";

describe("Profile reference options", () => {
  beforeEach(async () => {
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("returns the seeded controlled lookup lists without requiring authentication", async () => {
    const res = await getReferenceOptions(new NextRequest("http://localhost/api/v1/reference/profile-options"));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.religions.length).toBeGreaterThan(0);
    expect(data.motherTongues.length).toBeGreaterThan(0);
    expect(data.educations.length).toBeGreaterThan(0);
    expect(data.professions.length).toBeGreaterThan(0);
    expect(data.maritalStatuses.length).toBeGreaterThan(0);
    expect(data.countries.some((c: { name: string }) => c.name === "India")).toBe(true);
    expect(data.cities).toBeUndefined();
  });

  it("includes cities for a country and communities for a religion when their ids are supplied", async () => {
    const optionsRes = await getReferenceOptions(new NextRequest("http://localhost/api/v1/reference/profile-options"));
    const { data: options } = await optionsRes.json();
    const india = options.countries.find((c: { name: string; id: string }) => c.name === "India");
    const hindu = options.religions.find((r: { name: string; id: string }) => r.name === "Hindu");

    const res = await getReferenceOptions(
      new NextRequest(`http://localhost/api/v1/reference/profile-options?countryId=${india.id}&religionId=${hindu.id}`)
    );
    const { data } = await res.json();
    expect(data.cities.some((c: { name: string }) => c.name === "Mumbai")).toBe(true);
    expect(Array.isArray(data.communities)).toBe(true);
  });
});
