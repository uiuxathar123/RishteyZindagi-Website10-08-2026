/**
 * B11: data access for `device_push_tokens` — see schema.ts's own comment
 * block for why this is a separate table from `device_sessions`. Same shape
 * as every other module's repository: thin, typed wrappers around Drizzle,
 * no business rules here (those live in push-tokens.service.ts).
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { devicePushTokens } from "@/server/db/schema";

export type PushTokenRow = typeof devicePushTokens.$inferSelect;
export type PushPlatform = PushTokenRow["platform"];

/**
 * Idempotent upsert-by-token: registering the same token twice (a refresh,
 * an app restart, the OS re-issuing the same token) updates the existing
 * row in place rather than creating a duplicate — `token` is unique across
 * the whole table (see schema.ts), so this is a single atomic
 * `INSERT ... ON CONFLICT (token) DO UPDATE`.
 *
 * Deliberately reassigns `userId`/`platform` and un-revokes
 * (`revokedAt: null`) on every call, not just `lastSeenAt`: a physical
 * device's push token can legitimately move to a different account (logout,
 * different family member logs in on the same phone) or be re-registered
 * after the caller previously revoked it — both are ordinary "this token is
 * live again, owned by whoever is registering it now" events, not errors.
 */
export async function upsertToken(userId: string, token: string, platform: PushPlatform): Promise<PushTokenRow> {
  const now = new Date();
  const [row] = await db
    .insert(devicePushTokens)
    .values({ userId, token, platform, registeredAt: now, lastSeenAt: now, revokedAt: null })
    .onConflictDoUpdate({
      target: devicePushTokens.token,
      set: { userId, platform, lastSeenAt: now, revokedAt: null },
    })
    .returning();
  return row;
}

export async function findById(id: string): Promise<PushTokenRow | undefined> {
  const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.id, id)).limit(1);
  return row;
}

export async function findByToken(token: string): Promise<PushTokenRow | undefined> {
  const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, token)).limit(1);
  return row;
}

/** Lists a user's currently-live (non-revoked) registered devices, most
 * recently seen first. */
export async function listActiveForUser(userId: string): Promise<PushTokenRow[]> {
  return db
    .select()
    .from(devicePushTokens)
    .where(and(eq(devicePushTokens.userId, userId), isNull(devicePushTokens.revokedAt)))
    .orderBy(devicePushTokens.lastSeenAt);
}

/** Raw token strings for every currently-live device of this user — the
 * addressing lookup notifications.service.ts's notify() uses for the PUSH
 * channel (see that file's own doc comment for how this replaces the old
 * "no destination address" no-op). */
export async function listActiveTokensForUser(userId: string): Promise<string[]> {
  const rows = await listActiveForUser(userId);
  return rows.map((r) => r.token);
}

export async function markRevoked(id: string): Promise<PushTokenRow | undefined> {
  const [row] = await db
    .update(devicePushTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(devicePushTokens.id, id), isNull(devicePushTokens.revokedAt)))
    .returning();
  return row;
}
