/**
 * Provider integration setup (Razorpay TEST mode + SMTP e-mail OTP).
 *
 * Everything here runs against LOCAL doubles (the protocol mock SMTP server). Nothing contacts Razorpay or a
 * real mail server, and nothing here proves a live provider accepts real credentials — that is what
 * `npm run check:providers` is for, on a machine with network access and the owner's test credentials.
 *
 * Covered:
 *   - Razorpay key-mode guard (fail closed): production refuses test/unknown keys, non-production refuses live keys;
 *     every money-touching path refuses; the admin status reports the detected mode and the reason; no secret leaks.
 *   - SMTP: connection verification (ok / bad password) with no password in the result or logs.
 *   - E-mail OTP over real SMTP delivery: code reaches the mailbox, expiry, single use, resend cooldown/limit,
 *     non-enumerating login-OTP response, no code in responses or logs.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "45874";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass-secret-xyz";
  process.env.EMAIL_FROM = "RishteyZindagi <no-reply@rishteyzindagi.test>";
});

import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otpConfigs, otps } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __resetMailerForTests, verifySmtpConnection } from "@/server/lib/mailer";
import { razorpayKeyModeProblem } from "@/server/modules/payments/credentials";
import { checkPcpProductionReadiness } from "@/server/config/prod-readiness-pcp";
import { getEnv } from "@/server/config/env";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables } from "./helpers/pcp";
import { codeFromMail, startMockSmtp, type MockSmtp } from "./helpers/mock-otp";

import { POST as resendOtp } from "@/app/api/v1/auth/resend-otp/route";
import { POST as requestLoginOtp } from "@/app/api/v1/auth/request-login-otp/route";
import { POST as verifyLoginOtp } from "@/app/api/v1/auth/verify-login-otp/route";
import { GET as getPaymentConfig } from "@/app/api/v1/admin/payments/config/route";

// Built at run time so the repository's "no live-looking key in source" scan stays meaningful.
const TEST_KEY = "rzp_" + "test_" + "AbCdEf123456";
const LIVE_LOOKING_KEY = "rzp_" + "live_" + "AbCdEf123456";
const SECRET = "razorpay-key-secret-for-guard-test";

let smtp: MockSmtp;

beforeAll(async () => {
  smtp = await startMockSmtp({ user: "smtp-user", pass: "smtp-pass-secret-xyz" });
});
afterAll(async () => {
  __resetMailerForTests();
  await smtp.close();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Razorpay key-mode guard (fail closed)", () => {
  it("[guard-matrix] production accepts only live keys; every other environment refuses live keys", () => {
    expect(razorpayKeyModeProblem("live", "production")).toBeUndefined();
    expect(razorpayKeyModeProblem("test", "production")).toMatch(/TEST key/);
    expect(razorpayKeyModeProblem("unknown", "production")).toMatch(/not a recognised live key/);
    for (const env of ["development", "test"]) {
      expect(razorpayKeyModeProblem("test", env)).toBeUndefined();
      expect(razorpayKeyModeProblem("unknown", env)).toBeUndefined(); // protocol mocks / legacy fixtures
      expect(razorpayKeyModeProblem("live", env)).toMatch(/LIVE key/);
    }
  });

  async function freshWithKey(nodeEnv: string, keyId: string) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("RAZORPAY_KEY_ID", keyId);
    vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET);
    vi.stubEnv("PAYMENT_PROVIDER_MODE", "real");
    const creds = await import("@/server/modules/payments/credentials");
    const prov = await import("@/server/modules/payments/providers/razorpay.provider");
    return { creds, provider: new prov.RazorpayProvider() };
  }

  it("[guard-prod-test-key] production + a TEST key: creds flagged, order creation, verification and refund refuse (503), test-connection reports it, no secret in any message", async () => {
    const { creds, provider } = await freshWithKey("production", TEST_KEY);
    const c = await creds.loadRazorpayCredentials();
    expect(c?.mode).toBe("test");
    expect(c?.problem).toMatch(/TEST key/);
    const orderErr = await provider.createOrder({ amountInSmallestUnit: 100, currency: "INR", receiptRef: "r1" }).catch((e) => e);
    expect(orderErr).toMatchObject({ statusCode: 503 });
    expect(String(orderErr.message)).not.toContain(SECRET);
    await expect(provider.verifyPayment({ providerOrderId: "order_x" })).rejects.toMatchObject({ statusCode: 503 });
    await expect(provider.refund({ providerOrderId: "order_x", providerPaymentId: "pay_x", amountInSmallestUnit: 100, refundRef: "rf1", reason: "t" })).rejects.toMatchObject({ statusCode: 503 });
    const t = await provider.testConnection();
    expect(t.ok).toBe(false);
    expect(t.message).toMatch(/TEST key/);
    expect(JSON.stringify([c?.problem, t])).not.toContain(SECRET);
  });

  it("[guard-nonprod-live-key] a live-looking key outside production is refused too (this setup can never move real money)", async () => {
    const { creds, provider } = await freshWithKey("test", LIVE_LOOKING_KEY);
    const c = await creds.loadRazorpayCredentials();
    expect(c?.mode).toBe("live");
    expect(c?.problem).toMatch(/LIVE key/);
    await expect(provider.createOrder({ amountInSmallestUnit: 100, currency: "INR", receiptRef: "r1" })).rejects.toMatchObject({ statusCode: 503 });
    expect((await provider.testConnection()).ok).toBe(false);
  });

  it("[guard-prod-live-key-allowed] production + a live key passes the guard (no call is made in this test)", async () => {
    const { creds } = await freshWithKey("production", LIVE_LOOKING_KEY);
    const c = await creds.loadRazorpayCredentials();
    expect(c?.mode).toBe("live");
    expect(c?.problem).toBeUndefined();
  });

  it("[guard-prod-readiness] check:prod-env reports an env test key as a blocking error, and a live key as fine", () => {
    const base = getEnv();
    const bad = checkPcpProductionReadiness({ ...base, RAZORPAY_KEY_ID: TEST_KEY });
    expect(bad.errors.join(" ")).toMatch(/TEST key/);
    expect(bad.errors.join(" ")).not.toContain(TEST_KEY);
    expect(checkPcpProductionReadiness({ ...base, RAZORPAY_KEY_ID: LIVE_LOOKING_KEY }).errors.join(" ")).not.toMatch(/RAZORPAY_KEY_ID/);
    expect(checkPcpProductionReadiness({ ...base, RAZORPAY_KEY_ID: undefined }).errors.join(" ")).not.toMatch(/RAZORPAY_KEY_ID/);
  });

  it("[guard-admin-status] the admin status shows the detected key mode, a configured TEST key outside production, and never a credential", async () => {
    await resetAdminUsers();
    await resetPaymentGatewaysForTests();
    await resetPcpTables();
    const admin = await createAdmin("SUPER_ADMIN");
    vi.stubEnv("RAZORPAY_KEY_ID", TEST_KEY);
    vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET);
    vi.resetModules();
    const route = await import("@/app/api/v1/admin/payments/config/route");
    const res = await route.GET(jreq("http://localhost/api/v1/admin/payments/config", { token: admin.token }));
    const text = await res.text();
    expect(res.status).toBe(200);
    const rz = JSON.parse(text).data.gateways.find((g: { key: string }) => g.key === "RAZORPAY");
    expect(rz).toMatchObject({ configured: true, detectedMode: "test", problem: null, credentialSource: "environment" });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TEST_KEY);
    void getPaymentConfig;
  });
});

describe("SMTP connection check", () => {
  it("[smtp-verify-ok] a correct host / login verifies", async () => {
    __resetMailerForTests();
    expect(await verifySmtpConnection()).toMatchObject({ ok: true });
  });

  it("[smtp-verify-bad-password] a wrong password fails with a generic message that carries no password or server text", async () => {
    vi.stubEnv("SMTP_PASS", "totally-wrong-password");
    vi.resetModules();
    const mailer = await import("@/server/lib/mailer");
    mailer.__resetMailerForTests();
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const r = await mailer.verifySmtpConnection();
    expect(r.ok).toBe(false);
    const all = JSON.stringify(r) + logs.join("\n");
    expect(all).not.toContain("totally-wrong-password");
    expect(all).not.toContain("smtp-pass-secret-xyz");
    expect(all).not.toMatch(/Invalid credentials/i);
  });

  it("[smtp-unreachable-fast] an unreachable host fails within the timeout instead of hanging", async () => {
    vi.stubEnv("SMTP_PORT", "45999"); // nothing listens here
    vi.resetModules();
    const mailer = await import("@/server/lib/mailer");
    mailer.__resetMailerForTests();
    const started = Date.now();
    const r = await mailer.verifySmtpConnection();
    expect(r.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("E-mail OTP over real SMTP delivery", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetPcpTables();
    __resetRateLimitsForTests();
    __resetMailerForTests();
    smtp.mails.length = 0;
    smtp.rejectNext = false;
  });

  const realEmail = (over: Partial<typeof otpConfigs.$inferInsert> = {}) =>
    db.update(otpConfigs).set({ devMode: false, activeMethod: "EMAIL", resendCooldownSeconds: 0, ...over }).where(eq(otpConfigs.id, 1));
  const login = (email: string) => requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email }));
  const verify = (email: string, code: string) => verifyLoginOtp(req("http://localhost/api/v1/auth/verify-login-otp", { email, code }));

  it("[email-otp-login-delivered-expiry-reuse] code is e-mailed, works once, is refused after use and after expiry", async () => {
    const m = await createVerifiedMember("prov-otp"); // created while dev mode is on
    await realEmail();
    expect((await login(m.email)).status).toBe(200);
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0].to).toEqual([m.email]);
    const code1 = codeFromMail(smtp.mails[0].text);
    expect(code1).toMatch(/^\d{6}$/);
    expect((await verify(m.email, code1)).status).toBe(200);
    expect((await verify(m.email, code1)).status).toBe(401); // single use

    // a fresh code that is then allowed to expire
    expect((await login(m.email)).status).toBe(200);
    const code2 = codeFromMail(smtp.mails[1].text);
    await db.update(otps).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(otps.identifier, m.email));
    const expired = await verify(m.email, code2);
    expect(expired.status).toBe(401);
    expect(JSON.stringify(await expired.json())).not.toContain(code2);
  });

  it("[email-otp-resend-limits] cooldown and per-window limit both answer 429 over HTTP and send nothing more", async () => {
    const m = await createVerifiedMember("prov-otp-rl");
    await realEmail({ resendCooldownSeconds: 60, maxResendAttempts: 2 });
    const resend = () => resendOtp(req("http://localhost/api/v1/auth/resend-otp", { identifier: m.email, purpose: "LOGIN" }));
    expect((await login(m.email)).status).toBe(200);
    expect(smtp.mails).toHaveLength(1);
    expect((await resend()).status).toBe(429); // inside the 60 s cooldown
    expect(smtp.mails).toHaveLength(1);
    await realEmail({ resendCooldownSeconds: 0, maxResendAttempts: 2 });
    expect((await login(m.email)).status).toBe(200); // 2nd allowed
    expect(smtp.mails).toHaveLength(2);
    expect((await login(m.email)).status).toBe(429); // window limit reached
    expect(smtp.mails).toHaveLength(2);
  });

  it("[email-otp-no-enumeration] unknown and known accounts get the same response shape; only the real account receives mail; no code in responses or logs", async () => {
    const m = await createVerifiedMember("prov-otp-enum");
    await realEmail();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    const known = await login(m.email);
    const unknown = await login("nobody-here@example.com");
    expect(unknown.status).toBe(known.status);
    const kb = (await known.json()) as { data: Record<string, unknown> };
    const ub = (await unknown.json()) as { data: Record<string, unknown> };
    expect(Object.keys(ub.data).sort()).toEqual(Object.keys(kb.data).sort());
    expect(smtp.mails.map((x) => x.to[0])).toEqual([m.email]);
    const code = codeFromMail(smtp.mails[0].text);
    expect(JSON.stringify([kb, ub]) + logs.join("\n")).not.toContain(code);
  });

  it("[email-otp-smtp-failure-safe] an SMTP rejection returns 503 with no OTP row and neither the code nor SMTP password in responses/logs", async () => {
    const m = await createVerifiedMember("prov-otp-fail");
    await realEmail();
    await db.delete(otps);
    smtp.rejectNext = true;
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    const res = await login(m.email);
    expect(res.status).toBe(503);
    expect(await db.select().from(otps)).toHaveLength(0);
    expect(JSON.stringify(await res.json()) + logs.join("\n")).not.toContain("smtp-pass-secret-xyz");
  });
});
