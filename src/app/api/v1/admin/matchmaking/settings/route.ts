import { withErrorHandling } from "@/server/middleware/error-handler";
import { adminGetSettingsHandler, adminUpdateSettingsHandler } from "@/server/modules/matchmaking/matchmaking.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => adminGetSettingsHandler(req));
export const PUT = withErrorHandling((req) => adminUpdateSettingsHandler(req));
