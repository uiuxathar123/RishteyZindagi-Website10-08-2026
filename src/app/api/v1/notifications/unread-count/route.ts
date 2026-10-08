import { withErrorHandling } from "@/server/middleware/error-handler";
import { unreadNotificationCountHandler } from "@/server/modules/notifications/notifications.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => unreadNotificationCountHandler(req));
