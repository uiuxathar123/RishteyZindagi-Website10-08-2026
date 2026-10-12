/**
 * B9: HTTP layer for the admin dashboard stats endpoint.
 */
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ok } from "@/server/lib/response";
import { ValidationError } from "@/server/lib/errors";
import * as dashboardService from "./dashboard.service";

export async function getDashboardHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const stats = await dashboardService.getDashboardStats(ctx);
  return ok({ stats });
}

export async function getDashboardTrendsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const raw = new URL(req.url).searchParams.get("days");
  const n = raw === null ? undefined : Number(raw);
  if (n !== undefined && !Number.isFinite(n)) throw new ValidationError("days must be a number between 7 and 90.");
  return ok(await dashboardService.getDashboardTrends(ctx, n));
}
