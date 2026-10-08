/**
 * Forgot password / reset password, and logout-all. Covers the
 * non-enumeration guarantee, session revocation on reset, and that
 * logout-all is member-only (never usable with an admin session).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { db } from "@/server/db/client";
import { otps, adminRoles, adminUsers } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests } from "./helpers/reset-db";

function req(url: string, body?: unknown, opts?: { token?: string; deviceId?: string }) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts?.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts?.deviceId ? { "x-device-id": opts.deviceId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const email = "forgot-pw-test@example.com";
const deviceA = "forgot-pw-device-A";
const deviceB = "forgot-pw-device-B";

async function signUp() {
  const regRes = await register(req("http://localhost/api/v1/auth/register", { name: "Forgot PW Test", email, mobileNumber: "9666677778" }));
  const { data: regData } = await regRes.json();
  const code = getDevOtpCode(regData.identifier, "SIGNUP")!;
  const verifyRes = await verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", { identifier: regData.identifier, code }));
  const { data: verifyData } = await verifyRes.json();
  await setPassword(
    req("http://localhost/api/v1/auth/set-password", { identifier: regData.identifier, ticket: verifyData.ticket, password: "correcthorsebattery" }, { deviceId: deviceA })
  );
}

describe("Forgot password / reset password / logout-all", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
    await signUp();
  });

  it("forgot-password responds identically for a nonexistent account and creates no OTP row for it", async () => {
    const res = await forgotPassword(req("http://localhost/api/v1/auth/forgot-password", { email: "no-such-account@example.com" }));
    expect(res.status).toBe(200);
    const rows = await db.select().from(otps).where(eq(otps.identifier, "no-such-account@example.com"));
    expect(rows.length).toBe(0);
  });

  it("resets the password with a valid code, revokes existing sessions, and the new password works", async () => {
    const loginRes = await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: deviceA }));
    const { data: loginData } = await loginRes.json();

    await forgotPassword(req("http://localhost/api/v1/auth/forgot-password", { email }));
    const code = getDevOtpCode(email, "FORGOT_PASSWORD")!;
    const resetRes = await resetPassword(req("http://localhost/api/v1/auth/reset-password", { email, code, newPassword: "brandnewpassword1" }));
    expect(resetRes.status).toBe(200);

    // Old session is now revoked.
    const meRes = await getMe(new NextRequest("http://localhost/api/v1/users/me", { headers: { authorization: `Bearer ${loginData.sessionToken}` } }));
    expect(meRes.status).toBe(401);

    // Old password no longer works; new one does.
    const oldPwLogin = await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: deviceA }));
    expect(oldPwLogin.status).toBe(401);
    const newPwLogin = await login(req("http://localhost/api/v1/auth/login", { email, password: "brandnewpassword1" }, { deviceId: deviceA }));
    expect(newPwLogin.status).toBe(200);
  });

  it("rejects a wrong reset-password code with a generic 401", async () => {
    await forgotPassword(req("http://localhost/api/v1/auth/forgot-password", { email }));
    const res = await resetPassword(req("http://localhost/api/v1/auth/reset-password", { email, code: "000000", newPassword: "whatever12345" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("logout-all revokes every session for the member, and the revoked tokens no longer authenticate", async () => {
    const loginA = await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: deviceA }));
    const { data: dataA } = await loginA.json();

    // Verify a second device so it gets its own session too.
    await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: deviceB }));
    const deviceCode = getDevOtpCode(email, "NEW_DEVICE")!;
    const { POST: verifyDevice } = await import("@/app/api/v1/auth/verify-device/route");
    const verifyRes = await verifyDevice(req("http://localhost/api/v1/auth/verify-device", { identifier: email, code: deviceCode }, { deviceId: deviceB }));
    const { data: dataB } = await verifyRes.json();

    const logoutAllRes = await logoutAll(req("http://localhost/api/v1/auth/logout-all", undefined, { token: dataA.sessionToken }));
    expect(logoutAllRes.status).toBe(200);
    const logoutAllBody = await logoutAllRes.json();
    expect(logoutAllBody.data.sessionsRevoked).toBeGreaterThanOrEqual(2);

    const meA = await getMe(new NextRequest("http://localhost/api/v1/users/me", { headers: { authorization: `Bearer ${dataA.sessionToken}` } }));
    const meB = await getMe(new NextRequest("http://localhost/api/v1/users/me", { headers: { authorization: `Bearer ${dataB.sessionToken}` } }));
    expect(meA.status).toBe(401);
    expect(meB.status).toBe(401);
  });

  it("rejects logout-all for an admin session — it is member-only", async () => {
    const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "SUPER_ADMIN"));
    const adminEmail = "logoutall-admin@rishteyzindagi.local";
    await db.insert(adminUsers).values({ name: "Admin", email: adminEmail, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
    const adminLoginRes = await loginAdmin(req("http://localhost/api/v1/admin/login", { email: adminEmail, password: "adminpassword1" }));
    const { data: adminData } = await adminLoginRes.json();

    const res = await logoutAll(req("http://localhost/api/v1/auth/logout-all", undefined, { token: adminData.sessionToken }));
    expect(res.status).toBe(403);
  });
});
