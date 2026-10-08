/**
 * B6: HTTP layer for warnings (member self-view + acknowledge; admin
 * issue + view-any-user's-history + category listing).
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok, created } from "@/server/lib/response";
import * as warningsService from "./warnings.service";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

function requestMeta(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
}

// --- Member ------------------------------------------------------------

export async function listMyWarningsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const warnings = await warningsService.listMyWarnings(ctx);
  return ok({ warnings });
}

const warningParamsSchema = z.object({ warningId: uuidField });

export async function acknowledgeWarningHandler(req: NextRequest, params: { warningId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`warning-ack:${ctx.subject.id}`, 30, 60_000);
  const { warningId } = parseParams(warningParamsSchema, params);
  const warning = await warningsService.acknowledgeWarning(ctx, warningId);
  return ok({ warning }, "Warning acknowledged.");
}

// --- Admin ---------------------------------------------------------------

export async function listWarningCategoriesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const categories = await warningsService.listWarningCategoriesForAdmin(ctx);
  return ok({ categories });
}

const userParamsSchema = z.object({ userId: uuidField });
const issueWarningSchema = z.object({ categoryId: uuidField, message: z.string().trim().min(1).max(2000) }).strict();

export async function issueWarningHandler(req: NextRequest, params: { userId: string }) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  checkRateLimit(`warning-issue:${ctx.subject.id}`, 30, 60_000);
  const { userId } = parseParams(userParamsSchema, params);
  const body = await parseJsonBody(req, issueWarningSchema);
  const warning = await warningsService.issueWarning(ctx, userId, body, meta);
  return created({ warning }, "Warning issued.");
}

export async function listWarningsForUserHandler(req: NextRequest, params: { userId: string }) {
  const ctx = await authenticate(req);
  const { userId } = parseParams(userParamsSchema, params);
  const warnings = await warningsService.listWarningsForUserAdmin(ctx, userId);
  return ok({ warnings });
}
