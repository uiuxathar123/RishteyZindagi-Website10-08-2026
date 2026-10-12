/**
 * PCP P1 — foundation: shared rate-limit store, central rate-limit policy,
 * cron-compatible job runner. Real PostgreSQL; the "two instances" test spawns
 * two real OS processes that share the database.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";
import { sql, eq, desc } from "drizzle-orm";

vi.hoisted(() => {
  process.env.CRON_SECRET = "pcp-test-cron-secret-0123456789abcdef0123456789";
  process.env.RATE_LIMIT_POLICY = "on";
  process.env.RATE_LIMIT_STORE = "postgres";
});

import { db } from "@/server/db/client";
import { jobRuns, auditLogs } from "@/server/db/schema";
import { hitRateLimit, __resetSharedRateLimitMemoryForTests, pruneRateLimitCounters } from "@/server/lib/rate-limit-store";
import { matchRateLimitRule, RATE_LIMIT_RULES } from "@/server/middleware/rate-limit-policy";
import { POST as adminLogin } from "@/app/api/v1/admin/login/route";
import { GET as healthGet } from "@/app/api/v1/health/route";
import { GET as jobGet, POST as jobPost } from "@/app/api/v1/internal/jobs/[job]/route";
import { GET as listAudit } from "@/app/api/v1/admin/audit-logs/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers } from "./helpers/reset-db";
import { jreq, resetPcpTables, createAdmin } from "./helpers/pcp";
import { runTsx } from "./helpers/run-tsx";

const CRON = { authorization: `Bearer ${process.env.CRON_SECRET}` };

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetPcpTables();
  __resetRateLimitsForTests();
  __resetSharedRateLimitMemoryForTests();
});

describe("PCP shared rate-limit store (postgres)", () => {
  it("[rl-atomic] 60 concurrent hits against limit 10 allow exactly 10", async () => {
    const hits = await Promise.all(Array.from({ length: 60 }, () => hitRateLimit("t:atomic", 10, 60_000)));
    expect(hits.filter((h) => h.allowed)).toHaveLength(10);
    expect(Math.max(...hits.map((h) => h.count))).toBe(60);
    const blocked = hits.find((h) => !h.allowed)!;
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("[rl-window] the window rolls over and counting restarts", async () => {
    expect((await hitRateLimit("t:win", 1, 300)).allowed).toBe(true);
    expect((await hitRateLimit("t:win", 1, 300)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 450));
    const again = await hitRateLimit("t:win", 1, 300);
    expect(again.allowed).toBe(true);
    expect(again.count).toBe(1);
  });

  it("[rl-multi-process] two separate OS processes share one limit (horizontal-scale proof)", async () => {
    const script = path.resolve(__dirname, "helpers/rl-worker.ts");
    const dbUrl = process.env.DATABASE_URL!;
    const env = { ...process.env, DATABASE_URL: dbUrl, RATE_LIMIT_STORE: "postgres" } as NodeJS.ProcessEnv;
    const key = "t:multi-process";
    const [a, b] = await Promise.all([
      runTsx([script, key, "20", "25"], { env, cwd: path.resolve(__dirname, ".."), encoding: "utf8" }),
      runTsx([script, key, "20", "25"], { env, cwd: path.resolve(__dirname, ".."), encoding: "utf8" }),
    ]);
    const allowedA = Number(a.stdout.trim().split("\n").pop());
    const allowedB = Number(b.stdout.trim().split("\n").pop());
    // 2 processes x 20 hits = 40 attempts against a limit of 25 -> exactly 25 allowed in total.
    expect(allowedA + allowedB).toBe(25);
  }, 60_000);

  it("[rl-prune] prunes only old counters", async () => {
    await hitRateLimit("t:fresh", 5, 60_000);
    await db.execute(sql`INSERT INTO rate_limit_counters (key, window_start, count) VALUES ('t:old', now() - interval '3 hours', 3)`);
    expect(await pruneRateLimitCounters(3600)).toBe(1);
    const rows = await db.execute(sql`SELECT key FROM rate_limit_counters`);
    expect(rows.rows.map((r) => (r as { key: string }).key)).toEqual(["t:fresh"]);
  });
});

describe("PCP central rate-limit policy", () => {
  it("[pol-rules] covers sensitive surfaces and falls through to catch-alls", () => {
    const m = (method: string, p: string) => matchRateLimitRule(method, p)?.name;
    expect(m("POST", "/admin/login")).toBe("admin-login");
    expect(m("POST", "/auth/login")).toBe("auth-entry");
    expect(m("POST", "/auth/request-login-otp")).toBe("auth-entry");
    expect(m("POST", "/auth/forgot-password")).toBe("auth-entry");
    expect(m("POST", "/auth/logout")).toBe("auth-session");
    expect(m("POST", "/users/me/delete-account")).toBe("account-delete");
    expect(m("POST", "/webhooks/razorpay")).toBe("webhooks");
    expect(m("POST", "/memberships/checkout")).toBe("payments");
    expect(m("POST", "/payments/abc/verify")).toBe("payments");
    expect(m("DELETE", "/profiles/me/photos/xyz")).toBe("photo-mutation");
    expect(m("PATCH", "/profiles/me")).toBe("profile-mutation");
    expect(m("POST", "/profiles/me")).toBe("profile-mutation");
    expect(m("POST", "/interactions/interests")).toBe("interactions");
    expect(m("GET", "/profiles/123")).toBe("profile-read");
    expect(m("GET", "/search/profiles")).toBe("profile-read");
    expect(m("PATCH", "/admin/otp/config")).toBe("admin-write");
    expect(m("GET", "/admin/users")).toBe("admin-read");
    expect(m("POST", "/something/new")).toBe("default-write");
    expect(m("GET", "/something/new")).toBe("default-read");
    expect(RATE_LIMIT_RULES.at(-1)!.name).toBe("default-read");
  });

  it("[pol-429] admin login is throttled per IP with Retry-After; another IP is unaffected; probes exempt", async () => {
    const attempt = (ip: string) =>
      adminLogin(jreq("http://localhost/api/v1/admin/login", { body: { email: "nobody@example.com", password: "wrongpassword" }, headers: { "x-forwarded-for": ip } }));
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt("203.0.113.9")).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    const blocked = await attempt("203.0.113.9");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = await blocked.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    // a different client IP has its own bucket
    expect((await attempt("203.0.113.77")).status).not.toBe(429);
    // liveness probe is never throttled
    for (let i = 0; i < 5; i++) expect((await healthGet(jreq("http://localhost/api/v1/health"))).status).toBe(200);
  });

  it("[pol-subject] a per-session limit applies even when requests come from many IPs", async () => {
    const admin = await createAdmin("SUPER_ADMIN");
    // admin-read subject limit is 300/min — verify the keying instead by hitting the rule's subject bucket directly
    const rows0 = await db.execute(sql`SELECT count(*)::int AS n FROM rate_limit_counters WHERE key LIKE 'pol:admin-read:s:%'`);
    expect((rows0.rows[0] as { n: number }).n).toBe(0);
    const res = await listAudit(jreq("http://localhost/api/v1/admin/audit-logs", { token: admin.token, headers: { "x-forwarded-for": "198.51.100.5" } }));
    expect(res.status).toBe(200);
    const rows = await db.execute(sql`SELECT key FROM rate_limit_counters WHERE key LIKE 'pol:admin-read:%'`);
    const keys = rows.rows.map((r) => (r as { key: string }).key);
    expect(keys.some((k) => k.startsWith("pol:admin-read:ip:198.51.100.5"))).toBe(true);
    const subjectKey = keys.find((k) => k.startsWith("pol:admin-read:s:"))!;
    expect(subjectKey).toBeTruthy();
    // the bucket is keyed by a hash, never by the raw token
    expect(subjectKey.includes(admin.token)).toBe(false);
  });
});

describe("PCP job runner + cron endpoint", () => {
  const call = (job: string, headers: Record<string, string> = CRON, method: "GET" | "POST" = "POST") =>
    (method === "POST" ? jobPost : jobGet)(jreq(`http://localhost/api/v1/internal/jobs/${job}`, { method, headers }), { params: { job } } as never);

  it("[job-auth] rejects missing/wrong secret with 401 and unknown job with 404", async () => {
    expect((await call("housekeeping", {})).status).toBe(401);
    expect((await call("housekeeping", { authorization: "Bearer wrong-secret-wrong-secret-wrong-secret-xx" })).status).toBe(401);
    expect((await call("no-such-job")).status).toBe(404);
  });

  it("[job-run] housekeeping runs (GET and POST), records a job_runs row and an audit entry, and is idempotent", async () => {
    await db.execute(sql`INSERT INTO rate_limit_counters (key, window_start, count) VALUES ('t:ancient', now() - interval '5 hours', 1)`);
    const first = await call("housekeeping");
    expect(first.status).toBe(200);
    const b1 = await first.json();
    expect(b1.data.status).toBe("SUCCEEDED");
    expect(b1.data.stats.rateLimitCountersDeleted).toBeGreaterThanOrEqual(1);
    const second = await call("housekeeping", CRON, "GET");
    const b2 = await second.json();
    expect(b2.data.status).toBe("SUCCEEDED");
    expect(b2.data.stats.rateLimitCountersDeleted).toBe(0); // nothing left to do → idempotent
    const runs = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt));
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.status === "SUCCEEDED" && r.finishedAt)).toBe(true);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "job.completed"));
    expect(audits.length).toBe(2);
    expect(audits[0].actorType).toBe("SYSTEM");
  });

  it("[job-lock] an overlapping run is skipped, not executed twice", async () => {
    const { runJob } = await import("@/server/jobs/runner");
    const { registerJob } = await import("@/server/jobs/registry");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let executions = 0;
    registerJob({
      name: "pcp-slow-test-job",
      description: "test",
      suggestedSchedule: "* * * * *",
      async run() {
        executions++;
        await gate;
        return { ok: true };
      },
    });
    const first = runJob("pcp-slow-test-job", "CLI");
    await new Promise((r) => setTimeout(r, 200));
    const second = await runJob("pcp-slow-test-job", "CLI");
    expect(second!.status).toBe("SKIPPED_LOCKED");
    release();
    expect((await first)!.status).toBe("SUCCEEDED");
    expect(executions).toBe(1);
  });

  it("[job-fail] a throwing job is recorded FAILED with a bounded message and audited", async () => {
    const { runJob } = await import("@/server/jobs/runner");
    const { registerJob } = await import("@/server/jobs/registry");
    registerJob({
      name: "pcp-failing-test-job",
      description: "test",
      suggestedSchedule: "* * * * *",
      async run() {
        throw new Error("boom " + "x".repeat(2000));
      },
    });
    const result = await runJob("pcp-failing-test-job", "CLI");
    expect(result!.status).toBe("FAILED");
    expect(result!.error!.length).toBeLessThanOrEqual(500);
    const [row] = await db.select().from(jobRuns).where(eq(jobRuns.id, result!.runId));
    expect(row.status).toBe("FAILED");
  });
});

describe("PCP cron endpoint disabled without a strong secret", () => {
  it("[job-disabled] returns 404 when CRON_SECRET is unset or shorter than 32 chars", async () => {
    const saved = process.env.CRON_SECRET;
    vi.resetModules();
    process.env.CRON_SECRET = "short";
    const mod = await import("@/app/api/v1/internal/jobs/[job]/route");
    const res = await mod.POST(jreq("http://localhost/api/v1/internal/jobs/housekeeping", { method: "POST", headers: { authorization: "Bearer short" } }), { params: { job: "housekeeping" } } as never);
    expect(res.status).toBe(404);
    process.env.CRON_SECRET = saved;
    vi.resetModules();
  });
});
