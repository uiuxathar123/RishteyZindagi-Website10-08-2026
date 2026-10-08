import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { confirmRazorpayPayment } from "./razorpay-confirm.service";

const bodySchema = z
  .object({
    razorpay_payment_id: z.string().trim().min(5).max(64),
    razorpay_order_id: z.string().trim().min(5).max(64),
    razorpay_signature: z.string().trim().regex(/^[A-Fa-f0-9]{64}$/, "razorpay_signature must be a 64-character hex digest."),
  })
  .strict();

export async function confirmRazorpayHandler(req: NextRequest, params: { paymentId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-confirm:${ctx.subject.id}`, 30, 60_000);
  const id = z.string().uuid().safeParse(params.paymentId);
  if (!id.success) throw new ValidationError("Invalid route parameters.");
  const body = await parseJsonBody(req, bodySchema);
  const result = await confirmRazorpayPayment(ctx, id.data, body);
  return ok(result, `Payment ${result.status.toLowerCase().replace("_", " ")}.`);
}
