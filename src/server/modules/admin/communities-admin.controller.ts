import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { ValidationError } from "@/server/lib/errors";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./communities-admin.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const name = z.string().trim().min(2).max(80);

const listQuery = z.object({
  religionId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(80).optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
const createBody = z.object({ name, religionId: z.string().uuid() }).strict();
const updateBody = z
  .object({ name: name.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.isActive !== undefined, { message: "Nothing to change." });

export async function listCommunitiesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listQuery.safeParse(Object.fromEntries(["religionId", "q", "active", "page", "pageSize"].map((k) => [k, sp.get(k) ?? undefined])));
  if (!parsed.success) throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return ok(await svc.listCommunitiesForAdmin(ctx, parsed.data));
}

export async function createCommunityHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`community-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, createBody);
  return ok({ community: await svc.createCommunity(ctx, body, meta(req)) }, "Community added.");
}

export async function updateCommunityHandler(req: NextRequest, raw: { communityId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`community-write:${ctx.subject.id}`, 60, 60_000);
  const p = z.object({ communityId: z.string().uuid() }).safeParse(raw);
  if (!p.success) throw new ValidationError("communityId must be a valid id.");
  const body = await parseJsonBody(req, updateBody);
  return ok({ community: await svc.updateCommunity(ctx, p.data.communityId, body, meta(req)) }, "Community saved.");
}
