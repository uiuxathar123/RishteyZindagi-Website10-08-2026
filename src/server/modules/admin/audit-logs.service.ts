/**
 * B9: admin audit-log read access. Gated behind a NEW permission,
 * `audit.view` — neither `staff.manage` (about managing staff accounts,
 * not viewing activity logs) nor `users.view` (about member accounts,
 * not platform-wide admin activity) fits this action's actual blast
 * radius: audit logs can reveal every admin's activity across the whole
 * platform (who verified which profile, who manually activated which
 * payment, who issued which warning), which is a materially broader
 * visibility than either existing permission implies. SUPER_ADMIN-only
 * by default (not added to STAFF_ADMIN_DEFAULT_PERMISSIONS in seed.ts) —
 * the master brief's "do not grant STAFF_ADMIN broad access simply for
 * convenience" instruction applies directly here.
 */
import { ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import * as repo from "./audit-logs.repository";
import type { AuditLogRow } from "./audit-logs.repository";

const PERMISSION = "audit.view";

export interface ListAuditLogsInput {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogsPage {
  items: AuditLogRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export async function listAuditLogsForAdmin(ctx: AuthContext, input: ListAuditLogsInput): Promise<AuditLogsPage> {
  await requirePermission(ctx, PERMISSION);

  const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined;
  const dateTo = input.dateTo ? new Date(input.dateTo) : undefined;
  if (dateFrom && Number.isNaN(dateFrom.getTime())) throw new ValidationError("Invalid dateFrom.");
  if (dateTo && Number.isNaN(dateTo.getTime())) throw new ValidationError("Invalid dateTo.");

  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { items, total } = await repo.listAuditLogs(
    { actorId: input.actorId, action: input.action, entityType: input.entityType, entityId: input.entityId, dateFrom, dateTo },
    page,
    pageSize
  );
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
