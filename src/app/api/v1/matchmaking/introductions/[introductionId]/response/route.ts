import { withErrorHandling } from "@/server/middleware/error-handler";
import { respondToIntroductionHandler } from "@/server/modules/matchmaking/introductions.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => respondToIntroductionHandler(req, ctx.params as Record<string, string>));
