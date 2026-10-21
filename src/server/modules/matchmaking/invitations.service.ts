/**
 * Super Admin invitations to Personal Matchmaking.
 *
 *   OFFER          — tells the member about the service. Nothing else changes: the member buys it through the normal
 *                    checkout, at the normal server-side price, with the normal payment rules. Starting that checkout
 *                    marks the invitation ACCEPTED.
 *   COMPLIMENTARY  — offers the service free. Nothing starts until the member accepts it, with exactly the same consent
 *                    a purchase needs; accepting opens a complimentary case (ACTIVE, price 0, no payment, no invoice)
 *                    with the included member access the Super Admin chose. The case then runs like any paid case.
 *
 * Who can be invited: a member with a profile and an active account who has not opted out of Personal Matchmaking,
 * has no open case and no other pending invitation. Every invitation, revocation and answer is audited, and the
 * member is told in-app.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { matchmakingCaseEvents, matchmakingCases, matchmakingInvitations, users } from "@/server/db/schema";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireSuperAdmin } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import { resolveUserRegion } from "@/server/modules/memberships/region";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import type { AdminMeta } from "./matchmaking-admin.service";
import * as casesRepo from "./matchmaking.repository";
import { MATCHMAKING_CONSENT_TEXT, MATCHMAKING_CONSENT_VERSION, getMatchmakingSettings, offerFor } from "./matchmaking-settings";
import * as repo from "./invitations.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";
const ENTITY = "matchmaking_invitation";
const isUniqueViolation = (err: unknown) =>
  ((err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code) === UNIQUE_VIOLATION;

// --- Super Admin ----------------------------------------------------------------------------------

export interface AdminInvitationView {
  id: string;
  kind: repo.InvitationKind;
  status: repo.InvitationStatus;
  member: { userId: string; name: string; email: string };
  messageToMember: string | null;
  includedMembershipDays: number | null;
  invitedByAdminId: string;
  revokedByAdminId: string | null;
  caseId: string | null;
  respondedAt: string | null;
  createdAt: string;
}

function toAdminView(row: repo.InvitationRow, member: { name: string; email: string }): AdminInvitationView {
  return {
    id: row.id,
    kind: row.kind as repo.InvitationKind,
    status: row.status as repo.InvitationStatus,
    member: { userId: row.userId, name: member.name, email: member.email },
    messageToMember: row.messageToMember,
    includedMembershipDays: row.includedMembershipDays,
    invitedByAdminId: row.invitedByAdminId,
    revokedByAdminId: row.revokedByAdminId,
    caseId: row.caseId,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function adminAudit(ctx: AuthContext, action: string, entityId: string, meta: AdminMeta, metadata?: Record<string, unknown>) {
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action,
    entityType: ENTITY,
    entityId,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata,
  });
}

/** Why this member cannot be invited right now (empty when they can). Shared with the members list. */
export async function invitationProblems(userId: string): Promise<string[]> {
  const [[account], profile, open, pending] = await Promise.all([
    db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1),
    profilesRepo.findByUserId(userId),
    casesRepo.findOpenCaseForUser(userId),
    repo.findPendingForUser(userId),
  ]);
  const problems: string[] = [];
  if (!account) return ["Member not found."];
  if (account.status !== "ACTIVE") problems.push(`Account is ${account.status.toLowerCase().replace("_", " ")}.`);
  if (!profile) problems.push("The member has not created a profile yet.");
  if (profile?.matchmakingOptOut) problems.push("The member opted out of Personal Matchmaking.");
  if (open) problems.push(open.status === "PENDING_PAYMENT" ? "The member has already started checkout." : "The member already has an open Personal Matchmaking case.");
  if (pending) problems.push("The member already has a pending invitation.");
  return problems;
}

export async function inviteMember(
  ctx: AuthContext,
  input: { userId: string; kind: repo.InvitationKind; messageToMember?: string; includedMembershipDays?: number },
  meta: AdminMeta
): Promise<AdminInvitationView> {
  requireSuperAdmin(ctx);
  const problems = await invitationProblems(input.userId);
  if (problems.length) throw new ConflictError("This member cannot be invited.", { problems });

  const settings = await getMatchmakingSettings();
  let days: number | null = null;
  if (input.kind === "OFFER") {
    if (input.includedMembershipDays !== undefined) throw new ValidationError("Included access is set by the service settings for a normal offer.");
    const region = await resolveUserRegion(input.userId);
    if (!offerFor(settings, region.currency)) {
      throw new ConflictError("Personal Matchmaking is not on sale for this member's currency. Turn it on in Settings, or send a complimentary offer.");
    }
  } else {
    days = input.includedMembershipDays ?? settings.includedMembershipDays;
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new ValidationError("Included access must be between 0 and 3650 days.");
  }

  let row: repo.InvitationRow;
  try {
    row = await repo.insertInvitation({
      userId: input.userId,
      kind: input.kind,
      status: "PENDING",
      messageToMember: input.messageToMember?.trim() || null,
      includedMembershipDays: days,
      invitedByAdminId: ctx.subject.id,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("This member cannot be invited.", { problems: ["The member already has a pending invitation."] });
    throw err;
  }
  await adminAudit(ctx, "matchmaking.invitation_sent", row.id, meta, { userId: input.userId, kind: input.kind, includedMembershipDays: days });
  await notify({
    userId: input.userId,
    channel: "IN_APP",
    title: input.kind === "COMPLIMENTARY" ? "A complimentary Personal Matchmaking offer for you" : "You're invited to Personal Matchmaking",
    body:
      input.kind === "COMPLIMENTARY"
        ? "Our matchmaking team would like to offer you Personal Matchmaking free of charge. Review the offer in Dashboard → Personal Matchmaking."
        : "Our matchmaking team invites you to try Personal Matchmaking. See the details in Dashboard → Personal Matchmaking.",
    dedupeKey: `matchmaking_invitation:${row.id}`,
  });
  const [member] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.userId));
  return toAdminView(row, member);
}

export async function revokeInvitation(ctx: AuthContext, invitationId: string, meta: AdminMeta): Promise<AdminInvitationView> {
  requireSuperAdmin(ctx);
  const updated = await repo.closeInvitation(invitationId, "REVOKED", { revokedByAdminId: ctx.subject.id });
  if (!updated) {
    if (!(await repo.findInvitationById(invitationId))) throw new NotFoundError("Invitation not found.");
    throw new ConflictError("This invitation is no longer pending.");
  }
  await adminAudit(ctx, "matchmaking.invitation_revoked", updated.id, meta);
  const [member] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, updated.userId));
  return toAdminView(updated, member);
}

export async function listInvitations(ctx: AuthContext, filter: { status?: repo.InvitationStatus; page: number; pageSize: number }) {
  requireSuperAdmin(ctx);
  const { rows, total } = await repo.listInvitations({ status: filter.status, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize });
  return {
    items: rows.map((r) => toAdminView(r.invitation, { name: r.memberName, email: r.memberEmail })),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
  };
}

// --- member -----------------------------------------------------------------------------------------

export interface MemberInvitationView {
  id: string;
  kind: repo.InvitationKind;
  messageFromTeam: string | null;
  /** COMPLIMENTARY: the member access (interests and chat) the free service includes. */
  includedMembershipDays: number | null;
  consentVersion: string;
  consentText: string;
  createdAt: string;
}

function requireMember(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  return ctx.subject.id;
}

export async function myPendingInvitation(userId: string): Promise<MemberInvitationView | null> {
  const row = await repo.findPendingForUser(userId);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind as repo.InvitationKind,
    messageFromTeam: row.messageToMember,
    includedMembershipDays: row.includedMembershipDays,
    consentVersion: MATCHMAKING_CONSENT_VERSION,
    consentText: MATCHMAKING_CONSENT_TEXT,
    createdAt: row.createdAt.toISOString(),
  };
}

export type InvitationAnswer =
  | { response: "DECLINE" }
  | { response: "ACCEPT"; consent: true; consentVersion: string; customerNotes?: string };

/**
 * DECLINE closes any pending invitation. ACCEPT is for a COMPLIMENTARY invitation only (an OFFER is accepted by
 * starting the normal checkout) and needs the current consent; it opens the free case in one transaction.
 */
export async function respondToInvitation(ctx: AuthContext, invitationId: string, answer: InvitationAnswer): Promise<{ status: "ACCEPTED" | "DECLINED"; caseId: string | null }> {
  const userId = requireMember(ctx);
  const invitation = await repo.findInvitationById(invitationId);
  // The same answer whether it does not exist, is someone else's, or is no longer pending.
  if (!invitation || invitation.userId !== userId || invitation.status !== "PENDING") throw new NotFoundError("Invitation not found.");

  if (answer.response === "DECLINE") {
    const closed = await repo.closeInvitation(invitationId, "DECLINED");
    if (!closed) throw new NotFoundError("Invitation not found.");
    await record({ actorType: "USER", actorId: userId, action: "matchmaking.invitation_declined", entityType: ENTITY, entityId: invitationId });
    return { status: "DECLINED", caseId: null };
  }

  if (invitation.kind !== "COMPLIMENTARY") throw new ConflictError("To accept this invitation, start Personal Matchmaking from the offer page.");
  if (answer.consent !== true) throw new ValidationError("Your consent is required to start Personal Matchmaking.");
  if (answer.consentVersion !== MATCHMAKING_CONSENT_VERSION) {
    throw new ConflictError("The service terms have changed. Please review and accept them again.", { consentVersion: MATCHMAKING_CONSENT_VERSION });
  }
  if (!(await profilesRepo.findByUserId(userId))) throw new ConflictError("Create your profile before starting Personal Matchmaking.");

  const now = new Date();
  const notes = answer.customerNotes?.trim() || null;
  let caseId: string;
  try {
    caseId = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(matchmakingInvitations).where(eq(matchmakingInvitations.id, invitationId)).for("update");
      if (!locked || locked.status !== "PENDING" || locked.userId !== userId) throw new NotFoundError("Invitation not found.");
      const days = locked.includedMembershipDays ?? 0;
      const [open] = await tx
        .select({ id: matchmakingCases.id })
        .from(matchmakingCases)
        .where(and(eq(matchmakingCases.userId, userId), inArray(matchmakingCases.status, casesRepo.OPEN_CASE_STATUSES)))
        .limit(1);
      if (open) throw new ConflictError("You already have an open Personal Matchmaking case.", { caseId: open.id });
      const [created] = await tx
        .insert(matchmakingCases)
        .values({
          userId,
          status: "ACTIVE",
          complimentary: true,
          priceInPaise: 0,
          currency: "INR",
          includedMembershipDays: days,
          includedAccessUntil: new Date(now.getTime() + days * DAY_MS),
          consentedAt: now,
          consentVersion: MATCHMAKING_CONSENT_VERSION,
          customerNotes: notes,
        })
        .returning({ id: matchmakingCases.id });
      await tx.insert(matchmakingCaseEvents).values([
        {
          caseId: created.id,
          actorType: "USER",
          actorId: userId,
          kind: "CONSENT",
          note: "Consent given; complimentary offer accepted.",
          customerVisible: false,
          metadata: { consentVersion: MATCHMAKING_CONSENT_VERSION, invitationId, includedMembershipDays: days },
        },
        {
          caseId: created.id,
          actorType: "SYSTEM",
          kind: "STATUS_CHANGE",
          fromStatus: null,
          toStatus: "ACTIVE",
          note: "Complimentary Personal Matchmaking has started.",
          customerVisible: true,
          metadata: { invitationId },
        },
      ]);
      await tx
        .update(matchmakingInvitations)
        .set({ status: "ACCEPTED", caseId: created.id, respondedAt: now, updatedAt: now })
        .where(eq(matchmakingInvitations.id, invitationId));
      return created.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("You already have an open Personal Matchmaking case.");
    throw err;
  }
  await record({ actorType: "USER", actorId: userId, action: "matchmaking.invitation_accepted", entityType: ENTITY, entityId: invitationId, metadata: { caseId } });
  await notify({
    userId,
    channel: "IN_APP",
    title: "Personal Matchmaking has started",
    body: "Your complimentary Personal Matchmaking has started. Our matchmaking team will share suggestions with you.",
    dedupeKey: `matchmaking_invitation_accepted:${invitationId}`,
  });
  return { status: "ACCEPTED", caseId };
}
