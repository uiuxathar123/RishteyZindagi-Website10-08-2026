/** PCP: session revocation helpers shared by account deletion, moderation and staff management. */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { deviceSessions, devicePushTokens } from "@/server/db/schema";

type Tx = Pick<typeof db, "update">;

export async function revokeUserSessions(userId: string, tx: Tx = db): Promise<number> {
  const rows = await tx
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt)))
    .returning({ id: deviceSessions.id });
  return rows.length;
}

export async function revokeAdminSessions(adminId: string, exceptSessionId?: string, tx: Tx = db): Promise<number> {
  const rows = await tx
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceSessions.adminUserId, adminId),
        isNull(deviceSessions.revokedAt),
        ...(exceptSessionId ? [ne(deviceSessions.id, exceptSessionId)] : [])
      )
    )
    .returning({ id: deviceSessions.id });
  return rows.length;
}

export async function revokeUserPushTokens(userId: string, tx: Tx = db): Promise<void> {
  await tx.update(devicePushTokens).set({ revokedAt: new Date() }).where(and(eq(devicePushTokens.userId, userId), isNull(devicePushTokens.revokedAt)));
}
