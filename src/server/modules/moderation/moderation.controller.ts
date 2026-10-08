import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./moderation.service";

const reasonSchema = z.object({ reason: z.string().trim().min(5, "A reason of at least 5 characters is required.").max(500) }).strict();
const idSchema = z.string().uuid();

function userId(p: { userId: string }): string {
  const r = idSchema.safeParse(p.userId);
  if (!r.success) throw new ValidationError("Invalid route parameters.");
  return r.data;
}
const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });

export async function suspendHandler(req: NextRequest, p: { userId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`moderation:${ctx.subject.id}`, 30, 60_000);
  const id = userId(p);
  const body = await parseJsonBody(req, reasonSchema);
  return ok(await svc.suspendUser(ctx, id, body.reason, meta(req)), "Account suspended.");
}
export async function banHandler(req: NextRequest, p: { userId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`moderation:${ctx.subject.id}`, 30, 60_000);
  const id = userId(p);
  const body = await parseJsonBody(req, reasonSchema);
  return ok(await svc.banUser(ctx, id, body.reason, meta(req)), "Account banned.");
}
export async function unbanHandler(req: NextRequest, p: { userId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`moderation:${ctx.subject.id}`, 30, 60_000);
  const id = userId(p);
  const body = await parseJsonBody(req, reasonSchema);
  return ok(await svc.unbanUser(ctx, id, body.reason, meta(req)), "Ban lifted.");
}
export async function moderationViewHandler(req: NextRequest, p: { userId: string }) {
  const ctx = await authenticate(req);
  return ok(await svc.getModerationView(ctx, userId(p)));
}
