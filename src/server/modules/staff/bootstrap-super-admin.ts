/**
 * PCP: first-Super-Admin bootstrap for a fresh production database.
 *
 * The seed script only creates a Super Admin in development, and the staff API
 * (rightly) cannot create or edit Super Admin accounts, so a new deployment
 * would otherwise have nobody who can sign in. This is the one supported way
 * to create that first account: an operator with shell access to the
 * deployment runs `npm run admin:create-super -- --email you@example.com --name "Your Name"`.
 *
 *  - The password is random, printed ONCE to the operator's terminal and never stored in
 *    clear text; the account is flagged `mustChangePassword`, so the first sign-in forces a
 *    new password before anything else works.
 *  - Refuses (exit 1) when a Super Admin already exists unless `allowAdditional` is set,
 *    so re-running a deploy script can never mint a second privileged account by accident.
 *  - Requires the roles/permissions to be seeded first (`npm run db:seed`, which in production
 *    seeds roles and permissions only).
 *  - Writes an audit entry (actor SYSTEM) without the password.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers } from "@/server/db/schema";
import { ConflictError, ValidationError } from "@/server/lib/errors";
import { hashPassword } from "@/server/lib/password";
import { record } from "@/server/modules/audit/audit.service";
import { generateTemporaryPassword } from "./staff.service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createSuperAdmin(input: { email: string; name: string; allowAdditional?: boolean }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_RE.test(email)) throw new ValidationError("A valid --email is required.");
  if (name.length < 2 || name.length > 120) throw new ValidationError("--name must be 2-120 characters.");

  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.name, "SUPER_ADMIN")).limit(1);
  if (!role) throw new ConflictError("The SUPER_ADMIN role does not exist. Run `npm run db:seed` first (it seeds roles and permissions).");

  const existing = await db.select({ id: adminUsers.id, email: adminUsers.email }).from(adminUsers).where(eq(adminUsers.roleId, role.id));
  if (existing.length > 0 && !input.allowAdditional) {
    throw new ConflictError("A Super Admin already exists. Use the Staff & Roles screen, or pass --allow-additional if you really intend a second one.");
  }
  const [dup] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  if (dup) throw new ConflictError("An admin account with this e-mail already exists.");

  const temporaryPassword = generateTemporaryPassword();
  const [created] = await db
    .insert(adminUsers)
    .values({ name, email, passwordHash: await hashPassword(temporaryPassword), roleId: role.id, mustChangePassword: true })
    .returning({ id: adminUsers.id });

  await record({
    actorType: "SYSTEM",
    action: "staff.super_admin_bootstrapped",
    entityType: "admin_user",
    entityId: created.id,
    metadata: { additional: existing.length > 0 },
  });
  return { id: created.id, email, temporaryPassword };
}
