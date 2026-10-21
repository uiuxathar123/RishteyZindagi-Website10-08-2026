/**
 * Super Admin introductions: a Super Admin proposes that two members be introduced, whether or not either of them
 * has bought Personal Matchmaking. No paid case is involved or needed.
 *
 * Rules (each re-checked when the introduction is created, shown, and answered):
 *   - both members pass the normal recommendation eligibility IN BOTH DIRECTIONS (active account, profile ready
 *     and approved, profile not hidden, mutual gender preference, no block either way) plus: not opted out of
 *     Personal Matchmaking, and 18 or older;
 *   - one open introduction per pair; never between members who are already matched.
 * Each member answers separately (accept / decline; an acceptance can be withdrawn). An introduction is consent to
 * be introduced only: it NEVER creates an interest, a match or a chat. When both accept, both are told they can send
 * an interest from the other's profile — the existing interest flow (and its membership rule) and the existing chat
 * gate then apply unchanged. Members only ever see the other member's normal member profile view (no e-mail or
 * phone), and only see the other's answer once both have accepted.
 */
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireSuperAdmin } from "@/server/middleware/rbac";
import { db } from "@/server/db/client";
import { matchmakingIntroductions } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as interactionsRepo from "@/server/modules/interactions/interactions.repository";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import { resolveLookupsForProfiles } from "@/server/modules/profiles/profiles.service";
import { viewerExtrasFor } from "@/server/modules/profiles/privacy";
import { computeAge } from "@/server/modules/profiles/completion";
import { toAuthenticatedPublicView, type AuthenticatedPublicProfileView } from "@/server/modules/profiles/profiles.dto";
import type { CompatibilityResult } from "@/server/modules/recommendations/scoring";
import { eligibleFor, loadCaseOwner, scoreFor, type CaseOwner } from "./matchmaking-eligibility";
import type { AdminMeta } from "./matchmaking-admin.service";
import * as repo from "./introductions.repository";

const UNIQUE_VIOLATION = "23505";
const ENTITY = "matchmaking_introduction";
export const MEMBER_SEARCH_LIMIT = 20;

// --- shared ---------------------------------------------------------------------------------

export interface AdminMemberSummary {
  userId: string;
  name: string;
  email: string;
  profileId: string;
  gender: "MALE" | "FEMALE";
  age: number;
  accountStatus: string;
  profileStatus: string;
  approvalStatus: string;
  profileVisibility: string;
  profileCompletionPercent: number;
  matchmakingOptOut: boolean;
  companyVerificationStatus: string;
  blocksMade: number;
  blocksReceived: number;
  /** Passes the base rules for being introduced (the pair rules are checked by the preview). */
  introducible: boolean;
  problems: string[];
}

function memberProblems(m: repo.MemberSearchRow): string[] {
  const problems: string[] = [];
  if (m.accountStatus !== "ACTIVE") problems.push(`Account is ${m.accountStatus.toLowerCase().replace("_", " ")}.`);
  if (m.profileStatus !== "READY_FOR_VISIBILITY") problems.push("Profile is incomplete (not ready to be shown to members).");
  if (m.approvalStatus !== "APPROVED") problems.push(`Profile is not approved (${m.approvalStatus.toLowerCase()}).`);
  if (m.profileVisibility !== "VISIBLE") problems.push("The member has hidden their profile.");
  if (m.matchmakingOptOut) problems.push("The member opted out of Personal Matchmaking.");
  if (computeAge(m.dateOfBirth) < 18) problems.push("The member is under 18.");
  return problems;
}

function toSummary(m: repo.MemberSearchRow): AdminMemberSummary {
  const problems = memberProblems(m);
  return {
    userId: m.userId,
    name: m.name,
    email: m.email,
    profileId: m.profilePublicId,
    gender: m.gender,
    age: computeAge(m.dateOfBirth),
    accountStatus: m.accountStatus,
    profileStatus: m.profileStatus,
    approvalStatus: m.approvalStatus,
    profileVisibility: m.profileVisibility,
    profileCompletionPercent: m.profileCompletionPercent,
    matchmakingOptOut: m.matchmakingOptOut,
    companyVerificationStatus: m.companyVerificationStatus,
    blocksMade: m.blocksMade,
    blocksReceived: m.blocksReceived,
    introducible: problems.length === 0,
    problems,
  };
}

function scoreView(result: CompatibilityResult | null | undefined) {
  if (!result || !result.evaluable) return null;
  return { score: result.score, breakdown: result.breakdown };
}

// --- Super Admin --------------------------------------------------------------------------------

export async function searchMembers(ctx: AuthContext, input: { q: string; scope: "introducible" | "all" }): Promise<AdminMemberSummary[]> {
  requireSuperAdmin(ctx);
  const q = input.q.trim();
  if (q.length < 2) throw new ValidationError("Type at least 2 characters to search.");
  const rows = await repo.searchMembers({ q, introducibleOnly: input.scope === "introducible", limit: MEMBER_SEARCH_LIMIT });
  // The SQL filter mirrors memberProblems(); filter again so the two can never disagree.
  const summaries = rows.map(toSummary);
  return input.scope === "introducible" ? summaries.filter((s) => s.introducible) : summaries;
}

export interface IntroductionPreview {
  eligible: boolean;
  problems: string[];
  members: { a: AdminMemberSummary; b: AdminMemberSummary };
  blocks: { aBlockedB: boolean; bBlockedA: boolean };
  alreadyMatched: boolean;
  openIntroductionId: string | null;
  compatibility: {
    aToB: { score: number; breakdown: CompatibilityResult["breakdown"] } | null;
    bToA: { score: number; breakdown: CompatibilityResult["breakdown"] } | null;
  };
}

async function buildPreview(aId: string, bId: string): Promise<IntroductionPreview & { owners: { a: CaseOwner; b: CaseOwner } | null }> {
  if (aId === bId) throw new ValidationError("Choose two different members.");
  const found = await repo.findMembers([aId, bId]);
  const a = found.find((m) => m.userId === aId);
  const b = found.find((m) => m.userId === bId);
  if (!a || !b) throw new NotFoundError("Member not found.");
  const sa = toSummary(a);
  const sb = toSummary(b);
  const [blockState, match, open, ownerA, ownerB] = await Promise.all([
    repo.blockDirections(aId, bId),
    interactionsRepo.findMatchByPair(aId, bId),
    repo.findOpenIntroductionForPair(aId, bId),
    loadCaseOwner(aId),
    loadCaseOwner(bId),
  ]);
  const problems = [...sa.problems.map((p) => `${sa.name}: ${p}`), ...sb.problems.map((p) => `${sb.name}: ${p}`)];
  if (blockState.xBlockedY) problems.push(`${sa.name} has blocked ${sb.name}.`);
  if (blockState.yBlockedX) problems.push(`${sb.name} has blocked ${sa.name}.`);
  if (match) problems.push("These members are already matched.");
  if (open) problems.push("These members already have an open introduction.");

  let aToB: IntroductionPreview["compatibility"]["aToB"] = null;
  let bToA: IntroductionPreview["compatibility"]["bToA"] = null;
  if (ownerA && ownerB) {
    const [candB] = await eligibleFor(ownerA, [bId]);
    const [candA] = await eligibleFor(ownerB, [aId]);
    if (problems.length === 0 && (!candA || !candB)) {
      problems.push("Not compatible under the matching rules (gender or gender preference).");
    }
    if (candB) aToB = scoreView((await scoreFor(ownerA, [candB]))[0]?.result);
    if (candA) bToA = scoreView((await scoreFor(ownerB, [candA]))[0]?.result);
  }
  return {
    eligible: problems.length === 0,
    problems,
    members: { a: sa, b: sb },
    blocks: { aBlockedB: blockState.xBlockedY, bBlockedA: blockState.yBlockedX },
    alreadyMatched: !!match,
    openIntroductionId: open?.id ?? null,
    compatibility: { aToB, bToA },
    owners: ownerA && ownerB ? { a: ownerA, b: ownerB } : null,
  };
}

export async function previewIntroduction(ctx: AuthContext, aId: string, bId: string): Promise<IntroductionPreview> {
  requireSuperAdmin(ctx);
  const preview: IntroductionPreview & { owners?: unknown } = await buildPreview(aId, bId);
  delete preview.owners; // internal (profile rows) — never sent to the client
  return preview;
}

export interface AdminIntroductionView {
  id: string;
  status: repo.IntroductionStatus;
  userA: { userId: string; name: string; response: repo.MemberResponse; respondedAt: string | null };
  userB: { userId: string; name: string; response: repo.MemberResponse; respondedAt: string | null };
  scoreAToB: number | null;
  scoreBToA: number | null;
  messageToMembers: string | null;
  internalNote: string | null;
  createdByAdminId: string;
  withdrawnByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

function toAdminView(row: repo.IntroductionRow, names: { a: string; b: string }): AdminIntroductionView {
  return {
    id: row.id,
    status: row.status as repo.IntroductionStatus,
    userA: { userId: row.userAId, name: names.a, response: row.userAResponse as repo.MemberResponse, respondedAt: row.userARespondedAt?.toISOString() ?? null },
    userB: { userId: row.userBId, name: names.b, response: row.userBResponse as repo.MemberResponse, respondedAt: row.userBRespondedAt?.toISOString() ?? null },
    scoreAToB: row.scoreAToB,
    scoreBToA: row.scoreBToA,
    messageToMembers: row.messageToMembers,
    internalNote: row.internalNote,
    createdByAdminId: row.createdByAdminId,
    withdrawnByAdminId: row.withdrawnByAdminId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
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

const INTRO_CREATED = {
  title: "A personal introduction from our team",
  body: "Our matchmaking team would like to introduce you to a member. Review it in Dashboard → Personal Matchmaking and choose whether to accept.",
};
const INTRO_CLOSED = { title: "An introduction is no longer active", body: "One of your introductions from our matchmaking team has closed." };
const INTRO_MUTUAL = {
  title: "You both accepted an introduction",
  body: "You can now send an interest from their profile. Chat opens once an interest is accepted.",
};

export async function createIntroduction(
  ctx: AuthContext,
  input: { userAId: string; userBId: string; messageToMembers?: string; internalNote?: string },
  meta: AdminMeta
): Promise<AdminIntroductionView> {
  requireSuperAdmin(ctx);
  const preview = await buildPreview(input.userAId, input.userBId);
  if (!preview.eligible || !preview.owners) {
    throw new ConflictError("These members cannot be introduced.", { problems: preview.problems });
  }
  // Stored ordered (user_a_id < user_b_id); keep each member's own score with them.
  const [a, b] = repo.orderPair(input.userAId, input.userBId);
  const swapped = a !== input.userAId;
  const scoreForA = swapped ? preview.compatibility.bToA : preview.compatibility.aToB;
  const scoreForB = swapped ? preview.compatibility.aToB : preview.compatibility.bToA;
  const names = swapped ? { a: preview.members.b.name, b: preview.members.a.name } : { a: preview.members.a.name, b: preview.members.b.name };

  let row: repo.IntroductionRow;
  try {
    row = await repo.insertIntroduction({
      userAId: a,
      userBId: b,
      status: "PENDING",
      messageToMembers: input.messageToMembers?.trim() || null,
      internalNote: input.internalNote?.trim() || null,
      scoreAToB: scoreForA?.score ?? null,
      scoreBToA: scoreForB?.score ?? null,
      createdByAdminId: ctx.subject.id,
    });
  } catch (err) {
    const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === UNIQUE_VIOLATION) throw new ConflictError("These members already have an open introduction.");
    throw err;
  }
  await adminAudit(ctx, "matchmaking.introduction_created", row.id, meta, { userAId: a, userBId: b, scoreAToB: row.scoreAToB, scoreBToA: row.scoreBToA });
  await Promise.all(
    [a, b].map((userId) => notify({ userId, channel: "IN_APP", ...INTRO_CREATED, dedupeKey: `introduction_created:${row.id}:${userId}` }))
  );
  return toAdminView(row, names);
}

export async function listIntroductions(ctx: AuthContext, filter: { status?: repo.IntroductionStatus; page: number; pageSize: number }) {
  requireSuperAdmin(ctx);
  const { rows, total } = await repo.listIntroductions({ status: filter.status, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize });
  return {
    items: rows.map((r) => toAdminView(r.introduction, { a: r.userAName, b: r.userBName })),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
  };
}

export async function withdrawIntroduction(ctx: AuthContext, introductionId: string, meta: AdminMeta): Promise<AdminIntroductionView> {
  requireSuperAdmin(ctx);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const current = await repo.lockIntroduction(tx, introductionId);
    if (!current) throw new NotFoundError("Introduction not found.");
    if (!repo.OPEN_INTRODUCTION_STATUSES.includes(current.status as repo.IntroductionStatus)) {
      throw new ConflictError("This introduction is already closed.");
    }
    const [updated] = await tx
      .update(matchmakingIntroductions)
      .set({ status: "WITHDRAWN", withdrawnByAdminId: ctx.subject.id, closedAt: now, updatedAt: now })
      .where(eq(matchmakingIntroductions.id, introductionId))
      .returning();
    return updated;
  });
  await adminAudit(ctx, "matchmaking.introduction_withdrawn", result.id, meta);
  await Promise.all(
    [result.userAId, result.userBId].map((userId) => notify({ userId, channel: "IN_APP", ...INTRO_CLOSED, dedupeKey: `introduction_closed:${result.id}:${userId}` }))
  );
  const names = await repo.findMembers([result.userAId, result.userBId]);
  const nameOf = (id: string) => names.find((n) => n.userId === id)?.name ?? "";
  return toAdminView(result, { a: nameOf(result.userAId), b: nameOf(result.userBId) });
}

// --- member -------------------------------------------------------------------------------------

function requireMember(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  return ctx.subject.id;
}

export interface MemberIntroductionView {
  id: string;
  /** PENDING: waiting for answers. MUTUALLY_ACCEPTED: both accepted — send an interest to connect. */
  status: "PENDING" | "MUTUALLY_ACCEPTED";
  myResponse: repo.MemberResponse;
  myRespondedAt: string | null;
  messageFromTeam: string | null;
  createdAt: string;
  profile: AuthenticatedPublicProfileView;
}

function sideOf(row: repo.IntroductionRow, userId: string): "A" | "B" | null {
  return row.userAId === userId ? "A" : row.userBId === userId ? "B" : null;
}

/**
 * The member's open introductions, each still allowed right now (both directions of the eligibility rules); the
 * other member is shown with the normal authenticated member view and photo rules — never contact details.
 */
export async function listMyIntroductions(ctx: AuthContext): Promise<MemberIntroductionView[]> {
  const userId = requireMember(ctx);
  const rows = (await repo.listIntroductionsForMember(userId)).filter((r) => repo.OPEN_INTRODUCTION_STATUSES.includes(r.status as repo.IntroductionStatus));
  if (rows.length === 0) return [];
  const me = await loadCaseOwner(userId);
  if (!me) return [];
  const visible: Array<{ row: repo.IntroductionRow; other: CaseOwner; displayName: string }> = [];
  for (const row of rows) {
    const otherId = row.userAId === userId ? row.userBId : row.userAId;
    const other = await loadCaseOwner(otherId);
    if (!other) continue;
    const [[shown], [back]] = await Promise.all([eligibleFor(me, [otherId]), eligibleFor(other, [userId])]);
    if (!shown || !back) continue;
    visible.push({ row, other, displayName: shown.displayName });
  }
  if (visible.length === 0) return [];
  const profilesShown = visible.map((v) => v.other.profile);
  const [lookups, photos, extras] = await Promise.all([
    resolveLookupsForProfiles(profilesShown),
    profilesRepo.listPhotosForProfiles(profilesShown.map((p) => p.id)),
    viewerExtrasFor(userId, profilesShown),
  ]);
  return visible.map(({ row, other, displayName }) => {
    const side = sideOf(row, userId)!;
    return {
      id: row.id,
      status: row.status as "PENDING" | "MUTUALLY_ACCEPTED",
      myResponse: (side === "A" ? row.userAResponse : row.userBResponse) as repo.MemberResponse,
      myRespondedAt: (side === "A" ? row.userARespondedAt : row.userBRespondedAt)?.toISOString() ?? null,
      messageFromTeam: row.messageToMembers,
      createdAt: row.createdAt.toISOString(),
      profile: toAuthenticatedPublicView(other.profile, displayName, lookups.get(other.profile.id)!, photos.get(other.profile.id) ?? [], extras.get(other.profile.id)),
    };
  });
}

export type MemberAnswer = "ACCEPT" | "DECLINE" | "WITHDRAW";

function introductionStatusFor(a: repo.MemberResponse, b: repo.MemberResponse): repo.IntroductionStatus {
  if (a === "DECLINED" || b === "DECLINED") return "DECLINED";
  if (a === "WITHDRAWN" || b === "WITHDRAWN") return "WITHDRAWN";
  if (a === "ACCEPTED" && b === "ACCEPTED") return "MUTUALLY_ACCEPTED";
  return "PENDING";
}

export async function respondToIntroduction(ctx: AuthContext, introductionId: string, answer: MemberAnswer): Promise<MemberIntroductionView | null> {
  const userId = requireMember(ctx);
  // Same 404 whether the introduction does not exist, is not this member's, is closed, or is no longer allowed.
  const visible = (await listMyIntroductions(ctx)).find((i) => i.id === introductionId);
  if (!visible) throw new NotFoundError("Introduction not found.");

  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const current = await repo.lockIntroduction(tx, introductionId);
    const side = current ? sideOf(current, userId) : null;
    if (!current || !side) throw new NotFoundError("Introduction not found.");
    const mine = (side === "A" ? current.userAResponse : current.userBResponse) as repo.MemberResponse;
    const theirs = (side === "A" ? current.userBResponse : current.userAResponse) as repo.MemberResponse;
    const status = current.status as repo.IntroductionStatus;

    let next: repo.MemberResponse;
    if (answer === "ACCEPT" || answer === "DECLINE") {
      if (status !== "PENDING" || mine !== "PENDING") throw new ConflictError("You have already answered this introduction.");
      next = answer === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    } else {
      if (mine !== "ACCEPTED" || !repo.OPEN_INTRODUCTION_STATUSES.includes(status)) throw new ConflictError("Only an accepted, open introduction can be withdrawn.");
      next = "WITHDRAWN";
    }
    const a = side === "A" ? next : theirs;
    const b = side === "A" ? theirs : next;
    const nextStatus = introductionStatusFor(a, b);
    const closed = !repo.OPEN_INTRODUCTION_STATUSES.includes(nextStatus);
    const [updated] = await tx
      .update(matchmakingIntroductions)
      .set({
        ...(side === "A" ? { userAResponse: next, userARespondedAt: now } : { userBResponse: next, userBRespondedAt: now }),
        status: nextStatus,
        ...(closed ? { closedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(matchmakingIntroductions.id, introductionId))
      .returning();
    return { updated, from: status, to: nextStatus, response: next };
  });

  await record({
    actorType: "USER",
    actorId: userId,
    action: "matchmaking.introduction_answered",
    entityType: ENTITY,
    entityId: introductionId,
    metadata: { response: outcome.response, fromStatus: outcome.from, toStatus: outcome.to },
  });
  const otherId = outcome.updated.userAId === userId ? outcome.updated.userBId : outcome.updated.userAId;
  if (outcome.to === "MUTUALLY_ACCEPTED" && outcome.from !== "MUTUALLY_ACCEPTED") {
    await Promise.all(
      [userId, otherId].map((id) => notify({ userId: id, channel: "IN_APP", ...INTRO_MUTUAL, dedupeKey: `introduction_mutual:${introductionId}:${id}` }))
    );
  } else if (outcome.to === "DECLINED" || outcome.to === "WITHDRAWN") {
    // Neutral wording: the other member is not told who closed it or why.
    await notify({ userId: otherId, channel: "IN_APP", ...INTRO_CLOSED, dedupeKey: `introduction_closed:${introductionId}:${otherId}` });
  }
  if (!repo.OPEN_INTRODUCTION_STATUSES.includes(outcome.to)) return null;
  return {
    ...visible,
    status: outcome.to as "PENDING" | "MUTUALLY_ACCEPTED",
    myResponse: outcome.response,
    myRespondedAt: now.toISOString(),
  };
}

// --- Super Admin: overview and "best matches for this member" ----------------------------------------

export async function getOverview(ctx: AuthContext): Promise<repo.OverviewCounts> {
  requireSuperAdmin(ctx);
  return repo.overviewCounts();
}

export const MAX_CANDIDATES = 20;

export interface IntroductionCandidate {
  member: AdminMemberSummary;
  /** How well the candidate fits the chosen member's partner preferences (null when nothing to score against). */
  score: number | null;
  tier: "PRIMARY" | "SECONDARY" | null;
}

/**
 * The members the chosen member could be introduced to right now, best fit first: the same eligibility as a real
 * introduction (both directions, blocks, opt-out, 18+), minus anyone they are already matched with or already have
 * an open introduction with. The Super Admin still reviews the full preview before sending anything.
 */
export async function suggestCandidates(
  ctx: AuthContext,
  userId: string
): Promise<{ member: AdminMemberSummary; hasPreferences: boolean; items: IntroductionCandidate[] }> {
  requireSuperAdmin(ctx);
  const [row] = await repo.findMembers([userId]);
  if (!row) throw new NotFoundError("Member not found.");
  const member = toSummary(row);
  const owner = await loadCaseOwner(userId);
  if (!member.introducible || !owner) return { member, hasPreferences: !!owner?.preferences, items: [] };

  const [pool, unavailable] = await Promise.all([eligibleFor(owner), repo.unavailablePartnerIds(userId)]);
  const open = pool.filter((c) => !unavailable.has(c.profile.userId) && computeAge(c.profile.dateOfBirth) >= 18);
  const scored = (await scoreFor(owner, open)).sort((x, y) => {
    const sx = x.result?.evaluable ? x.result.score : -1;
    const sy = y.result?.evaluable ? y.result.score : -1;
    return sy - sx || x.candidate.profile.id.localeCompare(y.candidate.profile.id);
  });

  // Keep only candidates who would also accept the chosen member (the reverse direction), then take the best.
  const picked: Array<{ userId: string; score: number | null; tier: IntroductionCandidate["tier"] }> = [];
  for (const s of scored) {
    if (picked.length >= MAX_CANDIDATES) break;
    const back = await loadCaseOwner(s.candidate.profile.userId);
    if (!back || (await eligibleFor(back, [userId])).length === 0) continue;
    picked.push({ userId: s.candidate.profile.userId, score: s.result?.evaluable ? s.result.score : null, tier: s.tier });
  }
  const byId = new Map((await repo.findMembers(picked.map((p) => p.userId))).map((m) => [m.userId, toSummary(m)]));
  const items = picked.flatMap((p) => {
    const m = byId.get(p.userId);
    return m && m.introducible ? [{ member: m, score: p.score, tier: p.tier }] : [];
  });
  return { member, hasPreferences: !!owner.preferences, items };
}

// --- Super Admin: every member, with what can be done for each ------------------------------------------

export interface DirectoryMember {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  joinedAt: string;
  profile: {
    profileId: string;
    gender: "MALE" | "FEMALE";
    age: number;
    profileStatus: string;
    approvalStatus: string;
    profileVisibility: string;
    profileCompletionPercent: number;
    matchmakingOptOut: boolean;
    companyVerificationStatus: string;
  } | null;
  blocksMade: number;
  blocksReceived: number;
  matchmaking: { openCaseStatus: string | null; complimentary: boolean; pendingInvitationKind: string | null };
  /** Can be ticked for an introduction (base rules; the pair rules are checked by the preview). */
  introducible: boolean;
  introductionProblems: string[];
  /** Can be sent an invitation to Personal Matchmaking. */
  invitable: boolean;
  invitationProblems: string[];
}

function toDirectoryMember(r: repo.DirectoryRow): DirectoryMember {
  const hasProfile = !!r.profilePublicId && !!r.gender && !!r.dateOfBirth;
  const introductionProblems = hasProfile
    ? memberProblems({
        userId: r.userId,
        name: r.name,
        email: r.email,
        accountStatus: r.accountStatus,
        profileId: "",
        profilePublicId: r.profilePublicId!,
        gender: r.gender!,
        dateOfBirth: r.dateOfBirth!,
        profileStatus: r.profileStatus!,
        approvalStatus: r.approvalStatus!,
        profileVisibility: r.profileVisibility!,
        profileCompletionPercent: r.profileCompletionPercent ?? 0,
        matchmakingOptOut: !!r.matchmakingOptOut,
        companyVerificationStatus: r.companyVerificationStatus ?? "NONE",
        blocksMade: r.blocksMade,
        blocksReceived: r.blocksReceived,
      })
    : ["The member has not created a profile yet."];
  // Same rules (and wording) as invitations.service.ts's invitationProblems(), computed from this row.
  const invitationProblems: string[] = [];
  if (r.accountStatus !== "ACTIVE") invitationProblems.push(`Account is ${r.accountStatus.toLowerCase().replace("_", " ")}.`);
  if (!hasProfile) invitationProblems.push("The member has not created a profile yet.");
  if (r.matchmakingOptOut) invitationProblems.push("The member opted out of Personal Matchmaking.");
  if (r.openCaseStatus) {
    invitationProblems.push(r.openCaseStatus === "PENDING_PAYMENT" ? "The member has already started checkout." : "The member already has an open Personal Matchmaking case.");
  }
  if (r.pendingInvitationKind) invitationProblems.push("The member already has a pending invitation.");
  return {
    userId: r.userId,
    name: r.name,
    email: r.email,
    accountStatus: r.accountStatus,
    joinedAt: r.joinedAt.toISOString(),
    profile: hasProfile
      ? {
          profileId: r.profilePublicId!,
          gender: r.gender!,
          age: computeAge(r.dateOfBirth!),
          profileStatus: r.profileStatus!,
          approvalStatus: r.approvalStatus!,
          profileVisibility: r.profileVisibility!,
          profileCompletionPercent: r.profileCompletionPercent ?? 0,
          matchmakingOptOut: !!r.matchmakingOptOut,
          companyVerificationStatus: r.companyVerificationStatus ?? "NONE",
        }
      : null,
    blocksMade: r.blocksMade,
    blocksReceived: r.blocksReceived,
    matchmaking: { openCaseStatus: r.openCaseStatus, complimentary: !!r.openCaseComplimentary, pendingInvitationKind: r.pendingInvitationKind },
    introducible: introductionProblems.length === 0,
    introductionProblems,
    invitable: invitationProblems.length === 0,
    invitationProblems,
  };
}

export async function listDirectory(
  ctx: AuthContext,
  input: { q: string; filter: repo.DirectoryFilter; gender?: "MALE" | "FEMALE"; page: number; pageSize: number }
) {
  requireSuperAdmin(ctx);
  const { rows, total } = await repo.listDirectory({ q: input.q, filter: input.filter, gender: input.gender, limit: input.pageSize, offset: (input.page - 1) * input.pageSize });
  return { items: rows.map(toDirectoryMember), page: input.page, pageSize: input.pageSize, total };
}
