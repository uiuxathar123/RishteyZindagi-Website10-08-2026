import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { pruneRateLimitCounters } from "@/server/lib/rate-limit-store";
import type { JobDefinition } from "../types";

/** Deletes data that only has operational value for a bounded time. Safe to run any number of times. */
export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  description: "Prunes expired rate-limit counters, old webhook-idempotency rows and old job-run history.",
  suggestedSchedule: "17 * * * *",
  async run() {
    const rateLimit = await pruneRateLimitCounters(3600);
    // Webhook ids only need to outlive the gateway's retry horizon (days).
    const webhooks = await db.execute(sql`DELETE FROM payment_webhook_events WHERE received_at < now() - interval '90 days'`);
    const runs = await db.execute(sql`DELETE FROM job_runs WHERE started_at < now() - interval '180 days'`);
    return {
      rateLimitCountersDeleted: rateLimit,
      webhookEventsDeleted: webhooks.rowCount ?? 0,
      jobRunsDeleted: runs.rowCount ?? 0,
    };
  },
};
