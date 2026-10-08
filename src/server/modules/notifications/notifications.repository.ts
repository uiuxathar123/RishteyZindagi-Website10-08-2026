/**
 * B7: data access for `notifications` — B1 schema-only foundation (never
 * read or written by any code through B6 — reconfirmed the same way every
 * earlier phase reconfirmed its own "previously unused" tables) that B7
 * turns into a real, tested notification system.
 */
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import type { NotificationChannel } from "./providers/types";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationDeliveryStatus = NotificationRow["deliveryStatus"];
/** The full DB channel enum — includes IN_APP (never a provider channel,
 * see providers/types.ts's own note) and SMS (inherited from B1; no B7
 * notification event uses it — only OTP does, unrelated to this module). */
export type NotificationDbChannel = NotificationRow["channel"];

export interface NewNotification {
  userId: string;
  channel: NotificationDbChannel;
  title: string;
  body: string;
  dedupeKey?: string | null;
  deliveryStatus: NotificationDeliveryStatus;
  deliveredAt?: Date | null;
}

/**
 * Idempotent create — see notifications.service.ts's notify() and
 * schema.ts's dedupeKeyIdx comment. Returns `undefined` (never throws)
 * when a row with this exact dedupeKey already existed, so notify() can
 * treat that as "already sent, nothing to do" rather than an error.
 */
export async function insertNotification(data: NewNotification): Promise<NotificationRow | undefined> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: data.userId,
      channel: data.channel,
      title: data.title,
      body: data.body,
      dedupeKey: data.dedupeKey ?? null,
      deliveryStatus: data.deliveryStatus,
      deliveredAt: data.deliveredAt ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
  return row;
}

export async function updateDeliveryStatus(
  id: string,
  status: NotificationDeliveryStatus,
  failureReason: string | null
): Promise<NotificationRow | undefined> {
  // Only DELIVERED means a delivery receipt is guaranteed real (IN_APP —
  // the row's own existence). SENT (a successful provider hand-off with
  // no delivery-confirmation integration in this codebase) never sets
  // deliveredAt — see notificationStatusEnum's schema.ts comment. Built
  // as a conditional object (never an explicit `deliveredAt: undefined`
  // key) so the SET clause never touches the column for a non-DELIVERED
  // status, rather than relying on how a given drizzle-orm version
  // happens to treat an undefined-valued key.
  const patch: Partial<typeof notifications.$inferInsert> = { deliveryStatus: status, failureReason };
  if (status === "DELIVERED") patch.deliveredAt = new Date();

  const [row] = await db.update(notifications).set(patch).where(eq(notifications.id, id)).returning();
  return row;
}

export async function findById(id: string): Promise<NotificationRow | undefined> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return row;
}

export async function listForUser(userId: string, page: number, pageSize: number): Promise<{ items: NotificationRow[]; total: number }> {
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      // B13 (Performance/Scalability phase — disclosed, evidenced fix;
      // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section): same
      // pagination-drift fix as chat.repository.ts's listMessages (see
      // its doc comment for the full reasoning) — `createdAt` alone is
      // not a unique tiebreaker, so `notifications.id` is added.
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: count() }).from(notifications).where(eq(notifications.userId, userId)),
  ]);
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

export async function markRead(id: string): Promise<NotificationRow | undefined> {
  const [row] = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(notifications.id, id))
    .returning();
  return row;
}

/** Returns how many rows were actually flipped (0 if none were unread). */
export async function markAllReadForUser(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });
  return rows.length;
}

export async function countUnreadForUser(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return Number(row?.count ?? 0);
}

/**
 * Resolves the destination address for a real EMAIL/WHATSAPP provider call
 * from the user's own account fields — no separate "notification
 * settings" table (see BACKEND.md's B7 section on deliberately minimal
 * preferences).
 *
 * B11: PUSH is no longer resolved here — a user can have multiple
 * registered devices, so a single string destination doesn't fit; see
 * notifications.service.ts's `notifyInternal`, which addresses PUSH
 * directly from `device_push_tokens` (push-tokens.repository.ts's
 * `listActiveTokensForUser`) instead. This function is never called with
 * channel:"PUSH" any more (kept as a defensive `return ""` below only in
 * case a future caller does, mirroring every other channel's
 * empty-is-honest contract rather than throwing on an unreachable branch).
 */
export async function resolveDestination(userId: string, channel: NotificationChannel): Promise<string> {
  const [user] = await db
    .select({ email: users.email, mobileNumber: users.mobileNumber, countryCode: users.countryCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return "";
  if (channel === "EMAIL") return user.email;
  if (channel === "WHATSAPP") return `${user.countryCode}${user.mobileNumber}`;
  return "";
}
