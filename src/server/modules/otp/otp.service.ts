/**
 * OTP business-rule core (B2). Every auth flow that needs an OTP
 * (signup, login, forgot-password, new-device verification) calls these
 * four functions — nothing else in the codebase touches otp.repository.ts
 * or an OtpProvider directly:
 *
 *   - `requestOtp`   generate + deliver a code, enforcing the singleton
 *                     otp_configs settings (cooldown, resend window/limit,
 *                     enabled flag, active channel).
 *   - `verifyOtpAndIssueTicket`
 *                     verify a code and, on success, mint a short-lived
 *                     opaque "verification ticket" that bridges to the
 *                     flow's next step (e.g. SIGNUP: verify-otp ->
 *                     set-password) without re-sending or re-checking the
 *                     code, and without a separate "pending" table.
 *   - `verifyOtpDirect`
 *                     verify a code with no ticket step, for flows that
 *                     complete in the same call (e.g. LOGIN/NEW_DEVICE).
 *   - `consumeTicket` redeem a ticket exactly once, for the step that
 *                     follows a ticket-issuing verify.
 *
 * Every code is single-use (consumedAt), purpose-isolated (identifier +
 * purpose together select the row — an OTP for LOGIN can never verify a
 * FORGOT_PASSWORD request for the same email), expiring, and
 * attempt-limited. The plaintext code is NEVER stored, logged, or
 * returned by any of these functions — only a keyed hash
 * (see lib/otp-hash.ts), mirroring how session tokens are handled.
 */
import { AuthenticationError, RateLimitError, ServiceUnavailableError } from "@/server/lib/errors";
import {
  generateOtpCode,
  generateVerificationTicket,
  hashOtpCode,
  hashVerificationTicket,
  timingSafeEqualHex,
} from "@/server/lib/otp-hash";
import { getOtpProvider } from "./providers/factory";
import { missingMailerSettings } from "@/server/lib/mailer";
import { SmsOtpProvider } from "./providers/sms.provider";
import * as otpConfigRepo from "./otp-config.repository";
import * as otpRepo from "./otp.repository";
import type { OtpMethod, OtpPurpose } from "./otp.types";

/** How long a verification ticket stays redeemable after a successful
 * verify. Deliberately short — just long enough to complete the very next
 * request (e.g. submit a new password) — and, like an OTP, single-use. */
const TICKET_TTL_SECONDS = 600;

export interface RequestOtpInput {
  /** Already-normalized destination (lowercased email, or a bare mobile
   * number) — callers are responsible for normalization so the same
   * identifier string is used consistently for rate-limit lookups. */
  identifier: string;
  purpose: OtpPurpose;
  /** Set when the identifier already maps to an existing user (LOGIN,
   * FORGOT_PASSWORD, NEW_DEVICE). Left undefined for SIGNUP, where no
   * users row exists yet. */
  userId?: string;
  /** Purpose-specific draft data carried on the OTP row until it's
   * consumed — e.g. SIGNUP's pending name/email/mobile, or NEW_DEVICE's
   * device id. Never contains a password or the OTP code itself. */
  metadata?: Record<string, unknown>;
  meta: { ipAddress?: string | null; userAgent?: string | null };
}

export interface RequestOtpResult {
  channel: OtpMethod;
  expiresInSeconds: number;
  resendAvailableAt: string;
}

export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  const config = await otpConfigRepo.get();
  if (!config.enabled) {
    throw new ServiceUnavailableError("OTP delivery is currently disabled by the platform.");
  }

  const now = Date.now();
  const windowStart = new Date(now - config.resendWindowSeconds * 1000);
  const recent = await otpRepo.findRecentForResendCheck(input.identifier, input.purpose, windowStart);

  if (recent.length > 0 && now - recent[0].createdAt.getTime() < config.resendCooldownSeconds * 1000) {
    throw new RateLimitError("Please wait before requesting another code.");
  }
  if (recent.length >= config.maxResendAttempts) {
    throw new RateLimitError("Too many code requests for this window. Please try again later.");
  }

  const code = generateOtpCode(config.otpLength);
  const codeHash = hashOtpCode(code, input.identifier, input.purpose);

  // Delivery is attempted BEFORE any DB write — a failed send (e.g. the
  // active channel has no real provider configured) must never invalidate
  // a still-live prior code, consume a resend slot that produced nothing,
  // or leave behind an OTP row nobody could ever have received.
  const provider = getOtpProvider(config.activeMethod, config.devMode);
  await provider.send({
    to: input.identifier,
    code,
    purpose: input.purpose,
    expirySeconds: config.otpExpirySeconds,
  });

  await otpRepo.invalidateActive(input.identifier, input.purpose);
  await otpRepo.create({
    purpose: input.purpose,
    channel: config.activeMethod,
    identifier: input.identifier,
    userId: input.userId,
    codeHash,
    attempts: 0,
    maxAttempts: config.maxVerifyAttempts,
    expiresAt: new Date(now + config.otpExpirySeconds * 1000),
    metadata: input.metadata,
    ipAddress: input.meta.ipAddress ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return {
    channel: config.activeMethod,
    expiresInSeconds: config.otpExpirySeconds,
    resendAvailableAt: new Date(now + config.resendCooldownSeconds * 1000).toISOString(),
  };
}

export interface OtpDeliveryReadiness {
  channel: OtpMethod;
  /** A code could be delivered right now on the active channel (OTP enabled and a configured provider or the non-production dev provider). */
  ready: boolean;
  devMode: boolean;
  /** Names (never values) of the environment variables still missing for the active channel. */
  missing: string[];
}

/** Read-only status for the Super Admin screen: would a sign-up code actually reach the person? Never sends anything. */
export async function getOtpDeliveryReadiness(): Promise<OtpDeliveryReadiness> {
  const config = await otpConfigRepo.get();
  const provider = getOtpProvider(config.activeMethod, config.devMode);
  const ready = config.enabled && provider.isConfigured();
  let missing: string[] = [];
  if (!ready && config.enabled) {
    if (config.activeMethod === "EMAIL") missing = missingMailerSettings();
    else if (config.activeMethod === "SMS") missing = new SmsOtpProvider().missingSettings();
  }
  return { channel: config.activeMethod, ready, devMode: config.devMode, missing };
}

/** The platform's currently active OTP delivery channel — callers that
 * need to pick which contact field to use as the `identifier` (an email
 * address vs. a phone number) before calling requestOtp need this. */
export async function getActiveChannel(): Promise<OtpMethod> {
  return (await otpConfigRepo.get()).activeMethod;
}

export interface PublicOtpDefaults {
  channel: OtpMethod;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
}

/** Non-secret OTP settings safe to derive a response from even when no
 * OTP is actually being sent — used by enumeration-sensitive callers
 * (requestLoginOtp, forgotPassword, resendOtp) so the response shape and
 * timing for "account exists" and "account doesn't exist" are identical. */
export async function getPublicOtpDefaults(): Promise<PublicOtpDefaults> {
  const config = await otpConfigRepo.get();
  return {
    channel: config.activeMethod,
    expiresInSeconds: config.otpExpirySeconds,
    resendCooldownSeconds: config.resendCooldownSeconds,
  };
}

/**
 * Re-issues an OTP for an identifier+purpose that already had one sent at
 * least once, reusing that prior attempt's `userId`/`metadata` so the
 * caller doesn't have to resupply a multi-field payload (e.g. SIGNUP's
 * pending name/email/mobile) just to resend a code.
 *
 * If NO prior OTP was ever created for this identifier+purpose, this
 * "succeeds" without sending anything — the same non-enumeration shape
 * `getPublicOtpDefaults` produces — so resend can't be used to probe for
 * an account that never had a first OTP sent (LOGIN/FORGOT_PASSWORD/
 * NEW_DEVICE only ever create that first row when the account is real;
 * see auth.service.ts).
 */
export async function resendOtp(
  identifier: string,
  purpose: OtpPurpose,
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<RequestOtpResult> {
  const [latest] = await otpRepo.findRecentForResendCheck(identifier, purpose, new Date(0));
  if (!latest) {
    const defaults = await getPublicOtpDefaults();
    return {
      channel: defaults.channel,
      expiresInSeconds: defaults.expiresInSeconds,
      resendAvailableAt: new Date(Date.now() + defaults.resendCooldownSeconds * 1000).toISOString(),
    };
  }
  return requestOtp({
    identifier,
    purpose,
    userId: latest.userId ?? undefined,
    metadata: (latest.metadata as Record<string, unknown> | null) ?? undefined,
    meta,
  });
}

interface VerifiedOtp {
  otpId: string;
  userId?: string | null;
  metadata: unknown;
}

/** Shared verify-and-consume core. Every failure path (no live code, too
 * many attempts, wrong code) returns the exact same generic message —
 * never revealing which case occurred — so a caller can't distinguish
 * "no such request" from "wrong code" from "expired" by probing. */
async function verifyAndConsume(identifier: string, purpose: OtpPurpose, code: string): Promise<VerifiedOtp> {
  const row = await otpRepo.findActive(identifier, purpose);
  const genericError = () => new AuthenticationError("Invalid or expired code.");
  if (!row) throw genericError();

  if (row.attempts >= row.maxAttempts) {
    await otpRepo.markInvalidated(row.id);
    throw genericError();
  }

  const candidateHash = hashOtpCode(code, identifier, purpose);
  if (!timingSafeEqualHex(candidateHash, row.codeHash)) {
    const updated = await otpRepo.incrementAttempts(row.id);
    if (updated.attempts >= updated.maxAttempts) {
      await otpRepo.markInvalidated(row.id);
    }
    throw genericError();
  }

  await otpRepo.markConsumed(row.id);
  return { otpId: row.id, userId: row.userId, metadata: row.metadata };
}

export interface VerifyWithTicketResult {
  ticket: string;
  ticketExpiresAt: string;
  userId?: string | null;
  metadata: unknown;
}

/** Verifies a code and mints a one-time ticket for a multi-step flow
 * (SIGNUP verify-otp -> set-password; FORGOT_PASSWORD verify -> reset). */
export async function verifyOtpAndIssueTicket(
  identifier: string,
  purpose: OtpPurpose,
  code: string
): Promise<VerifyWithTicketResult> {
  const verified = await verifyAndConsume(identifier, purpose, code);

  const ticket = generateVerificationTicket();
  const ticketExpiresAt = new Date(Date.now() + TICKET_TTL_SECONDS * 1000);
  await otpRepo.setTicket(verified.otpId, hashVerificationTicket(ticket), ticketExpiresAt);

  return {
    ticket,
    ticketExpiresAt: ticketExpiresAt.toISOString(),
    userId: verified.userId,
    metadata: verified.metadata,
  };
}

/** Verifies a code with no ticket step — for flows that complete in the
 * same request (LOGIN OTP, NEW_DEVICE verification). */
export async function verifyOtpDirect(identifier: string, purpose: OtpPurpose, code: string): Promise<VerifiedOtp> {
  return verifyAndConsume(identifier, purpose, code);
}

export interface ConsumedTicket {
  userId?: string | null;
  metadata: unknown;
}

/** Redeems a verification ticket exactly once. Checks the ticket's hash,
 * that it was issued for this same identifier+purpose (a ticket from a
 * FORGOT_PASSWORD verify can never be replayed to complete a SIGNUP), that
 * it hasn't already been consumed, and that it hasn't expired. */
export async function consumeTicket(identifier: string, purpose: OtpPurpose, ticket: string): Promise<ConsumedTicket> {
  const genericError = () => new AuthenticationError("Invalid or expired verification ticket.");
  const row = await otpRepo.findByTicketHash(hashVerificationTicket(ticket));

  if (!row || row.identifier !== identifier || row.purpose !== purpose) throw genericError();
  if (row.ticketConsumedAt) throw genericError();
  if (!row.ticketExpiresAt || row.ticketExpiresAt.getTime() < Date.now()) throw genericError();

  await otpRepo.consumeTicket(row.id);
  return { userId: row.userId, metadata: row.metadata };
}

/**
 * B18: mint a ticket WITHOUT a code, for a workflow the Super Admin has switched to OTP_NOT_REQUIRED
 * (see platform-settings.service.ts). Only the server calls this, after it has read the policy; it is never reachable
 * from a request body. The row is created already-consumed with a flag in its metadata so audit queries and
 * `setPassword` can tell a policy-skipped signup from a verified one. Purpose isolation, single use and expiry
 * work exactly as for a verified ticket.
 */
export async function issuePolicyTicket(input: {
  identifier: string;
  purpose: OtpPurpose;
  metadata: Record<string, unknown>;
  meta: { ipAddress?: string | null; userAgent?: string | null };
}): Promise<{ ticket: string; ticketExpiresAt: string }> {
  const config = await otpConfigRepo.get();
  const ticket = generateVerificationTicket();
  const ticketExpiresAt = new Date(Date.now() + TICKET_TTL_SECONDS * 1000);
  const row = await otpRepo.create({
    purpose: input.purpose,
    channel: config.activeMethod,
    identifier: input.identifier,
    // No code exists. The hash is of random bytes nobody holds, so this row can never be "verified" later.
    codeHash: hashOtpCode(generateOtpCode(Math.max(config.otpLength, 6)), input.identifier, input.purpose),
    attempts: 0,
    maxAttempts: 0,
    expiresAt: new Date(),
    consumedAt: new Date(),
    metadata: { ...input.metadata, otpSkippedByPolicy: true },
    ipAddress: input.meta.ipAddress ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });
  await otpRepo.setTicket(row.id, hashVerificationTicket(ticket), ticketExpiresAt);
  return { ticket, ticketExpiresAt: ticketExpiresAt.toISOString() };
}
