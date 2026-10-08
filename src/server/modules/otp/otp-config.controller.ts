import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import * as otpConfigService from "./otp-config.service";

function requestMeta(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
}

export async function getOtpConfigHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const config = await otpConfigService.getConfig(ctx);
  return ok(config);
}

const updateOtpConfigSchema = z
  .object({
    activeMethod: z.enum(["SMS", "WHATSAPP", "EMAIL"]).optional(),
    enabled: z.boolean().optional(),
    otpLength: z.number().int().min(4).max(10).optional(),
    otpExpirySeconds: z.number().int().min(30).max(3600).optional(),
    maxVerifyAttempts: z.number().int().min(1).max(20).optional(),
    resendCooldownSeconds: z.number().int().min(5).max(600).optional(),
    maxResendAttempts: z.number().int().min(1).max(50).optional(),
    resendWindowSeconds: z.number().int().min(60).max(86400).optional(),
    devMode: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

export async function updateOtpConfigHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  // Mutating a platform-wide security setting — a light IP+admin-keyed
  // limit as defense in depth, same posture as other credential-adjacent
  // mutations (register/login/reset-password), even though this route is
  // already gated behind authentication + platform.settings.manage.
  checkRateLimit(`otp-config-update:${ctx.subject.id}:${meta.ipAddress ?? "unknown"}`, 20, 60_000);
  const body = await parseJsonBody(req, updateOtpConfigSchema);
  const config = await otpConfigService.updateConfig(ctx, body, meta);
  return ok(config, "OTP configuration updated.");
}
