/**
 * B8: data access for `memberships` — B1 schema-only foundation (never
 * written by any code through B7, only read by membership-gate.ts) that
 * this phase turns into a real purchase/renewal/upgrade lifecycle.
 */
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships } from "@/server/db/schema";

export type MembershipRow = typeof memberships.$inferSelect;

export async function findById(id: string): Promise<MembershipRow | undefined> {
  const [row] = await db.select().from(memberships).where(eq(memberships.id, id)).limit(1);
  return row;
}

/** The user's currently-ACTIVE-and-not-yet-expired membership, if any —
 * same real-time-fresh predicate as membership-gate.ts's
 * hasActiveMembership, just returning the row instead of a boolean.
 * `desc(createdAt)` guards against the (should-never-happen, but not
 * schema-prevented) case of more than one ACTIVE row for a user. */
export async function findActiveForUser(userId: string): Promise<MembershipRow | undefined> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE"), or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)))
    )
    .orderBy(desc(memberships.createdAt))
    .limit(1);
  return row;
}

/** Every membership row for a user, most recent first — "my membership
 * history". */
export async function listForUser(userId: string): Promise<MembershipRow[]> {
  return db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(desc(memberships.createdAt));
}

/** The single most recent row for a user regardless of status — used by
 * renewal/auto-renewal to find "what plan/auto-renew setting should this
 * renewal act on" even after the membership has already flipped to
 * EXPIRED. */
export async function findMostRecentForUser(userId: string): Promise<MembershipRow | undefined> {
  const [row] = await db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(desc(memberships.createdAt)).limit(1);
  return row;
}

export interface CreatePendingMembershipInput {
  userId: string;
  planId: string;
  autoRenew: boolean;
}

/** Creates the PENDING membership row a checkout's payment will (on
 * success) activate — see payments.service.ts's checkout flow. */
export async function createPending(input: CreatePendingMembershipInput): Promise<MembershipRow> {
  const [row] = await db
    .insert(memberships)
    .values({ userId: input.userId, planId: input.planId, status: "PENDING", autoRenew: input.autoRenew })
    .returning();
  return row;
}

/** Activates a PENDING membership on genuine payment success —
 * `startedAt`/`expiresAt` computed here from `durationDays`, never
 * trusted from client input. */
export async function activate(id: string, durationDays: number): Promise<MembershipRow> {
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const [row] = await db.update(memberships).set({ status: "ACTIVE", startedAt, expiresAt }).where(eq(memberships.id, id)).returning();
  return row;
}

export async function cancel(id: string): Promise<MembershipRow> {
  const [row] = await db.update(memberships).set({ status: "CANCELLED" }).where(eq(memberships.id, id)).returning();
  return row;
}

/** Product rule: "Cancellation sets autoRenew=false only — the current
 * paid period is untouched, membership does not immediately deactivate."
 * Deliberately distinct from `cancel()` above, which sets `status`
 * itself (used only for the upgrade path's "end the OLD membership
 * immediately" rule — a different, harsher action a user never triggers
 * directly). */
export async function turnOffAutoRenew(id: string): Promise<MembershipRow> {
  const [row] = await db.update(memberships).set({ autoRenew: false }).where(eq(memberships.id, id)).returning();
  return row;
}

export async function setAutoRenew(id: string, autoRenew: boolean): Promise<MembershipRow> {
  const [row] = await db.update(memberships).set({ autoRenew }).where(eq(memberships.id, id)).returning();
  return row;
}

/** Request-time freshness (see membership-gate.ts's own doc comment):
 * flips a membership's stored `status` to EXPIRED when its `expiresAt`
 * has passed but the row still says ACTIVE — called opportunistically on
 * read paths (getMyMembership) so the stored status doesn't silently
 * drift from the truth forever between actual writes, while every gate
 * check (`hasActiveMembership`, `findActiveForUser`) already computes
 * "is it active right now" from `status`+`expiresAt` together and never
 * depends on this having run. Purely a display/bookkeeping convenience,
 * never a correctness requirement. */
export async function markExpiredIfPast(row: MembershipRow): Promise<MembershipRow> {
  if (row.status === "ACTIVE" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    const [updated] = await db.update(memberships).set({ status: "EXPIRED" }).where(eq(memberships.id, row.id)).returning();
    return updated;
  }
  return row;
}
