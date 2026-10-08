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
import { AuthenticationError } from "@/server/lib/errors";
import { record } from "@/server/modules/audit/audit.service";
import type { RequestMeta } from "@/server/modules/auth/auth.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireAdminRole } from "@/server/middleware/rbac";

export interface AdminLoginInput {
  email: string;
  password: string;
}

export interface AdminLoginResult {
  admin: { id: string; name: string; email: string; role: string; mustChangePassword?: boolean };
  sessionToken: string;
  expiresAt: string;
}

export async function adminLogin(input: AdminLoginInput, meta: RequestMeta): Promise<AdminLoginResult> {
  const [row] = await db
    .select({ admin: adminUsers, roleName: adminRoles.name })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.email, input.email))
    .limit(1);

  const valid = row ? await verifyPassword(input.password, row.admin.passwordHash) : false;

  await db.insert(loginAttempts).values({
    adminUserId: row?.admin.id,
    identifier: input.email,
    success: valid,
    ipAddress: meta.ipAddress ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  if (!row || !valid) throw new AuthenticationError("Invalid email or password.");
  if (row.admin.status !== "ACTIVE") throw new AuthenticationError("This account is not active.");

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
  requireAdminRole(ctx, ["SUPER_ADMIN", "STAFF_ADMIN"]);
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
