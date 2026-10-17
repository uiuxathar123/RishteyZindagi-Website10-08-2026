/**
 * P-1 regression: profile search and recommendations fetch card data (reference lookups and
 * photos) for the whole page in batches, so the number of database round trips per request does
 * not grow with the number of results. Before the fix each result row cost about nine extra
 * queries (eight single-row lookups plus one photo query).
 *
 * Two kinds of check:
 *  - query counts (db/client.ts getQueryCount) are identical for 1, 5, 10 and 20 results, and an
 *    empty page costs no more than a full one;
 *  - the response is identical to what the previous per-row code produced for the same data
 *    (resolveLookups + listPhotos per row, rebuilt here as the reference), so labels, photos,
 *    privacy extras and ordering are unchanged.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { getQueryCount, resetQueryCount } from "@/server/db/client";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import * as searchRepo from "@/server/modules/search/search.repository";
import { resolveLookups } from "@/server/modules/profiles/profiles.service";
import { viewerExtrasFor } from "@/server/modules/profiles/privacy";
import { toAuthenticatedPublicView, toAnonymousGatedView } from "@/server/modules/profiles/profiles.dto";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests, disableAdvancedSearchGateForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds, type ReadyProfile } from "./helpers/profile-fixtures";

const CANDIDATES = 21;
const PAGE_SIZES = [1, 5, 10, 20];

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

function getReq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}

/** Round-trips through JSON so Date objects compare the same way the HTTP response does. */
const plain = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

let refs: ReferenceIds;
let requester: ReadyProfile;

async function measure(fn: () => Promise<Response>): Promise<{ queries: number; body: { data: { items: unknown[] } & Record<string, unknown> } }> {
  resetQueryCount();
  const res = await fn();
  const queries = getQueryCount();
  expect(res.status).toBe(200);
  return { queries, body: await res.json() };
}

describe("P-1: batched card data for search and recommendations", () => {
  beforeAll(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    await disableAdvancedSearchGateForTests();
    __resetRateLimitsForTests();

    refs = await resolveReferenceIds();
    // Vary the lookups across candidates so batching has several distinct ids per table to resolve.
    const maritalStatuses = await referenceRepo.listMaritalStatuses();
    const motherTongues = await referenceRepo.listMotherTongues();
    const delhi = await referenceRepo.findOrCreateCity("Delhi", refs.countryId);
    const otherMarital = maritalStatuses.find((m) => m.id !== refs.maritalStatusId)!;
    const otherTongue = motherTongues.find((m) => m.id !== refs.motherTongueId)!;

    __resetRateLimitsForTests();
    requester = await buildReadyProfile("p1-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    // Enough evaluable preference weight for recommendations (scoring.ts MIN_EVALUABLE_WEIGHT), and every
    // candidate below satisfies every category, so all of them are PRIMARY-tier matches.
    const prefs = await patchPreferences(
      req(
        "http://localhost/api/v1/profiles/me/partner-preferences",
        {
          ageMin: 20,
          ageMax: 40,
          heightMinCm: 140,
          heightMaxCm: 200,
          religionId: refs.religionId,
          communityIds: [refs.communityId],
          maritalStatusIds: [refs.maritalStatusId, otherMarital.id],
          motherTongueIds: [refs.motherTongueId, otherTongue.id],
          educationIds: [refs.educationId],
          professionIds: [refs.professionId],
          countryIds: [refs.countryId],
          cityIds: [refs.cityId, delhi.id],
        },
        { token: requester.member.sessionToken, method: "PATCH" }
      )
    );
    expect(prefs.status).toBe(200);

    for (let i = 0; i < CANDIDATES; i++) {
      __resetRateLimitsForTests();
      await buildReadyProfile(`p1-cand-${i}`, refs, {
        gender: "FEMALE",
        dateOfBirth: dobForAge(22 + (i % 12)),
        heightCm: 150 + i,
        ...(i % 2 === 0 ? { cityId: delhi.id } : {}),
        ...(i % 3 === 0 ? { maritalStatusId: otherMarital.id } : {}),
        ...(i % 4 === 0 ? { motherTongueId: otherTongue.id } : {}),
      });
    }
    __resetRateLimitsForTests();
  }, 240_000);

  it("[p1-search-anon-constant] signed-out search: the query count is the same for 1, 5, 10 and 20 results", async () => {
    const counts: number[] = [];
    for (const ps of PAGE_SIZES) {
      const { queries, body } = await measure(() => searchProfiles(getReq(`http://localhost/api/v1/search/profiles?gender=FEMALE&pageSize=${ps}`)));
      expect(body.data.items).toHaveLength(ps);
      counts.push(queries);
    }
    console.log(`[P-1 query counts] search signed-out, results ${PAGE_SIZES.join("/")}: ${counts.join("/")}`);
    expect(new Set(counts).size).toBe(1);
  });

  it("[p1-search-member-constant] signed-in search: the query count is the same for 1, 5, 10 and 20 results", async () => {
    const counts: number[] = [];
    for (const ps of PAGE_SIZES) {
      const { queries, body } = await measure(() => searchProfiles(getReq(`http://localhost/api/v1/search/profiles?gender=FEMALE&pageSize=${ps}`, requester.member.sessionToken)));
      expect(body.data.items).toHaveLength(ps);
      counts.push(queries);
    }
    console.log(`[P-1 query counts] search signed-in, results ${PAGE_SIZES.join("/")}: ${counts.join("/")}`);
    expect(new Set(counts).size).toBe(1);
  });

  it("[p1-search-filter-constant] a reference filter adds a fixed cost, still independent of the result count", async () => {
    const counts: number[] = [];
    for (const ps of PAGE_SIZES) {
      const { queries, body } = await measure(() =>
        searchProfiles(getReq(`http://localhost/api/v1/search/profiles?gender=FEMALE&religionIds=${refs.religionId}&pageSize=${ps}`))
      );
      expect(body.data.items).toHaveLength(ps);
      counts.push(queries);
    }
    console.log(`[P-1 query counts] search signed-out + religion filter, results ${PAGE_SIZES.join("/")}: ${counts.join("/")}`);
    expect(new Set(counts).size).toBe(1);
  });

  it("[p1-search-empty] a search with no results costs no more than a full page and returns no items", async () => {
    const empty = await measure(() => searchProfiles(getReq("http://localhost/api/v1/search/profiles?gender=FEMALE&minAge=90&maxAge=100&pageSize=20")));
    const full = await measure(() => searchProfiles(getReq("http://localhost/api/v1/search/profiles?gender=FEMALE&pageSize=20")));
    console.log(`[P-1 query counts] search signed-out, empty: ${empty.queries}, full page of 20: ${full.queries}`);
    expect(empty.body.data.items).toHaveLength(0);
    expect(empty.queries).toBeLessThanOrEqual(full.queries);
  });

  it("[p1-search-same-response] batched search returns exactly what the per-row code returned (signed-out and signed-in)", async () => {
    for (const viewer of [null, requester] as const) {
      const token = viewer?.member.sessionToken;
      const res = await searchProfiles(getReq("http://localhost/api/v1/search/profiles?gender=FEMALE&pageSize=20", token));
      expect(res.status).toBe(200);
      const { data } = await res.json();

      // Reference: the previous implementation — same repository query, then lookups and photos per row.
      const page = await searchRepo.search({
        filters: { gender: "FEMALE", excludeUserId: viewer?.member.userId },
        page: 1,
        pageSize: 20,
        sortBy: "updatedAt",
        sortDir: "desc",
      });
      const extras = viewer ? await viewerExtrasFor(viewer.member.userId, page.items.map((i) => i.profile)) : new Map();
      const expected = await Promise.all(
        page.items.map(async (row) => {
          const [lookups, photos] = await Promise.all([resolveLookups(row.profile), profilesRepo.listPhotos(row.profile.id)]);
          return viewer
            ? { audience: "authenticated", profile: toAuthenticatedPublicView(row.profile, row.displayName, lookups, photos, extras.get(row.profile.id)) }
            : { audience: "anonymous", profile: toAnonymousGatedView(row.profile, lookups, photos.length > 0) };
        })
      );
      expect(data.items).toHaveLength(20);
      expect(data.items).toEqual(plain(expected));
    }
  });

  it("[p1-recommendations-constant] recommendations: the query count is the same for 1, 5, 10 and 20 cards", async () => {
    const counts: number[] = [];
    for (const ps of PAGE_SIZES) {
      const { queries, body } = await measure(() =>
        getRecommendations(getReq(`http://localhost/api/v1/profiles/me/recommendations?pageSize=${ps}`, requester.member.sessionToken))
      );
      expect(body.data.status).toBe("ok");
      expect(body.data.items).toHaveLength(ps);
      counts.push(queries);
    }
    console.log(`[P-1 query counts] recommendations, cards ${PAGE_SIZES.join("/")}: ${counts.join("/")}`);
    expect(new Set(counts).size).toBe(1);
  });

  it("[p1-recommendations-same-cards] every recommendation card matches the per-row profile view, and scores and order are unchanged across page sizes", async () => {
    const res = await getRecommendations(getReq("http://localhost/api/v1/profiles/me/recommendations?pageSize=20", requester.member.sessionToken));
    const { data } = await res.json();
    const cards = [...data.items, ...data.secondaryItems] as Array<{ profile: { id: string }; compatibilityScore: number; tier: string }>;
    expect(data.items).toHaveLength(20);

    const rows = await Promise.all(cards.map((c) => profilesRepo.findByIdWithAccount(c.profile.id)));
    const extras = await viewerExtrasFor(requester.member.userId, rows.map((r) => r!.profile));
    for (let i = 0; i < cards.length; i++) {
      const row = rows[i]!;
      const [lookups, photos] = await Promise.all([resolveLookups(row.profile), profilesRepo.listPhotos(row.profile.id)]);
      expect(cards[i].profile).toEqual(plain(toAuthenticatedPublicView(row.profile, row.displayName, lookups, photos, extras.get(row.profile.id))));
    }

    // Batching must not touch scoring: the first five cards of a 5-card page are the first five of the 20-card page.
    const small = await (await getRecommendations(getReq("http://localhost/api/v1/profiles/me/recommendations?pageSize=5", requester.member.sessionToken))).json();
    const pick = (list: Array<{ profile: { id: string }; compatibilityScore: number; tier: string }>) => list.map((c) => [c.profile.id, c.compatibilityScore, c.tier]);
    expect(pick(small.data.items)).toEqual(pick(data.items.slice(0, 5)));
  });
});
