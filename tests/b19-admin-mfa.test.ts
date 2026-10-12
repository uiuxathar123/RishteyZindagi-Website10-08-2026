/**
 * B19 — admin second factor (e-mailed one-time code after the password).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { POST as loginRoute } from "@/app/api/v1/admin/login/route";
import { POST as verifyRoute } from "@/app/api/v1/admin/login/verify-mfa/route";
import { GET as meRoute } from "@/app/api/v1/admin/me/route";
import { GET as getSecurity, PATCH as patchSecurity } from "@/app/api/v1/admin/security-settings/route";
import { db } from "@/server/db/client";
import { adminUsers, auditLogs, deviceSessions, loginAttempts, otpConfigs, otps } from "@/server/db/schema";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createAdmin, jreq, resetPcpTables, grantPermission, revokePermission } from "./helpers/pcp";

const URL_ = "http://localhost/api/v1/admin";
const login = (email: string, password = "adminpassword1") => loginRoute(jreq(`${URL_}/login`, { body: { email, password } }));
const verify = (email: string, code: string) => verifyRoute(jreq(`${URL_}/login/verify-mfa`, { body: { email, code } }));
const setMfa = (token: string | undefined, mfaRequired: boolean, reason?: string) => patchSecurity(jreq(`${URL_}/security-settings`, { method: "PATCH", body: { mfaRequired, reason }, token }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  __clearDevOtpStoreForTests();
});

describe("settings", () => {
  it("[mfa-authz] only the Super Admin can read or change admin MFA", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    await grantPermission("STAFF_ADMIN", "platform.settings.manage");
    expect((await getSecurity(jreq(`${URL_}/security-settings`))).status).toBe(401);
    expect((await getSecurity(jreq(`${URL_}/security-settings`, { token: staff.token }))).status).toBe(403);
    expect((await setMfa(staff.token, true)).status).toBe(403);
    expect((await setMfa(undefined, true)).status).toBe(401);
    const v = await (await getSecurity(jreq(`${URL_}/security-settings`, { token: sup.token }))).json();
    expect(v.data.mfaRequired).toBe(false);
    expect(v.data.emailDeliveryReady).toBe(true);
    await revokePermission("STAFF_ADMIN", "platform.settings.manage");
  });

  it("[mfa-no-lockout] cannot be switched on while e-mail codes cannot be delivered", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    await db.update(otpConfigs).set({ enabled: false }).where(eq(otpConfigs.id, 1));
    const res = await setMfa(sup.token, true);
    expect(res.status).toBe(409);
    expect((await (await getSecurity(jreq(`${URL_}/security-settings`, { token: sup.token }))).json()).data.mfaRequired).toBe(false);
    // and a normal login still works
    expect((await login(sup.email)).status).toBe(200);
  });
});

describe("sign-in", () => {
  it("[mfa-off] with MFA off a correct password opens a session exactly as before", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const res = await login(sup.email);
    expect(res.status).toBe(200);
    expect((await res.json()).data.sessionToken).toBeTruthy();
  });

  it("[mfa-flow] MFA on: password alone gives no session; wrong code fails; right code works once; audited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await setMfa(sup.token, true, "policy")).status).toBe(200);
    const before = (await db.select().from(deviceSessions)).length;

    // wrong password: no code is sent
    expect((await login(staff.email, "wrong-password")).status).toBe(401);
    expect(getDevOtpCode(staff.email, "ADMIN_MFA")).toBeUndefined();

    const res = await login(staff.email);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mfaRequired).toBe(true);
    expect(body.data.sessionToken).toBeUndefined();
    expect(body.data.sentTo).toMatch(/^p\*\*\*@/);
    expect((await db.select().from(deviceSessions)).length).toBe(before); // no new session yet
    const code = getDevOtpCode(staff.email, "ADMIN_MFA")!;
    expect(code).toMatch(/^\d{6}$/);

    expect((await verify(staff.email, code === "000000" ? "111111" : "000000")).status).toBe(401);
    const ok = await verify(staff.email, code);
    expect(ok.status).toBe(200);
    const token = (await ok.json()).data.sessionToken as string;
    expect((await meRoute(jreq(`${URL_}/me`, { token }))).status).toBe(200);
    expect((await verify(staff.email, code)).status).toBe(401); // single use

    const actions = (await db.select().from(auditLogs)).map((l) => l.action);
    expect(actions).toContain("admin.mfa_challenge_sent");
    expect(actions).toContain("settings.admin_mfa_changed");
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain(code);
  });

  it("[mfa-replay-race] concurrent verification of one code opens only one admin session", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    await setMfa(sup.token, true);
    await login(staff.email);
    const code = getDevOtpCode(staff.email, "ADMIN_MFA")!;
    const sessionsBefore = (await db.select().from(deviceSessions)).length;

    const results = await Promise.all([verify(staff.email, code), verify(staff.email, code)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect((await db.select().from(deviceSessions)).length).toBe(sessionsBefore + 1);
  });

  it("[mfa-failure-audit] inactive admins and OTP/account mismatches are recorded as failed OTP attempts", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const inactive = await createAdmin("STAFF_ADMIN");
    const mismatch = await createAdmin("STAFF_ADMIN");
    await setMfa(sup.token, true);
    await login(inactive.email);
    await login(mismatch.email);

    await db.update(adminUsers).set({ status: "SUSPENDED" }).where(eq(adminUsers.id, inactive.id));
    await db
      .update(otps)
      .set({ metadata: { adminUserId: inactive.id } })
      .where(and(eq(otps.identifier, mismatch.email), eq(otps.purpose, "ADMIN_MFA")));

    const inactiveCode = getDevOtpCode(inactive.email, "ADMIN_MFA")!;
    const mismatchCode = getDevOtpCode(mismatch.email, "ADMIN_MFA")!;
    const sessionsBefore = (await db.select().from(deviceSessions)).length;
    expect((await verify(inactive.email, inactiveCode)).status).toBe(401);
    expect((await verify(mismatch.email, mismatchCode)).status).toBe(401);
    expect((await db.select().from(deviceSessions)).length).toBe(sessionsBefore);

    const attempts = await db.select().from(loginAttempts);
    const inactiveAttempt = attempts.filter((attempt) => attempt.identifier === inactive.email && attempt.method === "OTP").slice(-1)[0];
    const mismatchAttempt = attempts.filter((attempt) => attempt.identifier === mismatch.email && attempt.method === "OTP").slice(-1)[0];
    expect(inactiveAttempt).toMatchObject({ success: false, failureReason: "ACCOUNT_INACTIVE" });
    expect(mismatchAttempt).toMatchObject({ success: false, failureReason: "MFA_ACCOUNT_MISMATCH" });
  });

  it("[mfa-isolation] a code is bound to its admin and purpose; no challenge means no session; attempts are limited", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    const staff = await createAdmin("STAFF_ADMIN");
    await setMfa(sup.token, true);
    expect((await verify(staff.email, "123456")).status).toBe(401); // never challenged
    expect((await verify("nobody@example.com", "123456")).status).toBe(401);

    await login(staff.email);
    const staffCode = getDevOtpCode(staff.email, "ADMIN_MFA")!;
    expect((await verify(sup.email, staffCode)).status).toBe(401); // another admin's address
    expect(getDevOtpCode(staff.email, "LOGIN")).toBeUndefined();

    // exhaust attempts, then even the right code is dead
    for (let i = 0; i < 5; i++) await verify(staff.email, staffCode === "999999" ? "888888" : "999999");
    expect((await verify(staff.email, staffCode)).status).toBe(401);
    await sleep(1100);
    await login(staff.email); // a fresh sign-in issues a fresh code
    const fresh = getDevOtpCode(staff.email, "ADMIN_MFA")!;
    expect((await verify(staff.email, fresh)).status).toBe(200);
  });

  it("[mfa-off-again] switching it off restores password-only sign-in at once", async () => {
    const sup = await createAdmin("SUPER_ADMIN");
    await setMfa(sup.token, true);
    expect((await (await login(sup.email)).json()).data.mfaRequired).toBe(true);
    expect((await setMfa(sup.token, false)).status).toBe(200);
    await sleep(1100);
    expect((await (await login(sup.email)).json()).data.sessionToken).toBeTruthy();
  });
});
