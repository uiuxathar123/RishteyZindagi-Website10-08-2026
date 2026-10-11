import { withErrorHandling } from "@/server/middleware/error-handler";
import { updateContactMessageHandler } from "@/server/modules/content/content.controller";

export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling((req, ctx) => updateContactMessageHandler(req, ctx.params as { messageId: string }));
