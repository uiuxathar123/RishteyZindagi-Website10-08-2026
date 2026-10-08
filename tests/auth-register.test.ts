import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifyPassword } from "@/server/lib/password";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetOtpConfigForTests } from "./helpers/reset-db";

function postJson(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  name: "Asha Verma",
  email: "asha.verma@example.com",
  mobileNumber: "9876543210",
};

/** Drives the full SIGNUP flow (register -> verify-signup-otp ->
 * set-password) and returns the final set-password response body's
 * `data`. Uses DevOtpProvider (see resetOtpConfigForTests) to read back
 * the code instead of a real SMS/WhatsApp/Email integration. */
async function fullSignup(payload: typeof validPayload, password: string) {
  const registerRes = await register(postJson("http://localhost/api/v1/auth/register", payload));
  expect(registerRes.status).toBe(201);
  const { data: registerData } = await registerRes.json();

  const code = getDevOtpCode(registerData.identifier, "SIGNUP");
  if (!code) throw new Error("no dev OTP code captured for identifier " + registerData.identifier);

  const verifyRes = await verifySignupOtp(
    postJson("http://localhost/api/v1/auth/verify-signup-otp", { identifier: registerData.identifier, code })
  );
  expect(verifyRes.status).toBe(200);
  const { data: verifyData } = await verifyRes.json();

  const setPasswordRes = await setPassword(
    postJson("http://localhost/api/v1/auth/set-password", {
      identifier: registerData.identifier,
      ticket: verifyData.ticket,
      password,
    })
  );
  return { res: setPasswordRes, body: await setPasswordRes.json(), registerData };
}

describe("Signup flow: POST /auth/register -> /auth/verify-signup-otp -> /auth/set-password", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
  });

  it("register sends an OTP and does not create a user yet", async () => {
    const res = await register(postJson("http://localhost/api/v1/auth/register", validPayload));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.identifier).toBe(validPayload.email);
    expect(body.data.channel).toBe("EMAIL");

    const [row] = await db.select().from(users).where(eq(users.email, validPayload.email));
    expect(row).toBeUndefined();
  });

  it("completes signup, creates a user, never returns the password hash, and auto-logs-in", async () => {
    const { res, body } = await fullSignup(validPayload, "correcthorsebattery");
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(validPayload.email);
    expect(body.data.user).not.toHaveProperty("passwordHash");
    expect(body.data.user).not.toHaveProperty("password");
    expect(typeof body.data.sessionToken).toBe("string");
    expect(body.data.sessionToken.length).toBeGreaterThan(20);
  });

  it("hashes the password — it is never stored in plain text — and marks the email verified", async () => {
    await fullSignup(validPayload, "correcthorsebattery");
    const [row] = await db.select().from(users).where(eq(users.email, validPayload.email));
    expect(row).toBeDefined();
    expect(row.passwordHash).not.toBe("correcthorsebattery");
    expect(row.passwordHash.startsWith("$2")).toBe(true); // bcrypt hash prefix
    await expect(verifyPassword("correcthorsebattery", row.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", row.passwordHash)).resolves.toBe(false);
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.mobileVerifiedAt).toBeNull();
  });

  it("rejects a duplicate email at register with 409 CONFLICT", async () => {
    await fullSignup(validPayload, "correcthorsebattery");
    const res = await register(
      postJson("http://localhost/api/v1/auth/register", { ...validPayload, mobileNumber: "9999999999" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("rejects a duplicate mobile number at register with 409 CONFLICT", async () => {
    await fullSignup(validPayload, "correcthorsebattery");
    const res = await register(
      postJson("http://localhost/api/v1/auth/register", { ...validPayload, email: "someone.else@example.com" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("rejects an invalid register request (bad email) with 400 VALIDATION_ERROR", async () => {
    const res = await register(
      postJson("http://localhost/api/v1/auth/register", { name: "X", email: "not-an-email", mobileNumber: "123" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("rejects a request with no body at all", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/register", { method: "POST" });
    const res = await register(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects the wrong OTP code and never leaks which field was wrong", async () => {
    const registerRes = await register(postJson("http://localhost/api/v1/auth/register", validPayload));
    const { data: registerData } = await registerRes.json();

    const res = await verifySignupOtp(
      postJson("http://localhost/api/v1/auth/verify-signup-otp", { identifier: registerData.identifier, code: "000000" })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("rejects reusing an already-consumed ticket", async () => {
    const registerRes = await register(postJson("http://localhost/api/v1/auth/register", validPayload));
    const { data: registerData } = await registerRes.json();
    const code = getDevOtpCode(registerData.identifier, "SIGNUP")!;

    const verifyRes = await verifySignupOtp(
      postJson("http://localhost/api/v1/auth/verify-signup-otp", { identifier: registerData.identifier, code })
    );
    const { data: verifyData } = await verifyRes.json();

    await setPassword(
      postJson("http://localhost/api/v1/auth/set-password", {
        identifier: registerData.identifier,
        ticket: verifyData.ticket,
        password: "correcthorsebattery",
      })
    );

    const secondAttempt = await setPassword(
      postJson("http://localhost/api/v1/auth/set-password", {
        identifier: registerData.identifier,
        ticket: verifyData.ticket,
        password: "correcthorsebattery",
      })
    );
    expect(secondAttempt.status).toBe(401);
  });
});
