/**
 * B10: concurrency / race-condition regression suite. Every test here
 * fires genuinely PARALLEL requests (via `Promise.all`, not sequential
 * awaits) against the real route handlers + the real test database, and
 * asserts the data-integrity invariant holds no matter which request
 * "wins" the race — the master brief's explicit §2.13/§3 ask, and the
 * concrete reproduction for three of B10's own disclosed fixes:
 *
 *  - [race-interest-duplicate-send]: interactions.repository.ts's
 *    createInterest() TOCTOU (see its own B10 doc comment).
 *  - [race-report-threshold-suspend-once]: reports.repository.ts's
 *    createSuspension() TOCTOU + the new
 *    account_suspensions_active_user_idx partial unique index (see
 *    schema.ts's B10 doc comment).
 *  - [race-payment-double-verify] / [race-gateway-switch]: pre-existing
 *    B8 protections (replay-safe verify, transactional gateway switch) —
 *    confirmed here under genuine concurrency, not just sequential
 *    replay (payments.test.ts's [pay-replay-protection] already covers
 *    the sequential case).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq, isNull, and } from "drizzle-orm";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { GET as listReportCategoriesRoute } from "@/app/api/v1/reports/categories/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { POST as activateGateway } from "@/app/api/v1/admin/payment-gateways/[gatewayId]/activate/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, accountSuspensions, interests, memberships, paymentGateways, payments, users } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import {
  resetTransactionalTables,
  resetAdminUsers,
  resetOtpConfigForTests,
  resetReportAndWarningCategoriesForTests,
  resetPaymentGatewaysForTests,
  activateMembershipForTests,
} from "./helpers/reset-db";
import { req, createVerifiedMember, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `race-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Race Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
  const loginRes = await loginAdmin(
    new NextRequest("http://localhost/api/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "adminpassword1" }),
    })
  );
  const { data } = await loginRes.json();
  return data.sessionToken as string;
}

describe("B10 concurrency / race-condition regressions", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetReportAndWarningCategoriesForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  it("[race-interest-duplicate-send] two simultaneous sendInterest calls for the same fresh pair never create two rows, and the loser gets a clean 409 (not a raw 500)", async () => {
    const a = await buildReadyProfile("race-int-a", refs, { gender: "FEMALE" });
    const b = await buildReadyProfile("race-int-b", refs, { gender: "MALE" });
    await activateMembershipForTests(a.member.userId);

    const fire = () =>
      sendInterest(preq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
    const [res1, res2] = await Promise.all([fire(), fire()]);
    const statuses = [res1.status, res2.status].sort();

    // Exactly one succeeds (201), the other is a clean 409 Conflict —
    // never a 500 (which is what a raw, uncaught unique-constraint
    // violation would have produced before this file's B10 fix).
    expect(statuses).toEqual([201, 409]);

    const rows = await db
      .select()
      .from(interests)
      .where(and(eq(interests.fromUserId, a.member.userId), eq(interests.toUserId, b.member.userId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");

    const loserBody = await (res1.status === 409 ? res1 : res2).json();
    expect(loserBody.success).toBe(false);
    expect(loserBody.error.code).toBe("CONFLICT");
  });

  it("[race-report-threshold-suspend-once] 5 unique reporters filing near-simultaneously suspends the account exactly once — never zero, never twice", async () => {
    const target = await createVerifiedMember("race-rpt-target");
    const reporters = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createVerifiedMember(`race-rpt-reporter-${i}`))
    );

    const catRes = await listReportCategoriesRoute(req("http://localhost/api/v1/reports/categories", undefined, { token: reporters[0].sessionToken, method: "GET" }));
    const { data } = await catRes.json();
    const categoryId = data.categories[0].id as string;

    const results = await Promise.all(
      reporters.map((reporter) =>
        fileReport(
          preq(
            "http://localhost/api/v1/reports",
            { reportedUserId: target.userId, categoryId, description: "concurrent report" },
            reporter.sessionToken
          )
        )
      )
    );
    for (const res of results) expect(res.status).toBe(201);

    // The invariant B10's partial unique index (account_suspensions
    // .activeSuspensionIdx) now enforces at the DB level: at most one
    // ACTIVE (liftedAt IS NULL) suspension row can ever exist for this
    // user, and it must exist given 5 unique reporters crossed the
    // threshold.
    const activeSuspensions = await db
      .select()
      .from(accountSuspensions)
      .where(and(eq(accountSuspensions.userId, target.userId), isNull(accountSuspensions.liftedAt)));
    expect(activeSuspensions).toHaveLength(1);

    const [userRow] = await db.select().from(users).where(eq(users.id, target.userId));
    expect(userRow.status).toBe("SUSPENDED");
  });

  it("[race-payment-double-verify] two simultaneous verify calls on the same PENDING payment activate the membership exactly once", async () => {
    await resetPaymentGatewaysForTests();
    __clearDevPaymentStoreForTests();
    const member = await createVerifiedMember("race-pay");
    const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, member.sessionToken));
    const { data: checkoutData } = await checkoutRes.json();
    const paymentId = checkoutData.paymentId as string;
    const membershipId = checkoutData.membershipId as string;

    const fireVerify = () =>
      verifyPayment(preq(`http://localhost/api/v1/payments/${paymentId}/verify`, {}, member.sessionToken), { params: { paymentId } });
    const [res1, res2] = await Promise.all([fireVerify(), fireVerify()]);
    expect([res1.status, res2.status]).toEqual([200, 200]);

    const [body1, body2] = await Promise.all([res1.json(), res2.json()]);
    // One of the two observed the genuine SUCCESS transition; the other
    // (whichever ran second) observed ALREADY_RESOLVED — never a second
    // independent SUCCESS/activation.
    const statuses = [body1.data.status, body2.data.status].sort();
    expect(statuses).toEqual(["ALREADY_RESOLVED", "SUCCESS"]);

    const [membershipRow] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
    expect(membershipRow.status).toBe("ACTIVE");

    const [paymentRow] = await db.select().from(payments).where(eq(payments.id, paymentId));
    expect(paymentRow.status).toBe("SUCCESS");
  });

  it("[race-gateway-switch] simultaneous activate calls on different gateways never leave more than one gateway active", async () => {
    await resetPaymentGatewaysForTests();
    const token = await seedAdmin("SUPER_ADMIN");
    const gateways = await db.select().from(paymentGateways);
    expect(gateways.length).toBeGreaterThanOrEqual(2);

    const results = await Promise.all(
      gateways.map((g) => activateGateway(preq(`http://localhost/api/v1/admin/payment-gateways/${g.id}/activate`, {}, token), { params: { gatewayId: g.id } }))
    );
    for (const res of results) expect(res.status).toBe(200);

    const finalRows = await db.select().from(paymentGateways).where(eq(paymentGateways.isActive, true));
    expect(finalRows).toHaveLength(1);
  });
});
