/**
 * B19 — weekly member digest.
 *
 * One e-mail per opted-in member per ISO week (Asia/Kolkata) summarising: interests waiting for an answer, matches made in
 * the last 7 days and unread chat messages. Rules:
 *  - OFF unless BOTH the Super Admin master switch (`digest.settings`) is on AND the member opted in (`DIGEST: true`);
 *    a member who turned the E-mail channel off never gets one either.
 *  - Only ACTIVE members with a verified e-mail address.
 *  - A member with nothing to report is skipped (logged EMPTY) — no "nothing new" mail.
 *  - Idempotent: a (member, week) row in `digest_log` is claimed atomically BEFORE sending, so two overlapping schedulers
 *    cannot double-send. A FAILED row (SMTP refused) is retried by the next run; a SENDING row older than an hour is
 *    treated as a crashed run and re-claimed.
 *  - If SMTP is not configured nothing is claimed and the job reports `skipped`; delivery is never faked.
 *  - The mail contains counts and a link only — no names, messages or profile details of other members.
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { isMailerConfigured, sendMail } from "@/server/lib/mailer";
import { logError } from "@/server/lib/logger";
import { getDigestSettings } from "@/server/modules/platform-settings/platform-settings.service";
import type { JobDefinition, JobStats } from "../types";

const BATCH = 200;
const MAX_BATCHES = 25;

interface Candidate {
  id: string;
  name: string;
  email: string;
  pending_interests: number;
  new_matches: number;
  unread_messages: number;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDigestMail(c: { name: string; pending: number; matches: number; unread: number }, appUrl: string): { subject: string; text: string; html: string } {
  const lines: string[] = [];
  if (c.pending > 0) lines.push(`${c.pending} interest${c.pending === 1 ? "" : "s"} waiting for your answer`);
  if (c.matches > 0) lines.push(`${c.matches} new match${c.matches === 1 ? "" : "es"} this week`);
  if (c.unread > 0) lines.push(`${c.unread} unread message${c.unread === 1 ? "" : "s"}`);
  const base = appUrl.replace(/\/+$/, "");
  const link = `${base}/dashboard`;
  const settings = `${base}/dashboard/settings`;
  const first = c.name.trim().split(/\s+/)[0] || "there";
  const text = [
    `Hello ${first},`,
    "",
    "Here is your weekly RishteyZindagi summary:",
    ...lines.map((l) => `  - ${l}`),
    "",
    `Open your dashboard: ${link}`,
    "",
    `You get this e-mail because you turned on the weekly summary. Turn it off any time in Settings: ${settings}`,
  ].join("\n");
  const html = `<p>Hello ${esc(first)},</p><p>Here is your weekly RishteyZindagi summary:</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p><a href="${esc(link)}">Open your dashboard</a></p><p style="color:#666;font-size:12px">You get this e-mail because you turned on the weekly summary. <a href="${esc(settings)}">Turn it off in Settings</a>.</p>`;
  return { subject: "Your weekly RishteyZindagi summary", text, html };
}

export async function runMemberDigest(): Promise<JobStats> {
  const stats = { sent: 0, empty: 0, failed: 0, skipped: false as boolean, reason: "" as string };
  if (!(await getDigestSettings()).enabled) return { sent: 0, empty: 0, failed: 0, skipped: true, reason: "disabled by Super Admin" };
  if (!isMailerConfigured()) return { sent: 0, empty: 0, failed: 0, skipped: true, reason: "SMTP not configured" };

  const periodRes = await db.execute(sql`SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata', 'IYYY-"W"IW') AS k`);
  const periodKey = String((periodRes.rows[0] as { k: string }).k);
  const appUrl = getEnv().APP_URL;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await db.execute(sql`
      SELECT u.id, u.name, u.email,
        (SELECT count(*)::int FROM interests i JOIN users s ON s.id = i.from_user_id
           WHERE i.to_user_id = u.id AND i.status = 'PENDING' AND s.status = 'ACTIVE') AS pending_interests,
        (SELECT count(*)::int FROM matches m
           WHERE (m.user_a_id = u.id OR m.user_b_id = u.id) AND m.matched_at > now() - interval '7 days') AS new_matches,
        (SELECT count(*)::int FROM messages g JOIN chat_participants cp ON cp.chat_id = g.chat_id AND cp.user_id = u.id
           WHERE g.sender_user_id <> u.id AND g.read_at IS NULL) AS unread_messages
      FROM users u
      WHERE u.status = 'ACTIVE'
        AND u.email_verified_at IS NOT NULL
        AND u.notification_preferences ->> 'DIGEST' = 'true'
        AND COALESCE(u.notification_preferences ->> 'EMAIL', 'true') <> 'false'
        AND NOT EXISTS (
          SELECT 1 FROM digest_log d WHERE d.user_id = u.id AND d.period_key = ${periodKey}
            AND (d.status IN ('SENT', 'EMPTY') OR (d.status = 'SENDING' AND d.created_at > now() - interval '1 hour'))
        )
      ORDER BY u.id
      LIMIT ${BATCH}
    `);
    const rows = res.rows as unknown as Candidate[];
    if (rows.length === 0) break;

    let progressed = 0;
    for (const c of rows) {
      const nothing = c.pending_interests + c.new_matches + c.unread_messages === 0;
      // Atomic claim: only the run that inserts (or re-claims a FAILED / stale SENDING row) may proceed.
      const claim = await db.execute(sql`
        INSERT INTO digest_log (id, user_id, period_key, status)
        VALUES (gen_random_uuid(), ${c.id}, ${periodKey}, ${nothing ? "EMPTY" : "SENDING"})
        ON CONFLICT (user_id, period_key) DO UPDATE SET status = EXCLUDED.status, created_at = now()
          WHERE digest_log.status = 'FAILED' OR (digest_log.status = 'SENDING' AND digest_log.created_at < now() - interval '1 hour')
        RETURNING id
      `);
      if (claim.rows.length === 0) continue; // another run owns it
      progressed++;
      if (nothing) {
        stats.empty++;
        continue;
      }
      try {
        const mail = buildDigestMail({ name: c.name, pending: c.pending_interests, matches: c.new_matches, unread: c.unread_messages }, appUrl);
        await sendMail({ to: c.email, ...mail }, "member-digest");
        await db.execute(sql`UPDATE digest_log SET status = 'SENT' WHERE user_id = ${c.id} AND period_key = ${periodKey}`);
        stats.sent++;
      } catch (err) {
        logError("member-digest.send_failed", err, { userId: c.id });
        await db.execute(sql`UPDATE digest_log SET status = 'FAILED' WHERE user_id = ${c.id} AND period_key = ${periodKey}`);
        stats.failed++;
      }
    }
    // A batch that claimed nothing means every remaining candidate is owned by someone else, and a batch of failures would
    // be returned again next loop — stop instead of spinning.
    if (progressed === 0 || stats.failed > 0 || rows.length < BATCH) break;
  }
  return stats;
}

export const memberDigestJob: JobDefinition = {
  name: "member-digest",
  description: "Sends the weekly summary e-mail (pending interests, new matches, unread messages) to members who opted in. At most one per member per week.",
  suggestedSchedule: "30 3 * * 1",
  run: runMemberDigest,
};
