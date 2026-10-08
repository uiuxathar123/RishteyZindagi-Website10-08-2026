/**
 * PCP: admin moderation — suspend, ban (block), unban, and a combined view.
 * (Warnings and "lift suspension" already exist as frozen B6 endpoints and are
 * reused by the admin UI: POST /admin/users/:id/warnings, POST
 * /admin/users/:id/lift-suspension.)
 *
 * Rules
 *  - A reason (min 5 chars) is mandatory for suspend, ban and unban and is stored
 *    on the moderation row and in the audit entry.
 *  - Permissions: suspend → `users.suspend` (existing); ban/unban → `users.ban`
 *    (new, SUPER_ADMIN only by default); view → `users.view`.
 *  - Status changes are conditional UPDATEs, so two admins acting at once cannot
 *    both succeed and a deleted/pending-deletion account can never be moderated
 *    back to life.
 *  - Suspension reuses `account_suspensions` (so the frozen "lift" endpoint and the
 *    automatic report-threshold suspension keep working unchanged); a ban uses
 *    `account_bans`. A ban supersedes an active suspension (the suspension row is
 *    closed) and "exactly one of ACTIVE / SUSPENDED / BLOCKED" always holds because
 *    it is the single `users.status` column.
 *  - Enforcement is structural: `authenticate()` rejects every non-ACTIVE member and
 *    login refuses them, so a suspended or banned member cannot reach ANY protected
 *    feature. Every active session is revoked at the moment of action.
 *  - Staff cannot act on admin accounts here (members only).
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { accountBans, accountSuspensions, users, warnings } from "@/server/db/schema";
import { ConflictError, NotFoundError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { revokeUserPushTokens, revokeUserSessions } from "@/server/modules/account/sessions";

type Meta = { ipAddress?: string | null; userAgent?: string | null };

export async function suspendUser(ctx: AuthContext, userId: string, reason: string, meta: Meta) {
  await requirePermission(ctx, "users.suspend");
  await requireExists(userId);
  const now = new Date();
  const sessions = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ status: "SUSPENDED", updatedAt: now })
      .where(and(eq(users.id, userId), eq(users.status, "ACTIVE")))
      .returning({ id: users.id });
    if (!row) throw new ConflictError("Only an active account can be suspended.");
    await tx.insert(accountSuspensions).values({ userId, reason: `Admin suspension: ${reason}` }).onConflictDoNothing();
    return revokeUserSessions(userId, tx);
  });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "account.suspended_by_admin",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { reason, sessionsRevoked: sessions },
  });
  return getModerationView(ctx, userId, false);
}

export async function banUser(ctx: AuthContext, userId: string, reason: string, meta: Meta) {
  await requirePermission(ctx, "users.ban");
  await requireExists(userId);
  const now = new Date();
  const sessions = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ status: "BLOCKED", updatedAt: now })
      .where(and(eq(users.id, userId), inArray(users.status, ["ACTIVE", "SUSPENDED"])))
      .returning({ id: users.id });
    if (!row) throw new ConflictError("Only an active or suspended account can be banned.");
    // A ban supersedes any open suspension.
    await tx
      .update(accountSuspensions)
      .set({ liftedAt: now, liftedByAdminId: ctx.subject.id })
      .where(and(eq(accountSuspensions.userId, userId), isNull(accountSuspensions.liftedAt)));
    await tx.insert(accountBans).values({ userId, reason, bannedByAdminId: ctx.subject.id }).onConflictDoNothing();
    await revokeUserPushTokens(userId, tx);
    return revokeUserSessions(userId, tx);
  });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "account.banned",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { reason, sessionsRevoked: sessions },
  });
  return getModerationView(ctx, userId, false);
}

export async function unbanUser(ctx: AuthContext, userId: string, reason: string, meta: Meta) {
  await requirePermission(ctx, "users.ban");
  await requireExists(userId);
  const now = new Date();
  await db.transaction(async (tx) => {
    const [ban] = await tx
      .update(accountBans)
      .set({ liftedAt: now, liftedByAdminId: ctx.subject.id, liftReason: reason })
      .where(and(eq(accountBans.userId, userId), isNull(accountBans.liftedAt)))
      .returning({ id: accountBans.id });
    if (!ban) throw new ConflictError("This account does not have an active ban.");
    await tx.update(users).set({ status: "ACTIVE", updatedAt: now }).where(and(eq(users.id, userId), eq(users.status, "BLOCKED")));
  });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "account.unbanned",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { reason },
  });
  return getModerationView(ctx, userId, false);
}

export async function getModerationView(ctx: AuthContext, userId: string, checkPermission = true) {
  if (checkPermission) await requirePermission(ctx, "users.view");
  const [user] = await db.select({ id: users.id, name: users.name, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new NotFoundError("User not found.");
  const [suspensions, bans, warns] = await Promise.all([
    db.select().from(accountSuspensions).where(eq(accountSuspensions.userId, userId)).orderBy(desc(accountSuspensions.suspendedAt)).limit(20),
    db.select().from(accountBans).where(eq(accountBans.userId, userId)).orderBy(desc(accountBans.bannedAt)).limit(20),
    db.select({ id: warnings.id, message: warnings.message, createdAt: warnings.createdAt, acknowledgedAt: warnings.acknowledgedAt }).from(warnings).where(eq(warnings.userId, userId)).orderBy(desc(warnings.createdAt)).limit(20),
  ]);
  return {
    userId: user.id,
    name: user.name,
    status: user.status,
    activeSuspension: suspensions.find((s) => !s.liftedAt) ?? null,
    activeBan: bans.find((b) => !b.liftedAt) ?? null,
    suspensions,
    bans,
    warnings: warns,
  };
}

async function requireExists(userId: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new NotFoundError("User not found.");
}
