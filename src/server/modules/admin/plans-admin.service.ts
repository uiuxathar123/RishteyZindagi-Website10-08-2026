/**
 * B18: Super-Admin membership-plan management (`plans.manage`).
 *
 * Design rules (see B18_AUDIT.md A6):
 *  - A plan's `code`, `currency` and `durationDays` never change after
 *    creation: existing memberships, payments and invoices refer to them and
 *    the 6-month visibility boost is derived from the duration.
 *  - A price change only affects FUTURE checkouts; memberships already paid
 *    for keep their expiry, and a pending payment keeps the amount it was
 *    created with.
 *  - Deactivating a plan removes it from the public catalogue and from new
 *    checkouts/renewals; members who already hold it keep their benefits
 *    until it expires.
 *  - `features` is normalised on the server so the catalogue never promises
 *    something that is not enforced: `chat` is always true (every active
 *    membership allows chat), `advancedSearch` is the one admin-controlled
 *    entitlement, and `visibilityBoost` is derived from the duration.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { memberships, membershipPlans } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { TIER_DURATION_DAYS } from "@/server/modules/memberships/plan-tiers";

const PERMISSION = "plans.manage";
export const MAX_PRICE = 100_000_000; // smallest currency unit (≈ ₹10 lakh)

export interface AuditMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminPlanView {
  id: string;
  code: string;
  name: string;
  currency: string;
  priceInSmallestUnit: number;
  durationDays: number;
  isActive: boolean;
  features: { chat: boolean; advancedSearch: boolean; visibilityBoost: boolean };
  /** Members whose membership on this plan is ACTIVE and unexpired right now. */
  activeMembers: number;
  createdAt: string;
}

type PlanRow = typeof membershipPlans.$inferSelect;

export function normaliseFeatures(input: { advancedSearch?: boolean }, durationDays: number): AdminPlanView["features"] {
  return {
    chat: true,
    advancedSearch: input.advancedSearch === true,
    visibilityBoost: durationDays === TIER_DURATION_DAYS.SIX_MONTH,
  };
}

function featuresOf(row: PlanRow): AdminPlanView["features"] {
  const f = (row.features ?? {}) as Record<string, unknown>;
  return { chat: true, advancedSearch: f.advancedSearch === true, visibilityBoost: row.durationDays === TIER_DURATION_DAYS.SIX_MONTH };
}

function toView(row: PlanRow, activeMembers: number): AdminPlanView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    priceInSmallestUnit: row.priceInPaise,
    durationDays: row.durationDays,
    isActive: row.isActive,
    features: featuresOf(row),
    activeMembers,
    createdAt: row.createdAt.toISOString(),
  };
}

async function activeMemberCount(planId: string): Promise<number> {
  const [r] = await db
    .select({ c: count() })
    .from(memberships)
    .where(and(eq(memberships.planId, planId), eq(memberships.status, "ACTIVE"), sql`(${memberships.expiresAt} IS NULL OR ${memberships.expiresAt} > now())`));
  return Number(r?.c ?? 0);
}

export async function listPlansForAdmin(ctx: AuthContext): Promise<{ plans: AdminPlanView[] }> {
  await requirePermission(ctx, PERMISSION);
  const rows = await db.select().from(membershipPlans).orderBy(membershipPlans.currency, membershipPlans.durationDays, desc(membershipPlans.createdAt));
  const counts = await db
    .select({ planId: memberships.planId, c: count() })
    .from(memberships)
    .where(and(eq(memberships.status, "ACTIVE"), sql`(${memberships.expiresAt} IS NULL OR ${memberships.expiresAt} > now())`))
    .groupBy(memberships.planId);
  const byPlan = new Map(counts.map((c) => [c.planId, Number(c.c)]));
  return { plans: rows.map((r) => toView(r, byPlan.get(r.id) ?? 0)) };
}

export interface CreatePlanInput {
  code: string;
  name: string;
  currency: "INR" | "USD";
  priceInSmallestUnit: number;
  durationDays: number;
  advancedSearch?: boolean;
  isActive?: boolean;
}

export async function createPlan(ctx: AuthContext, input: CreatePlanInput, meta: AuditMeta): Promise<AdminPlanView> {
  await requirePermission(ctx, PERMISSION);
  const [dup] = await db.select({ id: membershipPlans.id }).from(membershipPlans).where(eq(membershipPlans.code, input.code)).limit(1);
  if (dup) throw new ConflictError("A plan with this code already exists.");
  const [row] = await db
    .insert(membershipPlans)
    .values({
      code: input.code,
      name: input.name,
      currency: input.currency,
      priceInPaise: input.priceInSmallestUnit,
      durationDays: input.durationDays,
      features: normaliseFeatures({ advancedSearch: input.advancedSearch }, input.durationDays),
      isActive: input.isActive ?? true,
    })
    .returning();
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "plan.created",
    entityType: "membership_plan",
    entityId: row.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { code: row.code, name: row.name, currency: row.currency, priceInSmallestUnit: row.priceInPaise, durationDays: row.durationDays, features: row.features, isActive: row.isActive },
  });
  return toView(row, 0);
}

export interface UpdatePlanInput {
  name?: string;
  priceInSmallestUnit?: number;
  advancedSearch?: boolean;
  isActive?: boolean;
}

export async function updatePlan(ctx: AuthContext, planId: string, input: UpdatePlanInput, meta: AuditMeta): Promise<AdminPlanView> {
  await requirePermission(ctx, PERMISSION);
  const [current] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, planId)).limit(1);
  if (!current) throw new NotFoundError("Plan not found.");
  if (Object.keys(input).length === 0) throw new ValidationError("Nothing to change.");

  const prevFeatures = featuresOf(current);
  const next = {
    name: input.name ?? current.name,
    priceInPaise: input.priceInSmallestUnit ?? current.priceInPaise,
    isActive: input.isActive ?? current.isActive,
    features: normaliseFeatures({ advancedSearch: input.advancedSearch ?? prevFeatures.advancedSearch }, current.durationDays),
  };
  const [row] = await db.update(membershipPlans).set(next).where(eq(membershipPlans.id, planId)).returning();

  const changed: Record<string, { previous: unknown; new: unknown }> = {};
  if (next.name !== current.name) changed.name = { previous: current.name, new: next.name };
  if (next.priceInPaise !== current.priceInPaise) changed.priceInSmallestUnit = { previous: current.priceInPaise, new: next.priceInPaise };
  if (next.isActive !== current.isActive) changed.isActive = { previous: current.isActive, new: next.isActive };
  if (next.features.advancedSearch !== prevFeatures.advancedSearch) changed.advancedSearch = { previous: prevFeatures.advancedSearch, new: next.features.advancedSearch };

  const action = changed.isActive && Object.keys(changed).length === 1 ? (next.isActive ? "plan.activated" : "plan.deactivated") : "plan.updated";
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action,
    entityType: "membership_plan",
    entityId: planId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { code: current.code, changed },
  });
  return toView(row, await activeMemberCount(planId));
}
