/**
 * B3: public reference/lookup data used to populate profile onboarding
 * forms — no authentication required, no PII.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getReferenceOptions } from "@/app/api/v1/reference/profile-options/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetOtpConfigForTests } from "./helpers/reset-db";
import { buildQuery, type Query } from "@/lib/api/client";
import { loadReference, __clearReferenceCacheForTests } from "@/lib/api/lookups";
import { HOME_REFERENCE_QUERY } from "@/components/home/browseLookups";

// The browser client is routed straight to the real handler, so the client cache is tested against real answers
// and every request it would send is counted.
const apiGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, api: { ...actual.api, get: apiGet } };
});

async function fetchOptions(query = "") {
  const res = await getReferenceOptions(new NextRequest(`http://localhost/api/v1/reference/profile-options${query}`));
  return { status: res.status, body: await res.json() };
}

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

  it("[ref-country-iso] countryIso=IN returns the base lists plus exactly the cities countryId returns for India", async () => {
    const base = await fetchOptions();
    const india = base.body.data.countries.find((c: { isoCode: string }) => c.isoCode === "IN");
    const byId = await fetchOptions(`?countryId=${india.id}`);
    const byIso = await fetchOptions("?countryIso=IN");
    expect(byIso.status).toBe(200);
    expect(byIso.body).toEqual(byId.body);
    expect(byIso.body.data.cities.some((c: { name: string }) => c.name === "Mumbai")).toBe(true);
    const { cities: _cities, ...isoBase } = byIso.body.data;
    void _cities;
    expect(isoBase).toEqual(base.body.data);
    // case-insensitive, and combinable with religionId like countryId is
    expect((await fetchOptions("?countryIso=in")).body).toEqual(byId.body);
    const hindu = base.body.data.religions.find((r: { name: string }) => r.name === "Hindu");
    expect(await fetchOptions(`?countryIso=IN&religionId=${hindu.id}`)).toEqual(await fetchOptions(`?countryId=${india.id}&religionId=${hindu.id}`));
  });

  it("[ref-country-iso-unknown] a well-formed code no country has gives an empty city list, like an unknown countryId", async () => {
    const unknownIso = await fetchOptions("?countryIso=ZZ");
    const unknownId = await fetchOptions("?countryId=00000000-0000-4000-8000-000000000000");
    expect(unknownIso.status).toBe(200);
    expect(unknownIso.body.data.cities).toEqual([]);
    expect(unknownIso.body).toEqual(unknownId.body);
  });

  it("[ref-country-iso-invalid] a malformed code, or countryIso together with countryId, is a 400 validation error", async () => {
    const base = await fetchOptions();
    const india = base.body.data.countries.find((c: { isoCode: string }) => c.isoCode === "IN");
    for (const query of ["?countryIso=", "?countryIso=IND", "?countryIso=1N", "?countryIso=I", `?countryIso=IN&countryId=${india.id}`]) {
      const r = await fetchOptions(query);
      expect(r.status, query).toBe(400);
      expect(r.body.success, query).toBe(false);
      expect(r.body.error.code, query).toBe("VALIDATION_ERROR");
    }
  });

  it("[ref-country-iso-repeated] countryIso sent more than once is a 400 validation error, even when the values match", async () => {
    for (const query of ["?countryIso=IN&countryIso=US", "?countryIso=IN&countryIso=IN", "?countryIso=IN&countryIso="]) {
      const r = await fetchOptions(query);
      expect(r.status, query).toBe(400);
      expect(r.body, query).toEqual({ success: false, error: { code: "VALIDATION_ERROR", message: "Send countryIso only once." } });
    }
  });
});

describe("Homepage reference lookups (client cache)", () => {
  beforeEach(async () => {
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
    __clearReferenceCacheForTests();
    apiGet.mockReset();
    apiGet.mockImplementation(async (path: string, opts?: { query?: Query }) => {
      const res = await getReferenceOptions(new NextRequest(`http://localhost/api/v1${path}${buildQuery(opts?.query)}`));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.code ?? "request failed");
      return body.data;
    });
  });

  it("[ref-home-one-request] the homepage's three consumers share one countryIso=IN request that carries Indian cities", async () => {
    // HeroSearchForm, QuickBrowse and ExploreProfiles all ask on mount, at the same time.
    const [hero, quick, explore] = await Promise.all([1, 2, 3].map(() => loadReference(HOME_REFERENCE_QUERY)));
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith("/reference/profile-options", { query: { countryIso: "IN" } });
    expect(quick).toBe(hero);
    expect(explore).toBe(hero);
    expect(hero.religions.length).toBeGreaterThan(0);
    expect(hero.countries.some((c) => c.isoCode === "IN")).toBe(true);
    expect(hero.cities?.some((c) => c.name === "Mumbai")).toBe(true);
  });

  it("[ref-home-shares-cache] the countryIso answer also serves later base and India countryId lookups without new requests", async () => {
    const home = await loadReference(HOME_REFERENCE_QUERY);
    const india = home.countries.find((c) => c.isoCode === "IN")!;

    const base = await loadReference();
    expect(base.cities).toBeUndefined();
    expect(base.religions).toEqual(home.religions);
    expect(base.countries).toEqual(home.countries);

    const byId = await loadReference({ countryId: india.id });
    expect(byId.cities).toEqual(home.cities);
    expect(apiGet).toHaveBeenCalledTimes(1);

    // other lookups still fetch their own answers
    const other = home.countries.find((c) => c.isoCode !== "IN")!;
    await loadReference({ countryId: other.id });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it("[ref-home-cache-untouched] answers already cached are kept, and a failed countryIso request is not cached", async () => {
    const base = await loadReference();
    await loadReference(HOME_REFERENCE_QUERY);
    expect(await loadReference()).toBe(base);
    expect(apiGet).toHaveBeenCalledTimes(2);

    __clearReferenceCacheForTests();
    apiGet.mockClear();
    apiGet.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    await expect(loadReference(HOME_REFERENCE_QUERY)).rejects.toThrow("NETWORK_ERROR");
    await loadReference(HOME_REFERENCE_QUERY);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
