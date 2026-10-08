/**
 * B9: HTTP layer for the admin membership list/filter endpoint.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as membershipsAdminService from "./memberships-admin.service";

const uuidField = z.string().uuid();

const listMembershipsQuerySchema = z.object({
  userId: uuidField.optional(),
  status: z.enum(["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"]).optional(),
  planId: uuidField.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listMembershipsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listMembershipsQuerySchema.safeParse({
    userId: sp.get("userId") ?? undefined,
    status: sp.get("status") ?? undefined,
    planId: sp.get("planId") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const page = await membershipsAdminService.listMembershipsForAdmin(ctx, parsed.data);
  return ok(page);
}
