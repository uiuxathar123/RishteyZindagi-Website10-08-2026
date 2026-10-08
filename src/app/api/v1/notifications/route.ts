import { withErrorHandling } from "@/server/middleware/error-handler";
import { listNotificationsHandler } from "@/server/modules/notifications/notifications.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listNotificationsHandler(req));
