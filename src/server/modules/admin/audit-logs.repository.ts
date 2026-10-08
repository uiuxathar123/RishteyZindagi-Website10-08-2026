/**
 * B9: data access for the admin audit-log read endpoint. `audit_logs` has
 * been written extensively throughout B1-B8 (via audit.service.ts's
 * `record()`), but nothing before B9 ever read it back for an admin —
 * this is the first read path. Read-only by design: no update/delete
 * function is exported here, matching the "audit logs are append-only"
 * rule (enforced simply by never routing a PATCH/DELETE to this table —
 * see the B9 brief's own note on this).
 */
import { and, count, desc, eq, gte, lte, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

export type AuditLogRow = typeof auditLogs.$inferSelect;

export interface AuditLogFilter {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function listAuditLogs(filter: AuditLogFilter, page: number, pageSize: number): Promise<{ items: AuditLogRow[]; total: number }> {
  const conditions = [];
  if (filter.actorId) conditions.push(eq(auditLogs.actorId, filter.actorId));
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.entityType) conditions.push(eq(auditLogs.entityType, filter.entityType));
  if (filter.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
  if (filter.dateFrom) conditions.push(gte(auditLogs.createdAt, filter.dateFrom));
  if (filter.dateTo) conditions.push(lte(auditLogs.createdAt, filter.dateTo));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [items, countRows] = await Promise.all([
    // B13 (Performance/Scalability phase — disclosed, evidenced fix; see
    // PERFORMANCE_REPORT.md / BACKEND.md's B13 section): same
    // pagination-drift fix as chat.repository.ts's listMessages (see its
    // doc comment) — `createdAt` alone is not a unique tiebreaker.
    db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: count() }).from(auditLogs).where(whereClause),
  ]);
  return { items, total: Number(countRows[0]?.c ?? 0) };
}

/** Every audit-log row touching a given user — either as the actor (e.g.
 * a member's own login) or as the entity an admin action targeted (e.g.
 * a warning issued against them). Used by the admin user-detail
 * composition (users-admin.service.ts), not by the general list above. */
export async function listForUser(userId: string, limit = 50): Promise<AuditLogRow[]> {
  return db
    .select()
    .from(auditLogs)
    .where(or(eq(auditLogs.actorId, userId), and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, userId))))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
