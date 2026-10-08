/**
 * B9: admin audit-log read endpoint — genuinely new read path (audit
 * logs are written throughout B1-B8 but were never read back before
 * B9). New `audit.view` permission, SUPER_ADMIN-only by default; filter
 * correctness; no mutation endpoint exists (append-only).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as listAuditLogs } from "@/app/api/v1/admin/audit-logs/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { GET as listReportsAdmin } from "@/app/api/v1/admin/reports/route";
import { PATCH as dismissReport } from "@/app/api/v1/admin/reports/[reportId]/route";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, reportCategories, auditLogs } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req, createVerifiedMember } from "./helpers/profile-fixtures";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}
function preq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "POST" });
}
function patchReq(url: string, body: unknown, token: string) {
  return req(url, body, { token, method: "PATCH" });
}

let adminCounter = 0;
async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<{ token: string; adminId: string }> {
  adminCounter += 1;
  const email = `audit-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  const [admin] = await db
    .insert(adminUsers)
    .values({ name: "Audit Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id })
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

describe("B9 admin audit logs", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __resetRateLimitsForTests();
  });

  it("[audit-idor] unauthenticated gets 401; a plain member gets 403", async () => {
    const unauth = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs"));
    expect(unauth.status).toBe(401);

    const member = await createVerifiedMember("audit-member");
    const denied = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs", member.sessionToken));
    expect(denied.status).toBe(403);
  });

  it("[audit-staff-denied] a STAFF_ADMIN — even one granted reports.resolve (a default STAFF_ADMIN permission) — cannot reach audit-logs, since audit.view is SUPER_ADMIN-only by default", async () => {
    const { token: staffToken } = await seedAdmin("STAFF_ADMIN");
    const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs", staffToken));
    expect(res.status).toBe(403);
  });

  it("[audit-super-allowed] a SUPER_ADMIN can list audit logs", async () => {
    const { token: superToken } = await seedAdmin("SUPER_ADMIN");
    const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs", superToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("[audit-filter-action] filtering by action returns only matching rows", async () => {
    const { token: superToken, adminId } = await seedAdmin("SUPER_ADMIN");
    const reporter = await createVerifiedMember("audit-filter-reporter");
    const reported = await createVerifiedMember("audit-filter-reported");
    const [category] = await db.select().from(reportCategories).where(eq(reportCategories.name, "Other")).limit(1);
    const fileRes = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.userId, categoryId: category.id }, reporter.sessionToken));
    const { data: fileData } = await fileRes.json();
    await dismissReport(patchReq(`http://localhost/api/v1/admin/reports/${fileData.report.id}`, { status: "DISMISSED" }, superToken), {
      params: { reportId: fileData.report.id },
    });

    const res = await listAuditLogs(greq(`http://localhost/api/v1/admin/audit-logs?action=report.dismiss&pageSize=50`, superToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items.every((r: { action: string }) => r.action === "report.dismiss")).toBe(true);
    expect(data.items.some((r: { actorId: string }) => r.actorId === adminId)).toBe(true);
  });

  it("[audit-filter-entity] filtering by entityType + entityId returns only matching rows", async () => {
    const { token: superToken } = await seedAdmin("SUPER_ADMIN");
    const reporter = await createVerifiedMember("audit-entity-reporter");
    const reported = await createVerifiedMember("audit-entity-reported");
    const [category] = await db.select().from(reportCategories).where(eq(reportCategories.name, "Other")).limit(1);
    const fileRes = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.userId, categoryId: category.id }, reporter.sessionToken));
    const { data: fileData } = await fileRes.json();
    await dismissReport(patchReq(`http://localhost/api/v1/admin/reports/${fileData.report.id}`, { status: "DISMISSED" }, superToken), {
      params: { reportId: fileData.report.id },
    });

    const res = await listAuditLogs(
      greq(`http://localhost/api/v1/admin/audit-logs?entityType=report&entityId=${fileData.report.id}`, superToken)
    );
    const { data } = await res.json();
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items.every((r: { entityId: string }) => r.entityId === fileData.report.id)).toBe(true);
  });

  it("[audit-filter-actor] filtering by actorId (the admin who performed the action) returns only their rows", async () => {
    const { token: superTokenA, adminId: adminIdA } = await seedAdmin("SUPER_ADMIN");
    const { token: superTokenB } = await seedAdmin("SUPER_ADMIN");
    const reporter = await createVerifiedMember("audit-actor-reporter");
    const reportedA = await createVerifiedMember("audit-actor-reported-a");
    const reportedB = await createVerifiedMember("audit-actor-reported-b");
    const [category] = await db.select().from(reportCategories).where(eq(reportCategories.name, "Other")).limit(1);

    const fileA = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reportedA.userId, categoryId: category.id }, reporter.sessionToken));
    const { data: dataA } = await fileA.json();
    await dismissReport(patchReq(`http://localhost/api/v1/admin/reports/${dataA.report.id}`, { status: "DISMISSED" }, superTokenA), {
      params: { reportId: dataA.report.id },
    });

    __resetRateLimitsForTests();
    const fileB = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reportedB.userId, categoryId: category.id }, reporter.sessionToken));
    const { data: dataB } = await fileB.json();
    await dismissReport(patchReq(`http://localhost/api/v1/admin/reports/${dataB.report.id}`, { status: "DISMISSED" }, superTokenB), {
      params: { reportId: dataB.report.id },
    });

    const res = await listAuditLogs(greq(`http://localhost/api/v1/admin/audit-logs?actorId=${adminIdA}&action=report.dismiss`, superTokenA));
    const { data } = await res.json();
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items.every((r: { actorId: string }) => r.actorId === adminIdA)).toBe(true);
    expect(data.items.some((r: { entityId: string }) => r.entityId === dataB.report.id)).toBe(false);
  });

  it("[audit-pagination] page/pageSize are honored", async () => {
    const { token: superToken } = await seedAdmin("SUPER_ADMIN");
    const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs?page=1&pageSize=1", superToken));
    const { data } = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(1);
    expect(data.pageSize).toBe(1);
  });

  it("[audit-no-write-route] no PATCH/DELETE handler exists for audit logs (append-only by design)", async () => {
    const mod = await import("@/app/api/v1/admin/audit-logs/route");
    expect((mod as Record<string, unknown>).PATCH).toBeUndefined();
    expect((mod as Record<string, unknown>).DELETE).toBeUndefined();
    expect((mod as Record<string, unknown>).PUT).toBeUndefined();
    expect((mod as Record<string, unknown>).POST).toBeUndefined();
  });

  it("[audit-no-secrets] the response never contains a password/token/OTP hash", async () => {
    const { token: superToken } = await seedAdmin("SUPER_ADMIN");
    await createVerifiedMember("audit-nosecret");
    const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs?pageSize=50", superToken));
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toMatch(/passwordHash|codeHash|tokenHash/i);
  });

  it("[audit-real-rows-exist] confirms audit_logs actually has rows to read (sanity check the read path isn't trivially empty)", async () => {
    const before = await db.select().from(auditLogs);
    expect(before.length).toBeGreaterThanOrEqual(0); // may be 0 at true start of file, but the endpoint itself must not error
    const { token: superToken } = await seedAdmin("SUPER_ADMIN"); // admin.login writes an audit row
    const res = await listAuditLogs(greq("http://localhost/api/v1/admin/audit-logs?action=admin.login", superToken));
    const { data } = await res.json();
    expect(data.total).toBeGreaterThanOrEqual(1);
  });
});
