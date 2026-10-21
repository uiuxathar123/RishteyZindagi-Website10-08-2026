/**
 * Personal Matchmaking authorization and server-controlled configuration:
 *  - every admin route is Super Admin only, by role: a Staff Admin is refused even holding EVERY permission;
 *    members and anonymous callers are refused; a Super Admin on a temporary password is refused;
 *  - price, currency and included access come only from the server-side setting; the client cannot supply them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, permissions, rolePermissions } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { MATCHMAKING_CONSENT_VERSION } from "@/server/modules/matchmaking/matchmaking-settings";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { resolveReferenceIds, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, grantPermission, revokePermission, type TestAdmin } from "./helpers/pcp";
import { SETTINGS, api, buildCustomer, caseRow, configure, json, paymentRow } from "./helpers/matchmaking";

const SOME_ID = "00000000-0000-4000-8000-000000000001";
let refs: ReferenceIds;

const staffPermissionKeys = () =>
  db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .innerJoin(adminRoles, eq(adminRoles.id, rolePermissions.roleId))
    .where(eq(adminRoles.name, "STAFF_ADMIN"));
let superAdmin: TestAdmin;

/** Every Super Admin route, with harmless arguments. */
const adminCalls = (token: string) => [
  ["GET settings", () => api.admin.getSettings(token)],
  ["PUT settings", () => api.admin.putSettings(token, SETTINGS)],
  ["GET cases", () => api.admin.listCases(token)],
  ["GET case", () => api.admin.getCase(token, SOME_ID)],
  ["POST note", () => api.admin.note(token, SOME_ID, { note: "x", customerVisible: false })],
  ["POST status", () => api.admin.status(token, SOME_ID, { status: "IN_PROGRESS" })],
  ["GET recommendations", () => api.admin.recos(token, SOME_ID)],
  ["POST suggestion", () => api.admin.addSuggestion(token, SOME_ID, SOME_ID)],
  ["POST suggestion action", () => api.admin.act(token, SOME_ID, "SEND")],
  ["GET members", () => api.admin.searchMembers(token, "someone")],
  ["GET introduction preview", () => api.admin.previewIntroduction(token, SOME_ID, SOME_ID.replace(/1$/, "2"))],
  ["GET introductions", () => api.admin.listIntroductions(token)],
  ["GET overview", () => api.admin.overview(token)],
  ["GET directory", () => api.admin.directory(token)],
  ["GET invitations", () => api.admin.listInvitations(token)],
  ["POST invitation", () => api.admin.invite(token, { userId: SOME_ID, kind: "OFFER" })],
  ["POST invitation revoke", () => api.admin.revokeInvitation(token, SOME_ID)],
  ["GET introduction candidates", () => api.admin.introductionCandidates(token, SOME_ID)],
  ["POST introduction", () => api.admin.createIntroduction(token, { userAId: SOME_ID, userBId: SOME_ID.replace(/1$/, "2") })],
  ["POST introduction withdraw", () => api.admin.withdrawIntroduction(token, SOME_ID)],
  ["GET company verification", () => api.admin.getCompanyVerification(token, SOME_ID)],
  ["POST company verification", () => api.admin.decideCompanyVerification(token, SOME_ID, { status: "PENDING" })],
] as const;

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  __clearDevPaymentStoreForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  superAdmin = await createAdmin("SUPER_ADMIN");
});

describe("Personal Matchmaking — Super Admin only", () => {
  it("[mm-auth-super] a Super Admin can read and change the configuration and list cases", async () => {
    const before = await json(await api.admin.getSettings(superAdmin.token));
    expect(before.status).toBe(200);
    expect(before.body.data.settings).toEqual({ enabled: false, prices: { INR: null, USD: null }, includedMembershipDays: 30 });
    expect((await api.admin.putSettings(superAdmin.token, SETTINGS)).status).toBe(200);
    expect((await json(await api.admin.getSettings(superAdmin.token))).body.data.settings).toEqual(SETTINGS);
    expect((await api.admin.listCases(superAdmin.token)).status).toBe(200);
  });

  it("[mm-auth-staff-all-permissions] a Staff Admin holding every permission is still refused on every route", async () => {
    // role_permissions is not part of any reset helper, so the role's exact original grants are restored afterwards.
    const original = new Set((await staffPermissionKeys()).map((r) => r.key));
    const all = await db.select({ key: permissions.key }).from(permissions);
    try {
      for (const p of all) await grantPermission("STAFF_ADMIN", p.key);
      const staff = await createAdmin("STAFF_ADMIN");
      for (const [name, call] of adminCalls(staff.token)) {
        const res = await call();
        expect(res.status, name).toBe(403);
      }
    } finally {
      for (const p of all) if (!original.has(p.key)) await revokePermission("STAFF_ADMIN", p.key);
    }
    expect(new Set((await staffPermissionKeys()).map((r) => r.key))).toEqual(original);
  });

  it("[mm-auth-member-anon] members get 403 and anonymous callers 401 on every admin route", async () => {
    const customer = await buildCustomer("mm-auth-member", refs);
    for (const [name, call] of adminCalls(customer.member.sessionToken)) expect((await call()).status, name).toBe(403);
    for (const [name, call] of adminCalls("")) expect((await call()).status, name).toBe(401);
  });

  it("[mm-auth-temp-password] a Super Admin still on a temporary password is refused", async () => {
    await db.update(adminUsers).set({ mustChangePassword: true }).where(eq(adminUsers.id, superAdmin.id));
    for (const [name, call] of adminCalls(superAdmin.token)) expect((await call()).status, name).toBe(403);
  });

  it("[mm-auth-settings-validation] invalid settings are rejected; enabling needs a price", async () => {
    for (const bad of [
      { ...SETTINGS, prices: { INR: -5, USD: null } },
      { ...SETTINGS, prices: { INR: 10.5, USD: null } },
      { ...SETTINGS, includedMembershipDays: 4000 },
      { ...SETTINGS, extra: true },
      { enabled: true, prices: { INR: null, USD: null }, includedMembershipDays: 30 },
    ]) {
      expect((await api.admin.putSettings(superAdmin.token, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("Personal Matchmaking — server-controlled price and terms", () => {
  it("[mm-price-server] the offer and the charge come from the setting; client price/duration/paid fields are rejected", async () => {
    const customer = await buildCustomer("mm-price", refs);
    const token = customer.member.sessionToken;

    // disabled by default: nothing on sale
    expect((await json(await api.offer())).body.data.offer.available).toBe(false);
    expect((await api.checkout(token)).status).toBe(503);

    await configure(superAdmin.token);
    const offer = (await json(await api.offer(token))).body.data.offer;
    expect(offer).toMatchObject({ available: true, currency: "INR", priceInSmallestUnit: 499900, includedMembershipDays: 30, consentVersion: MATCHMAKING_CONSENT_VERSION });

    for (const extra of [{ priceInPaise: 1 }, { amountInPaise: 1 }, { currency: "USD" }, { includedMembershipDays: 365 }, { paid: true }]) {
      const res = await api.checkout(token, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await api.checkout(token, { consent: false, consentVersion: MATCHMAKING_CONSENT_VERSION })).status).toBe(400);
    expect((await api.checkout(token, { consent: true, consentVersion: "old-version" })).status).toBe(409);

    // a later price change applies to the next checkout, never to an existing payment
    await configure(superAdmin.token, { ...SETTINGS, prices: { INR: 777700, USD: 5999 }, includedMembershipDays: 45 });
    const co = await json(await api.checkout(token, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, devSimulateOutcome: "PENDING" }));
    expect(co.status).toBe(201);
    expect(co.body.data.checkout).toMatchObject({ amountInPaise: 777700, currency: "INR", status: "PENDING" });
    const pay = await paymentRow(co.body.data.checkout.paymentId);
    expect(pay).toMatchObject({ amountInPaise: 777700, currency: "INR", membershipId: null, matchmakingCaseId: co.body.data.checkout.caseId });
    expect(await caseRow(co.body.data.checkout.caseId)).toMatchObject({ status: "PENDING_PAYMENT", priceInPaise: 777700, includedMembershipDays: 45, consentVersion: MATCHMAKING_CONSENT_VERSION });
  });
});
