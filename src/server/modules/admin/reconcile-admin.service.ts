/**
 * B18: "Run reconciliation now" for the Revenue screen (`payments.review`).
 *
 * This only triggers the SAME `payment-reconcile` job a scheduler runs (see jobs/definitions/payments.ts):
 * it re-reads stale pending payments/refunds from the gateway and never closes a payment the gateway could
 * not be asked about. The job runner's advisory lock makes a second click while one is running a harmless no-op,
 * and every run is audited (the job itself writes job.completed; this adds who asked).
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";
import type { AuthContext } from "@/server/middleware/authenticate";
import { requirePermission } from "@/server/middleware/rbac";
import { record } from "@/server/modules/audit/audit.service";
import { runJob } from "@/server/jobs/runner";

const PERMISSION = "payments.review";
const JOB = "payment-reconcile";

export interface ReconcileRunView {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  stats: unknown;
  error: string | null;
}

function toView(r: typeof jobRuns.$inferSelect): ReconcileRunView {
  return { id: r.id, status: r.status, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null, trigger: r.trigger, stats: r.stats ?? null, error: r.error ?? null };
}

export async function listReconcileRuns(ctx: AuthContext): Promise<{ runs: ReconcileRunView[] }> {
  await requirePermission(ctx, PERMISSION);
  const rows = await db.select().from(jobRuns).where(eq(jobRuns.jobName, JOB)).orderBy(desc(jobRuns.startedAt)).limit(5);
  return { runs: rows.map(toView) };
}

export async function runReconcileNow(ctx: AuthContext, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  await requirePermission(ctx, PERMISSION);
  await record({
    actorType: "ADMIN",
    actorId: ctx.subject.id,
    actorRole: ctx.adminRoleName,
    action: "payments.reconcile_requested",
    entityType: "job",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { job: JOB },
  });
  const result = await runJob(JOB, "HTTP");
  return {
    status: result?.status ?? "FAILED",
    stats: result?.stats ?? null,
    error: result?.error ?? null,
    message:
      result?.status === "SKIPPED_LOCKED"
        ? "A reconciliation is already running; nothing was started."
        : result?.status === "SUCCEEDED"
          ? "Reconciliation finished."
          : "Reconciliation failed — see the run history.",
  };
}
