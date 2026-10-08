/**
 * Production Completion Phase — OTP providers (EMAIL via SMTP, FAST2SMS_SMS) and
 * the admin provider switch. Real adapters run against a real local SMTP server
 * and a Fast2SMS contract mock (tests/helpers/mock-otp.ts). Live-vendor
 * acceptance of production credentials is NOT verified here.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.FAST2SMS_API_KEY = "f2s-test-api-key-1234567890";
  process.env.FAST2SMS_OTP_ID = "otp-template-1";
  process.env.FAST2SMS_API_BASE = "http://127.0.0.1:45873/dev";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "45874";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass-secret-xyz";
  process.env.EMAIL_FROM = "RishteyZindagi <no-reply@rishteyzindagi.test>";
});

import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, otpConfigs, otps } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __resetMailerForTests } from "@/server/lib/mailer";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { codeFromMail, startMockFast2Sms, startMockSmtp, type MockFast2Sms, type MockSmtp } from "./helpers/mock-otp";

import { GET as getProvider, PATCH as patchProvider } from "@/app/api/v1/admin/otp/provider/route";
import { PATCH as patchLegacyConfig } from "@/app/api/v1/admin/otp/config/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as resendOtp } from "@/app/api/v1/auth/resend-otp/route";
import { POST as requestLoginOtp } from "@/app/api/v1/auth/request-login-otp/route";
import { POST as verifyLoginOtp } from "@/app/api/v1/auth/verify-login-otp/route";

const F2S_KEY = "f2s-test-api-key-1234567890";
let sms: MockFast2Sms;
let smtp: MockSmtp;
let admin: TestAdmin;

beforeAll(async () => {
  sms = await startMockFast2Sms(F2S_KEY);
  smtp = await startMockSmtp({ user: "smtp-user", pass: "smtp-pass-secret-xyz" });
});
afterAll(async () => {
  __resetMailerForTests();
  await sms.close();
  await smtp.close();
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  __resetMailerForTests();
  sms.calls.length = 0;
  sms.failNext = null;
  sms.hang = false;
  smtp.mails.length = 0;
  smtp.rejectNext = false;
  admin = await createAdmin("SUPER_ADMIN");
});
afterEach(() => vi.restoreAllMocks());

const setProvider = (key: unknown, token = admin.token) =>
  patchProvider(jreq("http://localhost/api/v1/admin/otp/provider", { method: "PATCH", body: { activeProvider: key }, token }));
const realDelivery = async (method: "EMAIL" | "SMS") => {
  await db.update(otpConfigs).set({ devMode: false, activeMethod: method, resendCooldownSeconds: 0 }).where(eq(otpConfigs.id, 1));
};
let n = 0;
const newSignup = (over: Record<string, unknown> = {}) => {
  n += 1;
  return { name: "OTP Tester", email: `otp-${n}-${Date.now()}@example.com`, mobileNumber: `8${String(n).padStart(9, "0")}`, ...over };
};
const doRegister = async (body: Record<string, unknown>) => {
  const res = await register(req("http://localhost/api/v1/auth/register", body));
  return { res, body: await res.json() };
};
const doVerify = async (identifier: string, code: string) => {
  const res = await verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", { identifier, code }));
  return { res, body: await res.json() };
};

describe("admin OTP provider API", () => {
  it("[otp-admin-rbac] anonymous 401; staff without settings permission 403; super admin sees both providers, no secrets", async () => {
    expect((await getProvider(jreq("http://localhost/api/v1/admin/otp/provider"))).status).toBe(401);
    const staff = await createAdmin("STAFF_ADMIN");
    expect((await getProvider(jreq("http://localhost/api/v1/admin/otp/provider", { token: staff.token }))).status).toBe(403);
    expect((await setProvider("FAST2SMS_SMS", staff.token)).status).toBe(403);

    const res = await getProvider(jreq("http://localhost/api/v1/admin/otp/provider", { token: admin.token }));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const secret of [F2S_KEY, "smtp-pass-secret-xyz", "otp-template-1"]) expect(text).not.toContain(secret);
    const view = JSON.parse(text).data;
    expect(view.activeProvider).toBe("EMAIL");
    expect(view.providers.map((p: { key: string }) => p.key)).toEqual(["EMAIL", "FAST2SMS_SMS"]);
    expect(view.providers.every((p: { configured: boolean }) => p.configured)).toBe(true);
  });

  it("[otp-admin-switch] switching is atomic, audited, exactly one active; invalid values rejected", async () => {
    const res = await setProvider("FAST2SMS_SMS");
    expect(res.status).toBe(200);
    expect((await res.json()).data.activeProvider).toBe("FAST2SMS_SMS");
    expect((await db.select().from(otpConfigs))[0].activeMethod).toBe("SMS");
    expect((await setProvider("EMAIL")).status).toBe(200);
    expect((await db.select().from(otpConfigs))[0].activeMethod).toBe("EMAIL");

    for (const bad of ["WHATSAPP", "SMS", "sendgrid", 5, null]) expect((await setProvider(bad)).status).toBe(400);
    const extra = await patchProvider(jreq("http://localhost/api/v1/admin/otp/provider", { method: "PATCH", body: { activeProvider: "EMAIL", x: 1 }, token: admin.token }));
    expect(extra.status).toBe(400);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "otp_config.provider_switched"));
    expect(logs.length).toBe(2);
    expect(JSON.stringify(logs)).toContain("FAST2SMS_SMS");

    const results = await Promise.all(["EMAIL", "FAST2SMS_SMS", "EMAIL", "FAST2SMS_SMS", "FAST2SMS_SMS"].map((k) => setProvider(k)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(["EMAIL", "SMS"]).toContain((await db.select().from(otpConfigs))[0].activeMethod);
  });
});

describe("EMAIL provider (real SMTP)", () => {
  it("[otp-email-send-verify] sign-up code is delivered by SMTP to the member and verifies", async () => {
    await realDelivery("EMAIL");
    const body = newSignup();
    const { res, body: out } = await doRegister(body);
    expect(res.status).toBeLessThan(300);
    expect(out.data.identifier).toBe(body.email);
    expect(smtp.mails.length).toBe(1);
    expect(smtp.mails[0].to).toEqual([body.email]);
    expect(smtp.mails[0].subject).toMatch(/verification code/i);
    expect(smtp.mails[0].from).toBe("no-reply@rishteyzindagi.test");
    const code = codeFromMail(smtp.mails[0].text);
    expect(code).toMatch(/^\d{6}$/);
    expect((await doVerify(body.email as string, "000000")).res.status).toBe(401);
    expect((await doVerify(body.email as string, code)).res.status).toBe(200);
    // replay of a consumed code
    expect((await doVerify(body.email as string, code)).res.status).toBe(401);
  });

  it("[otp-email-failure] SMTP rejection → 503, no OTP row, no leak of code or SMTP password", async () => {
    await realDelivery("EMAIL");
    smtp.rejectNext = true;
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    const body = newSignup();
    const { res, body: out } = await doRegister(body);
    expect(res.status).toBe(503);
    expect(await db.select().from(otps)).toHaveLength(0);
    const all = JSON.stringify(out) + logs.join("\n");
    expect(all).not.toContain("smtp-pass-secret-xyz");
    expect(all).not.toMatch(/\b\d{6}\b.*verification/);
  });

  it("[otp-email-bad-credentials] wrong SMTP password fails honestly (503), never reports success", async () => {
    await realDelivery("EMAIL");
    vi.stubEnv("SMTP_PASS", "wrong-password");
    // getEnv() caches; use a fresh graph
    vi.resetModules();
    const { EmailOtpProvider } = await import("@/server/modules/otp/providers/email.provider");
    const mailer = await import("@/server/lib/mailer");
    mailer.__resetMailerForTests();
    await expect(new EmailOtpProvider().send({ to: "someone@example.com", code: "123456", purpose: "LOGIN", expirySeconds: 300 })).rejects.toMatchObject({ statusCode: 503 });
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("FAST2SMS_SMS provider (Fast2SMS contract mock)", () => {
  it("[otp-sms-send-verify] sign-up under SMS posts the documented request; the code verifies; key never leaks", async () => {
    await realDelivery("SMS");
    const body = newSignup();
    const { res, body: out } = await doRegister(body);
    expect(res.status).toBeLessThan(300);
    expect(out.data.identifier).toBe(`+91${body.mobileNumber}`);
    expect(JSON.stringify(out)).not.toContain(F2S_KEY);
    expect(sms.calls).toHaveLength(1);
    const call = sms.calls[0];
    expect(call.headers.authorization).toBe(F2S_KEY);
    expect(call.body).toMatchObject({ mobile: body.mobileNumber, otp_id: "otp-template-1", otp_length: 6, otp_expiry: 5 });
    const code = String(call.body.otp);
    expect(code).toMatch(/^\d{6}$/);
    expect(smtp.mails).toHaveLength(0);
    expect((await doVerify(out.data.identifier, "111111")).res.status).toBe(401);
    expect((await doVerify(out.data.identifier, code)).res.status).toBe(200);
    expect((await doVerify(out.data.identifier, code)).res.status).toBe(401);
  });

  it("[otp-sms-login-uses-member-mobile] login OTP requested by e-mail is texted to the member's own mobile", async () => {
    const member = await createVerifiedMember("otp-sms-login"); // while dev mode is on
    await realDelivery("SMS");
    const res = await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: member.email }));
    expect(res.status).toBe(200);
    expect(sms.calls).toHaveLength(1);
    expect(String(sms.calls[0].body.mobile)).toMatch(/^9\d{9}$/);
    const code = String(sms.calls[0].body.otp);
    const ok = await verifyLoginOtp(req("http://localhost/api/v1/auth/verify-login-otp", { email: member.email, code }, { deviceId: member.deviceId }));
    expect(ok.status).toBe(200);
  });

  it("[otp-sms-failures] 401 / 500 from the vendor → 503, no OTP row, no secret or code in the response or logs", async () => {
    await realDelivery("SMS");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    for (const status of [401, 500]) {
      sms.failNext = { status };
      const { res, body } = await doRegister(newSignup());
      expect(res.status).toBe(503);
      expect(JSON.stringify(body)).not.toContain(F2S_KEY);
    }
    expect(await db.select().from(otps)).toHaveLength(0);
    const sentCodes = sms.calls.map((c) => String(c.body.otp));
    const text = logs.join("\n");
    expect(text).not.toContain(F2S_KEY);
    for (const c of sentCodes) expect(text).not.toContain(c);
  });

  it("[otp-sms-non-indian] a non-Indian number cannot receive SMS (400), nothing is sent", async () => {
    await realDelivery("SMS");
    const { res } = await doRegister(newSignup({ countryCode: "+1" }));
    expect(res.status).toBe(400);
    expect(sms.calls).toHaveLength(0);
  });

  it("[otp-sms-unconfigured-fails-closed] without credentials SMS refuses to send (503), never silently succeeds", async () => {
    vi.stubEnv("FAST2SMS_API_KEY", "");
    vi.resetModules();
    const { SmsOtpProvider } = await import("@/server/modules/otp/providers/sms.provider");
    const p = new SmsOtpProvider();
    expect(p.isConfigured()).toBe(false);
    expect(p.missingSettings()).toContain("FAST2SMS_API_KEY");
    await expect(p.send({ to: "+919876543210", code: "123456", purpose: "LOGIN", expirySeconds: 300 })).rejects.toMatchObject({ statusCode: 503 });
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("switching providers with codes in flight", () => {
  it("[otp-switch-inflight-email-to-sms] a code issued by e-mail still verifies after switching to SMS", async () => {
    await realDelivery("EMAIL");
    const body = newSignup();
    await doRegister(body);
    const code = codeFromMail(smtp.mails[0].text);
    expect((await setProvider("FAST2SMS_SMS")).status).toBe(200);
    expect((await doVerify(body.email as string, code)).res.status).toBe(200);
  });

  it("[otp-switch-inflight-sms-to-email] a code issued by SMS still verifies after switching to e-mail", async () => {
    await realDelivery("SMS");
    const body = newSignup();
    const { body: out } = await doRegister(body);
    const code = String(sms.calls[0].body.otp);
    expect((await setProvider("EMAIL")).status).toBe(200);
    expect((await doVerify(out.data.identifier, code)).res.status).toBe(200);
  });

  it("[otp-switch-records-untouched] a switch never invalidates or alters stored OTP rows", async () => {
    await realDelivery("EMAIL");
    await doRegister(newSignup());
    const before = await db.select().from(otps);
    await setProvider("FAST2SMS_SMS");
    await setProvider("EMAIL");
    const after = await db.select().from(otps);
    expect(after).toEqual(before);
    expect(after[0].invalidatedAt).toBeNull();
  });

  it("[otp-switch-resend-uses-new-provider] a resend after the switch goes through the new channel to the right address", async () => {
    await realDelivery("EMAIL");
    const body = newSignup();
    await doRegister(body);
    expect(smtp.mails).toHaveLength(1);
    await setProvider("FAST2SMS_SMS");
    const res = await resendOtp(req("http://localhost/api/v1/auth/resend-otp", { identifier: body.email, purpose: "SIGNUP" }));
    expect(res.status).toBe(200);
    expect(sms.calls).toHaveLength(1);
    expect(sms.calls[0].body.mobile).toBe(body.mobileNumber);
    expect(smtp.mails).toHaveLength(1);
    // the new code works; the old one no longer does (existing single-live-code rule)
    const fresh = String(sms.calls[0].body.otp);
    expect((await doVerify(body.email as string, codeFromMail(smtp.mails[0].text) === fresh ? "x" : codeFromMail(smtp.mails[0].text))).res.status).toBe(401);
    expect((await doVerify(body.email as string, fresh)).res.status).toBe(200);
  });
});

describe("legacy OTP config endpoint", () => {
  it("[otp-legacy-config-unchanged] outside production the legacy PATCH still accepts the frozen enum", async () => {
    const res = await patchLegacyConfig(jreq("http://localhost/api/v1/admin/otp/config", { method: "PATCH", body: { activeMethod: "WHATSAPP" }, token: admin.token }));
    expect(res.status).toBe(200);
  });
});
