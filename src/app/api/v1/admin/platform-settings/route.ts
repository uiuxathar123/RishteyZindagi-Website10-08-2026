import { withErrorHandling } from "@/server/middleware/error-handler";
import { getPlatformSettingsHandler, patchPlatformSettingsHandler } from "@/server/modules/platform-settings/platform-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getPlatformSettingsHandler(req));
export const PATCH = withErrorHandling((req) => patchPlatformSettingsHandler(req));
