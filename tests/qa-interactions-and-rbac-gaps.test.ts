/**
 * B12 QA: two specific checklist scenarios named in the master QA brief
 * that existing coverage only exercised indirectly:
 *
 *  - "Report: duplicate reports" — confirms the exact, pre-existing B6
 *    business rule (duplicate reports from the same reporter against the
 *    same target are each filed as their own OPEN row — no conflict, no
 *    silent merge — and the auto-suspend threshold correctly counts
 *    unique reporters, not raw report rows) with a direct, explicit test.
 *    `[threshold-unique]` (reports.test.ts) already proves the threshold
 *    side of this; this file adds the missing direct assertion that each
 *    individual duplicate filing itself succeeds and is visible to admin
 *    review as a distinct row.
 *  - "wrong role" vs "wrong permission" as DISTINCT admin-authorization
 *    scenarios — `rbac.test.ts` already tests `requirePermission`
 *    (wrong/missing permission) directly; this file adds the matching
 *    direct test for `requireAdminRole` (wrong role) so both mechanisms
 *    this codebase actually has are exercised as clearly separate cases,
 *    not conflated.
 *
 * Touches zero production code — both scenarios were already correctly
 * implemented; only test coverage was missing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { GET as listReportsAdmin } from "@/app/api/v1/admin/reports/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, reportCategories, reports } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { requireAdminRole, requirePermission } from "@/server/middleware/rbac";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile } from "./helpers/profile-fixtures";
import { NextRequest } from "next/server";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<{ token: string; adminId: string }> {
  adminCounter += 1;
  const email = `qa-gap-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  const [admin] = await db
    .insert(adminUsers)
    .values({ name: "QA Gap Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id })
    .returning();
  const loginRes = await loginAdmin(
    new NextRequest("http://localhost/api/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "adminpassword1" }),
    })
  );
  const { data } = await loginRes.json();
  return { token: data.sessionToken as string, adminId: admin.id };
}

async function categoryId(name: string): Promise<string> {
  const [row] = await db.select().from(reportCategories).where(eq(reportCategories.name, name)).limit(1);
  if (!row) throw new Error(`Seeded report category "${name}" not found.`);
  return row.id;
}

describe("QA gap-fix: report duplicates + admin wrong-role vs wrong-permission", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  describe("Report — duplicate reports", () => {
    it("[report-duplicate-same-reporter] the same reporter filing two separate reports against the same target creates two distinct OPEN rows, not a conflict or a merge", async () => {
      const refs = await resolveReferenceIds();
      const reporter = await buildReadyProfile("qa-dup-report-reporter", refs);
      const reported = await buildReadyProfile("qa-dup-report-reported", refs);
      const catId = await categoryId("Spam/Scam");

      const first = await fileReport(
        preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId, description: "first time" }, reporter.member.sessionToken)
      );
      expect(first.status).toBe(201);
      const { data: firstData } = await first.json();

      const second = await fileReport(
        preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId, description: "reporting again" }, reporter.member.sessionToken)
      );
      expect(second.status).toBe(201);
      const { data: secondData } = await second.json();

      expect(secondData.report.id).not.toBe(firstData.report.id);
      expect(secondData.report.status).toBe("OPEN");

      // Both rows genuinely exist and are OPEN — a duplicate filing is
      // never silently dropped or auto-merged into the first.
      const rows = await db.select().from(reports).where(eq(reports.reportedUserId, reported.member.userId));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "OPEN")).toBe(true);
      expect(rows.every((r) => r.reporterUserId === reporter.member.userId)).toBe(true);

      // Visible to admin review as two distinct entries.
      const superAdmin = await seedAdmin("SUPER_ADMIN");
      const adminList = await listReportsAdmin(greq(`http://localhost/api/v1/admin/reports?reportedUserId=${reported.member.userId}`, superAdmin.token));
      const { data: adminData } = await adminList.json();
      expect(adminData.items).toHaveLength(2);
    });
  });

  describe("Admin authorization — wrong role vs. wrong permission, as distinct mechanisms", () => {
    it("[wrong-role] requireAdminRole denies a valid, authenticated STAFF_ADMIN when the route's allowlist is role-scoped to SUPER_ADMIN only — a role problem, independent of any permission grant", async () => {
      const staff = await seedAdmin("STAFF_ADMIN");
      const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "STAFF_ADMIN"));
      const ctx = { subject: { id: staff.adminId, type: "admin" as const }, adminRoleName: role.name, sessionId: "n/a" };

      // A STAFF_ADMIN is a completely valid, authenticated admin — this
      // denial is purely about role name membership in the allowlist,
      // never about a missing permission grant (requirePermission is a
      // separate mechanism, exercised below).
      expect(() => requireAdminRole(ctx, ["SUPER_ADMIN"])).toThrow();
      // The same STAFF_ADMIN passes when their actual role IS allowed —
      // proving the denial above was role-selective, not a blanket deny.
      expect(() => requireAdminRole(ctx, ["SUPER_ADMIN", "STAFF_ADMIN"])).not.toThrow();
    });

    it("[wrong-permission] requirePermission denies the identical STAFF_ADMIN for a permission it simply was never granted — a permission problem, independent of role membership", async () => {
      const staff = await seedAdmin("STAFF_ADMIN");
      const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "STAFF_ADMIN"));
      const ctx = { subject: { id: staff.adminId, type: "admin" as const }, adminRoleName: role.name, sessionId: "n/a" };

      // Same admin, same role — denied here purely because `audit.view`
      // isn't in STAFF_ADMIN's default grant set (role membership alone
      // was never in question, unlike the [wrong-role] case above).
      await expect(requirePermission(ctx, "audit.view")).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
      // The same admin succeeds on a permission it DOES hold by default —
      // proving the denial above was permission-selective, not role-based.
      await expect(requirePermission(ctx, "users.view")).resolves.toBeUndefined();
    });
  });
});
