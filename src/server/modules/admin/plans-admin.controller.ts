import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { ValidationError } from "@/server/lib/errors";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./plans-admin.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });

const price = z.number().int().min(100, "Price must be at least 1.00 (100 in the smallest unit).").max(svc.MAX_PRICE);

const createBody = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,40}$/, "Code: 3–40 letters, digits or underscores."),
    name: z.string().trim().min(2).max(80),
    currency: z.enum(["INR", "USD"]),
    priceInSmallestUnit: price,
    durationDays: z.number().int().min(1).max(730),
    advancedSearch: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const updateBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    priceInSmallestUnit: price.optional(),
    advancedSearch: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

const params = z.object({ planId: z.string().uuid() });

export async function listPlansHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.listPlansForAdmin(ctx));
}

export async function createPlanHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`plan-write:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, createBody);
  return ok({ plan: await svc.createPlan(ctx, body, meta(req)) }, "Plan created.");
}

export async function updatePlanHandler(req: NextRequest, rawParams: { planId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`plan-write:${ctx.subject.id}`, 30, 60_000);
  const p = params.safeParse(rawParams);
  if (!p.success) throw new ValidationError("planId must be a valid id.");
  const body = await parseJsonBody(req, updateBody);
  return ok({ plan: await svc.updatePlan(ctx, p.data.planId, body, meta(req)) }, "Plan saved.");
}
