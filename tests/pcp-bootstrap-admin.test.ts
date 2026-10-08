/**
 * Production Completion Phase — first Super Admin bootstrap for a fresh production database.
 * Real service + real PostgreSQL + one real CLI invocation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminUsers, auditLogs } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { createSuperAdmin } from "@/server/modules/staff/bootstrap-super-admin";
import { resetAdminUsers } from "./helpers/reset-db";
import { createAdmin, jreq, resetPcpTables } from "./helpers/pcp";
import { POST as adminLoginRoute } from "@/app/api/v1/admin/login/route";
import { GET as adminMe } from "@/app/api/v1/admin/me/route";
import { GET as listAdminUsers } from "@/app/api/v1/admin/users/route";
import { POST as changePassword } from "@/app/api/v1/admin/me/password/route";

const ROOT = path.resolve(__dirname, "..");

beforeEach(async () => {
  await resetAdminUsers();
  await resetPcpTables();
  __resetRateLimitsForTests();
});

describe("first Super Admin bootstrap", () => {
  it("[bootstrap-create] creates a Super Admin with a one-time password; first sign-in is forced to change it", async () => {
    const out = await createSuperAdmin({ email: "Owner@Example.com", name: "Site Owner" });
    expect(out.email).toBe("owner@example.com");
    expect(out.temporaryPassword).toHaveLength(16);

    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, "owner@example.com"));
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordHash).not.toContain(out.temporaryPassword);

    const login = await adminLoginRoute(jreq("http://localhost/api/v1/admin/login", { body: { email: "owner@example.com", password: out.temporaryPassword } }));
    expect(login.status).toBe(200);
    const token = (await login.json()).data.sessionToken as string;
    const me = (await (await adminMe(jreq("http://localhost/api/v1/admin/me", { token }))).json()).data.admin;
    expect(me).toMatchObject({ role: "SUPER_ADMIN", mustChangePassword: true });
    // a temporary password cannot be used for any permissioned action ...
    expect((await listAdminUsers(jreq("http://localhost/api/v1/admin/users", { token }))).status).toBe(403);
    // ... until the owner chooses their own
    const chg = await changePassword(
      jreq("http://localhost/api/v1/admin/me/password", { body: { currentPassword: out.temporaryPassword, newPassword: "my-own-long-password-1" }, token })
    );
    expect(chg.status).toBe(200);
    const login2 = await adminLoginRoute(jreq("http://localhost/api/v1/admin/login", { body: { email: "owner@example.com", password: "my-own-long-password-1" } }));
    const token2 = (await login2.json()).data.sessionToken as string;
    expect((await listAdminUsers(jreq("http://localhost/api/v1/admin/users", { token: token2 }))).status).toBe(200);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.super_admin_bootstrapped"));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(out.temporaryPassword);
  });

  it("[bootstrap-guards] refuses a second Super Admin unless explicitly allowed; rejects bad input and duplicate e-mail", async () => {
    await createSuperAdmin({ email: "first@example.com", name: "First Owner" });
    await expect(createSuperAdmin({ email: "second@example.com", name: "Second Owner" })).rejects.toThrow(/already exists/i);
    expect(await db.select().from(adminUsers)).toHaveLength(1);
    await expect(createSuperAdmin({ email: "first@example.com", name: "Dup", allowAdditional: true })).rejects.toThrow(/already exists/i);
    await expect(createSuperAdmin({ email: "not-an-email", name: "Bad Mail", allowAdditional: true })).rejects.toThrow(/email/i);
    await expect(createSuperAdmin({ email: "short@example.com", name: "X", allowAdditional: true })).rejects.toThrow(/name/i);
    const extra = await createSuperAdmin({ email: "second@example.com", name: "Second Owner", allowAdditional: true });
    expect(extra.email).toBe("second@example.com");
  });

  it("[bootstrap-ignores-staff] an existing STAFF_ADMIN does not block creating the first Super Admin", async () => {
    await createAdmin("STAFF_ADMIN");
    const out = await createSuperAdmin({ email: "owner2@example.com", name: "Site Owner" });
    expect(out.email).toBe("owner2@example.com");
  });

  it("[bootstrap-cli] the npm script prints the one-time password once and exits 0; a repeat exits 1 with no password", async () => {
    const run = (extra: string[] = []) =>
      spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "cli.owner@example.com", "--name", "CLI Owner", ...extra], {
        cwd: ROOT,
        encoding: "utf8",
        env: process.env,
        timeout: 120_000,
      });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/Super Admin created: cli\.owner@example\.com/);
    expect(first.stdout).toMatch(/Temporary password \(shown once[^)]*\): \S{16}/);
    const second = run();
    expect(second.status).toBe(1);
    expect(second.stdout + second.stderr).not.toMatch(/Temporary password/);
    const noArgs = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts"], { cwd: ROOT, encoding: "utf8", env: process.env, timeout: 120_000 });
    expect(noArgs.status).toBe(1);
  });
});
