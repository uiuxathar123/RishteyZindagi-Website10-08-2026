/**
 * Data-access layer for `otps`. Nothing above this file touches the `otps`
 * Drizzle table directly — otp.service.ts owns all the business rules
 * (cooldowns, attempt limits, purpose isolation); this file is pure
 * queries/writes.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otps } from "@/server/db/schema";
import type { OtpPurpose } from "./otp.types";

export type NewOtp = typeof otps.$inferInsert;
export type OtpRow = typeof otps.$inferSelect;

export async function create(data: NewOtp): Promise<OtpRow> {
  const [row] = await db.insert(otps).values(data).returning();
  return row;
}

/** The current live (not consumed, not invalidated, not expired) OTP for
 * this identifier+purpose, if any. There should be at most one at a time —
 * requesting a new code invalidates any prior live one — but this always
 * takes the most recent if that invariant were ever violated. */
export async function findActive(identifier: string, purpose: OtpPurpose): Promise<OtpRow | undefined> {
  const [row] = await db
    .select()
    .from(otps)
    .where(
      and(
        eq(otps.identifier, identifier),
        eq(otps.purpose, purpose),
        isNull(otps.consumedAt),
        isNull(otps.invalidatedAt),
        gt(otps.expiresAt, new Date())
      )
    )
    .orderBy(desc(otps.createdAt))
    .limit(1);
  return row;
}

/** Every OTP row created for this identifier+purpose since `windowStart`,
 * most recent first — regardless of consumed/invalidated/expired state.
 * Used to enforce the resend cooldown and the max-resends-per-window rule,
 * which must hold even after a code has expired or been used. */
export async function findRecentForResendCheck(
  identifier: string,
  purpose: OtpPurpose,
  windowStart: Date
): Promise<OtpRow[]> {
  return db
    .select()
    .from(otps)
    .where(and(eq(otps.identifier, identifier), eq(otps.purpose, purpose), gt(otps.createdAt, windowStart)))
    .orderBy(desc(otps.createdAt));
}

/** Invalidates any currently-live OTP(s) for this identifier+purpose —
 * called right before issuing a new one, so at most one code is ever
 * guessable/usable at a time per identifier+purpose. */
export async function invalidateActive(identifier: string, purpose: OtpPurpose): Promise<void> {
  await db
    .update(otps)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(otps.identifier, identifier),
        eq(otps.purpose, purpose),
        isNull(otps.consumedAt),
        isNull(otps.invalidatedAt)
      )
    );
}

export async function incrementAttempts(id: string): Promise<OtpRow> {
  const [row] = await db
    .update(otps)
    .set({ attempts: sql`${otps.attempts} + 1` })
    .where(eq(otps.id, id))
    .returning();
  return row;
}

export async function markConsumed(id: string): Promise<void> {
  await db.update(otps).set({ consumedAt: new Date() }).where(eq(otps.id, id));
}

export async function markInvalidated(id: string): Promise<void> {
  await db.update(otps).set({ invalidatedAt: new Date() }).where(eq(otps.id, id));
}

export async function setTicket(id: string, ticketHash: string, ticketExpiresAt: Date): Promise<void> {
  await db.update(otps).set({ ticketHash, ticketExpiresAt }).where(eq(otps.id, id));
}

/** A ticket is only ever looked up by its hash — never by OTP id — since
 * the ticket itself (not the original OTP id) is the bearer credential the
 * client holds between steps (e.g. verify-otp -> set-password). */
export async function findByTicketHash(ticketHash: string): Promise<OtpRow | undefined> {
  const [row] = await db.select().from(otps).where(eq(otps.ticketHash, ticketHash)).limit(1);
  return row;
}

export async function consumeTicket(id: string): Promise<void> {
  await db.update(otps).set({ ticketConsumedAt: new Date() }).where(eq(otps.id, id));
}
