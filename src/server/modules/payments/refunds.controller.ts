import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok, created } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as refunds from "./refunds.service";

const params = z.object({ paymentId: z.string().uuid() });
const body = z
  .object({
    amountInPaise: z.number().int().min(1).optional(),
    reason: z.string().trim().min(3, "A reason is required.").max(500),
  })
  .strict();

function paymentId(raw: unknown): string {
  const r = params.safeParse(raw);
  if (!r.success) throw new ValidationError("Invalid route parameters.");
  return r.data.paymentId;
}

export async function listRefundsHandler(req: NextRequest, p: { paymentId: string }) {
  const ctx = await authenticate(req);
  return ok(await refunds.listRefunds(ctx, paymentId(p)));
}

export async function createRefundHandler(req: NextRequest, p: { paymentId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`refund:${ctx.subject.id}`, 10, 60_000);
  const id = paymentId(p);
  const input = await parseJsonBody(req, body);
  const refund = await refunds.requestRefund(ctx, id, input, { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
  return created({ refund }, refund.status === "PROCESSED" ? "Refund processed." : "Refund initiated.");
}
