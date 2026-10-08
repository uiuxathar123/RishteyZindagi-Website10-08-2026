/**
 * B9: admin dashboard stats endpoint — permission gating + correctness
 * against known, precisely-constructed fixtures.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getDashboard } from "@/app/api/v1/admin/dashboard/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, memberships, reportCategories } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { req, createVerifiedMember, buildReadyProfile, resolveReferenceIds, type ReferenceIds } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `dash-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Dashboard Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

async function purchaseAndActivate(token: string, planCode: string) {
  const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode, devSimulateOutcome: "SUCCESS" }, token));
  const { data: checkoutData } = await checkoutRes.json();
  await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, token), {
    params: { paymentId: checkoutData.paymentId },
  });
  return checkoutData.membershipId as string;
}

describe("B9 admin dashboard", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPaymentGatewaysForTests();
    __resetRateLimitsForTests();
    __clearDevPaymentStoreForTests();
    refs = await resolveReferenceIds();
  });

  it("[dashboard-idor] an unauthenticated request gets 401; a plain member gets 403", async () => {
    const unauth = await getDashboard(greq("http://localhost/api/v1/admin/dashboard"));
    expect(unauth.status).toBe(401);

    const member = await createVerifiedMember("dash-member");
    const denied = await getDashboard(greq("http://localhost/api/v1/admin/dashboard", member.sessionToken));
    expect(denied.status).toBe(403);
  });

  it("[dashboard-staff-allowed] a STAFF_ADMIN can reach the dashboard (users.view is granted to STAFF_ADMIN by default)", async () => {
    const staffToken = await seedAdmin("STAFF_ADMIN");
    const res = await getDashboard(greq("http://localhost/api/v1/admin/dashboard", staffToken));
    expect(res.status).toBe(200);
  });

  it("[dashboard-stats-correctness] reflects known fixtures exactly: user/profile/membership/payment/report/suspension counts", async () => {
    // 3 plain members (no profile), one of which we'll suspend via the
    // real 5-unique-reporter threshold mechanism.
    const memberA = await createVerifiedMember("dash-stat-a");
    await createVerifiedMember("dash-stat-b");
    await createVerifiedMember("dash-stat-c");

    // A profile ready for visibility.
    await buildReadyProfile("dash-stat-ready", refs);

    // Trigger a real auto-suspension on memberA (5 unique reporters).
    const [otherCategory] = await db.select().from(reportCategories).where(eq(reportCategories.name, "Other")).limit(1);
    for (let i = 0; i < 5; i++) {
      const reporter = await createVerifiedMember(`dash-stat-reporter-${i}`);
      await fileReport(
        preq("http://localhost/api/v1/reports", { reportedUserId: memberA.userId, categoryId: otherCategory.id }, reporter.sessionToken)
      );
    }

    // Reset the in-memory register-endpoint rate limit before creating
    // more members — this test alone registers well over the unrelated
    // `register:<ip>` 10/60s cap (see reports.test.ts's own precedent for
    // this exact reset, same reasoning).
    __resetRateLimitsForTests();

    // One ACTIVE membership (real purchase+verify), one PENDING (checkout
    // only, never verified), one ACTIVE membership pushed into the
    // "expiring soon" window by direct db update (test-only — real
    // durations are all >= 7 days, so this is the only way to exercise
    // the window without waiting days).
    const staffBuyer = await createVerifiedMember("dash-stat-buyer1");
    await purchaseAndActivate(staffBuyer.sessionToken, "PLAN_MONTHLY_INR");

    const expiringBuyer = await createVerifiedMember("dash-stat-buyer2");
    const expiringMembershipId = await purchaseAndActivate(expiringBuyer.sessionToken, "PLAN_MONTHLY_INR");
    await db
      .update(memberships)
      .set({ expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) })
      .where(eq(memberships.id, expiringMembershipId));

    const pendingBuyer = await createVerifiedMember("dash-stat-buyer3");
    await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR" }, pendingBuyer.sessionToken));

    // A FAILED payment.
    const failBuyer = await createVerifiedMember("dash-stat-fail");
    const failCheckoutRes = await checkout(
      preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR", devSimulateOutcome: "FAILED" }, failBuyer.sessionToken)
    );
    const { data: failData } = await failCheckoutRes.json();
    await verifyPayment(preq(`http://localhost/api/v1/payments/${failData.paymentId}/verify`, {}, failBuyer.sessionToken), {
      params: { paymentId: failData.paymentId },
    });

    const superToken = await seedAdmin("SUPER_ADMIN");
    const res = await getDashboard(greq("http://localhost/api/v1/admin/dashboard", superToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const stats = data.stats;

    // users: memberA + b + c (3) + ready-profile's own member (1) + 5
    // reporters (5) + buyer1 + buyer2 + buyer3 + failBuyer (4) = 13
    // total, 1 suspended (memberA), 12 active.
    expect(stats.users.total).toBe(13);
    expect(stats.users.suspended).toBe(1);
    expect(stats.users.active).toBe(12);

    expect(stats.profiles.readyForVisibility).toBe(1);

    expect(stats.memberships.active).toBe(2); // staffBuyer + expiringBuyer
    expect(stats.memberships.expiringSoonWindowDays).toBe(7);
    expect(stats.memberships.expiringSoon).toBe(1); // only expiringBuyer's

    expect(stats.payments.total).toBe(4); // 2 SUCCESS + 1 PENDING + 1 FAILED
    expect(stats.payments.successful).toBe(2);
    expect(stats.payments.pending).toBe(1);
    expect(stats.payments.failed).toBe(1);
    const inrRevenue = stats.payments.revenueByCurrency.find((r: { currency: string }) => r.currency === "INR");
    expect(inrRevenue).toBeDefined();
    expect(inrRevenue.totalInSmallestUnit).toBeGreaterThan(0);

    expect(stats.reports.open).toBe(5); // 5 unique reports filed against memberA, none dismissed
    expect(stats.suspensions.activeAfterThreshold).toBe(1);
  });

  it("[dashboard-no-secrets] the response never contains a password/token/OTP hash", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const res = await getDashboard(greq("http://localhost/api/v1/admin/dashboard", superToken));
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toMatch(/passwordHash|codeHash|tokenHash/i);
  });
});
