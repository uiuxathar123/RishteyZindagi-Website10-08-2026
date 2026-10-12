/**
 * Admin auth + RBAC-demo foundation. Staff/Super Admin accounts are a
 * separate identity system from member `users` — `admin_users`, not
 * `users` — matching the existing frontend's already-separate Admin
 * Panel login (see `src/app/admin/*`, `adminService`/`staffAccounts.ts`
 * in the frontend). B1 only builds enough here to prove RBAC works
 * end-to-end (login + one permission-gated route); the actual Admin
 * Panel API surface (user management, approvals, reports, settings) is
 * explicit B2+/later-phase scope.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminUsers, adminRoles, deviceSessions, loginAttempts, rolePermissions, permissions } from "@/server/db/schema";
import { verifyPassword } from "@/server/lib/password";
import { generateSessionToken, hashSessionToken, sessionExpiryDate } from "@/server/lib/session";
import { AuthenticationError, AuthorizationError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import type { RequestMeta } from "@/server/modules/auth/auth.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireAdminRole } from "@/server/middleware/rbac";
import * as otpService from "@/server/modules/otp/otp.service";
import { getAdminSecurity } from "@/server/modules/platform-settings/platform-settings.service";

export interface AdminLoginInput {
  email: string;
  password: string;
}

export interface AdminLoginResult {
  admin: { id: string; name: string; email: string; role: string; mustChangePassword?: boolean };
  sessionToken: string;
  expiresAt: string;
}

/** B19: returned instead of a session when the Super Admin has switched admin MFA on and the password was correct. */
export interface AdminMfaChallenge {
  mfaRequired: true;
  /** Masked destination, e.g. `a***@example.com`. */
  sentTo: string;
  channel: "EMAIL";
  expiresInSeconds: number;
  resendAvailableAt: string;
}

function maskEmail(email: string): string {
  return email.replace(/^(.).*(@.*)$/, "$1***$2");
}

type AdminRow = { admin: typeof adminUsers.$inferSelect; roleName: string };

async function recordAdminLoginAttempt(input: {
  adminUserId?: string;
  identifier: string;
  success: boolean;
  method: "PASSWORD" | "OTP";
  failureReason?: string;
  meta: RequestMeta;
}): Promise<void> {
  await db.insert(loginAttempts).values({
    adminUserId: input.adminUserId,
    identifier: input.identifier,
    success: input.success,
    method: input.method,
    failureReason: input.failureReason,
    ipAddress: input.meta.ipAddress ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });
}

async function openAdminSession(row: AdminRow, meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<AdminLoginResult> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiryDate();
  await db.insert(deviceSessions).values({
    adminUserId: row.admin.id,
    tokenHash: hashSessionToken(token),
    ipAddress: meta.ipAddress ?? undefined,
    browserInfo: meta.userAgent ?? undefined,
    expiresAt,
  });

  await record({
    actorType: "ADMIN",
    actorId: row.admin.id,
    actorRole: row.roleName,
    action: "admin.login",
    entityType: "admin_user",
    entityId: row.admin.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    ...(Object.keys(extra).length ? { metadata: extra } : {}),
  });

  return {
    admin: {
      id: row.admin.id,
      name: row.admin.name,
      email: row.admin.email,
      role: row.roleName,
      ...(row.admin.mustChangePassword ? { mustChangePassword: true } : {}),
    },
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function adminLogin(input: AdminLoginInput, meta: RequestMeta): Promise<AdminLoginResult | AdminMfaChallenge> {
  const [row] = await db
    .select({ admin: adminUsers, roleName: adminRoles.name })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.email, input.email))
    .limit(1);

  const valid = row ? await verifyPassword(input.password, row.admin.passwordHash) : false;
  const failureReason = !row || !valid ? "INVALID_CREDENTIALS" : row.admin.status !== "ACTIVE" ? "ACCOUNT_INACTIVE" : undefined;

  await recordAdminLoginAttempt({
    adminUserId: row?.admin.id,
    identifier: input.email,
    success: failureReason === undefined,
    method: "PASSWORD",
    failureReason,
    meta,
  });

  if (!row || !valid) throw new AuthenticationError("Invalid email or password.");
  if (row.admin.status !== "ACTIVE") throw new AuthenticationError("This account is not active.");

  // B19: second factor. A correct password alone no longer opens a session while the Super Admin has MFA switched on.
  if ((await getAdminSecurity()).mfaRequired) {
    const sent = await otpService.requestOtp({
      identifier: row.admin.email.toLowerCase(),
      purpose: "ADMIN_MFA",
      metadata: { adminUserId: row.admin.id },
      meta,
      channel: "EMAIL",
    });
    await record({
      actorType: "ADMIN",
      actorId: row.admin.id,
      actorRole: row.roleName,
      action: "admin.mfa_challenge_sent",
      entityType: "admin_user",
      entityId: row.admin.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { mfaRequired: true, sentTo: maskEmail(row.admin.email), channel: "EMAIL", expiresInSeconds: sent.expiresInSeconds, resendAvailableAt: sent.resendAvailableAt };
  }

  return openAdminSession(row, meta);
}

/** B19: second step of an MFA sign-in — redeems the e-mailed code and opens the session. Every failure is the same
 * generic 401 so it cannot be used to learn which admin addresses exist or which step failed. */
export async function adminVerifyMfa(input: { email: string; code: string }, meta: RequestMeta): Promise<AdminLoginResult> {
  const generic = () => new AuthenticationError("Invalid or expired code.");
  const [row] = await db
    .select({ admin: adminUsers, roleName: adminRoles.name })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.email, input.email))
    .limit(1);
  if (!(await getAdminSecurity()).mfaRequired) {
    await recordAdminLoginAttempt({
      adminUserId: row?.admin.id,
      identifier: input.email,
      success: false,
      method: "OTP",
      failureReason: "MFA_NOT_ENABLED",
      meta,
    });
    throw generic();
  }
  let verified;
  try {
    verified = await otpService.verifyOtpDirect(input.email.toLowerCase(), "ADMIN_MFA", input.code);
  } catch (error) {
    if (!(error instanceof AuthenticationError)) throw error;
    await recordAdminLoginAttempt({
      adminUserId: row?.admin.id,
      identifier: input.email,
      success: false,
      method: "OTP",
      failureReason: "INVALID_OTP",
      meta,
    });
    throw generic();
  }

  const boundAdminId =
    typeof verified.metadata === "object" &&
    verified.metadata !== null &&
    "adminUserId" in verified.metadata &&
    typeof verified.metadata.adminUserId === "string"
      ? verified.metadata.adminUserId
      : undefined;
  if (!row || row.admin.status !== "ACTIVE" || boundAdminId !== row.admin.id) {
    await recordAdminLoginAttempt({
      adminUserId: row?.admin.id,
      identifier: input.email,
      success: false,
      method: "OTP",
      failureReason: !row || boundAdminId !== row.admin.id ? "MFA_ACCOUNT_MISMATCH" : "ACCOUNT_INACTIVE",
      meta,
    });
    throw generic();
  }

  await recordAdminLoginAttempt({
    adminUserId: row.admin.id,
    identifier: input.email,
    success: true,
    method: "OTP",
    meta,
  });
  return openAdminSession(row, meta, { mfa: true });
}

/** Demonstrates the RBAC middleware end-to-end: only SUPER_ADMIN or
 * STAFF_ADMIN may reach this, never a plain member session. */
export function ping(ctx: AuthContext) {
  requireAdminRole(ctx, ["SUPER_ADMIN", "STAFF_ADMIN"]);
  return { pong: true, role: ctx.adminRoleName, adminId: ctx.subject.id };
}


/** B16: the signed-in admin's own identity plus the exact permission keys
 * their role currently holds (admin_roles -> role_permissions ->
 * permissions, the same tables `requirePermission` resolves against).
 * Exists so the Admin Panel can show each admin only the screens they may
 * use — a presentation aid only; every admin endpoint keeps enforcing its
 * own permission server-side regardless of what the UI shows. Additive
 * (the frozen `GET /admin/ping` response shape is deliberately untouched). */
export async function adminMe(ctx: AuthContext) {
   if (ctx.subject.type !== "admin") {
   throw new AuthorizationError();}
  const [row] = await db
    .select({ admin: adminUsers, role: adminRoles })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.id, ctx.subject.id))
    .limit(1);
  if (!row) throw new AuthenticationError("Invalid or expired session.");

  const grants = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, row.role.id));

  return {
    admin: { id: row.admin.id, name: row.admin.name, email: row.admin.email, role: row.role.name, mustChangePassword: row.admin.mustChangePassword },
    permissions: grants.map((g) => g.key).sort(),
  };
}
