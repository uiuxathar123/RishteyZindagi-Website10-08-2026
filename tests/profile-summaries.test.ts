/**
 * GET /profiles/summaries — the batched card data for list screens.
 * It must show EXACTLY what GET /profiles/:id shows a signed-in member, answer null wherever that route
 * answers 404, and must not record PROFILE_VIEW events (rendering a list is not viewing each person).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/server/db/client";
import { behaviourEvents, blocks, interests, profiles, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { buildReadyProfile, resolveReferenceIds, type ReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, resetPcpTables } from "./helpers/pcp";
import { GET as getSummaries } from "@/app/api/v1/profiles/summaries/route";
import { GET as getSingle } from "@/app/api/v1/profiles/[profileId]/route";

const URL_ = "http://localhost/api/v1/profiles";
let refs: ReferenceIds;

function get(url: string, token?: string) {
  return new NextRequest(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
}
async function summaries(ids: string[], token?: string) {
  const res = await getSummaries(get(`${URL_}/summaries?ids=${ids.join(",")}`, token), { params: {} });
  return { status: res.status, body: await res.json() };
}
async function single(profileId: string, token: string) {
  const res = await getSingle(get(`${URL_}/${profileId}`, token), { params: { profileId } });
  return { status: res.status, body: await res.json() };
}
const viewEvents = async () => (await db.select().from(behaviourEvents).where(eq(behaviourEvents.eventType, "PROFILE_VIEW"))).length;

beforeAll(async () => {
  await resetTransactionalTables();
  refs = await resolveReferenceIds();
});
beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

async function two(): Promise<{ viewer: ReadyProfile; other: ReadyProfile }> {
  const viewer = await buildReadyProfile("sum-viewer", refs, { gender: "MALE" });
  const other = await buildReadyProfile("sum-other", refs, { gender: "FEMALE" });
  return { viewer, other };
}

describe("GET /profiles/summaries", () => {
  it("[sum-parity] a visible profile is identical to the single-profile view", async () => {
    const { viewer, other } = await two();
    const batch = await summaries([other.profileId], viewer.member.sessionToken);
    expect(batch.status).toBe(200);
    const item = batch.body.data.items[other.profileId];
    expect(item.audience).toBe("authenticated");
    const one = await single(other.profileId, viewer.member.sessionToken);
    expect(one.body.data.audience).toBe("authenticated");
    expect(item.profile).toEqual(one.body.data.profile);
    // names are resolved from the reference tables, and the photo is the gated route (never a storage URL)
    expect(item.profile.religion).toBeTruthy();
    expect(item.profile.city).toBeTruthy();
    expect(item.profile.photos.length).toBe(1);
    expect(item.profile.photos[0].url).toMatch(/^\/api\/v1\/profiles\/photos\/[0-9a-f-]+\/file$/);
  });

  it("[sum-many] several ids, a mix of visible and unknown, come back keyed by id", async () => {
    const { viewer, other } = await two();
    const third = await buildReadyProfile("sum-third", refs, { gender: "FEMALE" });
    const ghost = randomUUID();
    const r = await summaries([other.profileId, third.profileId, ghost, other.profileId], viewer.member.sessionToken);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data.items).sort()).toEqual([other.profileId, third.profileId, ghost].sort());
    expect(r.body.data.items[other.profileId]).not.toBeNull();
    expect(r.body.data.items[third.profileId]).not.toBeNull();
    expect(r.body.data.items[ghost]).toBeNull();
  });

  it("[sum-null-cases] null wherever the single route answers 404", async () => {
    const { viewer, other } = await two();
    const token = viewer.member.sessionToken;
    const cases: Array<[string, ReadyProfile, () => Promise<void>, () => Promise<void>]> = [];
    const mk = async (name: string) => buildReadyProfile(`sum-${name}`, refs, { gender: "FEMALE" });

    const suspended = await mk("susp");
    const unapproved = await mk("unappr");
    const blockedByMe = await mk("blk1");
    const blockedMe = await mk("blk2");
    const hidden = await mk("hidden");
    const notReady = await buildReadyProfile("sum-notready", refs, { gender: "FEMALE", skipPhoto: true });

    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, suspended.member.userId));
    await db.update(profiles).set({ approvalStatus: "PENDING" }).where(eq(profiles.id, unapproved.profileId));
    await db.insert(blocks).values({ blockerUserId: viewer.member.userId, blockedUserId: blockedByMe.member.userId });
    await db.insert(blocks).values({ blockerUserId: blockedMe.member.userId, blockedUserId: viewer.member.userId });
    await db.update(profiles).set({ profileVisibility: "HIDDEN" }).where(eq(profiles.id, hidden.profileId));
    void cases;

    const ids = [suspended, unapproved, blockedByMe, blockedMe, hidden, notReady, viewer].map((p) => p.profileId);
    const r = await summaries([...ids, other.profileId], token);
    for (const id of ids) {
      expect(r.body.data.items[id], `summaries ${id}`).toBeNull();
      if (id !== viewer.profileId) expect((await single(id, token)).status, `single ${id}`).toBe(404);
    }
    expect(r.body.data.items[other.profileId]).not.toBeNull();
  });

  it("[sum-hidden-partner] a HIDDEN profile is visible to an accepted partner only", async () => {
    const { viewer, other } = await two();
    await db.update(profiles).set({ profileVisibility: "HIDDEN" }).where(eq(profiles.id, other.profileId));
    expect((await summaries([other.profileId], viewer.member.sessionToken)).body.data.items[other.profileId]).toBeNull();
    await db.insert(interests).values({ fromUserId: viewer.member.userId, toUserId: other.member.userId, status: "ACCEPTED" });
    const after = await summaries([other.profileId], viewer.member.sessionToken);
    expect(after.body.data.items[other.profileId]?.profile.id).toBe(other.profileId);
  });

  it("[sum-photo-privacy] ACCEPTED_ONLY photos are withheld from non-partners and shown to partners", async () => {
    const { viewer, other } = await two();
    await db.update(profiles).set({ photoVisibility: "ACCEPTED_ONLY" }).where(eq(profiles.id, other.profileId));
    const before = (await summaries([other.profileId], viewer.member.sessionToken)).body.data.items[other.profileId];
    expect(before.profile.photosRestricted).toBe(true);
    expect(before.profile.photos).toEqual([]);
    expect(before.profile).toEqual((await single(other.profileId, viewer.member.sessionToken)).body.data.profile);
    await db.insert(interests).values({ fromUserId: other.member.userId, toUserId: viewer.member.userId, status: "ACCEPTED" });
    const after = (await summaries([other.profileId], viewer.member.sessionToken)).body.data.items[other.profileId];
    expect(after.profile.photosRestricted).toBe(false);
    expect(after.profile.photos.length).toBe(1);
  });

  it("[sum-no-view-events] building a list records no PROFILE_VIEW events (the single route still does)", async () => {
    const { viewer, other } = await two();
    const third = await buildReadyProfile("sum-third", refs, { gender: "FEMALE" });
    const before = await viewEvents();
    await summaries([other.profileId, third.profileId], viewer.member.sessionToken);
    expect(await viewEvents()).toBe(before);
    await single(other.profileId, viewer.member.sessionToken);
    expect(await viewEvents()).toBe(before + 1);
  });

  it("[sum-validation] bad input is a 400, not a 500", async () => {
    const { viewer } = await two();
    const token = viewer.member.sessionToken;
    expect((await summaries([], token)).status).toBe(400);
    expect((await summaries(["not-a-uuid"], token)).status).toBe(400);
    const fifty1 = Array.from({ length: 51 }, () => randomUUID());
    expect((await summaries(fifty1, token)).status).toBe(400);
    const fifty = Array.from({ length: 50 }, () => randomUUID());
    expect((await summaries(fifty, token)).status).toBe(200);
  });

  it("[sum-auth] anonymous callers get 401 and admin sessions get 403", async () => {
    const { other } = await two();
    expect((await summaries([other.profileId])).status).toBe(401);
    const admin = await createAdmin("SUPER_ADMIN");
    expect((await summaries([other.profileId], admin.token)).status).toBe(403);
  });
});

describe("GET /admin/users carries a primary photo path only for members who have one", () => {
  it("[admin-list-photo] primaryPhotoUrl points at the gated photo route", async () => {
    const { other } = await two();
    const { GET: listUsers } = await import("@/app/api/v1/admin/users/route");
    const admin = await createAdmin("SUPER_ADMIN");
    const nophoto = await buildReadyProfile("sum-nophoto", refs, { gender: "MALE", skipPhoto: true });
    const res = await listUsers(get("http://localhost/api/v1/admin/users?pageSize=50", admin.token), { params: {} });
    expect(res.status).toBe(200);
    const items = (await res.json()).data.items as Array<{ id: string; primaryPhotoUrl: string | null }>;
    const withPhoto = items.find((i) => i.id === other.member.userId)!;
    const without = items.find((i) => i.id === nophoto.member.userId)!;
    expect(withPhoto.primaryPhotoUrl).toBe(`/api/v1/profiles/photos/${other.photoId}/file`);
    expect(without.primaryPhotoUrl).toBeNull();
    void inArray;
  });
});
