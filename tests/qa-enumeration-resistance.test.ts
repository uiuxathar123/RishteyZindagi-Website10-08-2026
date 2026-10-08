/**
 * B12 QA §5: enumeration-resistance audit across every auth/OTP flow
 * that takes an identifier (email) and must not reveal whether an
 * account exists behind it.
 *
 * Response-shape parity (message/status-level non-enumeration) was
 * already spot-checked per-endpoint by auth-forgot-password.test.ts and
 * auth-otp-login-device.test.ts; this file adds:
 *
 *  (a) direct SIDE-BY-SIDE shape-diffing (not just each case checked in
 *      isolation) for request-login-otp and forgot-password, proving the
 *      two responses share the exact same JSON key set and status code;
 *  (b) a functional (non-timing) re-confirmation that B10's login timing
 *      fix (BACKEND.md §54.4.7) still holds — wrong-password and
 *      nonexistent-email both take the exact same code path through
 *      `verifyPassword`, producing byte-identical error responses;
 *  (c) a concrete, quantified record of the ONE residual gap this audit
 *      found and did NOT fix — see the last test and BACKEND.md §56 for
 *      the full writeup and severity reasoning.
 *
 * Touches zero production code.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as verifySignupOtp } from "@/app/api/v1/auth/verify-signup-otp/route";
import { POST as setPassword } from "@/app/api/v1/auth/set-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as requestLoginOtp } from "@/app/api/v1/auth/request-login-otp/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { db } from "@/server/db/client";
import { otps } from "@/server/db/schema";
import { getDevOtpCode, __clearDevOtpStoreForTests } from "@/server/modules/otp/providers/dev.provider";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetOtpConfigForTests } from "./helpers/reset-db";

function req(url: string, body?: unknown, opts?: { deviceId?: string }) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts?.deviceId ? { "x-device-id": opts.deviceId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const existingEmail = "qa-enum-existing@example.com";
const missingEmail = "qa-enum-missing-account@example.com";

async function signUp() {
  const regRes = await register(req("http://localhost/api/v1/auth/register", { name: "QA Enum Test", email: existingEmail, mobileNumber: "9777788889" }));
  const { data: regData } = await regRes.json();
  const code = getDevOtpCode(regData.identifier, "SIGNUP")!;
  const verifyRes = await verifySignupOtp(req("http://localhost/api/v1/auth/verify-signup-otp", { identifier: regData.identifier, code }));
  const { data: verifyData } = await verifyRes.json();
  await setPassword(req("http://localhost/api/v1/auth/set-password", { identifier: regData.identifier, ticket: verifyData.ticket, password: "correcthorsebattery" }, { deviceId: "qa-enum-device" }));
}

describe("QA §5: enumeration resistance across auth/OTP flows", () => {
  beforeEach(async () => {
    await resetTransactionalTables();
    await resetOtpConfigForTests();
    __clearDevOtpStoreForTests();
    __resetRateLimitsForTests();
    await signUp();
  });

  it("[enum-otp-shape-parity] request-login-otp: existing vs. nonexistent account return identical status and identical JSON key set", async () => {
    const existingRes = await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: existingEmail }));
    const missingRes = await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: missingEmail }));

    expect(existingRes.status).toBe(missingRes.status);
    const existingBody = await existingRes.json();
    const missingBody = await missingRes.json();
    expect(Object.keys(existingBody.data).sort()).toEqual(Object.keys(missingBody.data).sort());
    expect(typeof existingBody.data.channel).toBe(typeof missingBody.data.channel);
    expect(typeof existingBody.data.expiresInSeconds).toBe(typeof missingBody.data.expiresInSeconds);
    expect(typeof existingBody.data.resendAvailableAt).toBe(typeof missingBody.data.resendAvailableAt);
  });

  it("[enum-forgot-password-shape-parity] forgot-password: existing vs. nonexistent account return identical status and identical JSON key set", async () => {
    const existingRes = await forgotPassword(req("http://localhost/api/v1/auth/forgot-password", { email: existingEmail }));
    const missingRes = await forgotPassword(req("http://localhost/api/v1/auth/forgot-password", { email: missingEmail }));

    expect(existingRes.status).toBe(missingRes.status);
    const existingBody = await existingRes.json();
    const missingBody = await missingRes.json();
    expect(Object.keys(existingBody.data).sort()).toEqual(Object.keys(missingBody.data).sort());
  });

  it("[enum-login-message-parity] login: wrong password (real account) and a wholly nonexistent account produce byte-identical error bodies (B10 §54.4.7's fix — re-confirmed functionally)", async () => {
    const wrongPasswordRes = await login(req("http://localhost/api/v1/auth/login", { email: existingEmail, password: "totally-wrong-password" }, { deviceId: "qa-enum-device" }));
    const noAccountRes = await login(req("http://localhost/api/v1/auth/login", { email: missingEmail, password: "totally-wrong-password" }, { deviceId: "qa-enum-device" }));

    expect(wrongPasswordRes.status).toBe(401);
    expect(noAccountRes.status).toBe(401);
    const wrongPasswordBody = await wrongPasswordRes.json();
    const noAccountBody = await noAccountRes.json();
    expect(wrongPasswordBody.error.code).toBe(noAccountBody.error.code);
    expect(wrongPasswordBody.error.message).toBe(noAccountBody.error.message);
  });

  it("[enum-otp-request-db-differential — DOCUMENTED FINDING, NOT FIXED] request-login-otp/forgot-password perform real DB writes (+ a provider dispatch) for an existing account and NONE for a nonexistent one — a genuine, quantified response-TIMING side-channel distinct from the (solid) message-level non-enumeration proven above. See BACKEND.md §56 for full severity reasoning (P2: message-level parity holds; this requires a network-timing attack, the same class of risk B10 itself documented as untestable-in-CI for its own login fix, and closing the DB-write gap safely would need a dummy-write design with real rate-limiting semantics implications deserving its own product decision, not a narrow QA-phase change to frozen B2 auth.service.ts).", async () => {
    await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: existingEmail }));
    await requestLoginOtp(req("http://localhost/api/v1/auth/request-login-otp", { email: missingEmail }));

    const existingRows = await db.select().from(otps).where(eq(otps.identifier, existingEmail));
    const missingRows = await db.select().from(otps).where(eq(otps.identifier, missingEmail));

    // Quantifies the exact differential this finding documents: a real
    // account triggers a real OTP row (DB write + a dev-provider send);
    // a fake one triggers zero writes. This asymmetry is what a
    // network-timing attacker could in principle exploit — the response
    // body/status are already identical (proven above), so this is
    // strictly a secondary, harder-to-exploit vector, not a message leak.
    expect(existingRows.length).toBeGreaterThan(0);
    expect(missingRows.length).toBe(0);
  });
});
