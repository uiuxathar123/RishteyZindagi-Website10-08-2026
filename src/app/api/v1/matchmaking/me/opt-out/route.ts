import { withErrorHandling } from "@/server/middleware/error-handler";
import { setOptOutHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const PUT = withErrorHandling((req) => setOptOutHandler(req));
