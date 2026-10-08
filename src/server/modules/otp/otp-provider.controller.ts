import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./otp-provider.service";

const bodySchema = z.object({ activeProvider: z.enum(["EMAIL", "FAST2SMS_SMS"]) }).strict();

export async function getOtpProviderHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getOtpProviderView(ctx));
}

export async function patchOtpProviderHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`otp-provider-update:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, bodySchema);
  const view = await svc.setActiveOtpProvider(ctx, body.activeProvider, { ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
  return ok(view, `${body.activeProvider === "EMAIL" ? "E-mail" : "Fast2SMS SMS"} is now the active OTP provider.`);
}
