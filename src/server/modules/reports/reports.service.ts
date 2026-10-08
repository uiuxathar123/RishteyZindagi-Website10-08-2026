/**
 * B6: Report / report-category / auto-suspension business rules.
 *
 * Documented judgment calls (see BACKEND.md's B6 section for the full
 * write-up):
 *  - A normal report review (Dismiss) NEVER auto-warns/suspends/bans —
 *    the ONLY automatic suspension trigger is the 5-unique-reporter
 *    threshold below, a distinct system mechanism from manual review.
 *  - The threshold counts DISTINCT `reporterUserId` values, so the same
 *    user reporting the same target five times never triggers it.
 *  - "Since the last lift" is enforced by only counting `reports` rows
 *    created after the most recent `account_suspensions.liftedAt` for
 *    that user (or all-time if never suspended) — see
 *    reports.repository.ts's `countUniqueReportersSince`.
 *  - Reports and report categories are NEVER hard-deleted — a category
 *    is disabled (`isActive: false`), a report's history is permanent.
 */
import { NotFoundError, AuthorizationError, ConflictError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record as recordAudit } from "@/server/modules/audit/audit.service";
import * as repo from "./reports.repository";
import type { ReportRow, ReportCategoryRow, ReportStatus } from "./reports.repository";

const REPORTS_PERMISSION = "reports.resolve";
const CATEGORIES_PERMISSION = "reports.categories.manage";
const SUSPEND_PERMISSION = "users.suspend";

/** The report-threshold rule's fixed number — 5 UNIQUE reporting users,
 * not 5 reports (see reports.repository.ts's countUniqueReportersSince). */
export const REPORT_SUSPENSION_THRESHOLD = 5;

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

// ---------------------------------------------------------------------------
// Member-facing: file a report, list categories
// ---------------------------------------------------------------------------

export async function listReportableCategories(): Promise<ReportCategoryRow[]> {
  return repo.listActiveReportCategories();
}

export interface FileReportInput {
  reportedUserId: string;
  categoryId: string;
  description?: string;
}

export async function fileReport(ctx: AuthContext, input: FileReportInput): Promise<ReportRow> {
  const reporterUserId = requireMemberSubject(ctx);
  if (reporterUserId === input.reportedUserId) {
    throw new ValidationError("You cannot report your own account.");
  }

  const reportedAccountStatus = await repo.findUserAccountStatus(input.reportedUserId);
  if (!reportedAccountStatus) throw new NotFoundError("User not found.");

  const category = await repo.findReportCategoryById(input.categoryId);
  if (!category || !category.isActive) {
    throw new ValidationError("Invalid or inactive report category.");
  }

  const report = await repo.createReport({
    reporterUserId,
    reportedUserId: input.reportedUserId,
    categoryId: input.categoryId,
    description: input.description,
  });

  await maybeAutoSuspend(input.reportedUserId);

  return report;
}

/**
 * The auto-suspension check, run after every new report. Idempotent by
 * construction: if the account is already suspended (an active,
 * un-lifted `account_suspensions` row exists), this is a no-op — a 6th,
 * 7th, ... unique reporter while already suspended doesn't create a
 * second suspension row.
 */
async function maybeAutoSuspend(reportedUserId: string): Promise<void> {
  const activeSuspension = await repo.findActiveSuspension(reportedUserId);
  if (activeSuspension) return; // already suspended — nothing to do

  const latestSuspension = await repo.findLatestSuspension(reportedUserId);
  const sinceExclusive = latestSuspension?.liftedAt ?? null;
  const uniqueReporters = await repo.countUniqueReportersSince(reportedUserId, sinceExclusive);

  if (uniqueReporters >= REPORT_SUSPENSION_THRESHOLD) {
    const created = await repo.createSuspension(reportedUserId, `Automatic suspension: ${uniqueReporters} unique reports received.`);
    if (!created) {
      // B10: lost the race — a concurrent report submission's own
      // maybeAutoSuspend already created the (sole, DB-enforced) active
      // suspension row for this user between our findActiveSuspension
      // read above and this insert (see reports.repository.ts's
      // createSuspension doc comment). That winning call already set the
      // account status and wrote the audit entry — nothing left to do
      // here, and nothing was double-suspended or double-logged.
      return;
    }
    await repo.setUserAccountStatus(reportedUserId, "SUSPENDED");
    await recordAudit({
      actorType: "SYSTEM",
      action: "account.auto_suspended",
      entityType: "user",
      entityId: reportedUserId,
      metadata: { uniqueReporters, threshold: REPORT_SUSPENSION_THRESHOLD },
    });
  }
}

// ---------------------------------------------------------------------------
// Admin: report review
// ---------------------------------------------------------------------------

export interface ListReportsInput {
  status?: ReportStatus;
  reportedUserId?: string;
  page?: number;
  pageSize?: number;
}

export interface ReportsPage {
  items: ReportRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export async function listReportsForAdmin(ctx: AuthContext, input: ListReportsInput): Promise<ReportsPage> {
  await requirePermission(ctx, REPORTS_PERMISSION);
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { items, total } = await repo.listReports({ status: input.status, reportedUserId: input.reportedUserId }, page, pageSize);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Admin action: OPEN -> DISMISSED only (see this file's top-of-file
 * comment — this never triggers a warning/suspension by itself). */
export async function dismissReport(ctx: AuthContext, reportId: string, meta: { ipAddress?: string | null; userAgent?: string | null }): Promise<ReportRow> {
  await requirePermission(ctx, REPORTS_PERMISSION);
  const existing = await repo.findReportById(reportId);
  if (!existing) throw new NotFoundError("Report not found.");
  if (existing.status === "DISMISSED") return existing; // idempotent

  const updated = await repo.dismissReport(reportId, ctx.subject.id);
  if (!updated) throw new NotFoundError("Report not found.");

  await recordAudit({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "report.dismiss",
    entityType: "report",
    entityId: reportId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { reportedUserId: existing.reportedUserId },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Admin: report category management (add/edit/disable — never delete)
// ---------------------------------------------------------------------------

export async function listAllCategoriesForAdmin(ctx: AuthContext): Promise<ReportCategoryRow[]> {
  await requirePermission(ctx, CATEGORIES_PERMISSION);
  return repo.listAllReportCategories();
}

export async function createCategory(
  ctx: AuthContext,
  input: { name: string; description?: string },
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<ReportCategoryRow> {
  await requirePermission(ctx, CATEGORIES_PERMISSION);
  const category = await repo.createReportCategory(input);
  await recordAudit({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "report_category.create",
    entityType: "report_category",
    entityId: category.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { name: category.name },
  });
  return category;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

/** Edit or Disable (never delete — `reports.category_id` FK-references
 * this table, and history must be preserved). */
export async function updateCategory(
  ctx: AuthContext,
  categoryId: string,
  input: UpdateCategoryInput,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<ReportCategoryRow> {
  await requirePermission(ctx, CATEGORIES_PERMISSION);
  const existing = await repo.findReportCategoryById(categoryId);
  if (!existing) throw new NotFoundError("Report category not found.");

  const updated = await repo.updateReportCategory(categoryId, input);
  if (!updated) throw new NotFoundError("Report category not found.");

  await recordAudit({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "report_category.update",
    entityType: "report_category",
    entityId: categoryId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { before: { name: existing.name, description: existing.description, isActive: existing.isActive }, after: input },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Admin: lift suspension
// ---------------------------------------------------------------------------

export async function liftSuspension(
  ctx: AuthContext,
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<void> {
  await requirePermission(ctx, SUSPEND_PERMISSION);

  const activeSuspension = await repo.findActiveSuspension(userId);
  if (!activeSuspension) {
    throw new ConflictError("This account does not have an active suspension to lift.");
  }

  await repo.liftSuspension(activeSuspension.id, ctx.subject.id);
  await repo.setUserAccountStatus(userId, "ACTIVE");

  await recordAudit({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "account.suspension_lifted",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { suspensionId: activeSuspension.id },
  });
}
