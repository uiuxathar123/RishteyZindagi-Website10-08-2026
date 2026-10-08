/**
 * Data-access layer for the `otp_configs` singleton row. Nothing above this
 * file touches the `otp_configs` Drizzle table directly.
 *
 * The row is seeded by migration 0001 (id=1, active_method='EMAIL') and
 * protected by a DB-level `CHECK (id = 1)` constraint — see schema.ts's
 * comment on `otpConfigs`. `get()` deliberately does NOT fall back to an
 * in-code default if the row is missing: a missing row means the migration
 * wasn't applied, which should fail loudly, not silently diverge from what
 * the database actually enforces.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otpConfigs } from "@/server/db/schema";

export type OtpConfigRow = typeof otpConfigs.$inferSelect;
export type OtpConfigUpdate = Partial<Omit<typeof otpConfigs.$inferInsert, "id" | "updatedAt">>;

const SINGLETON_ID = 1;

export async function get(): Promise<OtpConfigRow> {
  const [row] = await db.select().from(otpConfigs).where(eq(otpConfigs.id, SINGLETON_ID)).limit(1);
  if (!row) {
    throw new Error("otp_configs singleton row is missing — has the B2 migration been applied?");
  }
  return row;
}

export async function update(data: OtpConfigUpdate): Promise<OtpConfigRow> {
  const [row] = await db
    .update(otpConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(otpConfigs.id, SINGLETON_ID))
    .returning();
  return row;
}
