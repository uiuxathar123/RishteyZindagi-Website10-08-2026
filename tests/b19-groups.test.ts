/**
 * B19 — community groups: admin-curated circles, member join/post/report, admin moderation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { GET as listGroups } from "@/app/api/v1/groups/route";
import { POST as joinRoute } from "@/app/api/v1/groups/[groupId]/join/route";
import { POST as leaveRoute } from "@/app/api/v1/groups/[groupId]/leave/route";
import { GET as listPostsRoute, POST as createPostRoute } from "@/app/api/v1/groups/[groupId]/posts/route";
import { DELETE as deletePostRoute } from "@/app/api/v1/group-posts/[postId]/route";
import { POST as reportRoute } from "@/app/api/v1/group-posts/[postId]/report/route";
import { GET as adminList, POST as adminCreate } from "@/app/api/v1/admin/groups/route";
import { PATCH as adminPatch } from "@/app/api/v1/admin/groups/[groupId]/route";
import { GET as adminPosts } from "@/app/api/v1/admin/groups/[groupId]/posts/route";
import { GET as adminMembers } from "@/app/api/v1/admin/groups/[groupId]/members/route";
import { PATCH as adminMember } from "@/app/api/v1/admin/groups/[groupId]/members/[userId]/route";
import { PATCH as adminHide } from "@/app/api/v1/admin/group-posts/[postId]/route";
import { db } from "@/server/db/client";
import { auditLogs, blocks, notifications, profiles } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, createVerifiedMember, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";

const U = "http://localhost/api/v1";
const m = (token: string | undefined, method: string, path: string, body?: unknown) => req(`${U}${path}`, body, { token, method });
const a = (token: string | undefined, method: string, path: string, body?: unknown) => jreq(`${U}${path}`, { method, body, token });
const gp = (groupId: string) => ({ params: { groupId } });
const join = (t: string, g: string) => joinRoute(m(t, "POST", `/groups/${g}/join`), gp(g));
const post = (t: string | undefined, g: string, body: unknown) => createPostRoute(m(t, "POST", `/groups/${g}/posts`, body), gp(g));
const feed = async (t: string | undefined, g: string) => listPostsRoute(m(t, "GET", `/groups/${g}/posts`), gp(g));
const feedBodies = async (t: string, g: string) => ((await (await feed(t, g)).json()).data.items as Array<{ body: string }>).map((p) => p.body);

let refs: ReferenceIds;
let sup: Awaited<ReturnType<typeof createAdmin>>;
async function newGroup(name = "Mumbai professionals") {
  const r = await adminCreate(a(sup.token, "POST", "/admin/groups", { name, description: "Chat about careers and life in the city." }));
  expect(r.status).toBe(201);
  return (await r.json()).data.group.id as string;
}
const ready = (p: string, gender: "FEMALE" | "MALE" = "FEMALE") => buildReadyProfile(p, refs, { gender });

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  sup = await createAdmin("SUPER_ADMIN");
});

describe("authorization", () => {
  it("[gr-authz] admin routes need groups.manage; staff get it only when granted; members and anonymous are refused", async () => {
    const staff = await createAdmin("STAFF_ADMIN");
    const member = await ready("gr-authz");
    expect((await adminList(a(undefined, "GET", "/admin/groups"))).status).toBe(401);
    expect([401, 403]).toContain((await adminList(a(member.member.sessionToken, "GET", "/admin/groups"))).status);
    expect((await adminList(a(staff.token, "GET", "/admin/groups"))).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "groups.manage");
    try {
      expect((await adminList(a(staff.token, "GET", "/admin/groups"))).status).toBe(200);
    } finally {
      await revokePermission("STAFF_ADMIN", "groups.manage");
    }
    expect((await adminList(a(staff.token, "GET", "/admin/groups"))).status).toBe(403);
    expect((await listGroups(m(undefined, "GET", "/groups"))).status).toBe(401);
    expect((await adminList(a(sup.token, "GET", "/admin/groups"))).status).toBe(200);
  });
});

describe("admin: groups", () => {
  it("[gr-admin-crud] create, validate, reject duplicates, edit, deactivate (hidden from members); audited", async () => {
    expect((await adminCreate(a(sup.token, "POST", "/admin/groups", { name: "x" }))).status).toBe(400);
    expect((await adminCreate(a(sup.token, "POST", "/admin/groups", { name: "Valid name", evil: 1 }))).status).toBe(400);
    const id = await newGroup("Delhi families");
    expect((await adminCreate(a(sup.token, "POST", "/admin/groups", { name: "Delhi families" }))).status).toBe(409);

    const member = await ready("gr-crud");
    const names = async () => ((await (await listGroups(m(member.member.sessionToken, "GET", "/groups"))).json()).data.groups as Array<{ name: string }>).map((g) => g.name);
    expect(await names()).toEqual(["Delhi families"]);

    expect((await adminPatch(a(sup.token, "PATCH", `/admin/groups/${id}`, {}), gp(id))).status).toBe(400);
    const renamed = await adminPatch(a(sup.token, "PATCH", `/admin/groups/${id}`, { name: "Delhi & NCR families" }), gp(id));
    expect(renamed.status).toBe(200);
    expect(await names()).toEqual(["Delhi & NCR families"]);
    expect((await adminPatch(a(sup.token, "PATCH", `/admin/groups/${id}`, { isActive: false }), gp(id))).status).toBe(200);
    expect(await names()).toEqual([]);
    expect((await join(member.member.sessionToken, id)).status).toBe(404);
    expect((await adminPatch(a(sup.token, "PATCH", `/admin/groups/not-a-uuid`, { isActive: true }), gp("not-a-uuid"))).status).toBe(404);

    const acts = (await db.select().from(auditLogs)).map((l) => l.action);
    expect(acts).toContain("group.created");
    expect(acts).toContain("group.updated");
  });
});

describe("members", () => {
  it("[gr-join] only an active member with a ready, approved profile can join; leaving and rejoining works; counts are right", async () => {
    const id = await newGroup();
    const incomplete = await createVerifiedMember("gr-incomplete");
    expect((await join(incomplete.sessionToken, id)).status).toBe(403);
    expect((await join("", id)).status).toBe(401);

    const pending = await ready("gr-pending");
    await db.update(profiles).set({ approvalStatus: "PENDING" }).where(eq(profiles.userId, pending.member.userId));
    expect((await join(pending.member.sessionToken, id)).status).toBe(403);

    const ok1 = await ready("gr-ok1");
    const ok2 = await ready("gr-ok2", "MALE");
    const j = await join(ok1.member.sessionToken, id);
    expect(j.status).toBe(200);
    expect((await j.json()).data.group).toMatchObject({ joined: true, memberCount: 1 });
    expect((await (await join(ok1.member.sessionToken, id)).json()).data.group.memberCount).toBe(1); // idempotent
    await join(ok2.member.sessionToken, id);
    expect((await (await listGroups(m(ok1.member.sessionToken, "GET", "/groups"))).json()).data.groups[0]).toMatchObject({ memberCount: 2, joined: true });

    expect((await leaveRoute(m(ok2.member.sessionToken, "POST", `/groups/${id}/leave`), gp(id))).status).toBe(200);
    expect((await (await listGroups(m(ok1.member.sessionToken, "GET", "/groups"))).json()).data.groups[0].memberCount).toBe(1);
    expect((await join(ok2.member.sessionToken, id)).status).toBe(200);
  });

  it("[gr-posts] non-members cannot read or write; posts show first name + initial; own shows 'You'; validation; delete only your own", async () => {
    const id = await newGroup();
    const ana = await ready("gr-ana");
    const bob = await ready("gr-bob", "MALE");
    const out = await ready("gr-out");
    await join(ana.member.sessionToken, id);
    await join(bob.member.sessionToken, id);

    expect((await post(out.member.sessionToken, id, { body: "hi" })).status).toBe(403);
    expect((await feed(out.member.sessionToken, id)).status).toBe(403);
    expect((await post(ana.member.sessionToken, id, { body: "   " })).status).toBe(400);
    expect((await post(ana.member.sessionToken, id, { body: "x".repeat(1001) })).status).toBe(400);
    expect((await post(ana.member.sessionToken, id, { body: "hi", extra: 1 })).status).toBe(400);

    const created = await post(ana.member.sessionToken, id, { body: "Hello everyone" });
    expect(created.status).toBe(201);
    const postId = (await created.json()).data.post.id as string;

    const asBob = (await (await feed(bob.member.sessionToken, id)).json()).data.items[0];
    expect(asBob.body).toBe("Hello everyone");
    expect(asBob.mine).toBe(false);
    expect(asBob.authorName).not.toBe("You");
    expect(asBob.authorName).toMatch(/^\S+( \S\.)?$/); // "First L." — never the full name
    expect((await (await feed(ana.member.sessionToken, id)).json()).data.items[0]).toMatchObject({ mine: true, authorName: "You" });

    const del = (t: string) => deletePostRoute(m(t, "DELETE", `/group-posts/${postId}`), { params: { postId } });
    expect((await del(bob.member.sessionToken)).status).toBe(404); // not yours -> same answer as missing
    expect((await feedBodies(bob.member.sessionToken, id))).toEqual(["Hello everyone"]);
    expect((await del(ana.member.sessionToken)).status).toBe(200);
    expect(await feedBodies(bob.member.sessionToken, id)).toEqual([]);
  });

  it("[gr-block] you never see posts from someone you blocked or who blocked you", async () => {
    const id = await newGroup();
    const ana = await ready("gr-ba");
    const bob = await ready("gr-bb", "MALE");
    const cy = await ready("gr-bc");
    for (const x of [ana, bob, cy]) await join(x.member.sessionToken, id);
    await post(ana.member.sessionToken, id, { body: "from ana" });
    await post(bob.member.sessionToken, id, { body: "from bob" });
    await db.insert(blocks).values({ blockerUserId: bob.member.userId, blockedUserId: ana.member.userId });
    expect((await feedBodies(ana.member.sessionToken, id)).sort()).toEqual(["from ana"]); // blocked by bob: bob's post hidden from ana
    expect((await feedBodies(bob.member.sessionToken, id)).sort()).toEqual(["from bob"]); // and ana's hidden from bob
    expect((await feedBodies(cy.member.sessionToken, id)).sort()).toEqual(["from ana", "from bob"]);
  });
});

describe("reports and moderation", () => {
  it("[gr-moderate] report once; admin sees it; hiding needs a reason, removes the post from feeds, notifies the author, is reversible and audited", async () => {
    const id = await newGroup();
    const ana = await ready("gr-ma");
    const bob = await ready("gr-mb", "MALE");
    const out = await ready("gr-mo");
    await join(ana.member.sessionToken, id);
    await join(bob.member.sessionToken, id);
    const postId = (await (await post(ana.member.sessionToken, id, { body: "buy my product, call 99999" })).json()).data.post.id as string;
    const rep = (t: string, body: unknown = { reason: "Looks like spam" }) => reportRoute(m(t, "POST", `/group-posts/${postId}/report`, body), { params: { postId } });

    expect((await rep(ana.member.sessionToken)).status).toBe(400); // own post
    expect((await rep(out.member.sessionToken)).status).toBe(404); // not in the group
    expect((await rep(bob.member.sessionToken, { reason: "x" })).status).toBe(400);
    expect((await rep(bob.member.sessionToken)).status).toBe(200);
    expect((await rep(bob.member.sessionToken)).status).toBe(200); // idempotent

    const reported = (await (await adminPosts(a(sup.token, "GET", `/admin/groups/${id}/posts?filter=reported`), gp(id))).json()).data;
    expect(reported.items).toHaveLength(1);
    expect(reported.items[0]).toMatchObject({ id: postId, reportCount: 1, status: "VISIBLE" });
    expect((await (await adminList(a(sup.token, "GET", "/admin/groups"))).json()).data.groups[0]).toMatchObject({ openReportCount: 1, postCount: 1, memberCount: 2 });

    const hide = (body: unknown) => adminHide(a(sup.token, "PATCH", `/admin/group-posts/${postId}`, body), { params: { postId } });
    expect((await hide({ hidden: true })).status).toBe(400);
    expect((await hide({ hidden: true, reason: "spam" })).status).toBe(400); // < 5 chars
    expect((await hide({ hidden: true, reason: "Spam / advertising" })).status).toBe(200);
    expect((await hide({ hidden: true, reason: "Spam / advertising" })).status).toBe(409);
    expect(await feedBodies(bob.member.sessionToken, id)).toEqual([]);
    expect(await feedBodies(ana.member.sessionToken, id)).toEqual([]);
    const hiddenList = (await (await adminPosts(a(sup.token, "GET", `/admin/groups/${id}/posts?filter=hidden`), gp(id))).json()).data.items;
    expect(hiddenList[0]).toMatchObject({ id: postId, status: "HIDDEN", hiddenReason: "Spam / advertising" });
    expect((await db.select().from(notifications).where(eq(notifications.userId, ana.member.userId))).some((n) => /group post/i.test(n.title))).toBe(true);

    expect((await hide({ hidden: false })).status).toBe(200);
    expect(await feedBodies(bob.member.sessionToken, id)).toEqual(["buy my product, call 99999"]);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, postId)));
    expect(logs.map((l) => l.action).sort()).toEqual(["group_post.hidden", "group_post.restored"]);
    expect(JSON.stringify(logs)).not.toContain("buy my product"); // bodies never go into the audit log
  });

  it("[gr-remove] an admin removal blocks reading, writing and rejoining until restored", async () => {
    const id = await newGroup();
    const ana = await ready("gr-ra");
    await join(ana.member.sessionToken, id);
    const mem = (await (await adminMembers(a(sup.token, "GET", `/admin/groups/${id}/members`), gp(id))).json()).data.members;
    expect(mem).toHaveLength(1);
    const rm = (body: unknown) => adminMember(a(sup.token, "PATCH", `/admin/groups/${id}/members/${ana.member.userId}`, body), { params: { groupId: id, userId: ana.member.userId } });

    expect((await rm({ removed: true })).status).toBe(400);
    expect((await rm({ removed: true, reason: "Repeated spam" })).status).toBe(200);
    expect((await rm({ removed: true, reason: "Repeated spam" })).status).toBe(409);
    expect((await feed(ana.member.sessionToken, id)).status).toBe(403);
    expect((await post(ana.member.sessionToken, id, { body: "still here?" })).status).toBe(403);
    expect((await join(ana.member.sessionToken, id)).status).toBe(403);
    expect((await (await listGroups(m(ana.member.sessionToken, "GET", "/groups"))).json()).data.groups[0]).toMatchObject({ joined: false, removed: true });

    expect((await rm({ removed: false })).status).toBe(200);
    expect((await join(ana.member.sessionToken, id)).status).toBe(200);
    expect((await feed(ana.member.sessionToken, id)).status).toBe(200);
    const acts = (await db.select().from(auditLogs)).map((l) => l.action);
    expect(acts).toContain("group_member.removed");
    expect(acts).toContain("group_member.restored");
  });
});
