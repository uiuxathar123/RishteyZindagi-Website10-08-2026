import { withErrorHandling } from "@/server/middleware/error-handler";
import { renewalReminderCheckHandler } from "@/server/modules/memberships/memberships.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => renewalReminderCheckHandler(req));
