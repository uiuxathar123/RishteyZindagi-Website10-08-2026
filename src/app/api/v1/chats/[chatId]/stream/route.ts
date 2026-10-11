import { withErrorHandling } from "@/server/middleware/error-handler";
import { streamMessagesHandler } from "@/server/modules/chat/chat.controller";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withErrorHandling((req, ctx) => streamMessagesHandler(req, ctx.params as { chatId: string }));
