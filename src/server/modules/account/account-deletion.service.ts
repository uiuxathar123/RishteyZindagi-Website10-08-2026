/**
 * PCP: member account deletion with a recovery window.
 *
 * State machine (reuses the frozen `account_status` values and `users.deleted_at`):
 *
 *   ACTIVE ──(owner: password + typed confirmation)──▶ DELETED_PENDING (deleted_at = now)
 *   DELETED_PENDING ──(owner: password + e-mail OTP, within window)──▶ ACTIVE (deleted_at = NULL)
 *   DELETED_PENDING ──(window elapsed; `account-deletion-finalize` job)──▶ DELETED (anonymised)
 *
 * Security properties
 *  - Request: authenticated member only (a bearer session proves the owner), plus the
 *    current password and an exact typed confirmation → a stolen idle session alone
 *    cannot delete the account. The id comes from the session, never from the body
 *    (no IDOR surface). Only ACTIVE accounts can request (a suspended/banned account
 *    cannot dodge moderation by deleting itself).
 *  - On request: every session and push token is revoked in the same transaction;
 *    `authenticate()` already refuses non-ACTIVE users, and login refuses them, so a
 *    DELETED_PENDING / DELETED account cannot authenticate. Search/recommendations
 *    already require status ACTIVE, so the profile disappears immediately.
 *  - Recovery: only the owner can recover — it needs the e-mail address, the account
 *    password and a one-time code delivered to the account's own contact. Responses
 *    to the request step are identical for unknown / wrong-password / expired
 *    accounts (no enumeration). Admins can SEE pending deletions but deliberately
 *    cannot restore an account on the owner's behalf.
 *  - Window: ACCOUNT_RECOVERY_WINDOW_DAYS (default 30). After it the account can no
 *    longer be recovered and the finalise job anonymises the row and removes photos.
 *  - Every transition writes an audit_logs entry and a recovery_logs row.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { devicePushTokens, memberships, profilePhotos, profiles, recoveryLogs, users } from "@/server/db/schema";
import { getEnv } from "@/server/config/env";
import { AuthenticationError, AuthorizationError, ConflictError, ValidationError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { randomBytes } from "crypto";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import { record } from "@/server/modules/audit/audit.service";
import * as otpService from "@/server/modules/otp/otp.service";
import { getStorageProvider } from "@/server/modules/storage/factory";
import { requirePermission } from "@/server/middleware/rbac";
import type { AuthContext } from "@/server/middleware/authenticate";
import { revokeUserPushTokens, revokeUserSessions } from "./sessions";

export const DELETE_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";
const DEFAULT_WINDOW_DAYS = 30;
// Same fixed bcrypt hash the login flow uses so a missing account costs the same time as a wrong password.
const DUMMY_PASSWORD_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8O9mVeNVCXvEmNXfWFXDLYW.dg7CJ.";

type Meta = { ipAddress?: string | null; userAgent?: string | null };

export function recoveryWindowDays(): number {
  return getEnv().ACCOUNT_RECOVERY_WINDOW_DAYS ?? DEFAULT_WINDOW_DAYS;
}
function windowMs(): number {
  return recoveryWindowDays() * 24 * 60 * 60 * 1000;
}
export function recoverUntil(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + windowMs());
}

// ---------------------------------------------------------------------------
// Member: request deletion
// ---------------------------------------------------------------------------

export interface DeletionRequestInput {
  password: string;
  confirmation: string;
}

export async function requestAccountDeletion(ctx: AuthContext, input: DeletionRequestInput, meta: Meta) {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  if (input.confirmation !== DELETE_CONFIRMATION_PHRASE) {
    throw new ValidationError(`Type "${DELETE_CONFIRMATION_PHRASE}" exactly to confirm.`);
  }
  const userId = ctx.subject.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AuthenticationError("Invalid or expired session.");
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await record({ actorType: "USER", actorId: userId, action: "account.deletion_password_mismatch", entityType: "user", entityId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
    // 403, not 401: the session is valid, only the re-authentication failed. A 401 makes the BFF discard the session cookie.
    throw new AuthorizationError("The password is incorrect.");
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    // Conditional update: only an ACTIVE account can enter DELETED_PENDING (and only once).
    const [row] = await tx
      .update(users)
      .set({ status: "DELETED_PENDING", deletedAt: now, updatedAt: now })
      .where(and(eq(users.id, userId), eq(users.status, "ACTIVE")))
      .returning({ id: users.id });
    if (!row) throw new ConflictError("This account cannot be deleted in its current state.");
    const sessions = await revokeUserSessions(userId, tx);
    await revokeUserPushTokens(userId, tx);
    // Stop any renewal from charging an account that is being deleted.
    await tx.update(memberships).set({ autoRenew: false }).where(and(eq(memberships.userId, userId), eq(memberships.autoRenew, true)));
    await tx.insert(recoveryLogs).values({ userId, action: "DELETION_REQUESTED", notes: `Recoverable for ${recoveryWindowDays()} days.` });
    return { sessions };
  });

  await record({
    actorType: "USER",
    actorId: userId,
    action: "account.deletion_requested",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { sessionsRevoked: result.sessions, recoverUntil: recoverUntil(now).toISOString() },
  });
  return { status: "DELETED_PENDING" as const, deletedAt: now.toISOString(), recoverUntil: recoverUntil(now).toISOString(), recoveryWindowDays: recoveryWindowDays() };
}

// ---------------------------------------------------------------------------
// Owner: recover
// ---------------------------------------------------------------------------

/**
 * Step 1. Always answers with the same shape. A code is only sent when the e-mail
 * belongs to a DELETED_PENDING account inside its window AND the password is correct.
 */
export async function requestAccountRecovery(input: { email: string; password: string }, meta: Meta) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  const valid = await verifyPassword(input.password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);
  const eligible = Boolean(user && valid && user.status === "DELETED_PENDING" && user.deletedAt && recoverUntil(user.deletedAt).getTime() > Date.now());

  if (eligible && user) {
    const result = await otpService.requestOtp({ identifier: input.email, purpose: "ACCOUNT_RECOVERY", userId: user.id, meta });
    await record({ actorType: "USER", actorId: user.id, action: "account.recovery_requested", entityType: "user", entityId: user.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
    return { channel: result.channel, expiresInSeconds: result.expiresInSeconds, resendAvailableAt: result.resendAvailableAt };
  }
  const defaults = await otpService.getPublicOtpDefaults();
  return {
    channel: defaults.channel,
    expiresInSeconds: defaults.expiresInSeconds,
    resendAvailableAt: new Date(Date.now() + defaults.resendCooldownSeconds * 1000).toISOString(),
  };
}

/** Step 2. Verifies the OTP and restores the account; the owner then signs in normally. */
export async function confirmAccountRecovery(input: { email: string; code: string }, meta: Meta) {
  const verified = await otpService.verifyOtpDirect(input.email, "ACCOUNT_RECOVERY", input.code);
  const userId = verified.userId;
  const generic = () => new AuthenticationError("Invalid or expired code.");
  if (!userId) throw generic();

  const cutoff = new Date(Date.now() - windowMs());
  const [restored] = await db
    .update(users)
    .set({ status: "ACTIVE", deletedAt: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.email, input.email), eq(users.status, "DELETED_PENDING"), sql`${users.deletedAt} > ${cutoff}`))
    .returning({ id: users.id });
  if (!restored) throw generic();

  await db.insert(recoveryLogs).values({ userId, action: "ACCOUNT_RECOVERED", notes: "Recovered by the account owner (password + e-mail OTP)." });
  await record({ actorType: "USER", actorId: userId, action: "account.recovered", entityType: "user", entityId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  return { recovered: true as const };
}

// ---------------------------------------------------------------------------
// Admin: visibility (read-only)
// ---------------------------------------------------------------------------

export async function listAccountDeletionsForAdmin(ctx: AuthContext, input: { state?: "PENDING" | "FINALIZED"; page?: number; pageSize?: number }) {
  await requirePermission(ctx, "users.view");
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? 20, 50);
  const statuses = input.state === "PENDING" ? (["DELETED_PENDING"] as const) : input.state === "FINALIZED" ? (["DELETED"] as const) : (["DELETED_PENDING", "DELETED"] as const);
  const where = inArray(users.status, [...statuses]);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(where);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(where)
    .orderBy(desc(users.deletedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const now = Date.now();
  return {
    recoveryWindowDays: recoveryWindowDays(),
    items: rows.map((r) => {
      const until = r.deletedAt ? recoverUntil(r.deletedAt) : null;
      return {
        userId: r.id,
        name: r.name,
        email: r.status === "DELETED_PENDING" ? maskEmail(r.email) : null,
        state: r.status === "DELETED_PENDING" ? ("PENDING" as const) : ("FINALIZED" as const),
        requestedAt: r.deletedAt?.toISOString() ?? null,
        recoverUntil: until?.toISOString() ?? null,
        daysLeft: r.status === "DELETED_PENDING" && until ? Math.max(0, Math.ceil((until.getTime() - now) / 86_400_000)) : 0,
      };
    }),
    page,
    pageSize,
    total: n,
    totalPages: Math.max(1, Math.ceil(n / pageSize)),
  };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain ?? ""}`;
}

// ---------------------------------------------------------------------------
// Job: finalise expired deletions
// ---------------------------------------------------------------------------

/** Anonymises every DELETED_PENDING account whose window elapsed. Idempotent; each account is its own transaction. */
export async function finalizeExpiredDeletions(limit = 200): Promise<{ finalized: number; failed: number; photosRemoved: number }> {
  const cutoff = new Date(Date.now() - windowMs());
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, "DELETED_PENDING"), lt(users.deletedAt, cutoff)))
    .limit(limit);

  let finalized = 0;
  let failed = 0;
  let photosRemoved = 0;
  for (const { id } of due) {
    try {
      const keys: string[] = [];
      const done = await db.transaction(async (tx) => {
        const [still] = await tx
          .update(users)
          .set({
            status: "DELETED",
            name: "Deleted member",
            email: `deleted+${id}@deleted.invalid`,
            mobileNumber: `deleted-${id}`,
            passwordHash: await hashPassword(randomBytes(32).toString("hex")),
            city: null,
            country: null,
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, id), eq(users.status, "DELETED_PENDING"), lt(users.deletedAt, cutoff)))
          .returning({ id: users.id });
        if (!still) return false;
        const [profile] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, id));
        if (profile) {
          await tx.update(profiles).set({ aboutMe: null }).where(eq(profiles.id, profile.id));
          const photos = await tx.select({ key: profilePhotos.storageKey }).from(profilePhotos).where(eq(profilePhotos.profileId, profile.id));
          for (const p of photos) if (p.key) keys.push(p.key);
          await tx.delete(profilePhotos).where(eq(profilePhotos.profileId, profile.id));
        }
        await tx.delete(devicePushTokens).where(eq(devicePushTokens.userId, id));
        await revokeUserSessions(id, tx);
        await tx.insert(recoveryLogs).values({ userId: id, action: "DELETION_FINALIZED", notes: "Recovery window elapsed; personal data anonymised." });
        return true;
      });
      if (!done) continue;
      // Files are removed after the commit; a failure here leaves an orphan file, never a dangling reference.
      for (const key of keys) {
        try {
          await getStorageProvider().delete(key);
          photosRemoved += 1;
        } catch (err) {
          logError("account-deletion-photo-delete-failed", err, { userId: id });
        }
      }
      await record({ actorType: "SYSTEM", action: "account.deletion_finalized", entityType: "user", entityId: id, metadata: { photosRemoved: keys.length } });
      finalized += 1;
    } catch (err) {
      failed += 1;
      logError("account-deletion-finalize-failed", err, { userId: id });
    }
  }
  return { finalized, failed, photosRemoved };
}
