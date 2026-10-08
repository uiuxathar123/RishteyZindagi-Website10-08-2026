/**
 * Single shared Postgres connection pool + Drizzle client for the whole
 * backend. Next.js dev mode hot-reloads modules, which would otherwise
 * recreate a new `pg.Pool` (and leak connections) on every file save —
 * the pool is cached on `globalThis` in development to prevent that, the
 * same pattern used for Prisma clients in every Next.js+Prisma guide.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getEnv } from "@/server/config/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __rzPgPool: Pool | undefined;
}

function createPool() {
  const env = getEnv();
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });
}

const pool = globalThis.__rzPgPool ?? createPool();
if (getEnv().NODE_ENV !== "production") {
  globalThis.__rzPgPool = pool;
}

// B13 (Performance/Scalability phase): a near-zero-cost query-count
// instrumentation hook — the single most valuable, honest measurement a
// single-Postgres-instance sandbox can produce for N+1 auditing (see
// BACKEND.md's B13 section / PERFORMANCE_REPORT.md for how this is used).
// It does exactly one thing: increments a counter every time the pool's
// `query()` method is actually invoked (i.e. one real DB round trip),
// which is what drizzle-orm/node-postgres calls under the hood for every
// statement it executes, transactional or not. No logging, no timing, no
// behavior change to any query — just `count++` before delegating to the
// real implementation, so this is safe to leave permanently wired in
// (negligible overhead) rather than a temporary debug patch that has to
// be remembered and removed. `resetQueryCount()` / `getQueryCount()` are
// used by tests (see tests/perf-query-counts.test.ts) to assert an
// endpoint issues a small, bounded number of queries regardless of
// result-set size — the standard N+1 regression-test shape this file's
// own doc comments ask every future N+1 fix to have.
let __rzQueryCount = 0;
if (!(pool as unknown as { __rzQueryCountPatched?: boolean }).__rzQueryCountPatched) {
  const originalQuery = pool.query.bind(pool);
  (pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof pool.query>) => {
    __rzQueryCount++;
    return (originalQuery as (...a: Parameters<typeof pool.query>) => ReturnType<typeof pool.query>)(...args);
  }) as typeof pool.query;
  (pool as unknown as { __rzQueryCountPatched: boolean }).__rzQueryCountPatched = true;
}

/** Test/diagnostic-only counter of real DB round trips issued through the
 * shared pool since the last reset. Never read by any production code
 * path — see this block's doc comment above. */
export function getQueryCount(): number {
  return __rzQueryCount;
}

export function resetQueryCount(): void {
  __rzQueryCount = 0;
}

export const db = drizzle(pool, { schema });
export type Database = typeof db;
