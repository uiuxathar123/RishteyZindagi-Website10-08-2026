#!/usr/bin/env -S npx tsx
/**
 * PCP — run one background job from the command line (system cron, a
 * container cron job, a one-off operator run):
 *
 *     npm run job -- membership-expiry
 *     npm run job -- --list
 *
 * Exit code: 0 on SUCCEEDED/SKIPPED_LOCKED, 1 on FAILED or unknown job.
 */
import "dotenv/config";
import { listJobs } from "../src/server/jobs/registry";
import { runJob } from "../src/server/jobs/runner";

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    for (const j of listJobs()) console.log(`${j.name.padEnd(28)} ${j.suggestedSchedule.padEnd(14)} ${j.description}`);
    process.exit(arg ? 0 : 1);
  }
  const result = await runJob(arg, "CLI");
  if (!result) {
    console.error(`Unknown job "${arg}". Run with --list to see the registered jobs.`);
    process.exit(1);
  }
  console.log(JSON.stringify(result));
  process.exit(result.status === "FAILED" ? 1 : 0);
}

main().catch((err) => {
  console.error("run-job failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
