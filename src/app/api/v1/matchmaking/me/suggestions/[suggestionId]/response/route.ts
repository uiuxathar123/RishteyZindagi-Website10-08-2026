import { withErrorHandling } from "@/server/middleware/error-handler";
import { respondHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => respondHandler(req, ctx.params as Record<string, string>));
