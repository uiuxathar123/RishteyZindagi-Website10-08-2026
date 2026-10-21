/**
 * Super Admin members directory and invitations to Personal Matchmaking:
 *  - the directory lists every member account (with or without a profile) with what can be done for each;
 *  - OFFER: the member is told and buys through the normal checkout, which accepts the invitation;
 *  - COMPLIMENTARY: nothing starts until the member accepts with consent; then a free case opens (no payment, no
 *    invoice) with the chosen included access, which grants the same member access as a paid case;
 *  - declining, revoking and the refusal rules (no profile, inactive account, opted out, open case, pending invite).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, invoices, matchmakingCases, matchmakingInvitations, notifications, payments, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { hasActiveMembership } from "@/server/modules/memberships/membership-gate";
import { MATCHMAKING_CONSENT_VERSION } from "@/server/modules/matchmaking/matchmaking-settings";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember, resolveReferenceIds, type ReferenceIds, type ReadyProfile } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { SETTINGS, api, buildCustomer, buyMatchmaking, configure, json } from "./helpers/matchmaking";
import { GET as myMembershipRoute } from "@/app/api/v1/memberships/me/route";

const DAY = 24 * 60 * 60 * 1000;
let refs: ReferenceIds;
let admin: TestAdmin;
let member: ReadyProfile;

const invite = async (userId: string, body: Record<string, unknown> = {}) => json(await api.admin.invite(admin.token, { userId, kind: "OFFER", ...body }));
const mine = async (who: ReadyProfile) => (await json(await api.mine(who.member.sessionToken))).body.data;
const consent = { response: "ACCEPT", consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION };

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __clearDevPaymentStoreForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  admin = await createAdmin("SUPER_ADMIN");
  await configure(admin.token);
  member = await buildCustomer("inv-member", refs);
}, 120_000);

describe("Invitations — normal offer", () => {
  it("[inv-offer] the member is notified and sees the invitation; starting the normal checkout accepts it", async () => {
    const sent = await invite(member.member.userId, { messageToMember: "We think you'd like this." });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const id = sent.body.data.invitation.id as string;
    const [row] = await db.select().from(matchmakingInvitations).where(eq(matchmakingInvitations.id, id));
    expect(row).toMatchObject({ kind: "OFFER", status: "PENDING", invitedByAdminId: admin.id, includedMembershipDays: null });
    expect(await db.select().from(notifications).where(eq(notifications.dedupeKey, `matchmaking_invitation:${id}`))).toHaveLength(1);
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "matchmaking.invitation_sent"), eq(auditLogs.entityId, id))))[0]).toMatchObject({ actorId: admin.id });

    expect((await mine(member)).invitation).toMatchObject({ id, kind: "OFFER", messageFromTeam: "We think you'd like this." });
    // an offer is not accepted through this endpoint — the member uses the normal checkout (and pays)
    expect((await api.respondInvitation(member.member.sessionToken, id, consent)).status).toBe(409);
    const { caseId } = await buyMatchmaking(member.member.sessionToken);
    const [after] = await db.select().from(matchmakingInvitations).where(eq(matchmakingInvitations.id, id));
    expect(after).toMatchObject({ status: "ACCEPTED", caseId });
    expect((await mine(member)).invitation).toBeNull();
  });

  it("[inv-offer-not-on-sale] a normal offer needs the service on sale; a complimentary one does not", async () => {
    await configure(admin.token, { ...SETTINGS, enabled: false });
    expect((await invite(member.member.userId)).status).toBe(409);
    expect((await invite(member.member.userId, { kind: "COMPLIMENTARY" })).status).toBe(201);
  });
});

describe("Invitations — complimentary", () => {
  it("[inv-comp] nothing starts until the member accepts with consent; then a free case grants the chosen access", async () => {
    const id = (await invite(member.member.userId, { kind: "COMPLIMENTARY", includedMembershipDays: 15 })).body.data.invitation.id as string;
    expect(await db.select().from(matchmakingCases).where(eq(matchmakingCases.userId, member.member.userId))).toEqual([]);
    expect(await hasActiveMembership(member.member.userId)).toBe(false);
    expect((await mine(member)).invitation).toMatchObject({ kind: "COMPLIMENTARY", includedMembershipDays: 15, consentVersion: MATCHMAKING_CONSENT_VERSION });

    expect((await api.respondInvitation(member.member.sessionToken, id, { response: "ACCEPT", consent: false, consentVersion: MATCHMAKING_CONSENT_VERSION })).status).toBe(400);
    expect((await api.respondInvitation(member.member.sessionToken, id, { ...consent, consentVersion: "old" })).status).toBe(409);

    const t0 = Date.now();
    const ok = await json(await api.respondInvitation(member.member.sessionToken, id, { ...consent, customerNotes: "Prefer Mumbai" }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const caseId = ok.body.data.caseId as string;
    const [c] = await db.select().from(matchmakingCases).where(eq(matchmakingCases.id, caseId));
    expect(c).toMatchObject({ status: "ACTIVE", complimentary: true, priceInPaise: 0, paidPaymentId: null, includedMembershipDays: 15, customerNotes: "Prefer Mumbai", consentVersion: MATCHMAKING_CONSENT_VERSION });
    expect(c.includedAccessUntil!.getTime()).toBeGreaterThanOrEqual(t0 + 15 * DAY - 5000);
    expect(c.includedAccessUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * DAY + 5000);
    expect(await hasActiveMembership(member.member.userId)).toBe(true);
    // the dashboard shows this access (it is not a plan, so isActive stays false)
    const mm = await json(await myMembershipRoute(jreq("http://localhost/api/v1/memberships/me", { token: member.member.sessionToken })));
    expect(mm.body.data).toMatchObject({ isActive: false, includedAccess: { until: c.includedAccessUntil!.toISOString() } });
    expect(await db.select().from(payments).where(eq(payments.userId, member.member.userId))).toEqual([]);
    expect(await db.select().from(invoices).where(eq(invoices.userId, member.member.userId))).toEqual([]);
    expect((await db.select().from(matchmakingInvitations).where(eq(matchmakingInvitations.id, id)))[0]).toMatchObject({ status: "ACCEPTED", caseId });

    // the member and the Super Admin see it as complimentary; it cannot be accepted twice
    expect((await mine(member)).case).toMatchObject({ id: caseId, status: "ACTIVE", complimentary: true });
    const listed = (await json(await api.admin.listCases(admin.token))).body.data.items.find((i: { id: string }) => i.id === caseId);
    expect(listed).toMatchObject({ complimentary: true, status: "ACTIVE" });
    expect((await api.respondInvitation(member.member.sessionToken, id, consent)).status).toBe(404);
    // a purchase is now refused like for any open case
    expect((await api.checkout(member.member.sessionToken)).status).toBe(409);
  });

  it("[inv-comp-zero-days] 0 days = the service only, without member access", async () => {
    const id = (await invite(member.member.userId, { kind: "COMPLIMENTARY", includedMembershipDays: 0 })).body.data.invitation.id as string;
    expect((await api.respondInvitation(member.member.sessionToken, id, consent)).status).toBe(200);
    expect(await hasActiveMembership(member.member.userId)).toBe(false);
  });
});

describe("Invitations — decline, revoke and refusals", () => {
  it("[inv-decline-revoke] a member can decline; a Super Admin can revoke a pending invitation; closed ones cannot be answered", async () => {
    const first = (await invite(member.member.userId)).body.data.invitation.id as string;
    expect((await json(await api.respondInvitation(member.member.sessionToken, first, { response: "DECLINE" }))).body.data.status).toBe("DECLINED");
    expect((await mine(member)).invitation).toBeNull();

    const second = (await invite(member.member.userId, { kind: "COMPLIMENTARY" })).body.data.invitation.id as string;
    const revoked = await json(await api.admin.revokeInvitation(admin.token, second));
    expect(revoked.body.data.invitation).toMatchObject({ status: "REVOKED", revokedByAdminId: admin.id });
    expect((await api.admin.revokeInvitation(admin.token, second)).status).toBe(409);
    expect((await api.respondInvitation(member.member.sessionToken, second, consent)).status).toBe(404);

    // nobody else can answer someone's invitation
    const third = (await invite(member.member.userId, { kind: "COMPLIMENTARY" })).body.data.invitation.id as string;
    const other = await buildCustomer("inv-other", refs, "FEMALE");
    expect((await api.respondInvitation(other.member.sessionToken, third, consent)).status).toBe(404);
    expect((await api.respondInvitation(admin.token, third, consent)).status).toBe(403);
  });

  it("[inv-refused] no profile, inactive account, opted out, open case and a second pending invitation are refused", async () => {
    __resetRateLimitsForTests();
    const noProfile = await createVerifiedMember("inv-no-profile");
    const suspended = await buildCustomer("inv-suspended", refs);
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, suspended.member.userId));
    const optedOut = await buildCustomer("inv-optout", refs);
    expect((await api.optOut(optedOut.member.sessionToken, true)).status).toBe(200);
    const buyer = await buildCustomer("inv-buyer", refs);
    await buyMatchmaking(buyer.member.sessionToken);

    for (const [label, userId] of [
      ["no profile", noProfile.userId],
      ["suspended", suspended.member.userId],
      ["opted out", optedOut.member.userId],
      ["open case", buyer.member.userId],
    ] as const) {
      const res = await invite(userId);
      expect(res.status, label).toBe(409);
    }
    expect((await invite(member.member.userId)).status).toBe(201);
    expect((await invite(member.member.userId, { kind: "COMPLIMENTARY" })).status).toBe(409); // already one pending
    expect((await db.select().from(matchmakingInvitations)).length).toBe(1);
  }, 180_000);
});

describe("Members directory", () => {
  it("[inv-directory] lists every member account with what can be done; filters work", async () => {
    __resetRateLimitsForTests();
    const noProfile = await createVerifiedMember("inv-dir-noprofile");
    const suspended = await buildCustomer("inv-dir-suspended", refs, "FEMALE");
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, suspended.member.userId));
    await invite(member.member.userId);

    const items = async (qs: string) => (await json(await api.admin.directory(admin.token, qs))).body.data.items as Array<Record<string, unknown> & { userId: string }>;
    const all = await items("?pageSize=50");
    const byId = new Map(all.map((m) => [m.userId, m]));
    expect(byId.get(noProfile.userId)).toMatchObject({ profile: null, introducible: false, invitable: false });
    expect(byId.get(suspended.member.userId)).toMatchObject({ introducible: false, invitable: false });
    expect(byId.get(member.member.userId)).toMatchObject({ introducible: true, invitable: false, matchmaking: { pendingInvitationKind: "OFFER", openCaseStatus: null } });

    expect((await items("?filter=no_profile")).map((m) => m.userId)).toEqual([noProfile.userId]);
    const introducible = (await items("?filter=introducible&pageSize=50")).map((m) => m.userId);
    expect(introducible).toContain(member.member.userId);
    expect(introducible).not.toContain(suspended.member.userId);
    expect((await items("?filter=in_matchmaking")).map((m) => m.userId)).toEqual([member.member.userId]);
    expect((await items("?gender=FEMALE&pageSize=50")).every((m) => (m.profile as { gender: string } | null)?.gender === "FEMALE")).toBe(true);
    expect((await api.admin.directory(admin.token, "?filter=bogus")).status).toBe(400);
  }, 180_000);
});
