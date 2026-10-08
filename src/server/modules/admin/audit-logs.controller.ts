/**
 * B9: HTTP layer for the admin audit-log read endpoint.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as auditLogsService from "./audit-logs.service";

const uuidField = z.string().uuid();

const listAuditLogsQuerySchema = z.object({
  actorId: uuidField.optional(),
  action: z.string().trim().min(1).optional(),
  entityType: z.string().trim().min(1).optional(),
  entityId: uuidField.optional(),
  dateFrom: z.string().datetime().optional().or(z.string().date().optional()),
  dateTo: z.string().datetime().optional().or(z.string().date().optional()),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listAuditLogsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listAuditLogsQuerySchema.safeParse({
    actorId: sp.get("actorId") ?? undefined,
    action: sp.get("action") ?? undefined,
    entityType: sp.get("entityType") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const page = await auditLogsService.listAuditLogsForAdmin(ctx, parsed.data);
  return ok(page);
}
