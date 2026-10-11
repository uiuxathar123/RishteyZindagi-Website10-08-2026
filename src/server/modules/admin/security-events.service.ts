/**
 * B18: read-only Security Events feed (`audit.view`, Super Admin by default).
 *
 * One chronological list built from two existing sources — nothing new is stored:
 *   - `login_attempts`  → LOGIN_FAILED / LOGIN_SUCCEEDED (members and admins)
 *   - `audit_logs`      → a fixed allow-list of security-relevant actions (role/permission changes, OTP policy and
 *                          provider changes, gateway credential changes, bans, password resets, …)
 * Login identifiers are masked in the response (an admin investigating a pattern doesn't need the full address), and a
 * credential or token is never stored in either source to begin with.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";

const PERMISSION = "audit.view";

/** `login.*` actions are NOT here: login_attempts already covers them. */
export const SECURITY_AUDIT_ACTIONS = [
  "admin.password_changed",
  "staff.created",
  "staff.password_reset",
  "staff.super_admin_bootstrapped",
  "role.created",
  "role.permissions_updated",
  "otp.policy_changed",
  "otp_config.update",
  "otp_config.provider_switched",
  "payment_gateway.credentials_updated",
  "payment_gateway.switched",
  "payment_gateway.activated",
  "payment_gateway.deactivated",
  "payment.signature_mismatch",
  "account.banned",
  "account.unbanned",
  "account.suspended_by_admin",
  "account.auto_suspended",
  "user.password_reset",
  "user.password_reset.failed",
  "user.password_reset_requested",
  "user.device_verified",
  "user.login.device_verification_required",
  "user.logout_all",
  "settings.signup_changed",
  "settings.search_changed",
  "signup.otp_skipped_by_policy",
  // B19
  "settings.maintenance_changed",
  "settings.profile_approval_changed",
  "settings.admin_mfa_changed",
  "settings.admin_mfa_disabled_break_glass",
  "admin.mfa_challenge_sent",
  "security_events.exported",
] as const;

export type SecurityEventType = "ALL" | "LOGIN_FAILED" | "LOGIN_SUCCEEDED" | "CHANGES";

export interface ListSecurityEventsInput {
  type?: SecurityEventType;
  actor?: "USER" | "ADMIN";
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface SecurityEventView {
  id: string;
  source: "LOGIN_ATTEMPT" | "AUDIT";
  occurredAt: string;
  kind: string;
  actorType: "USER" | "ADMIN" | "SYSTEM" | "UNKNOWN";
  /** Masked login identifier, or the acting account's id for audit rows. */
  subject: string | null;
  ipAddress: string | null;
  detail: string | null;
}

export function maskIdentifier(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  const at = v.indexOf("@");
  if (at > 0) return `${v.slice(0, 1)}***${v.slice(at)}`;
  if (v.length <= 4) return "***";
  return `${v.slice(0, 2)}${"*".repeat(Math.max(3, v.length - 4))}${v.slice(-2)}`;
}

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

export async function listSecurityEvents(ctx: AuthContext, input: ListSecurityEventsInput) {
  await requirePermission(ctx, PERMISSION);
  return queryEvents(input, MAX_PAGE_SIZE);
}

async function queryEvents(input: ListSecurityEventsInput, maxPageSize: number) {
  const from = input.dateFrom ? new Date(input.dateFrom) : undefined;
  const to = input.dateTo ? new Date(input.dateTo) : undefined;
  if (from && Number.isNaN(from.getTime())) throw new ValidationError("Invalid dateFrom.");
  if (to && Number.isNaN(to.getTime())) throw new ValidationError("Invalid dateTo.");
  if (from && to && from > to) throw new ValidationError("dateFrom must not be after dateTo.");

  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, maxPageSize);
  const type = input.type ?? "ALL";

  const actionList = sql.join(SECURITY_AUDIT_ACTIONS.map((a) => sql`${a}`), sql`, `);
  const attempts = sql`
    SELECT la.id::text AS id, 'LOGIN_ATTEMPT' AS source, la.created_at AS occurred_at,
           CASE WHEN la.success THEN 'LOGIN_SUCCEEDED' ELSE 'LOGIN_FAILED' END AS kind,
           CASE WHEN la.admin_user_id IS NOT NULL THEN 'ADMIN' WHEN la.user_id IS NOT NULL THEN 'USER' ELSE 'UNKNOWN' END AS actor_type,
           la.identifier AS subject, la.ip_address AS ip_address,
           concat_ws(' · ', la.method, la.failure_reason) AS detail
    FROM login_attempts la`;
  const audits = sql`
    SELECT al.id::text AS id, 'AUDIT' AS source, al.created_at AS occurred_at,
           al.action AS kind, al.actor_type::text AS actor_type,
           al.actor_id::text AS subject, al.ip_address AS ip_address, al.entity_type AS detail
    FROM audit_logs al WHERE al.action IN (${actionList})`;

  const source = type === "LOGIN_FAILED" || type === "LOGIN_SUCCEEDED" ? attempts : type === "CHANGES" ? audits : sql`${attempts} UNION ALL ${audits}`;

  const where: SQL[] = [];
  if (type === "LOGIN_FAILED" || type === "LOGIN_SUCCEEDED") where.push(sql`e.kind = ${type}`);
  if (input.actor) where.push(sql`e.actor_type = ${input.actor}`);
  if (from) where.push(sql`e.occurred_at >= ${from}`);
  if (to) where.push(sql`e.occurred_at <= ${to}`);
  if (input.q) {
    const like = `%${escapeLike(input.q.trim())}%`;
    where.push(sql`(e.subject ILIKE ${like} OR e.ip_address ILIKE ${like} OR e.kind ILIKE ${like})`);
  }
  const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const [rowsRes, countRes] = await Promise.all([
    db.execute(sql`SELECT * FROM (${source}) e ${whereSql} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    db.execute(sql`SELECT count(*)::int AS c FROM (${source}) e ${whereSql}`),
  ]);
  const total = Number((countRes.rows[0] as { c: number } | undefined)?.c ?? 0);
  const items: SecurityEventView[] = (rowsRes.rows as Array<Record<string, unknown>>).map((r) => {
    const isAttempt = r.source === "LOGIN_ATTEMPT";
    return {
      id: String(r.id),
      source: isAttempt ? "LOGIN_ATTEMPT" : "AUDIT",
      occurredAt: new Date(r.occurred_at as string | Date).toISOString(),
      kind: String(r.kind),
      actorType: (["USER", "ADMIN", "SYSTEM"].includes(String(r.actor_type)) ? String(r.actor_type) : "UNKNOWN") as SecurityEventView["actorType"],
      subject: isAttempt ? maskIdentifier((r.subject as string | null) ?? null) : ((r.subject as string | null) ?? null),
      ipAddress: (r.ip_address as string | null) ?? null,
      detail: (r.detail as string | null) || null,
    };
  });
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---------------------------------------------------------------------------
// B19: CSV export
// ---------------------------------------------------------------------------

export const EXPORT_MAX_ROWS = 5000;

/** Neutralises spreadsheet formula injection: a cell starting with = + - @ (or tab/CR) is prefixed with an apostrophe. */
export function csvCell(value: unknown): string {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Same filters as the list; newest first; at most EXPORT_MAX_ROWS rows; identifiers stay masked exactly as on screen. */
export async function exportSecurityEventsCsv(ctx: AuthContext, input: Omit<ListSecurityEventsInput, "page" | "pageSize">, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  await requirePermission(ctx, PERMISSION);
  const page = await queryEvents({ ...input, page: 1, pageSize: EXPORT_MAX_ROWS }, EXPORT_MAX_ROWS);
  const header = ["occurred_at", "source", "kind", "actor_type", "subject", "ip_address", "detail"];
  const lines = [header.join(",")];
  for (const e of page.items) lines.push([e.occurredAt, e.source, e.kind, e.actorType, e.subject, e.ipAddress, e.detail].map(csvCell).join(","));
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "security_events.exported",
    entityType: "security_events",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { rows: page.items.length, totalMatching: page.total, truncated: page.total > page.items.length, filters: input },
  });
  return { csv: lines.join("\r\n") + "\r\n", rows: page.items.length, totalMatching: page.total };
}
