/**
 * B6: data access for `warning_categories` and `warnings`. Both were B1
 * schema-only foundation (see schema.ts) — this is the first code to
 * read or write either. A warning row is NEVER deleted, even once
 * acknowledged — see warnings.service.ts's documented "permanent
 * history" rule.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { warningCategories, warnings } from "@/server/db/schema";

export type WarningCategoryRow = typeof warningCategories.$inferSelect;
export type WarningRow = typeof warnings.$inferSelect;

export async function listWarningCategories(): Promise<WarningCategoryRow[]> {
  return db.select().from(warningCategories).orderBy(warningCategories.name);
}

export async function findWarningCategoryById(id: string): Promise<WarningCategoryRow | undefined> {
  const [row] = await db.select().from(warningCategories).where(eq(warningCategories.id, id)).limit(1);
  return row;
}

export async function createWarning(data: {
  userId: string;
  categoryId: string;
  issuedByAdminId: string;
  message: string;
}): Promise<WarningRow> {
  const [row] = await db
    .insert(warnings)
    .values({
      userId: data.userId,
      categoryId: data.categoryId,
      issuedByAdminId: data.issuedByAdminId,
      message: data.message,
      status: "ACTIVE",
    })
    .returning();
  return row;
}

export async function findWarningById(id: string): Promise<WarningRow | undefined> {
  const [row] = await db.select().from(warnings).where(eq(warnings.id, id)).limit(1);
  return row;
}

export async function listWarningsForUser(userId: string): Promise<WarningRow[]> {
  return db.select().from(warnings).where(eq(warnings.userId, userId)).orderBy(desc(warnings.createdAt));
}

/** Sets `acknowledgedAt` and `status: ACKNOWLEDGED` — never deletes or
 * otherwise mutates the original `message`/`categoryId`/`issuedByAdminId`
 * (permanent history — see warnings.service.ts). */
export async function acknowledgeWarning(id: string): Promise<WarningRow | undefined> {
  const [row] = await db
    .update(warnings)
    .set({ status: "ACKNOWLEDGED", acknowledgedAt: new Date() })
    .where(eq(warnings.id, id))
    .returning();
  return row;
}
