/**
 * PCP: resolves WHERE an OTP must physically be delivered for the active
 * channel, given the OTP's logical `identifier`.
 *
 * Existing flows (frozen B2/B3) identify an OTP by an e-mail address (login,
 * forgot-password, new-device) or — for SIGNUP while the SMS channel is active —
 * by `<countryCode><mobile>`. The identifier is also the lookup key used to
 * verify the code, so it must not change when the admin switches provider. That
 * means a provider can be asked to deliver an identifier that is "the other
 * kind" (a resend after a switch). This module bridges the gap:
 *
 *   identifier looks like an e-mail  → email = identifier, mobile = the member's mobile (users table)
 *   identifier looks like a mobile   → mobile = identifier, email = the member's e-mail (users table),
 *                                       or, for a SIGNUP that has no users row yet, the pending e-mail /
 *                                       mobile held in the latest OTP row's metadata for that identifier.
 *
 * Nothing here trusts client input: the lookup keys come from the server-side
 * OTP request (which already passed validation) and the result is only used as
 * a delivery address.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { otps, users } from "@/server/db/schema";
import type { OtpPurpose } from "../otp.types";

export interface OtpDestination {
  email?: string;
  /** Bare 10-digit Indian mobile number (what Fast2SMS expects). */
  mobile?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts "9876543210", "+919876543210", "919876543210"; returns the 10 digits or undefined. Only Indian numbers (starting 6-9) are accepted. */
export function toIndianMobile(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[\s\-()]/g, "");
  const m = /^(?:\+?91)?([6-9]\d{9})$/.exec(digits);
  return m ? m[1] : undefined;
}

export async function resolveOtpDestination(identifier: string, purpose: OtpPurpose): Promise<OtpDestination> {
  const id = identifier.trim();
  if (EMAIL_RE.test(id)) {
    const [u] = await db.select().from(users).where(eq(users.email, id.toLowerCase())).limit(1);
    if (u) return { email: id.toLowerCase(), mobile: toIndianMobile(`${u.countryCode}${u.mobileNumber}`) };
    // SIGNUP with an e-mail identifier: pending mobile lives in the OTP metadata.
    const meta = await latestMetadata(id, purpose);
    return { email: id.toLowerCase(), mobile: toIndianMobile(`${meta.countryCode ?? "+91"}${meta.mobileNumber ?? ""}`) };
  }
  const mobile = toIndianMobile(id);
  if (mobile) {
    const [u] = await db.select().from(users).where(eq(users.mobileNumber, mobile)).limit(1);
    if (u) return { mobile, email: u.email };
    const meta = await latestMetadata(id, purpose);
    return { mobile, email: typeof meta.email === "string" ? meta.email : undefined };
  }
  return {};
}

async function latestMetadata(identifier: string, purpose: OtpPurpose): Promise<{ email?: string; mobileNumber?: string; countryCode?: string }> {
  const [row] = await db
    .select({ metadata: otps.metadata })
    .from(otps)
    .where(and(eq(otps.identifier, identifier), eq(otps.purpose, purpose)))
    .orderBy(desc(otps.createdAt))
    .limit(1);
  const m = row?.metadata;
  return m && typeof m === "object" ? (m as { email?: string; mobileNumber?: string; countryCode?: string }) : {};
}
