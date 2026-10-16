/**
 * B19: change the e-mail address or mobile number on a member account.
 *
 * Two steps, both for the signed-in member:
 *   1. request  — current password + the new value. A one-time code (purpose CONTACT_CHANGE) is sent to the NEW
 *                 address / number (e-mail over SMTP, mobile over SMS), proving the member controls it.
 *   2. confirm  — the code. The account is updated, the new contact is marked verified, every OTHER session is signed
 *                 out, and the member is told (in-app, and by e-mail to the previous address when SMTP is configured).
 *
 * Rules: the password is always required (a stolen session alone cannot re-point the account); the code is bound to the
 * member, the type and the exact new value; the new value must not belong to anyone else (re-checked at confirm, and
 * the unique indexes are the final arbiter); this step can never be switched off in Platform Settings.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { deviceSessions, users } from "@/server/db/schema";
import { AuthenticationError, AuthorizationError, ConflictError, ValidationError } from "@/server/lib/errors";
import { verifyPassword } from "@/server/lib/password";
import { isMailerConfigured, sendMail } from "@/server/lib/mailer";
import { logError } from "@/server/lib/logger";
import type { AuthContext } from "@/server/middleware/authenticate";
import { record } from "@/server/modules/audit/audit.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as otpService from "@/server/modules/otp/otp.service";

type Meta = { ipAddress?: string | null; userAgent?: string | null };
export type ContactType = "EMAIL" | "MOBILE";

export interface ContactChangeInput {
  type: ContactType;
  newValue: string;
  countryCode?: string;
}

function normalise(input: ContactChangeInput): { value: string; countryCode: string; identifier: string } {
  if (input.type === "EMAIL") {
    const value = input.newValue.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 200) throw new ValidationError("A valid e-mail address is required.", [{ path: "newValue", message: "A valid e-mail address is required." }]);
    return { value, countryCode: "", identifier: value };
  }
  const value = input.newValue.trim();
  const countryCode = (input.countryCode ?? "+91").trim();
  if (!/^[0-9]{6,15}$/.test(value)) throw new ValidationError("Mobile number must be 6-15 digits, no country code or symbols.", [{ path: "newValue", message: "Mobile number must be 6-15 digits." }]);
  if (!/^\+[0-9]{1,4}$/.test(countryCode)) throw new ValidationError("Country code must look like +91.", [{ path: "countryCode", message: "Country code must look like +91." }]);
  return { value, countryCode, identifier: `${countryCode}${value}` };
}

function requireMember(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  return ctx.subject.id;
}

const maskMobile = (m: string) => `${"*".repeat(Math.max(0, m.length - 3))}${m.slice(-3)}`;
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

async function assertAvailable(userId: string, type: ContactType, value: string): Promise<void> {
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(type === "EMAIL" ? eq(users.email, value) : eq(users.mobileNumber, value), ne(users.id, userId)))
    .limit(1);
  if (taken) throw new ConflictError(type === "EMAIL" ? "That e-mail address is already used by another account." : "That mobile number is already used by another account.", { field: "newValue" });
}

export async function requestContactChange(ctx: AuthContext, input: ContactChangeInput & { password: string }, meta: Meta) {
  const userId = requireMember(ctx);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AuthenticationError("Invalid or expired session.");
  // 403, not 401: the session is valid, only the re-authentication failed. A 401 makes the BFF discard the session cookie.
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new AuthorizationError("The password is incorrect.");

  const n = normalise(input);
  if (input.type === "EMAIL" ? n.value === user.email : n.value === user.mobileNumber) throw new ValidationError("That is already your current " + (input.type === "EMAIL" ? "e-mail address." : "mobile number."), [{ path: "newValue", message: "Already your current value." }]);
  await assertAvailable(userId, input.type, n.value);

  const sent = await otpService.requestOtp({
    identifier: n.identifier,
    purpose: "CONTACT_CHANGE",
    userId,
    metadata: { userId, type: input.type, newValue: n.value, countryCode: n.countryCode },
    meta,
    channel: input.type === "EMAIL" ? "EMAIL" : "SMS",
  });
  await record({ actorType: "USER", actorId: userId, action: "account.contact_change_requested", entityType: "user", entityId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { type: input.type } });
  return { type: input.type, sentTo: input.type === "EMAIL" ? maskEmail(n.value) : maskMobile(n.value), channel: sent.channel, expiresInSeconds: sent.expiresInSeconds, resendAvailableAt: sent.resendAvailableAt };
}

export async function confirmContactChange(ctx: AuthContext, input: ContactChangeInput & { code: string }, meta: Meta) {
  const userId = requireMember(ctx);
  const n = normalise(input);
  // A wrong code is a failed check inside a valid session: 403, never 401 (which would sign the member out in the BFF).
  let verified: Awaited<ReturnType<typeof otpService.verifyOtpDirect>>;
  try {
    verified = await otpService.verifyOtpDirect(n.identifier, "CONTACT_CHANGE", input.code);
  } catch (e) {
    if (e instanceof AuthenticationError) throw new AuthorizationError("Invalid or expired code.");
    throw e;
  }
  const m = verified.metadata as { userId?: string; type?: string; newValue?: string } | null;
  // The code must have been issued to THIS member for exactly this change.
  if (verified.userId !== userId || m?.userId !== userId || m?.type !== input.type || m?.newValue !== n.value) {
    throw new AuthorizationError("Invalid or expired code.");
  }
  await assertAvailable(userId, input.type, n.value);

  const [before] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!before) throw new AuthenticationError("Invalid or expired session.");
  const now = new Date();
  let revoked = 0;
  try {
    revoked = await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set(
          input.type === "EMAIL"
            ? { email: n.value, emailVerifiedAt: now, updatedAt: now }
            : { mobileNumber: n.value, countryCode: n.countryCode, mobileVerifiedAt: now, updatedAt: now }
        )
        .where(eq(users.id, userId));
      // Sign out everything except the session that made this change.
      const rows = await tx
        .update(deviceSessions)
        .set({ revokedAt: now })
        .where(and(eq(deviceSessions.userId, userId), isNull(deviceSessions.revokedAt), ne(deviceSessions.id, ctx.sessionId)))
        .returning({ id: deviceSessions.id });
      return rows.length;
    });
  } catch (e) {
    // The unique indexes are the final arbiter if someone else claimed the value between check and write.
    if ((e as { code?: string })?.code === "23505" || /unique/i.test(String((e as Error)?.message))) {
      throw new ConflictError("That value was just taken by another account.", { field: "newValue" });
    }
    throw e;
  }

  await record({
    actorType: "USER",
    actorId: userId,
    action: input.type === "EMAIL" ? "account.email_changed" : "account.mobile_changed",
    entityType: "user",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    // Previous and new values are masked: the audit log never holds a full contact detail.
    metadata: { previous: input.type === "EMAIL" ? maskEmail(before.email) : maskMobile(before.mobileNumber), new: input.type === "EMAIL" ? maskEmail(n.value) : maskMobile(n.value), otherSessionsRevoked: revoked },
  });
  await notify({
    userId,
    channel: "IN_APP",
    title: input.type === "EMAIL" ? "Your e-mail address was changed" : "Your mobile number was changed",
    body: "If this wasn't you, reset your password straight away and contact support.",
    dedupeKey: `contact_changed:${userId}:${now.getTime()}`,
  });
  if (input.type === "EMAIL" && isMailerConfigured()) {
    try {
      await sendMail({ to: before.email, subject: "Your RishteyZindagi e-mail address was changed", text: `The e-mail address on your RishteyZindagi account was changed to ${maskEmail(n.value)}.\n\nIf you did not do this, reset your password immediately and contact support.` }, "contact-change-notice");
    } catch (e) {
      logError("contact-change-notice-failed", e, { userId });
    }
  }
  return { type: input.type, otherSessionsRevoked: revoked };
}
