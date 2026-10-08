import { withErrorHandling } from "@/server/middleware/error-handler";
import { markChatReadHandler } from "@/server/modules/chat/chat.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req, ctx) => markChatReadHandler(req, ctx.params as { chatId: string }));
