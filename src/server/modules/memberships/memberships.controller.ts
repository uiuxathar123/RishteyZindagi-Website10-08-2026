/**
 * B8: HTTP layer for membership-plans catalog + member-facing membership
 * lifecycle (read/cancel-auto-renew/renew/auto-renew-attempt/reminder).
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { authenticate } from "@/server/middleware/authenticate";
import { parseJsonBody } from "@/server/lib/validate";
import { checkRateLimit } from "@/server/middleware/rate-limit";
import { ValidationError } from "@/server/lib/errors";
import { ok } from "@/server/lib/response";
import * as plansService from "./membership-plans.service";
import * as membershipsService from "./memberships.service";
import { toMembershipView } from "./memberships.dto";

const uuidField = z.string().uuid();

function parseParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Invalid route parameters.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

// --- Plan catalog ------------------------------------------------------

export async function listPlansHandler(req: NextRequest) {
  const currencyParam = new URL(req.url).searchParams.get("currency");
  const currency = currencyParam === "INR" || currencyParam === "USD" ? currencyParam : undefined;
  const plans = await plansService.listPublicPlans(currency);
  return ok({ plans });
}

export async function listPlansForMyRegionHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const result = await plansService.listPlansForMyRegion(ctx);
  return ok(result);
}

// --- My membership -------------------------------------------------------

export async function getMyMembershipHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const result = await membershipsService.getMyMembership(ctx);
  return ok({
    ...result,
    membership: result.membership ? toMembershipView(result.membership) : null,
  });
}

export async function listMyMembershipHistoryHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  const rows = await membershipsService.listMyMembershipHistory(ctx);
  return ok({ memberships: rows.map(toMembershipView) });
}

const membershipParamsSchema = z.object({ membershipId: uuidField });

export async function cancelAutoRenewHandler(req: NextRequest, params: { membershipId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`membership-cancel-autorenew:${ctx.subject.id}`, 20, 60_000);
  const { membershipId } = parseParams(membershipParamsSchema, params);
  const membership = await membershipsService.cancelAutoRenew(ctx, membershipId);
  return ok({ membership: toMembershipView(membership) }, "Auto-renew turned off. Your current membership stays active until it expires.");
}

export async function enableAutoRenewHandler(req: NextRequest, params: { membershipId: string }) {
  const ctx = await authenticate(req);
  checkRateLimit(`membership-enable-autorenew:${ctx.subject.id}`, 20, 60_000);
  const { membershipId } = parseParams(membershipParamsSchema, params);
  const membership = await membershipsService.setAutoRenew(ctx, membershipId, true);
  return ok({ membership: toMembershipView(membership) }, "Auto-renew turned on.");
}

const renewSchema = z
  .object({
    planCode: z.string().min(1).optional(),
    devSimulateOutcome: z.enum(["SUCCESS", "FAILED", "PENDING"]).optional(),
  })
  .strict();

export async function renewMembershipHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`membership-renew:${ctx.subject.id}`, 10, 60_000);
  const body = await parseJsonBody(req, renewSchema);
  const result = await membershipsService.renewMembership(ctx, body);
  return ok(result, "Renewal checkout created. Complete verification to activate.");
}

const autoRenewAttemptSchema = z
  .object({
    devSimulateOutcome: z.enum(["SUCCESS", "FAILED", "PENDING"]).optional(),
  })
  .strict();

export async function autoRenewAttemptHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`membership-auto-renew-attempt:${ctx.subject.id}`, 10, 60_000);
  const body = await parseJsonBody(req, autoRenewAttemptSchema);
  const result = await membershipsService.attemptAutoRenewal(ctx, body);
  return ok(result);
}

export async function renewalReminderCheckHandler(req: NextRequest) {
  const ctx = await authenticate(req);
  checkRateLimit(`membership-renewal-reminder:${ctx.subject.id}`, 20, 60_000);
  const sent = await membershipsService.sendRenewalReminderIfDue(ctx);
  return ok({ sent });
}
