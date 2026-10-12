import { withErrorHandling } from "@/server/middleware/error-handler";
import { getSiteControlsHandler, patchSiteControlsHandler } from "@/server/modules/platform-settings/platform-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getSiteControlsHandler(req));
export const PATCH = withErrorHandling((req) => patchSiteControlsHandler(req));
