/**
 * Production Completion Phase test helpers (new file; no frozen helper edited).
 */
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers, rolePermissions, permissions } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";

export function jreq(url: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  return new NextRequest(url, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

let adminCounter = 0;
export interface TestAdmin {
  id: string;
  email: string;
  token: string;
  password: string;
}

/** Creates an admin (SUPER_ADMIN / STAFF_ADMIN / any role name) and logs in. */
export async function createAdmin(roleName: string = "SUPER_ADMIN", password = "adminpassword1"): Promise<TestAdmin> {
  adminCounter += 1;
  const email = `pcp-admin-${adminCounter}-${Date.now()}@rishteyzindagi.local`;
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  if (!role) throw new Error(`role ${roleName} missing — run db:seed on the test DB`);
  const [admin] = await db
    .insert(adminUsers)
    .values({ name: `PCP ${roleName}`, email, passwordHash: await hashPassword(password), roleId: role.id })
    .returning();
  const token = await loginAs(email, password);
  return { id: admin.id, email, token, password };
}

export async function loginAs(email: string, password: string): Promise<string> {
  const res = await loginAdmin(jreq("http://localhost/api/v1/admin/login", { body: { email, password } }));
  const body = await res.json();
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data.sessionToken;
}

/** Grants an extra permission key to a role (test setup for staff-with-permission cases). */
export async function grantPermission(roleName: string, key: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  const [perm] = await db.select().from(permissions).where(eq(permissions.key, key));
  await db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id }).onConflictDoNothing();
}

export async function revokePermission(roleName: string, key: string) {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, roleName));
  const [perm] = await db.select().from(permissions).where(eq(permissions.key, key));
  await db.execute(sql`DELETE FROM role_permissions WHERE role_id = ${role.id} AND permission_id = ${perm.id}`);
}

/** Truncates PCP-owned tables. Safe to call after resetTransactionalTables(), which now includes the same names in one statement. */
export async function resetPcpTables() {
  await db.execute(sql`TRUNCATE TABLE job_runs, rate_limit_counters, payment_webhook_events RESTART IDENTITY CASCADE`);
}
