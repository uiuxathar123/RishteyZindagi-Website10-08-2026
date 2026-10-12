import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./member-settings.service";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const atLeastOne = (v: object) => Object.keys(v).length > 0;

export async function getPrivacyHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok({ privacy: await svc.getPrivacy(ctx) });
}

const privacySchema = z
  .object({
    profileVisibility: z.enum(["VISIBLE", "HIDDEN"]).optional(),
    photoVisibility: z.enum(["MEMBERS", "ACCEPTED_ONLY"]).optional(),
    showLastActive: z.boolean().optional(),
  })
  .strict()
  .refine(atLeastOne, { message: "At least one setting must be provided." });
export async function updatePrivacyHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`member-settings:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, privacySchema);
  return ok({ privacy: await svc.updatePrivacy(ctx, body, meta(req)) }, "Privacy settings updated.");
}

export async function getNotificationPrefsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok({ preferences: await svc.getNotificationPreferences(ctx) });
}

const prefsSchema = z
  .object({ EMAIL: z.boolean().optional(), PUSH: z.boolean().optional(), WHATSAPP: z.boolean().optional(), DIGEST: z.boolean().optional() })
  .strict()
  .refine(atLeastOne, { message: "At least one channel must be provided." });
export async function updateNotificationPrefsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`member-settings:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, prefsSchema);
  return ok({ preferences: await svc.updateNotificationPreferences(ctx, body, meta(req)) }, "Notification preferences updated.");
}

export async function listSessionsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  return ok({ sessions: await svc.listMySessions(ctx) });
}

const uuid = z.string().uuid();
export async function revokeSessionHandler(req: NextRequest, p: { sessionId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`member-settings:${ctx.subject.id}`, 30, 60_000);
  const r = uuid.safeParse(p.sessionId);
  if (!r.success) throw new ValidationError("Invalid route parameters.");
  return ok(await svc.revokeMySession(ctx, r.data, meta(req)), "That device has been signed out.");
}

export async function revokeOtherSessionsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`member-settings:${ctx.subject.id}`, 30, 60_000);
  return ok(await svc.revokeOtherSessions(ctx, meta(req)), "Your other devices have been signed out.");
}

// B19: change e-mail / mobile (password + one-time code sent to the new contact).
import * as contactChange from "./contact-change.service";

const contactBase = z.object({
  type: z.enum(["EMAIL", "MOBILE"]),
  newValue: z.string().trim().min(3).max(200),
  countryCode: z.string().trim().max(5).optional(),
});
const contactRequestSchema = contactBase.extend({ password: z.string().min(1).max(200) }).strict();
const contactConfirmSchema = contactBase.extend({ code: z.string().trim().min(4).max(10) }).strict();

export async function requestContactChangeHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`contact-change-request:${ctx.subject.id}`, 5, 60 * 60_000);
  const body = await parseJsonBody(req, contactRequestSchema);
  return ok(await contactChange.requestContactChange(ctx, body, meta(req)), "Verification code sent.");
}

export async function confirmContactChangeHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`contact-change-confirm:${ctx.subject.id}`, 10, 60 * 60_000);
  const body = await parseJsonBody(req, contactConfirmSchema);
  return ok(await contactChange.confirmContactChange(ctx, body, meta(req)), "Contact details updated.");
}
