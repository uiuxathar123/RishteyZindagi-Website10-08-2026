/**
 * Audit log foundation (B1 §12). `record(...)` is the one function every
 * other module calls to leave an audit trail — B2+ will call this
 * extensively (admin actions, payment verification, invoice actions,
 * warnings, suspension, account recovery, security events); B1 only
 * wires it up and uses it at the two points that already exist (login,
 * register) to prove it works end-to-end.
 *
 * Deliberately best-effort: a failure to WRITE an audit log should never
 * fail the primary action it's describing (e.g. a login should still
 * succeed even if the audit insert fails) — callers don't need to wrap
 * this in their own try/catch, `record` swallows and logs its own
 * failures.
 */
import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { logError } from "@/server/lib/logger";
import type { AuthSubjectType } from "@/server/middleware/authenticate";

export interface AuditEntry {
  actorType: "USER" | "ADMIN" | "SYSTEM";
  actorId?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function record(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorType: entry.actorType,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ipAddress: entry.ipAddress ?? undefined,
      userAgent: entry.userAgent ?? undefined,
      metadata: entry.metadata ?? undefined,
    });
  } catch (err) {
    logError("audit-log-write-failed", err, { action: entry.action, entityType: entry.entityType });
  }
}

export function actorTypeFromSubject(type: AuthSubjectType): "USER" | "ADMIN" {
  return type === "admin" ? "ADMIN" : "USER";
}
