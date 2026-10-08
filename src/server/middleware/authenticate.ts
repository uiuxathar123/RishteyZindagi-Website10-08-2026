/**
 * Session authentication foundation (B1 §6/§7). Reads the `Authorization:
 * Bearer <token>` header, hashes the token, and looks it up in
 * `device_sessions`. A session row can belong to either a member
 * (`user_id`) or a staff/super-admin (`admin_user_id`) — never both —
 * matching the frontend's existing split between the member dashboard and
 * the separate Admin Panel identity system.
 *
 * This checks expiry and revocation and updates `last_seen_at`, but does
 * NOT implement new-device verification, suspicious-login detection, or
 * "logout all devices" — those are named in B1 §7 as later workflows
 * built on top of this foundation, not part of it.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { deviceSessions, users, adminUsers, adminRoles } from "@/server/db/schema";
import { hashSessionToken } from "@/server/lib/session";
import { AuthenticationError } from "@/server/lib/errors";

export type AuthSubjectType = "user" | "admin";

export interface AuthContext {
  subject: { id: string; type: AuthSubjectType };
  /** Only present for an admin subject — the admin_roles.name (e.g.
   * "SUPER_ADMIN" / "STAFF_ADMIN"), used by the RBAC middleware. */
  adminRoleName?: string;
  sessionId: string;
  /** PCP: true for a staff account still using a one-time temporary password.
   * requirePermission() refuses every permissioned action until it is changed. */
  mustChangePassword?: boolean;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Throws AuthenticationError if there's no valid, unexpired, unrevoked
 * session for the request. Use this for any route that requires *someone*
 * to be signed in, member or admin. */
export async function authenticate(req: Request): Promise<AuthContext> {
  const token = extractBearerToken(req);
  if (!token) throw new AuthenticationError("Missing bearer token.");

  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select()
    .from(deviceSessions)
    .where(and(eq(deviceSessions.tokenHash, tokenHash), isNull(deviceSessions.revokedAt)))
    .limit(1);

  if (!session) throw new AuthenticationError("Invalid or expired session.");
  if (session.expiresAt.getTime() < Date.now()) {
    throw new AuthenticationError("Invalid or expired session.");
  }

  // Best-effort — a failure to bump last_seen_at should never fail the request.
  db.update(deviceSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(deviceSessions.id, session.id))
    .catch(() => undefined);

  if (session.userId) {
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user || user.status !== "ACTIVE") throw new AuthenticationError("Account is not active.");
    return { subject: { id: user.id, type: "user" }, sessionId: session.id };
  }

  if (session.adminUserId) {
    const [row] = await db
      .select({ admin: adminUsers, roleName: adminRoles.name })
      .from(adminUsers)
      .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
      .where(eq(adminUsers.id, session.adminUserId))
      .limit(1);
    if (!row || row.admin.status !== "ACTIVE") throw new AuthenticationError("Account is not active.");
    return {
      subject: { id: row.admin.id, type: "admin" },
      adminRoleName: row.roleName,
      sessionId: session.id,
      ...(row.admin.mustChangePassword ? { mustChangePassword: true } : {}),
    };
  }

  // A session row with neither FK set is a data-integrity bug, not a
  // client error — treat it as "not authenticated" rather than leaking
  // detail about server-side state.
  throw new AuthenticationError("Invalid or expired session.");
}
