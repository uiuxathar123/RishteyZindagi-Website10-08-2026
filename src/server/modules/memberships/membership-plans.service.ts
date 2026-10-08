/**
 * B8: member-facing plan catalog — `GET /membership-plans`. Purely a
 * read of `membership_plans` (see seed.ts's MEMBERSHIP_PLANS for the
 * eight seeded rows: four tiers x two currencies). No membership/payment
 * state is touched here.
 *
 * §5 scope boundary (documented again here + BACKEND.md): a plan's
 * `features` jsonb (unlimitedInterests / advancedSearch / shortlist /
 * visibilityBoost) is returned as-is, informational/marketing metadata
 * only — this endpoint does not compute or enforce anything from it.
 * Only `visibilityBoost` (via visibility-boost.ts) is a real, separately
 * enforced mechanism; everything else in `features` is display-only.
 */
import * as repo from "./membership-plans.repository";
import type { MembershipPlanRow } from "./membership-plans.repository";
import { resolveUserRegion, type SupportedCurrency } from "./region";
import type { AuthContext } from "@/server/middleware/authenticate";

export interface PlanView {
  id: string;
  code: string;
  name: string;
  priceInSmallestUnit: number;
  currency: string;
  durationDays: number;
  features: unknown;
}

function toView(row: MembershipPlanRow): PlanView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceInSmallestUnit: row.priceInPaise,
    currency: row.currency,
    durationDays: row.durationDays,
    features: row.features ?? {},
  };
}

/**
 * Unauthenticated-safe (no auth required — a plan catalog is public
 * marketing content, same posture as `/reference/profile-options`).
 * `currency` filters to just that currency's four rows when given;
 * otherwise all active rows across both currencies are returned so a
 * client that wants to show a currency switcher can.
 */
export async function listPublicPlans(currency?: SupportedCurrency): Promise<PlanView[]> {
  const rows = currency ? await repo.listActiveByCurrency(currency) : await repo.listActive();
  return rows.map(toView);
}

/** Convenience for an authenticated member's own checkout UI: resolves
 * their region and returns just that currency's plans, alongside the
 * resolved currency itself so the client can label the page correctly. */
export async function listPlansForMyRegion(ctx: AuthContext): Promise<{ currency: SupportedCurrency; plans: PlanView[] }> {
  if (ctx.subject.type !== "user") {
    const rows = await repo.listActive();
    return { currency: "INR", plans: rows.map(toView) };
  }
  const region = await resolveUserRegion(ctx.subject.id);
  const rows = await repo.listActiveByCurrency(region.currency);
  return { currency: region.currency, plans: rows.map(toView) };
}
