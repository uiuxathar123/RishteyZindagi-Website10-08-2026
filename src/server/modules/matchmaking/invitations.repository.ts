/** Data access for Super Admin invitations to Personal Matchmaking. No business rules here. */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { matchmakingInvitations, users } from "@/server/db/schema";

export type InvitationRow = typeof matchmakingInvitations.$inferSelect;
export const INVITATION_KINDS = ["OFFER", "COMPLIMENTARY"] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];
export const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "REVOKED"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export async function insertInvitation(values: typeof matchmakingInvitations.$inferInsert): Promise<InvitationRow> {
  const [row] = await db.insert(matchmakingInvitations).values(values).returning();
  return row;
}

export async function findInvitationById(id: string): Promise<InvitationRow | undefined> {
  const [row] = await db.select().from(matchmakingInvitations).where(eq(matchmakingInvitations.id, id)).limit(1);
  return row;
}

export async function findPendingForUser(userId: string): Promise<InvitationRow | undefined> {
  const [row] = await db
    .select()
    .from(matchmakingInvitations)
    .where(and(eq(matchmakingInvitations.userId, userId), eq(matchmakingInvitations.status, "PENDING")))
    .limit(1);
  return row;
}

/** Compare-and-swap: only a still-PENDING invitation changes. */
export async function closeInvitation(
  id: string,
  to: Exclude<InvitationStatus, "PENDING">,
  extra: Partial<typeof matchmakingInvitations.$inferInsert> = {}
): Promise<InvitationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(matchmakingInvitations)
    .set({ ...extra, status: to, respondedAt: now, updatedAt: now })
    .where(and(eq(matchmakingInvitations.id, id), eq(matchmakingInvitations.status, "PENDING")))
    .returning();
  return row;
}

export interface InvitationListRow {
  invitation: InvitationRow;
  memberName: string;
  memberEmail: string;
}

export async function listInvitations(filter: { status?: InvitationStatus; limit: number; offset: number }): Promise<{ rows: InvitationListRow[]; total: number }> {
  const where = filter.status ? eq(matchmakingInvitations.status, filter.status) : undefined;
  const rows = await db
    .select({ invitation: matchmakingInvitations, memberName: users.name, memberEmail: users.email })
    .from(matchmakingInvitations)
    .innerJoin(users, eq(users.id, matchmakingInvitations.userId))
    .where(where)
    .orderBy(desc(matchmakingInvitations.updatedAt))
    .limit(filter.limit)
    .offset(filter.offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(matchmakingInvitations).where(where);
  return { rows, total: count };
}

/** The member started the normal checkout: a pending OFFER invitation has done its job. */
export async function markOfferAccepted(userId: string, caseId: string): Promise<void> {
  const now = new Date();
  await db
    .update(matchmakingInvitations)
    .set({ status: "ACCEPTED", caseId, respondedAt: now, updatedAt: now })
    .where(and(eq(matchmakingInvitations.userId, userId), eq(matchmakingInvitations.status, "PENDING"), eq(matchmakingInvitations.kind, "OFFER")));
}
