import { withErrorHandling } from "@/server/middleware/error-handler";
import { getOfferHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getOfferHandler(req));
