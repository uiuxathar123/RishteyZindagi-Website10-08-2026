import { withErrorHandling } from "@/server/middleware/error-handler";
import { readyHandler } from "@/server/modules/health/health.controller";

export const dynamic = "force-dynamic";

// B14 §38: deep readiness check, additive alongside the existing simple
// liveness check at GET /api/v1/health (untouched — see
// health.controller.ts's own comment on why these are two separate
// endpoints).
export const GET = withErrorHandling(async () => readyHandler());
