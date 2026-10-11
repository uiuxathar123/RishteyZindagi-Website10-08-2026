/**
 * Super Admin "Registration OTP verification" switch (policy workflow SIGNUP_VERIFICATION).
 *
 * The switch is the B18 platform setting `otp.policy`; these tests pin the requirements for local testing:
 *   OFF  – accounts can be created with no SMTP, no code, no e-mail attempt, and nothing extra is granted;
 *   ON   – a valid code is enforced by the server, and missing SMTP is a clear error, never a bypass;
 *   only a Super Admin can change it; it is persisted in the database (survives a "restart").
 *
 * SMTP is deliberately NOT configured here, and the OTP dev-mode capture is switched off for the cases that must
 * prove the real e-mail provider is (or is not) used.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Runs before the imports below: the env is parsed once and cached, so SMTP must be absent before the first read.
vi.hoisted(() => {
  delete process.env.SMTP_HOST;
  delete process.env.EMAIL_FROM;
});

const sendMailCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/server/lib/mailer", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/server/lib/mailer")>();
  return {
    ...orig,
    sendMail: (...args: Parameters<typeof orig.sendMail>) => {
      sendMailCalls.count += 1;
      return orig.sendMail(...args);
    },
  };
});

import { eq, and, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminUsers, auditLogs, memberships, otpConfigs, otps, platformSettings, profiles, users } from "@/server/db/schema";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, loginAs, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { RATE_LIMIT_RULES } from "@/server/middleware/rate-limit-policy";
import { getDevOtpCode } from "@/server/modules/otp/providers/dev.provider";

import { GET as getPolicy, PATCH as patchPolicy } from "@/app/api/v1/admin/otp/policy/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { POST as verifyLoginOtp } from "@/app/api/v1/auth/verify-login-otp/route";
import { POST as verifyDevice } from "@/app/api/v1/auth/verify-device/route";
import { POST as login } from "@/app/api/v1/auth/login/route";

const URL_ = "http://localhost/api/v1";
let sup: TestAdmin;
let staff: TestAdmin;
let n = 0;

const REG = "SIGNUP_VERIFICATION";
const setPolicy = (token: string | undefined, requirement: string, reason?: string, workflow = REG) =>
  patchPolicy(jreq(`${URL_}/admin/otp/policy`, { method: "PATCH", body: { workflow, requirement, ...(reason !== undefined ? { reason } : {}) }, token }));
const getPol = (token: string | undefined) => getPolicy(jreq(`${URL_}/admin/otp/policy`, { token }));
const turnOff = async () => expect((await setPolicy(sup.token, "OTP_NOT_REQUIRED", "local testing of registration")).status).toBe(200);
const turnOn = async () => expect((await setPolicy(sup.token, "OTP_REQUIRED")).status).toBe(200);
/** Real e-mail provider (no dev-mode capture) with no SMTP configured: any attempt to send a code must fail. */
const useRealEmailProviderWithoutSmtp = () => db.update(otpConfigs).set({ devMode: false }).where(eq(otpConfigs.id, 1));

function newBody() {
  n += 1;
  return { name: "Switch Test", email: `switch-${n}-${Date.now()}@example.com`, mobileNumber: `97${String(n).padStart(8, "0")}` };
}
const doRegister = (b: Record<string, unknown>) => register(req(`${URL_}/auth/register`, b));
const doSetPassword = (identifier: string, ticket: string, password = "correcthorsebattery", deviceId = "sw-dev") =>
  setPassword(req(`${URL_}/auth/set-password`, { identifier, ticket, password }, { deviceId }));

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers(); // also clears platform_settings → the safe default (OTP required)
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  sendMailCalls.count = 0;
  sup = await createAdmin("SUPER_ADMIN");
  staff = await createAdmin("STAFF_ADMIN");
});

afterAll(async () => {
  await resetAdminUsers();
  await resetOtpConfigForTests();
});

describe("default and delivery status", () => {
  it("[reg-default-on] a fresh install requires registration OTP (secure default) and reports whether delivery is possible", async () => {
    const v = (await (await getPol(sup.token)).json()).data;
    expect(v.policy[REG]).toBe("OTP_REQUIRED");
    expect(v.isDefault).toBe(true);
    expect(v.workflows.find((w: { key: string }) => w.key === REG).label).toBe("Registration OTP verification");
    expect(v.delivery.ready).toBe(true); // test dev-mode capture
    await useRealEmailProviderWithoutSmtp();
    const v2 = (await (await getPol(sup.token)).json()).data;
    expect(v2.delivery.ready).toBe(false);
    expect(v2.delivery.missing).toEqual(expect.arrayContaining(["SMTP_HOST", "EMAIL_FROM"]));
    expect(v2.policy[REG]).toBe("OTP_REQUIRED"); // informational only — never auto-switches anything
  });
});

describe("OFF: registration without a code", () => {
  it("[reg-off-no-smtp] succeeds with SMTP unconfigured; no code row, no e-mail attempt; nothing extra is granted", async () => {
    await useRealEmailProviderWithoutSmtp();
    await turnOff();
    const adminsBefore = (await db.select().from(adminUsers)).length;
    const b = newBody();
    const res = await doRegister(b);
    expect(res.status).toBe(201);
    const d = (await res.json()).data;
    expect(d.otpRequired).toBe(false);
    expect(d.channel).toBe("NONE");
    expect(typeof d.ticket).toBe("string");

    // no code was created or sent
    expect(sendMailCalls.count).toBe(0);
    expect(getDevOtpCode(b.email, "SIGNUP")).toBeUndefined();
    const rows = await db.select().from(otps).where(and(eq(otps.identifier, b.email), eq(otps.purpose, "SIGNUP")));
    expect(rows.every((r) => r.consumedAt !== null)).toBe(true);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "signup.otp_requested"))).length).toBe(0);

    const sp = await doSetPassword(d.identifier, d.ticket);
    expect(sp.status).toBe(201);
    const created = (await sp.json()).data;
    expect(sendMailCalls.count).toBe(0);

    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.status).toBe("ACTIVE"); // the ordinary account status, nothing higher
    expect(u.emailVerifiedAt).toBeNull();
    expect(u.mobileVerifiedAt).toBeNull();
    expect(u.passwordHash).not.toBe("correcthorsebattery");
    expect(u.passwordHash.length).toBeGreaterThan(30); // hashed
    // no profile approval, no paid membership, no admin access came with the account
    expect((await db.select().from(profiles).where(eq(profiles.userId, u.id))).length).toBe(0);
    expect((await db.select().from(memberships).where(eq(memberships.userId, u.id))).length).toBe(0);
    expect((await db.select().from(adminUsers)).length).toBe(adminsBefore);
    expect(created.user.id).toBe(u.id);
    const adminTry = await jreq(`${URL_}/admin/otp/policy`, { token: created.sessionToken });
    expect([401, 403]).toContain((await getPolicy(adminTry)).status);
  });

  it("[reg-off-validation-kept] after the account exists: duplicates 409, invalid input 400, weak password 400, replay 401", async () => {
    await turnOff();
    const b = newBody();
    const d = (await (await doRegister(b)).json()).data;
    expect((await doSetPassword(d.identifier, d.ticket, "short")).status).toBe(400); // password rules unchanged
    const d2 = (await (await doRegister(b)).json()).data;
    expect((await doSetPassword(d2.identifier, d2.ticket)).status).toBe(201);
    expect((await doSetPassword(d2.identifier, d2.ticket, "anotherpassword12")).status).toBe(401); // single use
    expect((await doRegister(b)).status).toBe(409); // same e-mail
    expect((await doRegister({ ...newBody(), email: b.email })).status).toBe(409);
    expect((await doRegister({ ...newBody(), mobileNumber: b.mobileNumber })).status).toBe(409);
    expect((await doRegister({ ...newBody(), email: "not-an-email" })).status).toBe(400);
    expect((await doRegister({ name: "x" })).status).toBe(400);
  });

  it("[reg-off-rate-limited] the registration endpoints stay under the same IP rate-limit rule as before", () => {
    const rule = RATE_LIMIT_RULES.find((r) => r.pattern.test("/auth/register"));
    expect(rule).toBeTruthy();
    expect(rule!.pattern.test("/auth/set-password")).toBe(true);
    expect(rule!.ipLimit).toBeGreaterThan(0);
  });

  it("[reg-off-forged-ticket] the registration ticket / a forged code cannot be used in any other flow", async () => {
    const existing = await createVerifiedMember("sw-existing"); // created while OTP is still ON
    await turnOff();
    const b = newBody();
    const d = (await (await doRegister(b)).json()).data;

    // a client-supplied "skip" hint on a request while OFF changes nothing for other flows
    // 1) wrong purpose: the sign-up ticket cannot reset a password
    const reset = await resetPassword(req(`${URL_}/auth/reset-password`, { email: existing.email, code: d.ticket, newPassword: "hijackedpassword1" }));
    expect([400, 401]).toContain(reset.status);
    // 2) a forged / omitted code cannot verify sign-up for someone else's identifier or any identifier
    expect((await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: existing.email, code: "000000" }))).status).toBeGreaterThanOrEqual(400);
    expect((await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: b.email, code: "000000" }))).status).toBeGreaterThanOrEqual(400);
    // 3) ticket for another identifier is useless, so is a made-up ticket
    expect((await doSetPassword(existing.email, d.ticket)).status).toBe(401);
    expect((await doSetPassword(b.email, "forged-ticket-value")).status).toBe(401);
    // 4) login OTP / new-device verification with the sign-up ticket or a forged code
    expect((await verifyLoginOtp(req(`${URL_}/auth/verify-login-otp`, { identifier: existing.email, code: "000000" }))).status).toBeGreaterThanOrEqual(400);
    expect((await verifyDevice(req(`${URL_}/auth/verify-device`, { identifier: existing.email, code: "000000" }, { deviceId: "forged" }))).status).toBeGreaterThanOrEqual(400);
    // 5) password reset still demands a real code even while registration OTP is OFF
    await forgotPassword(req(`${URL_}/auth/forgot-password`, { email: existing.email }));
    const real = getDevOtpCode(existing.email, "FORGOT_PASSWORD");
    expect(real).toBeTruthy(); // a real code was issued — the OFF switch does not touch password reset
    const forgedReset = await resetPassword(req(`${URL_}/auth/reset-password`, { email: existing.email, code: "000000", newPassword: "hijackedpassword1" }));
    expect([400, 401]).toContain(forgedReset.status); // …and a forged code does not reset it
    // 6) the existing member's password was not changed by any of the above
    expect((await login(req(`${URL_}/auth/login`, { email: existing.email, password: "correcthorsebattery" }, { deviceId: existing.deviceId }))).status).toBe(200);
    // the genuine sign-up still works afterwards
    expect((await doSetPassword(d.identifier, d.ticket)).status).toBe(201);
  });
});

describe("ON: the server enforces the code", () => {
  it("[reg-on-requires-otp] a code is sent and verified; no ticket without it; forged hints and tickets are ignored", async () => {
    const b = newBody();
    const res = await doRegister({ ...b, otpRequired: false, skipOtp: true, ticket: "forged", otpSkippedByPolicy: true });
    expect(res.status).toBe(201);
    const d = (await res.json()).data;
    expect(d.ticket).toBeUndefined();
    expect(d.otpRequired).toBeUndefined();
    // cannot set a password without having verified a code
    expect((await doSetPassword(d.identifier, "forged")).status).toBe(401);
    // wrong code is refused, no ticket
    const wrong = await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: d.identifier, code: "000000" }));
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    // the right code gives a ticket, and only then the account can be created
    const code = getDevOtpCode(d.identifier, "SIGNUP")!;
    const v = (await (await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: d.identifier, code }))).json()).data;
    expect((await doSetPassword(d.identifier, v.ticket)).status).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it("[reg-on-missing-smtp] SMTP missing: a clear 503 naming what to set; no ticket, no account, no silent bypass", async () => {
    await useRealEmailProviderWithoutSmtp();
    const b = newBody();
    const res = await doRegister(b);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/SMTP_HOST/);
    expect(JSON.stringify(body)).toMatch(/EMAIL_FROM/);
    expect(JSON.stringify(body)).not.toMatch(/ticket/i);
    expect((await db.select().from(users).where(eq(users.email, b.email))).length).toBe(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "signup.otp_skipped_by_policy"))).length).toBe(0);
    expect(sendMailCalls.count).toBe(0);
    // a made-up ticket does not create the account either, and the setting is still ON
    expect((await doSetPassword(b.email, "forged-ticket")).status).toBe(401);
    expect((await (await getPol(sup.token)).json()).data.policy[REG]).toBe("OTP_REQUIRED");
  });

  it("[reg-on-after-off-ticket] a ticket issued while OFF stops working the moment the switch is turned back ON", async () => {
    await turnOff();
    const b = newBody();
    const d = (await (await doRegister(b)).json()).data;
    expect(d.ticket).toBeTruthy();
    await turnOn();
    const sp = await doSetPassword(d.identifier, d.ticket);
    expect(sp.status).toBe(401);
    expect((await db.select().from(users).where(eq(users.email, b.email))).length).toBe(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "signup.policy_ticket_rejected"))).length).toBe(1);
    // the ticket is spent; registering again now needs a real code
    await db.update(otpConfigs).set({ resendCooldownSeconds: 0 }).where(eq(otpConfigs.id, 1)); // skip the resend wait for the test
    const again = (await (await doRegister(b)).json()).data;
    expect(again.ticket).toBeUndefined();
    expect(getDevOtpCode(again.identifier, "SIGNUP")).toBeTruthy();
  });

  it("[reg-in-flight-code] a code issued while ON still works after the switch is turned OFF", async () => {
    const b = newBody();
    const d = (await (await doRegister(b)).json()).data;
    await turnOff();
    const code = getDevOtpCode(d.identifier, "SIGNUP")!;
    const v = (await (await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: d.identifier, code }))).json()).data;
    expect((await doSetPassword(d.identifier, v.ticket)).status).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.emailVerifiedAt).not.toBeNull(); // it WAS verified by a real code
  });
});

describe("who can change it, and persistence", () => {
  it("[reg-authz] anonymous, a member and Staff Admin cannot read or change it; the value is unchanged", async () => {
    const member = await createVerifiedMember("sw-member");
    for (const token of [undefined, member.sessionToken, staff.token]) {
      const r = await setPolicy(token, "OTP_NOT_REQUIRED", "trying to turn it off");
      expect([401, 403]).toContain(r.status);
      expect([401, 403]).toContain((await getPol(token)).status);
    }
    expect((await (await getPol(sup.token)).json()).data.policy[REG]).toBe("OTP_REQUIRED");
    const b = newBody();
    expect(((await (await doRegister(b)).json()).data as { ticket?: string }).ticket).toBeUndefined();
  });

  it("[reg-persist] the Super Admin's change is stored in the database and survives a restart and a new session", async () => {
    expect((await setPolicy(sup.token, "OTP_NOT_REQUIRED", "x")).status).toBe(400); // reason too short — still ON
    expect((await (await getPol(sup.token)).json()).data.policy[REG]).toBe("OTP_REQUIRED");
    await turnOff();
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, "otp.policy"));
    expect((row.value as Record<string, string>)[REG]).toBe("OTP_NOT_REQUIRED");

    // "restart": a brand-new module graph has to read the value back from the database
    vi.resetModules();
    const fresh = await import("@/server/modules/platform-settings/platform-settings.service");
    expect((await fresh.getOtpPolicy()).SIGNUP_VERIFICATION).toBe("OTP_NOT_REQUIRED");
    expect(await fresh.isOtpRequired("SIGNUP_VERIFICATION")).toBe(false);

    // a new admin session (page reload / next day) sees the same
    const token2 = await loginAs(sup.email, sup.password);
    const v = (await (await getPol(token2)).json()).data;
    expect(v.policy[REG]).toBe("OTP_NOT_REQUIRED");
    expect(v.isDefault).toBe(false);

    // turning it back ON needs no reason and is persisted too
    await turnOn();
    expect((await (await getPol(token2)).json()).data.policy[REG]).toBe("OTP_REQUIRED");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "otp.policy_changed"));
    expect(audit.length).toBe(2);
    // the other workflows were never touched
    expect((await (await getPol(sup.token)).json()).data.policy.NEW_DEVICE_LOGIN).toBe("OTP_REQUIRED");
  });

  it("[reg-never-configurable] password reset, admin sign-in etc. cannot be switched with this setting", async () => {
    for (const wf of ["PASSWORD_RESET", "ADMIN_LOGIN", "OTP_LOGIN"]) {
      expect((await setPolicy(sup.token, "OTP_NOT_REQUIRED", "should be refused", wf)).status).toBe(400);
    }
    const count = await db.execute(sql`select count(*)::int as c from platform_settings where key = 'otp.policy'`);
    expect((count.rows[0] as { c: number }).c).toBe(0);
  });
});
