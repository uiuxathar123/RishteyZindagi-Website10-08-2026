/**
 * B18 — admin-controlled OTP requirement policy (OTP_REQUIRED / OTP_NOT_REQUIRED).
 * Provider selection (EMAIL | FAST2SMS_SMS) is a separate setting and is asserted to be untouched.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, otps, otpConfigs, users, deviceSessions } from "@/server/db/schema";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, grantPermission, revokePermission, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { getDevOtpCode } from "@/server/modules/otp/providers/dev.provider";

import { GET as getPolicy, PATCH as patchPolicy } from "@/app/api/v1/admin/otp/policy/route";
import { PATCH as patchProvider } from "@/app/api/v1/admin/otp/provider/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as verifyDevice } from "@/app/api/v1/auth/verify-device/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { POST as requestLoginOtp } from "@/app/api/v1/auth/request-login-otp/route";
import { POST as verifyLoginOtp } from "@/app/api/v1/auth/verify-login-otp/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";

const URL_ = "http://localhost/api/v1";
let sup: TestAdmin;
let staff: TestAdmin;

const setPolicy = (token: string | undefined, workflow: string, requirement: string, reason?: string, extra: Record<string, unknown> = {}) =>
  patchPolicy(jreq(`${URL_}/admin/otp/policy`, { method: "PATCH", body: { workflow, requirement, ...(reason !== undefined ? { reason } : {}), ...extra }, token }));
const doLogin = (email: string, password: string, deviceId?: string, extra: Record<string, unknown> = {}) =>
  login(req(`${URL_}/auth/login`, { email, password, ...extra }, { deviceId }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers(); // also clears platform_settings (FK cascade) → safe defaults
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  sup = await createAdmin("SUPER_ADMIN");
  staff = await createAdmin("STAFF_ADMIN");
});

afterAll(async () => {
  await resetAdminUsers();
  await resetOtpConfigForTests();
});

describe("policy API — defaults, authorization, validation", () => {
  it("[policy-default] fresh platform: both workflows OTP_REQUIRED; the never-configurable list is exposed", async () => {
    const res = await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.policy).toEqual({ NEW_DEVICE_LOGIN: "OTP_REQUIRED", SIGNUP_VERIFICATION: "OTP_REQUIRED" });
    expect(d.isDefault).toBe(true);
    expect(d.neverConfigurable.map((n: { key: string }) => n.key)).toEqual(expect.arrayContaining(["PASSWORD_RESET", "ACCOUNT_RECOVERY", "OTP_LOGIN", "ADMIN_LOGIN", "PAYMENTS"]));
  });

  it("[policy-authz] anonymous 401; member 401/403; Staff Admin 403 on GET and PATCH; a staff role granted platform.settings.manage STILL cannot change OTP policy", async () => {
    const member = await createVerifiedMember("pol-authz");
    expect((await getPolicy(jreq(`${URL_}/admin/otp/policy`))).status).toBe(401);
    expect([401, 403]).toContain((await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: member.sessionToken }))).status);
    expect([401, 403]).toContain((await setPolicy(member.sessionToken, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "member attempt")).status);
    expect((await setPolicy(undefined, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "anon attempt")).status).toBe(401);
    expect((await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: staff.token }))).status).toBe(403);
    expect((await setPolicy(staff.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "staff attempt")).status).toBe(403);
    await grantPermission("STAFF_ADMIN", "platform.settings.manage");
    try {
      expect((await setPolicy(staff.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "staff with permission")).status).toBe(403);
      expect((await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: staff.token }))).status).toBe(403);
    } finally {
      await revokePermission("STAFF_ADMIN", "platform.settings.manage");
    }
    const after = (await (await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }))).json()).data;
    expect(after.policy.NEW_DEVICE_LOGIN).toBe("OTP_REQUIRED");
  });

  it("[policy-validation] only the two allow-listed workflows can be changed; reason required to switch OFF; strict body", async () => {
    for (const wf of ["PASSWORD_RESET", "ACCOUNT_RECOVERY", "OTP_LOGIN", "ADMIN_LOGIN", "PAYMENTS", "nonsense"]) {
      const r = await setPolicy(sup.token, wf, "OTP_NOT_REQUIRED", "trying to switch off a protected flow");
      expect(r.status, wf).toBe(400);
    }
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "MAYBE", "bad value")).status).toBe(400);
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED")).status).toBe(400); // no reason
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "abc")).status).toBe(400); // too short
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "valid reason here", { extra: 1 })).status).toBe(400); // strict
    const d = (await (await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }))).json()).data;
    expect(d.policy).toEqual({ NEW_DEVICE_LOGIN: "OTP_REQUIRED", SIGNUP_VERIFICATION: "OTP_REQUIRED" });
    // switching ON needs no reason
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_REQUIRED")).status).toBe(200);
  });

  it("[policy-audit] who / when / previous / new / reason are recorded for every change", async () => {
    const before = Date.now();
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "provider outage, temporary")).status).toBe(200);
    expect((await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_REQUIRED")).status).toBe(200);
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "otp.policy_changed")).orderBy(auditLogs.createdAt);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ actorType: "ADMIN", actorId: sup.id, actorRole: "SUPER_ADMIN", entityType: "platform_setting" });
    expect(rows[0].metadata).toMatchObject({ workflow: "NEW_DEVICE_LOGIN", previous: "OTP_REQUIRED", new: "OTP_NOT_REQUIRED", reason: "provider outage, temporary", wasDefault: true, setting: "otp.policy" });
    expect(rows[1].metadata).toMatchObject({ previous: "OTP_NOT_REQUIRED", new: "OTP_REQUIRED" });
    expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const view = (await (await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }))).json()).data;
    expect(view.updatedByAdminId).toBe(sup.id);
    expect(view.isDefault).toBe(false);
  });

  it("[policy-vs-provider] changing the policy never touches the provider, and switching the provider never changes the policy", async () => {
    await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "testing separation");
    const [cfg1] = await db.select().from(otpConfigs);
    expect(cfg1.activeMethod).toBe("EMAIL");
    const sw = await patchProvider(jreq(`${URL_}/admin/otp/provider`, { method: "PATCH", body: { activeProvider: "FAST2SMS_SMS" }, token: sup.token }));
    expect(sw.status).toBe(200);
    const [cfg2] = await db.select().from(otpConfigs);
    expect(cfg2.activeMethod).toBe("SMS"); // exactly one active
    const view = (await (await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }))).json()).data;
    expect(view.policy.NEW_DEVICE_LOGIN).toBe("OTP_NOT_REQUIRED");
    expect(cfg2.enabled).toBe(true);
  });
});

describe("NEW_DEVICE_LOGIN enforcement", () => {
  it("[device-required] default: an unknown device gets a code challenge and NO session", async () => {
    const m = await createVerifiedMember("dev-req");
    const res = await doLogin(m.email, "correcthorsebattery", "brand-new-device-1");
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.deviceVerificationRequired).toBe(true);
    expect(d.sessionToken).toBeUndefined();
  });

  it("[device-not-required] OTP_NOT_REQUIRED: unknown device with the right password gets a working session, audited; known device unchanged", async () => {
    const m = await createVerifiedMember("dev-notreq");
    await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "temporary SMS outage");
    const res = await doLogin(m.email, "correcthorsebattery", "brand-new-device-2");
    const d = (await res.json()).data;
    expect(res.status).toBe(200);
    expect(d.deviceVerificationRequired).toBeUndefined();
    expect(d.sessionToken).toBeTruthy();
    const me = await getMe(req(`${URL_}/users/me`, undefined, { token: d.sessionToken }));
    expect(me.status).toBe(200);
    const log = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.login"), eq(auditLogs.actorId, m.userId)));
    expect(log.some((r) => (r.metadata as { policy?: string } | null)?.policy === "NEW_DEVICE_LOGIN:OTP_NOT_REQUIRED")).toBe(true);
    // the device is now known
    const [sess] = await db.select().from(deviceSessions).where(eq(deviceSessions.deviceId, "brand-new-device-2"));
    expect(sess).toBeTruthy();
    // switching back requires the code again for yet another new device
    await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_REQUIRED");
    const again = (await (await doLogin(m.email, "correcthorsebattery", "brand-new-device-3")).json()).data;
    expect(again.deviceVerificationRequired).toBe(true);
  });

  it("[device-not-required-boundaries] the password, account status and credentials are still enforced; client hints cannot skip anything", async () => {
    const m = await createVerifiedMember("dev-bound");
    await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "boundary test run");
    // wrong password
    const bad = await doLogin(m.email, "wrong-password-123", "dev-x");
    expect(bad.status).toBe(401);
    // unknown e-mail
    expect((await doLogin("nobody-here@example.com", "correcthorsebattery", "dev-x")).status).toBe(401);
    // inactive account
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, m.userId));
    expect((await doLogin(m.email, "correcthorsebattery", "dev-y")).status).toBe(401);
    await db.update(users).set({ status: "ACTIVE" }).where(eq(users.id, m.userId));
    // a missing password is a validation error, not a bypass
    expect([400, 401]).toContain((await login(req(`${URL_}/auth/login`, { email: m.email }, { deviceId: "dev-z" }))).status);
    // no session rows were created for the failed attempts
    const failed = await db.select().from(deviceSessions).where(eq(deviceSessions.deviceId, "dev-x"));
    expect(failed.length).toBe(0);
  });

  it("[device-policy-not-client-controllable] 'skip OTP' hints in the body or headers are ignored while the policy says OTP_REQUIRED", async () => {
    const m = await createVerifiedMember("dev-hint");
    const r1 = await doLogin(m.email, "correcthorsebattery", "hint-device", { skipOtp: true, otpRequired: false, policy: "OTP_NOT_REQUIRED" });
    expect((await r1.json()).data.deviceVerificationRequired).toBe(true);
    // a second member: the same address would hit the OTP resend cooldown, which proves nothing about hints
    const m2 = await createVerifiedMember("dev-hint2");
    const r2 = await login(
      new (await import("next/server")).NextRequest(`${URL_}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": "hint-device-2", "x-skip-otp": "true", "x-otp-policy": "OTP_NOT_REQUIRED" },
        body: JSON.stringify({ email: m2.email, password: "correcthorsebattery" }),
      })
    );
    expect((await r2.json()).data.deviceVerificationRequired).toBe(true);
  });

  it("[device-inflight] a code issued while OTP was required still verifies after the policy is switched off, and sessions survive the switch", async () => {
    const m = await createVerifiedMember("dev-inflight");
    const first = (await (await doLogin(m.email, "correcthorsebattery", "inflight-device")).json()).data;
    expect(first.deviceVerificationRequired).toBe(true);
    const code = getDevOtpCode(m.email, "NEW_DEVICE")!;
    await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "switch while code in flight");
    const ver = await verifyDevice(req(`${URL_}/auth/verify-device`, { identifier: m.email, code }, { deviceId: "inflight-device" }));
    expect(ver.status).toBe(200);
    // the existing member session from before the switch still works
    expect((await getMe(req(`${URL_}/users/me`, undefined, { token: m.sessionToken }))).status).toBe(200);
    // and logout still ends a session
    expect((await logout(req(`${URL_}/auth/logout`, {}, { token: m.sessionToken }))).status).toBe(200);
    expect((await getMe(req(`${URL_}/users/me`, undefined, { token: m.sessionToken }))).status).toBe(401);
  });
});

describe("SIGNUP_VERIFICATION enforcement", () => {
  const body = (n: number) => ({ name: "Policy Signup", email: `pol-signup-${n}-${Date.now()}@example.com`, mobileNumber: `98${String(n).padStart(8, "0")}` });

  it("[signup-required] default: a code is sent, no ticket is handed out, the account is verified by it", async () => {
    const b = body(1);
    const res = await register(req(`${URL_}/auth/register`, b));
    expect(res.status).toBe(201);
    const d = (await res.json()).data;
    expect(d.ticket).toBeUndefined();
    expect(d.otpRequired).toBeUndefined();
    const code = getDevOtpCode(d.identifier, "SIGNUP")!;
    const v = (await (await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: d.identifier, code }))).json()).data;
    const sp = await setPassword(req(`${URL_}/auth/set-password`, { identifier: d.identifier, ticket: v.ticket, password: "correcthorsebattery" }, { deviceId: "su-1" }));
    expect(sp.status).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it("[signup-not-required] OTP_NOT_REQUIRED: no code is sent, a one-time ticket completes sign-up, contact is recorded UNVERIFIED and audited", async () => {
    await setPolicy(sup.token, "SIGNUP_VERIFICATION", "OTP_NOT_REQUIRED", "OTP vendor onboarding in progress");
    const b = body(2);
    const res = await register(req(`${URL_}/auth/register`, b));
    expect(res.status).toBe(201);
    const d = (await res.json()).data;
    expect(d.otpRequired).toBe(false);
    expect(d.ticket).toBeTruthy();
    expect(d.channel).toBe("NONE");
    // no deliverable code row exists for this identifier
    const live = await db.select().from(otps).where(and(eq(otps.identifier, b.email), eq(otps.purpose, "SIGNUP")));
    expect(live.every((r) => r.consumedAt !== null)).toBe(true);
    expect(getDevOtpCode(b.email, "SIGNUP")).toBeUndefined();
    // a ticket for another identifier does not work
    const wrong = await setPassword(req(`${URL_}/auth/set-password`, { identifier: "someone-else@example.com", ticket: d.ticket, password: "correcthorsebattery" }));
    expect(wrong.status).toBe(401);
    const sp = await setPassword(req(`${URL_}/auth/set-password`, { identifier: d.identifier, ticket: d.ticket, password: "correcthorsebattery" }, { deviceId: "su-2" }));
    expect(sp.status).toBe(201);
    const spd = (await sp.json()).data;
    expect((await getMe(req(`${URL_}/users/me`, undefined, { token: spd.sessionToken }))).status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.emailVerifiedAt).toBeNull();
    expect(u.mobileVerifiedAt).toBeNull();
    // the ticket is single use
    const replay = await setPassword(req(`${URL_}/auth/set-password`, { identifier: d.identifier, ticket: d.ticket, password: "anotherpassword1" }));
    expect(replay.status).toBe(401);
    const skipped = await db.select().from(auditLogs).where(eq(auditLogs.action, "signup.otp_skipped_by_policy"));
    expect(skipped.length).toBe(1);
    // duplicate e-mail / mobile are still refused
    expect((await register(req(`${URL_}/auth/register`, b))).status).toBe(409);
  });

  it("[signup-ticket-not-forgeable] the ticket cannot be minted by the client: with the policy REQUIRED, no body field produces one", async () => {
    const b = body(3);
    const res = await register(req(`${URL_}/auth/register`, { ...b, otpRequired: false, skipOtp: true, ticket: "x" }));
    const d = (await res.json()).data;
    expect(d.ticket).toBeUndefined();
  });
});

describe("sensitive flows are never OTP-less", () => {
  it("[sensitive-always-otp] with every configurable workflow OFF, password reset and OTP login still demand a real code", async () => {
    const m = await createVerifiedMember("sens");
    await setPolicy(sup.token, "NEW_DEVICE_LOGIN", "OTP_NOT_REQUIRED", "all off for sensitive-flow test");
    await setPolicy(sup.token, "SIGNUP_VERIFICATION", "OTP_NOT_REQUIRED", "all off for sensitive-flow test");

    // password reset: no code → refused; wrong code → refused; the real code → works
    await forgotPassword(req(`${URL_}/auth/forgot-password`, { email: m.email }));
    expect(getDevOtpCode(m.email, "FORGOT_PASSWORD")).toBeTruthy();
    const noCode = await resetPassword(req(`${URL_}/auth/reset-password`, { email: m.email, newPassword: "newpassword12345" }));
    expect(noCode.status).toBe(400);
    const badCode = await resetPassword(req(`${URL_}/auth/reset-password`, { email: m.email, code: "000000", newPassword: "newpassword12345" }));
    expect([400, 401]).toContain(badCode.status);
    expect((await doLogin(m.email, "newpassword12345", m.deviceId)).status).toBe(401); // password unchanged

    // OTP login: the code is the credential
    await requestLoginOtp(req(`${URL_}/auth/request-login-otp`, { email: m.email }));
    expect((await verifyLoginOtp(req(`${URL_}/auth/verify-login-otp`, { email: m.email, code: "000000" }, { deviceId: "otp-dev" }))).status).toBe(401);
    const code = getDevOtpCode(m.email, "LOGIN")!;
    expect((await verifyLoginOtp(req(`${URL_}/auth/verify-login-otp`, { email: m.email, code }, { deviceId: "otp-dev" }))).status).toBe(200);
  });
});
