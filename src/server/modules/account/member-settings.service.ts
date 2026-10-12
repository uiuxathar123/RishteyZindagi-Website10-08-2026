/**
 * B18: member self-service settings — privacy controls, notification channel preferences and
 * active-session management. Every function acts on the SIGNED-IN member only (the subject comes
 * from the session, never from a client-supplied id), and every change is audited.
 */
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { deviceSessions, profiles, users } from "@/server/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { record } from "@/server/modules/audit/audit.service";
import { revokeUserPushTokens } from "./sessions";

interface Meta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

function memberId(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  return ctx.subject.id;
}

// --- Privacy -----------------------------------------------------------------

export interface PrivacySettings {
  profileVisibility: "VISIBLE" | "HIDDEN";
  photoVisibility: "MEMBERS" | "ACCEPTED_ONLY";
  showLastActive: boolean;
}

function toPrivacy(p: typeof profiles.$inferSelect): PrivacySettings {
  return {
    profileVisibility: p.profileVisibility as PrivacySettings["profileVisibility"],
    photoVisibility: p.photoVisibility as PrivacySettings["photoVisibility"],
    showLastActive: p.showLastActive,
  };
}

async function ownProfile(userId: string) {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) throw new NotFoundError("Create your profile first — privacy settings apply to your profile.");
  return p;
}

export async function getPrivacy(ctx: AuthContext): Promise<PrivacySettings> {
  return toPrivacy(await ownProfile(memberId(ctx)));
}

export async function updatePrivacy(ctx: AuthContext, input: Partial<PrivacySettings>, meta: Meta): Promise<PrivacySettings> {
  const userId = memberId(ctx);
  const before = await ownProfile(userId);
  const patch: Partial<typeof profiles.$inferInsert> = {};
  if (input.profileVisibility !== undefined) patch.profileVisibility = input.profileVisibility;
  if (input.photoVisibility !== undefined) patch.photoVisibility = input.photoVisibility;
  if (input.showLastActive !== undefined) patch.showLastActive = input.showLastActive;
  // Deliberately NOT touching profiles.updatedAt: search "recently updated" ordering must not be
  // gamed (or perturbed) by flipping a privacy switch.
  const [after] = await db.update(profiles).set(patch).where(eq(profiles.id, before.id)).returning();
  await record({
    actorType: "USER",
    actorId: userId,
    action: "privacy.updated",
    entityType: "profile",
    entityId: before.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { before: toPrivacy(before), after: toPrivacy(after) },
  });
  return toPrivacy(after);
}

// --- Notification preferences --------------------------------------------------

export interface NotificationPreferences {
  EMAIL: boolean;
  PUSH: boolean;
  WHATSAPP: boolean;
  /** Weekly summary e-mail. Opt-in: a member who never touched the setting does not get one. */
  DIGEST: boolean;
}

function toPrefs(raw: unknown): NotificationPreferences {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { EMAIL: r.EMAIL !== false, PUSH: r.PUSH !== false, WHATSAPP: r.WHATSAPP !== false, DIGEST: r.DIGEST === true };
}

export async function getNotificationPreferences(ctx: AuthContext): Promise<NotificationPreferences> {
  const userId = memberId(ctx);
  const [row] = await db.select({ p: users.notificationPreferences }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new NotFoundError("User not found.");
  return toPrefs(row.p);
}

export async function updateNotificationPreferences(ctx: AuthContext, input: Partial<NotificationPreferences>, meta: Meta): Promise<NotificationPreferences> {
  const userId = memberId(ctx);
  const before = await getNotificationPreferences(ctx);
  const after: NotificationPreferences = { ...before, ...input };
  await db.update(users).set({ notificationPreferences: after, updatedAt: new Date() }).where(eq(users.id, userId));
  await record({
    actorType: "USER",
    actorId: userId,
    action: "notification_preferences.updated",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { before, after },
  });
  return after;
}

// --- Sessions --------------------------------------------------------------------

export interface MemberSessionRow {
  id: string;
  deviceId: string | null;
  browserInfo: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

export async function listMySessions(ctx: AuthContext): Promise<MemberSessionRow[]> {
  const userId = memberId(ctx);
  const rows = await db
    .select()
    .from(deviceSessions)
    .where(and(eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt), gt(deviceSessions.expiresAt, new Date())))
    .orderBy(desc(deviceSessions.lastSeenAt));
  return rows.map((s) => ({
    id: s.id,
    deviceId: s.deviceId ? `${s.deviceId.slice(0, 6)}…` : null, // never echo the full device identifier
    browserInfo: s.browserInfo,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastSeenAt?.toISOString() ?? null,
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === ctx.sessionId,
  }));
}

export async function revokeMySession(ctx: AuthContext, sessionId: string, meta: Meta): Promise<{ revoked: true }> {
  const userId = memberId(ctx);
  if (sessionId === ctx.sessionId) throw new ConflictError("This is the device you are using now — use Sign out instead.");
  const rows = await db
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    // userId in the predicate: another member's session id is indistinguishable from a missing one
    .where(and(eq(deviceSessions.id, sessionId), eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt)))
    .returning({ id: deviceSessions.id });
  if (rows.length === 0) throw new NotFoundError("Session not found.");
  await record({ actorType: "USER", actorId: userId, action: "session.revoked", entityType: "device_session", entityId: sessionId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { scope: "single" } });
  return { revoked: true };
}

export async function revokeOtherSessions(ctx: AuthContext, meta: Meta): Promise<{ revokedCount: number }> {
  const userId = memberId(ctx);
  const rows = await db
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt), ne(deviceSessions.id, ctx.sessionId)))
    .returning({ id: deviceSessions.id });
  if (rows.length > 0) await revokeUserPushTokens(userId); // other devices must stop receiving pushes too
  await record({ actorType: "USER", actorId: userId, action: "session.revoked_others", entityType: "user", entityId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { scope: "others", count: rows.length } });
  return { revokedCount: rows.length };
}
