/**
 * B18 — Super-Admin membership-plan management (`plans.manage`).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { GET as listPlansAdmin, POST as createPlanRoute } from "@/app/api/v1/admin/membership-plans/route";
import { PATCH as patchPlanRoute } from "@/app/api/v1/admin/membership-plans/[planId]/route";
import { GET as publicPlans } from "@/app/api/v1/membership-plans/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { db } from "@/server/db/client";
import { auditLogs, membershipPlans } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { hasAdvancedSearchEntitlement } from "@/server/modules/memberships/membership-gate";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables } from "./helpers/pcp";
import { memberships } from "@/server/db/schema";

const URL_ = "http://localhost/api/v1";

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  await resetPaymentGatewaysForTests();
  __resetRateLimitsForTests();
});
afterEach(async () => {
  const mine = await db.select({ id: membershipPlans.id }).from(membershipPlans).where(like(membershipPlans.code, "B18T_%"));
  if (mine.length) await db.delete(memberships).where(inArray(memberships.planId, mine.map((p) => p.id)));
  await db.delete(membershipPlans).where(like(membershipPlans.code, "B18T_%"));
});

const create = (token: string | undefined, body: unknown) => createPlanRoute(jreq(`${URL_}/admin/membership-plans`, { method: "POST", body, token }));
const patch = (token: string | undefined, id: string, body: unknown) =>
  patchPlanRoute(jreq(`${URL_}/admin/membership-plans/${id}`, { method: "PATCH", body, token }), { params: { planId: id } });
const list = (token?: string) => listPlansAdmin(jreq(`${URL_}/admin/membership-plans`, { token }));
const goodPlan = { code: "B18T_ONE", name: "Test Pass", currency: "INR", priceInSmallestUnit: 49900, durationDays: 90, advancedSearch: true };

describe("authorization", () => {
  it("[plans-authz] anonymous 401; member 401/403; staff without plans.manage 403 on every verb; Super Admin allowed; staff granted plans.manage allowed and revocable immediately", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const member = await createVerifiedMember("plans-member");
    const made = await (await create(sup.token, goodPlan)).json();
    const id = made.data.plan.id;

    expect((await list()).status).toBe(401);
    expect((await create(undefined, goodPlan)).status).toBe(401);
    expect((await patch(undefined, id, { name: "x y" })).status).toBe(401);
    for (const call of [() => list(member.sessionToken), () => create(member.sessionToken, goodPlan), () => patch(member.sessionToken, id, { name: "Hacked" })]) {
      expect([401, 403]).toContain((await call()).status);
    }
    // the seeded STAFF_ADMIN role does not carry plans.manage
    expect((await list(staff.token)).status).toBe(403);
    expect((await create(staff.token, { ...goodPlan, code: "B18T_TWO" })).status).toBe(403);
    expect((await patch(staff.token, id, { name: "Staff edit" })).status).toBe(403);
    expect((await (await list(sup.token)).json()).data.plans.some((p: { id: string }) => p.id === id)).toBe(true);

    await grantPermission("STAFF_ADMIN", "plans.manage");
    expect((await list(staff.token)).status).toBe(200);
    expect((await patch(staff.token, id, { name: "Staff edit" })).status).toBe(200);
    await revokePermission("STAFF_ADMIN", "plans.manage");
    expect((await list(staff.token)).status).toBe(403); // immediate
  });
});

describe("validation", () => {
  it("[plans-validation] code, name, currency, price, duration and unknown keys are validated; duplicate code is 409; immutable fields cannot be patched", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const bads: Array<[string, Record<string, unknown>]> = [
      ["short code", { code: "ab" }],
      ["bad chars", { code: "B18T bad!" }],
      ["short name", { name: "x" }],
      ["currency", { currency: "EUR" }],
      ["price zero", { priceInSmallestUnit: 0 }],
      ["price below 1.00", { priceInSmallestUnit: 99 }],
      ["price fraction", { priceInSmallestUnit: 100.5 }],
      ["price too high", { priceInSmallestUnit: 1_000_000_000 }],
      ["duration 0", { durationDays: 0 }],
      ["duration too long", { durationDays: 731 }],
      ["unknown key", { isFree: true }],
    ];
    for (const [label, over] of bads) expect((await create(sup.token, { ...goodPlan, code: "B18T_V", ...over })).status, label).toBe(400);
    expect((await create(sup.token, goodPlan)).status).toBe(200);
    expect((await create(sup.token, goodPlan)).status).toBe(409);
    const id = (await (await list(sup.token)).json()).data.plans.find((p: { code: string }) => p.code === "B18T_ONE").id;
    for (const bad of [{}, { code: "B18T_NEW" }, { currency: "USD" }, { durationDays: 30 }, { priceInSmallestUnit: -5 }, { name: "" }]) {
      expect((await patch(sup.token, id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await patch(sup.token, "00000000-0000-4000-8000-000000000000", { name: "Nobody" })).status).toBe(404);
    expect((await patch(sup.token, "not-a-uuid", { name: "Nobody" })).status).toBe(400);
  });
});

describe("behaviour", () => {
  it("[plans-lifecycle] create → visible in the public catalogue with normalised features; price change; entitlement toggle; deactivate hides it and blocks checkout; reactivate restores; every change audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const res = await create(sup.token, { ...goodPlan, code: "b18t_life", durationDays: 180 }); // code is upper-cased; 180 days derives the boost
    expect(res.status).toBe(200);
    const plan = (await res.json()).data.plan;
    expect(plan.code).toBe("B18T_LIFE");
    expect(plan.features).toEqual({ chat: true, advancedSearch: true, visibilityBoost: true });

    const cat = async () => (await (await publicPlans(req(`${URL_}/membership-plans`, undefined, { method: "GET" }))).json()).data.plans as Array<{ code: string; priceInSmallestUnit: number; features: Record<string, boolean> }>;
    let pub = (await cat()).find((p) => p.code === "B18T_LIFE")!;
    expect(pub.priceInSmallestUnit).toBe(49900);
    expect(pub.features.advancedSearch).toBe(true);

    expect((await patch(sup.token, plan.id, { priceInSmallestUnit: 59900, advancedSearch: false })).status).toBe(200);
    pub = (await cat()).find((p) => p.code === "B18T_LIFE")!;
    expect(pub.priceInSmallestUnit).toBe(59900);
    expect(pub.features.advancedSearch).toBe(false);

    // the entitlement the server enforces follows the plan flag
    const m = await createVerifiedMember("plans-life");
    await db.insert(memberships).values({ userId: m.userId, planId: plan.id, status: "ACTIVE", startedAt: new Date(), expiresAt: null });
    expect(await hasAdvancedSearchEntitlement(m.userId)).toBe(false);
    await patch(sup.token, plan.id, { advancedSearch: true });
    expect(await hasAdvancedSearchEntitlement(m.userId)).toBe(true);
    const adminList = (await (await list(sup.token)).json()).data.plans.find((p: { id: string }) => p.id === plan.id);
    expect(adminList.activeMembers).toBe(1);

    // deactivate: gone from the catalogue, checkout refused, the member keeps what they paid for
    expect((await patch(sup.token, plan.id, { isActive: false })).status).toBe(200);
    expect((await cat()).some((p) => p.code === "B18T_LIFE")).toBe(false);
    const co = await checkout(req(`${URL_}/memberships/checkout`, { planCode: "B18T_LIFE" }, { token: m.sessionToken }));
    expect(co.status).toBe(404);
    expect(await hasAdvancedSearchEntitlement(m.userId)).toBe(true);
    expect((await patch(sup.token, plan.id, { isActive: true })).status).toBe(200);
    expect((await cat()).some((p) => p.code === "B18T_LIFE")).toBe(true);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, plan.id)).orderBy(auditLogs.createdAt);
    expect(rows.map((r) => r.action)).toEqual(["plan.created", "plan.updated", "plan.updated", "plan.deactivated", "plan.activated"]);
    expect(rows[1].metadata).toMatchObject({ changed: { priceInSmallestUnit: { previous: 49900, new: 59900 }, advancedSearch: { previous: true, new: false } } });
    expect(rows.every((r) => r.actorType === "ADMIN" && r.actorId === sup.id && r.actorRole === "SUPER_ADMIN")).toBe(true);
  });

  it("[plans-price-only-future] a price change does not alter an existing membership", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const plan = (await (await create(sup.token, { ...goodPlan, code: "B18T_PRICE" })).json()).data.plan;
    const m = await createVerifiedMember("plans-price");
    const expiresAt = new Date(Date.now() + 40 * 86400_000);
    await db.insert(memberships).values({ userId: m.userId, planId: plan.id, status: "ACTIVE", startedAt: new Date(), expiresAt });
    await patch(sup.token, plan.id, { priceInSmallestUnit: 99900 });
    const [row] = await db.select().from(memberships).where(eq(memberships.userId, m.userId));
    expect(row.status).toBe("ACTIVE");
    expect(row.expiresAt!.getTime()).toBe(expiresAt.getTime());
  });
});
