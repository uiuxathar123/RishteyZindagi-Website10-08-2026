import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminAddSuggestionHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => adminAddSuggestionHandler(req, ctx.params as Record<string, string>));
