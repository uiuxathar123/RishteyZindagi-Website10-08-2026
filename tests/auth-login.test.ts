import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetOtpConfigForTests } from "./helpers/reset-db";

const KNOWN_DEVICE = "test-device-known-1";

function jsonPost(url: string, body: unknown, opts?: { token?: string; deviceId?: string }) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts?.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts?.deviceId ? { "x-device-id": opts.deviceId } : {}),
    },
    body: JSON.stringify(body),
  });
}

const credentials = { email: "login.test@example.com", password: "correcthorsebattery" };

/** Completes a full signup on KNOWN_DEVICE, so a later /auth/login call
 * from that same device id is recognized and returns a session directly
 * instead of a device-verification challenge. */
async function signUp() {
  const registerRes = await register(
    jsonPost("http://localhost/api/v1/auth/register", {
      name: "Login Test",
      email: credentials.email,
      mobileNumber: "9111111111",
    })
  );
  const { data: registerData } = await registerRes.json();
  const code = getDevOtpCode(registerData.identifier, "SIGNUP")!;

  const verifyRes = await verifySignupOtp(
    jsonPost("http://localhost/api/v1/auth/verify-signup-otp", { identifier: registerData.identifier, code })
  );
  const { data: verifyData } = await verifyRes.json();

  await setPassword(
    jsonPost(
      "http://localhost/api/v1/auth/set-password",
      { identifier: registerData.identifier, ticket: verifyData.ticket, password: credentials.password },
      { deviceId: KNOWN_DEVICE }
    )
  );
}

describe("POST /api/v1/auth/login + session lifecycle", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
    await signUp();
  });

  it("logs in with correct credentials on a known device and issues a session token", async () => {
    const res = await login(
      jsonPost("http://localhost/api/v1/auth/login", credentials, { deviceId: KNOWN_DEVICE })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.data.sessionToken).toBe("string");
    expect(body.data.sessionToken.length).toBeGreaterThan(20);
  });

  it("challenges an unrecognized device instead of returning a session directly", async () => {
    const res = await login(
      jsonPost("http://localhost/api/v1/auth/login", credentials, { deviceId: "some-other-device" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deviceVerificationRequired).toBe(true);
    expect(body.data.sessionToken).toBeUndefined();
  });

  it("rejects an incorrect password with 401, without revealing which field was wrong", async () => {
    const res = await login(
      jsonPost(
        "http://localhost/api/v1/auth/login",
        { email: credentials.email, password: "wrong" },
        { deviceId: KNOWN_DEVICE }
      )
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("rejects a login for an email that doesn't exist, with the same error as a wrong password", async () => {
    const res = await login(
      jsonPost(
        "http://localhost/api/v1/auth/login",
        { email: "nobody@example.com", password: "whatever1" },
        { deviceId: KNOWN_DEVICE }
      )
    );
    expect(res.status).toBe(401);
  });

  it("issues a session token that authenticates GET /api/v1/users/me", async () => {
    const loginRes = await login(
      jsonPost("http://localhost/api/v1/auth/login", credentials, { deviceId: KNOWN_DEVICE })
    );
    const { data } = await loginRes.json();

    const meRes = await getMe(
      new NextRequest("http://localhost/api/v1/users/me", {
        headers: { authorization: `Bearer ${data.sessionToken}` },
      })
    );
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.user.email).toBe(credentials.email);
  });

  it("revokes the session on logout — the same token no longer authenticates", async () => {
    const loginRes = await login(
      jsonPost("http://localhost/api/v1/auth/login", credentials, { deviceId: KNOWN_DEVICE })
    );
    const { data } = await loginRes.json();

    const logoutRes = await logout(jsonPost("http://localhost/api/v1/auth/logout", {}, { token: data.sessionToken }));
    expect(logoutRes.status).toBe(200);

    const meRes = await getMe(
      new NextRequest("http://localhost/api/v1/users/me", {
        headers: { authorization: `Bearer ${data.sessionToken}` },
      })
    );
    expect(meRes.status).toBe(401);
  });
});
