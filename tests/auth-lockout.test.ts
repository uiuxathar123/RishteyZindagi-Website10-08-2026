/**
 * S-2: per-account lockout after repeated wrong passwords (member and admin sign-in).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { loginAttempts } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { login } from "@/server/modules/auth/auth.service";
import { adminLogin } from "@/server/modules/admin/admin.service";
import { LOCKOUT_MAX_FAILURES, isPasswordSignInLocked } from "@/server/modules/auth/lockout";
import { RateLimitError, AuthenticationError } from "@/server/lib/errors";
import { resetTransactionalTables, resetAdminUsers } from "./helpers/reset-db";
import { resolveReferenceIds, buildReadyProfile } from "./helpers/profile-fixtures";
import { createAdmin } from "./helpers/pcp";

// Each attempt is a real bcrypt comparison (~0.3 s, slower on a busy machine); up to 20 run per test.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const PASSWORD = "correcthorsebattery"; // the fixture password set by profile-fixtures.ts
const meta = { ipAddress: "203.0.113.7", userAgent: "vitest" };

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await db.delete(loginAttempts); // isolation: attempts from an earlier run inside the 15-minute window must not count
  __resetRateLimitsForTests();
});

async function failTimes(email: string, n: number) {
  for (let i = 0; i < n; i++) {
    await expect(login({ email, password: "wrong-password-1" }, meta)).rejects.toBeInstanceOf(AuthenticationError);
  }
}

describe("S-2 account lockout", () => {
  it("[lockout-member] 10 wrong passwords lock the account; even the right password is refused while locked", async () => {
    const refs = await resolveReferenceIds();
    const p = await buildReadyProfile("lockout-a", refs);
    const email = p.member.email;
    await failTimes(email, LOCKOUT_MAX_FAILURES - 1);
    expect(await isPasswordSignInLocked(email)).toBe(false);
    await failTimes(email, 1);
    expect(await isPasswordSignInLocked(email)).toBe(true);
    await expect(login({ email, password: PASSWORD }, meta)).rejects.toBeInstanceOf(RateLimitError);
    const locked = await db.select().from(loginAttempts).where(and(eq(loginAttempts.identifier, email), eq(loginAttempts.failureReason, "ACCOUNT_LOCKED")));
    expect(locked).toHaveLength(1);
  });

  it("[lockout-reset-on-success] a successful sign-in resets the count", async () => {
    const refs = await resolveReferenceIds();
    const p = await buildReadyProfile("lockout-b", refs);
    await failTimes(p.member.email, LOCKOUT_MAX_FAILURES - 1);
    // from the member's known device, so the sign-in completes (a new device would stop at the OTP step)
    const ok = await login({ email: p.member.email, password: PASSWORD }, { ...meta, deviceId: p.member.deviceId });
    expect(ok).toHaveProperty("sessionToken");
    await failTimes(p.member.email, LOCKOUT_MAX_FAILURES - 1);
    expect(await isPasswordSignInLocked(p.member.email)).toBe(false);
  });

  it("[lockout-window] failures older than the window do not count", async () => {
    const refs = await resolveReferenceIds();
    const p = await buildReadyProfile("lockout-c", refs);
    await failTimes(p.member.email, LOCKOUT_MAX_FAILURES);
    expect(await isPasswordSignInLocked(p.member.email)).toBe(true);
    expect(await isPasswordSignInLocked(p.member.email, new Date(Date.now() + 16 * 60_000))).toBe(false);
  });

  it("[lockout-unknown-email] an unknown e-mail locks the same way (no enumeration)", async () => {
    const email = `nobody-lockout-${Date.now()}@example.com`;
    await failTimes(email, LOCKOUT_MAX_FAILURES);
    await expect(login({ email, password: "anything-12345" }, meta)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("[lockout-admin] admin sign-in locks after 10 wrong passwords", async () => {
    const admin = await createAdmin("SUPER_ADMIN");
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      await expect(adminLogin({ email: admin.email, password: "wrong-password-1" }, meta)).rejects.toBeInstanceOf(AuthenticationError);
    }
    await expect(adminLogin({ email: admin.email, password: "adminpassword1" }, meta)).rejects.toBeInstanceOf(RateLimitError);
  });
});
