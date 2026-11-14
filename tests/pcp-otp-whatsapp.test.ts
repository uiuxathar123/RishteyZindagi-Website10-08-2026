/**
 * WhatsApp OTP (Meta Cloud API, authentication template) against a local contract
 * mock of graph.facebook.com. Live acceptance of the real token/template is NOT
 * verified here.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.WHATSAPP_API_KEY = "wa-test-token-abcdefghijklmnop";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
  process.env.WHATSAPP_OTP_TEMPLATE_NAME = "rz_otp";
  process.env.WHATSAPP_API_BASE = "http://127.0.0.1:45876";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "45877";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass-secret-xyz";
  process.env.EMAIL_FROM = "RishteyZindagi <no-reply@rishteyzindagi.test>";
});

import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otpConfigs, otps } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __resetMailerForTests } from "@/server/lib/mailer";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { codeFromMail, startMockSmtp, type MockSmtp } from "./helpers/mock-otp";

import { PATCH as patchProvider } from "@/app/api/v1/admin/otp/provider/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as requestLoginOtp } from "@/app/api/v1/auth/request-login-otp/route";
import { POST as verifyLoginOtp } from "@/app/api/v1/auth/verify-login-otp/route";

const TOKEN = "wa-test-token-abcdefghijklmnop";
type Call = { url: string; auth: string; body: any };
const calls: Call[] = [];
let failNext: number | null = null;
let server: http.Server;
let smtp: MockSmtp;
let admin: TestAdmin;

beforeAll(async () => {
  server = http.createServer((rq, rs) => {
    let raw = "";
    rq.on("data", (c) => (raw += c));
    rq.on("end", () => {
      calls.push({ url: rq.url ?? "", auth: String(rq.headers.authorization ?? ""), body: JSON.parse(raw || "{}") });
      const status = failNext ?? 200;
      failNext = null;
      rs.writeHead(status, { "Content-Type": "application/json" });
      rs.end(status === 200 ? JSON.stringify({ messages: [{ id: "wamid.X" }] }) : JSON.stringify({ error: { code: 131026, message: "undeliverable" } }));
    });
  });
  await new Promise<void>((r) => server.listen(45876, "127.0.0.1", () => r()));
  smtp = await startMockSmtp({ user: "smtp-user", pass: "smtp-pass-secret-xyz" }, 45877);
});
afterAll(async () => {
  __resetMailerForTests();
  await new Promise<void>((r) => server.close(() => r()));
  await smtp.close();
});
beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  __resetMailerForTests();
  calls.length = 0;
  failNext = null;
  smtp.mails.length = 0;
  smtp.rejectNext = false;
  admin = await createAdmin("SUPER_ADMIN");
});
afterEach(() => vi.restoreAllMocks());

const useWhatsApp = () => db.update(otpConfigs).set({ devMode: false, activeMethod: "WHATSAPP", resendCooldownSeconds: 0 }).where(eq(otpConfigs.id, 1));
let n = 0;
const newSignup = () => {
  n += 1;
  return { name: "WA Tester", email: `wa-${n}-${Date.now()}@example.com`, mobileNumber: `7${String(n).padStart(9, "0")}` };
};
const verify = (identifier: string, code: string) => verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", { identifier, code }));
const codeOf = (c: Call) => String(c.body.template.components[0].parameters[0].text);

describe("META_WHATSAPP OTP provider", () => {
  it("[wa-send-verify] sign-up sends the authentication template to 91<mobile>; the code verifies; token never leaks", async () => {
    await useWhatsApp();
    const body = newSignup();
    const res = await register(req("http://localhost/api/v1/auth/register", body));
    const out = await res.json();
    expect(res.status).toBeLessThan(300);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe("/v21.0/1234567890/messages");
    expect(c.auth).toBe(`Bearer ${TOKEN}`);
    expect(c.body).toMatchObject({ messaging_product: "whatsapp", to: `91${body.mobileNumber}`, type: "template", template: { name: "rz_otp", language: { code: "en" } } });
    const code = codeOf(c);
    expect(code).toMatch(/^\d{6}$/);
    expect(c.body.template.components[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
    expect(smtp.mails).toHaveLength(0);
    expect((await verify(out.data.identifier, code)).status).toBe(200);
  });

  it("[wa-login] login OTP requested by e-mail goes to the member's WhatsApp", async () => {
    const member = await createVerifiedMember("wa-login");
    await useWhatsApp();
    const res = await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: member.email }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.to)).toMatch(/^91[6-9]\d{9}$/);
    const ok = await verifyLoginOtp(req("http://localhost/api/v1/auth/verify-login-otp", { email: member.email, code: codeOf(calls[0]) }, { deviceId: member.deviceId }));
    expect(ok.status).toBe(200);
  });

  it("[wa-fallback-email] WhatsApp refuses (number not on WhatsApp) → same flow e-mails the code, which verifies; nothing secret logged", async () => {
    await useWhatsApp();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    failNext = 400;
    const body = newSignup();
    const res = await register(req("http://localhost/api/v1/auth/register", body));
    const out = await res.json();
    expect(res.status).toBeLessThan(300);
    expect(calls).toHaveLength(1);
    expect(smtp.mails).toHaveLength(1);
    const code = codeFromMail(smtp.mails[0].text);
    expect((await verify(out.data.identifier, code)).status).toBe(200);
    const text = logs.join("\n");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(code);
  });

  it("[wa-both-fail] WhatsApp and e-mail both fail → 503 and no OTP row", async () => {
    await useWhatsApp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    failNext = 500;
    smtp.rejectNext = true;
    const res = await register(req("http://localhost/api/v1/auth/register", newSignup()));
    expect(res.status).toBe(503);
    expect(await db.select().from(otps)).toHaveLength(0);
  });

  it("[wa-admin-switch] super admin can activate META_WHATSAPP; it is stored as WHATSAPP", async () => {
    const res = await patchProvider(jreq("http://localhost/api/v1/admin/otp/provider", { method: "PATCH", body: { activeProvider: "META_WHATSAPP" }, token: admin.token }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.activeProvider).toBe("META_WHATSAPP");
    expect((await db.select().from(otpConfigs).where(eq(otpConfigs.id, 1)))[0].activeMethod).toBe("WHATSAPP");
  });
});
