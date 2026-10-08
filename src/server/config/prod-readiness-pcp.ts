/**
 * PCP: additional, pure production pre-flight checks (kept in a new file so the frozen
 * B14/B16 prod-readiness module and its tests are untouched). Used by
 * scripts/check-prod-env.ts. Everything here is a WARNING or ERROR about deployment
 * configuration the application cannot fix by itself.
 */
import type { Env } from "./env";

export interface PcpReadiness {
  errors: string[];
  warnings: string[];
}

export function checkPcpProductionReadiness(env: Env, raw: NodeJS.ProcessEnv = process.env): PcpReadiness {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (env.TRUST_PROXY_HOPS === undefined) {
    warnings.push(
      "TRUST_PROXY_HOPS is unset: the rate limiter then keys on the LEFT-MOST X-Forwarded-For entry, which a client can forge unless your edge proxy overwrites the header. Set it to the number of trusted reverse proxies in front of the app (e.g. 1)."
    );
  }
  if (raw.RATE_LIMIT_POLICY === "off") {
    errors.push("RATE_LIMIT_POLICY=off disables the shared rate-limit policy. Remove it for production.");
  }
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
    warnings.push("CRON_SECRET is unset or shorter than 32 characters: the HTTP job endpoint is disabled (404). Membership expiry/reminders, payment reconciliation and account-deletion finalisation then only run if you schedule `npm run job -- <name>` yourself.");
  }
  if (!/^https:\/\//i.test(env.APP_URL)) {
    warnings.push("APP_URL is not an https:// URL: webhook URLs shown in the admin panel and gateway return URLs will be wrong or insecure.");
  }
  if ((raw.STORAGE_PROVIDER ?? "").toLowerCase() === "s3" && (raw.S3_ENDPOINT ?? "").startsWith("http://")) {
    errors.push("S3_ENDPOINT uses plain http:// — object storage traffic must use https in production.");
  }
  return { errors, warnings };
}
