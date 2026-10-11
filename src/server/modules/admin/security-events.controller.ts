import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/client-ip";
import { authenticate } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import * as svc from "./security-events.service";

const query = z.object({
  type: z.enum(["ALL", "LOGIN_FAILED", "LOGIN_SUCCEEDED", "CHANGES"]).optional(),
  actor: z.enum(["USER", "ADMIN"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  dateFrom: z.string().max(40).optional(),
  dateTo: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listSecurityEventsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`security-events:${ctx.subject.id}`, 60, 60_000);
  const sp = new URL(req.url).searchParams;
  const parsed = query.safeParse(Object.fromEntries(["type", "actor", "q", "dateFrom", "dateTo", "page", "pageSize"].map((k) => [k, sp.get(k) ?? undefined])));
  if (!parsed.success) throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return ok(await svc.listSecurityEvents(ctx, parsed.data));
}

export async function exportSecurityEventsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`security-events-export:${ctx.subject.id}`, 10, 60_000);
  const sp = new URL(req.url).searchParams;
  const parsed = query.omit({ page: true, pageSize: true }).safeParse(Object.fromEntries(["type", "actor", "q", "dateFrom", "dateTo"].map((k) => [k, sp.get(k) ?? undefined])));
  if (!parsed.success) throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const out = await svc.exportSecurityEventsCsv(ctx, parsed.data, { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
  return new NextResponse(out.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="security-events-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
      "x-export-rows": String(out.rows),
      "x-export-total-matching": String(out.totalMatching),
    },
  });
}
