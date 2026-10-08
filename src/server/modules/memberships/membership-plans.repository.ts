/**
 * B8: data access for `membership_plans` — B1 schema-only foundation
 * (never read or written by any code through B7) that this phase turns
 * into real, seeded plan tiers (see seed.ts's MEMBERSHIP_PLANS).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { membershipPlans } from "@/server/db/schema";

export type MembershipPlanRow = typeof membershipPlans.$inferSelect;

export async function listActive(): Promise<MembershipPlanRow[]> {
  return db.select().from(membershipPlans).where(eq(membershipPlans.isActive, true)).orderBy(membershipPlans.durationDays);
}

export async function listActiveByCurrency(currency: string): Promise<MembershipPlanRow[]> {
  return db
    .select()
    .from(membershipPlans)
    .where(and(eq(membershipPlans.isActive, true), eq(membershipPlans.currency, currency)))
    .orderBy(membershipPlans.durationDays);
}

export async function findByCode(code: string): Promise<MembershipPlanRow | undefined> {
  const [row] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, code)).limit(1);
  return row;
}

export async function findById(id: string): Promise<MembershipPlanRow | undefined> {
  const [row] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, id)).limit(1);
  return row;
}
