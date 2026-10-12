/**
 * B19: manual profile-approval queue (admin side).
 *
 * The Super Admin switch lives in platform-settings (`profile.approval`). When it is ON, a profile that becomes
 * READY_FOR_VISIBILITY for the first time is stored as approval_status = PENDING and is invisible everywhere
 * (search, recommendations, profile page, photos, new interactions) until an admin decides. REJECTED stays hidden and
 * the owner sees the reason. The decision is a conditional UPDATE so two admins deciding at once cannot both win.
 * Permission: `profiles.approve` (Super Admin by default; delegable to staff).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { profiles, users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";

type Meta = { ipAddress?: string | null; userAgent?: string | null };
export type ApprovalFilter = "PENDING" | "REJECTED" | "APPROVED";

export interface ApprovalQueueItem {
  profileId: string;
  publicId: string;
  userId: string;
  displayName: string;
  gender: string;
  profileCompletionPercent: number;
  approvalStatus: string;
  approvalReason: string | null;
  approvalDecidedAt: string | null;
  submittedAt: string;
}

export async function listApprovalQueue(ctx: AuthContext, input: { status?: string; page?: number; pageSize?: number }) {
  await requirePermission(ctx, "profiles.approve");
  const status = (input.status ?? "PENDING") as ApprovalFilter;
  if (!["PENDING", "REJECTED", "APPROVED"].includes(status)) throw new ValidationError("status must be PENDING, REJECTED or APPROVED.");
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const where = and(eq(profiles.approvalStatus, status), eq(profiles.profileStatus, "READY_FOR_VISIBILITY"), eq(users.status, "ACTIVE"));
  const [rows, [{ c }]] = await Promise.all([
    db
      .select({ p: profiles, name: users.name })
      .from(profiles)
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(where)
      .orderBy(status === "PENDING" ? asc(profiles.updatedAt) : desc(profiles.approvalDecidedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: sql<number>`count(*)::int` }).from(profiles).innerJoin(users, eq(profiles.userId, users.id)).where(where),
  ]);
  const items: ApprovalQueueItem[] = rows.map(({ p, name }) => ({
    profileId: p.id,
    publicId: p.publicId,
    userId: p.userId,
    displayName: name,
    gender: p.gender,
    profileCompletionPercent: p.profileCompletionPercent,
    approvalStatus: p.approvalStatus,
    approvalReason: p.approvalReason ?? null,
    approvalDecidedAt: p.approvalDecidedAt ? p.approvalDecidedAt.toISOString() : null,
    submittedAt: p.updatedAt.toISOString(),
  }));
  return { items, page, pageSize, total: c, status };
}

export async function decideApproval(
  ctx: AuthContext,
  profileId: string,
  input: { decision: string; reason?: string },
  meta: Meta
): Promise<ApprovalQueueItem> {
  await requirePermission(ctx, "profiles.approve");
  if (input.decision !== "APPROVE" && input.decision !== "REJECT") throw new ValidationError("decision must be APPROVE or REJECT.");
  const reason = input.reason?.trim() || null;
  if (input.decision === "REJECT" && (!reason || reason.length < 5)) {
    throw new ValidationError("Rejecting a profile needs a reason of at least 5 characters; the member is shown it.");
  }
  const [existing] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!existing) throw new NotFoundError("Profile not found.");

  const next = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const now = new Date();
  // Conditional update: only a PENDING (or previously decided, for a re-review) profile of a ready profile may change,
  // and a no-op re-decision is reported rather than silently accepted.
  const [row] = await db
    .update(profiles)
    .set({ approvalStatus: next, approvalDecidedAt: now, approvalDecidedByAdminId: ctx.subject.id, approvalReason: next === "REJECTED" ? reason : null, updatedAt: now })
    .where(and(eq(profiles.id, profileId), eq(profiles.profileStatus, "READY_FOR_VISIBILITY"), sql`${profiles.approvalStatus} <> ${next}`))
    .returning();
  if (!row) throw new ConflictError(existing.profileStatus !== "READY_FOR_VISIBILITY" ? "Only a complete profile with a photo can be decided." : `This profile is already ${next.toLowerCase()}.`);

  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: next === "APPROVED" ? "profile.approved" : "profile.rejected",
    entityType: "profile",
    entityId: profileId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { previous: existing.approvalStatus, new: next, reason },
  });
  await notify({
    userId: row.userId,
    channel: "IN_APP",
    title: next === "APPROVED" ? "Your profile is live" : "Your profile needs changes",
    body: next === "APPROVED" ? "Our team approved your profile. Other members can now find it." : `Our team could not approve your profile yet. Reason: ${reason}`,
    dedupeKey: `profile_${next.toLowerCase()}:${profileId}:${now.getTime()}`,
    essential: true,
  });
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1);
  return {
    profileId: row.id,
    publicId: row.publicId,
    userId: row.userId,
    displayName: u?.name ?? "",
    gender: row.gender,
    profileCompletionPercent: row.profileCompletionPercent,
    approvalStatus: row.approvalStatus,
    approvalReason: row.approvalReason ?? null,
    approvalDecidedAt: row.approvalDecidedAt ? row.approvalDecidedAt.toISOString() : null,
    submittedAt: row.updatedAt.toISOString(),
  };
}

export async function pendingApprovalCount(): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(profiles).where(and(eq(profiles.approvalStatus, "PENDING"), eq(profiles.profileStatus, "READY_FOR_VISIBILITY")));
  return c;
}
