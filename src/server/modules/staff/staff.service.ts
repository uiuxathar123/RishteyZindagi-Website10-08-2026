/**
 * PCP: staff (admin account) management on top of the existing RBAC tables
 * (admin_users → admin_roles → role_permissions → permissions). No new RBAC model.
 *
 * Authorization
 *  - Everything needs `staff.manage` (existing permission; SUPER_ADMIN only by default).
 *  - Creating roles and editing a role's permission set is SUPER_ADMIN-only (role check,
 *    not just the permission), so delegating `staff.manage` can never be used to mint
 *    new power.
 *
 * Privilege-escalation & Super-Admin protection
 *  - SUPER_ADMIN accounts can never be created, edited, demoted, disabled or have their
 *    password reset through this API (they are provisioned by the seed / ops script).
 *  - A non-Super actor may only manage accounts whose role permissions are a subset of
 *    the actor's own, and may only assign such roles.
 *  - Nobody can change their own role or disable themselves.
 *  - The SUPER_ADMIN role's permission set cannot be edited.
 *
 * Passwords
 *  - A new / reset account gets a server-generated one-time temporary password, shown
 *    ONCE in the response, stored only as a bcrypt hash and never audited. The account is
 *    flagged `must_change_password`; `requirePermission()` refuses every permissioned
 *    action until the owner sets their own password (POST /admin/me/password).
 *  - Disabling, changing role or resetting the password revokes the target's sessions.
 *  - Every action is audited (field names / ids only, never a password).
 */
import { randomInt } from "crypto";
import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, permissions, rolePermissions } from "@/server/db/schema";
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import { record } from "@/server/modules/audit/audit.service";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requireAdminRole, requirePermission } from "@/server/middleware/rbac";
import { revokeAdminSessions } from "@/server/modules/account/sessions";

const PERMISSION = "staff.manage";
const SUPER = "SUPER_ADMIN";
type Meta = { ipAddress?: string | null; userAgent?: string | null };

export interface StaffView {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | string;
  mustChangePassword: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

function toView(row: { admin: typeof adminUsers.$inferSelect; roleName: string }): StaffView {
  return {
    id: row.admin.id,
    name: row.admin.name,
    email: row.admin.email,
    role: row.roleName,
    status: row.admin.status,
    mustChangePassword: row.admin.mustChangePassword,
    lastActiveAt: row.admin.lastActiveAt?.toISOString() ?? null,
    createdAt: row.admin.createdAt.toISOString(),
  };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function generateTemporaryPassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

async function permissionKeysForRole(roleId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));
  return new Set(rows.map((r) => r.key));
}

async function actorRole(ctx: AuthContext) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, ctx.adminRoleName ?? "")).limit(1);
  if (!role) throw new AuthorizationError();
  return role;
}

/** Throws unless the actor may manage / assign a role. */
async function assertRoleAllowed(ctx: AuthContext, role: typeof adminRoles.$inferSelect, verb: "assign" | "manage") {
  if (role.name === SUPER) throw new AuthorizationError(`The ${SUPER} role cannot be ${verb === "assign" ? "assigned" : "managed"} through the API.`);
  if (ctx.adminRoleName === SUPER) return;
  const mine = await permissionKeysForRole((await actorRole(ctx)).id);
  const theirs = await permissionKeysForRole(role.id);
  for (const k of theirs) {
    if (!mine.has(k)) throw new AuthorizationError("You cannot grant or manage a role that holds permissions you do not have.");
  }
}

async function loadTarget(staffId: string) {
  const [row] = await db
    .select({ admin: adminUsers, role: adminRoles })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.id, staffId))
    .limit(1);
  if (!row) throw new NotFoundError("Staff account not found.");
  return row;
}

// ---------------------------------------------------------------------------

export async function listStaff(ctx: AuthContext, input: { q?: string; status?: string; page?: number; pageSize?: number }) {
  await requirePermission(ctx, PERMISSION);
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? 20, 50);
  const conds = [];
  if (input.q) {
    const like = `%${input.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or(ilike(adminUsers.name, like), ilike(adminUsers.email, like)));
  }
  if (input.status === "ACTIVE" || input.status === "SUSPENDED") conds.push(eq(adminUsers.status, input.status));
  const where = conds.length ? and(...conds) : undefined;
  const [{ n }] = await db.select({ n: count() }).from(adminUsers).where(where);
  const rows = await db
    .select({ admin: adminUsers, roleName: adminRoles.name })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(where)
    .orderBy(asc(adminUsers.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items: rows.map(toView), page, pageSize, total: n, totalPages: Math.max(1, Math.ceil(n / pageSize)) };
}

export async function createStaff(ctx: AuthContext, input: { name: string; email: string; roleName: string }, meta: Meta) {
  await requirePermission(ctx, PERMISSION);
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, input.roleName)).limit(1);
  if (!role) throw new ValidationError("Unknown role.");
  await assertRoleAllowed(ctx, role, "assign");

  const email = input.email.toLowerCase();
  const [dup] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  if (dup) throw new ConflictError("A staff account with this e-mail already exists.", { field: "email" });

  const temporaryPassword = generateTemporaryPassword();
  let created;
  try {
    [created] = await db
      .insert(adminUsers)
      .values({ name: input.name, email, passwordHash: await hashPassword(temporaryPassword), roleId: role.id, mustChangePassword: true })
      .returning();
  } catch {
    throw new ConflictError("A staff account with this e-mail already exists.", { field: "email" });
  }
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "staff.created",
    entityType: "admin_user",
    entityId: created.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { role: role.name },
  });
  return { staff: toView({ admin: created, roleName: role.name }), temporaryPassword };
}

export async function updateStaff(
  ctx: AuthContext,
  staffId: string,
  input: { name?: string; roleName?: string; status?: "ACTIVE" | "SUSPENDED" },
  meta: Meta
) {
  await requirePermission(ctx, PERMISSION);
  const target = await loadTarget(staffId);
  await assertRoleAllowed(ctx, target.role, "manage");
  const self = target.admin.id === ctx.subject.id;
  if (self && (input.roleName !== undefined || input.status !== undefined)) {
    throw new ConflictError("You cannot change your own role or disable your own account.");
  }

  const patch: Partial<typeof adminUsers.$inferInsert> = {};
  const changes: Record<string, unknown> = {};
  let revoke = false;

  if (input.name !== undefined && input.name !== target.admin.name) {
    patch.name = input.name;
    changes.name = true;
  }
  if (input.roleName !== undefined && input.roleName !== target.role.name) {
    const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, input.roleName)).limit(1);
    if (!role) throw new ValidationError("Unknown role.");
    await assertRoleAllowed(ctx, role, "assign");
    patch.roleId = role.id;
    changes.role = { from: target.role.name, to: role.name };
    revoke = true;
  }
  if (input.status !== undefined && input.status !== target.admin.status) {
    patch.status = input.status;
    changes.status = { from: target.admin.status, to: input.status };
    if (input.status !== "ACTIVE") revoke = true;
  }
  if (Object.keys(patch).length === 0) return { staff: toView({ admin: target.admin, roleName: target.role.name }) };

  const [updated] = await db.update(adminUsers).set({ ...patch, updatedAt: new Date() }).where(eq(adminUsers.id, staffId)).returning();
  const sessionsRevoked = revoke ? await revokeAdminSessions(staffId) : 0;
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: changes.status ? (input.status === "ACTIVE" ? "staff.enabled" : "staff.disabled") : "staff.updated",
    entityType: "admin_user",
    entityId: staffId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { ...changes, sessionsRevoked },
  });
  const roleName = changes.role ? (changes.role as { to: string }).to : target.role.name;
  return { staff: toView({ admin: updated, roleName }) };
}

export async function resetStaffPassword(ctx: AuthContext, staffId: string, meta: Meta) {
  await requirePermission(ctx, PERMISSION);
  const target = await loadTarget(staffId);
  await assertRoleAllowed(ctx, target.role, "manage");
  if (target.admin.id === ctx.subject.id) throw new ConflictError("Use change-password for your own account.");
  const temporaryPassword = generateTemporaryPassword();
  const [updated] = await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, updatedAt: new Date() })
    .where(eq(adminUsers.id, staffId))
    .returning();
  const sessionsRevoked = await revokeAdminSessions(staffId);
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "staff.password_reset",
    entityType: "admin_user",
    entityId: staffId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { sessionsRevoked },
  });
  return { staff: toView({ admin: updated, roleName: target.role.name }), temporaryPassword };
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

export async function listRoles(ctx: AuthContext) {
  await requirePermission(ctx, PERMISSION);
  const roles = await db.select().from(adminRoles).orderBy(asc(adminRoles.name));
  const grants = await db
    .select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id));
  const counts = await db.select({ roleId: adminUsers.roleId, n: count() }).from(adminUsers).groupBy(adminUsers.roleId);
  const allPerms = await db.select({ key: permissions.key, description: permissions.description }).from(permissions).orderBy(asc(permissions.key));
  return {
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      protected: r.name === SUPER,
      permissions: grants.filter((g) => g.roleId === r.id).map((g) => g.key).sort(),
      members: counts.find((c) => c.roleId === r.id)?.n ?? 0,
    })),
    permissions: allPerms,
  };
}

const ROLE_NAME_RE = /^[A-Z][A-Z0-9_]{2,39}$/;

export async function createRole(ctx: AuthContext, input: { name: string; description?: string; permissions: string[] }, meta: Meta) {
  await requirePermission(ctx, PERMISSION);
  requireAdminRole(ctx, [SUPER]);
  if (!ROLE_NAME_RE.test(input.name) || input.name === SUPER) throw new ValidationError("Role names are UPPER_SNAKE_CASE, 3-40 characters, and cannot be SUPER_ADMIN.");
  const [dup] = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.name, input.name)).limit(1);
  if (dup) throw new ConflictError("A role with this name already exists.");
  const keys = await resolvePermissionKeys(input.permissions);
  const roleId = await db.transaction(async (tx) => {
    const [role] = await tx.insert(adminRoles).values({ name: input.name, description: input.description ?? null }).returning();
    if (keys.length) await tx.insert(rolePermissions).values(keys.map((k) => ({ roleId: role.id, permissionId: k.id })));
    return role.id;
  });
  await record({ actorType: "ADMIN", actorId: ctx.subject.id, actorRole: ctx.adminRoleName, action: "role.created", entityType: "admin_role", entityId: roleId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { name: input.name, permissions: keys.map((k) => k.key) } });
  return { roleId };
}

export async function setRolePermissions(ctx: AuthContext, roleId: string, requested: string[], meta: Meta) {
  await requirePermission(ctx, PERMISSION);
  requireAdminRole(ctx, [SUPER]);
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId)).limit(1);
  if (!role) throw new NotFoundError("Role not found.");
  if (role.name === SUPER) throw new AuthorizationError("The SUPER_ADMIN role's permissions cannot be edited.");
  const keys = await resolvePermissionKeys(requested);
  const before = [...(await permissionKeysForRole(roleId))].sort();
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (keys.length) await tx.insert(rolePermissions).values(keys.map((k) => ({ roleId, permissionId: k.id })));
  });
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "role.permissions_updated",
    entityType: "admin_role",
    entityId: roleId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { role: role.name, before, after: keys.map((k) => k.key).sort() },
  });
  return { roleId, permissions: keys.map((k) => k.key).sort() };
}

async function resolvePermissionKeys(requested: string[]) {
  const unique = [...new Set(requested)];
  if (unique.length === 0) return [];
  const rows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions).where(inArray(permissions.key, unique));
  if (rows.length !== unique.length) throw new ValidationError("One or more permission keys do not exist.");
  return rows;
}

// ---------------------------------------------------------------------------
// Own password
// ---------------------------------------------------------------------------

export async function changeMyPassword(ctx: AuthContext, input: { currentPassword: string; newPassword: string }, meta: Meta) {
  if (ctx.subject.type !== "admin") throw new AuthorizationError();
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, ctx.subject.id)).limit(1);
  if (!admin) throw new AuthenticationError("Invalid or expired session.");
  if (!(await verifyPassword(input.currentPassword, admin.passwordHash))) throw new AuthorizationError("The current password is incorrect."); // 403: valid session, failed re-authentication (a 401 would sign the admin out in the BFF)
  if (input.newPassword === input.currentPassword) throw new ValidationError("The new password must be different from the current one.");
  await db.update(adminUsers).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, updatedAt: new Date() }).where(eq(adminUsers.id, admin.id));
  const revoked = await revokeAdminSessions(admin.id, ctx.sessionId);
  await record({ actorType: "ADMIN", actorId: admin.id, actorRole: ctx.adminRoleName, action: "admin.password_changed", entityType: "admin_user", entityId: admin.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent, metadata: { otherSessionsRevoked: revoked } });
  return { changed: true as const };
}

