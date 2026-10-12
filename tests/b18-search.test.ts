/**
 * B18 — search & validation: profile-ID search, the advanced-search
 * entitlement (server side), Super-Admin search settings, hidden profiles,
 * and the member-facing profile ID in profile views.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { GET as getMyProfile } from "@/app/api/v1/profiles/me/completion/route";
import { PATCH as patchSettings } from "@/app/api/v1/admin/platform-settings/route";
import { db } from "@/server/db/client";
import { profiles, users, reports, reportCategories } from "@/server/db/schema";
import { GET as searchAccess } from "@/app/api/v1/search/access/route";
import { GET as myMembership } from "@/app/api/v1/memberships/me/route";
import { GET as adminListUsers } from "@/app/api/v1/admin/users/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, activateMembershipForTests, expireMembershipForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";

const URL_ = "http://localhost/api/v1";
const get = (query: string, token?: string) => searchProfiles(req(`${URL_}/search/profiles${query}`, undefined, { token, method: "GET" }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers(); // clears platform_settings → defaults (gate ON, page size 20/50)
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("profile ID", () => {
  it("[pid-format-and-owner-view] every profile gets a unique RZ+8-digit ID; the owner and other members see it; visitors do not", async () => {
    const refs = await resolveReferenceIds();
    const a = await buildReadyProfile("pid-a", refs, { gender: "FEMALE" });
    const b = await buildReadyProfile("pid-b", refs, { gender: "FEMALE" });
    const rows = await db.select().from(profiles);
    const ids = rows.map((r) => r.publicId);
    expect(ids.every((x) => /^RZ\d{8}$/.test(x))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const mine = await (await getMyProfile(req(`${URL_}/profiles/me/completion`, undefined, { token: a.member.sessionToken, method: "GET" }))).json();
    const aRow = rows.find((r) => r.id === a.profileId)!;
    expect(mine.data.profile.profileId).toBe(aRow.publicId);

    const asMember = await (await get("?gender=FEMALE", b.member.sessionToken)).json();
    expect(asMember.data.items[0].profile.profileId).toBe(aRow.publicId);
    const asVisitor = await (await get("?gender=FEMALE")).json();
    expect(asVisitor.data.items[0].profile.profileId).toBeUndefined();
  });
});

describe("advanced-search entitlement", () => {
  it("[adv-gate] basic filters are free for everyone; advanced filters need a plan with advancedSearch (anonymous 403, no-plan 403, chat-only plan 403, advanced plan 200)", async () => {
    const refs = await resolveReferenceIds();
    await buildReadyProfile("adv-target", refs, { gender: "FEMALE", heightCm: 165 });
    const viewer = await buildReadyProfile("adv-viewer", refs, { gender: "MALE" });
    const tok = viewer.member.sessionToken;

    expect((await get("?gender=FEMALE&minAge=18&maxAge=60")).status).toBe(200); // basic, anonymous
    expect((await get("?gender=FEMALE", tok)).status).toBe(200);

    for (const q of ["?minHeightCm=150", "?maxHeightCm=190", "?minIncome=1&incomeCurrency=INR", "?professionIds=" + refs.professionId, "?educationIds=" + refs.educationId, "?profileId=RZ10000001"]) {
      const anon = await get(q);
      expect(anon.status, `anonymous ${q}`).toBe(403);
      const noPlan = await get(q, tok);
      expect(noPlan.status, `no plan ${q}`).toBe(403);
      const body = await noPlan.json();
      expect(body.success).toBe(false);
      expect(body.error.details[0]).toEqual({ path: "entitlement", message: "advancedSearch" });
    }

    // a chat-only membership (no advancedSearch feature) does not unlock it
    await activateMembershipForTests(viewer.member.userId);
    expect((await get("?minHeightCm=150", tok)).status).toBe(403);
  });

  it("[adv-allowed] a plan with advancedSearch unlocks the filters; expiry takes it away immediately", async () => {
    const refs = await resolveReferenceIds();
    const target = await buildReadyProfile("adv2-target", refs, { gender: "FEMALE", heightCm: 165 });
    const viewer = await buildReadyProfile("adv2-viewer", refs, { gender: "MALE" });
    const tok = viewer.member.sessionToken;
    await activateMembershipForTests(viewer.member.userId, { advancedSearch: true });

    const ok = await get("?minHeightCm=150&maxHeightCm=190", tok);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.items.map((i: { profile: { id: string } }) => i.profile.id)).toContain(target.profileId);

    await expireMembershipForTests(viewer.member.userId);
    expect((await get("?minHeightCm=150", tok)).status).toBe(403);
  });

  it("[adv-switch] Super Admin can switch the rule off (e.g. a promotion) and back on; the change is audited", async () => {
    const refs = await resolveReferenceIds();
    await buildReadyProfile("adv3-target", refs, { gender: "FEMALE", heightCm: 165 });
    const viewer = await buildReadyProfile("adv3-viewer", refs, { gender: "MALE" });
    const sup = await createAdmin("SUPER_ADMIN");
    const patch = (body: unknown) => patchSettings(jreq(`${URL_}/admin/platform-settings`, { method: "PATCH", body, token: sup.token }));

    expect((await get("?minHeightCm=150", viewer.member.sessionToken)).status).toBe(403);
    expect((await patch({ search: { enforceAdvancedSearchEntitlement: false } })).status).toBe(200);
    expect((await get("?minHeightCm=150", viewer.member.sessionToken)).status).toBe(200);
    expect((await patch({ search: { enforceAdvancedSearchEntitlement: true } })).status).toBe(200);
    expect((await get("?minHeightCm=150", viewer.member.sessionToken)).status).toBe(403);
  });
});

describe("profile-ID search", () => {
  it("[pid-search] exact, case-insensitive; unknown ID → empty; malformed → 400; respects eligibility and blocks of visibility", async () => {
    const refs = await resolveReferenceIds();
    const target = await buildReadyProfile("ps-target", refs, { gender: "FEMALE" });
    await buildReadyProfile("ps-other", refs, { gender: "FEMALE" });
    const viewer = await buildReadyProfile("ps-viewer", refs, { gender: "MALE" });
    await activateMembershipForTests(viewer.member.userId, { advancedSearch: true });
    const tok = viewer.member.sessionToken;
    const [row] = await db.select().from(profiles).where(eq(profiles.id, target.profileId));

    const hit = await (await get(`?profileId=${row.publicId}`, tok)).json();
    expect(hit.data.total).toBe(1);
    expect(hit.data.items[0].profile.id).toBe(target.profileId);
    const lower = await (await get(`?profileId=${row.publicId.toLowerCase()}`, tok)).json();
    expect(lower.data.total).toBe(1);
    expect((await (await get("?profileId=RZ99999999", tok)).json()).data.total).toBe(0);
    for (const bad of ["abc", "RZ123", "RZ1234567890", "RZ1234567%", "' OR 1=1 --"]) {
      expect((await get(`?profileId=${encodeURIComponent(bad)}`, tok)).status, bad).toBe(400);
    }
    // a profile that is not visible (account suspended) cannot be found by ID either
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, target.member.userId));
    expect((await (await get(`?profileId=${row.publicId}`, tok)).json()).data.total).toBe(0);
  });

  it("[pid-hidden] a member who hides their profile disappears from search, including by profile ID", async () => {
    const refs = await resolveReferenceIds();
    const target = await buildReadyProfile("hid-target", refs, { gender: "FEMALE" });
    const viewer = await buildReadyProfile("hid-viewer", refs, { gender: "MALE" });
    await activateMembershipForTests(viewer.member.userId, { advancedSearch: true });
    const [row] = await db.select().from(profiles).where(eq(profiles.id, target.profileId));
    expect((await (await get("?gender=FEMALE", viewer.member.sessionToken)).json()).data.total).toBe(1);
    await db.update(profiles).set({ profileVisibility: "HIDDEN" }).where(eq(profiles.id, target.profileId));
    expect((await (await get("?gender=FEMALE", viewer.member.sessionToken)).json()).data.total).toBe(0);
    expect((await (await get(`?profileId=${row.publicId}`, viewer.member.sessionToken)).json()).data.total).toBe(0);
    expect((await (await get("?gender=FEMALE")).json()).data.total).toBe(0);
  });
});

describe("search settings", () => {
  it("[page-size-settings] default and maximum page size come from the Super-Admin setting; the hard API ceiling stays 50", async () => {
    const refs = await resolveReferenceIds();
    for (let i = 0; i < 12; i++) {
      if (i % 4 === 0) __resetRateLimitsForTests(); // sign-up is rate limited per client
      await buildReadyProfile(`pg-${i}`, refs, { gender: "FEMALE" });
    }
    expect((await (await get("?gender=FEMALE")).json()).data.pageSize).toBe(20);
    const sup = await createAdmin("SUPER_ADMIN");
    const patch = (body: unknown) => patchSettings(jreq(`${URL_}/admin/platform-settings`, { method: "PATCH", body, token: sup.token }));
    expect((await patch({ search: { defaultPageSize: 5, maxPageSize: 10 } })).status).toBe(200);
    const d = (await (await get("?gender=FEMALE")).json()).data;
    expect(d.pageSize).toBe(5);
    expect(d.items.length).toBe(5);
    expect(d.totalPages).toBe(3);
    const big = (await (await get("?gender=FEMALE&pageSize=50")).json()).data;
    expect(big.pageSize).toBe(10); // clamped to the configured maximum
    expect((await get("?gender=FEMALE&pageSize=51")).status).toBe(400); // hard ceiling
    expect((await patch({ search: { maxPageSize: 80 } })).status).toBe(400); // cannot exceed the hard ceiling
    expect((await patch({ search: { defaultPageSize: 30, maxPageSize: 10 } })).status).toBe(400);
  });

  it("[validation-matrix] invalid filters are rejected with 400 and never reach the database", async () => {
    const bad = [
      "?minAge=17", "?maxAge=101", "?minAge=40&maxAge=30", "?minAge=abc", "?gender=OTHER", "?religionIds=not-a-uuid",
      "?minIncome=5", "?pageSize=0", "?page=0", "?sortBy=password", "?sortDir=sideways", "?unknown=1", "?anyProfession=maybe",
    ];
    for (const q of bad) expect((await get(q)).status, q).toBe(400);
  });
});

describe("admin user search", () => {
  const list = async (query: string, token: string) => adminListUsers(jreq(`${URL_}/admin/users${query}`, { token }));

  it("[admin-search-escape] % and _ are matched literally, not as wildcards", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    await buildReadyProfile("wild-a", refs);
    await buildReadyProfile("wild-b", refs);
    const all = await (await list("", sup.token)).json();
    expect(all.data.total).toBe(2);
    for (const q of ["%", "_", "%25%25", "a%b"]) {
      const r = await (await list(`?q=${encodeURIComponent(q)}`, sup.token)).json();
      expect(r.data.total, q).toBe(0); // before the fix "%" matched everyone
    }
    await db.update(users).set({ name: "100% Genuine_Name" }).where(eq(users.id, all.data.items[0].id));
    const lit = await (await list(`?q=${encodeURIComponent("100% Genuine_")}`, sup.token)).json();
    expect(lit.data.total).toBe(1);
  });

  it("[admin-search-ids] finds a member by profile ID (any case, partial) and by user id / profile uuid", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    const p = await buildReadyProfile("ids-a", refs);
    await buildReadyProfile("ids-b", refs);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, p.profileId));
    for (const q of [row.publicId, row.publicId.toLowerCase(), p.member.userId, p.profileId]) {
      const r = await (await list(`?q=${q}`, sup.token)).json();
      expect(r.data.total, q).toBe(1);
      expect(r.data.items[0].id).toBe(p.member.userId);
      expect(r.data.items[0].profileId).toBe(row.publicId);
    }
  });

  it("[admin-search-filters] membership, open-report and sort filters; invalid values are 400", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    const paid = await buildReadyProfile("flt-paid", refs);
    const reported = await buildReadyProfile("flt-reported", refs);
    await buildReadyProfile("flt-plain", refs);
    await activateMembershipForTests(paid.member.userId);
    const [cat] = await db.select().from(reportCategories).limit(1);
    await db.insert(reports).values({ reporterUserId: paid.member.userId, reportedUserId: reported.member.userId, categoryId: cat.id, status: "OPEN" });

    const ids = async (q: string) => (await (await list(q, sup.token)).json()).data.items.map((i: { id: string }) => i.id) as string[];
    expect(await ids("?membership=ACTIVE")).toEqual([paid.member.userId]);
    expect((await ids("?membership=NONE")).sort()).toEqual([reported.member.userId, (await ids("")).find((x) => x !== paid.member.userId && x !== reported.member.userId)!].sort());
    expect(await ids("?openReports=true")).toEqual([reported.member.userId]);
    await db.update(reports).set({ status: "RESOLVED" }).where(eq(reports.reportedUserId, reported.member.userId));
    expect(await ids("?openReports=true")).toEqual([]);
    const newest = await ids("?sort=newest");
    expect((await ids("?sort=oldest"))).toEqual([...newest].reverse());
    for (const bad of ["?membership=GOLD", "?openReports=false", "?sort=password", "?status=NOPE", "?pageSize=51", "?page=0"]) {
      expect((await list(bad, sup.token)).status, bad).toBe(400);
    }
  });

  it("[admin-search-authz] needs users.view: anonymous 401, member 401/403, staff without it 403, staff with it 200; revocation is immediate", async () => {
    const staff = await createAdmin("STAFF_ADMIN");
    const refs = await resolveReferenceIds();
    const m = await buildReadyProfile("authz-a", refs);
    expect((await adminListUsers(jreq(`${URL_}/admin/users`))).status).toBe(401);
    expect([401, 403]).toContain((await list("", m.member.sessionToken)).status);
    await revokePermission("STAFF_ADMIN", "users.view");
    expect((await list("", staff.token)).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "users.view");
    expect((await list("", staff.token)).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "users.view");
    expect((await list("", staff.token)).status).toBe(403); // takes effect on the very next request
    await grantPermission("STAFF_ADMIN", "users.view");
  });
});

describe("search access hint", () => {
  const access = async (token?: string) => (await (await searchAccess(req(`${URL_}/search/access`, undefined, { token, method: "GET" }))).json()).data;

  it("[access-hint] visitor / member without plan / member with plan / rule switched off; /memberships/me carries the same entitlement", async () => {
    const refs = await resolveReferenceIds();
    const m = await buildReadyProfile("acc-m", refs);
    const tok = m.member.sessionToken;
    expect(await access()).toMatchObject({ audience: "visitor", advancedSearch: false });
    expect(await access(tok)).toMatchObject({ audience: "member", advancedSearch: false });
    const me0 = await (await myMembership(req(`${URL_}/memberships/me`, undefined, { token: tok, method: "GET" }))).json();
    expect(me0.data.entitlements).toEqual({ advancedSearch: false });
    await activateMembershipForTests(m.member.userId, { advancedSearch: true });
    expect(await access(tok)).toMatchObject({ audience: "member", advancedSearch: true });
    expect((await (await myMembership(req(`${URL_}/memberships/me`, undefined, { token: tok, method: "GET" }))).json()).data.entitlements).toEqual({ advancedSearch: true });
    const sup = await createAdmin("SUPER_ADMIN");
    await patchSettings(jreq(`${URL_}/admin/platform-settings`, { method: "PATCH", body: { search: { enforceAdvancedSearchEntitlement: false } }, token: sup.token }));
    expect(await access()).toMatchObject({ audience: "visitor", advancedSearch: true });
  });
});
