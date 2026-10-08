import { withErrorHandling } from "@/server/middleware/error-handler";
import { shortlistUserHandler, listShortlistHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => shortlistUserHandler(req));
export const GET = withErrorHandling((req) => listShortlistHandler(req));
