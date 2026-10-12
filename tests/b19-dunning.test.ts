/**
 * B19 — renewal follow-up groundwork. Reminders only: nothing here may create a payment or charge anyone.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { membershipPlans, memberships, notifications, payments, renewalCycles } from "@/server/db/schema";
import { runJob } from "@/server/jobs/runner";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";
import { GET as overview } from "@/app/api/v1/admin/renewals/route";

const DAY = 24 * 60 * 60 * 1000;
async function addMembership(userId: string, over: Partial<typeof memberships.$inferInsert>) {
  const [p] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, "PLAN_7DAY_INR"));
  const [m] = await db.insert(memberships).values({ userId, planId: p.id, status: "EXPIRED", startedAt: new Date(Date.now() - 40 * DAY), expiresAt: new Date(Date.now() - DAY), autoRenew: true, ...over }).returning();
  return m;
}
async function run(job: string) {
  const r = await runJob(job, "CLI");
  expect(r?.status, JSON.stringify(r)).toBe("SUCCEEDED");
  return r!.stats as Record<string, number>;
}
const cycle = async (membershipId: string) => (await db.select().from(renewalCycles).where(eq(renewalCycles.membershipId, membershipId)))[0];
const setLapsed = (membershipId: string, daysAgo: number) => db.update(renewalCycles).set({ lapsedAt: new Date(Date.now() - daysAgo * DAY) }).where(eq(renewalCycles.membershipId, membershipId));
const notes = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("membership-dunning", () => {
  it("[dn-lifecycle] lapse starts a cycle; one reminder after 3 days; closed after 10; never a payment", async () => {
    const u = await createVerifiedMember("dn-a");
    const m = await addMembership(u.userId, {});
    await run("membership-renewal-failed");
    expect((await cycle(m.id)).state).toBe("LAPSED");
    await run("membership-renewal-failed"); // idempotent
    expect((await db.select().from(renewalCycles)).length).toBe(1);

    expect(await run("membership-dunning")).toMatchObject({ followUps: 0, closed: 0 }); // too early
    await setLapsed(m.id, 4);
    expect(await run("membership-dunning")).toMatchObject({ followUps: 1 });
    expect((await cycle(m.id)).state).toBe("FOLLOW_UP_SENT");
    expect((await notes(u.userId)).filter((n) => n.dedupeKey === `renewal_follow_up:${m.id}`)).toHaveLength(1);
    expect(await run("membership-dunning")).toMatchObject({ followUps: 0 }); // second run sends nothing more
    expect((await notes(u.userId)).filter((n) => n.dedupeKey === `renewal_follow_up:${m.id}`)).toHaveLength(1);

    await setLapsed(m.id, 11);
    expect(await run("membership-dunning")).toMatchObject({ closed: 1 });
    const c = await cycle(m.id);
    expect(c.state).toBe("CLOSED");
    expect(c.closedAt).not.toBeNull();
    expect((await db.select().from(payments)).length).toBe(0);
  });

  it("[dn-renewed] buying a newer active membership marks the cycle RENEWED and stops reminders", async () => {
    const u = await createVerifiedMember("dn-b");
    const m = await addMembership(u.userId, { createdAt: new Date(Date.now() - 30 * DAY) });
    await run("membership-renewal-failed");
    const fresh = await addMembership(u.userId, { status: "ACTIVE", expiresAt: new Date(Date.now() + 20 * DAY), autoRenew: false, createdAt: new Date() });
    await setLapsed(m.id, 4);
    expect(await run("membership-dunning")).toMatchObject({ renewed: 1, followUps: 0 });
    const c = await cycle(m.id);
    expect(c.state).toBe("RENEWED");
    expect(c.renewedMembershipId).toBe(fresh.id);
    expect((await notes(u.userId)).filter((n) => n.dedupeKey?.startsWith("renewal_follow_up"))).toHaveLength(0);
  });

  it("[dn-no-pref] members without the auto-renew preference never get a cycle or a follow-up", async () => {
    const u = await createVerifiedMember("dn-c");
    await addMembership(u.userId, { autoRenew: false });
    await run("membership-renewal-failed");
    expect((await db.select().from(renewalCycles)).length).toBe(0);
    expect(await run("membership-dunning")).toMatchObject({ followUps: 0 });
  });
});

describe("admin overview", () => {
  it("[dn-admin] counts by state for payments.review holders only, with the no-auto-charge note", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const u = await createVerifiedMember("dn-d");
    const m = await addMembership(u.userId, {});
    await run("membership-renewal-failed");
    await setLapsed(m.id, 4);
    await run("membership-dunning");
    const get = (token?: string) => overview(jreq("http://localhost/api/v1/admin/renewals", { token }));
    expect((await get()).status).toBe(401);
    await revokePermission("STAFF_ADMIN", "payments.review");
    expect((await get(staff.token)).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "payments.review");
    let d;
    try {
      d = (await (await get(staff.token)).json()).data;
    } finally {
      await revokePermission("STAFF_ADMIN", "payments.review"); // never leave a grant in the shared test database
    }
    expect(d.counts).toMatchObject({ LAPSED: 0, FOLLOW_UP_SENT: 1, RENEWED: 0, CLOSED: 0 });
    expect(d.recent[0]).toMatchObject({ state: "FOLLOW_UP_SENT" });
    expect(d.note).toMatch(/never charges/i);
    expect((await get(sup.token)).status).toBe(200);
  });
});
