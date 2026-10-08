import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import * as recommendationsService from "./recommendations.service";

/** §12/§14: authenticated-only, no anonymous access at all — unlike
 * search.controller.ts's tryAuthenticate (which lets an anonymous
 * request through with a narrower view), a recommendation is only
 * meaningful relative to a signed-in requester's own stored preferences,
 * so a missing/invalid session is a plain 401 here, not a degraded
 * anonymous response. */
function parseInt10(raw: string | null, field: string): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  if (!/^-?\d+$/.test(raw.trim())) throw new ValidationError(`${field} must be an integer.`);
  return Number.parseInt(raw, 10);
}

const recommendationsQuerySchema = z
  .object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(recommendationsService.MAX_PAGE_SIZE).optional(),
  })
  .strict();

export async function getMyRecommendationsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`recommendations:${ctx.subject.id}`, 60, 60_000);

  const url = new URL(req.url);
  const sp = url.searchParams;

  for (const key of Array.from(sp.keys())) {
    if (!["page", "pageSize"].includes(key)) {
      throw new ValidationError(`Unsupported query parameter: ${key}`);
    }
  }

  const parsed = recommendationsQuerySchema.safeParse({
    page: parseInt10(sp.get("page"), "page"),
    pageSize: parseInt10(sp.get("pageSize"), "pageSize"),
  });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }

  const page = await recommendationsService.getMyRecommendations(ctx, {
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });

  return ok(page);
}
