import type { JobDefinition } from "./types";
import { housekeepingJob } from "./definitions/housekeeping";
import { membershipExpiryJob, membershipRemindersJob, membershipRenewalFailedJob } from "./definitions/membership";
import { membershipDunningJob } from "./definitions/dunning";
import { memberDigestJob } from "./definitions/digest";
import { paymentReconcileJob, accountDeletionFinalizeJob } from "./definitions/payments";

const jobs: JobDefinition[] = [
  housekeepingJob,
  membershipExpiryJob,
  membershipRemindersJob,
  membershipRenewalFailedJob,
  paymentReconcileJob,
  accountDeletionFinalizeJob,
  memberDigestJob,
  membershipDunningJob,
];

/** Jobs registered later in the phase are appended by their own modules via registerJob(). */
export function registerJob(job: JobDefinition): void {
  if (!jobs.some((j) => j.name === job.name)) jobs.push(job);
}

export function listJobs(): readonly JobDefinition[] {
  return jobs;
}

export function getJob(name: string): JobDefinition | undefined {
  return jobs.find((j) => j.name === name);
}
