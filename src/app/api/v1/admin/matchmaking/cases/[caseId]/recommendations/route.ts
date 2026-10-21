import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminRecommendationsHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => adminRecommendationsHandler(req, ctx.params as Record<string, string>));
