/**
 * HTTP layer for Super Admin introductions and Company Verified. Admin handlers check the Super Admin role first,
 * before any parameter or body validation (the services check again); member handlers need a signed-in member.
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
import * as intro from "./introductions.service";
import * as verification from "./company-verification.service";
import { INTRODUCTION_STATUSES, type IntroductionStatus } from "./introductions.repository";

const meta = (req: NextRequest) => ({ ipAddress: getClientIp(req), userAgent: req.headers.get("user-agent") });
const uuid = z.string().uuid();

function idParam(raw: Record<string, string>, key: string): string {
  const parsed = uuid.safeParse(raw[key]);
  if (!parsed.success) throw new ValidationError(`${key} must be a valid id.`);
  return parsed.data;
}

function idQuery(sp: URLSearchParams, key: string): string {
  const parsed = uuid.safeParse(sp.get(key));
  if (!parsed.success) throw new ValidationError(`${key} must be a valid id.`);
  return parsed.data;
}

async function superAdmin(req: NextRequest): Promise<AuthContext> {
  const ctx = await authenticate(req);
  requireSuperAdmin(ctx);
  return ctx;
}

// --- Super Admin: member search and introductions ---------------------------------------------------

export async function adminSearchMembersHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-search:${ctx.subject.id}`, 120, 60_000);
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 120);
  const scope = sp.get("scope") === "all" ? "all" : "introducible";
  return ok({ members: await intro.searchMembers(ctx, { q, scope }) });
}

export async function adminPreviewIntroductionHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-reco:${ctx.subject.id}`, 60, 60_000);
  const sp = new URL(req.url).searchParams;
  return ok({ preview: await intro.previewIntroduction(ctx, idQuery(sp, "userA"), idQuery(sp, "userB")) });
}

export async function adminListIntroductionsHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") ?? undefined;
  if (status !== undefined && !(INTRODUCTION_STATUSES as readonly string[]).includes(status)) throw new ValidationError("Unknown introduction status.");
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 25) || 25));
  return ok(await intro.listIntroductions(ctx, { status: status as IntroductionStatus | undefined, page, pageSize }));
}

const createSchema = z
  .object({
    userAId: uuid,
    userBId: uuid,
    messageToMembers: z.string().max(1000).optional(),
    internalNote: z.string().max(4000).optional(),
  })
  .strict();

export async function adminCreateIntroductionHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, createSchema);
  return created({ introduction: await intro.createIntroduction(ctx, body, meta(req)) }, "Introduction sent to both members.");
}

export async function adminWithdrawIntroductionHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  return ok({ introduction: await intro.withdrawIntroduction(ctx, idParam(rawParams, "introductionId"), meta(req)) }, "Introduction withdrawn.");
}

export async function adminOverviewHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  return ok({ overview: await intro.getOverview(ctx) });
}

export async function adminIntroductionCandidatesHandler(req: NextRequest) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-reco:${ctx.subject.id}`, 60, 60_000);
  return ok(await intro.suggestCandidates(ctx, idQuery(new URL(req.url).searchParams, "userId")));
}

// --- Super Admin: Company Verified -------------------------------------------------------------------

export async function adminGetCompanyVerificationHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  return ok({ verification: await verification.getCompanyVerification(ctx, idParam(rawParams, "userId")) });
}

const decisionSchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "REVOKED"]), note: z.string().max(2000).optional() }).strict();

export async function adminDecideCompanyVerificationHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await superAdmin(req);
  checkRateLimit(`matchmaking-admin-write:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, decisionSchema);
  return ok({ verification: await verification.decideCompanyVerification(ctx, idParam(rawParams, "userId"), body, meta(req)) }, "Saved.");
}

// --- member -----------------------------------------------------------------------------------------

export async function getMyIntroductionsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-me:${ctx.subject.id}`, 60, 60_000);
  return ok({ introductions: await intro.listMyIntroductions(ctx) });
}

const answerSchema = z.object({ response: z.enum(["ACCEPT", "DECLINE", "WITHDRAW"]) }).strict();

export async function respondToIntroductionHandler(req: NextRequest, rawParams: Record<string, string>) {
  const ctx = await authenticate(req);
  checkRateLimit(`matchmaking-respond:${ctx.subject.id}`, 30, 60_000);
  const id = idParam(rawParams, "introductionId");
  const body = await parseJsonBody(req, answerSchema);
  return ok({ introduction: await intro.respondToIntroduction(ctx, id, body.response) }, "Response saved.");
}
