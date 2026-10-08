import { withErrorHandling } from "@/server/middleware/error-handler";
import { blockUserHandler, listBlocksHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => blockUserHandler(req));
export const GET = withErrorHandling((req) => listBlocksHandler(req));
