import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminAddNoteHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => adminAddNoteHandler(req, ctx.params as Record<string, string>));
