import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminChangeStatusHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => adminChangeStatusHandler(req, ctx.params as Record<string, string>));
