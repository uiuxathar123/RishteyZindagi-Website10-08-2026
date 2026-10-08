/**
 * B6: data access for `likes`, `interests`, `matches`, `shortlists`, and
 * `blocks` — all four tables were B1 schema-only foundation (see each
 * table's own comment in schema.ts) with no route/service anywhere ever
 * reading or writing them until now (re-confirmed during B5's gap-fix
 * round — see behaviour-signal.ts's file comment). This is the first
 * real business logic built on top of them.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { likes, interests, matches, shortlists, blocks, users, profiles } from "@/server/db/schema";

export type LikeRow = typeof likes.$inferSelect;
export type InterestRow = typeof interests.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type ShortlistRow = typeof shortlists.$inferSelect;
export type BlockRow = typeof blocks.$inferSelect;
export type InterestStatus = InterestRow["status"];

// --- Eligibility helper ----------------------------------------------------

export interface TargetAccountInfo {
  userId: string;
  accountStatus: string;
  profileId: string | null;
  profileStatus: string | null;
}

/** Looks up the minimal account+profile info every interaction eligibility
 * check needs, in one query — mirrors recommendations.repository.ts's
 * "one query, no N+1" discipline. */
export async function findTargetAccountInfo(userId: string): Promise<TargetAccountInfo | undefined> {
  const [row] = await db
    .select({
      userId: users.id,
      accountStatus: users.status,
      profileId: profiles.id,
      profileStatus: profiles.profileStatus,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/** Symmetric block check — `blocks` stores one directional row per block,
 * so "either direction" needs both orderings checked (same pattern as
 * recommendations.repository.ts's own `notBlocked` predicate). */
export async function isBlockedEitherDirection(userAId: string, userBId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerUserId, userAId), eq(blocks.blockedUserId, userBId)),
        and(eq(blocks.blockerUserId, userBId), eq(blocks.blockedUserId, userAId))
      )
    )
    .limit(1);
  return !!row;
}

// --- Likes -------------------------------------------------------------

export async function findLike(fromUserId: string, toUserId: string): Promise<LikeRow | undefined> {
  const [row] = await db
    .select()
    .from(likes)
    .where(and(eq(likes.fromUserId, fromUserId), eq(likes.toUserId, toUserId)))
    .limit(1);
  return row;
}

/** Idempotent create — a duplicate Like is a no-op that returns the
 * existing row (see interactions.service.ts's documented decision). */
export async function createLike(fromUserId: string, toUserId: string): Promise<LikeRow> {
  const [row] = await db
    .insert(likes)
    .values({ fromUserId, toUserId })
    .onConflictDoNothing({ target: [likes.fromUserId, likes.toUserId] })
    .returning();
  if (row) return row;
  const existing = await findLike(fromUserId, toUserId);
  return existing!;
}

/** Idempotent remove — unliking something not liked is a no-op, not an
 * error (see interactions.service.ts). */
export async function removeLike(fromUserId: string, toUserId: string): Promise<void> {
  await db.delete(likes).where(and(eq(likes.fromUserId, fromUserId), eq(likes.toUserId, toUserId)));
}

export async function listLikesSent(userId: string): Promise<LikeRow[]> {
  return db.select().from(likes).where(eq(likes.fromUserId, userId)).orderBy(desc(likes.createdAt));
}

export async function listLikesReceived(userId: string): Promise<LikeRow[]> {
  return db.select().from(likes).where(eq(likes.toUserId, userId)).orderBy(desc(likes.createdAt));
}

// --- Shortlists ----------------------------------------------------------

export async function findShortlist(userId: string, targetUserId: string): Promise<ShortlistRow | undefined> {
  const [row] = await db
    .select()
    .from(shortlists)
    .where(and(eq(shortlists.userId, userId), eq(shortlists.targetUserId, targetUserId)))
    .limit(1);
  return row;
}

export async function createShortlist(userId: string, targetUserId: string): Promise<ShortlistRow> {
  const [row] = await db
    .insert(shortlists)
    .values({ userId, targetUserId })
    .onConflictDoNothing({ target: [shortlists.userId, shortlists.targetUserId] })
    .returning();
  if (row) return row;
  const existing = await findShortlist(userId, targetUserId);
  return existing!;
}

export async function removeShortlist(userId: string, targetUserId: string): Promise<void> {
  await db.delete(shortlists).where(and(eq(shortlists.userId, userId), eq(shortlists.targetUserId, targetUserId)));
}

export async function listShortlist(userId: string): Promise<ShortlistRow[]> {
  return db.select().from(shortlists).where(eq(shortlists.userId, userId)).orderBy(desc(shortlists.createdAt));
}

// --- Interests -------------------------------------------------------------

export async function findInterestByPair(fromUserId: string, toUserId: string): Promise<InterestRow | undefined> {
  const [row] = await db
    .select()
    .from(interests)
    .where(and(eq(interests.fromUserId, fromUserId), eq(interests.toUserId, toUserId)))
    .limit(1);
  return row;
}

export async function findInterestById(id: string): Promise<InterestRow | undefined> {
  const [row] = await db.select().from(interests).where(eq(interests.id, id)).limit(1);
  return row;
}

/**
 * B10: `onConflictDoNothing` closes a genuine TOCTOU race — two
 * concurrent sendInterest() calls for the same fresh (fromUserId,
 * toUserId) pair can both pass interactions.service.ts's "no existing
 * forward row" read before either has written. Without this, the second
 * insert would hit the `interests_pair_idx` unique constraint and throw
 * a raw, uncaught Postgres error (a 500, not the clean 409 a duplicate
 * send should produce). Returns `undefined` on that race — the caller
 * re-reads the now-existing row and handles it exactly as if it had
 * been seen on the original read (see interactions.service.ts's
 * sendInterest). */
export async function createInterest(fromUserId: string, toUserId: string): Promise<InterestRow | undefined> {
  const [row] = await db
    .insert(interests)
    .values({ fromUserId, toUserId, status: "PENDING" })
    .onConflictDoNothing({ target: [interests.fromUserId, interests.toUserId] })
    .returning();
  return row;
}

/** Reuses an existing DECLINED/WITHDRAWN row for a re-send (see
 * interactions.service.ts's documented "resend after decline/withdraw"
 * decision) — the unique (fromUserId,toUserId) index means there can
 * only ever be one row per ordered pair, so a re-send updates it rather
 * than inserting a second one. */
export async function resetInterestToPending(id: string): Promise<InterestRow> {
  const [row] = await db
    .update(interests)
    .set({ status: "PENDING", createdAt: new Date(), respondedAt: null })
    .where(eq(interests.id, id))
    .returning();
  return row;
}

export async function updateInterestStatus(id: string, status: InterestStatus): Promise<InterestRow> {
  const [row] = await db
    .update(interests)
    .set({ status, respondedAt: new Date() })
    .where(eq(interests.id, id))
    .returning();
  return row;
}

export async function listInterestsSent(userId: string): Promise<InterestRow[]> {
  return db.select().from(interests).where(eq(interests.fromUserId, userId)).orderBy(desc(interests.createdAt));
}

export async function listInterestsReceived(userId: string): Promise<InterestRow[]> {
  return db.select().from(interests).where(eq(interests.toUserId, userId)).orderBy(desc(interests.createdAt));
}

// --- Matches -----------------------------------------------------------

/** Canonical ordering (lexicographically smaller uuid first) so a mutual
 * match between the same two users is always stored/looked-up as exactly
 * one row, regardless of who "caused" it — `matches` has a unique index
 * on (userAId, userBId), which only protects one ordering, so the
 * canonical-order convention is what actually enforces "at most one match
 * row per pair, ever" at the application level. */
function canonicalPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
}

export async function findMatchByPair(userId1: string, userId2: string): Promise<MatchRow | undefined> {
  const [a, b] = canonicalPair(userId1, userId2);
  const [row] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.userAId, a), eq(matches.userBId, b)))
    .limit(1);
  return row;
}

/** Idempotent — reuses an existing match row for the pair if one somehow
 * already exists (see B6 spec's "idempotent — reuse existing match" rule
 * for Interest-accept). */
export async function createMatch(userId1: string, userId2: string): Promise<MatchRow> {
  const [a, b] = canonicalPair(userId1, userId2);
  const [row] = await db
    .insert(matches)
    .values({ userAId: a, userBId: b })
    .onConflictDoNothing({ target: [matches.userAId, matches.userBId] })
    .returning();
  if (row) return row;
  const existing = await findMatchByPair(a, b);
  return existing!;
}

export async function listMatchesForUser(userId: string): Promise<MatchRow[]> {
  return db
    .select()
    .from(matches)
    .where(or(eq(matches.userAId, userId), eq(matches.userBId, userId)))
    .orderBy(desc(matches.matchedAt));
}

// --- Blocks --------------------------------------------------------------

export async function findBlock(blockerUserId: string, blockedUserId: string): Promise<BlockRow | undefined> {
  const [row] = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.blockerUserId, blockerUserId), eq(blocks.blockedUserId, blockedUserId)))
    .limit(1);
  return row;
}

export async function createBlock(blockerUserId: string, blockedUserId: string, reason: string | null): Promise<BlockRow> {
  const [row] = await db
    .insert(blocks)
    .values({ blockerUserId, blockedUserId, reason })
    .onConflictDoNothing({ target: [blocks.blockerUserId, blocks.blockedUserId] })
    .returning();
  if (row) return row;
  const existing = await findBlock(blockerUserId, blockedUserId);
  return existing!;
}

/** Idempotent — unblocking someone not blocked is a no-op. Deliberately
 * only removes the `blocks` row — per the B6 spec's "unblock restores
 * everything" rule, nothing else was ever mutated by a block (Like/
 * Interest/Shortlist history is preserved untouched throughout), so
 * removing this one row is the entire restoration. */
export async function removeBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
  await db.delete(blocks).where(and(eq(blocks.blockerUserId, blockerUserId), eq(blocks.blockedUserId, blockedUserId)));
}

export async function listBlocksByBlocker(blockerUserId: string): Promise<BlockRow[]> {
  return db.select().from(blocks).where(eq(blocks.blockerUserId, blockerUserId)).orderBy(desc(blocks.createdAt));
}

// --- Shared display-name resolution (for list response shaping) ---------

/** Batch-resolves display names for a set of user ids — used by
 * interactions.dto.ts to enrich a list response with "who is the other
 * party" without an N+1 per-row query. Never exposes anything beyond the
 * name (no profile fields) — list responses here are a lightweight index,
 * not a profile view; a client wanting the full profile follows up with
 * GET /profiles/:profileId, which already carries its own privacy rules. */
/** B16: maps user ids to their profile ids (users without a profile are
 * simply absent). Lets list views hand a client the id it needs to follow
 * up with GET /profiles/:profileId — previously interaction/chat lists
 * carried only a user id, which that endpoint cannot accept. */
export async function resolveProfileIds(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const uniqueIds = Array.from(new Set(userIds));
  const rows = await db
    .select({ userId: profiles.userId, id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.userId, uniqueIds));
  return new Map(rows.map((r) => [r.userId, r.id]));
}

export async function resolveDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const uniqueIds = Array.from(new Set(userIds));
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uniqueIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}
