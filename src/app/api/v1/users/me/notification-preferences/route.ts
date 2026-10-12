import { withErrorHandling } from "@/server/middleware/error-handler";
import { getNotificationPrefsHandler, updateNotificationPrefsHandler } from "@/server/modules/account/member-settings.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => getNotificationPrefsHandler(req));
export const PATCH = withErrorHandling((req) => updateNotificationPrefsHandler(req));
