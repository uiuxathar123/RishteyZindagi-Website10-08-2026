/**
 * B13 (Performance/Scalability phase): load/latency measurement harness.
 *
 * Methodology (disclosed judgment call — see PERFORMANCE_REPORT.md):
 * this drives the real Next.js route handlers IN-PROCESS (the same
 * `import { GET/POST as ... } from "@/app/api/.../route"` + real
 * `NextRequest` pattern every other test file in this suite already
 * uses — see `tests/security-concurrency.test.ts`), against the real,
 * migrated test Postgres database, with genuine concurrent batches
 * (`Promise.all` waves, not sequential awaits). `autocannon` (an
 * HTTP-level load tester) was considered first, per the B13 brief's own
 * suggestion, but was NOT used: it requires a live, listening HTTP
 * server (`next build && next start`), and this sandbox's own tooling
 * budget (the pre-existing 424-test suite alone already takes ~8
 * minutes to run end-to-end here) makes standing up and tearing down a
 * second full server process, on top of the real test DB this same
 * process already owns, a materially less reliable measurement
 * environment than the in-process approach — and critically, it would
 * measure mostly the same application code path this harness already
 * measures (controller -> service -> repository -> the real DB), plus
 * Node's HTTP stack and loopback networking overhead that has nothing
 * to do with any of B13's actual optimization targets (query shape,
 * query count, index usage). This harness intentionally measures
 * apples-to-apples against every other test in this codebase: real
 * route handler, real DB, real data. Documented limitation: it does NOT
 * capture real HTTP/TCP/TLS/reverse-proxy overhead a production request
 * would also pay — see PERFORMANCE_REPORT.md's methodology section for
 * the full honest caveat.
 *
 * Percentiles are computed from the sorted latency array with the
 * standard nearest-rank method (p50/p95/p99 = the value at index
 * `ceil(p/100 * n) - 1`). Thresholds below are intentionally generous
 * (they exist to catch a severe regression, e.g. an accidental N+1
 * reintroduced later — not to assert a specific production SLA against
 * a shared, unthrottled sandbox CPU) — the REAL numbers this run
 * produces are what's recorded in PERFORMANCE_REPORT.md, not just
 * pass/fail against these loose bounds.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { GET as health } from "@/app/api/v1/health/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as searchProfiles } from "@/app/api/v1/search/profiles/route";
import { GET as getRecommendations } from "@/app/api/v1/profiles/me/recommendations/route";
import { PATCH as patchPreferences } from "@/app/api/v1/profiles/me/partner-preferences/route";
import { POST as openChat, GET as listMyChats } from "@/app/api/v1/chats/route";
import { GET as listMessages, POST as sendMessage } from "@/app/api/v1/chats/[chatId]/messages/route";
import { GET as listNotifications } from "@/app/api/v1/notifications/route";
import { GET as getDashboard } from "@/app/api/v1/admin/dashboard/route";
import { GET as listAdminUsers } from "@/app/api/v1/admin/users/route";
import { POST as loginAdmin } from "@/app/api/v1/admin/login/route";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { PATCH as respondInterest } from "@/app/api/v1/interactions/interests/[interestId]/route";
import { db } from "@/server/db/client";
import { adminRoles, adminUsers } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests, activateMembershipForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";
import { NextRequest } from "next/server";

function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}

interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  errorRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Runs `fn` `iterations` times in waves of `concurrency` genuinely
 * parallel calls (Promise.all), recording per-call latency and whether
 * it returned a 2xx status. Returns sorted latency stats + throughput. */
async function loadTest(
  label: string,
  fn: () => Promise<Response>,
  iterations: number,
  concurrency: number
): Promise<LatencyStats & { throughputPerSec: number }> {
  const latencies: number[] = [];
  let errors = 0;
  const wallStart = Date.now();

  for (let i = 0; i < iterations; i += concurrency) {
    const wave = Math.min(concurrency, iterations - i);
    const results = await Promise.all(
      Array.from({ length: wave }, async () => {
        const start = Date.now();
        const res = await fn();
        const elapsed = Date.now() - start;
        if (res.status >= 400) errors += 1;
        return elapsed;
      })
    );
    latencies.push(...results);
  }

  const wallElapsedSec = Math.max(0.001, (Date.now() - wallStart) / 1000);
  const sorted = [...latencies].sort((a, b) => a - b);
  const stats: LatencyStats & { throughputPerSec: number } = {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    errorRate: errors / Math.max(1, sorted.length),
    throughputPerSec: Math.round((sorted.length / wallElapsedSec) * 100) / 100,
  };
  // eslint-disable-next-line no-console
  console.log(
    `[B13 load] ${label}: n=${stats.n} p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms min=${stats.min}ms max=${stats.max}ms errorRate=${(stats.errorRate * 100).toFixed(1)}% throughput=${stats.throughputPerSec}/s`
  );
  return stats;
}

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

async function setPreferences(token: string, body: Record<string, unknown>) {
  const res = await patchPreferences(req("http://localhost/api/v1/profiles/me/partner-preferences", body, { token, method: "PATCH" }));
  if (res.status !== 200) throw new Error(`setPreferences failed (${res.status})`);
}

let requester: Awaited<ReturnType<typeof buildReadyProfile>>;
let chatId: string;
let adminToken: string;
const LOGIN_EMAIL_PASSWORD = "correcthorsebattery";

describe("B13 load/latency measurement", () => {
  beforeAll(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();

    const refs: ReferenceIds = await resolveReferenceIds();
    requester = await buildReadyProfile("perf-load-req", refs, { gender: "MALE", dateOfBirth: dobForAge(30) });
    await setPreferences(requester.member.sessionToken, {
      ageMin: 20,
      ageMax: 40,
      religionId: refs.religionId,
    });
    await activateMembershipForTests(requester.member.userId);

    // A small, realistic candidate population for search/recommendations.
    for (let i = 0; i < 8; i++) {
      __resetRateLimitsForTests();
      await buildReadyProfile(`perf-load-cand-${i}`, refs, { gender: "FEMALE", dateOfBirth: dobForAge(24 + (i % 10)) });
    }

    // A chat with a handful of messages, for the chat-retrieval load case.
    __resetRateLimitsForTests();
    const other = await buildReadyProfile("perf-load-chat-other", refs, { gender: "FEMALE", dateOfBirth: dobForAge(27) });
    await activateMembershipForTests(other.member.userId);
    const sendRes = await sendInterest(req("http://localhost/api/v1/interactions/interests", { toUserId: other.member.userId }, { token: requester.member.sessionToken, method: "POST" }));
    const { data: sendData } = await sendRes.json();
    if (!sendData.matched) {
      await respondInterest(
        req(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, { token: other.member.sessionToken, method: "PATCH" }),
        { params: { interestId: sendData.interest.id } }
      );
    }
    const chatRes = await openChat(req("http://localhost/api/v1/chats", { counterpartUserId: other.member.userId }, { token: requester.member.sessionToken, method: "POST" }));
    const { data: chatData } = await chatRes.json();
    chatId = chatData.chat.id as string;
    for (let i = 0; i < 15; i++) {
      await sendMessage(
        req(`http://localhost/api/v1/chats/${chatId}/messages`, { body: `load test message ${i}` }, { token: requester.member.sessionToken, method: "POST" }),
        { params: { chatId } }
      );
    }

    // An admin, for the admin-dashboard / admin-search load cases.
    const [role] = await db.select().from(adminRoles).where((await import("drizzle-orm")).eq(adminRoles.name, "SUPER_ADMIN"));
    const adminEmail = `perf-load-admin-${Date.now()}@rishteyzindagi.local`;
    await db.insert(adminUsers).values({ name: "Perf Load Admin", email: adminEmail, passwordHash: await hashPassword("adminpassword1"), roleId: role.id });
    const loginRes = await loginAdmin(
      new NextRequest("http://localhost/api/v1/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: "adminpassword1" }),
      })
    );
    const { data: loginData } = await loginRes.json();
    adminToken = loginData.sessionToken as string;

    __resetRateLimitsForTests();
  }, 120_000);

  it("[perf-load-health] GET /health", async () => {
    const stats = await loadTest("health", () => health(greq("http://localhost/api/v1/health")), 30, 10);
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });

  it("[perf-load-login] POST /auth/login", async () => {
    // login is rate-limited at 10/60s per IP (auth.controller.ts) — a
    // deliberate production safety feature, already covered by its own
    // dedicated tests (tests/auth-login.test.ts / tests/rbac.test.ts).
    // This load test's subject is the handler+DB latency of a real
    // login, not the rate limiter, so it resets before every call —
    // exactly like this suite's other fixture-setup rate-limit resets.
    const stats = await loadTest(
      "login",
      () => {
        __resetRateLimitsForTests();
        return login(
          req(
            "http://localhost/api/v1/auth/login",
            { email: requester.member.email, password: LOGIN_EMAIL_PASSWORD },
            { method: "POST", deviceId: requester.member.deviceId }
          )
        );
      },
      20,
      5
    );
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(3000);
  });

  it("[perf-load-search] GET /search/profiles", async () => {
    const stats = await loadTest(
      "search",
      () => searchProfiles(greq("http://localhost/api/v1/search/profiles?gender=FEMALE&page=1&pageSize=10", requester.member.sessionToken)),
      30,
      10
    );
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });

  it("[perf-load-recommendations] GET /profiles/me/recommendations", async () => {
    const stats = await loadTest(
      "recommendations",
      () => getRecommendations(greq("http://localhost/api/v1/profiles/me/recommendations?pageSize=10", requester.member.sessionToken)),
      30,
      10
    );
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2500);
  });

  it("[perf-load-chat-messages] GET /chats/:id/messages", async () => {
    const stats = await loadTest(
      "chat messages",
      () => listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages?page=1&pageSize=20`, requester.member.sessionToken), { params: { chatId } }),
      30,
      10
    );
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });

  it("[perf-load-chat-list] GET /chats (conversation list)", async () => {
    const stats = await loadTest("chat list", () => listMyChats(greq("http://localhost/api/v1/chats", requester.member.sessionToken)), 30, 10);
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });

  it("[perf-load-notifications] GET /notifications", async () => {
    const stats = await loadTest(
      "notifications",
      () => listNotifications(greq("http://localhost/api/v1/notifications?page=1&pageSize=20", requester.member.sessionToken)),
      30,
      10
    );
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });

  it("[perf-load-admin-dashboard] GET /admin/dashboard", async () => {
    const stats = await loadTest("admin dashboard", () => getDashboard(greq("http://localhost/api/v1/admin/dashboard", adminToken)), 20, 5);
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });

  it("[perf-load-admin-search] GET /admin/users (admin search)", async () => {
    const stats = await loadTest(
      "admin user search",
      () => listAdminUsers(greq("http://localhost/api/v1/admin/users?page=1&pageSize=20", adminToken)),
      20,
      5
    );
    expect(stats.errorRate).toBe(0);
    expect(stats.p95).toBeLessThan(2000);
  });
});
