/**
 * B9: HTTP layer for the admin user search/list/detail endpoints.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as usersAdminService from "./users-admin.service";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const listUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED_PENDING", "DELETED", "BLOCKED"]).optional(),
  verificationStatus: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listUsersHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listUsersQuerySchema.safeParse({
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
    verificationStatus: sp.get("verificationStatus") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const page = await usersAdminService.searchUsersForAdmin(ctx, parsed.data);
  return ok(page);
}

const userParamsSchema = z.object({ userId: uuidField });

export async function getUserDetailHandler(req: NextRequest, params: { userId: string }) {
  const ctx = await authenticate(req);
  const { userId } = parseParams(userParamsSchema, params);
  const detail = await usersAdminService.getUserDetailForAdmin(ctx, userId);
  return ok({ user: detail });
}
