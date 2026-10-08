import { withErrorHandling } from "@/server/middleware/error-handler";
import { listMessagesHandler, sendMessageHandler } from "@/server/modules/chat/chat.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req, ctx) => listMessagesHandler(req, ctx.params as { chatId: string }));
export const POST = withErrorHandling((req, ctx) => sendMessageHandler(req, ctx.params as { chatId: string }));
