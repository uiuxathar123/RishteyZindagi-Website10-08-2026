/**
 * B18 — "Run reconciliation now" (`payments.review`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { GET as runsRoute, POST as runRoute } from "@/app/api/v1/admin/payments/reconcile/route";
import { db } from "@/server/db/client";
import { auditLogs, jobRuns } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables } from "./helpers/pcp";

const URL_ = "http://localhost/api/v1/admin/payments/reconcile";
const run = (token?: string) => runRoute(jreq(URL_, { method: "POST", token, body: {} }));
const runs = (token?: string) => runsRoute(jreq(URL_, { token }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("reconcile now", () => {
  it("[rec-authz] anonymous 401; member 401/403; staff without payments.review 403; delegation revocable immediately", async () => {
    const staff = await createAdmin("STAFF_ADMIN");
    const m = await createVerifiedMember("rec-authz");
    expect((await run()).status).toBe(401);
    expect((await runs()).status).toBe(401);
    expect([401, 403]).toContain((await run(m.sessionToken)).status);
    await revokePermission("STAFF_ADMIN", "payments.review");
    expect((await run(staff.token)).status).toBe(403);
    expect((await runs(staff.token)).status).toBe(403);
    expect(await db.select().from(jobRuns).where(eq(jobRuns.jobName, "payment-reconcile"))).toHaveLength(0); // a refused call started nothing
    await grantPermission("STAFF_ADMIN", "payments.review");
    expect((await run(staff.token)).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "payments.review");
    expect((await run(staff.token)).status).toBe(403);
  });

  it("[rec-run] a Super Admin run executes the real job, records a run row and an audit entry naming the admin; history lists it", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const res = await run(sup.token);
    expect(res.status).toBe(200);
    const out = (await res.json()).data;
    expect(out.status).toBe("SUCCEEDED");
    expect(out.stats).toMatchObject({ checked: expect.any(Number), resolved: expect.any(Number) });

    const rows = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "payment-reconcile"));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SUCCEEDED");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "payments.reconcile_requested"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "ADMIN", actorId: sup.id, actorRole: "SUPER_ADMIN" });

    const hist = (await (await runs(sup.token)).json()).data.runs;
    expect(hist).toHaveLength(1);
    expect(hist[0].id).toBe(rows[0].id);
  });

  it("[rec-rate-limit] repeated clicks are rate limited (429) rather than stacking runs", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await run(sup.token)).status);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes.slice(6)).toEqual([429, 429]);
  });
});
