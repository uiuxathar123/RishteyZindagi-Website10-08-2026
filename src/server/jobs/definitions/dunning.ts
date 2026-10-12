/**
 * B19 — renewal follow-up ("dunning") groundwork.
 *
 * HONEST SCOPE: this platform stores no card, token or mandate, so it can never charge a member by itself. What this job
 * does is the part that IS possible on the web app: it walks each lapsed auto-renew membership through a small, auditable
 * state machine and sends ONE follow-up reminder, so the member is nudged to renew by paying normally through checkout.
 *
 *   LAPSED ──(3 days)──> FOLLOW_UP_SENT ──(10 days)──> CLOSED      (no more messages)
 *      └──────── member buys a newer ACTIVE membership ──────────> RENEWED
 *
 * Cycles are created by `membership-renewal-failed` when it clears the auto-renew flag. Every transition is a conditional
 * UPDATE, so overlapping or repeated runs cannot send a second reminder. Real automatic charging would need Razorpay
 * Subscriptions / e-mandates (or PhonePe Autopay) plus customer consent flows and webhooks — out of scope here.
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notify } from "@/server/modules/notifications/notifications.service";
import { isMailerConfigured } from "@/server/lib/mailer";
import { logError } from "@/server/lib/logger";
import type { JobDefinition } from "../types";

export const FOLLOW_UP_AFTER_DAYS = 3;
export const CLOSE_AFTER_DAYS = 10;
const BATCH = 500;

export const membershipDunningJob: JobDefinition = {
  name: "membership-dunning",
  description: "Advances renewal follow-up cycles: marks renewed ones, sends one reminder 3 days after a lapse, and closes cycles after 10 days. Never charges anyone.",
  suggestedSchedule: "15 * * * *",
  async run() {
    // 1. Renewed: the member bought a newer ACTIVE membership.
    const renewed = await db.execute(sql`
      UPDATE renewal_cycles c
      SET state = 'RENEWED', closed_at = now(),
          renewed_membership_id = (
            SELECT n.id FROM memberships n JOIN memberships m ON m.id = c.membership_id
            WHERE n.user_id = c.user_id AND n.created_at > m.created_at AND n.status = 'ACTIVE'
            ORDER BY n.created_at DESC LIMIT 1)
      WHERE c.state IN ('LAPSED', 'FOLLOW_UP_SENT')
        AND EXISTS (
          SELECT 1 FROM memberships n JOIN memberships m ON m.id = c.membership_id
          WHERE n.user_id = c.user_id AND n.created_at > m.created_at AND n.status = 'ACTIVE')
      RETURNING c.id`);

    // 2. One follow-up reminder. The UPDATE is the claim; only rows it moved are notified.
    const moved = await db.execute(sql`
      WITH due AS (
        UPDATE renewal_cycles c
        SET state = 'FOLLOW_UP_SENT', last_notice_at = now()
        WHERE c.id IN (
          SELECT c2.id FROM renewal_cycles c2 JOIN users u ON u.id = c2.user_id AND u.status = 'ACTIVE'
          WHERE c2.state = 'LAPSED' AND c2.lapsed_at <= now() - (${FOLLOW_UP_AFTER_DAYS} * interval '1 day')
            AND c2.lapsed_at > now() - (${CLOSE_AFTER_DAYS} * interval '1 day')
          ORDER BY c2.lapsed_at LIMIT ${BATCH} FOR UPDATE OF c2 SKIP LOCKED)
        RETURNING c.id, c.membership_id, c.user_id
      )
      SELECT d.membership_id, d.user_id, p.name AS plan_name
      FROM due d JOIN memberships m ON m.id = d.membership_id LEFT JOIN membership_plans p ON p.id = m.plan_id`);
    let notified = 0;
    for (const r of moved.rows as Array<{ membership_id: string; user_id: string; plan_name: string | null }>) {
      try {
        const title = "Your membership has ended — renew whenever you're ready";
        const body = `Your ${r.plan_name ?? "membership"} ended a few days ago. Open Membership in your dashboard to renew; your profile and matches are kept.`;
        const key = `renewal_follow_up:${r.membership_id}`;
        if ((await notify({ userId: r.user_id, channel: "IN_APP", title, body, dedupeKey: key })) !== null) notified++;
        if (isMailerConfigured()) await notify({ userId: r.user_id, channel: "EMAIL", title, body, dedupeKey: `${key}:email` });
      } catch (err) {
        logError("job-membership-dunning-notify", err, { membershipId: r.membership_id });
      }
    }

    // 3. Close cycles that got no response.
    const closed = await db.execute(sql`
      UPDATE renewal_cycles SET state = 'CLOSED', closed_at = now()
      WHERE state IN ('LAPSED', 'FOLLOW_UP_SENT') AND lapsed_at <= now() - (${CLOSE_AFTER_DAYS} * interval '1 day')
      RETURNING id`);

    return { renewed: renewed.rows.length, followUps: moved.rows.length, notified, closed: closed.rows.length };
  },
};
