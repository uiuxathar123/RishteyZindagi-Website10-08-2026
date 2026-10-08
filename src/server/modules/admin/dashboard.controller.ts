/**
 * B9: HTTP layer for the admin dashboard stats endpoint.
 */
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { ok } from "@/server/lib/response";
import * as dashboardService from "./dashboard.service";

export async function getDashboardHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const stats = await dashboardService.getDashboardStats(ctx);
  return ok({ stats });
}
