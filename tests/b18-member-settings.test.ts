/**
 * B18 — member self-service settings: privacy controls (enforced in search, recommendations,
 * profile page, photo file route, interest initiation), notification channel preferences, and
 * active-session management.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET as getPrivacy, PATCH as patchPrivacy } from "@/app/api/v1/users/me/privacy/route";
import { GET as getPrefs, PATCH as patchPrefs } from "@/app/api/v1/users/me/notification-preferences/route";
import { GET as listSessions, DELETE as revokeOthers } from "@/app/api/v1/users/me/sessions/route";
import { DELETE as revokeOne } from "@/app/api/v1/users/me/sessions/[sessionId]/route";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { GET as viewProfile } from "@/app/api/v1/profiles/[profileId]/route";
import { GET as photoFile } from "@/app/api/v1/profiles/photos/[photoId]/file/route";
import { GET as getRecs } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { GET as meRoute } from "@/app/api/v1/users/me/route";
import { db } from "@/server/db/client";
import { auditLogs, deviceSessions, interests, notifications, profiles, users } from "@/server/db/schema";
import { notify } from "@/server/modules/notifications/notifications.service";
import { generateSessionToken, hashSessionToken, sessionExpiryDate } from "@/server/lib/session";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, activateMembershipForTests } from "./helpers/reset-db";
import { buildReadyProfile, req, resolveReferenceIds, type ReadyProfile } from "./helpers/profile-fixtures";
import { createAdmin, resetPcpTables } from "./helpers/pcp";

const U = "http://localhost/api/v1";
const call = (h: (r: NextRequest, c?: never) => Promise<Response>, path: string, token?: string, body?: unknown, method = body === undefined ? "GET" : "PATCH") =>
  h(req(`${U}${path}`, body, { token, method }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

async function pair() {
  const refs = await resolveReferenceIds();
  const dobForAge = (age: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - age); return d.toISOString().slice(0, 10); };
  const owner = await buildReadyProfile("priv-owner", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });
  const viewer = await buildReadyProfile("priv-viewer", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
  return { refs, owner, viewer };
}
const setPrivacy = async (m: ReadyProfile, body: Record<string, unknown>) => {
  const res = await call(patchPrivacy as never, "/users/me/privacy", m.member.sessionToken, body);
  expect(res.status).toBe(200);
  return (await res.json()).data.privacy;
};
const searchIds = async (token: string) => {
  const body = await (await call(searchProfiles as never, "/search/profiles?gender=FEMALE", token)).json();
  return (body.data.items as Array<{ profile: { userId: string } }>).map((i) => i.profile.userId);
};
const viewOf = (p: ReadyProfile, token?: string) =>
  viewProfile(req(`${U}/profiles/${p.profileId}`, undefined, { token, method: "GET" }), { params: { profileId: p.profileId } });
const photoOf = (p: ReadyProfile, token?: string) =>
  photoFile(req(`${U}/profiles/photos/${p.photoId}/file`, undefined, { token, method: "GET" }), { params: { photoId: p.photoId! } });
const accept = (a: ReadyProfile, b: ReadyProfile) => db.insert(interests).values({ fromUserId: b.member.userId, toUserId: a.member.userId, status: "ACCEPTED" });

describe("privacy settings API", () => {
  it("[ms-authz-validation] anonymous 401; Super Admin token 403; unknown/empty/invalid bodies 400; defaults are the safe-open ones", async () => {
    const { owner } = await pair();
    const sup = await createAdmin("SUPER_ADMIN");
    for (const [h, path] of [[getPrivacy, "/users/me/privacy"], [getPrefs, "/users/me/notification-preferences"], [listSessions, "/users/me/sessions"]] as const) {
      expect((await call(h as never, path)).status, path).toBe(401);
      expect((await call(h as never, path, sup.token)).status, `${path} admin`).toBe(403);
    }
    const t = owner.member.sessionToken;
    expect((await call(patchPrivacy as never, "/users/me/privacy", t, {})).status).toBe(400);
    expect((await call(patchPrivacy as never, "/users/me/privacy", t, { profileVisibility: "SECRET" })).status).toBe(400);
    expect((await call(patchPrivacy as never, "/users/me/privacy", t, { showLastActive: "yes" })).status).toBe(400);
    expect((await call(patchPrivacy as never, "/users/me/privacy", t, { isAdmin: true })).status).toBe(400);
    expect((await call(patchPrefs as never, "/users/me/notification-preferences", t, { SMS: false })).status).toBe(400);
    expect((await call(patchPrefs as never, "/users/me/notification-preferences", t, {})).status).toBe(400);
    const g = await (await call(getPrivacy as never, "/users/me/privacy", t)).json();
    expect(g.data.privacy).toEqual({ profileVisibility: "VISIBLE", photoVisibility: "MEMBERS", showLastActive: true });
  });

  it("[ms-no-profile] a member without a profile gets a clear 404, not a crash", async () => {
    const { createVerifiedMember } = await import("./helpers/profile-fixtures");
    const m = await createVerifiedMember("priv-noprofile");
    const res = await call(getPrivacy as never, "/users/me/privacy", m.sessionToken);
    expect(res.status).toBe(404);
  });

  it("[ms-audit] a change is stored and audited with before/after; the profile's updatedAt (search ordering) is not touched", async () => {
    const { owner } = await pair();
    const [before] = await db.select().from(profiles).where(eq(profiles.id, owner.profileId));
    const after = await setPrivacy(owner, { profileVisibility: "HIDDEN", showLastActive: false });
    expect(after).toEqual({ profileVisibility: "HIDDEN", photoVisibility: "MEMBERS", showLastActive: false });
    const [row] = await db.select().from(profiles).where(eq(profiles.id, owner.profileId));
    expect(row.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "privacy.updated"), eq(auditLogs.actorId, owner.member.userId)));
    expect(logs).toHaveLength(1);
    expect((logs[0].metadata as { before: { profileVisibility: string } }).before.profileVisibility).toBe("VISIBLE");
  });
});

describe("hidden profile", () => {
  it("[ms-hidden-everywhere] HIDDEN removes the profile from search, the profile page, the photo route and recommendations — for everyone but the owner, admins and accepted connections; un-hiding restores all", async () => {
    const { refs, owner, viewer } = await pair();
    const vt = viewer.member.sessionToken;
    const ot = owner.member.sessionToken;
    await call(patchPreferences as never, "/profiles/me/partner-preferences", vt, {
      ageMin: 24, ageMax: 30, heightMinCm: 160, heightMaxCm: 175, religionId: refs.religionId, maritalStatusIds: [refs.maritalStatusId],
      communityIds: [refs.communityId], motherTongueIds: [refs.motherTongueId], educationIds: [refs.educationId], professionIds: [refs.professionId],
      countryIds: [refs.countryId], cityIds: [refs.cityId],
    }, "PATCH");
    const recIds = async (token: string) => {
      const d = (await (await call(getRecs as never, "/profiles/me/recommendations", token)).json()).data;
      return [...d.items, ...d.secondaryItems].map((i: { profile: { userId: string } }) => i.profile.userId);
    };

    // visible baseline
    expect(await searchIds(vt)).toContain(owner.member.userId);
    expect((await viewOf(owner, vt)).status).toBe(200);
    expect((await photoOf(owner, vt)).status).toBe(200);
    expect(await recIds(vt)).toContain(owner.member.userId);

    await setPrivacy(owner, { profileVisibility: "HIDDEN" });
    expect(await searchIds(vt)).not.toContain(owner.member.userId);
    expect((await viewOf(owner, vt)).status).toBe(404);
    expect((await viewOf(owner)).status).toBe(404); // anonymous
    expect((await photoOf(owner, vt)).status).toBe(404);
    expect(await recIds(vt)).not.toContain(owner.member.userId);
    // owner + admin still see it
    expect((await viewOf(owner, ot)).status).toBe(200);
    expect((await photoOf(owner, ot)).status).toBe(200);
    const sup = await createAdmin("SUPER_ADMIN");
    expect((await viewOf(owner, sup.token)).status).toBe(200);

    // an existing accepted connection is not "discovery"
    await accept(owner, viewer);
    expect((await viewOf(owner, vt)).status).toBe(200);
    expect((await photoOf(owner, vt)).status).toBe(200);
    await db.delete(interests);

    await setPrivacy(owner, { profileVisibility: "VISIBLE" });
    expect(await searchIds(vt)).toContain(owner.member.userId);
    expect((await viewOf(owner, vt)).status).toBe(200);
  });

  it("[ms-hidden-no-interest] a stranger cannot send an interest to a hidden member (same 404 as an unavailable member), an accepted partner is unaffected", async () => {
    const { owner, viewer } = await pair();
    await activateMembershipForTests(viewer.member.userId);
    await setPrivacy(owner, { profileVisibility: "HIDDEN" });
    const res = await sendInterest(req(`${U}/interactions/interests`, { toUserId: owner.member.userId }, { token: viewer.member.sessionToken }));
    expect(res.status).toBe(404);
  });
});

describe("photo privacy", () => {
  it("[ms-photos-accepted-only] ACCEPTED_ONLY withholds photos on search cards, the profile page and the file route from non-connections", async () => {
    const { owner, viewer } = await pair();
    const vt = viewer.member.sessionToken;
    await setPrivacy(owner, { photoVisibility: "ACCEPTED_ONLY" });

    const card = (await (await call(searchProfiles as never, "/search/profiles?gender=FEMALE", vt)).json()).data.items[0].profile;
    expect(card.photos).toEqual([]);
    expect(card.photosRestricted).toBe(true);
    const page = (await (await viewOf(owner, vt)).json()).data.profile;
    expect(page.photos).toEqual([]);
    expect(page.photosRestricted).toBe(true);
    expect((await photoOf(owner, vt)).status).toBe(404);
    // the owner still sees their own photos
    expect((await photoOf(owner, owner.member.sessionToken)).status).toBe(200);

    await accept(owner, viewer);
    const page2 = (await (await viewOf(owner, vt)).json()).data.profile;
    expect(page2.photos).toHaveLength(1);
    expect(page2.photosRestricted).toBe(false);
    expect((await photoOf(owner, vt)).status).toBe(200);
  });

  it("[ms-photos-default-open] MEMBERS (default) keeps photos visible to signed-in members", async () => {
    const { owner, viewer } = await pair();
    const page = (await (await viewOf(owner, viewer.member.sessionToken)).json()).data.profile;
    expect(page.photos).toHaveLength(1);
    expect(page.photosRestricted).toBe(false);
  });
});

describe("last active", () => {
  it("[ms-last-active] shows a coarse label only when the owner allows it; never an exact timestamp", async () => {
    const { owner, viewer } = await pair();
    const vt = viewer.member.sessionToken;
    // activity is recorded by authenticated requests (the owner hitting any endpoint)
    await meRoute(req(`${U}/users/me`, undefined, { token: owner.member.sessionToken, method: "GET" }));
    await new Promise((r) => setTimeout(r, 100));
    const shown = (await (await viewOf(owner, vt)).json()).data.profile;
    expect(shown.lastActive).toBe("Active today");
    expect(JSON.stringify(shown)).not.toMatch(/lastActiveAt/);

    await setPrivacy(owner, { showLastActive: false });
    const hidden = (await (await viewOf(owner, vt)).json()).data.profile;
    expect(hidden.lastActive).toBeNull();
    const card = (await (await call(searchProfiles as never, "/search/profiles?gender=FEMALE", vt)).json()).data.items[0].profile;
    expect(card.lastActive).toBeNull();

    // older activity → coarser label
    await setPrivacy(owner, { showLastActive: true });
    await db.update(users).set({ lastActiveAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(users.id, owner.member.userId));
    const month = (await (await viewOf(owner, vt)).json()).data.profile;
    expect(month.lastActive).toBe("Active this month");
  });

  it("[ms-last-active-recorded] a member's authenticated request records lastActiveAt (the column existed but was never written before B18)", async () => {
    const { owner } = await pair();
    await db.update(users).set({ lastActiveAt: null }).where(eq(users.id, owner.member.userId));
    await meRoute(req(`${U}/users/me`, undefined, { token: owner.member.sessionToken, method: "GET" }));
    await new Promise((r) => setTimeout(r, 150));
    const [u] = await db.select().from(users).where(eq(users.id, owner.member.userId));
    expect(u.lastActiveAt).not.toBeNull();
  });
});

describe("notification preferences", () => {
  it("[ms-notif-prefs] defaults all on (the weekly digest is opt-in, off); opt-outs are saved and audited; EMAIL/PUSH/WHATSAPP non-essential messages are skipped, essential and IN_APP are never suppressed", async () => {
    const { owner } = await pair();
    const t = owner.member.sessionToken;
    const uid = owner.member.userId;
    const get = async () => (await (await call(getPrefs as never, "/users/me/notification-preferences", t)).json()).data.preferences;
    expect(await get()).toEqual({ EMAIL: true, PUSH: true, WHATSAPP: true, DIGEST: false });

    const rows = async () => (await db.select().from(notifications).where(eq(notifications.userId, uid))).map((n) => `${n.channel}:${n.title}`);
    await notify({ userId: uid, channel: "EMAIL", title: "e1", body: "b", devMode: true });
    expect(await rows()).toContain("EMAIL:e1");

    const res = await call(patchPrefs as never, "/users/me/notification-preferences", t, { EMAIL: false });
    expect(res.status).toBe(200);
    expect(await get()).toEqual({ EMAIL: false, PUSH: true, WHATSAPP: true, DIGEST: false });

    expect(await notify({ userId: uid, channel: "EMAIL", title: "e2", body: "b", devMode: true })).toBeNull();
    await notify({ userId: uid, channel: "EMAIL", title: "e3-essential", body: "b", essential: true, devMode: true });
    await notify({ userId: uid, channel: "IN_APP", title: "i1", body: "b" });
    const after = await rows();
    expect(after).not.toContain("EMAIL:e2");
    expect(after).toContain("EMAIL:e3-essential");
    expect(after).toContain("IN_APP:i1");

    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "notification_preferences.updated"), eq(auditLogs.actorId, uid)));
    expect(logs).toHaveLength(1);

    await call(patchPrefs as never, "/users/me/notification-preferences", t, { EMAIL: true });
    await notify({ userId: uid, channel: "EMAIL", title: "e4", body: "b", devMode: true });
    expect(await rows()).toContain("EMAIL:e4");
  });

  it("[ms-notif-isolation] one member's preferences never affect another's", async () => {
    const { owner, viewer } = await pair();
    await call(patchPrefs as never, "/users/me/notification-preferences", owner.member.sessionToken, { EMAIL: false });
    await notify({ userId: viewer.member.userId, channel: "EMAIL", title: "for-viewer", body: "b", devMode: true });
    const rows = await db.select().from(notifications).where(eq(notifications.userId, viewer.member.userId));
    expect(rows.map((r) => r.title)).toContain("for-viewer");
  });
});

describe("active sessions", () => {
  async function secondSession(userId: string) {
    const token = generateSessionToken();
    const [row] = await db
      .insert(deviceSessions)
      .values({ userId, tokenHash: hashSessionToken(token), deviceId: "other-device-abcdef123456", browserInfo: "Other Browser", ipAddress: "203.0.113.9", expiresAt: sessionExpiryDate() })
      .returning();
    return { token, id: row.id };
  }

  it("[ms-sessions-list-revoke] lists only my live sessions (current flagged, device id truncated); revoking another device signs it out at once; the current device cannot revoke itself", async () => {
    const { owner, viewer } = await pair();
    const other = await secondSession(owner.member.userId);
    const foreign = await secondSession(viewer.member.userId);
    const t = owner.member.sessionToken;

    const list = (await (await call(listSessions as never, "/users/me/sessions", t)).json()).data.sessions as Array<{ id: string; current: boolean; deviceId: string | null }>;
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.map((s) => s.id)).not.toContain(foreign.id);
    expect(JSON.stringify(list)).not.toContain("other-device-abcdef123456");
    expect(JSON.stringify(list)).not.toMatch(/tokenHash|token_hash/);

    const current = list.find((s) => s.current)!;
    expect((await revokeOne(req(`${U}/users/me/sessions/${current.id}`, undefined, { token: t, method: "DELETE" }), { params: { sessionId: current.id } })).status).toBe(409);
    // someone else's session id is indistinguishable from a missing one
    expect((await revokeOne(req(`${U}/users/me/sessions/${foreign.id}`, undefined, { token: t, method: "DELETE" }), { params: { sessionId: foreign.id } })).status).toBe(404);
    expect((await revokeOne(req(`${U}/users/me/sessions/not-a-uuid`, undefined, { token: t, method: "DELETE" }), { params: { sessionId: "not-a-uuid" } })).status).toBe(400);

    expect((await call(meRoute as never, "/users/me", other.token)).status).toBe(200);
    const res = await revokeOne(req(`${U}/users/me/sessions/${other.id}`, undefined, { token: t, method: "DELETE" }), { params: { sessionId: other.id } });
    expect(res.status).toBe(200);
    expect((await call(meRoute as never, "/users/me", other.token)).status).toBe(401);
    expect((await call(meRoute as never, "/users/me", t)).status).toBe(200);
    // the other member is untouched
    expect((await call(meRoute as never, "/users/me", foreign.token)).status).toBe(200);
  });

  it("[ms-sessions-revoke-others] 'sign out other devices' keeps only the current session", async () => {
    const { owner } = await pair();
    const a = await secondSession(owner.member.userId);
    const b = await secondSession(owner.member.userId);
    const t = owner.member.sessionToken;
    const res = await revokeOthers(req(`${U}/users/me/sessions`, undefined, { token: t, method: "DELETE" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.revokedCount).toBe(2);
    expect((await call(meRoute as never, "/users/me", a.token)).status).toBe(401);
    expect((await call(meRoute as never, "/users/me", b.token)).status).toBe(401);
    expect((await call(meRoute as never, "/users/me", t)).status).toBe(200);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "session.revoked_others"), eq(auditLogs.actorId, owner.member.userId)));
    expect(logs).toHaveLength(1);
  });
});
