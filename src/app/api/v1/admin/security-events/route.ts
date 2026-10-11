import { withErrorHandling } from "@/server/middleware/error-handler";
import { listSecurityEventsHandler } from "@/server/modules/admin/security-events.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listSecurityEventsHandler(req));
