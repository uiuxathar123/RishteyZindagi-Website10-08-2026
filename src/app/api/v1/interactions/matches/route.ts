import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMatchesHandler } from "@/server/modules/interactions/interactions.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listMatchesHandler(req));
