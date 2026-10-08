/**
 * Production Completion Phase — account deletion & recovery, admin moderation,
 * staff management. Real route handlers + real PostgreSQL.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, auditLogs, deviceSessions, otps, recoveryLogs, reportCategories, rolePermissions, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { getDevOtpCode } from "@/server/modules/otp/providers/dev.provider";
import { finalizeExpiredDeletions } from "@/server/modules/account/account-deletion.service";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, grantPermission, jreq, loginAs, resetPcpTables, type TestAdmin } from "./helpers/pcp";

import { POST as deleteAccount } from "@/app/api/v1/users/me/delete-account/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { POST as recoverRequest } from "@/app/api/v1/auth/recover-account/request/route";
import { POST as recoverConfirm } from "@/app/api/v1/auth/recover-account/confirm/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listDeletions } from "@/app/api/v1/admin/account-deletions/route";
import { POST as suspend } from "@/app/api/v1/admin/users/[userId]/suspend/route";
import { POST as ban } from "@/app/api/v1/admin/users/[userId]/ban/route";
import { POST as unban } from "@/app/api/v1/admin/users/[userId]/unban/route";
import { GET as moderationView } from "@/app/api/v1/admin/users/[userId]/moderation/route";
import { POST as liftSuspension } from "@/app/api/v1/admin/users/[userId]/lift-suspension/route";
import { POST as fileReport } from "@/app/api/v1/reports/route";
import { GET as listStaff, POST as createStaff } from "@/app/api/v1/admin/staff/route";
import { PATCH as updateStaff } from "@/app/api/v1/admin/staff/[staffId]/route";
import { POST as resetStaffPassword } from "@/app/api/v1/admin/staff/[staffId]/reset-password/route";
import { GET as listRoles, POST as createRole } from "@/app/api/v1/admin/roles/route";
import { PUT as putRolePerms } from "@/app/api/v1/admin/roles/[roleId]/permissions/route";
import { POST as changePassword } from "@/app/api/v1/admin/me/password/route";
import { GET as adminMe } from "@/app/api/v1/admin/me/route";
import { GET as listAdminUsers } from "@/app/api/v1/admin/users/route";
import { POST as adminLoginRoute } from "@/app/api/v1/admin/login/route";

const PW = "correcthorsebattery";
const STAFF_DEFAULTS = ["admin.ping", "users.view", "profiles.verify", "reports.resolve"];

async function restoreStaffDefaults() {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "STAFF_ADMIN"));
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  for (const key of STAFF_DEFAULTS) await grantPermission("STAFF_ADMIN", key);
}

let admin: TestAdmin;
const P = (ctxKey: string, v: string) => ({ params: { [ctxKey]: v } });

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await db.execute(sql`DELETE FROM admin_roles WHERE name LIKE 'PCPTEST_%'`);
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  admin = await createAdmin("SUPER_ADMIN");
});
afterEach(async () => {
  await restoreStaffDefaults();
});

const memberLogin = (email: string, password = PW, deviceId?: string) =>
  login(req("http://localhost/api/v1/auth/login", { email, password }, { deviceId }));

// ---------------------------------------------------------------------------
describe("account deletion & recovery", () => {
  const del = (token: string | undefined, body: unknown) => deleteAccount(jreq("http://localhost/api/v1/users/me/delete-account", { body, token }));

  it("[del-validation-auth] anonymous 401, admin token 403, wrong phrase 400, wrong password 403, extra fields 400", async () => {
    const m = await createVerifiedMember("del-val");
    expect((await del(undefined, { password: PW, confirmation: "DELETE MY ACCOUNT" })).status).toBe(401);
    expect((await del(admin.token, { password: PW, confirmation: "DELETE MY ACCOUNT" })).status).toBe(403);
    expect((await del(m.sessionToken, { password: PW, confirmation: "delete my account" })).status).toBe(400);
    expect((await del(m.sessionToken, { password: "wrong-password!", confirmation: "DELETE MY ACCOUNT" })).status).toBe(403);
    expect((await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT", userId: "x" })).status).toBe(400);
    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    expect(u.status).toBe("ACTIVE");
  });

  it("[del-flow] deletion revokes every session, blocks login, records audit + recovery log, and affects only the caller (no IDOR)", async () => {
    const m = await createVerifiedMember("del-flow");
    const other = await createVerifiedMember("del-other");
    const res = await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.status).toBe("DELETED_PENDING");
    expect(data.recoveryWindowDays).toBe(30);
    const days = (new Date(data.recoverUntil).getTime() - new Date(data.deletedAt).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    expect((await getMe(jreq("http://localhost/api/v1/users/me", { token: m.sessionToken }))).status).toBe(401);
    expect((await memberLogin(m.email, PW, m.deviceId)).status).toBe(401);
    expect((await db.select().from(deviceSessions).where(eq(deviceSessions.userId, m.userId))).every((s) => s.revokedAt)).toBe(true);
    expect((await getMe(jreq("http://localhost/api/v1/users/me", { token: other.sessionToken }))).status).toBe(200);
    expect((await db.select().from(recoveryLogs).where(eq(recoveryLogs.userId, m.userId))).map((r) => r.action)).toEqual(["DELETION_REQUESTED"]);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "account.deletion_requested"))).length).toBe(1);
    // already deleted-pending → its (revoked) token can never repeat the request
    expect((await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" })).status).toBe(401);
  });

  const recoverReq = (email: string, password: string) => recoverRequest(jreq("http://localhost/api/v1/auth/recover-account/request", { body: { email, password } }));
  const recoverCfm = (email: string, code: string) => recoverConfirm(jreq("http://localhost/api/v1/auth/recover-account/confirm", { body: { email, code } }));

  it("[recover-flow] owner recovers with password + e-mail OTP; account is usable again", async () => {
    const m = await createVerifiedMember("rec-flow");
    await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    const r = await recoverReq(m.email, PW);
    expect(r.status).toBe(200);
    const code = getDevOtpCode(m.email, "ACCOUNT_RECOVERY")!;
    expect(code).toMatch(/^\d{6}$/);
    expect((await recoverCfm(m.email, "000000")).status).toBe(401);
    expect((await recoverCfm(m.email, code)).status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    expect(u.status).toBe("ACTIVE");
    expect(u.deletedAt).toBeNull();
    expect((await memberLogin(m.email, PW, m.deviceId)).status).toBe(200);
    expect((await db.select().from(recoveryLogs).where(eq(recoveryLogs.userId, m.userId))).map((x) => x.action).sort()).toEqual(["ACCOUNT_RECOVERED", "DELETION_REQUESTED"]);
    // the code is single-use
    expect((await recoverCfm(m.email, code)).status).toBe(401);
  });

  it("[recover-no-enumeration] unknown e-mail, wrong password and ACTIVE accounts all get the same answer and no code is issued", async () => {
    const m = await createVerifiedMember("rec-enum");
    const active = await createVerifiedMember("rec-enum-active");
    await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    const shapes: string[] = [];
    for (const [email, pw] of [["nobody@example.com", PW], [m.email, "wrong-password!"], [active.email, PW]] as const) {
      const res = await recoverReq(email, pw);
      expect(res.status).toBe(200);
      shapes.push(Object.keys((await res.json()).data).sort().join(","));
    }
    expect(new Set(shapes).size).toBe(1);
    expect((await db.select().from(otps).where(eq(otps.purpose, "ACCOUNT_RECOVERY"))).length).toBe(0);
  });

  it("[recover-owner-only] another member's code cannot recover someone else's account", async () => {
    const a = await createVerifiedMember("rec-own-a");
    const b = await createVerifiedMember("rec-own-b");
    await del(a.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    await del(b.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    await recoverReq(b.email, PW);
    const bCode = getDevOtpCode(b.email, "ACCOUNT_RECOVERY")!;
    expect((await recoverCfm(a.email, bCode)).status).toBe(401);
    const [ua] = await db.select().from(users).where(eq(users.id, a.userId));
    expect(ua.status).toBe("DELETED_PENDING");
  });

  it("[recover-window-expired] after the window the account cannot be recovered even with a valid code", async () => {
    const m = await createVerifiedMember("rec-exp");
    await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    await recoverReq(m.email, PW);
    const code = getDevOtpCode(m.email, "ACCOUNT_RECOVERY")!;
    await db.update(users).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(users.id, m.userId));
    expect((await recoverCfm(m.email, code)).status).toBe(401);
    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    expect(u.status).toBe("DELETED_PENDING");
    // and no new code is issued
    await db.delete(otps);
    await recoverReq(m.email, PW);
    expect((await db.select().from(otps)).length).toBe(0);
  });

  it("[admin-visibility] admins with users.view see pending deletions (masked e-mail); members and anonymous cannot", async () => {
    const m = await createVerifiedMember("adm-del");
    await del(m.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    expect((await listDeletions(jreq("http://localhost/api/v1/admin/account-deletions"))).status).toBe(401);
    const other = await createVerifiedMember("adm-del-m");
    expect((await listDeletions(jreq("http://localhost/api/v1/admin/account-deletions", { token: other.sessionToken }))).status).toBe(403);
    const staff = await createAdmin("STAFF_ADMIN");
    const res = await listDeletions(jreq("http://localhost/api/v1/admin/account-deletions", { token: staff.token }));
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ userId: m.userId, state: "PENDING" });
    expect(body.items[0].email).toMatch(/^\w\w\*\*\*@/);
    expect(body.items[0].daysLeft).toBeGreaterThan(28);
    expect(JSON.stringify(body)).not.toContain(m.email);
  });

  it("[finalize-job] expired deletions are anonymised once; in-window ones are untouched", async () => {
    const old = await createVerifiedMember("fin-old");
    const fresh = await createVerifiedMember("fin-fresh");
    await del(old.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    await del(fresh.sessionToken, { password: PW, confirmation: "DELETE MY ACCOUNT" });
    await db.update(users).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(users.id, old.userId));
    const first = await finalizeExpiredDeletions();
    expect(first.finalized).toBe(1);
    const [o] = await db.select().from(users).where(eq(users.id, old.userId));
    expect(o.status).toBe("DELETED");
    expect(o.email).toBe(`deleted+${old.userId}@deleted.invalid`);
    expect(o.name).toBe("Deleted member");
    expect(JSON.stringify(o)).not.toContain(old.email);
    expect((await memberLogin(old.email, PW)).status).toBe(401);
    expect((await db.select().from(recoveryLogs).where(eq(recoveryLogs.userId, old.userId))).map((r) => r.action)).toContain("DELETION_FINALIZED");
    const [f] = await db.select().from(users).where(eq(users.id, fresh.userId));
    expect(f.status).toBe("DELETED_PENDING");
    expect((await finalizeExpiredDeletions()).finalized).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("admin moderation", () => {
  const act = (fn: typeof suspend, userId: string, body: unknown, token = admin.token) =>
    fn(jreq(`http://localhost/api/v1/admin/users/${userId}/x`, { body, token }), P("userId", userId));
  const statusOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0].status;

  it("[mod-suspend] suspend needs users.suspend + a reason, revokes sessions, blocks protected features, and is lifted by the existing endpoint", async () => {
    const m = await createVerifiedMember("mod-susp");
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await act(suspend, m.userId, { reason: "spamming members" }, staff.token)).status).toBe(403);
    expect((await act(suspend, m.userId, { reason: "no" })).status).toBe(400);
    expect((await act(suspend, m.userId, {})).status).toBe(400);
    expect((await act(suspend, "not-a-uuid", { reason: "spamming members" })).status).toBe(400);
    expect((await act(suspend, "00000000-0000-4000-8000-000000000000", { reason: "spamming members" })).status).toBe(404);
    const res = await act(suspend, m.userId, { reason: "spamming members" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("SUSPENDED");
    expect(await statusOf(m.userId)).toBe("SUSPENDED");
    expect((await getMe(jreq("http://localhost/api/v1/users/me", { token: m.sessionToken }))).status).toBe(401);
    expect((await memberLogin(m.email, PW, m.deviceId)).status).toBe(401);
    expect((await act(suspend, m.userId, { reason: "again again" })).status).toBe(409);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "account.suspended_by_admin"))).length).toBe(1);

    const lifted = await liftSuspension(jreq(`http://localhost/api/v1/admin/users/${m.userId}/lift-suspension`, { body: {}, token: admin.token }), P("userId", m.userId));
    expect(lifted.status).toBe(200);
    expect(await statusOf(m.userId)).toBe("ACTIVE");
    expect((await memberLogin(m.email, PW, m.deviceId)).status).toBe(200);
  });

  it("[mod-ban-unban] ban is Super-Admin-only (users.ban), supersedes a suspension, cannot be lifted by lift-suspension, and unban restores", async () => {
    const m = await createVerifiedMember("mod-ban");
    await grantPermission("STAFF_ADMIN", "users.suspend");
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await act(ban, m.userId, { reason: "fraudulent profile" }, staff.token)).status).toBe(403);
    await act(suspend, m.userId, { reason: "under investigation" });
    expect((await act(ban, m.userId, { reason: "x" })).status).toBe(400);
    const res = await act(ban, m.userId, { reason: "fraudulent profile" });
    expect(res.status).toBe(200);
    const view = (await res.json()).data;
    expect(view.status).toBe("BLOCKED");
    expect(view.activeBan.reason).toBe("fraudulent profile");
    expect(view.activeSuspension).toBeNull();
    expect((await memberLogin(m.email, PW, m.deviceId)).status).toBe(401);
    expect((await act(ban, m.userId, { reason: "fraudulent profile" })).status).toBe(409);
    expect((await act(suspend, m.userId, { reason: "cannot suspend banned" })).status).toBe(409);
    const lift = await liftSuspension(jreq(`http://localhost/api/v1/admin/users/${m.userId}/lift-suspension`, { body: {}, token: admin.token }), P("userId", m.userId));
    expect(lift.status).toBe(409);
    expect(await statusOf(m.userId)).toBe("BLOCKED");

    expect((await act(unban, m.userId, { reason: "appeal accepted" }, staff.token)).status).toBe(403);
    expect((await act(unban, m.userId, { reason: "appeal accepted" })).status).toBe(200);
    expect(await statusOf(m.userId)).toBe("ACTIVE");
    expect((await act(unban, m.userId, { reason: "appeal accepted" })).status).toBe(409);
    expect((await memberLogin(m.email, PW, m.deviceId)).status).toBe(200);
    const actions = (await db.select().from(auditLogs)).map((a) => a.action);
    expect(actions).toContain("account.banned");
    expect(actions).toContain("account.unbanned");
  });

  it("[mod-ban-not-overridden-by-reports] the automatic report suspension never overrides a ban, but still suspends ACTIVE accounts", async () => {
    const target = await createVerifiedMember("mod-rep-target");
    const [cat] = await db.select().from(reportCategories).limit(1);
    await act(ban, target.userId, { reason: "fraudulent profile" });
    for (let i = 0; i < 5; i++) {
      __resetRateLimitsForTests();
      const r = await createVerifiedMember(`mod-rep-${i}`);
      const res = await fileReport(jreq("http://localhost/api/v1/reports", { body: { reportedUserId: target.userId, categoryId: cat.id }, token: r.sessionToken }));
      expect(res.status).toBe(201);
    }
    expect(await statusOf(target.userId)).toBe("BLOCKED");

    const target2 = await createVerifiedMember("mod-rep-target2");
    for (let i = 0; i < 5; i++) {
      __resetRateLimitsForTests();
      const r = await createVerifiedMember(`mod-rep2-${i}`);
      await fileReport(jreq("http://localhost/api/v1/reports", { body: { reportedUserId: target2.userId, categoryId: cat.id }, token: r.sessionToken }));
    }
    expect(await statusOf(target2.userId)).toBe("SUSPENDED");
  });

  it("[mod-deleted-protected] pending-deletion accounts cannot be suspended or banned (nothing can resurrect them)", async () => {
    const m = await createVerifiedMember("mod-del");
    await deleteAccount(jreq("http://localhost/api/v1/users/me/delete-account", { body: { password: PW, confirmation: "DELETE MY ACCOUNT" }, token: m.sessionToken }));
    expect((await act(suspend, m.userId, { reason: "should not work" })).status).toBe(409);
    expect((await act(ban, m.userId, { reason: "should not work" })).status).toBe(409);
    expect(await statusOf(m.userId)).toBe("DELETED_PENDING");
  });

  it("[mod-view] the moderation view needs users.view and lists history", async () => {
    const m = await createVerifiedMember("mod-view");
    await act(suspend, m.userId, { reason: "first offence here" });
    expect((await moderationView(jreq(`http://localhost/api/v1/admin/users/${m.userId}/moderation`), P("userId", m.userId))).status).toBe(401);
    const other = await createVerifiedMember("mod-view-m");
    expect((await moderationView(jreq(`http://localhost/api/v1/admin/users/${m.userId}/moderation`, { token: other.sessionToken }), P("userId", m.userId))).status).toBe(403);
    const res = await moderationView(jreq(`http://localhost/api/v1/admin/users/${m.userId}/moderation`, { token: admin.token }), P("userId", m.userId));
    const data = (await res.json()).data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.suspensions.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("staff management", () => {
  const post = (fn: typeof createStaff, url: string, body: unknown, token = admin.token) => fn(jreq(url, { body, token }));
  const mkStaff = async (email: string, roleName = "STAFF_ADMIN", token = admin.token) => {
    const res = await post(createStaff, "http://localhost/api/v1/admin/staff", { name: "New Staffer", email, roleName }, token);
    return { res, body: await res.json() };
  };
  const patch = (id: string, body: unknown, token = admin.token) => updateStaff(jreq(`http://localhost/api/v1/admin/staff/${id}`, { method: "PATCH", body, token }), P("staffId", id));
  const adminLogin = (email: string, password: string) => adminLoginRoute(jreq("http://localhost/api/v1/admin/login", { body: { email, password } }));

  it("[staff-rbac] anonymous 401; default STAFF_ADMIN 403 on list / create / roles", async () => {
    expect((await listStaff(jreq("http://localhost/api/v1/admin/staff"))).status).toBe(401);
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await listStaff(jreq("http://localhost/api/v1/admin/staff", { token: staff.token }))).status).toBe(403);
    expect((await mkStaff("x@example.com", "STAFF_ADMIN", staff.token)).res.status).toBe(403);
    expect((await listRoles(jreq("http://localhost/api/v1/admin/roles", { token: staff.token }))).status).toBe(403);
    const member = await createVerifiedMember("staff-rbac");
    expect((await listStaff(jreq("http://localhost/api/v1/admin/staff", { token: member.sessionToken }))).status).toBe(403);
  });

  it("[staff-create-temp-password] new staff gets a one-time password, must change it before any permissioned action", async () => {
    const { res, body } = await mkStaff("new.staff@example.com");
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const temp = body.data.temporaryPassword as string;
    expect(temp).toHaveLength(16);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(body.data.staff).toMatchObject({ email: "new.staff@example.com", role: "STAFF_ADMIN", mustChangePassword: true, status: "ACTIVE" });

    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, "new.staff@example.com"));
    expect(row.passwordHash).not.toContain(temp);
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain(temp);

    const loginRes = await adminLogin("new.staff@example.com", temp);
    expect(loginRes.status).toBe(200);
    const token = (await loginRes.json()).data.sessionToken as string;
    const me = await adminMe(jreq("http://localhost/api/v1/admin/me", { token }));
    expect(me.status).toBe(200);
    expect((await me.json()).data.admin.mustChangePassword).toBe(true);
    expect((await listAdminUsers(jreq("http://localhost/api/v1/admin/users", { token }))).status).toBe(403);

    const chg = (cur: string, next: string) => changePassword(jreq("http://localhost/api/v1/admin/me/password", { body: { currentPassword: cur, newPassword: next }, token }));
    expect((await chg("wrong-current-pw", "a-brand-new-password-1")).status).toBe(403);
    expect((await chg(temp, "short")).status).toBe(400);
    expect((await chg(temp, temp)).status).toBe(400);
    expect((await chg(temp, "a-brand-new-password-1")).status).toBe(200);
    expect((await listAdminUsers(jreq("http://localhost/api/v1/admin/users", { token }))).status).toBe(200);
    expect((await adminLogin("new.staff@example.com", temp)).status).toBe(401);
    expect((await adminLogin("new.staff@example.com", "a-brand-new-password-1")).status).toBe(200);
  });

  it("[staff-create-guards] SUPER_ADMIN cannot be created; unknown role 400; duplicate e-mail 409; validation", async () => {
    expect((await mkStaff("s1@example.com", "SUPER_ADMIN")).res.status).toBe(403);
    expect((await mkStaff("s2@example.com", "NO_SUCH_ROLE")).res.status).toBe(400);
    expect((await mkStaff("s3@example.com")).res.status).toBe(201);
    expect((await mkStaff("S3@example.com")).res.status).toBe(409);
    expect((await post(createStaff, "http://localhost/api/v1/admin/staff", { name: "x", email: "bad", roleName: "STAFF_ADMIN" })).status).toBe(400);
    expect((await post(createStaff, "http://localhost/api/v1/admin/staff", { name: "Valid Name", email: "s4@example.com", roleName: "STAFF_ADMIN", status: "ACTIVE" })).status).toBe(400);
    const list = await listStaff(jreq("http://localhost/api/v1/admin/staff?q=s3", { token: admin.token }));
    expect((await list.json()).data.items.map((i: { email: string }) => i.email)).toEqual(["s3@example.com"]);
  });

  it("[staff-disable-enable] disabling revokes sessions and blocks login; enabling restores; role change revokes sessions", async () => {
    const { body } = await mkStaff("dis@example.com");
    const id = body.data.staff.id as string;
    const temp = body.data.temporaryPassword as string;
    let token = (await (await adminLogin("dis@example.com", temp)).json()).data.sessionToken as string;
    expect((await patch(id, { status: "SUSPENDED" })).status).toBe(200);
    expect((await adminMe(jreq("http://localhost/api/v1/admin/me", { token }))).status).toBe(401);
    expect((await adminLogin("dis@example.com", temp)).status).toBe(401);
    expect((await patch(id, { status: "ACTIVE" })).status).toBe(200);
    token = (await (await adminLogin("dis@example.com", temp)).json()).data.sessionToken as string;
    expect((await adminMe(jreq("http://localhost/api/v1/admin/me", { token }))).status).toBe(200);

    const roleRes = await createRole(jreq("http://localhost/api/v1/admin/roles", { body: { name: "PCPTEST_VIEWER", permissions: ["users.view"] }, token: admin.token }));
    expect(roleRes.status).toBe(201);
    expect((await patch(id, { roleName: "PCPTEST_VIEWER" })).status).toBe(200);
    expect((await adminMe(jreq("http://localhost/api/v1/admin/me", { token }))).status).toBe(401);
    const actions = (await db.select().from(auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["staff.created", "staff.disabled", "staff.enabled", "staff.updated", "role.created"]));
  });

  it("[staff-super-protected] nobody can modify, disable, demote or reset a SUPER_ADMIN; nobody can change themselves", async () => {
    const other = await createAdmin("SUPER_ADMIN");
    expect((await patch(other.id, { status: "SUSPENDED" })).status).toBe(403);
    expect((await patch(other.id, { roleName: "STAFF_ADMIN" })).status).toBe(403);
    expect((await resetStaffPassword(jreq(`http://localhost/api/v1/admin/staff/${other.id}/reset-password`, { body: {}, token: admin.token }), P("staffId", other.id))).status).toBe(403);
    expect((await patch(admin.id, { status: "SUSPENDED" })).status).toBe(403); // self is also SUPER
    const [still] = await db.select().from(adminUsers).where(eq(adminUsers.id, other.id));
    expect(still.status).toBe("ACTIVE");
  });

  it("[staff-no-escalation] a delegated staff.manage holder cannot create roles, edit permissions, touch Super Admins, self-change, or grant power they lack", async () => {
    await grantPermission("STAFF_ADMIN", "staff.manage");
    const actor = await createAdmin("STAFF_ADMIN");
    // allowed: manage equal-or-lower accounts
    const ok = await mkStaff("delegated@example.com", "STAFF_ADMIN", actor.token);
    expect(ok.res.status).toBe(201);
    // blocked escalations
    expect((await mkStaff("e1@example.com", "SUPER_ADMIN", actor.token)).res.status).toBe(403);
    expect((await createRole(jreq("http://localhost/api/v1/admin/roles", { body: { name: "PCPTEST_X", permissions: [] }, token: actor.token }))).status).toBe(403);
    const [staffRole] = await db.select().from(adminRoles).where(eq(adminRoles.name, "STAFF_ADMIN"));
    expect((await putRolePerms(jreq(`http://localhost/api/v1/admin/roles/${staffRole.id}/permissions`, { method: "PUT", body: { permissions: ["staff.manage", "users.ban"] }, token: actor.token }), P("roleId", staffRole.id))).status).toBe(403);
    expect((await patch(admin.id, { status: "SUSPENDED" }, actor.token)).status).toBe(403);
    expect((await patch(actor.id, { status: "SUSPENDED" }, actor.token)).status).toBe(409);
    // a role holding a permission the actor does not have cannot be assigned
    const powerful = await createRole(jreq("http://localhost/api/v1/admin/roles", { body: { name: "PCPTEST_POWER", permissions: ["payments.review"] }, token: admin.token }));
    expect(powerful.status).toBe(201);
    expect((await mkStaff("e2@example.com", "PCPTEST_POWER", actor.token)).res.status).toBe(403);
    // ...but a Super Admin can
    expect((await mkStaff("e3@example.com", "PCPTEST_POWER")).res.status).toBe(201);
  });

  it("[staff-roles-permissions] Super Admin can create roles and edit permissions (validated); SUPER_ADMIN role is immutable; changes take effect", async () => {
    const list = await listRoles(jreq("http://localhost/api/v1/admin/roles", { token: admin.token }));
    const data = (await list.json()).data;
    const superRole = data.roles.find((r: { name: string }) => r.name === "SUPER_ADMIN");
    expect(superRole.protected).toBe(true);
    expect(data.permissions.map((p: { key: string }) => p.key)).toContain("users.ban");

    const bad = (name: string, perms: string[]) => createRole(jreq("http://localhost/api/v1/admin/roles", { body: { name, permissions: perms }, token: admin.token }));
    expect((await bad("lowercase", [])).status).toBe(400);
    expect((await bad("SUPER_ADMIN", [])).status).toBe(400);
    expect((await bad("PCPTEST_BADPERM", ["no.such.permission"])).status).toBe(400);
    expect((await bad("PCPTEST_OK", ["users.view"])).status).toBe(201);
    expect((await bad("PCPTEST_OK", [])).status).toBe(409);

    expect((await putRolePerms(jreq(`http://localhost/api/v1/admin/roles/${superRole.id}/permissions`, { method: "PUT", body: { permissions: [] }, token: admin.token }), P("roleId", superRole.id))).status).toBe(403);

    const [r] = await db.select().from(adminRoles).where(eq(adminRoles.name, "PCPTEST_OK"));
    const { body } = await mkStaff("roleuser@example.com", "PCPTEST_OK");
    const t = (await (await adminLogin("roleuser@example.com", body.data.temporaryPassword)).json()).data.sessionToken as string;
    await changePassword(jreq("http://localhost/api/v1/admin/me/password", { body: { currentPassword: body.data.temporaryPassword, newPassword: "another-long-password-1" }, token: t }));
    const t2 = await loginAs("roleuser@example.com", "another-long-password-1");
    expect((await listAdminUsers(jreq("http://localhost/api/v1/admin/users", { token: t2 }))).status).toBe(200);
    const upd = await putRolePerms(jreq(`http://localhost/api/v1/admin/roles/${r.id}/permissions`, { method: "PUT", body: { permissions: ["admin.ping"] }, token: admin.token }), P("roleId", r.id));
    expect(upd.status).toBe(200);
    expect((await listAdminUsers(jreq("http://localhost/api/v1/admin/users", { token: t2 }))).status).toBe(403);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "role.permissions_updated"))).length).toBe(1);
  });

  it("[staff-reset-password] reset issues a new one-time password, revokes sessions and forces a change", async () => {
    const { body } = await mkStaff("reset@example.com");
    const id = body.data.staff.id as string;
    const oldTemp = body.data.temporaryPassword as string;
    const token = (await (await adminLogin("reset@example.com", oldTemp)).json()).data.sessionToken as string;
    const res = await resetStaffPassword(jreq(`http://localhost/api/v1/admin/staff/${id}/reset-password`, { body: {}, token: admin.token }), P("staffId", id));
    expect(res.status).toBe(200);
    const next = (await res.json()).data.temporaryPassword as string;
    expect(next).not.toBe(oldTemp);
    expect((await adminMe(jreq("http://localhost/api/v1/admin/me", { token }))).status).toBe(401);
    expect((await adminLogin("reset@example.com", oldTemp)).status).toBe(401);
    expect((await adminLogin("reset@example.com", next)).status).toBe(200);
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain(next);
  });
});
