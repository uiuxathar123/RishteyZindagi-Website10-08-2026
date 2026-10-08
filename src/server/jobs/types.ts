export type JobStats = Record<string, number | string | boolean>;

export interface JobDefinition {
  /** kebab-case, URL-safe; used in /api/v1/internal/jobs/{name} and `npm run job -- {name}` */
  name: string;
  description: string;
  /** Suggested cron expression (documentation only — scheduling lives outside the app). */
  suggestedSchedule: string;
  /**
   * Must be idempotent: running it twice in a row (or two overlapping
   * schedulers) can never double-apply an effect. Every shipped job is
   * written as "select rows still in the *before* state, move them to the
   * *after* state with a conditional UPDATE", plus dedupe keys on
   * notifications.
   */
  run(): Promise<JobStats>;
}

export type JobRunStatus = "SUCCEEDED" | "FAILED" | "SKIPPED_LOCKED";

export interface JobRunResult {
  job: string;
  status: JobRunStatus;
  runId: string;
  stats?: JobStats;
  error?: string;
}
