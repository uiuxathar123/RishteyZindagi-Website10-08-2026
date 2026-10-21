/** Data access for Super Admin introductions and the admin member search. No business rules here. */
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { blocks, matches, matchmakingCases, matchmakingIntroductions, matchmakingInvitations, payments, profiles, users } from "@/server/db/schema";

export type IntroductionRow = typeof matchmakingIntroductions.$inferSelect;
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const INTRODUCTION_STATUSES = ["PENDING", "MUTUALLY_ACCEPTED", "DECLINED", "WITHDRAWN"] as const;
export type IntroductionStatus = (typeof INTRODUCTION_STATUSES)[number];
export const OPEN_INTRODUCTION_STATUSES: IntroductionStatus[] = ["PENDING", "MUTUALLY_ACCEPTED"];
export const MEMBER_RESPONSES = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN"] as const;
export type MemberResponse = (typeof MEMBER_RESPONSES)[number];

/** The pair is always stored ordered, so (a, b) and (b, a) are the same introduction. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export async function insertIntroduction(values: typeof matchmakingIntroductions.$inferInsert): Promise<IntroductionRow> {
  const [row] = await db.insert(matchmakingIntroductions).values(values).returning();
  return row;
}

export async function findIntroductionById(id: string): Promise<IntroductionRow | undefined> {
  const [row] = await db.select().from(matchmakingIntroductions).where(eq(matchmakingIntroductions.id, id)).limit(1);
  return row;
}

export async function lockIntroduction(tx: DbTx, id: string): Promise<IntroductionRow | undefined> {
  const [row] = await tx.select().from(matchmakingIntroductions).where(eq(matchmakingIntroductions.id, id)).for("update");
  return row;
}

export async function findOpenIntroductionForPair(x: string, y: string): Promise<IntroductionRow | undefined> {
  const [a, b] = orderPair(x, y);
  const [row] = await db
    .select()
    .from(matchmakingIntroductions)
    .where(and(eq(matchmakingIntroductions.userAId, a), eq(matchmakingIntroductions.userBId, b), inArray(matchmakingIntroductions.status, OPEN_INTRODUCTION_STATUSES)))
    .limit(1);
  return row;
}

export async function listIntroductionsForMember(userId: string): Promise<IntroductionRow[]> {
  return db
    .select()
    .from(matchmakingIntroductions)
    .where(or(eq(matchmakingIntroductions.userAId, userId), eq(matchmakingIntroductions.userBId, userId)))
    .orderBy(desc(matchmakingIntroductions.createdAt))
    .limit(100);
}

export interface IntroductionListRow {
  introduction: IntroductionRow;
  userAName: string;
  userBName: string;
}

export async function listIntroductions(filter: { status?: IntroductionStatus; limit: number; offset: number }): Promise<{ rows: IntroductionListRow[]; total: number }> {
  const where = filter.status ? eq(matchmakingIntroductions.status, filter.status) : undefined;
  const nameOf = (col: typeof matchmakingIntroductions.userAId | typeof matchmakingIntroductions.userBId) => sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${col})`;
  const rows = await db
    .select({ introduction: matchmakingIntroductions, userAName: nameOf(matchmakingIntroductions.userAId), userBName: nameOf(matchmakingIntroductions.userBId) })
    .from(matchmakingIntroductions)
    .where(where)
    .orderBy(desc(matchmakingIntroductions.updatedAt))
    .limit(filter.limit)
    .offset(filter.offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(matchmakingIntroductions).where(where);
  return { rows, total: count };
}

// --- admin member search ------------------------------------------------------------------------

export interface MemberSearchRow {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  profileId: string;
  profilePublicId: string;
  gender: "MALE" | "FEMALE";
  dateOfBirth: Date;
  profileStatus: string;
  approvalStatus: string;
  profileVisibility: string;
  profileCompletionPercent: number;
  matchmakingOptOut: boolean;
  companyVerificationStatus: string;
  blocksMade: number;
  blocksReceived: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const memberColumns = {
  userId: users.id,
  name: users.name,
  email: users.email,
  accountStatus: users.status,
  profileId: profiles.id,
  profilePublicId: profiles.publicId,
  gender: profiles.gender,
  dateOfBirth: profiles.dateOfBirth,
  profileStatus: profiles.profileStatus,
  approvalStatus: profiles.approvalStatus,
  profileVisibility: profiles.profileVisibility,
  profileCompletionPercent: profiles.profileCompletionPercent,
  matchmakingOptOut: profiles.matchmakingOptOut,
  companyVerificationStatus: profiles.companyVerificationStatus,
  blocksMade: sql<number>`(SELECT count(*)::int FROM ${blocks} b WHERE b.blocker_user_id = ${users.id})`,
  blocksReceived: sql<number>`(SELECT count(*)::int FROM ${blocks} b WHERE b.blocked_user_id = ${users.id})`,
};

/**
 * Members with a profile, by name / e-mail / profile ID / user or profile id. `introducibleOnly` keeps just the
 * members who pass the base introduction rules (active account, ready + approved + visible profile, not opted out of
 * Personal Matchmaking, adult) — the pair-specific rules (gender, blocks) are checked separately.
 */
export async function searchMembers(input: { q: string; introducibleOnly: boolean; limit: number }): Promise<MemberSearchRow[]> {
  const raw = input.q.trim();
  const term = `%${escapeLike(raw)}%`;
  const matchers = [ilike(users.name, term), ilike(users.email, term), ilike(profiles.publicId, term)];
  if (UUID_RE.test(raw)) matchers.push(eq(users.id, raw.toLowerCase()), eq(profiles.id, raw.toLowerCase()));
  const base = input.introducibleOnly
    ? and(
        eq(users.status, "ACTIVE"),
        eq(profiles.profileStatus, "READY_FOR_VISIBILITY"),
        eq(profiles.approvalStatus, "APPROVED"),
        eq(profiles.profileVisibility, "VISIBLE"),
        eq(profiles.matchmakingOptOut, false),
        sql`${profiles.dateOfBirth} <= now() - interval '18 years'`
      )
    : undefined;
  return db
    .select(memberColumns)
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(or(...matchers), base))
    .orderBy(users.name)
    .limit(input.limit);
}

export async function findMembers(userIds: string[]): Promise<MemberSearchRow[]> {
  if (userIds.length === 0) return [];
  return db.select(memberColumns).from(users).innerJoin(profiles, eq(profiles.userId, users.id)).where(inArray(users.id, userIds));
}

export async function blockDirections(x: string, y: string): Promise<{ xBlockedY: boolean; yBlockedX: boolean }> {
  const rows = await db
    .select({ blocker: blocks.blockerUserId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerUserId, x), eq(blocks.blockedUserId, y)), and(eq(blocks.blockerUserId, y), eq(blocks.blockedUserId, x))));
  return { xBlockedY: rows.some((r) => r.blocker === x), yBlockedX: rows.some((r) => r.blocker === y) };
}

/** Members this user already has an open introduction with, or is already matched with — never suggested again. */
export async function unavailablePartnerIds(userId: string): Promise<Set<string>> {
  const [intros, matched] = await Promise.all([
    db
      .select({ a: matchmakingIntroductions.userAId, b: matchmakingIntroductions.userBId })
      .from(matchmakingIntroductions)
      .where(
        and(
          or(eq(matchmakingIntroductions.userAId, userId), eq(matchmakingIntroductions.userBId, userId)),
          inArray(matchmakingIntroductions.status, OPEN_INTRODUCTION_STATUSES)
        )
      ),
    db
      .select({ a: matches.userAId, b: matches.userBId })
      .from(matches)
      .where(or(eq(matches.userAId, userId), eq(matches.userBId, userId))),
  ]);
  return new Set([...intros, ...matched].map((r) => (r.a === userId ? r.b : r.a)));
}

export interface OverviewCounts {
  cases: Record<"PENDING_PAYMENT" | "ACTIVE" | "IN_PROGRESS", number>;
  duplicateCaptures: number;
  introductions: Record<"PENDING" | "MUTUALLY_ACCEPTED", number>;
  verificationReviewsOpen: number;
}

/** The "what needs attention" numbers for the Super Admin overview — counts only, no member data. */
export async function overviewCounts(): Promise<OverviewCounts> {
  const [caseRows, introRows, [dup], [reviews]] = await Promise.all([
    db
      .select({ status: matchmakingCases.status, n: sql<number>`count(*)::int` })
      .from(matchmakingCases)
      .where(inArray(matchmakingCases.status, ["PENDING_PAYMENT", "ACTIVE", "IN_PROGRESS"]))
      .groupBy(matchmakingCases.status),
    db
      .select({ status: matchmakingIntroductions.status, n: sql<number>`count(*)::int` })
      .from(matchmakingIntroductions)
      .where(inArray(matchmakingIntroductions.status, OPEN_INTRODUCTION_STATUSES))
      .groupBy(matchmakingIntroductions.status),
    // Same rule as matchmaking.repository.ts's duplicate-capture flag: a captured payment that is not the one that
    // paid for its case, on a case that is already paid or closed.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .innerJoin(matchmakingCases, eq(matchmakingCases.id, payments.matchmakingCaseId))
      .where(
        sql`${payments.status} = 'SUCCESS' AND ${payments.id} IS DISTINCT FROM ${matchmakingCases.paidPaymentId} AND (${matchmakingCases.paidPaymentId} IS NOT NULL OR ${matchmakingCases.status} <> 'PENDING_PAYMENT')`
      ),
    db.select({ n: sql<number>`count(*)::int` }).from(profiles).where(eq(profiles.companyVerificationStatus, "PENDING")),
  ]);
  const caseCount = (s: string) => caseRows.find((r) => r.status === s)?.n ?? 0;
  const introCount = (s: string) => introRows.find((r) => r.status === s)?.n ?? 0;
  return {
    cases: { PENDING_PAYMENT: caseCount("PENDING_PAYMENT"), ACTIVE: caseCount("ACTIVE"), IN_PROGRESS: caseCount("IN_PROGRESS") },
    duplicateCaptures: dup?.n ?? 0,
    introductions: { PENDING: introCount("PENDING"), MUTUALLY_ACCEPTED: introCount("MUTUALLY_ACCEPTED") },
    verificationReviewsOpen: reviews?.n ?? 0,
  };
}

// --- admin members directory (every member account, with or without a profile) ------------------------

export const DIRECTORY_FILTERS = ["all", "introducible", "in_matchmaking", "no_profile"] as const;
export type DirectoryFilter = (typeof DIRECTORY_FILTERS)[number];

export interface DirectoryRow {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  joinedAt: Date;
  profilePublicId: string | null;
  gender: "MALE" | "FEMALE" | null;
  dateOfBirth: Date | null;
  profileStatus: string | null;
  approvalStatus: string | null;
  profileVisibility: string | null;
  profileCompletionPercent: number | null;
  matchmakingOptOut: boolean | null;
  companyVerificationStatus: string | null;
  blocksMade: number;
  blocksReceived: number;
  openCaseStatus: string | null;
  openCaseComplimentary: boolean | null;
  pendingInvitationKind: string | null;
}

const introducibleSql = sql`(${users.status} = 'ACTIVE' AND ${profiles.profileStatus} = 'READY_FOR_VISIBILITY' AND ${profiles.approvalStatus} = 'APPROVED'
  AND ${profiles.profileVisibility} = 'VISIBLE' AND ${profiles.matchmakingOptOut} = false AND ${profiles.dateOfBirth} <= now() - interval '18 years')`;
const openCaseStatusSql = sql<string | null>`(SELECT c.status FROM ${matchmakingCases} c WHERE c.user_id = ${users.id} AND c.status IN ('PENDING_PAYMENT', 'ACTIVE', 'IN_PROGRESS') LIMIT 1)`;
const openCaseCompSql = sql<boolean | null>`(SELECT c.complimentary FROM ${matchmakingCases} c WHERE c.user_id = ${users.id} AND c.status IN ('PENDING_PAYMENT', 'ACTIVE', 'IN_PROGRESS') LIMIT 1)`;
const pendingInviteSql = sql<string | null>`(SELECT i.kind FROM ${matchmakingInvitations} i WHERE i.user_id = ${users.id} AND i.status = 'PENDING' LIMIT 1)`;

export async function listDirectory(input: {
  q: string;
  filter: DirectoryFilter;
  gender?: "MALE" | "FEMALE";
  limit: number;
  offset: number;
}): Promise<{ rows: DirectoryRow[]; total: number }> {
  const conditions = [];
  const raw = input.q.trim();
  if (raw) {
    const term = `%${escapeLike(raw)}%`;
    const matchers = [ilike(users.name, term), ilike(users.email, term), ilike(profiles.publicId, term)];
    if (UUID_RE.test(raw)) matchers.push(eq(users.id, raw.toLowerCase()), eq(profiles.id, raw.toLowerCase()));
    conditions.push(or(...matchers));
  }
  if (input.gender) conditions.push(eq(profiles.gender, input.gender));
  if (input.filter === "introducible") conditions.push(introducibleSql);
  if (input.filter === "no_profile") conditions.push(sql`${profiles.id} IS NULL`);
  if (input.filter === "in_matchmaking") conditions.push(sql`(${openCaseStatusSql} IS NOT NULL OR ${pendingInviteSql} IS NOT NULL)`);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        accountStatus: users.status,
        joinedAt: users.createdAt,
        profilePublicId: profiles.publicId,
        gender: profiles.gender,
        dateOfBirth: profiles.dateOfBirth,
        profileStatus: profiles.profileStatus,
        approvalStatus: profiles.approvalStatus,
        profileVisibility: profiles.profileVisibility,
        profileCompletionPercent: profiles.profileCompletionPercent,
        matchmakingOptOut: profiles.matchmakingOptOut,
        companyVerificationStatus: profiles.companyVerificationStatus,
        blocksMade: sql<number>`(SELECT count(*)::int FROM ${blocks} b WHERE b.blocker_user_id = ${users.id})`,
        blocksReceived: sql<number>`(SELECT count(*)::int FROM ${blocks} b WHERE b.blocked_user_id = ${users.id})`,
        openCaseStatus: openCaseStatusSql,
        openCaseComplimentary: openCaseCompSql,
        pendingInvitationKind: pendingInviteSql,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt), users.id)
      .limit(input.limit)
      .offset(input.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(users).leftJoin(profiles, eq(profiles.userId, users.id)).where(where),
  ]);
  return { rows, total: count };
}
