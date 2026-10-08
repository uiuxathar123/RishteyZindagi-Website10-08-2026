/**
 * B6: data access for `behaviour_events` (schema.ts) — the real,
 * append-only interaction-event log. Nothing outside this file writes to
 * the table directly (mirrors every other module's own repository
 * convention).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { behaviourEvents } from "@/server/db/schema";

export type BehaviourEventRow = typeof behaviourEvents.$inferSelect;
export type BehaviourEventType = BehaviourEventRow["eventType"];

export interface NewBehaviourEvent {
  actorUserId: string;
  targetUserId?: string | null;
  eventType: BehaviourEventType;
  metadata?: Record<string, unknown> | null;
}

export async function insert(event: NewBehaviourEvent): Promise<BehaviourEventRow> {
  const [row] = await db
    .insert(behaviourEvents)
    .values({
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId ?? null,
      eventType: event.eventType,
      metadata: event.metadata ?? undefined,
    })
    .returning();
  return row;
}

/** Small, safe cap on how many raw rows are pulled per pair before the
 * in-application dedup below reduces them to "one per event type" — a
 * pair can only ever accumulate a handful of distinct event types, so
 * this is generous headroom, not a correctness limit. */
const RECENT_PAIR_EVENTS_LIMIT = 100;

/**
 * The most recent row, per event type, for a given (actor, target) pair —
 * used by `real-behaviour-signal-provider.ts` to dedupe "one repeated
 * action must not produce unlimited score inflation" (only the latest
 * occurrence of each signal type is allowed to contribute). Fetches
 * recent rows for the pair (already ordered newest-first by the DB) and
 * keeps only the first (= most recent) row seen per `eventType` in
 * application code — simpler and more portable than a Postgres-specific
 * `DISTINCT ON`, and the row count here is always small.
 */
export async function fetchLatestPerTypeForPair(actorUserId: string, targetUserId: string): Promise<BehaviourEventRow[]> {
  const rows = await db
    .select()
    .from(behaviourEvents)
    .where(and(eq(behaviourEvents.actorUserId, actorUserId), eq(behaviourEvents.targetUserId, targetUserId)))
    .orderBy(desc(behaviourEvents.createdAt))
    .limit(RECENT_PAIR_EVENTS_LIMIT);

  const seenTypes = new Set<string>();
  const latestPerType: BehaviourEventRow[] = [];
  for (const row of rows) {
    if (seenTypes.has(row.eventType)) continue;
    seenTypes.add(row.eventType);
    latestPerType.push(row);
  }
  return latestPerType;
}

/**
 * B13 (Performance/Scalability phase — genuine, evidenced N+1 fix; see
 * PERFORMANCE_REPORT.md and BACKEND.md's B13 section for the full before/
 * after evidence): the batched counterpart to `fetchLatestPerTypeForPair`
 * above. `real-behaviour-signal-provider.ts`'s recommendations integration
 * used to call `fetchLatestPerTypeForPair` twice PER CANDIDATE (once per
 * direction) inside `recommendations.service.ts`'s per-candidate
 * `Promise.all` loop — with `CANDIDATE_FETCH_CAP` = 2000, a single
 * GET /profiles/me/recommendations request could issue thousands of tiny
 * round trips to this exact table for one page of results. This function
 * replaces that whole per-candidate loop with exactly TWO queries
 * (one per direction) covering every candidate in the page at once, using
 * `targetUserId IN (...)` / `actorUserId IN (...)` — the same "one
 * batched query over the caller's full id set, never N+1" discipline this
 * codebase already established in chat.repository.ts's
 * `listMyChatSummaries` (see its own doc comment) and
 * interactions.repository.ts.
 *
 * Returns two maps (by the OTHER party's userId) of "most recent row per
 * event type" — the identical per-pair dedup `fetchLatestPerTypeForPair`
 * already does, just computed once per candidate in application code
 * instead of once per candidate via a separate DB round trip. Each
 * direction's underlying scan is capped at `BATCH_ROWS_LIMIT` rows,
 * ordered newest-first — generous enough that no realistic single-page
 * candidate set exhausts it (mirrors `RECENT_PAIR_EVENTS_LIMIT`'s own
 * "generous headroom, not a correctness limit" reasoning), while still
 * being a real, defensive bound rather than an unbounded table scan.
 */
const BATCH_ROWS_LIMIT = 20000;

export interface BatchedPairEvents {
  /** Keyed by candidateUserId: events the REQUESTER (actor) directed at
   * that candidate (target), most-recent-per-type. */
  myActionsByCandidate: Map<string, BehaviourEventRow[]>;
  /** Keyed by candidateUserId: events that CANDIDATE (actor) directed at
   * the requester (target), most-recent-per-type. */
  theirActionsByCandidate: Map<string, BehaviourEventRow[]>;
}

export async function fetchLatestPerTypeForPairsBatch(requesterUserId: string, candidateUserIds: string[]): Promise<BatchedPairEvents> {
  const myActionsByCandidate = new Map<string, BehaviourEventRow[]>();
  const theirActionsByCandidate = new Map<string, BehaviourEventRow[]>();
  if (candidateUserIds.length === 0) return { myActionsByCandidate, theirActionsByCandidate };

  const [myRows, theirRows] = await Promise.all([
    db
      .select()
      .from(behaviourEvents)
      .where(and(eq(behaviourEvents.actorUserId, requesterUserId), inArray(behaviourEvents.targetUserId, candidateUserIds)))
      .orderBy(desc(behaviourEvents.createdAt))
      .limit(BATCH_ROWS_LIMIT),
    db
      .select()
      .from(behaviourEvents)
      .where(and(inArray(behaviourEvents.actorUserId, candidateUserIds), eq(behaviourEvents.targetUserId, requesterUserId)))
      .orderBy(desc(behaviourEvents.createdAt))
      .limit(BATCH_ROWS_LIMIT),
  ]);

  const seenMine = new Map<string, Set<string>>(); // candidateUserId -> seen eventTypes
  for (const row of myRows) {
    const key = row.targetUserId as string;
    let seen = seenMine.get(key);
    if (!seen) {
      seen = new Set();
      seenMine.set(key, seen);
    }
    if (seen.has(row.eventType)) continue;
    seen.add(row.eventType);
    const list = myActionsByCandidate.get(key) ?? [];
    list.push(row);
    myActionsByCandidate.set(key, list);
  }

  const seenTheirs = new Map<string, Set<string>>(); // candidateUserId -> seen eventTypes
  for (const row of theirRows) {
    const key = row.actorUserId;
    let seen = seenTheirs.get(key);
    if (!seen) {
      seen = new Set();
      seenTheirs.set(key, seen);
    }
    if (seen.has(row.eventType)) continue;
    seen.add(row.eventType);
    const list = theirActionsByCandidate.get(key) ?? [];
    list.push(row);
    theirActionsByCandidate.set(key, list);
  }

  return { myActionsByCandidate, theirActionsByCandidate };
}

/** Simple, non-deduped fetch of an actor's most recent events of the given
 * types (any target) — used only where "most recent per type" isn't the
 * right shape (kept for future callers; the real provider uses the
 * per-pair dedup function above). */
export async function fetchRecentByActor(actorUserId: string, eventTypes: BehaviourEventType[], limit = 50): Promise<BehaviourEventRow[]> {
  return db
    .select()
    .from(behaviourEvents)
    .where(and(eq(behaviourEvents.actorUserId, actorUserId), inArray(behaviourEvents.eventType, eventTypes)))
    .orderBy(desc(behaviourEvents.createdAt))
    .limit(limit);
}
