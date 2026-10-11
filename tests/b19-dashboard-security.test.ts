/** B19 — security-events CSV export tests. */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as exportRoute } from "@/app/api/v1/admin/security-events/export/route";
import { GET as eventsRoute } from "@/app/api/v1/admin/security-events/route";
import { db } from "@/server/db/client";
import { auditLogs, loginAttempts } from "@/server/db/schema";
import { csvCell } from "@/server/modules/admin/security-events.service";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables } from "./helpers/pcp";

const U = "http://localhost/api/v1/admin";
const exp = (token?: string, q = "") => exportRoute(jreq(`${U}/security-events/export${q}`, { token }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
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
