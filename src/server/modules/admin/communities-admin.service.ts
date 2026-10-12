/**
 * B18: Super-Admin management of the community / caste pick-list (`communities.manage`).
 * A "community" here is the lookup members choose on their profile (within a religion) —
 * the product has no social groups, feeds or group chat, and this screen does not pretend otherwise.
 * Nothing is ever deleted: a retired community disappears from pick-lists and can't be newly chosen,
 * while profiles that already use it keep it (and search by it keeps working).
 */
import { and, count, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { communities, profiles, religions } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { escapeLike } from "./users-admin.repository";

const PERMISSION = "communities.manage";

export interface AuditMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminCommunityView {
  id: string;
  name: string;
  religionId: string | null;
  religionName: string | null;
  isActive: boolean;
  profileCount: number;
  createdAt: string;
}

export interface ListCommunitiesInput {
  religionId?: string;
  q?: string;
  active?: "true" | "false";
  page?: number;
  pageSize?: number;
}

const MAX_PAGE = 100;

export async function listCommunitiesForAdmin(ctx: AuthContext, input: ListCommunitiesInput) {
  await requirePermission(ctx, PERMISSION);
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? 50, MAX_PAGE);
  const conds = [];
  if (input.religionId) conds.push(eq(communities.religionId, input.religionId));
  if (input.q) conds.push(ilike(communities.name, `%${escapeLike(input.q)}%`));
  if (input.active) conds.push(eq(communities.isActive, input.active === "true"));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, total] = await Promise.all([
    db
      .select({
        id: communities.id,
        name: communities.name,
        religionId: communities.religionId,
        religionName: religions.name,
        isActive: communities.isActive,
        createdAt: communities.createdAt,
        profileCount: sql<number>`(SELECT count(*)::int FROM ${profiles} p WHERE p.community_id = ${communities.id})`,
      })
      .from(communities)
      .leftJoin(religions, eq(religions.id, communities.religionId))
      .where(where)
      .orderBy(religions.name, communities.name, communities.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: count() }).from(communities).where(where),
  ]);
  const t = Number(total[0]?.c ?? 0);
  return {
    items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), profileCount: Number(r.profileCount) })) as AdminCommunityView[],
    page,
    pageSize,
    total: t,
    totalPages: Math.max(1, Math.ceil(t / pageSize)),
  };
}

async function nameTaken(name: string, religionId: string | null, exceptId?: string): Promise<boolean> {
  const rows = await db.select({ id: communities.id, name: communities.name }).from(communities).where(religionId ? eq(communities.religionId, religionId) : sql`${communities.religionId} IS NULL`);
  return rows.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === name.trim().toLowerCase());
}

async function view(id: string): Promise<AdminCommunityView> {
  const page = await db
    .select({
      id: communities.id,
      name: communities.name,
      religionId: communities.religionId,
      religionName: religions.name,
      isActive: communities.isActive,
      createdAt: communities.createdAt,
      profileCount: sql<number>`(SELECT count(*)::int FROM ${profiles} p WHERE p.community_id = ${communities.id})`,
    })
    .from(communities)
    .leftJoin(religions, eq(religions.id, communities.religionId))
    .where(eq(communities.id, id))
    .limit(1);
  const r = page[0];
  if (!r) throw new NotFoundError("Community not found.");
  return { ...r, createdAt: r.createdAt.toISOString(), profileCount: Number(r.profileCount) };
}

export async function createCommunity(ctx: AuthContext, input: { name: string; religionId: string }, meta: AuditMeta): Promise<AdminCommunityView> {
  await requirePermission(ctx, PERMISSION);
  const [religion] = await db.select({ id: religions.id }).from(religions).where(eq(religions.id, input.religionId)).limit(1);
  if (!religion) throw new ValidationError("religionId does not reference a known religion.");
  if (await nameTaken(input.name, input.religionId)) throw new ConflictError("This religion already has a community with that name.");
  const [row] = await db.insert(communities).values({ name: input.name, religionId: input.religionId }).returning();
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "community.created",
    entityType: "community",
    entityId: row.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { name: row.name, religionId: row.religionId },
  });
  return view(row.id);
}

export async function updateCommunity(ctx: AuthContext, id: string, input: { name?: string; isActive?: boolean }, meta: AuditMeta): Promise<AdminCommunityView> {
  await requirePermission(ctx, PERMISSION);
  const [cur] = await db.select().from(communities).where(eq(communities.id, id)).limit(1);
  if (!cur) throw new NotFoundError("Community not found.");
  const name = input.name ?? cur.name;
  if (input.name && (await nameTaken(input.name, cur.religionId, id))) throw new ConflictError("This religion already has a community with that name.");
  const isActive = input.isActive ?? cur.isActive;
  await db.update(communities).set({ name, isActive }).where(eq(communities.id, id));

  const changed: Record<string, { previous: unknown; new: unknown }> = {};
  if (name !== cur.name) changed.name = { previous: cur.name, new: name };
  if (isActive !== cur.isActive) changed.isActive = { previous: cur.isActive, new: isActive };
  if (Object.keys(changed).length) {
    const action = changed.isActive && !changed.name ? (isActive ? "community.restored" : "community.retired") : "community.renamed";
    await record({
      actorType: "ADMIN",
      actorId: ctx.subject.id,
      actorRole: ctx.adminRoleName,
      action,
      entityType: "community",
      entityId: id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { changed },
    });
  }
  return view(id);
}
