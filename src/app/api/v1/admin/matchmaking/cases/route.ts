import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminListCasesHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminListCasesHandler(req));
