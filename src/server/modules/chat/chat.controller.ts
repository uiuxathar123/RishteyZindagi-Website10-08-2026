/**
 * B7: HTTP layer for Chat. Same shape as every other module's controller:
 * authenticate -> rate-limit -> validate -> call service -> ok()/created().
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok, created } from "@/server/lib/response";
import * as chatService from "./chat.service";
import * as dto from "./chat.dto";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

// --- Open / get-or-create chat --------------------------------------------

const openChatSchema = z.object({ counterpartUserId: uuidField }).strict();

export async function openChatHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`chat-open:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, openChatSchema);
  const { chat, counterpartUserId } = await chatService.openOrGetChat(ctx, body.counterpartUserId);
  const view = await dto.toChatView(chat, counterpartUserId);
  return created({ chat: view }, "Chat ready.");
}

export async function listMyChatsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await chatService.listMyChats(ctx);
  const views = await dto.toChatSummaryViews(rows);
  return ok({ chats: views });
}

export async function unreadChatCountHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const count = await chatService.unreadMessageCount(ctx);
  return ok({ count });
}

// --- Messages --------------------------------------------------------------

const chatParamsSchema = z.object({ chatId: uuidField });
const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listMessagesHandler(req: NextRequest, params: { chatId: string }) {
  const ctx = await authenticate(req);
  const { chatId } = parseParams(chatParamsSchema, params);
  const sp = new URL(req.url).searchParams;
  const parsed = listMessagesQuerySchema.safeParse({ page: sp.get("page") ?? undefined, pageSize: sp.get("pageSize") ?? undefined });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const result = await chatService.listMessages(ctx, chatId, parsed.data.page, parsed.data.pageSize);
  return ok({ ...result, items: dto.toMessageViews(result.items, ctx.subject.id) });
}

const sendMessageSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Message cannot be empty.")
      .max(chatService.MAX_MESSAGE_LENGTH, `Message cannot exceed ${chatService.MAX_MESSAGE_LENGTH} characters.`),
  })
  .strict();

export async function sendMessageHandler(req: NextRequest, params: { chatId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`chat-message-send:${ctx.subject.id}`, 60, 60_000);
  const { chatId } = parseParams(chatParamsSchema, params);
  const body = await parseJsonBody(req, sendMessageSchema);
  const message = await chatService.sendMessage(ctx, chatId, body.body);
  return created({ message: dto.toMessageView(message, ctx.subject.id) }, "Message sent.");
}

export async function markChatReadHandler(req: NextRequest, params: { chatId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`chat-mark-read:${ctx.subject.id}`, 60, 60_000);
  const { chatId } = parseParams(chatParamsSchema, params);
  const updated = await chatService.markChatRead(ctx, chatId);
  return ok({ chatId, updated }, "Chat marked as read.");
}
