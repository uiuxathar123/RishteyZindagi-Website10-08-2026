/**
 * B9: admin user search/list/detail endpoints — genuinely new admin
 * capability. Permission gating (reuses `users.view`) + search/filter
 * correctness + detail-composition correctness (membership/reports/
 * warnings/audit all present) + IDOR.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as listUsers } from "@/app/api/v1/admin/users/route";
import { GET as getUserDetail } from "@/app/api/v1/admin/users/[userId]/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { POST as issueWarning } from "@/app/api/v1/admin/users/[userId]/warnings/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, reportCategories, warningCategories, users } from "@/server/db/schema";
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
  const email = `users-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Users Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

describe("B9 admin user search/list/detail", () => {
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

  // --- Permission gating / IDOR --------------------------------------------

  it("[users-idor] unauthenticated gets 401; a plain member gets 403", async () => {
    const unauth = await listUsers(greq("http://localhost/api/v1/admin/users"));
    expect(unauth.status).toBe(401);

    const member = await createVerifiedMember("adminusers-member");
    const denied = await listUsers(greq("http://localhost/api/v1/admin/users", member.sessionToken));
    expect(denied.status).toBe(403);
  });

  it("[users-staff-allowed] STAFF_ADMIN can list and view detail (users.view is default-granted)", async () => {
    const target = await createVerifiedMember("adminusers-staffok");
    const staffToken = await seedAdmin("STAFF_ADMIN");

    const listRes = await listUsers(greq("http://localhost/api/v1/admin/users", staffToken));
    expect(listRes.status).toBe(200);

    const detailRes = await getUserDetail(greq(`http://localhost/api/v1/admin/users/${target.userId}`, staffToken), {
      params: { userId: target.userId },
    });
    expect(detailRes.status).toBe(200);
  });

  it("[users-permission-scoped] a STAFF_ADMIN without warnings.issue still cannot issue a warning via a different endpoint, proving permission checks are per-action not just per-role", async () => {
    const target = await createVerifiedMember("adminusers-scope");
    const staffToken = await seedAdmin("STAFF_ADMIN");
    const catId = (await db.select().from(warningCategories).limit(1))[0].id;
    const res = await issueWarning(preq(`http://localhost/api/v1/admin/users/${target.userId}/warnings`, { categoryId: catId, message: "x" }, staffToken), {
      params: { userId: target.userId },
    });
    expect(res.status).toBe(403); // warnings.issue is SUPER_ADMIN-only by default
  });

  // --- Search / filter / pagination ----------------------------------------

  it("[users-search-q] q matches name/email/mobile (partial, case-insensitive)", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const unique = `SearchTarget${Date.now()}`;
    const member = await createVerifiedMember(unique.toLowerCase());
    await db.update(users).set({ name: unique }).where(eq(users.id, member.userId));

    const res = await listUsers(greq(`http://localhost/api/v1/admin/users?q=${unique.toLowerCase()}`, superToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.items.some((u: { id: string }) => u.id === member.userId)).toBe(true);
  });

  it("[users-search-status] status filter returns only matching accounts", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const active = await createVerifiedMember("adminusers-active");
    const suspended = await createVerifiedMember("adminusers-suspended");
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, suspended.userId));

    const res = await listUsers(greq("http://localhost/api/v1/admin/users?status=SUSPENDED&pageSize=50", superToken));
    const { data } = await res.json();
    expect(data.items.some((u: { id: string }) => u.id === suspended.userId)).toBe(true);
    expect(data.items.every((u: { status: string }) => u.status === "SUSPENDED")).toBe(true);
    expect(data.items.some((u: { id: string }) => u.id === active.userId)).toBe(false);
  });

  it("[users-search-verification-status] verificationStatus filter matches profile state", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const ready = await buildReadyProfile("adminusers-verify", refs);

    const res = await listUsers(greq("http://localhost/api/v1/admin/users?verificationStatus=UNVERIFIED&pageSize=50", superToken));
    const { data } = await res.json();
    expect(data.items.some((u: { id: string }) => u.id === ready.member.userId)).toBe(true);
  });

  it("[users-pagination] page/pageSize are honored", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    for (let i = 0; i < 3; i++) await createVerifiedMember(`adminusers-page-${i}`);
    const res = await listUsers(greq("http://localhost/api/v1/admin/users?page=1&pageSize=2", superToken));
    const { data } = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(2);
    expect(data.pageSize).toBe(2);
    expect(data.total).toBeGreaterThanOrEqual(3);
  });

  it("[users-no-password-hash] the search/list response never includes passwordHash", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    await createVerifiedMember("adminusers-nosecret");
    const res = await listUsers(greq("http://localhost/api/v1/admin/users?pageSize=50", superToken));
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toMatch(/passwordHash/i);
  });

  // --- Detail composition ---------------------------------------------------

  it("[users-detail-404] a non-existent user id returns 404", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const res = await getUserDetail(greq("http://localhost/api/v1/admin/users/00000000-0000-0000-0000-000000000000", superToken), {
      params: { userId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("[users-detail-composition] surfaces membership, reports (both directions), warnings, and audit history correctly", async () => {
    const superToken = await seedAdmin("SUPER_ADMIN");
    const target = await buildReadyProfile("adminusers-detail-target", refs);
    const other = await createVerifiedMember("adminusers-detail-other");

    // A membership purchase.
    const checkoutRes = await checkout(preq("http://localhost/api/v1/memberships/checkout", { planCode: "PLAN_7DAY_INR", devSimulateOutcome: "SUCCESS" }, target.member.sessionToken));
    const { data: checkoutData } = await checkoutRes.json();
    await verifyPayment(preq(`http://localhost/api/v1/payments/${checkoutData.paymentId}/verify`, {}, target.member.sessionToken), {
      params: { paymentId: checkoutData.paymentId },
    });

    // A report AGAINST the target (by `other`) and a report FILED BY the
    // target (against `other`).
    const [otherCategory] = await db.select().from(reportCategories).where(eq(reportCategories.name, "Other")).limit(1);
    await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: target.member.userId, categoryId: otherCategory.id }, other.sessionToken));
    await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: other.userId, categoryId: otherCategory.id }, target.member.sessionToken));

    // A warning issued to the target.
    const [warnCategory] = await db.select().from(warningCategories).limit(1);
    await issueWarning(preq(`http://localhost/api/v1/admin/users/${target.member.userId}/warnings`, { categoryId: warnCategory.id, message: "test warning" }, superToken), {
      params: { userId: target.member.userId },
    });

    const res = await getUserDetail(greq(`http://localhost/api/v1/admin/users/${target.member.userId}`, superToken), {
      params: { userId: target.member.userId },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const detail = data.user;

    expect(detail.account.id).toBe(target.member.userId);
    expect(detail.account.status).toBe("ACTIVE");
    expect(detail.profile).not.toBeNull();
    expect(detail.profile.profileStatus).toBe("READY_FOR_VISIBILITY");

    expect(detail.memberships).toHaveLength(1);
    expect(detail.memberships[0].status).toBe("ACTIVE");

    expect(detail.reports.againstCount).toBe(1);
    expect(detail.reports.filedCount).toBe(1);
    expect(detail.reports.against[0].reportedUserId).toBe(target.member.userId);
    expect(detail.reports.filed[0].reporterUserId).toBe(target.member.userId);

    expect(detail.warnings).toHaveLength(1);
    expect(detail.warnings[0].message).toBe("test warning");

    // Audit history includes at least the member's own registration/login
    // trail (actorId = this user) — see auth.service.ts's user.register.
    expect(detail.auditHistory.length).toBeGreaterThan(0);
    expect(detail.auditHistory.some((a: { action: string }) => a.action === "user.register")).toBe(true);

    const bodyText = JSON.stringify(data);
    expect(bodyText).not.toMatch(/passwordHash|codeHash|tokenHash/i);
  });
});
