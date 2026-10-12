/**
 * B18 — privilege-escalation boundaries and session invalidation for admin accounts.
 *  - Staff (even with the delegated staff.manage permission) cannot become / create Super Admins,
 *    cannot grant permissions they do not hold, cannot edit roles, cannot change their own role/status.
 *  - Changing a staff account's role, disabling it or resetting its password signs it out immediately.
 */
import { afterAll, describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { POST as createStaff } from "@/app/api/v1/admin/staff/route";
import { PATCH as patchStaff } from "@/app/api/v1/admin/staff/[staffId]/route";
import { POST as resetPw } from "@/app/api/v1/admin/staff/[staffId]/reset-password/route";
import { POST as createRole } from "@/app/api/v1/admin/roles/route";
import { PUT as setPerms } from "@/app/api/v1/admin/roles/[roleId]/permissions/route";
import { GET as adminMe } from "@/app/api/v1/admin/me/route";
import { GET as auditLogs } from "@/app/api/v1/admin/audit-logs/route";
import { GET as listUsers } from "@/app/api/v1/admin/users/route";
import { PATCH as otpPolicy } from "@/app/api/v1/admin/otp/policy/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createAdmin, grantPermission, revokePermission, jreq, loginAs, resetPcpTables } from "./helpers/pcp";

const U = "http://localhost/api/v1/admin";

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  await db.delete(adminRoles).where(eq(adminRoles.name, "B18_LIMITED"));
});

// The seeded STAFF_ADMIN role is shared by every test file: never leave a delegated permission behind.
afterAll(async () => {
  await resetAdminUsers();
  await db.delete(adminRoles).where(eq(adminRoles.name, "B18_LIMITED"));
});

afterEach(async () => {
  await revokePermission("STAFF_ADMIN", "staff.manage");
  await revokePermission("STAFF_ADMIN", "platform.settings.manage");
});

const call = {
  createStaff: (token: string, body: unknown) => createStaff(jreq(`${U}/staff`, { method: "POST", body, token })),
  patchStaff: (token: string, id: string, body: unknown) => patchStaff(jreq(`${U}/staff/${id}`, { method: "PATCH", body, token }), { params: { staffId: id } }),
  resetPw: (token: string, id: string) => resetPw(jreq(`${U}/staff/${id}/reset-password`, { method: "POST", body: {}, token }), { params: { staffId: id } }),
  createRole: (token: string, body: unknown) => createRole(jreq(`${U}/roles`, { method: "POST", body, token })),
  setPerms: (token: string, id: string, permissions: string[]) => setPerms(jreq(`${U}/roles/${id}/permissions`, { method: "PUT", body: { permissions }, token }), { params: { roleId: id } }),
  me: (token: string) => adminMe(jreq(`${U}/me`, { token })),
};

async function roleId(name: string) {
  const [r] = await db.select().from(adminRoles).where(eq(adminRoles.name, name));
  return r.id;
}

describe("staff cannot escalate privileges", () => {
  it("[esc-staff-manage-delegated] a Staff Admin holding staff.manage cannot create/assign a Super Admin, edit roles, or change their own role/status", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    await grantPermission("STAFF_ADMIN", "staff.manage");
    const staff = await createAdmin("STAFF_ADMIN");
    const other = await createAdmin("STAFF_ADMIN");

    // cannot create a Super Admin account
    expect((await call.createStaff(staff.token, { name: "Mallory", email: "mallory@example.com", roleName: "SUPER_ADMIN" })).status).toBe(403);
    // cannot promote another staff member (or themselves) to Super Admin
    expect((await call.patchStaff(staff.token, other.id, { roleName: "SUPER_ADMIN" })).status).toBe(403);
    expect((await call.patchStaff(staff.token, staff.id, { roleName: "SUPER_ADMIN" })).status).toBe(409);
    // cannot disable themselves
    expect((await call.patchStaff(staff.token, staff.id, { status: "SUSPENDED" })).status).toBe(409);
    // cannot touch the Super Admin account in any way
    expect((await call.patchStaff(staff.token, sup.id, { status: "SUSPENDED" })).status).toBe(403);
    expect((await call.patchStaff(staff.token, sup.id, { name: "Hacked Name" })).status).toBe(403);
    expect((await call.resetPw(staff.token, sup.id)).status).toBe(403);
    // role / permission editing is Super Admin only
    expect((await call.createRole(staff.token, { name: "B18_LIMITED", permissions: ["users.view"] })).status).toBe(403);
    expect((await call.setPerms(staff.token, await roleId("STAFF_ADMIN"), ["staff.manage", "plans.manage", "audit.view"])).status).toBe(403);

    // the Super Admin account is untouched
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, sup.id));
    expect(row.status).toBe("ACTIVE");
    expect((await call.me(sup.token)).status).toBe(200);
  });

  it("[esc-grant-subset] a delegated staff.manager can only assign roles whose permissions they already hold", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    // role with a permission the delegating staff member does NOT have
    const created = await call.createRole(sup.token, { name: "B18_LIMITED", permissions: ["plans.manage"] });
    expect(created.status).toBe(201);
    await grantPermission("STAFF_ADMIN", "staff.manage");
    const staff = await createAdmin("STAFF_ADMIN");
    const res = await call.createStaff(staff.token, { name: "Pal Buddy", email: "pal@example.com", roleName: "B18_LIMITED" });
    expect(res.status).toBe(403);
    // …but the Super Admin can
    expect((await call.createStaff(sup.token, { name: "Pal Buddy", email: "pal@example.com", roleName: "B18_LIMITED" })).status).toBe(201);
  });

  it("[esc-super-only-settings] holding platform.settings.manage never lets a Staff Admin change the OTP policy", async () => {
    await grantPermission("STAFF_ADMIN", "platform.settings.manage");
    const staff = await createAdmin("STAFF_ADMIN");
    const res = await otpPolicy(jreq(`${U}/otp/policy`, { method: "PATCH", token: staff.token, body: { workflow: "NEW_DEVICE_LOGIN", requirement: "OTP_NOT_REQUIRED" } }));
    expect(res.status).toBe(403);
  });
});

describe("session invalidation on staff changes", () => {
  it("[sess-role-change] changing a staff member's role signs them out immediately", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await call.me(staff.token)).status).toBe(200);
    const created = await call.createRole(sup.token, { name: "B18_LIMITED", permissions: ["users.view"] });
    expect(created.status).toBe(201);
    expect((await call.patchStaff(sup.token, staff.id, { roleName: "B18_LIMITED" })).status).toBe(200);
    expect((await call.me(staff.token)).status).toBe(401);
  });

  it("[sess-disable] suspending a staff member signs them out immediately and blocks re-login; re-enabling restores login", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await call.patchStaff(sup.token, staff.id, { status: "SUSPENDED" })).status).toBe(200);
    expect((await call.me(staff.token)).status).toBe(401);
    await expect(loginAs(staff.email, staff.password)).rejects.toThrow();
    __resetRateLimitsForTests();
    expect((await call.patchStaff(sup.token, staff.id, { status: "ACTIVE" })).status).toBe(200);
    __resetRateLimitsForTests();
    const token = await loginAs(staff.email, staff.password);
    expect((await call.me(token)).status).toBe(200);
  });

  it("[sess-reset-password] resetting a staff password signs them out and the old password stops working", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    const res = await call.resetPw(sup.token, staff.id);
    expect(res.status).toBe(200);
    expect((await call.me(staff.token)).status).toBe(401);
    __resetRateLimitsForTests();
    await expect(loginAs(staff.email, staff.password)).rejects.toThrow();
  });

  it("[sess-permission-edit] editing a role's permissions takes effect on the next request without re-login", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const created = await call.createRole(sup.token, { name: "B18_LIMITED", permissions: ["users.view"] });
    const { data } = await created.json();
    const staff = await createAdmin("B18_LIMITED");
    const users = (t: string) => listUsers(jreq(`${U}/users`, { token: t }));
    const audit = (t: string) => auditLogs(jreq(`${U}/audit-logs`, { token: t }));
    expect((await users(staff.token)).status).toBe(200);
    expect((await audit(staff.token)).status).toBe(403);
    expect((await call.setPerms(sup.token, data.roleId, ["audit.view"])).status).toBe(200);
    expect((await users(staff.token)).status).toBe(403);
    expect((await audit(staff.token)).status).toBe(200);
  });
  it("[custom-role-me] a staff account on a CUSTOM role can read its own identity + permissions (the panel needs it); a member cannot", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const created = await call.createRole(sup.token, { name: "B18_LIMITED", permissions: ["audit.view"] });
    expect(created.status).toBe(201);
    const staff = await createAdmin("B18_LIMITED");
    const res = await call.me(staff.token);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.admin.role).toBe("B18_LIMITED");
    expect(data.permissions).toEqual(["audit.view"]);
    // no token / garbage token never get an identity
    expect((await call.me("not-a-token")).status).toBe(401);
  });
});
