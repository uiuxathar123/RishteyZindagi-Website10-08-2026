import { withErrorHandling } from "@/server/middleware/error-handler";
import { markNotificationReadHandler } from "@/server/modules/notifications/notifications.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) =>
  markNotificationReadHandler(req, ctx.params as { notificationId: string })
);
