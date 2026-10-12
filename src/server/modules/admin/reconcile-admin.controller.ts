import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./reconcile-admin.service";

export async function listReconcileRunsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.listReconcileRuns(ctx));
}

export async function runReconcileHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`reconcile-now:${ctx.subject.id}`, 6, 60_000);
  const out = await svc.runReconcileNow(ctx, { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
  return ok(out, out.message);
}
