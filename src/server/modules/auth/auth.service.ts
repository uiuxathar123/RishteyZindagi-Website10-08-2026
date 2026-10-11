/**
 * Authentication + OTP (B2). Builds on B1's minimal register/login (kept
 * as the technical foundation §6/§7 asked for) into the real flows:
 *
 *  - SIGNUP: register -> (OTP sent) -> verifySignupOtp -> setPassword.
 *    No `users` row exists until setPassword — the pending name/email/
 *    mobile live only in the OTP's `metadata` (see otp.service.ts), so an
 *    abandoned signup never creates an account and there's no separate
 *    "pending signup" table. The OTP purpose that verified the contact
 *    method also marks it verified on the new row (emailVerifiedAt /
 *    mobileVerifiedAt), since that's exactly what happened.
 *  - LOGIN (password): device-aware. A request from a device the caller
 *    has never had a session on (per the `X-Device-Id` header, not
 *    fingerprinting) does NOT get a session token back — it gets a
 *    NEW_DEVICE OTP and `deviceVerificationRequired: true`; the client
 *    then calls verifyDevice to actually get a session.
 *  - LOGIN (OTP): requestLoginOtp / verifyLoginOtp — a password-free
 *    alternative. Successfully verifying it IS the device proof, so it
 *    never triggers a separate device-verification step.
 *  - FORGOT PASSWORD: forgotPassword / resetPassword. Both, and
 *    requestLoginOtp, respond identically whether or not the account
 *    exists (no enumeration) — see each function's comment.
 *  - Every credential-bearing action writes a `login_attempts` row
 *    (success/failure + method + failureReason) and, on anything that
 *    changes auth state, an audit_logs entry via the audit service.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { deviceSessions, loginAttempts } from "@/server/db/schema";
import * as usersRepo from "@/server/modules/users/users.repository";
import * as otpService from "@/server/modules/otp/otp.service";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import { generateSessionToken, hashSessionToken, sessionExpiryDate } from "@/server/lib/session";
import { AuthenticationError, AuthorizationError, ConflictError } from "@/server/lib/errors";
import * as platformSettings from "@/server/modules/platform-settings/platform-settings.service";
import { record } from "@/server/modules/audit/audit.service";
import { toPublicUser, type PublicUser } from "@/server/modules/users/users.dto";
import type { UserRow } from "@/server/modules/users/users.repository";

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Client-supplied persistent device id (X-Device-Id header) — the
   * privacy-conscious alternative to fingerprinting used to tell a known
   * device from a new one. Absent entirely from a client that doesn't
   * send it, which is always treated as "new device" (fail safe, not
   * fail open). */
  deviceId?: string | null;
}

function buildSignupIdentifier(channel: "SMS" | "WHATSAPP" | "EMAIL", email: string, mobileNumber: string, countryCode: string) {
  return channel === "EMAIL" ? email : `${countryCode}${mobileNumber}`;
}

async function issueSession(
  user: Pick<UserRow, "id">,
  meta: RequestMeta
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const sessionToken = generateSessionToken();
  const expiresAt = sessionExpiryDate();
  await db.insert(deviceSessions).values({
    userId: user.id,
    tokenHash: hashSessionToken(sessionToken),
    deviceId: meta.deviceId ?? undefined,
    ipAddress: meta.ipAddress ?? undefined,
    browserInfo: meta.userAgent ?? undefined,
    expiresAt,
  });
  return { sessionToken, expiresAt };
}

// ---------------------------------------------------------------------------
// Signup: register -> verifySignupOtp -> setPassword
// ---------------------------------------------------------------------------

export interface RegisterInput {
  name: string;
  email: string;
  mobileNumber: string;
  countryCode?: string;
}

export interface RegisterResult {
  identifier: string;
  channel: string;
  expiresInSeconds: number;
  resendAvailableAt: string;
  /**
   * B18: false when the Super Admin has set SIGNUP_VERIFICATION to OTP_NOT_REQUIRED. In that case no code was sent
   * and `ticket` is a ready-to-use one-time ticket for POST /auth/set-password. Absent/true = the normal flow.
   */
  otpRequired?: boolean;
  ticket?: string;
  ticketExpiresAt?: string;
}

export async function register(input: RegisterInput, meta: RequestMeta): Promise<RegisterResult> {
  const countryCode = input.countryCode ?? "+91";
  const clashes = await usersRepo.findByEmailOrMobile(input.email, input.mobileNumber);
  if (clashes.some((u) => u.email === input.email)) {
    throw new ConflictError("An account with this email already exists.", { field: "email" });
  }
  if (clashes.some((u) => u.mobileNumber === input.mobileNumber)) {
    throw new ConflictError("An account with this mobile number already exists.", { field: "mobileNumber" });
  }

  // B18: policy SIGNUP_VERIFICATION. When the Super Admin has switched the contact check off, no code is sent; the
  // server issues the one-time ticket itself and the account is created with e-mail/mobile UNVERIFIED.
  if (!(await platformSettings.isOtpRequired("SIGNUP_VERIFICATION"))) {
    const identifier = input.email;
    const { ticket, ticketExpiresAt } = await otpService.issuePolicyTicket({
      identifier,
      purpose: "SIGNUP",
      metadata: { name: input.name, email: input.email, mobileNumber: input.mobileNumber, countryCode },
      meta,
    });
    await record({
      actorType: "SYSTEM",
      action: "signup.otp_skipped_by_policy",
      entityType: "otp",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { identifier, policy: "SIGNUP_VERIFICATION:OTP_NOT_REQUIRED" },
    });
    return { identifier, channel: "NONE", expiresInSeconds: 0, resendAvailableAt: new Date().toISOString(), otpRequired: false, ticket, ticketExpiresAt };
  }

  const channel = await otpService.getActiveChannel();
  const identifier = buildSignupIdentifier(channel, input.email, input.mobileNumber, countryCode);

  const result = await otpService.requestOtp({
    identifier,
    purpose: "SIGNUP",
    metadata: { name: input.name, email: input.email, mobileNumber: input.mobileNumber, countryCode },
    meta,
  });

  await record({
    actorType: "SYSTEM",
    action: "signup.otp_requested",
    entityType: "otp",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { identifier, purpose: "SIGNUP" },
  });

  return { identifier, channel: result.channel, expiresInSeconds: result.expiresInSeconds, resendAvailableAt: result.resendAvailableAt };
}

export interface VerifySignupOtpInput {
  identifier: string;
  code: string;
}

export interface VerifySignupOtpResult {
  ticket: string;
  ticketExpiresAt: string;
}

export async function verifySignupOtp(input: VerifySignupOtpInput): Promise<VerifySignupOtpResult> {
  const result = await otpService.verifyOtpAndIssueTicket(input.identifier, "SIGNUP", input.code);
  return { ticket: result.ticket, ticketExpiresAt: result.ticketExpiresAt };
}

interface SignupMetadata {
  name: string;
  email: string;
  mobileNumber: string;
  countryCode: string;
}

function isSignupMetadata(value: unknown): value is SignupMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SignupMetadata).name === "string" &&
    typeof (value as SignupMetadata).email === "string" &&
    typeof (value as SignupMetadata).mobileNumber === "string" &&
    typeof (value as SignupMetadata).countryCode === "string"
  );
}

export interface SetPasswordInput {
  identifier: string;
  ticket: string;
  password: string;
}

export interface SetPasswordResult {
  user: PublicUser;
  sessionToken: string;
  expiresAt: string;
}

export async function setPassword(input: SetPasswordInput, meta: RequestMeta): Promise<SetPasswordResult> {
  const consumed = await otpService.consumeTicket(input.identifier, "SIGNUP", input.ticket);
  if (!isSignupMetadata(consumed.metadata)) {
    // The ticket was valid but doesn't carry a signup payload — a
    // data-integrity condition, not something a well-behaved client can
    // trigger, so a generic auth error (no internal detail) is correct.
    throw new AuthenticationError("Invalid or expired verification ticket.");
  }
  const pending = consumed.metadata;

  // A ticket minted while the Super Admin had sign-up verification OFF is only honoured while it is still OFF.
  // If the switch was turned back ON in the meantime the ticket is spent and the person must register again (this
  // time with a code) — the setting is enforced on every sign-up request, not only when the ticket was issued.
  const skippedByPolicy = (consumed.metadata as { otpSkippedByPolicy?: unknown }).otpSkippedByPolicy === true;
  if (skippedByPolicy && (await platformSettings.isOtpRequired("SIGNUP_VERIFICATION"))) {
    await record({
      actorType: "SYSTEM",
      action: "signup.policy_ticket_rejected",
      entityType: "otp",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { identifier: input.identifier, reason: "SIGNUP_VERIFICATION is OTP_REQUIRED again" },
    });
    throw new AuthenticationError("Sign-up verification is now required. Please start registration again.");
  }

  // Re-check uniqueness — time has passed since register(), so someone
  // else may have taken the email/mobile in the meantime.
  const clashes = await usersRepo.findByEmailOrMobile(pending.email, pending.mobileNumber);
  if (clashes.some((u) => u.email === pending.email)) {
    throw new ConflictError("An account with this email already exists.", { field: "email" });
  }
  if (clashes.some((u) => u.mobileNumber === pending.mobileNumber)) {
    throw new ConflictError("An account with this mobile number already exists.", { field: "mobileNumber" });
  }

  const passwordHash = await hashPassword(input.password);
  const identifierWasEmail = input.identifier === pending.email;
  const created = await usersRepo.create({
    name: pending.name,
    email: pending.email,
    mobileNumber: pending.mobileNumber,
    countryCode: pending.countryCode,
    passwordHash,
    // Whichever contact method actually received and proved the OTP is
    // verified by construction — the other stays unverified until its own
    // verification flow (not built in B2 scope).
    // B18: a signup that skipped the code by policy proved ownership of neither contact method.
    emailVerifiedAt: skippedByPolicy ? undefined : identifierWasEmail ? new Date() : undefined,
    mobileVerifiedAt: skippedByPolicy ? undefined : identifierWasEmail ? undefined : new Date(),
  });

  await record({
    actorType: "USER",
    actorId: created.id,
    action: "user.register",
    entityType: "user",
    entityId: created.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: skippedByPolicy ? { contactVerified: false, policy: "SIGNUP_VERIFICATION:OTP_NOT_REQUIRED" } : { contactVerified: true },
  });

  const { sessionToken, expiresAt } = await issueSession(created, meta);

  await record({
    actorType: "USER",
    actorId: created.id,
    action: "user.login",
    entityType: "user",
    entityId: created.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { reason: "post_signup_auto_login" },
  });

  return { user: toPublicUser(created), sessionToken, expiresAt: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Login (password), device verification, and login (OTP)
// ---------------------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  user: PublicUser;
  sessionToken: string;
  expiresAt: string;
}

export interface DeviceVerificationRequired {
  deviceVerificationRequired: true;
  identifier: string;
  channel: string;
  expiresInSeconds: number;
  resendAvailableAt: string;
}

async function isKnownDevice(userId: string, deviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: deviceSessions.id })
    .from(deviceSessions)
    .where(and(eq(deviceSessions.userId, userId), eq(deviceSessions.deviceId, deviceId)))
    .limit(1);
  return Boolean(row);
}

async function recordLoginAttempt(params: {
  userId?: string;
  identifier: string;
  success: boolean;
  method: "PASSWORD" | "OTP";
  failureReason?: string;
  meta: RequestMeta;
}) {
  await db.insert(loginAttempts).values({
    userId: params.userId,
    identifier: params.identifier,
    success: params.success,
    method: params.method,
    failureReason: params.failureReason,
    ipAddress: params.meta.ipAddress ?? undefined,
    userAgent: params.meta.userAgent ?? undefined,
  });
}

// B10: a fixed, valid bcrypt hash of an arbitrary placeholder string —
// never a real credential, never derived from any real user's password.
// Used only as verifyPassword's comparison target when no account
// matches the supplied email, so bcrypt.compare() always runs (same
// cost factor) whether or not the account exists. Without this,
// "account doesn't exist" returns near-instantly while "account exists,
// wrong password" pays bcrypt's ~100ms+ cost — a measurable timing
// side-channel an attacker could use to enumerate registered emails even
// though the response body/status are already identical either way.
const DUMMY_PASSWORD_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8O9mVeNVCXvEmNXfWFXDLYW.dg7CJ.";

export async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult | DeviceVerificationRequired> {
  const user = await usersRepo.findByEmail(input.email);
  const valid = await verifyPassword(input.password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);

  if (!user || !valid) {
    await recordLoginAttempt({ identifier: input.email, success: false, method: "PASSWORD", failureReason: "INVALID_CREDENTIALS", meta });
    throw new AuthenticationError("Invalid email or password.");
  }
  if (user.status !== "ACTIVE") {
    await recordLoginAttempt({ userId: user.id, identifier: input.email, success: false, method: "PASSWORD", failureReason: "ACCOUNT_INACTIVE", meta });
    throw new AuthenticationError("This account is not active.");
  }

  const knownDevice = meta.deviceId ? await isKnownDevice(user.id, meta.deviceId) : false;
  // B18: policy NEW_DEVICE_LOGIN. The password above has ALREADY been verified and the account is ACTIVE; the policy
  // only decides whether an unrecognised device must also pass the emailed/SMS code.
  const deviceOtpRequired = knownDevice ? false : await platformSettings.isOtpRequired("NEW_DEVICE_LOGIN");
  if (!knownDevice && deviceOtpRequired) {
    // Correct credentials, but a device we've never issued this user a
    // session on — step up via a NEW_DEVICE OTP instead of granting a
    // session outright. Still recorded as a successful *credential* check
    // in the audit trail, but not yet a completed login.
    const otpResult = await otpService.requestOtp({
      identifier: input.email,
      purpose: "NEW_DEVICE",
      userId: user.id,
      metadata: { deviceId: meta.deviceId ?? null },
      meta,
    });
    await record({
      actorType: "USER",
      actorId: user.id,
      action: "user.login.device_verification_required",
      entityType: "user",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return {
      deviceVerificationRequired: true,
      identifier: input.email,
      channel: otpResult.channel,
      expiresInSeconds: otpResult.expiresInSeconds,
      resendAvailableAt: otpResult.resendAvailableAt,
    };
  }

  await recordLoginAttempt({ userId: user.id, identifier: input.email, success: true, method: "PASSWORD", meta });
  const { sessionToken, expiresAt } = await issueSession(user, meta);
  await record({
    actorType: "USER",
    actorId: user.id,
    action: "user.login",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: !knownDevice ? { newDevice: true, deviceId: meta.deviceId ?? null, policy: "NEW_DEVICE_LOGIN:OTP_NOT_REQUIRED" } : undefined,
  });

  return { user: toPublicUser(user), sessionToken, expiresAt: expiresAt.toISOString() };
}

export interface VerifyDeviceInput {
  identifier: string;
  code: string;
}

export async function verifyDevice(input: VerifyDeviceInput, meta: RequestMeta): Promise<LoginResult> {
  let result: Awaited<ReturnType<typeof otpService.verifyOtpDirect>>;
  try {
    result = await otpService.verifyOtpDirect(input.identifier, "NEW_DEVICE", input.code);
  } catch (err) {
    await recordLoginAttempt({ identifier: input.identifier, success: false, method: "OTP", failureReason: "INVALID_OTP", meta });
    throw err;
  }
  if (!result.userId) throw new AuthenticationError("Invalid or expired code.");

  const user = await usersRepo.findById(result.userId);
  if (!user || user.status !== "ACTIVE") {
    await recordLoginAttempt({ userId: user?.id, identifier: input.identifier, success: false, method: "OTP", failureReason: "ACCOUNT_INACTIVE", meta });
    throw new AuthenticationError("Invalid or expired code.");
  }

  await recordLoginAttempt({ userId: user.id, identifier: input.identifier, success: true, method: "OTP", meta });
  const { sessionToken, expiresAt } = await issueSession(user, meta);
  await record({
    actorType: "USER",
    actorId: user.id,
    action: "user.device_verified",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { deviceId: meta.deviceId ?? null },
  });
  await record({
    actorType: "USER",
    actorId: user.id,
    action: "user.login",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { user: toPublicUser(user), sessionToken, expiresAt: expiresAt.toISOString() };
}

/** Always responds with the same shape regardless of whether `email`
 * belongs to an account — see otp.service.ts's requestOtp/resendOtp
 * non-enumeration comment for the general pattern. */
export async function requestLoginOtp(email: string, meta: RequestMeta): Promise<otpService.RequestOtpResult> {
  const defaults = await otpService.getPublicOtpDefaults();
  const user = await usersRepo.findByEmail(email);

  if (user && user.status === "ACTIVE") {
    return otpService.requestOtp({ identifier: email, purpose: "LOGIN", userId: user.id, meta });
  }

  return {
    channel: defaults.channel,
    expiresInSeconds: defaults.expiresInSeconds,
    resendAvailableAt: new Date(Date.now() + defaults.resendCooldownSeconds * 1000).toISOString(),
  };
}

export interface VerifyLoginOtpInput {
  email: string;
  code: string;
}

export async function verifyLoginOtp(input: VerifyLoginOtpInput, meta: RequestMeta): Promise<LoginResult> {
  let result: Awaited<ReturnType<typeof otpService.verifyOtpDirect>>;
  try {
    result = await otpService.verifyOtpDirect(input.email, "LOGIN", input.code);
  } catch (err) {
    await recordLoginAttempt({ identifier: input.email, success: false, method: "OTP", failureReason: "INVALID_OTP", meta });
    throw err;
  }
  if (!result.userId) throw new AuthenticationError("Invalid or expired code.");

  const user = await usersRepo.findById(result.userId);
  if (!user || user.status !== "ACTIVE") {
    await recordLoginAttempt({ userId: user?.id, identifier: input.email, success: false, method: "OTP", failureReason: "ACCOUNT_INACTIVE", meta });
    throw new AuthenticationError("Invalid or expired code.");
  }

  // A successfully verified OTP is itself the strong device proof — no
  // separate NEW_DEVICE step follows an OTP login.
  await recordLoginAttempt({ userId: user.id, identifier: input.email, success: true, method: "OTP", meta });
  const { sessionToken, expiresAt } = await issueSession(user, meta);
  await record({
    actorType: "USER",
    actorId: user.id,
    action: "user.login",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { method: "OTP" },
  });

  return { user: toPublicUser(user), sessionToken, expiresAt: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Forgot password / reset password
// ---------------------------------------------------------------------------

/** Same non-enumeration shape as requestLoginOtp. */
export async function forgotPassword(email: string, meta: RequestMeta): Promise<otpService.RequestOtpResult> {
  const defaults = await otpService.getPublicOtpDefaults();
  const user = await usersRepo.findByEmail(email);

  if (user && user.status === "ACTIVE") {
    const result = await otpService.requestOtp({ identifier: email, purpose: "FORGOT_PASSWORD", userId: user.id, meta });
    await record({
      actorType: "USER",
      actorId: user.id,
      action: "user.password_reset_requested",
      entityType: "user",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result;
  }

  return {
    channel: defaults.channel,
    expiresInSeconds: defaults.expiresInSeconds,
    resendAvailableAt: new Date(Date.now() + defaults.resendCooldownSeconds * 1000).toISOString(),
  };
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

export async function resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
  let result: Awaited<ReturnType<typeof otpService.verifyOtpDirect>>;
  try {
    result = await otpService.verifyOtpDirect(input.email, "FORGOT_PASSWORD", input.code);
  } catch (err) {
    await record({
      actorType: "SYSTEM",
      action: "user.password_reset.failed",
      entityType: "user",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { identifier: input.email },
    });
    throw err;
  }
  if (!result.userId) throw new AuthenticationError("Invalid or expired code.");

  const user = await usersRepo.findById(result.userId);
  if (!user) throw new AuthenticationError("Invalid or expired code.");

  const passwordHash = await hashPassword(input.newPassword);
  await usersRepo.updatePasswordHash(user.id, passwordHash);

  // Force re-login everywhere — a password reset almost always follows a
  // "someone else might have my password" concern.
  await db
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceSessions.userId, user.id), isNull(deviceSessions.revokedAt)));

  await record({
    actorType: "USER",
    actorId: user.id,
    action: "user.password_reset",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// ---------------------------------------------------------------------------
// Logout / logout-all
// ---------------------------------------------------------------------------

export async function logout(subject: { id: string; type: "user" | "admin" }, sessionId: string): Promise<void> {
  await db.update(deviceSessions).set({ revokedAt: new Date() }).where(eq(deviceSessions.id, sessionId));
  await record({
    actorType: subject.type === "admin" ? "ADMIN" : "USER",
    actorId: subject.id,
    action: subject.type === "admin" ? "admin.logout" : "user.logout",
    entityType: subject.type === "admin" ? "admin_user" : "user",
    entityId: subject.id,
  });
}

/** Revokes every active session for a member — not admins; admin session
 * management is a separate identity system and out of this scope. Returns
 * how many sessions were revoked. */
export async function logoutAll(subject: { id: string; type: "user" | "admin" }): Promise<number> {
  if (subject.type !== "user") throw new AuthorizationError("logout-all is only available for member accounts.");

  const revoked = await db
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceSessions.userId, subject.id), isNull(deviceSessions.revokedAt)))
    .returning({ id: deviceSessions.id });

  await record({
    actorType: "USER",
    actorId: subject.id,
    action: "user.logout_all",
    entityType: "user",
    entityId: subject.id,
    metadata: { sessionsRevoked: revoked.length },
  });

  return revoked.length;
}
