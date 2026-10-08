import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getEnv } from "@/server/config/env";
import { AuthenticationError, NotFoundError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { getClientIp } from "@/server/lib/client-ip";
import { getJob } from "./registry";
import { runJob } from "./runner";

const MIN_SECRET_LENGTH = 32;

function sha(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Cron endpoint. Disabled (404, as if it did not exist) until CRON_SECRET is
 * set to a value of at least 32 characters. The secret is compared in
 * constant time over fixed-length digests. It is a *machine* credential and is
 * deliberately separate from any admin/member session.
 */
export async function runJobHandler(req: NextRequest, jobName: string) {
  const secret = getEnv().CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new NotFoundError();

  // Brute-force damper (the secret is long, but a limiter costs nothing).
  checkRateLimit(`cron-auth:${getClientIp(req)}`, 60, 60_000);

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !timingSafeEqual(sha(match[1]), sha(secret))) {
    throw new AuthenticationError("Invalid credentials.");
  }

  if (!getJob(jobName)) throw new NotFoundError("Unknown job.");

  const result = await runJob(jobName, "HTTP");
  if (!result) throw new NotFoundError("Unknown job.");
  return ok(result, result.status === "SKIPPED_LOCKED" ? "Job already running; this attempt was skipped." : "Job finished.");
}
