import { withErrorHandling } from "@/server/middleware/error-handler";
import { openChatHandler, listMyChatsHandler } from "@/server/modules/chat/chat.controller";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling((req) => openChatHandler(req));
export const GET = withErrorHandling((req) => listMyChatsHandler(req));
