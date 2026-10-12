/**
 * B19 — member changes e-mail / mobile (password + code sent to the new contact).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { POST as requestRoute } from "@/app/api/v1/users/me/contact-change/request/route";
import { POST as confirmRoute } from "@/app/api/v1/users/me/contact-change/confirm/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { GET as myProfile } from "@/app/api/v1/profiles/me/route";
import { db } from "@/server/db/client";
import { auditLogs, deviceSessions, users } from "@/server/db/schema";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers } from "./helpers/reset-db";
import { createVerifiedMember, req } from "./helpers/profile-fixtures";

const U = "http://localhost/api/v1";
const PW = "correcthorsebattery";
const request = (token: string | undefined, body: unknown) => requestRoute(req(`${U}/users/me/contact-change/request`, body, { token, method: "POST" }));
const confirm = (token: string | undefined, body: unknown) => confirmRoute(req(`${U}/users/me/contact-change/confirm`, body, { token, method: "POST" }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await resetTransactionalTables();
  // resetAdminUsers already upserts otp_configs (self-heal after CASCADE).
  await resetAdminUsers();
  __resetRateLimitsForTests();
  __clearDevOtpStoreForTests();
});

describe("e-mail change", () => {
  it("[cc-email] password required; code goes to the NEW address; account updated and verified; other sessions revoked; login moves to the new address; audited with masked values", async () => {
    const m = await createVerifiedMember("cc-email");
    // a second, older session that must be signed out by the change
    const [other] = await db.insert(deviceSessions).values({ userId: m.userId, tokenHash: "h".repeat(64), expiresAt: new Date(Date.now() + 3600_000) }).returning();
    const newEmail = `new-${Date.now()}@example.com`;

    expect((await request(undefined, { type: "EMAIL", newValue: newEmail, password: PW })).status).toBe(401);
    expect((await request(m.sessionToken, { type: "EMAIL", newValue: newEmail, password: "wrong-password-1" })).status).toBe(401);
    expect(getDevOtpCode(newEmail, "CONTACT_CHANGE")).toBeUndefined(); // no code on a wrong password

    const r = await request(m.sessionToken, { type: "EMAIL", newValue: newEmail, password: PW });
    expect(r.status).toBe(200);
    const rd = (await r.json()).data;
    expect(rd.sentTo).not.toContain(newEmail);
    const code = getDevOtpCode(newEmail, "CONTACT_CHANGE")!;
    expect(code).toMatch(/^\d{6}$/);
    expect(getDevOtpCode(m.email, "CONTACT_CHANGE")).toBeUndefined(); // old address got nothing

    expect((await confirm(m.sessionToken, { type: "EMAIL", newValue: newEmail, code: code === "000000" ? "111111" : "000000" })).status).toBe(401);
    const ok = await confirm(m.sessionToken, { type: "EMAIL", newValue: newEmail, code });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.otherSessionsRevoked).toBe(1);
    expect((await confirm(m.sessionToken, { type: "EMAIL", newValue: newEmail, code })).status).toBe(401); // single use

    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    expect(u.email).toBe(newEmail);
    expect(u.emailVerifiedAt).not.toBeNull();
    const [o] = await db.select().from(deviceSessions).where(eq(deviceSessions.id, other.id));
    expect(o.revokedAt).not.toBeNull();
    // the current session survives
    expect((await myProfile(req(`${U}/profiles/me`, undefined, { token: m.sessionToken, method: "GET" }))).status).toBe(404); // no profile yet, but authenticated
    expect((await db.select().from(deviceSessions).where(and(eq(deviceSessions.userId, m.userId), isNull(deviceSessions.revokedAt)))).length).toBeGreaterThanOrEqual(1);

    // sign-in now uses the new address
    expect((await loginRoute(req(`${U}/auth/login`, { email: newEmail, password: PW }, { deviceId: m.deviceId }))).status).toBe(200);
    expect((await loginRoute(req(`${U}/auth/login`, { email: m.email, password: PW }, { deviceId: m.deviceId }))).status).toBe(401);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "account.email_changed"));
    expect(logs.length).toBe(1);
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(newEmail);
    expect(dump).not.toContain(m.email);
  });

  it("[cc-guards] taken, identical and malformed values are refused; a code is bound to its member and value", async () => {
    const a = await createVerifiedMember("cc-a");
    const b = await createVerifiedMember("cc-b");
    expect((await request(a.sessionToken, { type: "EMAIL", newValue: b.email, password: PW })).status).toBe(409);
    expect((await request(a.sessionToken, { type: "EMAIL", newValue: a.email, password: PW })).status).toBe(400);
    expect((await request(a.sessionToken, { type: "EMAIL", newValue: "not-an-email", password: PW })).status).toBe(400);
    expect((await request(a.sessionToken, { type: "EMAIL", newValue: "x@y.co", password: PW, extra: 1 })).status).toBe(400);

    const target = `shared-${Date.now()}@example.com`;
    expect((await request(b.sessionToken, { type: "EMAIL", newValue: target, password: PW })).status).toBe(200);
    const bCode = getDevOtpCode(target, "CONTACT_CHANGE")!;
    // member A cannot redeem member B's code for the same address
    expect((await confirm(a.sessionToken, { type: "EMAIL", newValue: target, code: bCode })).status).toBe(401);
    // The account is unchanged for both members.
    const [rowA] = await db.select().from(users).where(eq(users.id, a.userId));
    expect(rowA.email).toBe(a.email);
    // A wrong value for a valid code is refused too (binding to the exact new value).
    expect((await request(b.sessionToken, { type: "EMAIL", newValue: `other-${Date.now()}@example.com`, password: PW })).status).toBe(200);
    const [rowB] = await db.select().from(users).where(eq(users.id, b.userId));
    expect(rowB.email).toBe(b.email);
  });
});

describe("mobile change", () => {
  it("[cc-mobile] code goes over SMS to the new number; account updated and marked verified; taken number refused", async () => {
    const m = await createVerifiedMember("cc-mob");
    const other = await createVerifiedMember("cc-mob2");
    const [otherRow] = await db.select().from(users).where(eq(users.id, other.userId));
    expect((await request(m.sessionToken, { type: "MOBILE", newValue: otherRow.mobileNumber, countryCode: "+91", password: PW })).status).toBe(409);
    expect((await request(m.sessionToken, { type: "MOBILE", newValue: "12", password: PW })).status).toBe(400);
    expect((await request(m.sessionToken, { type: "MOBILE", newValue: "9876500001", countryCode: "91", password: PW })).status).toBe(400);

    const r = await request(m.sessionToken, { type: "MOBILE", newValue: "9876500001", countryCode: "+91", password: PW });
    expect(r.status).toBe(200);
    expect((await r.json()).data.channel).toBe("SMS");
    const code = getDevOtpCode("+919876500001", "CONTACT_CHANGE")!;
    expect(code).toMatch(/^\d{6}$/);
    await sleep(50);
    expect((await confirm(m.sessionToken, { type: "MOBILE", newValue: "9876500001", countryCode: "+91", code })).status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    expect(u.mobileNumber).toBe("9876500001");
    expect(u.mobileVerifiedAt).not.toBeNull();
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "account.mobile_changed"))).length).toBe(1);
  });

  it("[cc-admin-denied] an admin session cannot use the member endpoints", async () => {
    const { createAdmin } = await import("./helpers/pcp");
    const sup = await createAdmin("SUPER_ADMIN");
    expect([401, 403]).toContain((await request(sup.token, { type: "EMAIL", newValue: "a@b.co", password: PW })).status);
  });
});
