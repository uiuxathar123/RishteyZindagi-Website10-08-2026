import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import { NotFoundError } from "@/server/lib/errors";
import * as svc from "./approval.service";

const uuid = z.string().uuid();
const decideBody = z.object({ decision: z.string().trim().min(1).max(10), reason: z.string().trim().max(500).optional() }).strict();

export async function listApprovalsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const q = new URL(req.url).searchParams;
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
  return ok(await svc.listApprovalQueue(ctx, { status: q.get("status") ?? undefined, page: num("page"), pageSize: num("pageSize") }));
}

export async function decideApprovalHandler(req: NextRequest, params: { profileId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`profile-approval:${ctx.subject.id}`, 120, 60_000);
  if (!uuid.safeParse(params.profileId).success) throw new NotFoundError("Profile not found.");
  const body = await parseJsonBody(req, decideBody);
  return ok(await svc.decideApproval(ctx, params.profileId, body, { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") }), "Decision saved.");
}
