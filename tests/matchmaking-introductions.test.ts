/**
 * Super Admin introductions between two members:
 *  - work without any paid Personal Matchmaking case (neither member has bought the service);
 *  - only between members who pass the eligibility rules in both directions (account, profile, approval,
 *    visibility, opt-out, age, gender preference, blocks), never between already-matched members, one open per pair;
 *  - each member answers separately; both accepting is NOT a match: no interest, match or chat is created;
 *  - members see only the normal member profile view (no contact details) and never the other's answer early;
 *  - everything is recorded (initiating Super Admin, audit events) and members are notified in-app.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, chats, interests, matchmakingCases, matchmakingIntroductions, matches, notifications, payments, profiles, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { POST as blockRoute } from "@/app/api/v1/interactions/blocks/route";
import { POST as openChat } from "@/app/api/v1/chats/route";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { buildReadyProfile, resolveReferenceIds, type ReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { api, json } from "./helpers/matchmaking";

const B = "http://localhost/api/v1";
let refs: ReferenceIds;
let admin: TestAdmin;
let man: ReadyProfile;
let woman: ReadyProfile;

async function member(prefix: string, gender: "MALE" | "FEMALE") {
  __resetRateLimitsForTests();
  return buildReadyProfile(prefix, refs, { gender, dateOfBirth: gender === "MALE" ? "1992-04-04" : "1995-06-06" });
}

async function introduce(a: ReadyProfile, b: ReadyProfile, extra: Record<string, unknown> = {}) {
  return json(await api.admin.createIntroduction(admin.token, { userAId: a.member.userId, userBId: b.member.userId, ...extra }));
}

const mine = async (who: ReadyProfile) => (await json(await api.introductions(who.member.sessionToken))).body.data.introductions as Array<Record<string, unknown>>;

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  admin = await createAdmin("SUPER_ADMIN");
  man = await member("intro-man", "MALE");
  woman = await member("intro-woman", "FEMALE");
}, 120_000);

describe("Super Admin introductions — creation", () => {
  it("[intro-create-no-case] two members who never bought the service are introduced; the admin, time and audit are recorded; both are notified", async () => {
    const res = await introduce(man, woman, { messageToMembers: "You both love music.", internalNote: "met at the event" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.introduction.id as string;

    const [row] = await db.select().from(matchmakingIntroductions).where(eq(matchmakingIntroductions.id, id));
    expect(row).toMatchObject({ status: "PENDING", userAResponse: "PENDING", userBResponse: "PENDING", createdByAdminId: admin.id, internalNote: "met at the event" });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect([row.userAId, row.userBId].sort()).toEqual([man.member.userId, woman.member.userId].sort());
    expect(row.userAId < row.userBId).toBe(true);

    // no paid case and no payment were needed or created
    expect(await db.select().from(matchmakingCases)).toEqual([]);
    expect(await db.select().from(payments)).toEqual([]);

    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "matchmaking.introduction_created"), eq(auditLogs.entityId, id)));
    expect(audit).toMatchObject({ actorType: "ADMIN", actorId: admin.id, entityType: "matchmaking_introduction" });
    const notes = await db.select().from(notifications).where(like(notifications.dedupeKey, `introduction_created:${id}:%`));
    expect(notes.map((n) => n.userId).sort()).toEqual([man.member.userId, woman.member.userId].sort());
    expect(notes.every((n) => n.channel === "IN_APP")).toBe(true);

    // the admin note never reaches a member; the team message does
    const [seen] = await mine(woman);
    expect(seen).toMatchObject({ id, status: "PENDING", myResponse: "PENDING", messageFromTeam: "You both love music." });
    expect(JSON.stringify(seen)).not.toContain("met at the event");
  });

  it("[intro-ineligible] suspended, banned, opted-out, hidden, unapproved, incomplete, same-gender and blocked members cannot be introduced", async () => {
    const cases: Array<[string, (p: ReadyProfile) => Promise<unknown>]> = [
      ["suspended", (p) => db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, p.member.userId))],
      ["banned", (p) => db.update(users).set({ status: "BLOCKED" }).where(eq(users.id, p.member.userId))],
      ["deleted", (p) => db.update(users).set({ status: "DELETED_PENDING" }).where(eq(users.id, p.member.userId))],
      ["opted-out", (p) => api.optOut(p.member.sessionToken, true)],
      ["hidden", (p) => db.update(profiles).set({ profileVisibility: "HIDDEN" }).where(eq(profiles.userId, p.member.userId))],
      ["unapproved", (p) => db.update(profiles).set({ approvalStatus: "PENDING" }).where(eq(profiles.userId, p.member.userId))],
      ["incomplete", (p) => db.update(profiles).set({ profileStatus: "INCOMPLETE" }).where(eq(profiles.userId, p.member.userId))],
      ["underage", (p) => db.update(profiles).set({ dateOfBirth: new Date(Date.now() - 17 * 365 * 86_400_000) }).where(eq(profiles.userId, p.member.userId))],
    ];
    for (const [label, spoil] of cases) {
      const w = await member(`intro-bad-${label}`, "FEMALE");
      await spoil(w);
      const preview = await json(await api.admin.previewIntroduction(admin.token, man.member.userId, w.member.userId));
      expect(preview.status, label).toBe(200);
      expect(preview.body.data.preview.eligible, label).toBe(false);
      expect(preview.body.data.preview.problems.length, label).toBeGreaterThan(0);
      expect((await introduce(man, w)).status, label).toBe(409);
      // the introduction search does not list them at all
      const found = await json(await api.admin.searchMembers(admin.token, w.member.email ?? `intro-bad-${label}`));
      expect(found.body.data.members.map((m: { userId: string }) => m.userId), label).not.toContain(w.member.userId);
    }

    const otherMan = await member("intro-same-gender", "MALE");
    expect((await json(await api.admin.previewIntroduction(admin.token, man.member.userId, otherMan.member.userId))).body.data.preview.eligible).toBe(false);
    expect((await introduce(man, otherMan)).status).toBe(409);

    const blocked = await member("intro-blocked", "FEMALE");
    expect((await blockRoute(jreq(`${B}/interactions/blocks`, { body: { targetUserId: man.member.userId }, token: blocked.member.sessionToken }))).status).toBe(201);
    const p = (await json(await api.admin.previewIntroduction(admin.token, man.member.userId, blocked.member.userId))).body.data.preview;
    expect(p.eligible).toBe(false);
    expect(p.blocks).toEqual({ aBlockedB: false, bBlockedA: true });
    expect((await introduce(man, blocked)).status).toBe(409);
    expect(await db.select().from(matchmakingIntroductions)).toEqual([]);
  }, 240_000);

  it("[intro-one-open-per-pair] a second open introduction for the same pair (either order) is refused; after it closes a new one is allowed", async () => {
    const first = await introduce(man, woman);
    expect(first.status).toBe(201);
    expect((await introduce(woman, man)).status).toBe(409);
    const racing = await Promise.all([introduce(man, woman), introduce(woman, man)]);
    expect(racing.map((r) => r.status)).toEqual([409, 409]);
    expect((await api.admin.withdrawIntroduction(admin.token, first.body.data.introduction.id)).status).toBe(200);
    expect((await introduce(woman, man)).status).toBe(201);
  });

  it("[intro-preview-details] the preview shows completeness, statuses, blocks and compatibility for both members", async () => {
    const res = await json(await api.admin.previewIntroduction(admin.token, man.member.userId, woman.member.userId));
    expect(res.status).toBe(200);
    const p = res.body.data.preview;
    expect(p.eligible).toBe(true);
    expect(p.members.a).toMatchObject({ userId: man.member.userId, accountStatus: "ACTIVE", approvalStatus: "APPROVED", profileVisibility: "VISIBLE", companyVerificationStatus: "NONE", introducible: true });
    expect(typeof p.members.a.profileCompletionPercent).toBe("number");
    expect(p.blocks).toEqual({ aBlockedB: false, bBlockedA: false });
    expect(p.alreadyMatched).toBe(false);
    expect(p).toHaveProperty("compatibility.aToB");
  });
});

describe("Super Admin introductions — separate consent, no automatic match", () => {
  it("[intro-mutual-no-match] both accepting is recorded per member and notified, but creates no interest, match or chat", async () => {
    const id = (await introduce(man, woman)).body.data.introduction.id as string;

    const a1 = await json(await api.respondIntroduction(man.member.sessionToken, id, "ACCEPT"));
    expect(a1.status).toBe(200);
    expect(a1.body.data.introduction).toMatchObject({ status: "PENDING", myResponse: "ACCEPTED" });
    // the other member does not learn the first answer early
    const [hers] = await mine(woman);
    expect(hers).toMatchObject({ status: "PENDING", myResponse: "PENDING" });
    expect(JSON.stringify(hers)).not.toContain("ACCEPTED");

    const a2 = await json(await api.respondIntroduction(woman.member.sessionToken, id, "ACCEPT"));
    expect(a2.body.data.introduction).toMatchObject({ status: "MUTUALLY_ACCEPTED", myResponse: "ACCEPTED" });
    const [row] = await db.select().from(matchmakingIntroductions).where(eq(matchmakingIntroductions.id, id));
    expect(row).toMatchObject({ status: "MUTUALLY_ACCEPTED", userAResponse: "ACCEPTED", userBResponse: "ACCEPTED" });
    expect(row.userARespondedAt).toBeInstanceOf(Date);
    expect(row.userBRespondedAt).toBeInstanceOf(Date);
    expect(await db.select().from(notifications).where(like(notifications.dedupeKey, `introduction_mutual:${id}:%`))).toHaveLength(2);

    const pair = [man.member.userId, woman.member.userId];
    expect(await db.select().from(interests).where(or(inArray(interests.fromUserId, pair), inArray(interests.toUserId, pair)))).toEqual([]);
    expect(await db.select().from(matches).where(or(inArray(matches.userAId, pair), inArray(matches.userBId, pair)))).toEqual([]);
    expect(await db.select().from(chats)).toEqual([]);
    const chat = await openChat(jreq(`${B}/chats`, { body: { counterpartUserId: woman.member.userId }, token: man.member.sessionToken }));
    expect(chat.status).toBe(404); // no match → no chat

    // answering twice is refused; an acceptance can be withdrawn, which closes it for both
    expect((await api.respondIntroduction(man.member.sessionToken, id, "ACCEPT")).status).toBe(409);
    const w = await json(await api.respondIntroduction(man.member.sessionToken, id, "WITHDRAW"));
    expect(w.status).toBe(200);
    expect(w.body.data.introduction).toBeNull();
    expect((await db.select().from(matchmakingIntroductions).where(eq(matchmakingIntroductions.id, id)))[0]).toMatchObject({ status: "WITHDRAWN", userAResponse: expect.any(String) });
    expect(await mine(woman)).toEqual([]);
  });

  it("[intro-decline] a decline closes the introduction; the other member gets a neutral notice and can no longer answer", async () => {
    const id = (await introduce(man, woman)).body.data.introduction.id as string;
    expect((await api.respondIntroduction(woman.member.sessionToken, id, "DECLINE")).status).toBe(200);
    const [row] = await db.select().from(matchmakingIntroductions).where(eq(matchmakingIntroductions.id, id));
    expect(row.status).toBe("DECLINED");
    expect(row.closedAt).toBeInstanceOf(Date);
    const [notice] = await db.select().from(notifications).where(eq(notifications.dedupeKey, `introduction_closed:${id}:${man.member.userId}`));
    expect(notice.body).not.toMatch(/declin/i);
    expect((await api.respondIntroduction(man.member.sessionToken, id, "ACCEPT")).status).toBe(404);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "matchmaking.introduction_answered"), eq(auditLogs.entityId, id)));
    expect(audit.map((a) => a.actorId)).toEqual([woman.member.userId]);
  });

  it("[intro-privacy] members see the normal member view without contact details; other members cannot see or answer it", async () => {
    const id = (await introduce(man, woman)).body.data.introduction.id as string;
    const [seen] = await mine(man);
    const profile = seen.profile as Record<string, unknown>;
    expect(profile.userId).toBe(woman.member.userId);
    for (const key of ["email", "mobileNumber", "phone", "dateOfBirth"]) expect(Object.keys(profile)).not.toContain(key);
    expect(JSON.stringify(seen)).not.toContain(woman.member.email ?? "@@none@@");

    const stranger = await member("intro-stranger", "FEMALE");
    expect(await mine(stranger)).toEqual([]);
    expect((await api.respondIntroduction(stranger.member.sessionToken, id, "ACCEPT")).status).toBe(404);
    // an admin token is not a member
    expect((await api.introductions(admin.token)).status).toBe(403);
  });

  it("[intro-stale] after a block the introduction disappears for both members and can no longer be answered", async () => {
    const id = (await introduce(man, woman)).body.data.introduction.id as string;
    expect((await blockRoute(jreq(`${B}/interactions/blocks`, { body: { targetUserId: man.member.userId }, token: woman.member.sessionToken }))).status).toBe(201);
    expect(await mine(man)).toEqual([]);
    expect(await mine(woman)).toEqual([]);
    expect((await api.respondIntroduction(man.member.sessionToken, id, "ACCEPT")).status).toBe(404);
  });

  it("[intro-admin-withdraw] a Super Admin can withdraw an open introduction; both are told it closed; it is audited", async () => {
    const id = (await introduce(man, woman)).body.data.introduction.id as string;
    const res = await json(await api.admin.withdrawIntroduction(admin.token, id));
    expect(res.status).toBe(200);
    expect(res.body.data.introduction).toMatchObject({ status: "WITHDRAWN", withdrawnByAdminId: admin.id });
    expect((await api.admin.withdrawIntroduction(admin.token, id)).status).toBe(409);
    expect(await db.select().from(notifications).where(like(notifications.dedupeKey, `introduction_closed:${id}:%`))).toHaveLength(2);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "matchmaking.introduction_withdrawn"), eq(auditLogs.entityId, id)))).toHaveLength(1);
    const list = await json(await api.admin.listIntroductions(admin.token, "?status=WITHDRAWN"));
    expect(list.body.data.items.map((i: { id: string }) => i.id)).toEqual([id]);
  });

  it("[intro-not-verification] choosing members for an introduction never marks them Company Verified", async () => {
    await introduce(man, woman);
    const rows = await db.select({ s: profiles.companyVerificationStatus }).from(profiles).where(inArray(profiles.userId, [man.member.userId, woman.member.userId]));
    expect(rows.map((r) => r.s)).toEqual(["NONE", "NONE"]);
  });
});

describe("Super Admin overview and best matches", () => {
  it("[intro-overview] the overview counts open introductions and open verification reviews (counts only)", async () => {
    const before = (await json(await api.admin.overview(admin.token))).body.data.overview;
    expect(before).toEqual({
      cases: { PENDING_PAYMENT: 0, ACTIVE: 0, IN_PROGRESS: 0 },
      duplicateCaptures: 0,
      introductions: { PENDING: 0, MUTUALLY_ACCEPTED: 0 },
      verificationReviewsOpen: 0,
    });
    const id = (await introduce(man, woman)).body.data.introduction.id as string;
    expect((await json(await api.admin.decideCompanyVerification(admin.token, woman.member.userId, { status: "PENDING" }))).status).toBe(200);
    let o = (await json(await api.admin.overview(admin.token))).body.data.overview;
    expect(o.introductions).toEqual({ PENDING: 1, MUTUALLY_ACCEPTED: 0 });
    expect(o.verificationReviewsOpen).toBe(1);
    await api.respondIntroduction(man.member.sessionToken, id, "ACCEPT");
    await api.respondIntroduction(woman.member.sessionToken, id, "ACCEPT");
    o = (await json(await api.admin.overview(admin.token))).body.data.overview;
    expect(o.introductions).toEqual({ PENDING: 0, MUTUALLY_ACCEPTED: 1 });
    expect(JSON.stringify(o)).not.toContain(woman.member.email);
  });

  it("[intro-candidates] best matches list only eligible members of the right gender, excluding blocked and already-introduced ones", async () => {
    const other = await member("intro-cand-other", "FEMALE");
    const blocked = await member("intro-cand-blocked", "FEMALE");
    const hidden = await member("intro-cand-hidden", "FEMALE");
    const sameGender = await member("intro-cand-man", "MALE");
    await db.update(profiles).set({ profileVisibility: "HIDDEN" }).where(eq(profiles.userId, hidden.member.userId));
    expect((await blockRoute(jreq(`${B}/interactions/blocks`, { body: { targetUserId: man.member.userId }, token: blocked.member.sessionToken }))).status).toBe(201);

    const ids = async () =>
      ((await json(await api.admin.introductionCandidates(admin.token, man.member.userId))).body.data.items as Array<{ member: { userId: string } }>).map((i) => i.member.userId);
    let found = await ids();
    expect(found).toContain(woman.member.userId);
    expect(found).toContain(other.member.userId);
    for (const excluded of [blocked, hidden, sameGender, man]) expect(found).not.toContain(excluded.member.userId);

    // once introduced, she is no longer offered for him
    expect((await introduce(man, woman)).status).toBe(201);
    found = await ids();
    expect(found).not.toContain(woman.member.userId);
    expect(found).toContain(other.member.userId);

    // a member who cannot be introduced gets no list at all
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, other.member.userId));
    const none = (await json(await api.admin.introductionCandidates(admin.token, other.member.userId))).body.data;
    expect(none.member.introducible).toBe(false);
    expect(none.items).toEqual([]);
    expect(await db.select().from(matchmakingIntroductions)).toHaveLength(1); // listing never creates anything
  }, 180_000);
});
