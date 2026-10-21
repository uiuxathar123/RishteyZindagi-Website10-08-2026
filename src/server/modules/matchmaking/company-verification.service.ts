/**
 * "Company Verified" — a profile review decided only by a Super Admin (role checked by name, temporary passwords
 * refused). It is separate from the staff profile verification (`profiles.verificationStatus`, permission
 * "profiles.verify") and is never set as a side effect of anything else, such as choosing a profile for an
 * introduction.
 *
 *   NONE | REJECTED | REVOKED -> PENDING (review opened)
 *   PENDING -> APPROVED | REJECTED
 *   APPROVED -> REVOKED
 *
 * Only APPROVED shows the "Company Verified" badge. The latest decision's reviewer and time are kept on the profile;
 * every change (with its note) is written to the audit log, which is the review history.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminUsers, auditLogs, profiles } from "@/server/db/schema";
import { ConflictError, NotFoundError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireSuperAdmin } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import type { AdminMeta } from "./matchmaking-admin.service";

export const COMPANY_VERIFICATION_STATUSES = ["NONE", "PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;
export type CompanyVerificationStatus = (typeof COMPANY_VERIFICATION_STATUSES)[number];
export type CompanyVerificationDecision = Exclude<CompanyVerificationStatus, "NONE">;

export const COMPANY_VERIFIED_LABEL = "Company Verified";
export const COMPANY_VERIFICATION_AUDIT_ACTION = "profile.company_verification_changed";

/** Which current statuses each decision may be taken from. */
const ALLOWED_FROM: Record<CompanyVerificationDecision, CompanyVerificationStatus[]> = {
  PENDING: ["NONE", "REJECTED", "REVOKED"],
  APPROVED: ["PENDING"],
  REJECTED: ["PENDING"],
  REVOKED: ["APPROVED"],
};

export function isCompanyVerified(status: string | null | undefined): boolean {
  return status === "APPROVED";
}

export interface CompanyVerificationView {
  userId: string;
  profileId: string;
  status: CompanyVerificationStatus;
  reviewedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
  history: Array<{
    id: string;
    from: string | null;
    to: string | null;
    note: string | null;
    reviewer: { id: string; name: string } | null;
    createdAt: string;
  }>;
}

async function loadProfile(userId: string) {
  const profile = await profilesRepo.findByUserId(userId);
  if (!profile) throw new NotFoundError("Profile not found.");
  return profile;
}

export async function getCompanyVerification(ctx: AuthContext, userId: string): Promise<CompanyVerificationView> {
  requireSuperAdmin(ctx);
  const profile = await loadProfile(userId);
  const entries = await db
    .select({ id: auditLogs.id, actorId: auditLogs.actorId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "profile"), eq(auditLogs.entityId, profile.id), eq(auditLogs.action, COMPANY_VERIFICATION_AUDIT_ACTION)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);
  const adminIds = [...new Set([...entries.map((e) => e.actorId), profile.companyVerificationReviewedByAdminId].filter((v): v is string => !!v))];
  const admins = adminIds.length ? await db.select({ id: adminUsers.id, name: adminUsers.name }).from(adminUsers).where(inArray(adminUsers.id, adminIds)) : [];
  const byId = new Map(admins.map((a) => [a.id, a]));
  return {
    userId,
    profileId: profile.publicId,
    status: profile.companyVerificationStatus as CompanyVerificationStatus,
    reviewedAt: profile.companyVerificationReviewedAt ? profile.companyVerificationReviewedAt.toISOString() : null,
    reviewedBy: profile.companyVerificationReviewedByAdminId ? byId.get(profile.companyVerificationReviewedByAdminId) ?? null : null,
    history: entries.map((e) => {
      const m = (e.metadata ?? {}) as { from?: string; to?: string; note?: string | null };
      return {
        id: e.id,
        from: m.from ?? null,
        to: m.to ?? null,
        note: m.note ?? null,
        reviewer: e.actorId ? byId.get(e.actorId) ?? null : null,
        createdAt: e.createdAt.toISOString(),
      };
    }),
  };
}

export async function decideCompanyVerification(
  ctx: AuthContext,
  userId: string,
  input: { status: CompanyVerificationDecision; note?: string },
  meta: AdminMeta
): Promise<CompanyVerificationView> {
  requireSuperAdmin(ctx);
  const profile = await loadProfile(userId);
  const from = profile.companyVerificationStatus as CompanyVerificationStatus;
  const allowed = ALLOWED_FROM[input.status];
  if (!allowed.includes(from)) {
    throw new ConflictError(
      input.status === "APPROVED"
        ? "Open a review before approving: a profile can only be marked Company Verified from a pending review."
        : `This change is not allowed while the review is ${from.toLowerCase()}.`,
      { currentStatus: from }
    );
  }
  const now = new Date();
  // Compare-and-swap on the current status, so two reviewers acting at once cannot both apply a decision. The
  // profile's own updatedAt is left alone: this is an admin decision, not a change the member made.
  const [updated] = await db
    .update(profiles)
    .set({ companyVerificationStatus: input.status, companyVerificationReviewedAt: now, companyVerificationReviewedByAdminId: ctx.subject.id })
    .where(and(eq(profiles.id, profile.id), eq(profiles.companyVerificationStatus, from)))
    .returning({ id: profiles.id });
  if (!updated) throw new ConflictError("The review changed while you were deciding. Reload and try again.");

  const note = input.note?.trim() || null;
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: COMPANY_VERIFICATION_AUDIT_ACTION,
    entityType: "profile",
    entityId: profile.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { userId, from, to: input.status, note },
  });
  if (input.status === "APPROVED") {
    await notify({
      userId,
      channel: "IN_APP",
      title: "Your profile is Company Verified",
      body: "Our team has reviewed your profile. The Company Verified badge now shows on your profile.",
      dedupeKey: `company_verified:${profile.id}:${now.getTime()}`,
    });
  }
  return getCompanyVerification(ctx, userId);
}
