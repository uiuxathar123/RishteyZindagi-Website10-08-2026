/**
 * B5 gap-fix: HTTP layer for the admin matching-weights endpoint. Mirrors
 * otp-config.controller.ts's shape exactly.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import * as weightsService from "./weights.service";

function requestMeta(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
}

export async function getMatchingWeightsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const config = await weightsService.getConfig(ctx);
  return ok(config);
}

// All ten categories are required together — see weights.service.ts's
// updateWeights doc comment for why there is no partial-update path.
// `.strict()` rejects an unknown category key at the schema layer,
// before it ever reaches validateWeightMap.
const updateWeightsSchema = z
  .object({
    age: z.number().int().min(0),
    height: z.number().int().min(0),
    religion: z.number().int().min(0),
    community: z.number().int().min(0),
    motherTongue: z.number().int().min(0),
    education: z.number().int().min(0),
    profession: z.number().int().min(0),
    maritalStatus: z.number().int().min(0),
    location: z.number().int().min(0),
    income: z.number().int().min(0),
  })
  .strict();

export async function updateMatchingWeightsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const meta = requestMeta(req);
  // Mutating a platform-wide scoring setting — same defense-in-depth
  // posture as the OTP config route.
  checkRateLimit(`matching-weights-update:${ctx.subject.id}:${meta.ipAddress ?? "unknown"}`, 20, 60_000);
  const body = await parseJsonBody(req, updateWeightsSchema);
  const config = await weightsService.updateWeights(ctx, body, meta);
  return ok(config, "Matching weight configuration updated.");
}
