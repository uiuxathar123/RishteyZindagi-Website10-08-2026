/**
 * B18 — Super-Admin community / caste pick-list management (`communities.manage`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/admin/communities/route";
import { PATCH as patchRoute } from "@/app/api/v1/admin/communities/[communityId]/route";
import { GET as referenceOptions } from "@/app/api/v1/reference/profile-options/route";
import { PATCH as updateProfile } from "@/app/api/v1/profiles/me/route";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { db } from "@/server/db/client";
import { auditLogs, communities, profiles } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { buildReadyProfile, req, resolveReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables } from "./helpers/pcp";

const URL_ = "http://localhost/api/v1";

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  await db.delete(communities).where(eq(communities.name, "B18 Test Community"));
});

const list = (token?: string, q = "") => listRoute(jreq(`${URL_}/admin/communities${q}`, { token }));
const create = (token: string | undefined, body: unknown) => createRoute(jreq(`${URL_}/admin/communities`, { method: "POST", body, token }));
const patch = (token: string | undefined, id: string, body: unknown) =>
  patchRoute(jreq(`${URL_}/admin/communities/${id}`, { method: "PATCH", body, token }), { params: { communityId: id } });
const options = async (religionId: string) => (await (await referenceOptions(req(`${URL_}/reference/profile-options?religionId=${religionId}`, undefined, { method: "GET" }))).json()).data.communities as Array<{ id: string; name: string }>;

describe("communities admin", () => {
  it("[comm-authz] anonymous 401; member 401/403; staff without communities.manage 403; Super Admin 200; delegation is revocable immediately", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const refs = await resolveReferenceIds();
    const m = await buildReadyProfile("comm-authz", refs);
    expect((await list()).status).toBe(401);
    expect((await create(undefined, { name: "X Y", religionId: refs.religionId })).status).toBe(401);
    expect([401, 403]).toContain((await list(m.member.sessionToken)).status);
    expect([401, 403]).toContain((await create(m.member.sessionToken, { name: "B18 Test Community", religionId: refs.religionId })).status);
    expect((await list(staff.token)).status).toBe(403);
    expect((await create(staff.token, { name: "B18 Test Community", religionId: refs.religionId })).status).toBe(403);
    expect((await patch(staff.token, refs.communityId, { isActive: false })).status).toBe(403);
    expect((await list(sup.token)).status).toBe(200);
    await grantPermission("STAFF_ADMIN", "communities.manage");
    expect((await list(staff.token)).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "communities.manage");
    expect((await list(staff.token)).status).toBe(403);
  });

  it("[comm-validation] name length, religion existence, duplicates (case-insensitive, per religion), unknown keys, bad ids", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    expect((await create(sup.token, { name: "x", religionId: refs.religionId })).status).toBe(400);
    expect((await create(sup.token, { name: "B18 Test Community", religionId: "nope" })).status).toBe(400);
    expect((await create(sup.token, { name: "B18 Test Community", religionId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
    expect((await create(sup.token, { name: "B18 Test Community", religionId: refs.religionId, extra: 1 })).status).toBe(400);
    const ok = await create(sup.token, { name: "  B18 Test Community  ", religionId: refs.religionId });
    expect(ok.status).toBe(200);
    expect((await create(sup.token, { name: "b18 test community", religionId: refs.religionId })).status).toBe(409);
    const id = (await ok.json()).data.community.id;
    expect((await patch(sup.token, id, {})).status).toBe(400);
    expect((await patch(sup.token, id, { name: "x" })).status).toBe(400);
    expect((await patch(sup.token, id, { religionId: refs.religionId })).status).toBe(400);
    expect((await patch(sup.token, "00000000-0000-4000-8000-000000000000", { isActive: false })).status).toBe(404);
    for (const q of ["?active=maybe", "?religionId=x", "?pageSize=101", "?page=0"]) expect((await list(sup.token, q)).status, q).toBe(400);
  });

  it("[comm-wildcards] % and _ in the filter are literal", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    expect((await (await list(sup.token, "?q=%25")).json()).data.total).toBe(0);
    expect((await (await list(sup.token, "?q=_")).json()).data.total).toBe(0);
  });

  it("[comm-lifecycle] add → in pick-list; rename; retire → gone from the pick-list and can't be newly chosen, but existing profiles keep it and search by it still works; restore → back; audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const refs = await resolveReferenceIds();
    const created = (await (await create(sup.token, { name: "B18 Test Community", religionId: refs.religionId })).json()).data.community;
    expect(created.isActive).toBe(true);
    expect((await options(refs.religionId)).some((c) => c.id === created.id)).toBe(true);

    const renamed = await patch(sup.token, created.id, { name: "B18 Test Community Renamed" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data.community.name).toBe("B18 Test Community Renamed");
    expect((await patch(sup.token, created.id, { name: "B18 Test Community Renamed" })).status).toBe(200); // same name → no-op, not audited
    expect((await patch(sup.token, created.id, { name: "B18 Test Community" })).status).toBe(200);

    const a = await buildReadyProfile("comm-keeper", refs, { communityId: created.id });
    const b = await buildReadyProfile("comm-newcomer", refs);
    expect((await (await list(sup.token, `?q=B18`)).json()).data.items[0].profileCount).toBe(1);

    expect((await patch(sup.token, created.id, { isActive: false })).status).toBe(200);
    expect((await options(refs.religionId)).some((c) => c.id === created.id)).toBe(false);
    // b cannot newly pick it
    const pick = await updateProfile(req(`${URL_}/profiles/me`, { communityId: created.id }, { token: b.member.sessionToken, method: "PATCH" }));
    expect(pick.status).toBe(400);
    // a (who already has it) can re-save it and edit other fields
    const keep = await updateProfile(req(`${URL_}/profiles/me`, { communityId: created.id, aboutMe: "Still here" }, { token: a.member.sessionToken, method: "PATCH" }));
    expect(keep.status).toBe(200);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, a.profileId));
    expect(row.communityId).toBe(created.id);
    // search by the retired community still finds a
    const found = await (await searchProfiles(req(`${URL_}/search/profiles?communityIds=${created.id}&religionIds=${refs.religionId}`, undefined, { method: "GET" }))).json();
    expect(found.data.items.map((i: { profile: { id: string } }) => i.profile.id)).toEqual([a.profileId]);

    expect((await patch(sup.token, created.id, { isActive: true })).status).toBe(200);
    expect((await options(refs.religionId)).some((c) => c.id === created.id)).toBe(true);
    expect((await updateProfile(req(`${URL_}/profiles/me`, { communityId: created.id }, { token: b.member.sessionToken, method: "PATCH" }))).status).toBe(200);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id)).orderBy(auditLogs.createdAt);
    expect(rows.map((r) => r.action)).toEqual(["community.created", "community.renamed", "community.renamed", "community.retired", "community.restored"]);
    expect(rows.every((r) => r.actorId === sup.id && r.actorType === "ADMIN")).toBe(true);
  });
});
