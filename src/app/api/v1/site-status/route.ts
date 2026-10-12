import { withErrorHandling } from "@/server/middleware/error-handler";
import { getPublicSiteStatusHandler } from "@/server/modules/platform-settings/platform-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(() => getPublicSiteStatusHandler());
