/**
 * B8: member-facing membership lifecycle — read my membership, cancel
 * auto-renew (never immediately deactivates — see turnOffAutoRenew's own
 * doc comment), manual renewal, on-demand auto-renewal attempt, and an
 * on-demand renewal-reminder check.
 *
 * Auto-renew / scheduler judgment call (documented again in BACKEND.md):
 * this codebase has no real background scheduler anywhere (confirmed by
 * inspection — every other "periodic" concern in B1-B7, e.g. OTP expiry,
 * is handled by request-time freshness checks, never a cron). B8 follows
 * the identical convention: membership expiry itself is computed fresh
 * from `status`+`expiresAt` on every read (see memberships.repository
 * .ts's `findActiveForUser` / membership-gate.ts's own established
 * pattern), and `attemptAutoRenewal`/`sendRenewalReminderIfDue` below are
 * explicit, idempotent, ON-DEMAND functions — exactly what the brief
 * asks for ("this phase provides the renewal LOGIC, callable on
 * demand"). Wiring either to a real cron is future infrastructure this
 * codebase doesn't have yet, not something this phase can honestly claim
 * to have built.
 */
import { AuthorizationError, NotFoundError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as repo from "./memberships.repository";
import type { MembershipRow } from "./memberships.repository";
import * as plansRepo from "./membership-plans.repository";
import type { VerifyOutcomeStatus } from "@/server/modules/payments/providers/types";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

export interface MyMembershipView {
  membership: MembershipRow | null;
  planCode: string | null;
  planName: string | null;
  isActive: boolean;
}

export async function getMyMembership(ctx: AuthContext): Promise<MyMembershipView> {
  const userId = requireMemberSubject(ctx);
  const raw = await repo.findMostRecentForUser(userId);
  if (!raw) return { membership: null, planCode: null, planName: null, isActive: false };
  // Opportunistic display-freshness — see memberships.repository.ts's
  // markExpiredIfPast doc comment: never relied upon for correctness,
  // only for not showing a stale "ACTIVE" label after expiry has passed.
  const membership = await repo.markExpiredIfPast(raw);
  const plan = await plansRepo.findById(membership.planId);
  const isActive = membership.status === "ACTIVE" && (!membership.expiresAt || membership.expiresAt.getTime() > Date.now());
  return { membership, planCode: plan?.code ?? null, planName: plan?.name ?? null, isActive };
}

export async function listMyMembershipHistory(ctx: AuthContext): Promise<MembershipRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listForUser(userId);
}

async function loadOwnedMembership(userId: string, membershipId: string): Promise<MembershipRow> {
  const membership = await repo.findById(membershipId);
  if (!membership || membership.userId !== userId) {
    throw new AuthorizationError("You do not have permission to access this membership.");
  }
  return membership;
}

/** Product rule: "Cancellation sets autoRenew=false only — current paid
 * period is untouched, membership does not immediately deactivate." */
export async function cancelAutoRenew(ctx: AuthContext, membershipId: string): Promise<MembershipRow> {
  const userId = requireMemberSubject(ctx);
  await loadOwnedMembership(userId, membershipId);
  return repo.turnOffAutoRenew(membershipId);
}

export async function setAutoRenew(ctx: AuthContext, membershipId: string, autoRenew: boolean): Promise<MembershipRow> {
  const userId = requireMemberSubject(ctx);
  await loadOwnedMembership(userId, membershipId);
  return repo.setAutoRenew(membershipId, autoRenew);
}

// --- Renewal / auto-renewal ------------------------------------------------

export const RENEWAL_REMINDER_WINDOW_DAYS = 3;

/** ACTIVE, not yet expired, and within the reminder window — documented,
 * fixed 3-day window (see this file's own judgment-call comment). */
export function isRenewalReminderDue(membership: MembershipRow): boolean {
  if (membership.status !== "ACTIVE" || !membership.expiresAt) return false;
  const msUntilExpiry = membership.expiresAt.getTime() - Date.now();
  return msUntilExpiry > 0 && msUntilExpiry <= RENEWAL_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Idempotent per calendar day (see the dedupeKey below) — safe to call
 * repeatedly (e.g. once per page load, or from a future scheduler) without
 * spamming the user. Returns whether a reminder was actually (re-)sent. */
export async function sendRenewalReminderIfDue(ctx: AuthContext): Promise<boolean> {
  const userId = requireMemberSubject(ctx);
  const membership = await repo.findActiveForUser(userId);
  if (!membership || !isRenewalReminderDue(membership)) return false;
  const plan = await plansRepo.findById(membership.planId);
  const dayKey = new Date().toISOString().slice(0, 10);
  const sent = await notify({
    userId,
    channel: "IN_APP",
    title: "Your membership is expiring soon",
    body: `Your ${plan?.name ?? "membership"} expires on ${membership.expiresAt!.toISOString().slice(0, 10)}. Renew to keep your benefits.`,
    dedupeKey: `renewal_reminder:${membership.id}:${dayKey}`,
  });
  return sent !== null;
}

export interface RenewalInput {
  /** Defaults to the current/most-recent membership's own plan when
   * omitted — "manual renewal always available", per spec. */
  planCode?: string;
  devSimulateOutcome?: VerifyOutcomeStatus;
}

/**
 * Manual renewal — always available regardless of auto-renew setting.
 * Thin wrapper around the same checkout() this module's payments
 * counterpart exposes; a lazy `require` avoids a static import cycle
 * (payments.service.ts imports memberships.repository/plans directly,
 * never memberships.service.ts — this is the one direction that would
 * otherwise cycle, so it's resolved at call time instead of at module
 * load time).
 */
export async function renewMembership(ctx: AuthContext, input: RenewalInput) {
  const userId = requireMemberSubject(ctx);
  let planCode = input.planCode;
  if (!planCode) {
    const current = await repo.findMostRecentForUser(userId);
    if (!current) throw new NotFoundError("No prior membership to renew — use checkout to purchase a plan.");
    const plan = await plansRepo.findById(current.planId);
    if (!plan) throw new NotFoundError("The plan for your most recent membership no longer exists.");
    planCode = plan.code;
  }
  const paymentsService = await import("@/server/modules/payments/payments.service");
  return paymentsService.checkout(ctx, { planCode, devSimulateOutcome: input.devSimulateOutcome });
}

export interface AutoRenewalResult {
  renewed: boolean;
  reason?: string;
}

/**
 * The explicit, on-demand "attempt automatic renewal" function — see
 * this file's top-of-file comment for why there's no real cron calling
 * it. Only proceeds when the user's most recent membership has
 * `autoRenew: true` AND is currently EXPIRED. On success: the new
 * membership is activated (via the same checkout+verify path everything
 * else uses) and `autoRenew` carries forward onto the new row. On
 * failure: the OLD membership is left EXPIRED (never silently
 * resurrected) and the user is notified via notify() — never thrown as
 * an error to a caller that might be a future unattended scheduler.
 */
export async function attemptAutoRenewal(ctx: AuthContext, opts?: { devSimulateOutcome?: VerifyOutcomeStatus }): Promise<AutoRenewalResult> {
  const userId = requireMemberSubject(ctx);
  const current = await repo.findMostRecentForUser(userId);
  if (!current || !current.autoRenew) return { renewed: false, reason: "Auto-renew is not enabled." };
  // "Currently expired" computed fresh from status+expiresAt together
  // (request-time freshness — see this file's top-of-file comment),
  // never relying on markExpiredIfPast having already flipped the
  // stored status: an ACTIVE row whose expiresAt has already passed
  // counts as expired here too.
  const effectivelyExpired =
    current.status === "EXPIRED" || (current.status === "ACTIVE" && !!current.expiresAt && current.expiresAt.getTime() <= Date.now());
  if (!effectivelyExpired) return { renewed: false, reason: "Membership is not currently expired." };

  const plan = await plansRepo.findById(current.planId);
  if (!plan || !plan.isActive) return { renewed: false, reason: "The plan is no longer available." };

  try {
    const paymentsService = await import("@/server/modules/payments/payments.service");
    const { verify } = await paymentsService.checkoutAndVerifyForAutoRenewal(ctx, {
      planCode: plan.code,
      autoRenew: true,
      devSimulateOutcome: opts?.devSimulateOutcome,
    });
    if (verify.status === "SUCCESS") {
      return { renewed: true };
    }
    await notify({
      userId,
      channel: "IN_APP",
      title: "Automatic renewal failed",
      body: `We couldn't automatically renew your ${plan.name} membership. Please renew manually.`,
      dedupeKey: `auto_renewal_failed:${current.id}`,
    });
    return { renewed: false, reason: `Payment did not succeed (status: ${verify.status}).` };
  } catch {
    await notify({
      userId,
      channel: "IN_APP",
      title: "Automatic renewal failed",
      body: `We couldn't automatically renew your ${plan.name} membership. Please renew manually.`,
      dedupeKey: `auto_renewal_failed:${current.id}`,
    });
    return { renewed: false, reason: "The payment attempt failed." };
  }
}
