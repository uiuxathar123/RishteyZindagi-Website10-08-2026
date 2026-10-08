import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { profiles, profilePhotos, users } from "@/server/db/schema";

export type NewProfile = typeof profiles.$inferInsert;
export type ProfileRow = typeof profiles.$inferSelect;
export type ProfilePhotoRow = typeof profilePhotos.$inferSelect;
export type NewProfilePhoto = typeof profilePhotos.$inferInsert;

export async function findByUserId(userId: string): Promise<ProfileRow | undefined> {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row;
}

export async function create(data: NewProfile): Promise<ProfileRow> {
  const [row] = await db.insert(profiles).values(data).returning();
  return row;
}

// ---------------------------------------------------------------------------
// B3 additions below — everything above this line is unchanged B1 code.
// ---------------------------------------------------------------------------

export interface ProfileWithAccount {
  profile: ProfileRow;
  displayName: string;
  userStatus: string;
}

/** Joins the owning user's account row in for the fields a profile
 * response needs from it (name, account status) without duplicating that
 * data into the profiles table — see BACKEND.md's B3 "no duplicate
 * account concept" note. */
export async function findByIdWithAccount(profileId: string): Promise<ProfileWithAccount | undefined> {
  const [row] = await db
    .select({ profile: profiles, displayName: users.name, userStatus: users.status })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(eq(profiles.id, profileId))
    .limit(1);
  return row;
}

export async function findByUserIdWithAccount(userId: string): Promise<ProfileWithAccount | undefined> {
  const [row] = await db
    .select({ profile: profiles, displayName: users.name, userStatus: users.status })
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row;
}

export async function findById(profileId: string): Promise<ProfileRow | undefined> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  return row;
}

export type ProfileUpdate = Partial<Omit<NewProfile, "id" | "userId" | "createdAt">>;

export async function update(profileId: string, data: ProfileUpdate): Promise<ProfileRow> {
  const [row] = await db
    .update(profiles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(profiles.id, profileId))
    .returning();
  return row;
}

// --- Photos ------------------------------------------------------------

export async function listPhotos(profileId: string): Promise<ProfilePhotoRow[]> {
  return db.select().from(profilePhotos).where(eq(profilePhotos.profileId, profileId)).orderBy(asc(profilePhotos.sortOrder));
}

export async function countPhotos(profileId: string): Promise<number> {
  const rows = await db.select({ id: profilePhotos.id }).from(profilePhotos).where(eq(profilePhotos.profileId, profileId));
  return rows.length;
}

export async function findPhotoById(photoId: string): Promise<ProfilePhotoRow | undefined> {
  const [row] = await db.select().from(profilePhotos).where(eq(profilePhotos.id, photoId)).limit(1);
  return row;
}

export async function maxSortOrder(profileId: string): Promise<number> {
  const rows = await db
    .select({ sortOrder: profilePhotos.sortOrder })
    .from(profilePhotos)
    .where(eq(profilePhotos.profileId, profileId));
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), -1);
}

export async function createPhoto(data: NewProfilePhoto): Promise<ProfilePhotoRow> {
  const [row] = await db.insert(profilePhotos).values(data).returning();
  return row;
}

export async function deletePhoto(photoId: string): Promise<void> {
  await db.delete(profilePhotos).where(eq(profilePhotos.id, photoId));
}

/** Clears isPrimary on every OTHER photo for the profile, then sets it on
 * the target — used within a transaction so "exactly one primary photo"
 * never has a window where it's zero or two. */
export async function setPrimaryPhoto(profileId: string, photoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(profilePhotos)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(eq(profilePhotos.profileId, profileId), ne(profilePhotos.id, photoId)));
    await tx
      .update(profilePhotos)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(profilePhotos.id, photoId));
  });
}

export async function reorderPhotos(profileId: string, orderedPhotoIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedPhotoIds.length; i++) {
      await tx
        .update(profilePhotos)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(and(eq(profilePhotos.id, orderedPhotoIds[i]), eq(profilePhotos.profileId, profileId)));
    }
  });
}
