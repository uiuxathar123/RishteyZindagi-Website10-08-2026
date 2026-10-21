import { withErrorHandling } from "@/server/middleware/error-handler";
import { checkoutHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => checkoutHandler(req));
