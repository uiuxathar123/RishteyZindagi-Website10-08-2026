/**
 * B6: HTTP layer for Interest / Like / Shortlist / Match / Block. Same
 * shape as every other module's controller: authenticate -> rate-limit
 * -> validate -> call service -> ok().
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok, created } from "@/server/lib/response";
import * as interactionsService from "./interactions.service";
import * as dto from "./interactions.dto";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

function parseDirection(req: NextRequest): "sent" | "received" {
  const raw = new URL(req.url).searchParams.get("direction") ?? "received";
  if (raw !== "sent" && raw !== "received") {
    throw new ValidationError("direction must be 'sent' or 'received'.");
  }
  return raw;
}

// --- Interest --------------------------------------------------------------

const sendInterestSchema = z.object({ toUserId: uuidField }).strict();

export async function sendInterestHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`interest-send:${ctx.subject.id}`, 30, 60_000);
  const body = await parseJsonBody(req, sendInterestSchema);
  const result = await interactionsService.sendInterest(ctx, body.toUserId);
  const [view] = await dto.toInterestViews([result.interest], ctx.subject.id);
  return created({ interest: view, matched: result.matched }, result.matched ? "Mutual interest — you're now matched!" : "Interest sent.");
}

export async function listInterestsHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const direction = parseDirection(req);
  const rows = await interactionsService.listMyInterests(ctx, direction);
  const views = await dto.toInterestViews(rows, ctx.subject.id);
  return ok({ interests: views });
}

const interestParamsSchema = z.object({ interestId: uuidField });
const respondInterestSchema = z.object({ status: z.enum(["ACCEPTED", "DECLINED", "WITHDRAWN"]) }).strict();

export async function respondToInterestHandler(req: NextRequest, params: { interestId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`interest-respond:${ctx.subject.id}`, 30, 60_000);
  const { interestId } = parseParams(interestParamsSchema, params);
  const body = await parseJsonBody(req, respondInterestSchema);

  const row =
    body.status === "WITHDRAWN"
      ? await interactionsService.withdrawInterest(ctx, interestId)
      : await interactionsService.respondToInterest(ctx, interestId, body.status === "ACCEPTED" ? "ACCEPT" : "REJECT");

  const [view] = await dto.toInterestViews([row], ctx.subject.id);
  return ok({ interest: view }, "Interest updated.");
}

// --- Like --------------------------------------------------------------

const likeSchema = z.object({ toUserId: uuidField }).strict();

export async function likeUserHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`like:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, likeSchema);
  const row = await interactionsService.likeUser(ctx, body.toUserId);
  const [view] = await dto.toLikeViews([row], ctx.subject.id);
  return created({ like: view }, "Liked.");
}

const likeParamsSchema = z.object({ toUserId: uuidField });

export async function unlikeUserHandler(req: NextRequest, params: { toUserId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`unlike:${ctx.subject.id}`, 60, 60_000);
  const { toUserId } = parseParams(likeParamsSchema, params);
  await interactionsService.unlikeUser(ctx, toUserId);
  return ok({ toUserId }, "Unliked.");
}

export async function listLikesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const direction = parseDirection(req);
  const rows = await interactionsService.listMyLikes(ctx, direction);
  const views = await dto.toLikeViews(rows, ctx.subject.id);
  return ok({ likes: views });
}

// --- Shortlist -----------------------------------------------------------

const shortlistSchema = z.object({ targetUserId: uuidField }).strict();

export async function shortlistUserHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`shortlist:${ctx.subject.id}`, 60, 60_000);
  const body = await parseJsonBody(req, shortlistSchema);
  const row = await interactionsService.shortlistUser(ctx, body.targetUserId);
  const [view] = await dto.toShortlistViews([row]);
  return created({ shortlist: view }, "Shortlisted.");
}

const shortlistParamsSchema = z.object({ targetUserId: uuidField });

export async function unshortlistUserHandler(req: NextRequest, params: { targetUserId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`unshortlist:${ctx.subject.id}`, 60, 60_000);
  const { targetUserId } = parseParams(shortlistParamsSchema, params);
  await interactionsService.unshortlistUser(ctx, targetUserId);
  return ok({ targetUserId }, "Removed from shortlist.");
}

export async function listShortlistHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await interactionsService.listMyShortlist(ctx);
  const views = await dto.toShortlistViews(rows);
  return ok({ shortlist: views });
}

// --- Match ---------------------------------------------------------------

export async function listMatchesHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await interactionsService.listMyMatches(ctx);
  const views = await dto.toMatchViews(rows, ctx.subject.id);
  return ok({ matches: views });
}

// --- Block -----------------------------------------------------------------

const blockSchema = z.object({ targetUserId: uuidField, reason: z.string().max(500).optional() }).strict();

export async function blockUserHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`block:${ctx.subject.id}`, 20, 60_000);
  const body = await parseJsonBody(req, blockSchema);
  const row = await interactionsService.blockUser(ctx, body.targetUserId, body.reason);
  const [view] = await dto.toBlockViews([row]);
  return created({ block: view }, "User blocked.");
}

const blockParamsSchema = z.object({ targetUserId: uuidField });

export async function unblockUserHandler(req: NextRequest, params: { targetUserId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`unblock:${ctx.subject.id}`, 20, 60_000);
  const { targetUserId } = parseParams(blockParamsSchema, params);
  await interactionsService.unblockUser(ctx, targetUserId);
  return ok({ targetUserId }, "User unblocked.");
}

export async function listBlocksHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await interactionsService.listMyBlocks(ctx);
  const views = await dto.toBlockViews(rows);
  return ok({ blocks: views });
}
