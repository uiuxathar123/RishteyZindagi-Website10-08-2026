/**
 * S-2: per-account lockout for password sign-in (member and admin).
 *
 * After LOCKOUT_MAX_FAILURES wrong passwords for the same e-mail within LOCKOUT_WINDOW_MINUTES, with no successful
 * sign-in in between, password sign-in for that e-mail is refused until the window has moved past them.
 *  - Counted from `login_attempts` (already written for every attempt), so it holds across app instances.
 *  - Keyed on the e-mail as typed (lower-cased), whether or not an account exists: a locked unknown e-mail behaves
 *    exactly like a locked real one, so the lock reveals nothing about which e-mails are registered.
 *  - Only password failures count. E-mail-code sign-in and password reset stay available, so a member who is
 *    locked out (or whom someone else is trying to lock out) can still get in.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { loginAttempts } from "@/server/db/schema";
import { RateLimitError } from "@/server/lib/errors";

export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_WINDOW_MINUTES = 15;
export const LOCKED_FAILURE_REASON = "ACCOUNT_LOCKED";

export async function isPasswordSignInLocked(identifier: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * 60_000);
  const rows = await db
    .select({ success: loginAttempts.success, method: loginAttempts.method, failureReason: loginAttempts.failureReason })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.identifier, identifier.toLowerCase()), gte(loginAttempts.createdAt, since)))
    .orderBy(desc(loginAttempts.createdAt))
    .limit(200);
  let failures = 0;
  for (const r of rows) {
    if (r.success) break; // a successful sign-in resets the count
    if (r.method === "PASSWORD" && r.failureReason === "INVALID_CREDENTIALS") failures++;
    if (failures >= LOCKOUT_MAX_FAILURES) return true;
  }
  return false;
}

export function lockedError(): RateLimitError {
  return new RateLimitError(
    `Too many wrong passwords for this account. Please wait ${LOCKOUT_WINDOW_MINUTES} minutes, or sign in with an e-mail code or reset your password.`
  );
}
