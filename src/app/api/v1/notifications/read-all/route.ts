import { withErrorHandling } from "@/server/middleware/error-handler";
import { markAllNotificationsReadHandler } from "@/server/modules/notifications/notifications.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => markAllNotificationsReadHandler(req));
