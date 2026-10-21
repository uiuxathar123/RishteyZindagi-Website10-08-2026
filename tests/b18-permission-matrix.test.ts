/**
 * B18 — declared permission matrix for EVERY admin route, checked against the running handlers.
 *
 * The table below is the source of truth (it is mirrored in B18_PERMISSION_MATRIX.md). The test:
 *   1. fails when a route/method exists in src/app/api/v1/admin without a declared rule (a new admin
 *      route cannot ship without deciding who may call it);
 *   2. for each rule, proves a role holding ONLY the required permission gets past authorization, and a role
 *      holding EVERY OTHER permission is refused (403 — or 400 on a write, the documented B1 convention that
 *      body validation precedes the permission check; those writes are denied with valid bodies in the
 *      per-feature suites and in the explicit cases at the bottom of this file);
 *   3. Super-Admin-only rules are refused to a staff role that holds every permission;
 *   4. permission changes take effect on the very next request.
 */
import { afterAll, describe, it, expect, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminRoles, permissions, rolePermissions } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createAdmin, resetPcpTables, jreq } from "./helpers/pcp";

type Rule = string; // a permission key | "SUPER" | "SESSION" (any signed-in admin) | "PUBLIC"

/** route → method → rule */
const MATRIX: Record<string, Record<string, Rule>> = {
  "admin/login": { POST: "PUBLIC" },
  "admin/me": { GET: "SESSION" },
  "admin/me/password": { POST: "SESSION" },
  "admin/ping": { GET: "SESSION" },
  "admin/dashboard": { GET: "users.view" },
  "admin/users": { GET: "users.view" },
  "admin/users/[userId]": { GET: "users.view" },
  "admin/users/[userId]/moderation": { GET: "users.view" },
  "admin/users/[userId]/suspend": { POST: "users.suspend" },
  "admin/users/[userId]/lift-suspension": { POST: "users.suspend" },
  "admin/users/[userId]/ban": { POST: "users.ban" },
  "admin/users/[userId]/unban": { POST: "users.ban" },
  "admin/users/[userId]/warnings": { GET: "warnings.issue", POST: "warnings.issue" },
  "admin/warning-categories": { GET: "warnings.issue" },
  "admin/account-deletions": { GET: "users.view" },
  "admin/profiles/[profileId]/verify": { PATCH: "profiles.verify" },
  "admin/reports": { GET: "reports.resolve" },
  "admin/reports/[reportId]": { PATCH: "reports.resolve" },
  "admin/report-categories": { GET: "reports.categories.manage", POST: "reports.categories.manage" },
  "admin/report-categories/[categoryId]": { PATCH: "reports.categories.manage" },
  "admin/memberships": { GET: "payments.review" },
  "admin/invoices": { GET: "payments.review" },
  "admin/invoices/[invoiceId]": { GET: "payments.review" },
  "admin/invoices/[invoiceId]/cancel": { POST: "payments.review" },
  "admin/invoices/[invoiceId]/regenerate": { POST: "payments.review" },
  "admin/payments": { GET: "payments.review" },
  "admin/payments/[paymentId]/manual-activate": { POST: "payments.review" },
  "admin/payments/[paymentId]/refunds": { GET: "payments.review", POST: "payments.review" },
  "admin/payments/reconcile": { GET: "payments.review", POST: "payments.review" },
  "admin/payments/config": { GET: "platform.settings.manage", PATCH: "platform.settings.manage" },
  "admin/payments/config/[gateway]/credentials": { PUT: "platform.settings.manage" },
  "admin/payments/config/[gateway]/test-connection": { POST: "platform.settings.manage" },
  "admin/payment-gateways": { GET: "platform.settings.manage" },
  "admin/payment-gateways/[gatewayId]": { PATCH: "platform.settings.manage" },
  "admin/payment-gateways/[gatewayId]/activate": { POST: "platform.settings.manage" },
  "admin/payment-gateways/[gatewayId]/deactivate": { POST: "platform.settings.manage" },
  "admin/payment-gateways/[gatewayId]/test-connection": { POST: "platform.settings.manage" },
  "admin/matching/weights": { GET: "platform.settings.manage", PATCH: "platform.settings.manage" },
  "admin/otp/config": { GET: "platform.settings.manage", PATCH: "platform.settings.manage" },
  "admin/otp/provider": { GET: "platform.settings.manage", PATCH: "platform.settings.manage" },
  "admin/otp/policy": { GET: "SUPER", PATCH: "SUPER" },
  "admin/platform-settings": { GET: "platform.settings.manage", PATCH: "platform.settings.manage" },
  "admin/membership-plans": { GET: "plans.manage", POST: "plans.manage" },
  "admin/membership-plans/[planId]": { PATCH: "plans.manage" },
  "admin/communities": { GET: "communities.manage", POST: "communities.manage" },
  "admin/communities/[communityId]": { PATCH: "communities.manage" },
  "admin/audit-logs": { GET: "audit.view" },
  "admin/security-events": { GET: "audit.view" },
  "admin/staff": { GET: "staff.manage", POST: "staff.manage" },
  "admin/staff/[staffId]": { PATCH: "staff.manage" },
  "admin/staff/[staffId]/reset-password": { POST: "staff.manage" },
  "admin/roles": { GET: "staff.manage", POST: "staff.manage" },
  "admin/roles/[roleId]/permissions": { PUT: "SUPER" },
  // ---- B19 --------------------------------------------------------------------------------------
  "admin/login/verify-mfa": { POST: "PUBLIC" },
  "admin/site-controls": { GET: "SUPER", PATCH: "SUPER" },
  "admin/security-settings": { GET: "SUPER", PATCH: "SUPER" },
  // Personal Matchmaking: Super Admin only by role name (never a delegable permission).
  "admin/matchmaking/settings": { GET: "SUPER", PUT: "SUPER" },
  "admin/matchmaking/cases": { GET: "SUPER" },
  "admin/matchmaking/cases/[caseId]": { GET: "SUPER" },
  "admin/matchmaking/cases/[caseId]/notes": { POST: "SUPER" },
  "admin/matchmaking/cases/[caseId]/status": { POST: "SUPER" },
  "admin/matchmaking/cases/[caseId]/recommendations": { GET: "SUPER" },
  "admin/matchmaking/cases/[caseId]/suggestions": { POST: "SUPER" },
  "admin/matchmaking/suggestions/[suggestionId]": { POST: "SUPER" },
  "admin/matchmaking/members": { GET: "SUPER" },
  "admin/matchmaking/introductions": { GET: "SUPER", POST: "SUPER" },
  "admin/matchmaking/introductions/preview": { GET: "SUPER" },
  "admin/matchmaking/introductions/candidates": { GET: "SUPER" },
  "admin/matchmaking/overview": { GET: "SUPER" },
  "admin/matchmaking/directory": { GET: "SUPER" },
  "admin/matchmaking/invitations": { GET: "SUPER", POST: "SUPER" },
  "admin/matchmaking/invitations/[invitationId]/revoke": { POST: "SUPER" },
  "admin/matchmaking/introductions/[introductionId]/withdraw": { POST: "SUPER" },
  "admin/matchmaking/company-verification/[userId]": { GET: "SUPER", POST: "SUPER" },
  "admin/profile-approvals": { GET: "profiles.approve" },
  "admin/profile-approvals/[profileId]": { POST: "profiles.approve" },
  "admin/support-contact": { GET: "support.manage", PATCH: "support.manage" },
  "admin/contact-messages": { GET: "support.manage" },
  "admin/contact-messages/[messageId]": { PATCH: "support.manage" },
  "admin/success-stories": { GET: "content.manage", POST: "content.manage" },
  "admin/success-stories/[storyId]": { PATCH: "content.manage", DELETE: "content.manage" },
  "admin/dashboard/trends": { GET: "users.view" },
  "admin/security-events/export": { GET: "audit.view" },
  "admin/groups": { GET: "groups.manage", POST: "groups.manage" },
  "admin/groups/[groupId]": { PATCH: "groups.manage" },
  "admin/groups/[groupId]/posts": { GET: "groups.manage" },
  "admin/groups/[groupId]/members": { GET: "groups.manage" },
  "admin/groups/[groupId]/members/[userId]": { PATCH: "groups.manage" },
  "admin/group-posts/[postId]": { PATCH: "groups.manage" },
  "admin/renewals": { GET: "payments.review" },
};

const loaders = (import.meta as unknown as { glob: (p: string) => unknown }).glob("/src/app/api/v1/admin/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const UUID = "00000000-0000-4000-8000-000000000001";
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

interface Call { route: string; method: string; call: (token?: string) => Promise<Response> }
let calls: Call[] = [];
let allKeys: string[] = [];

beforeAll(async () => {
  for (const [file, load] of Object.entries(loaders).sort(([a], [b]) => a.localeCompare(b))) {
    const route = file.replace("/src/app/api/v1/", "").replace("/route.ts", "");
    const mod = await load();
    const params: Record<string, string> = {};
    const urlPath = route.replace(/\[([^\]]+)\]/g, (_m, n: string) => ((params[n] = UUID), UUID));
    for (const method of METHODS) {
      const handler = mod[method] as ((req: NextRequest, ctx: unknown) => Promise<Response>) | undefined;
      if (typeof handler !== "function") continue;
      calls.push({
        route,
        method,
        call: (token) =>
          handler(
            new NextRequest(`http://localhost/api/v1/${urlPath}`, {
              method,
              headers: { ...(method === "GET" ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
              ...(method === "GET" ? {} : { body: "{}" }),
            }),
            { params }
          ),
      });
    }
  }
  allKeys = (await db.select().from(permissions)).map((p) => p.key);
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

// This file creates many throw-away roles; leave the shared database with only the seeded ones (tests/db.test.ts asserts that).
afterAll(async () => {
  await resetAdminUsers();
  await db.execute(sql`DELETE FROM admin_roles WHERE name LIKE 'B18T_%'`);
});

async function roleWith(name: string, keys: string[]) {
  await db.delete(adminRoles).where(eq(adminRoles.name, name));
  const [role] = await db.insert(adminRoles).values({ name }).returning();
  if (keys.length) {
    const perms = await db.select().from(permissions).where(inArray(permissions.key, keys));
    await db.insert(rolePermissions).values(perms.map((p) => ({ roleId: role.id, permissionId: p.id })));
  }
  return role;
}

describe("declared permission matrix", () => {
  it("[matrix-complete] every admin route and method has a declared rule, and there are no stale rules", () => {
    const undeclared = calls.filter((c) => !MATRIX[c.route]?.[c.method]).map((c) => `${c.method} ${c.route}`);
    expect(undeclared).toEqual([]);
    const present = new Set(calls.map((c) => `${c.method} ${c.route}`));
    const stale = Object.entries(MATRIX).flatMap(([r, ms]) => Object.keys(ms).map((m) => `${m} ${r}`)).filter((k) => !present.has(k));
    expect(stale).toEqual([]);
  });

  it("[matrix-keys-exist] every permission named in the matrix exists in the permissions table", () => {
    const named = new Set(Object.values(MATRIX).flatMap((ms) => Object.values(ms)).filter((r) => !["SUPER", "SESSION", "PUBLIC"].includes(r)));
    for (const k of named) expect(allKeys, k).toContain(k);
  });

  it("[matrix-enforced] a role with ONLY the required permission is let in; a role with every OTHER permission is refused; Super-only rules refuse every staff role", async () => {
    const wrongly: string[] = [];
    const roles = new Map<string, string>(); // key → admin token
    const superAdmin = await createAdmin("SUPER_ADMIN");
    const fullStaffRole = await roleWith("B18T_FULL_STAFF", allKeys.filter((k) => k !== "staff.manage"));
    void fullStaffRole;
    const fullStaff = await createAdmin("B18T_FULL_STAFF");
    // SESSION rules only require a signed-in admin whose role is SUPER_ADMIN or STAFF_ADMIN (role-name check).
    const anyAdmin = await createAdmin("STAFF_ADMIN");

    for (const c of calls) {
      const rule = MATRIX[c.route][c.method];
      if (rule === "PUBLIC") continue;
      if (rule === "SESSION") {
        const res = await c.call(anyAdmin.token);
        if (res.status === 401 || res.status === 403) wrongly.push(`SESSION ${c.method} ${c.route} → ${res.status} for a signed-in admin`);
        continue;
      }
      if (rule === "SUPER") {
        const staffRes = await c.call(fullStaff.token);
        const superRes = await c.call(superAdmin.token);
        if (staffRes.status !== 403 && !(staffRes.status === 400 && c.method !== "GET")) wrongly.push(`SUPER ${c.method} ${c.route} → staff got ${staffRes.status}`);
        if (superRes.status === 401 || superRes.status === 403) wrongly.push(`SUPER ${c.method} ${c.route} → super got ${superRes.status}`);
        continue;
      }
      // permissioned
      if (!roles.has(`only:${rule}`)) {
        await roleWith(`B18T_ONLY_${rule}`, [rule]);
        __resetRateLimitsForTests();
        roles.set(`only:${rule}`, (await createAdmin(`B18T_ONLY_${rule}`)).token);
        await roleWith(`B18T_BUT_${rule}`, allKeys.filter((k) => k !== rule));
        __resetRateLimitsForTests();
        roles.set(`but:${rule}`, (await createAdmin(`B18T_BUT_${rule}`)).token);
      }
      const yes = await c.call(roles.get(`only:${rule}`));
      if (yes.status === 401 || yes.status === 403) wrongly.push(`${rule} ${c.method} ${c.route} → holder got ${yes.status}`);
      const no = await c.call(roles.get(`but:${rule}`));
      const deniedOk = no.status === 403 || (no.status === 400 && c.method !== "GET");
      if (!deniedOk) wrongly.push(`${rule} ${c.method} ${c.route} → role without it got ${no.status}`);
    }
    expect(wrongly).toEqual([]);
  }, 300000);

  it("[matrix-sensitive-writes-valid-body] the high-risk writes are refused with 403 (not just 400) when the permission is missing, using valid bodies", async () => {
    const all = (await db.select().from(permissions)).map((p) => p.key);
    const cases: Array<[string, string, string, unknown, string]> = [
      ["POST", "admin/membership-plans", "plans.manage", { code: "B18T_X", name: "Nope", currency: "INR", priceInSmallestUnit: 10000, durationDays: 30 }, "http://localhost/api/v1/admin/membership-plans"],
      ["POST", "admin/communities", "communities.manage", { name: "Nope Community", religionId: UUID }, "http://localhost/api/v1/admin/communities"],
      ["PATCH", "admin/platform-settings", "platform.settings.manage", { signup: { open: false } }, "http://localhost/api/v1/admin/platform-settings"],
      ["POST", "admin/payments/reconcile", "payments.review", {}, "http://localhost/api/v1/admin/payments/reconcile"],
      ["POST", "admin/staff", "staff.manage", { name: "Mallory", email: "mallory@example.com", roleName: "SUPER_ADMIN" }, "http://localhost/api/v1/admin/staff"],
    ];
    const handlers: Record<string, () => Promise<Record<string, unknown>>> = {};
    for (const [file, load] of Object.entries(loaders)) handlers[file.replace("/src/app/api/v1/", "").replace("/route.ts", "")] = load;
    for (const [method, route, perm, body, url] of cases) {
      await roleWith(`B18T_VB_${perm}`, all.filter((k) => k !== perm));
      __resetRateLimitsForTests();
      const admin = await createAdmin(`B18T_VB_${perm}`);
      const mod = await handlers[route]();
      const res = await (mod[method] as (r: NextRequest, c: unknown) => Promise<Response>)(jreq(url, { method, body, token: admin.token }), { params: {} });
      expect(res.status, `${method} ${route}`).toBe(403);
    }
  }, 120000);

  it("[matrix-immediate] revoking a permission from a role takes effect on the next request, without re-login", async () => {
    await roleWith("B18T_LIVE", ["audit.view"]);
    const admin = await createAdmin("B18T_LIVE");
    const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "B18T_LIVE"));
    const [perm] = await db.select().from(permissions).where(eq(permissions.key, "audit.view"));
    const call = () => jreq("http://localhost/api/v1/admin/audit-logs", { token: admin.token });
    const handler = (await loaders["/src/app/api/v1/admin/audit-logs/route.ts"]()).GET as (r: NextRequest) => Promise<Response>;
    expect((await handler(call())).status).toBe(200);
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    expect((await handler(call())).status).toBe(403);
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id });
    expect((await handler(call())).status).toBe(200);
  });
});
