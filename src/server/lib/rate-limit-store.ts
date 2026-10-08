/**
 * PCP: shared-store rate limiting (fixed window).
 *
 * The B1 limiter (`middleware/rate-limit.ts`) is a synchronous in-process
 * Map — correct for ONE Node process, wrong behind a load balancer (each
 * instance counts alone, so the effective limit is `limit × instances`).
 * This module is the production-safe replacement for the endpoints that
 * matter. Two stores:
 *
 *  - "postgres": one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` per
 *    hit on `rate_limit_counters`. The window roll-over and the increment are
 *    a single statement, so concurrent requests on any number of instances
 *    sharing the database can never lose an update, and the clock used is
 *    the database's `now()` (no cross-instance clock skew).
 *  - "memory": per-process Map. Same semantics, SINGLE-INSTANCE ONLY. It is
 *    the default outside production and is labelled as such by
 *    `/health/ready` — it must never be described as horizontally scalable.
 *
 * Failure policy: if the shared store itself errors (database blip) the hit
 * is counted in the in-process fallback and the error is logged — the limiter
 * degrades to per-instance protection instead of either failing open
 * completely or taking the site down.
 */
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { logError } from "@/server/lib/logger";

export type RateLimitStoreKind = "postgres" | "memory";

export interface RateLimitHit {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

export function resolveRateLimitStoreKind(): RateLimitStoreKind {
  const env = getEnv();
  if (env.RATE_LIMIT_STORE) return env.RATE_LIMIT_STORE;
  return env.NODE_ENV === "production" ? "postgres" : "memory";
}

interface Bucket {
  count: number;
  windowStart: number;
}
const memory = new Map<string, Bucket>();

function hitMemory(key: string, limit: number, windowMs: number): RateLimitHit {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    memory.set(key, { count: 1, windowStart: now });
    return { allowed: true, count: 1, limit, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    count: existing.count,
    limit,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((existing.windowStart + windowMs - now) / 1000)),
  };
}

async function hitPostgres(key: string, limit: number, windowMs: number): Promise<RateLimitHit> {
  const result = await db.execute(sql`
    INSERT INTO rate_limit_counters AS c (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN c.window_start <= now() - (${windowMs}::double precision * interval '1 millisecond') THEN 1
        ELSE c.count + 1
      END,
      window_start = CASE
        WHEN c.window_start <= now() - (${windowMs}::double precision * interval '1 millisecond') THEN now()
        ELSE c.window_start
      END
    RETURNING c.count AS count,
      GREATEST(0, EXTRACT(EPOCH FROM (c.window_start + (${windowMs}::double precision * interval '1 millisecond') - now())))::double precision AS remaining
  `);
  const row = result.rows[0] as { count: number | string; remaining: number | string };
  const count = Number(row.count);
  const allowed = count <= limit;
  return {
    allowed,
    count,
    limit,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(Number(row.remaining))),
  };
}

/** Records one hit against `key` and reports whether it is within `limit` per `windowMs`. */
export async function hitRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitHit> {
  if (resolveRateLimitStoreKind() === "postgres") {
    try {
      return await hitPostgres(key, limit, windowMs);
    } catch (err) {
      logError("rate-limit-store-failed", err, { store: "postgres" });
      return hitMemory(key, limit, windowMs);
    }
  }
  return hitMemory(key, limit, windowMs);
}

/** Housekeeping: delete counters whose window ended long ago. Returns rows deleted. */
export async function pruneRateLimitCounters(olderThanSeconds = 3600): Promise<number> {
  const result = await db.execute(
    sql`DELETE FROM rate_limit_counters WHERE window_start < now() - (${olderThanSeconds}::double precision * interval '1 second')`
  );
  return result.rowCount ?? 0;
}

/** Test-only. */
export function __resetSharedRateLimitMemoryForTests() {
  memory.clear();
}
