/**
 * B4: data access for `partner_preferences`. The table itself was
 * scaffolded schema-only in B1 (see schema.ts's own comment on the
 * table) — this is the first code that reads or writes it. One row per
 * profile (enforced by the table's unique `profile_id` constraint), so
 * "create" and "update" collapse into a single upsert — there is no
 * separate creation step a caller has to remember to call first.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { partnerPreferences } from "@/server/db/schema";

export type PartnerPreferenceRow = typeof partnerPreferences.$inferSelect;
export type PartnerPreferenceWrite = Partial<
  Omit<typeof partnerPreferences.$inferInsert, "id" | "profileId" | "createdAt">
>;

export async function findByProfileId(profileId: string): Promise<PartnerPreferenceRow | undefined> {
  const [row] = await db.select().from(partnerPreferences).where(eq(partnerPreferences.profileId, profileId)).limit(1);
  return row;
}

/** Upserts the one preference row a profile may have. Only the fields
 * present in `data` are changed on an update (same "sparse PATCH"
 * pattern as profiles.repository.update) — an unset field keeps its
 * previous value rather than reverting to a default. */
export async function upsert(profileId: string, data: PartnerPreferenceWrite): Promise<PartnerPreferenceRow> {
  const existing = await findByProfileId(profileId);

  if (!existing) {
    const [row] = await db
      .insert(partnerPreferences)
      .values({ profileId, ...data })
      .returning();
    return row;
  }

  const [row] = await db
    .update(partnerPreferences)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(partnerPreferences.profileId, profileId))
    .returning();
  return row;
}
