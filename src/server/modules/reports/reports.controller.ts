/**
 * B6: HTTP layer for reports, report categories, and suspension lift.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok, created } from "@/server/lib/response";
import * as reportsService from "./reports.service";

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

// --- Member-facing -----------------------------------------------------

export async function listReportCategoriesHandler(req: NextRequest) {
  await authenticate(req); // any signed-in member — only a member can file a report
  const categories = await reportsService.listReportableCategories();
  return ok({ categories });
}

const fileReportSchema = z
  .object({
    reportedUserId: uuidField,
    categoryId: uuidField,
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export async function fileReportHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`report-file:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, fileReportSchema);
  const report = await reportsService.fileReport(ctx, body);
  return created({ report }, "Report submitted.");
}

// --- Admin: report review -------------------------------------------------

const listReportsQuerySchema = z.object({
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]).optional(),
  reportedUserId: uuidField.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listReportsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listReportsQuerySchema.safeParse({
    status: sp.get("status") ?? undefined,
    reportedUserId: sp.get("reportedUserId") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const page = await reportsService.listReportsForAdmin(ctx, parsed.data);
  return ok(page);
}

const reportParamsSchema = z.object({ reportId: uuidField });
const dismissReportSchema = z.object({ status: z.literal("DISMISSED") }).strict();

export async function dismissReportHandler(req: NextRequest, params: { reportId: string }) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  checkRateLimit(`report-dismiss:${ctx.subject.id}`, 60, 60_000);
  const { reportId } = parseParams(reportParamsSchema, params);
  await parseJsonBody(req, dismissReportSchema);
  const report = await reportsService.dismissReport(ctx, reportId, meta);
  return ok({ report }, "Report dismissed.");
}

// --- Admin: report categories ---------------------------------------------

export async function listAllReportCategoriesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const categories = await reportsService.listAllCategoriesForAdmin(ctx);
  return ok({ categories });
}

const createCategorySchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional() }).strict();

export async function createReportCategoryHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  checkRateLimit(`report-category-write:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, createCategorySchema);
  const category = await reportsService.createCategory(ctx, body, meta);
  return created({ category }, "Report category created.");
}

const categoryParamsSchema = z.object({ categoryId: uuidField });
const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function updateReportCategoryHandler(req: NextRequest, params: { categoryId: string }) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  checkRateLimit(`report-category-write:${ctx.subject.id}`, 30, 60_000);
  const { categoryId } = parseParams(categoryParamsSchema, params);
  const body = await parseJsonBody(req, updateCategorySchema);
  const category = await reportsService.updateCategory(ctx, categoryId, body, meta);
  return ok({ category }, "Report category updated.");
}

// --- Admin: lift suspension -------------------------------------------

const userParamsSchema = z.object({ userId: uuidField });

export async function liftSuspensionHandler(req: NextRequest, params: { userId: string }) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  checkRateLimit(`suspension-lift:${ctx.subject.id}`, 30, 60_000);
  const { userId } = parseParams(userParamsSchema, params);
  await reportsService.liftSuspension(ctx, userId, meta);
  return ok({ userId }, "Suspension lifted.");
}
