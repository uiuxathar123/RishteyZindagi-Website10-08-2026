import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { resumeRazorpayCheckout } from "./razorpay-resume.service";

export async function resumeRazorpayHandler(req: NextRequest, params: { paymentId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`payment-resume:${ctx.subject.id}`, 20, 60_000);
  const id = z.string().uuid().safeParse(params.paymentId);
  if (!id.success) throw new ValidationError("Invalid route parameters.");
  return ok(await resumeRazorpayCheckout(ctx, id.data), "Checkout reopened.");
}
