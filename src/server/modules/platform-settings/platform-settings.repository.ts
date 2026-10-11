/** B18: data access for the `platform_settings` key/value table. No business rules here. */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { platformSettings } from "@/server/db/schema";

export type PlatformSettingRow = typeof platformSettings.$inferSelect;

export async function get(key: string): Promise<PlatformSettingRow | undefined> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
  return row;
}

export async function upsert(key: string, value: unknown, adminId: string | null): Promise<PlatformSettingRow> {
  const [row] = await db
    .insert(platformSettings)
    .values({ key, value: value as object, updatedByAdminId: adminId ?? undefined })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: value as object, updatedAt: new Date(), updatedByAdminId: adminId ?? null },
    })
    .returning();
  return row;
}
