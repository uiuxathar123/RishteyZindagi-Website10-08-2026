import { withErrorHandling } from "@/server/middleware/error-handler";
import { exportSecurityEventsHandler } from "@/server/modules/admin/security-events.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => exportSecurityEventsHandler(req));
