/**
 * Registration OTP switch with SMTP CONFIGURED (against a local protocol-level SMTP test server, tests/helpers/mock-otp.ts).
 * Complements registration-otp-switch.test.ts (which covers SMTP NOT configured).
 *
 *   ON  – the sign-up code really goes out through the configured SMTP relay, only the right code verifies,
 *         and only a verified ticket can create the account.
 *   OFF – even with a working SMTP relay NOTHING is e-mailed, and the account is created without a code.
 *   Both states are switched through the Super Admin API, exactly as the screen does.
 *
 * This proves the application's SMTP path against a local test server. It does NOT prove that your real SMTP
 * provider accepts your real credentials — that needs a manual send with your own settings.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "45876";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass-for-tests-only";
  process.env.EMAIL_FROM = "RishteyZindagi <no-reply@rishteyzindagi.test>";
});

import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otpConfigs, users } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __resetMailerForTests } from "@/server/lib/mailer";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { codeFromMail, startMockSmtp, type MockSmtp } from "./helpers/mock-otp";

import { GET as getPolicy, PATCH as patchPolicy } from "@/app/api/v1/admin/otp/policy/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";

const URL_ = "http://localhost/api/v1";
let smtp: MockSmtp;
let sup: TestAdmin;
let n = 0;

beforeAll(async () => {
  smtp = await startMockSmtp({ user: "smtp-user", pass: "smtp-pass-for-tests-only" }, 45876);
});
afterAll(async () => {
  __resetMailerForTests();
  await smtp.close();
  await resetAdminUsers();
  await resetOtpConfigForTests();
});
beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  __resetMailerForTests();
  smtp.mails.length = 0;
  smtp.rejectNext = false;
  // real e-mail delivery (no dev-mode capture)
  await db.update(otpConfigs).set({ devMode: false, activeMethod: "EMAIL", resendCooldownSeconds: 0 }).where(eq(otpConfigs.id, 1));
  sup = await createAdmin("SUPER_ADMIN");
});

const setPolicy = (requirement: string, reason?: string) =>
  patchPolicy(jreq(`${URL_}/admin/otp/policy`, { method: "PATCH", body: { workflow: "SIGNUP_VERIFICATION", requirement, ...(reason ? { reason } : {}) }, token: sup.token }));
const body = () => {
  n += 1;
  return { name: "Smtp Switch", email: `smtp-switch-${n}-${Date.now()}@example.com`, mobileNumber: `96${String(n).padStart(8, "0")}` };
};
const doRegister = (b: Record<string, unknown>) => register(req(`${URL_}/auth/register`, b));
const doSetPassword = (identifier: string, ticket: string) =>
  setPassword(req(`${URL_}/auth/set-password`, { identifier, ticket, password: "correcthorsebattery" }, { deviceId: "smtp-sw" }));

describe("registration OTP switch with a working SMTP relay", () => {
  it("[reg-smtp-on] ON: the code is e-mailed through SMTP, a wrong code fails, the right code is needed to create the account", async () => {
    const b = body();
    const res = await doRegister(b);
    expect(res.status).toBe(201);
    const d = (await res.json()).data;
    expect(d.ticket).toBeUndefined();
    expect(smtp.mails.length).toBe(1);
    expect(smtp.mails[0].to).toEqual([b.email]);
    expect(smtp.mails[0].subject).toMatch(/verification code/i);
    const code = codeFromMail(smtp.mails[0].text);

    // no verified ticket yet -> no account
    expect((await doSetPassword(d.identifier, "not-a-real-ticket")).status).toBe(401);
    expect((await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: d.identifier, code: code === "000000" ? "111111" : "000000" }))).status).toBe(401);
    expect((await db.select().from(users).where(eq(users.email, b.email))).length).toBe(0);

    const v = (await (await verifySignupOtp(req(`${URL_}/auth/verify-signup-otp`, { identifier: d.identifier, code }))).json()).data;
    expect((await doSetPassword(d.identifier, v.ticket)).status).toBe(201);
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it("[reg-smtp-off] OFF: no e-mail is sent even though SMTP works; the account is created without a code; ON again e-mails a code", async () => {
    expect((await setPolicy("OTP_NOT_REQUIRED", "local testing of registration")).status).toBe(200);
    const b = body();
    const res = await doRegister(b);
    expect(res.status).toBe(201);
    const d = (await res.json()).data;
    expect(d.otpRequired).toBe(false);
    expect(smtp.mails.length).toBe(0);
    expect((await doSetPassword(d.identifier, d.ticket)).status).toBe(201);
    expect(smtp.mails.length).toBe(0);
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    expect(u.emailVerifiedAt).toBeNull();

    expect((await setPolicy("OTP_REQUIRED")).status).toBe(200);
    expect((await (await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }))).json()).data.delivery.ready).toBe(true);
    const b2 = body();
    expect((await doRegister(b2)).status).toBe(201);
    expect(smtp.mails.length).toBe(1);
    expect(smtp.mails[0].to).toEqual([b2.email]);
  });

  it("[reg-smtp-failure-no-bypass] ON + the relay refuses the message: 503, no account, no ticket, never a silent skip", async () => {
    smtp.rejectNext = true;
    const b = body();
    const res = await doRegister(b);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/ticket/i);
    expect((await db.select().from(users).where(eq(users.email, b.email))).length).toBe(0);
    expect((await (await getPolicy(jreq(`${URL_}/admin/otp/policy`, { token: sup.token }))).json()).data.policy.SIGNUP_VERIFICATION).toBe("OTP_REQUIRED");
  });
});
