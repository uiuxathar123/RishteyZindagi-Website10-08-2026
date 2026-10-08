/**
 * OTP-based login (request-login-otp / verify-login-otp) and new-device
 * verification (login -> deviceVerificationRequired -> verify-device).
 * Covers the non-enumeration guarantee for a nonexistent account and the
 * "an OTP login is itself the device proof" rule (no follow-up device
 * challenge after a successful OTP login).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as verifyDevice } from "@/app/api/v1/auth/verify-device/route";
import { POST as requestLoginOtp } from "@/app/api/v1/auth/request-login-otp/route";
import { POST as verifyLoginOtp } from "@/app/api/v1/auth/verify-login-otp/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { db } from "@/server/db/client";
import { otps, loginAttempts } from "@/server/db/schema";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetOtpConfigForTests } from "./helpers/reset-db";

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

const email = "otp-device-test@example.com";
const originalDevice = "otp-device-test-original";

async function signUp() {
  const regRes = await register(req("http://localhost/api/v1/auth/register", { name: "OTP Device Test", email, mobileNumber: "9555566667" }));
  const { data: regData } = await regRes.json();
  const code = getDevOtpCode(regData.identifier, "SIGNUP")!;
  const verifyRes = await verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", { identifier: regData.identifier, code }));
  const { data: verifyData } = await verifyRes.json();
  await setPassword(
    req("http://localhost/api/v1/auth/set-password", { identifier: regData.identifier, ticket: verifyData.ticket, password: "correcthorsebattery" }, { deviceId: originalDevice })
  );
}

describe("OTP login + new-device verification", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
    await signUp();
  });

  it("password login from an unrecognized device does not return a session — it requires device verification", async () => {
    const res = await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: "brand-new-device" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deviceVerificationRequired).toBe(true);
    expect(body.data.sessionToken).toBeUndefined();
  });

  it("completes login after verifying the new-device code, and that device is then recognized going forward", async () => {
    await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: "second-device" }));
    const code = getDevOtpCode(email, "NEW_DEVICE")!;

    const verifyRes = await verifyDevice(req("http://localhost/api/v1/auth/verify-device", { identifier: email, code }, { deviceId: "second-device" }));
    expect(verifyRes.status).toBe(200);
    const { data } = await verifyRes.json();
    expect(typeof data.sessionToken).toBe("string");

    // Now a plain password login from that same device succeeds directly.
    const secondLogin = await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: "second-device" }));
    const secondBody = await secondLogin.json();
    expect(secondBody.data.deviceVerificationRequired).toBeUndefined();
    expect(typeof secondBody.data.sessionToken).toBe("string");
  });

  it("rejects a wrong new-device code with 401 and records the failed attempt", async () => {
    await login(req("http://localhost/api/v1/auth/login", { email, password: "correcthorsebattery" }, { deviceId: "third-device" }));
    const res = await verifyDevice(req("http://localhost/api/v1/auth/verify-device", { identifier: email, code: "000000" }, { deviceId: "third-device" }));
    expect(res.status).toBe(401);

    const attempts = await db.select().from(loginAttempts).where(eq(loginAttempts.method, "OTP"));
    expect(attempts.some((a) => !a.success && a.failureReason === "INVALID_OTP")).toBe(true);
  });

  it("logs in via OTP (no password) and does not trigger a device-verification step", async () => {
    const requestRes = await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email }));
    expect(requestRes.status).toBe(200);

    const code = getDevOtpCode(email, "LOGIN")!;
    const verifyRes = await verifyLoginOtp(req("http://localhost/api/v1/auth/verify-login-otp", { email, code }, { deviceId: "otp-only-device" }));
    expect(verifyRes.status).toBe(200);
    const { data } = await verifyRes.json();
    expect(data.deviceVerificationRequired).toBeUndefined();
    expect(typeof data.sessionToken).toBe("string");

    const meRes = await getMe(new NextRequest("http://localhost/api/v1/users/me", { headers: { authorization: `Bearer ${data.sessionToken}` } }));
    expect(meRes.status).toBe(200);
  });

  it("rejects a wrong login-OTP code with a generic 401", async () => {
    await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email }));
    const res = await verifyLoginOtp(req("http://localhost/api/v1/auth/verify-login-otp", { email, code: "000000" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("request-login-otp responds identically for a nonexistent account and never creates an OTP row for it", async () => {
    const res = await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: "nobody-at-all@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.channel).toBe("EMAIL");
    expect(typeof body.data.expiresInSeconds).toBe("number");

    const rows = await db.select().from(otps).where(eq(otps.identifier, "nobody-at-all@example.com"));
    expect(rows.length).toBe(0);
  });
});
