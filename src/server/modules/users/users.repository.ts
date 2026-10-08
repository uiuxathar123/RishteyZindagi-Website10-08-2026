/**
 * Data-access layer for `users`. Nothing above this file writes raw SQL
 * or touches the `users` Drizzle table directly — the service layer only
 * calls these functions, so the query shape can change in one place.
 */
import { eq, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";

export type NewUser = typeof users.$inferInsert;
export type UserRow = typeof users.$inferSelect;

export async function findByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

export async function findByMobile(mobileNumber: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.mobileNumber, mobileNumber)).limit(1);
  return row;
}

export async function findByEmailOrMobile(email: string, mobileNumber: string): Promise<UserRow[]> {
  return db
    .select()
    .from(users)
    .where(or(eq(users.email, email), eq(users.mobileNumber, mobileNumber)));
}

export async function findById(id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function create(data: NewUser): Promise<UserRow> {
  const [row] = await db.insert(users).values(data).returning();
  return row;
}

/** B2: used by /auth/reset-password. Never called with a plaintext
 * password — callers must hash first (see lib/password.ts). */
export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
}
