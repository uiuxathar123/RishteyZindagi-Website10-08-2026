/**
 * HTTP layer for Personal Matchmaking (member and Super Admin routes). Validation and rate limits live here;
 * authorization lives in the services (member subject / requireSuperAdmin), so no route can skip it.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate, type AuthContext } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { ValidationError } from "@/server/lib/errors";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { requireSuperAdmin } from "@/server/middleware/rbac";
import { created, ok } from "@/server/lib/response";
import { getClientIp } from "@/server/lib/client-ip";
import * as svc from "./matchmaking.service";
import * as admin from "./matchmaking-admin.service";
import { CASE_STATUSES } from "./matchmaking.repository";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const uuid = z.string().uuid();
const ipKey = (req: NextRequest) => req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";

async function tryAuthenticate(req: NextRequest): Promise<AuthContext | null> {
  try {
    return await authenticate(req);
  } catch {
    return null;
  }
}

function idParam(raw: Record<string, string>, key: string): string {
  const parsed = uuid.safeParse(raw[key]);
  if (!parsed.success) throw new ValidationError(`${key} must be a valid id.`);
  return parsed.data;
}

// --- member -------------------------------------------------------------------

export async function getOfferHandler(req: NextRequest) {
  const ctx = await tryAuthenticate(req);
  checkRateLimit(`matchmaking-offer:${ctx ? ctx.subject.id : ipKey(req)}`, 60, 60_000);
  return ok({ offer: await svc.getOffer(ctx) });
}

const checkoutSchema = z
  .object({
    consent: z.literal(true),
    consentVersion: z.string().min(1).max(40),
    customerNotes: z.string().max(2000).optional(),
    devSimulateOutcome: z.enum(["SUCCESS", "FAILED", "PENDING"]).optional(),
  })
  .strict();

export async function checkoutHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-checkout:${ctx.subject.id}`, 10, 60_000);
  const body = await parseJsonBody(req, checkoutSchema);
  return created({ checkout: await svc.checkout(ctx, body) }, "Checkout started.");
}

export async function getMineHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-me:${ctx.subject.id}`, 60, 60_000);
  return ok(await svc.getMyMatchmaking(ctx));
}

const notesSchema = z.object({ customerNotes: z.string().max(2000).nullable() }).strict();

export async function updateMineHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-me-write:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, notesSchema);
  return ok({ case: await svc.updateMyNotes(ctx, body.customerNotes) }, "Saved.");
}

const responseSchema = z.object({ response: z.enum(["INTERESTED", "NOT_INTERESTED"]) }).strict();

export async function respondHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-respond:${ctx.subject.id}`, 30, 60_000);
  const id = idParam(rawParams, "suggestionId");
  const body = await parseJsonBody(req, responseSchema);
  return ok({ suggestion: await svc.respondToSuggestion(ctx, id, body.response) }, "Response saved.");
}

const optOutSchema = z.object({ optOut: z.boolean() }).strict();

export async function setOptOutHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-optout:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, optOutSchema);
  return ok(await svc.setMyOptOut(ctx, body.optOut), "Saved.");
}

// --- Super Admin ------------------------------------------------------------------
// The role check runs first, before any parameter or body validation, so a non-Super-Admin learns nothing about
// the request (the services check again).

async function superAdmin(req: NextRequest): Promise<AuthContext> {
  const ctx = await authenticate(req);
  requireSuperAdmin(ctx);
  return ctx;
}

export async function adminGetSettingsHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  return ok({ settings: await admin.getSettings(ctx) });
}

export async function adminUpdateSettingsHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, z.unknown());
  return ok({ settings: await admin.updateSettings(ctx, body, meta(req)) }, "Settings saved.");
}

export async function adminListCasesHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") ?? undefined;
  if (status !== undefined && !(CASE_STATUSES as readonly string[]).includes(status)) throw new ValidationError("Unknown case status.");
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 25) || 25));
  return ok(await admin.listCases(ctx, { status: status as (typeof CASE_STATUSES)[number] | undefined, page, pageSize }));
}

export async function adminGetCaseHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  return ok(await admin.getCase(ctx, idParam(rawParams, "caseId")));
}

const noteSchema = z.object({ note: z.string().min(1).max(4000), customerVisible: z.boolean() }).strict();

export async function adminAddNoteHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, noteSchema);
  return created({ event: await admin.addNote(ctx, idParam(rawParams, "caseId"), body, meta(req)) }, "Note added.");
}

const statusSchema = z
  .object({ status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]), note: z.string().max(4000).optional(), customerVisible: z.boolean().optional() })
  .strict();

export async function adminChangeStatusHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, statusSchema);
  return ok({ case: await admin.changeStatus(ctx, idParam(rawParams, "caseId"), body, meta(req)) }, "Status updated.");
}

export async function adminRecommendationsHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-reco:${ctx.subject.id}`, 30, 60_000);
  return ok(await admin.getRecommendations(ctx, idParam(rawParams, "caseId")));
}

const addSuggestionSchema = z.object({ candidateUserId: uuid, source: z.enum(["AUTO", "MANUAL"]) }).strict();

export async function adminAddSuggestionHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, addSuggestionSchema);
  return created({ suggestion: await admin.addSuggestion(ctx, idParam(rawParams, "caseId"), body, meta(req)) }, "Suggestion added.");
}

const actionSchema = z.object({ action: z.enum(["APPROVE", "SEND", "WITHDRAW"]) }).strict();

export async function adminSuggestionActionHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, actionSchema);
  return ok({ suggestion: await admin.actOnSuggestion(ctx, idParam(rawParams, "suggestionId"), body.action, meta(req)) }, "Suggestion updated.");
}
