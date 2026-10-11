/**
 * B19 — community groups: admin-curated discussion circles for members.
 *
 * Rules (documented judgment calls):
 *  - Only an admin with `groups.manage` creates, renames, deactivates groups. Members cannot create groups — a matrimonial
 *    platform needs a human to decide what circles exist.
 *  - To join or post a member must be ACTIVE and have a profile that is ready AND approved (the same bar as being visible to
 *    other members). Reading a group's posts requires being a member of it.
 *  - Free members may take part; no paid membership is required (unlike chat, which is private 1:1 messaging).
 *  - A member removed by an admin keeps a REMOVED row, so they cannot rejoin; "leave" simply deletes the row.
 *  - Posts: 1–1000 characters, plain text. Hidden (by an admin, reason kept) or deleted (by the author) posts disappear from
 *    members' feeds. A post by someone you have blocked (or who blocked you) is not shown to you.
 *  - Other members appear by first name and last initial only; admins see the full name.
 *  - Members can report a post (once each). Reports are shown to admins; nothing is auto-hidden.
 *  - Every admin change is audited. No post bodies or names are written to the audit log.
 */
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { blocks, communityGroupMembers, communityGroupPosts, communityGroups, communityPostReports, profiles, users } from "@/server/db/schema";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";

type Meta = { ipAddress?: string | null; userAgent?: string | null };
export const MAX_POST_LENGTH = 1000;

function memberId(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  return ctx.subject.id;
}

export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

async function assertEligible(userId: string): Promise<void> {
  const [row] = await db
    .select({ status: users.status, profileStatus: profiles.profileStatus, approval: profiles.approvalStatus })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.status !== "ACTIVE") throw new AuthorizationError("Your account is not active.");
  if (row.profileStatus !== "READY_FOR_VISIBILITY" || row.approval !== "APPROVED") {
    throw new AuthorizationError("Complete your profile and wait for it to be visible before joining groups.");
  }
}

async function getGroupOr404(groupId: string) {
  const [g] = await db.select().from(communityGroups).where(eq(communityGroups.id, groupId)).limit(1);
  if (!g) throw new NotFoundError("Group not found.");
  return g;
}
async function membership(groupId: string, userId: string) {
  const [m] = await db.select().from(communityGroupMembers).where(and(eq(communityGroupMembers.groupId, groupId), eq(communityGroupMembers.userId, userId))).limit(1);
  return m;
}
async function requireActiveMember(groupId: string, userId: string) {
  const m = await membership(groupId, userId);
  if (!m || m.status !== "ACTIVE") throw new AuthorizationError("Join this group to see and write posts.");
}

// ---------------------------------------------------------------------------
// Member side
// ---------------------------------------------------------------------------

export interface GroupView {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  joined: boolean;
  /** True when an admin removed this member from the group. */
  removed: boolean;
}

async function toViews(rows: Array<typeof communityGroups.$inferSelect>, userId: string): Promise<GroupView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((g) => g.id);
  const [counts, mine] = await Promise.all([
    db.select({ groupId: communityGroupMembers.groupId, n: count() }).from(communityGroupMembers).where(and(inArray(communityGroupMembers.groupId, ids), eq(communityGroupMembers.status, "ACTIVE"))).groupBy(communityGroupMembers.groupId),
    db.select().from(communityGroupMembers).where(and(inArray(communityGroupMembers.groupId, ids), eq(communityGroupMembers.userId, userId))),
  ]);
  const cm = new Map(counts.map((c) => [c.groupId, Number(c.n)]));
  const mm = new Map(mine.map((m) => [m.groupId, m.status]));
  return rows.map((g) => ({ id: g.id, name: g.name, description: g.description, memberCount: cm.get(g.id) ?? 0, joined: mm.get(g.id) === "ACTIVE", removed: mm.get(g.id) === "REMOVED" }));
}

export async function listGroups(ctx: AuthContext): Promise<{ groups: GroupView[] }> {
  const userId = memberId(ctx);
  const rows = await db.select().from(communityGroups).where(eq(communityGroups.isActive, true)).orderBy(asc(communityGroups.name));
  return { groups: await toViews(rows, userId) };
}

export async function getGroup(ctx: AuthContext, groupId: string): Promise<GroupView> {
  const userId = memberId(ctx);
  const g = await getGroupOr404(groupId);
  if (!g.isActive) throw new NotFoundError("Group not found.");
  return (await toViews([g], userId))[0];
}

export async function joinGroup(ctx: AuthContext, groupId: string): Promise<GroupView> {
  const userId = memberId(ctx);
  const g = await getGroupOr404(groupId);
  if (!g.isActive) throw new NotFoundError("Group not found.");
  await assertEligible(userId);
  const existing = await membership(groupId, userId);
  if (existing?.status === "REMOVED") throw new AuthorizationError("You cannot rejoin this group. Contact support if you think this is a mistake.");
  if (!existing) await db.insert(communityGroupMembers).values({ groupId, userId }).onConflictDoNothing();
  return (await toViews([g], userId))[0];
}

export async function leaveGroup(ctx: AuthContext, groupId: string): Promise<{ left: true }> {
  const userId = memberId(ctx);
  await getGroupOr404(groupId);
  await db.delete(communityGroupMembers).where(and(eq(communityGroupMembers.groupId, groupId), eq(communityGroupMembers.userId, userId), eq(communityGroupMembers.status, "ACTIVE")));
  return { left: true };
}

export interface PostView {
  id: string;
  groupId: string;
  authorName: string;
  body: string;
  createdAt: string;
  mine: boolean;
}
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listPosts(ctx: AuthContext, groupId: string, page = 1, pageSize = 20): Promise<Paged<PostView>> {
  const userId = memberId(ctx);
  const g = await getGroupOr404(groupId);
  if (!g.isActive) throw new NotFoundError("Group not found.");
  await requireActiveMember(groupId, userId);
  const ps = Math.min(Math.max(pageSize, 1), 50);
  const p = Math.max(page, 1);
  const blockedAuthors = sql`NOT EXISTS (
    SELECT 1 FROM ${blocks} b
    WHERE (b.blocker_user_id = ${userId} AND b.blocked_user_id = ${communityGroupPosts.authorUserId})
       OR (b.blocked_user_id = ${userId} AND b.blocker_user_id = ${communityGroupPosts.authorUserId}))`;
  const where = and(eq(communityGroupPosts.groupId, groupId), eq(communityGroupPosts.status, "VISIBLE"), blockedAuthors);
  const [rows, [tot]] = await Promise.all([
    db
      .select({ id: communityGroupPosts.id, body: communityGroupPosts.body, createdAt: communityGroupPosts.createdAt, authorUserId: communityGroupPosts.authorUserId, authorName: users.name })
      .from(communityGroupPosts)
      .innerJoin(users, eq(users.id, communityGroupPosts.authorUserId))
      .where(where)
      .orderBy(desc(communityGroupPosts.createdAt), desc(communityGroupPosts.id))
      .limit(ps)
      .offset((p - 1) * ps),
    db.select({ n: count() }).from(communityGroupPosts).where(where),
  ]);
  const total = Number(tot?.n ?? 0);
  return {
    items: rows.map((r) => ({ id: r.id, groupId, authorName: r.authorUserId === userId ? "You" : shortName(r.authorName), body: r.body, createdAt: r.createdAt.toISOString(), mine: r.authorUserId === userId })),
    page: p,
    pageSize: ps,
    total,
    totalPages: Math.max(1, Math.ceil(total / ps)),
  };
}

export const postSchema = z.object({ body: z.string().trim().min(1, "Write something first.").max(MAX_POST_LENGTH, `A post can be at most ${MAX_POST_LENGTH} characters.`) }).strict();

export async function createPost(ctx: AuthContext, groupId: string, body: string): Promise<PostView> {
  const userId = memberId(ctx);
  const g = await getGroupOr404(groupId);
  if (!g.isActive) throw new NotFoundError("Group not found.");
  await requireActiveMember(groupId, userId);
  await assertEligible(userId);
  const [row] = await db.insert(communityGroupPosts).values({ groupId, authorUserId: userId, body }).returning();
  return { id: row.id, groupId, authorName: "You", body: row.body, createdAt: row.createdAt.toISOString(), mine: true };
}

export async function deleteOwnPost(ctx: AuthContext, postId: string): Promise<{ deleted: true }> {
  const userId = memberId(ctx);
  const res = await db
    .update(communityGroupPosts)
    .set({ status: "DELETED" })
    .where(and(eq(communityGroupPosts.id, postId), eq(communityGroupPosts.authorUserId, userId), ne(communityGroupPosts.status, "DELETED")))
    .returning({ id: communityGroupPosts.id });
  if (res.length === 0) throw new NotFoundError("Post not found."); // same answer for "not yours" — no probing
  return { deleted: true };
}

export const reportSchema = z.object({ reason: z.string().trim().min(3, "Tell us briefly what is wrong.").max(300) }).strict();

export async function reportPost(ctx: AuthContext, postId: string, reason: string): Promise<{ reported: true }> {
  const userId = memberId(ctx);
  const [post] = await db.select().from(communityGroupPosts).where(eq(communityGroupPosts.id, postId)).limit(1);
  if (!post || post.status !== "VISIBLE") throw new NotFoundError("Post not found.");
  await requireActiveMember(post.groupId, userId).catch(() => {
    throw new NotFoundError("Post not found.");
  });
  if (post.authorUserId === userId) throw new ValidationError("You cannot report your own post. You can delete it instead.");
  await db.insert(communityPostReports).values({ postId, reporterUserId: userId, reason }).onConflictDoNothing();
  return { reported: true };
}

// ---------------------------------------------------------------------------
// Admin side (`groups.manage`)
// ---------------------------------------------------------------------------

const groupFields = {
  name: z.string().trim().min(3, "Use at least 3 characters.").max(80),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
};
export const groupCreateSchema = z.object({ name: groupFields.name, description: groupFields.description.default(""), isActive: groupFields.isActive.default(true) }).strict();
export const groupUpdateSchema = z.object({ name: groupFields.name.optional(), description: groupFields.description.optional(), isActive: groupFields.isActive.optional() }).strict();

const auditBase = (ctx: AuthContext, meta: Meta) => ({ actorType: "ADMIN" as const, actorId: ctx.subject.id, actorRole: ctx.adminRoleName, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

export interface AdminGroupView {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  memberCount: number;
  postCount: number;
  openReportCount: number;
  createdAt: string;
}

export async function listGroupsAdmin(ctx: AuthContext): Promise<{ groups: AdminGroupView[] }> {
  await requirePermission(ctx, "groups.manage");
  const rows = await db.select().from(communityGroups).orderBy(asc(communityGroups.name));
  if (rows.length === 0) return { groups: [] };
  const ids = rows.map((g) => g.id);
  const [mc, pc, rc] = await Promise.all([
    db.select({ k: communityGroupMembers.groupId, n: count() }).from(communityGroupMembers).where(and(inArray(communityGroupMembers.groupId, ids), eq(communityGroupMembers.status, "ACTIVE"))).groupBy(communityGroupMembers.groupId),
    db.select({ k: communityGroupPosts.groupId, n: count() }).from(communityGroupPosts).where(and(inArray(communityGroupPosts.groupId, ids), eq(communityGroupPosts.status, "VISIBLE"))).groupBy(communityGroupPosts.groupId),
    db
      .select({ k: communityGroupPosts.groupId, n: sql<number>`count(distinct ${communityGroupPosts.id})` })
      .from(communityPostReports)
      .innerJoin(communityGroupPosts, eq(communityGroupPosts.id, communityPostReports.postId))
      .where(and(inArray(communityGroupPosts.groupId, ids), eq(communityGroupPosts.status, "VISIBLE")))
      .groupBy(communityGroupPosts.groupId),
  ]);
  const m = (a: Array<{ k: string; n: number | string }>) => new Map(a.map((x) => [x.k, Number(x.n)]));
  const [M, P, R] = [m(mc), m(pc), m(rc)];
  return { groups: rows.map((g) => ({ id: g.id, name: g.name, description: g.description, isActive: g.isActive, memberCount: M.get(g.id) ?? 0, postCount: P.get(g.id) ?? 0, openReportCount: R.get(g.id) ?? 0, createdAt: g.createdAt.toISOString() })) };
}

export async function createGroup(ctx: AuthContext, input: unknown, meta: Meta) {
  await requirePermission(ctx, "groups.manage");
  const parsed = groupCreateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("The group is invalid.", issues(parsed.error));
  try {
    const [row] = await db.insert(communityGroups).values({ ...parsed.data, createdByAdminId: ctx.subject.id }).returning();
    await record({ ...auditBase(ctx, meta), action: "group.created", entityType: "community_group", entityId: row.id, metadata: { isActive: row.isActive } });
    return { id: row.id, name: row.name, description: row.description, isActive: row.isActive };
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") throw new ConflictError("A group with this name already exists.");
    throw e;
  }
}

export async function updateGroup(ctx: AuthContext, groupId: string, input: unknown, meta: Meta) {
  await requirePermission(ctx, "groups.manage");
  const parsed = groupUpdateSchema.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data).length === 0) throw new ValidationError("The group changes are invalid.", parsed.success ? undefined : issues(parsed.error));
  const before = await getGroupOr404(groupId);
  try {
    const [row] = await db.update(communityGroups).set({ ...parsed.data, updatedAt: new Date() }).where(eq(communityGroups.id, groupId)).returning();
    await record({ ...auditBase(ctx, meta), action: "group.updated", entityType: "community_group", entityId: groupId, metadata: { fields: Object.keys(parsed.data), wasActive: before.isActive, isActive: row.isActive } });
    return { id: row.id, name: row.name, description: row.description, isActive: row.isActive };
  } catch (e) {
    if ((e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") throw new ConflictError("A group with this name already exists.");
    throw e;
  }
}

export type PostFilter = "all" | "reported" | "hidden";
export async function listPostsAdmin(ctx: AuthContext, groupId: string, filter: PostFilter, page = 1, pageSize = 20) {
  await requirePermission(ctx, "groups.manage");
  await getGroupOr404(groupId);
  const ps = Math.min(Math.max(pageSize, 1), 50);
  const p = Math.max(page, 1);
  const reports = sql<number>`(SELECT count(*)::int FROM ${communityPostReports} r WHERE r.post_id = ${communityGroupPosts.id})`;
  const cond =
    filter === "hidden"
      ? eq(communityGroupPosts.status, "HIDDEN")
      : filter === "reported"
        ? and(ne(communityGroupPosts.status, "DELETED"), sql`EXISTS (SELECT 1 FROM ${communityPostReports} r WHERE r.post_id = ${communityGroupPosts.id})`)
        : ne(communityGroupPosts.status, "DELETED");
  const where = and(eq(communityGroupPosts.groupId, groupId), cond);
  const [rows, [tot]] = await Promise.all([
    db
      .select({ id: communityGroupPosts.id, body: communityGroupPosts.body, status: communityGroupPosts.status, hiddenReason: communityGroupPosts.hiddenReason, createdAt: communityGroupPosts.createdAt, authorUserId: communityGroupPosts.authorUserId, authorName: users.name, reportCount: reports })
      .from(communityGroupPosts)
      .innerJoin(users, eq(users.id, communityGroupPosts.authorUserId))
      .where(where)
      .orderBy(desc(communityGroupPosts.createdAt), desc(communityGroupPosts.id))
      .limit(ps)
      .offset((p - 1) * ps),
    db.select({ n: count() }).from(communityGroupPosts).where(where),
  ]);
  const total = Number(tot?.n ?? 0);
  return {
    items: rows.map((r) => ({ id: r.id, body: r.body, status: r.status, hiddenReason: r.hiddenReason, authorUserId: r.authorUserId, authorName: r.authorName, reportCount: Number(r.reportCount), createdAt: r.createdAt.toISOString() })),
    page: p,
    pageSize: ps,
    total,
    totalPages: Math.max(1, Math.ceil(total / ps)),
  };
}

export const hideSchema = z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();
export async function setPostHidden(ctx: AuthContext, postId: string, input: { hidden: boolean; reason?: string }, meta: Meta) {
  await requirePermission(ctx, "groups.manage");
  const [post] = await db.select().from(communityGroupPosts).where(eq(communityGroupPosts.id, postId)).limit(1);
  if (!post || post.status === "DELETED") throw new NotFoundError("Post not found.");
  const reason = input.reason?.trim() || null;
  if (input.hidden && (!reason || reason.length < 5)) throw new ValidationError("Hiding a post needs a reason of at least 5 characters (kept in the audit log).");
  const res = await db
    .update(communityGroupPosts)
    .set(input.hidden ? { status: "HIDDEN", hiddenByAdminId: ctx.subject.id, hiddenReason: reason, hiddenAt: new Date() } : { status: "VISIBLE", hiddenByAdminId: null, hiddenReason: null, hiddenAt: null })
    .where(and(eq(communityGroupPosts.id, postId), eq(communityGroupPosts.status, input.hidden ? "VISIBLE" : "HIDDEN")))
    .returning({ id: communityGroupPosts.id });
  if (res.length === 0) throw new ConflictError(input.hidden ? "This post is already hidden." : "This post is not hidden.");
  await record({ ...auditBase(ctx, meta), action: input.hidden ? "group_post.hidden" : "group_post.restored", entityType: "community_group_post", entityId: postId, metadata: { groupId: post.groupId, authorUserId: post.authorUserId, reason } });
  if (input.hidden) {
    await notify({ userId: post.authorUserId, channel: "IN_APP", title: "A group post was removed", body: "A moderator hid one of your group posts because it did not follow the community guidelines.", dedupeKey: `group_post_hidden:${postId}` });
  }
  return { id: postId, status: input.hidden ? "HIDDEN" : "VISIBLE" };
}

export async function listMembersAdmin(ctx: AuthContext, groupId: string) {
  await requirePermission(ctx, "groups.manage");
  await getGroupOr404(groupId);
  const rows = await db
    .select({ userId: communityGroupMembers.userId, name: users.name, status: communityGroupMembers.status, joinedAt: communityGroupMembers.joinedAt, removedReason: communityGroupMembers.removedReason })
    .from(communityGroupMembers)
    .innerJoin(users, eq(users.id, communityGroupMembers.userId))
    .where(eq(communityGroupMembers.groupId, groupId))
    .orderBy(asc(communityGroupMembers.joinedAt))
    .limit(500);
  return { members: rows.map((r) => ({ userId: r.userId, name: r.name, status: r.status, joinedAt: r.joinedAt.toISOString(), removedReason: r.removedReason })) };
}

export const removeSchema = z.object({ removed: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();
export async function setMemberRemoved(ctx: AuthContext, groupId: string, userId: string, input: { removed: boolean; reason?: string }, meta: Meta) {
  await requirePermission(ctx, "groups.manage");
  await getGroupOr404(groupId);
  const m = await membership(groupId, userId);
  if (!m) throw new NotFoundError("This member is not in the group.");
  const reason = input.reason?.trim() || null;
  if (input.removed) {
    if (!reason || reason.length < 5) throw new ValidationError("Removing a member needs a reason of at least 5 characters (kept in the audit log).");
    if (m.status === "REMOVED") throw new ConflictError("This member is already removed.");
    await db.update(communityGroupMembers).set({ status: "REMOVED", removedAt: new Date(), removedByAdminId: ctx.subject.id, removedReason: reason }).where(eq(communityGroupMembers.id, m.id));
    await notify({ userId, channel: "IN_APP", title: "Removed from a group", body: "A moderator removed you from a community group.", dedupeKey: `group_removed:${m.id}:${Date.now()}` });
  } else {
    if (m.status !== "REMOVED") throw new ConflictError("This member is not removed.");
    // Restoring simply deletes the block; the member can join again on their own.
    await db.delete(communityGroupMembers).where(eq(communityGroupMembers.id, m.id));
  }
  await record({ ...auditBase(ctx, meta), action: input.removed ? "group_member.removed" : "group_member.restored", entityType: "community_group", entityId: groupId, metadata: { userId, reason } });
  return { userId, removed: input.removed };
}
