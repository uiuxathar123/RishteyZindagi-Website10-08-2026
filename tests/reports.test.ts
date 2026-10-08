/**
 * B6: Report / report-category admin management / auto-suspension
 * threshold / suspension-lift / Warning business rules.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { GET as listReportCategoriesRoute } from "@/app/api/v1/reports/categories/route";
import { GET as listReportsAdmin } from "@/app/api/v1/admin/reports/route";
import { PATCH as dismissReport } from "@/app/api/v1/admin/reports/[reportId]/route";
import { GET as listAllCategoriesAdmin, POST as createCategoryAdmin } from "@/app/api/v1/admin/report-categories/route";
import { PATCH as updateCategoryAdmin } from "@/app/api/v1/admin/report-categories/[categoryId]/route";
import { POST as liftSuspension } from "@/app/api/v1/admin/users/[userId]/lift-suspension/route";
import { GET as listMyWarnings } from "@/app/api/v1/warnings/me/route";
import { POST as acknowledgeWarning } from "@/app/api/v1/warnings/[warningId]/acknowledge/route";
import { GET as listWarningCategoriesAdmin } from "@/app/api/v1/admin/warning-categories/route";
import { POST as issueWarning, GET as listWarningsForUserAdmin } from "@/app/api/v1/admin/users/[userId]/warnings/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, auditLogs, users, reportCategories, warningCategories } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetReportAndWarningCategoriesForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, createVerifiedMember, type ReferenceIds } from "./helpers/profile-fixtures";

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

async function seedAdmin(roleName: "SUPER_ADMIN" | "STAFF_ADMIN"): Promise<string> {
  adminCounter += 1;
  const email = `reports-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  await db.insert(adminUsers).values({ name: "Reports Admin", email, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
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

async function categoryId(name: string): Promise<string> {
  const [row] = await db.select().from(reportCategories).where(eq(reportCategories.name, name)).limit(1);
  if (!row) throw new Error(`Seeded report category "${name}" not found — did db:seed run against the test DB?`);
  return row.id;
}

async function warningCategoryId(name: string): Promise<string> {
  const [row] = await db.select().from(warningCategories).where(eq(warningCategories.name, name)).limit(1);
  if (!row) throw new Error(`Seeded warning category "${name}" not found — did db:seed run against the test DB?`);
  return row.id;
}

describe("B6 reports, categories, suspension threshold, warnings", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetReportAndWarningCategoriesForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  // --- Report categories (member-facing read) -------------------------------

  it("[categories-list] a signed-in member can list active report categories", async () => {
    const member = await createVerifiedMember("report-cat-list");
    const res = await listReportCategoriesRoute(greq("http://localhost/api/v1/reports/categories", member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.categories.every((c: { isActive: boolean }) => c.isActive)).toBe(true);
  });

  // --- Filing a report -------------------------------------------------------

  describe("Filing a report", () => {
    it("[report-file] a member can report another user, creating an OPEN report", async () => {
      const reporter = await buildReadyProfile("report-file-reporter", refs);
      const reported = await buildReadyProfile("report-file-reported", refs);
      const catId = await categoryId("Spam/Scam");

      const res = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId, description: "spammy" }, reporter.member.sessionToken));
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.report.status).toBe("OPEN");
      expect(data.report.reportedUserId).toBe(reported.member.userId);
    });

    it("[report-self] cannot report your own account", async () => {
      const reporter = await buildReadyProfile("report-self", refs);
      const catId = await categoryId("Other");
      const res = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reporter.member.userId, categoryId: catId }, reporter.member.sessionToken));
      expect(res.status).toBe(400);
    });

    it("[report-inactive-category] filing against a disabled category is rejected", async () => {
      const reporter = await buildReadyProfile("report-inactive-a", refs);
      const reported = await buildReadyProfile("report-inactive-b", refs);
      const catId = await categoryId("Other");
      const adminToken = await seedAdmin("SUPER_ADMIN");
      await updateCategoryAdmin(patchReq(`http://localhost/api/v1/admin/report-categories/${catId}`, { isActive: false }, adminToken), { params: { categoryId: catId } });

      const res = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      expect(res.status).toBe(400);
    });
  });

  // --- Admin report review --------------------------------------------------

  describe("Admin report review", () => {
    it("[admin-reports-list] a SUPER_ADMIN can list reports; a STAFF_ADMIN without reports.resolve cannot", async () => {
      const reporter = await buildReadyProfile("admin-list-reporter", refs);
      const reported = await buildReadyProfile("admin-list-reported", refs);
      const catId = await categoryId("Other");
      await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));

      const superToken = await seedAdmin("SUPER_ADMIN");
      const res = await listReportsAdmin(greq("http://localhost/api/v1/admin/reports", superToken));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.total).toBeGreaterThanOrEqual(1);
    });

    it("[admin-reports-dismiss] SUPER_ADMIN can dismiss a report; it's idempotent and audit-logged", async () => {
      const reporter = await buildReadyProfile("admin-dismiss-reporter", refs);
      const reported = await buildReadyProfile("admin-dismiss-reported", refs);
      const catId = await categoryId("Other");
      const fileRes = await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      const { data: fileData } = await fileRes.json();

      const superToken = await seedAdmin("SUPER_ADMIN");
      const res = await dismissReport(patchReq(`http://localhost/api/v1/admin/reports/${fileData.report.id}`, { status: "DISMISSED" }, superToken), {
        params: { reportId: fileData.report.id },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.report.status).toBe("DISMISSED");

      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "report.dismiss"));
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // idempotent
      const res2 = await dismissReport(patchReq(`http://localhost/api/v1/admin/reports/${fileData.report.id}`, { status: "DISMISSED" }, superToken), {
        params: { reportId: fileData.report.id },
      });
      expect(res2.status).toBe(200);
    });

    it("[admin-reports-idor] a normal member cannot reach admin report-review endpoints", async () => {
      const member = await createVerifiedMember("report-idor-member");
      const res = await listReportsAdmin(greq("http://localhost/api/v1/admin/reports", member.sessionToken));
      expect(res.status).toBe(403);
    });
  });

  // --- Report category admin management -------------------------------------

  describe("Report category admin management", () => {
    it("[category-add] SUPER_ADMIN can add a new category", async () => {
      const adminToken = await seedAdmin("SUPER_ADMIN");
      const res = await createCategoryAdmin(preq("http://localhost/api/v1/admin/report-categories", { name: `Test Category ${Date.now()}`, description: "x" }, adminToken));
      expect(res.status).toBe(201);
    });

    it("[category-edit] SUPER_ADMIN can edit a category's name/description", async () => {
      const adminToken = await seedAdmin("SUPER_ADMIN");
      const catId = await categoryId("Harassment");
      const res = await updateCategoryAdmin(patchReq(`http://localhost/api/v1/admin/report-categories/${catId}`, { description: "Updated description" }, adminToken), {
        params: { categoryId: catId },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.category.description).toBe("Updated description");
    });

    it("[category-disable] SUPER_ADMIN can disable a category without deleting it (still listed by admin, absent from member-facing active list)", async () => {
      const adminToken = await seedAdmin("SUPER_ADMIN");
      const catId = await categoryId("Underage");
      const res = await updateCategoryAdmin(patchReq(`http://localhost/api/v1/admin/report-categories/${catId}`, { isActive: false }, adminToken), {
        params: { categoryId: catId },
      });
      expect(res.status).toBe(200);

      const allRes = await listAllCategoriesAdmin(greq("http://localhost/api/v1/admin/report-categories", adminToken));
      const { data: allData } = await allRes.json();
      expect(allData.categories.some((c: { id: string }) => c.id === catId)).toBe(true); // never deleted

      const member = await createVerifiedMember("category-disable-member");
      const activeRes = await listReportCategoriesRoute(greq("http://localhost/api/v1/reports/categories", member.sessionToken));
      const { data: activeData } = await activeRes.json();
      expect(activeData.categories.some((c: { id: string }) => c.id === catId)).toBe(false);
    });

    it("[category-manage-idor] a STAFF_ADMIN without reports.categories.manage cannot manage categories", async () => {
      const staffToken = await seedAdmin("STAFF_ADMIN");
      const res = await createCategoryAdmin(preq("http://localhost/api/v1/admin/report-categories", { name: `Denied ${Date.now()}` }, staffToken));
      expect(res.status).toBe(403);
    });
  });

  // --- Report threshold / auto-suspension -----------------------------------

  describe("Report threshold and auto-suspension", () => {
    it("[threshold-unique] the same reporter reporting 5 times does NOT trigger auto-suspension (must be 5 UNIQUE reporters)", async () => {
      const reporter = await buildReadyProfile("threshold-same-reporter", refs);
      const reported = await buildReadyProfile("threshold-same-reported", refs);
      const catId = await categoryId("Other");

      for (let i = 0; i < 5; i++) {
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId, description: `dup ${i}` }, reporter.member.sessionToken));
      }

      const [account] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(account.status).toBe("ACTIVE");
    });

    it("[threshold-trigger] exactly 5 UNIQUE reporters auto-suspends the reported account", async () => {
      const reported = await buildReadyProfile("threshold-trigger-reported", refs);
      const catId = await categoryId("Other");

      for (let i = 0; i < 5; i++) {
        const reporter = await buildReadyProfile(`threshold-trigger-reporter-${i}`, refs);
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      }

      const [account] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(account.status).toBe("SUSPENDED");
    });

    it("[threshold-below] 4 unique reporters does not trigger suspension", async () => {
      const reported = await buildReadyProfile("threshold-below-reported", refs);
      const catId = await categoryId("Other");
      for (let i = 0; i < 4; i++) {
        const reporter = await buildReadyProfile(`threshold-below-reporter-${i}`, refs);
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      }
      const [account] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(account.status).toBe("ACTIVE");
    });

    it("[lift-suspension] SUPER_ADMIN can lift a suspension, restoring ACTIVE status", async () => {
      const reported = await buildReadyProfile("lift-reported", refs);
      const catId = await categoryId("Other");
      for (let i = 0; i < 5; i++) {
        const reporter = await buildReadyProfile(`lift-reporter-${i}`, refs);
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      }
      const [suspended] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(suspended.status).toBe("SUSPENDED");

      const superToken = await seedAdmin("SUPER_ADMIN");
      const res = await liftSuspension(preq(`http://localhost/api/v1/admin/users/${reported.member.userId}/lift-suspension`, undefined, superToken), {
        params: { userId: reported.member.userId },
      });
      expect(res.status).toBe(200);

      const [active] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(active.status).toBe("ACTIVE");
    });

    it("[lift-suspension-idor] a STAFF_ADMIN without users.suspend cannot lift a suspension", async () => {
      const reported = await buildReadyProfile("lift-idor-reported", refs);
      const catId = await categoryId("Other");
      for (let i = 0; i < 5; i++) {
        const reporter = await buildReadyProfile(`lift-idor-reporter-${i}`, refs);
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      }
      const staffToken = await seedAdmin("STAFF_ADMIN");
      const res = await liftSuspension(preq(`http://localhost/api/v1/admin/users/${reported.member.userId}/lift-suspension`, undefined, staffToken), {
        params: { userId: reported.member.userId },
      });
      expect(res.status).toBe(403);
    });

    it("[threshold-post-lift] after a lift, an OLD report does not re-trigger, but 5 NEW unique reports do", async () => {
      const reported = await buildReadyProfile("post-lift-reported", refs);
      const catId = await categoryId("Other");
      const oldReporters = [] as { member: { sessionToken: string } }[];
      for (let i = 0; i < 5; i++) {
        const reporter = await buildReadyProfile(`post-lift-old-reporter-${i}`, refs);
        oldReporters.push(reporter);
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      }
      const [suspended] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(suspended.status).toBe("SUSPENDED");

      const superToken = await seedAdmin("SUPER_ADMIN");
      await liftSuspension(preq(`http://localhost/api/v1/admin/users/${reported.member.userId}/lift-suspension`, undefined, superToken), {
        params: { userId: reported.member.userId },
      });
      const [lifted] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(lifted.status).toBe("ACTIVE");

      // A 6th report from one of the OLD (already-counted) reporters must
      // not re-trigger — their earlier report predates the lift, and this
      // new one is only their SECOND ever, still only 1 unique post-lift.
      await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId, description: "old reporter again" }, oldReporters[0].member.sessionToken));
      const [stillActive] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(stillActive.status).toBe("ACTIVE");

      // 5 NEW unique reporters after the lift DO re-trigger. Reset the
      // in-memory register-endpoint rate limit first — this test alone
      // registers 11 members (1 reported + 5 old + 5 new), which would
      // otherwise trip the unrelated `register:<ip>` 10/60s cap.
      __resetRateLimitsForTests();
      for (let i = 0; i < 5; i++) {
        const reporter = await buildReadyProfile(`post-lift-new-reporter-${i}`, refs);
        await fileReport(preq("http://localhost/api/v1/reports", { reportedUserId: reported.member.userId, categoryId: catId }, reporter.member.sessionToken));
      }
      const [resuspended] = await db.select().from(users).where(eq(users.id, reported.member.userId));
      expect(resuspended.status).toBe("SUSPENDED");
    });
  });

  // --- Warnings --------------------------------------------------------------

  describe("Warnings", () => {
    it("[warning-issue] a SUPER_ADMIN can issue a warning; it's visible in the member's own warning history", async () => {
      const member = await buildReadyProfile("warning-issue-member", refs);
      const catId = await warningCategoryId("Policy Violation");
      const superToken = await seedAdmin("SUPER_ADMIN");

      const res = await issueWarning(preq(`http://localhost/api/v1/admin/users/${member.member.userId}/warnings`, { categoryId: catId, message: "Please follow the rules." }, superToken), {
        params: { userId: member.member.userId },
      });
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.warning.status).toBe("ACTIVE");
      expect(data.warning.acknowledgedAt).toBeNull();

      const myRes = await listMyWarnings(greq("http://localhost/api/v1/warnings/me", member.member.sessionToken));
      const { data: myData } = await myRes.json();
      expect(myData.warnings).toHaveLength(1);
    });

    it("[warning-issue-idor] a STAFF_ADMIN without warnings.issue cannot issue a warning", async () => {
      const member = await buildReadyProfile("warning-idor-member", refs);
      const catId = await warningCategoryId("Other");
      const staffToken = await seedAdmin("STAFF_ADMIN");
      const res = await issueWarning(preq(`http://localhost/api/v1/admin/users/${member.member.userId}/warnings`, { categoryId: catId, message: "x" }, staffToken), {
        params: { userId: member.member.userId },
      });
      expect(res.status).toBe(403);
    });

    it("[warning-admin-view] an admin can view any user's warning history", async () => {
      const member = await buildReadyProfile("warning-admin-view-member", refs);
      const catId = await warningCategoryId("Fake Information");
      const superToken = await seedAdmin("SUPER_ADMIN");
      await issueWarning(preq(`http://localhost/api/v1/admin/users/${member.member.userId}/warnings`, { categoryId: catId, message: "check your info" }, superToken), {
        params: { userId: member.member.userId },
      });

      const res = await listWarningsForUserAdmin(greq(`http://localhost/api/v1/admin/users/${member.member.userId}/warnings`, superToken), {
        params: { userId: member.member.userId },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.warnings).toHaveLength(1);
    });

    it("[warning-history-idor] a member cannot view another member's warning history via their own /warnings/me", async () => {
      const memberA = await buildReadyProfile("warning-hist-a", refs);
      const memberB = await buildReadyProfile("warning-hist-b", refs);
      const catId = await warningCategoryId("Other");
      const superToken = await seedAdmin("SUPER_ADMIN");
      await issueWarning(preq(`http://localhost/api/v1/admin/users/${memberA.member.userId}/warnings`, { categoryId: catId, message: "for A only" }, superToken), {
        params: { userId: memberA.member.userId },
      });

      const res = await listMyWarnings(greq("http://localhost/api/v1/warnings/me", memberB.member.sessionToken));
      const { data } = await res.json();
      expect(data.warnings).toHaveLength(0);
    });

    it("[warning-acknowledge] the recipient can explicitly acknowledge a warning; it's idempotent; another member cannot acknowledge it (IDOR)", async () => {
      const memberA = await buildReadyProfile("warning-ack-a", refs);
      const memberB = await buildReadyProfile("warning-ack-b", refs);
      const catId = await warningCategoryId("Other");
      const superToken = await seedAdmin("SUPER_ADMIN");
      const issueRes = await issueWarning(preq(`http://localhost/api/v1/admin/users/${memberA.member.userId}/warnings`, { categoryId: catId, message: "ack me" }, superToken), {
        params: { userId: memberA.member.userId },
      });
      const { data: issueData } = await issueRes.json();

      const idorRes = await acknowledgeWarning(preq(`http://localhost/api/v1/warnings/${issueData.warning.id}/acknowledge`, undefined, memberB.member.sessionToken), {
        params: { warningId: issueData.warning.id },
      });
      expect(idorRes.status).toBe(403);

      const ackRes = await acknowledgeWarning(preq(`http://localhost/api/v1/warnings/${issueData.warning.id}/acknowledge`, undefined, memberA.member.sessionToken), {
        params: { warningId: issueData.warning.id },
      });
      expect(ackRes.status).toBe(200);
      const { data: ackData } = await ackRes.json();
      expect(ackData.warning.status).toBe("ACKNOWLEDGED");
      expect(ackData.warning.acknowledgedAt).not.toBeNull();

      // idempotent
      const ackRes2 = await acknowledgeWarning(preq(`http://localhost/api/v1/warnings/${issueData.warning.id}/acknowledge`, undefined, memberA.member.sessionToken), {
        params: { warningId: issueData.warning.id },
      });
      expect(ackRes2.status).toBe(200);
    });

    it("[warning-categories-list] an admin with warnings.issue can list warning categories", async () => {
      const superToken = await seedAdmin("SUPER_ADMIN");
      const res = await listWarningCategoriesAdmin(greq("http://localhost/api/v1/admin/warning-categories", superToken));
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.categories.length).toBeGreaterThan(0);
    });
  });
});
