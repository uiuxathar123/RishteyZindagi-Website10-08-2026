import { withErrorHandling } from "@/server/middleware/error-handler";
import { likeUserHandler, listLikesHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => likeUserHandler(req));
export const GET = withErrorHandling((req) => listLikesHandler(req));
