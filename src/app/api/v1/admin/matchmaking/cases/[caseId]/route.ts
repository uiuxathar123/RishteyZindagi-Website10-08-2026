import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminGetCaseHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => adminGetCaseHandler(req, ctx.params as Record<string, string>));
