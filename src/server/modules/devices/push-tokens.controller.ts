/**
 * B11: HTTP layer for push-token registration. Same shape as every other
 * module's controller: authenticate -> rate-limit -> validate -> call
 * service -> ok()/created().
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { parseJsonBody } from "@/server/lib/validate";
import { ValidationError } from "@/server/lib/errors";
import { ok, created } from "@/server/lib/response";
import * as pushTokensService from "./push-tokens.service";
import * as dto from "./push-tokens.dto";

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const registerSchema = z
  .object({
    // A real FCM/APNs/web-push token is a long opaque string — bounded
    // generously, never assumed to be any particular vendor's exact format
    // (this is an addressing store, not a vendor-specific validator).
    token: z.string().min(8).max(4096),
    platform: z.enum(["ANDROID", "IOS", "WEB"]),
  })
  .strict();

export async function registerPushTokenHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`push-token-register:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, registerSchema);
  const row = await pushTokensService.registerToken(ctx, body.token, body.platform);
  return created({ device: dto.toRegisteredPushTokenView(row) }, "Push token registered.");
}

export async function listPushTokensHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await pushTokensService.listMyTokens(ctx);
  return ok({ devices: dto.toPushTokenViews(rows) });
}

const revokeParamsSchema = z.object({ tokenOrId: z.string().min(1).max(4096) });

export async function revokePushTokenHandler(req: NextRequest, params: { tokenOrId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`push-token-revoke:${ctx.subject.id}`, 30, 60_000);
  const { tokenOrId } = parseParams(revokeParamsSchema, params);
  // Next.js already URL-decodes dynamic route segments before they reach
  // here (same as every other [param] route in this codebase) — no second
  // decode.
  await pushTokensService.revokeToken(ctx, tokenOrId);
  return ok({ revoked: true }, "Push token revoked.");
}
