import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import { NotFoundError } from "@/server/lib/errors";
import * as svc from "./content.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const uuid = z.string().uuid();
const idOr404 = (v: string, what: string) => {
  if (!uuid.safeParse(v).success) throw new NotFoundError(`${what} not found.`);
  return v;
};
const num = (q: URLSearchParams, k: string) => (q.get(k) ? Number(q.get(k)) : undefined);

// ---- public ---------------------------------------------------------------
export async function submitContactHandler(req: NextRequest) {
  const ip = getClientIp(req);
  checkRateLimit(`contact-ip:${ip}`, 5, 60 * 60_000);
  const body = await parseJsonBody(req, svc.contactInputSchema);
  checkRateLimit(`contact-email:${body.email}`, 3, 60 * 60_000);
  await svc.submitContactMessage(body, meta(req));
  return ok({ received: true }, "Thank you — your message has been received.");
}
export async function publicSupportContactHandler() {
  return ok(await svc.getPublicSupportContact());
}
export async function publicStoriesHandler() {
  return ok({ stories: await svc.listPublishedStories() });
}

// ---- admin: support ---------------------------------------------------------
export async function getSupportContactAdminHandler(req: NextRequest) {
  return ok(await svc.getSupportContactAdmin(await authenticate(req)));
}
export async function patchSupportContactHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`support-contact-update:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, z.object({ email: z.string(), phone: z.string(), hours: z.string() }).strict());
  return ok(await svc.setSupportContact(ctx, body, meta(req)), "Contact details saved.");
}
export async function listContactMessagesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const q = new URL(req.url).searchParams;
  return ok(await svc.listContactMessages(ctx, { status: q.get("status") ?? undefined, page: num(q, "page"), pageSize: num(q, "pageSize") }));
}
export async function updateContactMessageHandler(req: NextRequest, params: { messageId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`contact-msg-update:${ctx.subject.id}`, 120, 60_000);
  const id = idOr404(params.messageId, "Message");
  const body = await parseJsonBody(req, z.object({ status: z.string().max(20).optional(), adminNote: z.string().max(1000).optional() }).strict());
  return ok(await svc.updateContactMessage(ctx, id, body, meta(req)), "Saved.");
}

// ---- admin: stories -----------------------------------------------------------
export async function listStoriesAdminHandler(req: NextRequest) {
  return ok(await svc.listStoriesAdmin(await authenticate(req)));
}
export async function createStoryHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`story-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return ok(await svc.createStory(ctx, body, meta(req)), "Story created.");
}
export async function updateStoryHandler(req: NextRequest, params: { storyId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`story-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return ok(await svc.updateStory(ctx, idOr404(params.storyId, "Story"), body, meta(req)), "Story saved.");
}
export async function deleteStoryHandler(req: NextRequest, params: { storyId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`story-write:${ctx.subject.id}`, 60, 60_000);
  await svc.deleteStory(ctx, idOr404(params.storyId, "Story"), meta(req));
  return ok({ deleted: true }, "Story deleted.");
}
