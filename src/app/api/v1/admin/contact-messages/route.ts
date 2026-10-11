import { withErrorHandling } from "@/server/middleware/error-handler";
import { listContactMessagesHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => listContactMessagesHandler(req));
