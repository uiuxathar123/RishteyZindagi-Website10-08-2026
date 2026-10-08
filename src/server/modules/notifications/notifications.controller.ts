/**
 * B7: HTTP layer for the member-facing notification list/read-state
 * endpoints. Same shape as every other module's controller: authenticate
 * -> validate -> call service -> ok().
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as notificationsService from "./notifications.service";
import * as dto from "./notifications.dto";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export async function listNotificationsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const sp = new URL(req.url).searchParams;
  const parsed = listQuerySchema.safeParse({ page: sp.get("page") ?? undefined, pageSize: sp.get("pageSize") ?? undefined });
  if (!parsed.success) {
    throw new ValidationError("One or more query parameters are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const result = await notificationsService.listMyNotifications(ctx, parsed.data.page, parsed.data.pageSize);
  return ok({ ...result, items: dto.toNotificationViews(result.items) });
}

const notificationParamsSchema = z.object({ notificationId: uuidField });

export async function markNotificationReadHandler(req: NextRequest, params: { notificationId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`notification-mark-read:${ctx.subject.id}`, 60, 60_000);
  const { notificationId } = parseParams(notificationParamsSchema, params);
  const row = await notificationsService.markNotificationRead(ctx, notificationId);
  return ok({ notification: dto.toNotificationView(row) }, "Notification marked as read.");
}

export async function markAllNotificationsReadHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`notification-mark-all-read:${ctx.subject.id}`, 20, 60_000);
  const updated = await notificationsService.markAllNotificationsRead(ctx);
  return ok({ updated }, "Notifications marked as read.");
}

export async function unreadNotificationCountHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const count = await notificationsService.unreadNotificationCount(ctx);
  return ok({ count });
}
