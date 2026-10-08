/**
 * RBAC foundation (B1 §5). Two independent checks a route can ask for:
 *
 *  - `requireAdminRole(ctx, ["SUPER_ADMIN"])` — coarse-grained, by role
 *    name. Useful for "only Super Admin may reach this at all" routes.
 *  - `requirePermission(ctx, "staff.manage")` — fine-grained, resolved
 *    through admin_roles -> role_permissions -> permissions. This is what
 *    lets Super Admin later hand a Staff Admin a limited permission set
 *    instead of all-or-nothing access, per the brief's explicit "do not
 *    create arbitrary unlimited admin privileges" instruction.
 *
 * Regular member users (`subject.type === "user"`) never pass either
 * check — RBAC in this system only governs the admin/staff space, exactly
 * matching how the existing frontend already separates the member
 * dashboard from the Admin Panel's own login and permissions.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { rolePermissions, permissions as permissionsTable, adminRoles } from "@/server/db/schema";
import { AuthorizationError } from "@/server/lib/errors";
import type { AuthContext } from "./authenticate";

export function requireAdminRole(ctx: AuthContext, allowed: string[]): void {
  if (ctx.subject.type !== "admin" || !ctx.adminRoleName || !allowed.includes(ctx.adminRoleName)) {
    throw new AuthorizationError();
  }
}

export async function requirePermission(ctx: AuthContext, permissionKey: string): Promise<void> {
  if (ctx.subject.type !== "admin" || !ctx.adminRoleName) throw new AuthorizationError();

  const [role] = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, ctx.adminRoleName))
    .limit(1);
  if (!role) throw new AuthorizationError();

  // Pulls every permission the role has, then checks in memory — fine at
  // B1 scale; a role-permission cache is a reasonable later optimization,
  // not a correctness requirement.
  const grants = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissions)
    .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id))
    .where(eq(rolePermissions.roleId, role.id));

  if (!grants.some((g) => g.key === permissionKey)) throw new AuthorizationError();
}
