/**
 * PCP: cron-compatible job runner. No permanent Node process is needed — any
 * scheduler that can make an HTTP request (system cron + curl, a cloud
 * scheduler, Vercel-style cron) or run a command (`npm run job -- <name>`)
 * triggers a job, which runs to completion and exits.
 *
 * Safety properties:
 *  - Overlap protection: a transaction-scoped PostgreSQL advisory lock keyed
 *    by job name. If a previous run is still going (or a second scheduler
 *    fires), the new attempt is recorded as SKIPPED_LOCKED and does nothing.
 *    The lock is released automatically when the transaction ends, even if
 *    the process dies.
 *  - Auditable: every run writes a `job_runs` row and an audit-log entry
 *    (actor type SYSTEM) with counters — never row contents or PII.
 *  - Idempotent: see JobDefinition.run().
 */
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";
import { record } from "@/server/modules/audit/audit.service";
import { logError } from "@/server/lib/logger";
import { getJob } from "./registry";
import type { JobRunResult, JobStats } from "./types";

export type JobTrigger = "HTTP" | "CLI";

export async function runJob(name: string, trigger: JobTrigger): Promise<JobRunResult | null> {
  const job = getJob(name);
  if (!job) return null;

  return db.transaction(async (tx) => {
    const lockRes = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${"rz-job:" + name})) AS locked`);
    const locked = Boolean((lockRes.rows[0] as { locked: boolean }).locked);

    if (!locked) {
      const [skipped] = await db
        .insert(jobRuns)
        .values({ jobName: name, status: "SKIPPED_LOCKED", trigger, finishedAt: new Date() })
        .returning({ id: jobRuns.id });
      return { job: name, status: "SKIPPED_LOCKED" as const, runId: skipped.id };
    }

    const [run] = await db.insert(jobRuns).values({ jobName: name, status: "RUNNING", trigger }).returning({ id: jobRuns.id });

    let stats: JobStats | undefined;
    let error: string | undefined;
    try {
      stats = await job.run();
    } catch (err) {
      logError("job-failed", err, { job: name });
      // Only the message class is stored — never a stack, query or row data.
      error = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
    }

    const status = error ? ("FAILED" as const) : ("SUCCEEDED" as const);
    await db
      .update(jobRuns)
      .set({ status, finishedAt: new Date(), stats: stats ?? null, error: error ?? null })
      .where(eq(jobRuns.id, run.id));

    await record({
      actorType: "SYSTEM",
      action: error ? "job.failed" : "job.completed",
      entityType: "job",
      metadata: { job: name, trigger, runId: run.id, ...(stats ? { stats } : {}), ...(error ? { error } : {}) },
    });

    return { job: name, status, runId: run.id, stats, error };
  });
}
