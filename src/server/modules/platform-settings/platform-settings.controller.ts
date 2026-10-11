import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./platform-settings.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });

const otpPolicyBody = z
  .object({
    workflow: z.string().trim().min(1).max(60),
    requirement: z.string().trim().min(1).max(30),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export async function getOtpPolicyHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok(await svc.getOtpPolicyView(ctx));
}

export async function patchOtpPolicyHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`otp-policy-update:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, otpPolicyBody);
  const view = await svc.setOtpPolicy(ctx, body, meta(req));
  return ok(view, "OTP policy saved.");
}
