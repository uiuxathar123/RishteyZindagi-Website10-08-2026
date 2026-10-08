/**
 * B6: Warning business rules — admin-only issuance, notification-only
 * (no automatic account restriction), permanent history.
 *
 * Documented judgment call (acknowledgement semantics): acknowledgement
 * requires an EXPLICIT action from the recipient (`POST
 * /warnings/:warningId/acknowledge`), not an automatic side effect of
 * viewing/listing warnings. Chosen over "auto-acknowledge on view"
 * because a warning is a compliance-relevant record — the recipient
 * should have to affirmatively acknowledge it, not have that inferred
 * from a GET request they might not even render to the user. The
 * message/category/issuer are never mutated by acknowledgement — only
 * `status`/`acknowledgedAt` change, and the row itself is never deleted.
 */
import { NotFoundError, AuthorizationError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record as recordAudit } from "@/server/modules/audit/audit.service";
// B7: additive notification-dispatch call into this already-existing B6
// service — see issueWarning below and BACKEND.md's B7 section.
import { notify } from "@/server/modules/notifications/notifications.service";
import * as repo from "./warnings.repository";
import type { WarningRow, WarningCategoryRow } from "./warnings.repository";
import * as reportsRepo from "@/server/modules/reports/reports.repository";

const WARNINGS_PERMISSION = "warnings.issue";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

// --- Admin --------------------------------------------------------------

export async function listWarningCategoriesForAdmin(ctx: AuthContext): Promise<WarningCategoryRow[]> {
  await requirePermission(ctx, WARNINGS_PERMISSION);
  return repo.listWarningCategories();
}

export interface IssueWarningInput {
  categoryId: string;
  message: string;
}

export async function issueWarning(
  ctx: AuthContext,
  targetUserId: string,
  input: IssueWarningInput,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<WarningRow> {
  await requirePermission(ctx, WARNINGS_PERMISSION);

  const accountStatus = await reportsRepo.findUserAccountStatus(targetUserId);
  if (!accountStatus) throw new NotFoundError("User not found.");

  const category = await repo.findWarningCategoryById(input.categoryId);
  if (!category) throw new ValidationError("Invalid warning category.");

  const warning = await repo.createWarning({
    userId: targetUserId,
    categoryId: input.categoryId,
    issuedByAdminId: ctx.subject.id,
    message: input.message,
  });

  await recordAudit({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "warning.issue",
    entityType: "warning",
    entityId: warning.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId, categoryId: input.categoryId },
  });

  // B6 spec: "notification-only (no automatic restriction)". B7 fills the
  // hook this comment used to mark — best-effort (notify() never throws),
  // never restricting the account by itself, exactly as before.
  await notify({
    userId: targetUserId,
    channel: "IN_APP",
    title: "You have received a warning",
    body: input.message,
    dedupeKey: `warning_issued:${warning.id}`,
  });

  return warning;
}

export async function listWarningsForUserAdmin(ctx: AuthContext, targetUserId: string): Promise<WarningRow[]> {
  await requirePermission(ctx, WARNINGS_PERMISSION);
  const accountStatus = await reportsRepo.findUserAccountStatus(targetUserId);
  if (!accountStatus) throw new NotFoundError("User not found.");
  return repo.listWarningsForUser(targetUserId);
}

// --- Member --------------------------------------------------------------

export async function listMyWarnings(ctx: AuthContext): Promise<WarningRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listWarningsForUser(userId);
}

export async function acknowledgeWarning(ctx: AuthContext, warningId: string): Promise<WarningRow> {
  const userId = requireMemberSubject(ctx);
  const warning = await repo.findWarningById(warningId);
  if (!warning || warning.userId !== userId) {
    throw new AuthorizationError("You do not have permission to acknowledge this warning.");
  }
  if (warning.acknowledgedAt) return warning; // idempotent

  const updated = await repo.acknowledgeWarning(warningId);
  return updated!;
}
