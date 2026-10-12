/**
 * B19 — dashboard time series, security-events CSV export, delegated plan/community access.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getDashboard } from "@/app/api/v1/admin/dashboard/route";
import { GET as getTrends } from "@/app/api/v1/admin/dashboard/trends/route";
import { GET as exportRoute } from "@/app/api/v1/admin/security-events/export/route";
import { GET as eventsRoute } from "@/app/api/v1/admin/security-events/route";
import { GET as listPlans } from "@/app/api/v1/admin/membership-plans/route";
import { GET as listCommunities } from "@/app/api/v1/admin/communities/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { db } from "@/server/db/client";
import { auditLogs, loginAttempts } from "@/server/db/schema";
import { csvCell } from "@/server/modules/admin/security-events.service";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables } from "./helpers/pcp";

const U = "http://localhost/api/v1/admin";
const trends = (token?: string, q = "") => getTrends(jreq(`${U}/dashboard/trends${q}`, { token }));
const exp = (token?: string, q = "") => exportRoute(jreq(`${U}/security-events/export${q}`, { token }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  await resetPaymentGatewaysForTests();
  __resetRateLimitsForTests();
  __clearDevPaymentStoreForTests();
});

describe("dashboard trends", () => {
  it("[tr-authz] needs users.view: anonymous 401, member 401/403, staff allowed", async () => {
    const staff = await createAdmin("STAFF_ADMIN");
    const m = await createVerifiedMember("tr-member");
    expect((await trends()).status).toBe(401);
    expect([401, 403]).toContain((await trends(m.sessionToken)).status);
    expect((await trends(staff.token)).status).toBe(200);
  });

  it("[tr-series] zero-filled daily series whose sums equal the point-in-time totals; days clamped; bad input 400", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const a = await createVerifiedMember("tr-a");
    await createVerifiedMember("tr-b");
    const c = await checkout(req(`${U.replace("/admin", "")}/memberships/checkout`, { planCode: "PLAN_MONTHLY_INR", devSimulateOutcome: "SUCCESS" }, { token: a.sessionToken, method: "POST" }));
    const cd = (await c.json()).data;
    expect(cd.paymentId).toBeTruthy();
    await verifyPayment(req(`${U.replace("/admin", "")}/payments/${cd.paymentId}/verify`, {}, { token: a.sessionToken, method: "POST" }), { params: { paymentId: cd.paymentId } });

    const t = (await (await trends(sup.token, "?days=30")).json()).data;
    expect(t.days).toBe(30);
    expect(t.series.length).toBe(30);
    expect(t.series.every((d: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    const dates = t.series.map((d: { date: string }) => d.date);
    expect([...dates].sort()).toEqual(dates); // ascending, no gaps by construction
    const totals = (await (await getDashboard(jreq(`${U}/dashboard`, { token: sup.token }))).json()).data.stats;
    const sum = (k: string) => t.series.reduce((n: number, d: Record<string, number>) => n + d[k], 0);
    expect(sum("signups")).toBe(totals.users.total);
    expect(sum("paymentsSucceeded")).toBe(totals.payments.successful);
    expect(totals.payments.successful).toBeGreaterThan(0);
    const revSum = t.series.reduce((n: number, d: { revenue: Record<string, number> }) => n + (d.revenue.INR ?? 0), 0);
    const totalInr = totals.payments.revenueByCurrency.find((r: { currency: string }) => r.currency === "INR");
    expect(revSum).toBe(totalInr.totalInSmallestUnit);
    expect(t.currencies).toContain("INR");

    expect((await (await trends(sup.token, "?days=1")).json()).data.days).toBe(7);
    expect((await (await trends(sup.token, "?days=9999")).json()).data.days).toBe(90);
    expect((await trends(sup.token, "?days=abc")).status).toBe(400);
    expect((await (await trends(sup.token)).json()).data.days).toBe(30);
  });
});

describe("security events export", () => {
  it("[ex-authz] needs audit.view; delegation is live and revocable", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const m = await createVerifiedMember("ex-member");
    expect((await exp()).status).toBe(401);
    expect([401, 403]).toContain((await exp(m.sessionToken)).status);
    await revokePermission("STAFF_ADMIN", "audit.view");
    expect((await exp(staff.token)).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "audit.view");
    expect((await exp(staff.token)).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "audit.view");
    expect((await exp(staff.token)).status).toBe(403);
    expect((await exp(sup.token)).status).toBe(200);
  });

  it("[ex-csv] returns an attachment with a header row, honours filters, masks identifiers, defuses formulas, and is audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    await db.insert(loginAttempts).values([
      { identifier: "victim@example.com", success: false, ipAddress: "203.0.113.5", failureReason: "=HYPERLINK(\"http://evil\")" },
      { identifier: "ok@example.com", success: true, ipAddress: "203.0.113.6" },
    ]);
    const res = await exp(sup.token, "?type=LOGIN_FAILED");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="security-events-\d{4}-\d{2}-\d{2}\.csv"$/);
    const text = await res.text();
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("occurred_at,source,kind,actor_type,subject,ip_address,detail");
    const failed = lines.filter((l) => l.includes("LOGIN_FAILED"));
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain("victim@example.com"); // masked
    expect(text).toContain("v***@example.com");
    expect(text).not.toContain("ok@example.com"); // filter respected
    expect(text).not.toMatch(/(^|,)=HYPERLINK/); // never starts a cell with =
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "security_events.exported"));
    expect(logs.length).toBe(1);
    expect((await exp(sup.token, "?type=BOGUS")).status).toBe(400);
    // the on-screen list still caps at 50 per page
    expect((await eventsRoute(jreq(`${U}/security-events?pageSize=51`, { token: sup.token }))).status).toBe(400);
  });

  it("[ex-csvcell] formula characters are neutralised and quoting is correct", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell("plain")).toBe("plain");
  });
});

describe("delegated screens' APIs", () => {
  it("[dg-plans-communities] a staff member granted plans.manage / communities.manage reaches exactly those APIs", async () => {
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await listPlans(jreq(`${U}/membership-plans`, { token: staff.token }))).status).toBe(403);
    expect((await listCommunities(jreq(`${U}/communities`, { token: staff.token }))).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "plans.manage");
    expect((await listPlans(jreq(`${U}/membership-plans`, { token: staff.token }))).status).toBe(200);
    expect((await listCommunities(jreq(`${U}/communities`, { token: staff.token }))).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "communities.manage");
    expect((await listCommunities(jreq(`${U}/communities`, { token: staff.token }))).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "plans.manage");
    await revokePermission("STAFF_ADMIN", "communities.manage");
    expect((await listPlans(jreq(`${U}/membership-plans`, { token: staff.token }))).status).toBe(403);
  });
});
