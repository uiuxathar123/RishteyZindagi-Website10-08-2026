/**
 * PCP section I — membership automation. Three small, independent, idempotent jobs
 * (so a scheduler can run them at different cadences). Every one follows the
 * "select rows still in the BEFORE state, move them to the AFTER state with a
 * conditional UPDATE, notify with a dedupe key" pattern, so running it twice (or two
 * overlapping schedulers) can never double-apply an effect.
 *
 *  - membership-expiry          ACTIVE and past `expires_at`  ->  EXPIRED (+ notice)
 *  - membership-reminders       ACTIVE and expiring in (3,7] days or (0,3] days -> one notice per stage
 *  - membership-renewal-failed  EXPIRED with auto-renew on and no newer membership -> "renew manually" notice
 *
 * HONEST LIMITATION: this platform stores no card/mandate, so it cannot charge a member
 * unattended. "Auto-renew" therefore never fabricates a charge here: when an auto-renew
 * membership lapses, the member is told renewal could not be completed automatically
 * and is asked to renew (see KNOWN_LIMITATIONS.md). Recurring-mandate support would
 * need Razorpay Subscriptions / PhonePe Autopay, which is out of scope.
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notify } from "@/server/modules/notifications/notifications.service";
import { isMailerConfigured } from "@/server/lib/mailer";
import { logError } from "@/server/lib/logger";
import type { JobDefinition } from "../types";

const BATCH = 500;
const MAX_BATCHES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  user_id: string;
  plan_name: string | null;
  expires_at: Date | string | null;
}

function ymd(value: Date | string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "unknown date";
}

/** In-app notice always; an email copy only when SMTP is actually configured (never a fake channel). */
async function tell(userId: string, title: string, body: string, key: string): Promise<boolean> {
  const inApp = await notify({ userId, channel: "IN_APP", title, body, dedupeKey: key });
  if (isMailerConfigured()) {
    await notify({ userId, channel: "EMAIL", title, body, dedupeKey: `${key}:email` });
  }
  return inApp !== null;
}

export const membershipExpiryJob: JobDefinition = {
  name: "membership-expiry",
  description: "Marks ACTIVE memberships whose expiry has passed as EXPIRED and notifies the member once.",
  suggestedSchedule: "*/15 * * * *",
  async run() {
    let expired = 0;
    let notified = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      // The UPDATE is the state transition; only rows this statement moved are notified.
      const res = await db.execute(sql`
        WITH moved AS (
          UPDATE memberships SET status = 'EXPIRED'
          WHERE id IN (
            SELECT id FROM memberships
            WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= now()
            ORDER BY expires_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
          )
          RETURNING id, user_id, plan_id, expires_at
        )
        SELECT m.id, m.user_id, m.expires_at, p.name AS plan_name
        FROM moved m LEFT JOIN membership_plans p ON p.id = m.plan_id`);
      const rows = res.rows as unknown as Row[];
      expired += rows.length;
      for (const r of rows) {
        try {
          const sent = await tell(
            r.user_id,
            "Your membership has expired",
            `Your ${r.plan_name ?? "membership"} expired on ${ymd(r.expires_at)}. Renew to restore your benefits.`,
            `membership_expired:${r.id}`
          );
          if (sent) notified++;
        } catch (err) {
          logError("job-membership-expiry-notify", err, { membershipId: r.id });
        }
      }
      if (rows.length < BATCH) break;
    }
    return { expired, notified };
  },
};

/** A membership is in exactly one stage at a time: (3, 7] days before expiry, or (0, 3]. */
const STAGES: Array<{ stage: string; days: number; minDays: number; title: string }> = [
  { stage: "7d", days: 7, minDays: 3, title: "Your membership expires in a week" },
  { stage: "3d", days: 3, minDays: 0, title: "Your membership is expiring soon" },
];

export const membershipRemindersJob: JobDefinition = {
  name: "membership-reminders",
  description: "Sends one renewal reminder per membership at 7 days and again at 3 days before expiry.",
  suggestedSchedule: "5 * * * *",
  async run() {
    let reminded = 0;
    let candidates = 0;
    for (const { stage, days, minDays, title } of STAGES) {
      const res = await db.execute(sql`
        SELECT m.id, m.user_id, m.expires_at, p.name AS plan_name
        FROM memberships m
        JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
        LEFT JOIN membership_plans p ON p.id = m.plan_id
        WHERE m.status = 'ACTIVE' AND m.expires_at IS NOT NULL
          AND m.expires_at > now() + (${minDays * DAY_MS} * interval '1 millisecond') AND m.expires_at <= now() + (${days * DAY_MS} * interval '1 millisecond')
        ORDER BY m.expires_at LIMIT ${BATCH * MAX_BATCHES}`);
      const rows = res.rows as unknown as Row[];
      candidates += rows.length;
      for (const r of rows) {
        try {
          // The stage key keeps each stage to one notice per membership, however often the job runs.
          const sent = await tell(
            r.user_id,
            title,
            `Your ${r.plan_name ?? "membership"} expires on ${ymd(r.expires_at)}. Renew to keep your benefits.`,
            `renewal_reminder_${stage}:${r.id}`
          );
          if (sent) reminded++;
        } catch (err) {
          logError("job-membership-reminders-notify", err, { membershipId: r.id });
        }
      }
    }
    return { candidates, reminded };
  },
};

export const membershipRenewalFailedJob: JobDefinition = {
  name: "membership-renewal-failed",
  description:
    "For EXPIRED memberships with auto-renew on and no newer membership, tells the member automatic renewal could not be completed (the platform cannot charge unattended) and clears the auto-renew flag so the notice is not repeated.",
  suggestedSchedule: "*/30 * * * *",
  async run() {
    let flagged = 0;
    let notified = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await db.execute(sql`
        WITH moved AS (
          UPDATE memberships SET auto_renew = false
          WHERE id IN (
            SELECT m.id FROM memberships m
            WHERE m.status = 'EXPIRED' AND m.auto_renew = true
              AND NOT EXISTS (
                SELECT 1 FROM memberships n
                WHERE n.user_id = m.user_id AND n.created_at > m.created_at AND n.status IN ('ACTIVE', 'PENDING')
              )
            ORDER BY m.expires_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
          )
          RETURNING id, user_id, plan_id, expires_at
        )
        SELECT m.id, m.user_id, m.expires_at, p.name AS plan_name
        FROM moved m LEFT JOIN membership_plans p ON p.id = m.plan_id`);
      const rows = res.rows as unknown as Row[];
      flagged += rows.length;
      for (const r of rows) {
        try {
          const sent = await tell(
            r.user_id,
            "Automatic renewal failed",
            `We couldn't automatically renew your ${r.plan_name ?? "membership"} membership. Please renew manually.`,
            `auto_renewal_failed:${r.id}`
          );
          if (sent) notified++;
        } catch (err) {
          logError("job-membership-renewal-failed-notify", err, { membershipId: r.id });
        }
      }
      if (rows.length < BATCH) break;
    }
    return { flagged, notified };
  },
};
