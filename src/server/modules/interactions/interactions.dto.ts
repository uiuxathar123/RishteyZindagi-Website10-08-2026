/**
 * B6: response shaping for interactions list endpoints. A deliberately
 * lightweight "index" shape (id, timestamps, status, counterpart name) —
 * not a full profile view. A client wanting the counterpart's full
 * profile follows up with GET /profiles/:profileId (B3), which carries
 * its own privacy rules; duplicating that here would be a second privacy
 * surface to keep in sync.
 */
import * as repo from "./interactions.repository";
import type { InterestRow, LikeRow, ShortlistRow, BlockRow, MatchRow } from "./interactions.repository";

export interface CounterpartRef {
  userId: string;
  name: string | null;
  /** B16: the counterpart's profile id (null if they have no profile) —
   * the id GET /profiles/:profileId needs. Additive; `userId` is unchanged. */
  profileId: string | null;
}

export interface InterestView {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: InterestRow["status"];
  createdAt: string;
  respondedAt: string | null;
  counterpart: CounterpartRef;
}

export interface LikeView {
  id: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
  counterpart: CounterpartRef;
}

export interface ShortlistView {
  id: string;
  userId: string;
  targetUserId: string;
  createdAt: string;
  counterpart: CounterpartRef;
}

export interface BlockView {
  id: string;
  blockerUserId: string;
  blockedUserId: string;
  reason: string | null;
  createdAt: string;
  counterpart: CounterpartRef;
}

export interface MatchView {
  id: string;
  matchedAt: string;
  counterpart: CounterpartRef;
}

/** Resolves display names and profile ids for a set of counterpart user
 * ids in one pass and returns a ready-made CounterpartRef per user id. */
async function refs(ids: string[]): Promise<(userId: string) => CounterpartRef> {
  const [nameMap, profileMap] = await Promise.all([repo.resolveDisplayNames(ids), repo.resolveProfileIds(ids)]);
  return (userId) => ({ userId, name: nameMap.get(userId) ?? null, profileId: profileMap.get(userId) ?? null });
}

export async function toInterestViews(rows: InterestRow[], viewerUserId: string): Promise<InterestView[]> {
  const counterpartIds = rows.map((r) => (r.fromUserId === viewerUserId ? r.toUserId : r.fromUserId));
  const refOf = await refs(counterpartIds);
  return rows.map((r) => {
    const counterpartId = r.fromUserId === viewerUserId ? r.toUserId : r.fromUserId;
    return {
      id: r.id,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      counterpart: refOf(counterpartId),
    };
  });
}

export async function toLikeViews(rows: LikeRow[], viewerUserId: string): Promise<LikeView[]> {
  const counterpartIds = rows.map((r) => (r.fromUserId === viewerUserId ? r.toUserId : r.fromUserId));
  const refOf = await refs(counterpartIds);
  return rows.map((r) => {
    const counterpartId = r.fromUserId === viewerUserId ? r.toUserId : r.fromUserId;
    return {
      id: r.id,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      createdAt: r.createdAt.toISOString(),
      counterpart: refOf(counterpartId),
    };
  });
}

export async function toShortlistViews(rows: ShortlistRow[]): Promise<ShortlistView[]> {
  const refOf = await refs(rows.map((r) => r.targetUserId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    targetUserId: r.targetUserId,
    createdAt: r.createdAt.toISOString(),
    counterpart: refOf(r.targetUserId),
  }));
}

export async function toBlockViews(rows: BlockRow[]): Promise<BlockView[]> {
  const refOf = await refs(rows.map((r) => r.blockedUserId));
  return rows.map((r) => ({
    id: r.id,
    blockerUserId: r.blockerUserId,
    blockedUserId: r.blockedUserId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    counterpart: refOf(r.blockedUserId),
  }));
}

export async function toMatchViews(rows: MatchRow[], viewerUserId: string): Promise<MatchView[]> {
  const counterpartIds = rows.map((r) => (r.userAId === viewerUserId ? r.userBId : r.userAId));
  const refOf = await refs(counterpartIds);
  return rows.map((r) => {
    const counterpartId = r.userAId === viewerUserId ? r.userBId : r.userAId;
    return {
      id: r.id,
      matchedAt: r.matchedAt.toISOString(),
      counterpart: refOf(counterpartId),
    };
  });
}
