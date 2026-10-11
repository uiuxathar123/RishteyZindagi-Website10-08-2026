/**
 * B7: data access for `chats`, `chat_participants`, and `messages` — B1
 * schema-only foundation (never read or written by any code through B6)
 * that B7 turns into a real, tested chat system.
 *
 * "One chat per match" is enforced at the database level via
 * `chats.matchId`'s unique index (see schema.ts's comment on that
 * column) — `createChatForMatch` below is the same idempotent
 * `onConflictDoNothing` + re-select idiom `interactions.repository.ts`
 * already uses for `createMatch`/`createLike`/`createShortlist`/
 * `createBlock`, not a new pattern.
 */
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { chats, chatParticipants, messages } from "@/server/db/schema";

export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

// --- Chat creation / lookup -------------------------------------------------

export async function findChatByMatchId(matchId: string): Promise<ChatRow | undefined> {
  const [row] = await db.select().from(chats).where(eq(chats.matchId, matchId)).limit(1);
  return row;
}

export async function findChatById(chatId: string): Promise<ChatRow | undefined> {
  const [row] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
  return row;
}

/**
 * Idempotent, race-safe get-or-create: within one transaction, attempts to
 * insert a `chats` row for this match (no-op if one already exists, via
 * the unique index on `matchId`), and — only on a genuine first creation —
 * inserts both participant rows in the same transaction, so no other
 * connection can ever observe a chat with zero or one participant.
 */
export async function createChatForMatch(matchId: string, userAId: string, userBId: string): Promise<{ chat: ChatRow; created: boolean }> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(chats).values({ matchId }).onConflictDoNothing({ target: chats.matchId }).returning();
    if (inserted) {
      await tx.insert(chatParticipants).values([
        { chatId: inserted.id, userId: userAId },
        { chatId: inserted.id, userId: userBId },
      ]);
      return { chat: inserted, created: true };
    }
    const [existing] = await tx.select().from(chats).where(eq(chats.matchId, matchId)).limit(1);
    return { chat: existing!, created: false };
  });
}

// --- Participants ------------------------------------------------------------

export async function isParticipant(chatId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.userId, userId)))
    .limit(1);
  return !!row;
}

/** The OTHER participant in a (by construction, always-two-party) chat —
 * used for block checks and notification recipient resolution. */
export async function getOtherParticipant(chatId: string, userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.chatId, chatId), ne(chatParticipants.userId, userId)))
    .limit(1);
  return row?.userId;
}

/** All chat ids this user participates in — the base set every "list my
 * chats" / unread-count query starts from. */
export async function listChatIdsForUser(userId: string): Promise<string[]> {
  const rows = await db.select({ chatId: chatParticipants.chatId }).from(chatParticipants).where(eq(chatParticipants.userId, userId));
  return rows.map((r) => r.chatId);
}

export interface ChatSummaryRaw {
  chat: ChatRow;
  counterpartUserId: string | undefined;
  unreadCount: number;
}

/**
 * "List my chats" — every query here is batched by the caller's full
 * chatId set (no N+1 per chat), matching this codebase's established
 * "one query, no N+1" discipline (see recommendations.repository.ts /
 * interactions.repository.ts's own comments on the same principle).
 */
export async function listMyChatSummaries(userId: string): Promise<ChatSummaryRaw[]> {
  const chatIds = await listChatIdsForUser(userId);
  if (chatIds.length === 0) return [];

  const [chatRows, counterpartRows, unreadRows] = await Promise.all([
    db.select().from(chats).where(inArray(chats.id, chatIds)).orderBy(desc(chats.lastMessageAt), desc(chats.createdAt)),
    db
      .select({ chatId: chatParticipants.chatId, userId: chatParticipants.userId })
      .from(chatParticipants)
      .where(and(inArray(chatParticipants.chatId, chatIds), ne(chatParticipants.userId, userId))),
    db
      .select({ chatId: messages.chatId, cnt: count() })
      .from(messages)
      .where(and(inArray(messages.chatId, chatIds), ne(messages.senderUserId, userId), isNull(messages.readAt)))
      .groupBy(messages.chatId),
  ]);

  const counterpartMap = new Map(counterpartRows.map((r) => [r.chatId, r.userId]));
  const unreadMap = new Map(unreadRows.map((r) => [r.chatId, Number(r.cnt)]));

  return chatRows.map((chat) => ({
    chat,
    counterpartUserId: counterpartMap.get(chat.id),
    unreadCount: unreadMap.get(chat.id) ?? 0,
  }));
}

// --- Messages ------------------------------------------------------------

export async function insertMessage(chatId: string, senderUserId: string, body: string): Promise<MessageRow> {
  const [row] = await db.insert(messages).values({ chatId, senderUserId, body }).returning();
  return row;
}

export async function touchLastMessageAt(chatId: string, at: Date): Promise<void> {
  await db.update(chats).set({ lastMessageAt: at }).where(eq(chats.id, chatId));
}

/**
 * Newest-first pagination (see chat.service.ts's documented ordering
 * choice — page 1 is always the most recent page of the conversation,
 * matching every other list endpoint in this codebase's `desc` convention
 * for a timestamp field).
 */
export async function listMessages(chatId: string, page: number, pageSize: number): Promise<{ items: MessageRow[]; total: number }> {
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      // B13 (Performance/Scalability phase — disclosed, evidenced fix;
      // see PERFORMANCE_REPORT.md / BACKEND.md's B13 section): `sentAt`
      // alone is not a unique tiebreaker — two messages can share the
      // exact same timestamp (millisecond-precision `timestamptz`, real
      // under bulk-send/import or simply fast typing), and without a
      // second, always-unique sort key, Postgres is free to return those
      // rows in different relative orders across two calls with the same
      // WHERE clause, which is exactly what causes page-to-page drift
      // (a message skipped or repeated across page 1/2). `messages.id`
      // (uuid, unique, immutable) is added as the tiebreaker — no other
      // list endpoint in this file changes; `total`'s own count query is
      // unaffected. See tests/performance-pagination-stability.test.ts.
      .orderBy(desc(messages.sentAt), desc(messages.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: count() }).from(messages).where(eq(messages.chatId, chatId)),
  ]);
  return { items, total: Number(countRows[0]?.count ?? 0) };
}

/** Sets `readAt` on every unread message in this chat NOT sent by
 * `userId` — i.e. "mark the messages I received as read". Returns how
 * many rows were actually flipped. No schema change (no per-participant
 * "last read" cursor column) — see BACKEND.md's B7 section for why the
 * per-message `readAt` walk was kept over adding one. */
export async function markChatReadForUser(chatId: string, userId: string): Promise<number> {
  const rows = await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.chatId, chatId), ne(messages.senderUserId, userId), isNull(messages.readAt)))
    .returning({ id: messages.id });
  return rows.length;
}

/** Total unread count across every chat this user participates in —
 * batched (one query against the user's full chatId set), not per-chat. */
export async function countUnreadForUser(userId: string): Promise<number> {
  const chatIds = await listChatIdsForUser(userId);
  if (chatIds.length === 0) return 0;
  const [row] = await db
    .select({ count: count() })
    .from(messages)
    .where(and(inArray(messages.chatId, chatIds), ne(messages.senderUserId, userId), isNull(messages.readAt)));
  return Number(row?.count ?? 0);
}

// --- B19: live stream cursors ---------------------------------------------------

export async function messageExistsInChat(chatId: string, messageId: string): Promise<boolean> {
  const [row] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.chatId, chatId), eq(messages.id, messageId))).limit(1);
  return !!row;
}

export async function latestMessageId(chatId: string): Promise<string | null> {
  const [row] = await db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId)).orderBy(desc(messages.sentAt), desc(messages.id)).limit(1);
  return row?.id ?? null;
}

/** Messages strictly after `afterId` in (sent_at, id) order. The comparison runs inside Postgres so the microsecond
 * part of `sent_at` (which a JS Date cannot hold) can never cause a duplicate or a skipped message. */
export async function messagesAfterId(chatId: string, afterId: string, limit: number): Promise<MessageRow[]> {
  const res = await db.execute(sql`
    SELECT m.* FROM messages m
    WHERE m.chat_id = ${chatId}
      AND (m.sent_at, m.id) > (SELECT a.sent_at, a.id FROM messages a WHERE a.id = ${afterId} AND a.chat_id = ${chatId})
    ORDER BY m.sent_at ASC, m.id ASC
    LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map(rowToMessage);
}

/** For a chat with no messages yet at connect time: everything created at/after the database clock reading taken at connect. */
export async function messagesSinceDbTime(chatId: string, sinceIso: string, limit: number): Promise<MessageRow[]> {
  const res = await db.execute(sql`
    SELECT m.* FROM messages m WHERE m.chat_id = ${chatId} AND m.sent_at >= ${sinceIso}::timestamptz
    ORDER BY m.sent_at ASC, m.id ASC LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map(rowToMessage);
}

export async function dbNowIso(): Promise<string> {
  const res = await db.execute(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t`);
  return String((res.rows[0] as { t: string }).t);
}

function rowToMessage(r: Record<string, unknown>): MessageRow {
  const d = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
  return {
    id: String(r.id),
    chatId: String(r.chat_id),
    senderUserId: String(r.sender_user_id),
    body: String(r.body),
    sentAt: d(r.sent_at) as Date,
    readAt: d(r.read_at),
  };
}
