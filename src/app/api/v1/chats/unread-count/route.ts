import { withErrorHandling } from "@/server/middleware/error-handler";
import { unreadChatCountHandler } from "@/server/modules/chat/chat.controller";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling((req) => unreadChatCountHandler(req));
