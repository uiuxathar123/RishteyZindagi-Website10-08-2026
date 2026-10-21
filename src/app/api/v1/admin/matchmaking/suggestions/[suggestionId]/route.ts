import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminSuggestionActionHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => adminSuggestionActionHandler(req, ctx.params as Record<string, string>));
