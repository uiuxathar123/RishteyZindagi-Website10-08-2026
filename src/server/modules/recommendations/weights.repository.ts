/**
 * B5 gap-fix: data-access layer for the `matching_weight_configs`
 * singleton row. Mirrors `otp-config.repository.ts`'s exact pattern —
 * the row is seeded by migration 0004 (id=1, one column per category,
 * defaults matching `scoring.ts`'s previously-hardcoded
 * `DEFAULT_CATEGORY_WEIGHTS` exactly) and protected by a DB-level
 * `CHECK (id = 1)` constraint. `get()` deliberately does NOT fall back
 * to an in-code default if the row is missing — a missing row means
 * the migration wasn't applied, which should fail loudly, not silently
 * diverge from what the database actually enforces (same reasoning as
 * otp-config.repository.ts's own `get()`).
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { matchingWeightConfigs } from "@/server/db/schema";

export type MatchingWeightConfigRow = typeof matchingWeightConfigs.$inferSelect;
export type MatchingWeightConfigUpdate = Partial<
  Omit<typeof matchingWeightConfigs.$inferInsert, "id" | "updatedAt">
>;

const SINGLETON_ID = 1;

export async function get(): Promise<MatchingWeightConfigRow> {
  const [row] = await db.select().from(matchingWeightConfigs).where(eq(matchingWeightConfigs.id, SINGLETON_ID)).limit(1);
  if (!row) {
    throw new Error("matching_weight_configs singleton row is missing — has the B5 gap-fix migration been applied?");
  }
  return row;
}

export async function update(data: MatchingWeightConfigUpdate): Promise<MatchingWeightConfigRow> {
  const [row] = await db
    .update(matchingWeightConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(matchingWeightConfigs.id, SINGLETON_ID))
    .returning();
  return row;
}
