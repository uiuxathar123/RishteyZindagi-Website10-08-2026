import { withErrorHandling } from "@/server/middleware/error-handler";
import { getMineHandler, updateMineHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getMineHandler(req));
export const PATCH = withErrorHandling((req) => updateMineHandler(req));
