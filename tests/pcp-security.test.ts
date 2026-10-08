/**
 * Production Completion Phase — security review tests (section H / K.8-K.10, K.18).
 *
 * - Exhaustive route sweeps built from the filesystem (a NEW route is covered automatically):
 *   anonymous, member-on-admin, privilege-less admin, admin-on-member, and "never a 5xx".
 * - CORS / security headers, X-Device-Id handling.
 * - Rate-limit policy coverage + an end-to-end 429 through the real handler, and proof that a
 *   spoofed X-Forwarded-For cannot be used to dodge it.
 * - Static secret-exposure scan of source, env template and frontend bundle config.
 * IDOR for individual resources is exercised in the per-module suites (payments, invoices,
 * notifications, push-tokens, photos, chat, interactions, account) — see QA_TRACEABILITY_MATRIX.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminRoles } from "@/server/db/schema";
import { middleware } from "@/middleware";
import { RATE_LIMIT_RULES, matchRateLimitRule } from "@/server/middleware/rate-limit-policy";
import { sanitizeDeviceId } from "@/server/modules/auth/auth.controller";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember, type TestMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { POST as adminLogin } from "@/app/api/v1/admin/login/route";

const ROOT = path.resolve(__dirname, "..");
const loaders = (import.meta as unknown as { glob: (p: string) => unknown }).glob("/src/app/api/v1/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const UUID = "00000000-0000-4000-8000-000000000001";
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

interface RouteCall {
  route: string;
  method: string;
  call: (token?: string) => Promise<Response>;
}

async function allRouteCalls(): Promise<RouteCall[]> {
  const calls: RouteCall[] = [];
  for (const [file, load] of Object.entries(loaders).sort(([a], [b]) => a.localeCompare(b))) {
    const route = file.replace("/src/app/api/v1/", "").replace("/route.ts", "");
    const mod = await load();
    const params: Record<string, string> = {};
    const urlPath = route.replace(/\[([^\]]+)\]/g, (_m, n: string) => {
      params[n] = UUID;
      return UUID;
    });
    for (const method of METHODS) {
      const handler = mod[method] as ((req: NextRequest, ctx: unknown) => Promise<Response>) | undefined;
      if (typeof handler !== "function") continue;
      calls.push({
        route,
        method,
        call: (token) =>
          handler(
            new NextRequest(`http://localhost/api/v1/${urlPath}`, {
              method,
              headers: { ...(method === "GET" ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
              ...(method === "GET" ? {} : { body: "{}" }),
            }),
            { params }
          ),
      });
    }
  }
  return calls;
}

/** Routes that are intentionally reachable without a session, and why. */
const PUBLIC_ROUTES: Record<string, string> = {
  "admin/login": "credential exchange",
  "auth/forgot-password": "signed-out flow",
  "auth/login": "signed-out flow",
  "auth/recover-account/confirm": "signed-out flow (pending-deletion owner proves identity with password + OTP)",
  "auth/recover-account/request": "signed-out flow",
  "auth/register": "signed-out flow",
  "auth/request-login-otp": "signed-out flow",
  "auth/resend-otp": "signed-out flow",
  "auth/reset-password": "signed-out flow",
  "auth/set-password": "signed-out flow (gated by signup OTP proof)",
  "auth/verify-device": "signed-out flow",
  "auth/verify-login-otp": "signed-out flow",
  "auth/verify-signup-otp": "signed-out flow",
  health: "liveness probe",
  "health/ready": "readiness probe",
  "membership-plans": "public pricing",
  "reference/profile-options": "public form options",
  "search/profiles": "public search preview (B4 design)",
  "profiles/[profileId]": "soft-auth public profile view (B4 design)",
  "internal/jobs/[job]": "authenticated by CRON_SECRET, not a session",
  "webhooks/phonepe": "authenticated by provider signature, not a session",
  "webhooks/razorpay": "authenticated by provider signature, not a session",
};

let calls: RouteCall[];
let member: TestMember;
let emptyAdmin: TestAdmin;

beforeAll(async () => {
  calls = await allRouteCalls();
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  await db.execute(sql`DELETE FROM admin_roles WHERE name = 'PCPTEST_EMPTY'`);
  await db.insert(adminRoles).values({ name: "PCPTEST_EMPTY" });
});
afterEach(async () => {
  await resetAdminUsers();
  await db.execute(sql`DELETE FROM admin_roles WHERE name = 'PCPTEST_EMPTY'`);
});

// ---------------------------------------------------------------------------
describe("route sweeps (every route, every method)", () => {
  it("[sweep-discovers-routes] the sweep sees the whole API surface, including the PCP additions", () => {
    const names = new Set(calls.map((c) => c.route));
    expect(names.size).toBeGreaterThanOrEqual(115);
    for (const r of ["admin/staff", "admin/payments/config", "admin/otp/provider", "admin/users/[userId]/ban", "auth/recover-account/confirm", "users/me/delete-account", "webhooks/razorpay", "internal/jobs/[job]"]) {
      expect(names.has(r), r).toBe(true);
    }
  });

  it("[sweep-anonymous] with no session, every route answers 401 — except the documented public allow-list", async () => {
    const unexpected: string[] = [];
    for (const c of calls) {
      const res = await c.call();
      // 503 from a webhook means "gateway not configured, retry later" (never a crash)
      if (!c.route.startsWith("webhooks/")) expect(res.status, `${c.method} ${c.route}`).toBeLessThan(500);
      else expect([401, 503]).toContain(res.status);
      if (res.status === 401) continue;
      if (c.route in PUBLIC_ROUTES) continue;
      unexpected.push(`${res.status} ${c.method} ${c.route}`);
    }
    expect(unexpected).toEqual([]);
    // and the allow-list has no stale entries
    const known = new Set(calls.map((c) => c.route));
    for (const r of Object.keys(PUBLIC_ROUTES)) expect(known.has(r), `stale allow-list entry ${r}`).toBe(true);
  }, 120000);

  it("[sweep-member-on-admin] a signed-in MEMBER can never use an admin route (401/403 only, never 2xx or 5xx)", async () => {
    member = await createVerifiedMember("sec-sweep");
    const bad: string[] = [];
    for (const c of calls.filter((x) => x.route.startsWith("admin/") && x.route !== "admin/login")) {
      const res = await c.call(member.sessionToken);
      if (res.status === 401 || res.status === 403) continue;
      if (res.status === 400 && c.method !== "GET") continue; // body validation precedes the permission check (documented B1 convention)
      bad.push(`${res.status} ${c.method} ${c.route}`);
    }
    expect(bad).toEqual([]);
  }, 120000);

  it("[sweep-permissionless-admin] an admin whose role has NO permissions can never succeed on a permissioned admin route (reads 403; writes 403, or 400 when the body is rejected first)", async () => {
    emptyAdmin = await createAdmin("PCPTEST_EMPTY");
    const SELF_SERVICE = new Set(["admin/login", "admin/me", "admin/ping", "admin/me/password"]);
    const bad: string[] = [];
    let validationFirst = 0;
    for (const c of calls.filter((x) => x.route.startsWith("admin/") && !SELF_SERVICE.has(x.route))) {
      const res = await c.call(emptyAdmin.token);
      if (res.status === 403) continue;
      // Known, documented convention (B1): body validation runs before the permission check on writes, so an
      // empty body is rejected with 400. A read can never answer anything but 403. A valid body is covered per feature.
      if (res.status === 400 && c.method !== "GET") {
        validationFirst++;
        continue;
      }
      bad.push(`${res.status} ${c.method} ${c.route}`);
    }
    expect(bad).toEqual([]);
    expect(validationFirst).toBeLessThan(40); // P3 note: 400-before-403 on writes
  }, 120000);

  it("[sweep-admin-on-member] an ADMIN session is never accepted as a member (no 2xx/5xx on member-only routes)", async () => {
    emptyAdmin = await createAdmin("PCPTEST_EMPTY");
    const memberOnly = calls.filter(
      (c) => !c.route.startsWith("admin/") && !(c.route in PUBLIC_ROUTES) && !c.route.startsWith("auth/") && !c.route.startsWith("webhooks/") && !c.route.startsWith("internal/")
    );
    const bad: string[] = [];
    for (const c of memberOnly) {
      const res = await c.call(emptyAdmin.token);
      if (res.status < 400 || res.status >= 500) bad.push(`${res.status} ${c.method} ${c.route}`);
    }
    // a few routes (e.g. logout, warnings) may legitimately treat any session; the allowance is explicit
    // membership-plans/me and reports/categories return catalogue data that is the same for every caller (no member data).
    expect(bad.filter((l) => !/ auth\/logout| membership-plans\/me$| reports\/categories$/.test(l))).toEqual([]);
  }, 120000);

  it("[sweep-garbage-token] malformed / forged bearer tokens are 401 everywhere, never a 5xx", async () => {
    const bad: string[] = [];
    for (const c of calls) {
      if (c.route in PUBLIC_ROUTES) continue;
      for (const t of ["x", "a".repeat(5000), "../../etc/passwd", "' OR 1=1 --"]) {
        const res = await c.call(t);
        if (res.status !== 401) bad.push(`${res.status} ${c.method} ${c.route}`);
      }
    }
    expect(bad).toEqual([]);
  }, 180000);
});

// ---------------------------------------------------------------------------
describe("CORS, security headers, device id", () => {
  const mw = (method: string, origin?: string) =>
    middleware(new NextRequest("http://localhost/api/v1/auth/login", { method, headers: origin ? { origin } : {} }));
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it("[cors-device-id-allowed] preflight allows X-Device-Id and Authorization, and caches the preflight", () => {
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
    const res = mw("OPTIONS", "https://app.example.com");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const h of ["content-type", "authorization", "x-device-id"]) expect(allowed).toContain(h);
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });

  it("[cors-allowlist-enforced] with an allow-list, other origins get no CORS header; credentials are never enabled", () => {
    process.env.ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com";
    expect(mw("GET", "https://evil.example.net").headers.get("access-control-allow-origin")).toBeNull();
    expect(mw("OPTIONS", "https://evil.example.net").headers.get("access-control-allow-origin")).toBeNull();
    expect(mw("GET", "https://admin.example.com").headers.get("access-control-allow-origin")).toBe("https://admin.example.com");
    expect(mw("GET", "https://admin.example.com").headers.get("access-control-allow-credentials")).toBeNull();
    expect(mw("GET", "https://app.example.com.evil.net").headers.get("access-control-allow-origin")).toBeNull();
    expect(mw("GET", "null").headers.get("access-control-allow-origin")).toBeNull();
  });

  it("[headers-api] every API response is no-store and carries nosniff / frame / referrer protections", () => {
    const res = mw("GET");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("[device-id-sanitised] only short, plain identifiers are accepted as X-Device-Id", () => {
    expect(sanitizeDeviceId("3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab")).toBe("3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab");
    expect(sanitizeDeviceId("brand-new-device")).toBe("brand-new-device");
    expect(sanitizeDeviceId(null)).toBeNull();
    for (const bad of ["", "a b", "x".repeat(129), "<script>", "a;b", "a\nb", "../x", "emoji😀"]) expect(sanitizeDeviceId(bad), JSON.stringify(bad)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("rate limiting policy", () => {
  it("[rl-coverage] every sensitive surface maps to a dedicated, tight rule — and nothing under /api/v1 is unthrottled", () => {
    const expectRule = (method: string, p: string, name: string) => expect(matchRateLimitRule(method, p)?.name, `${method} ${p}`).toBe(name);
    expectRule("POST", "/auth/login", "auth-entry");
    expectRule("POST", "/auth/request-login-otp", "auth-entry");
    expectRule("POST", "/auth/verify-login-otp", "auth-entry");
    expectRule("POST", "/auth/register", "auth-entry");
    expectRule("POST", "/auth/forgot-password", "auth-entry");
    expectRule("POST", "/auth/reset-password", "auth-entry");
    expectRule("POST", "/auth/recover-account/request", "auth-entry");
    expectRule("POST", "/auth/recover-account/confirm", "auth-entry");
    expectRule("POST", "/admin/login", "admin-login");
    expectRule("POST", "/users/me/delete-account", "account-delete");
    expectRule("POST", "/memberships/checkout", "payments");
    expectRule("POST", "/payments/abc/verify", "payments");
    expectRule("POST", "/payments/abc/razorpay/confirm", "payments");
    expectRule("POST", "/webhooks/razorpay", "webhooks");
    expectRule("PATCH", "/profiles/me", "profile-mutation");
    expectRule("POST", "/profiles/me/photos", "photo-mutation");
    expectRule("DELETE", "/profiles/me/photos/abc", "photo-mutation");
    expectRule("POST", "/interactions/likes", "interactions");
    expectRule("GET", "/profiles/abc", "profile-read");
    expectRule("GET", "/search/profiles", "profile-read");
    expectRule("PATCH", "/admin/otp/provider", "admin-write");
    expectRule("PATCH", "/admin/payments/config", "admin-write");
    expectRule("PUT", "/admin/payments/config/razorpay/credentials", "admin-write");
    expectRule("POST", "/admin/users/abc/ban", "admin-write");
    expectRule("POST", "/admin/staff", "admin-write");
    expectRule("GET", "/admin/staff", "admin-read");
    // every route in the tree is matched by some rule
    for (const c of calls) {
      const p = "/" + c.route.replace(/\[[^\]]+\]/g, "abc");
      if (/^\/(health|internal\/jobs)/.test(p)) continue; // deliberately exempt probes + cron (own secret)
      expect(matchRateLimitRule(c.method, p), `${c.method} ${p}`).toBeDefined();
    }
    // the tight unauthenticated rules are strictly tighter than the catch-alls
    const byName = (n: string) => RATE_LIMIT_RULES.find((r) => r.name === n)!;
    expect(byName("admin-login").ipLimit).toBeLessThanOrEqual(10);
    expect(byName("auth-entry").ipLimit).toBeLessThan(byName("default-write").ipLimit);
  });

  describe("end to end (policy enabled)", () => {
    beforeEach(() => {
      vi.stubEnv("RATE_LIMIT_POLICY", "on");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });
    const login = (ip: string) =>
      adminLogin(jreq("http://localhost/api/v1/admin/login", { body: { email: "nobody@example.com", password: "wrongpassword" }, headers: { "x-forwarded-for": ip } }));

    it("[rl-429-admin-login] the 11th attempt in a minute is 429 with Retry-After; the earlier ones are ordinary 401s", async () => {
      const statuses: number[] = [];
      let last: Response | undefined;
      for (let i = 0; i < 12; i++) {
        last = await login("203.0.113.9");
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
      const body = await last!.json();
      expect(body.success).toBe(false);
    });

    it("[rl-default-trust-is-documented] with TRUST_PROXY_HOPS unset the left-most X-Forwarded-For entry is used (forgeable) — the production pre-flight warns about exactly this", async () => {
      let blocked = 0;
      for (let i = 0; i < 14; i++) if ((await login(`198.51.100.${i + 1}`)).status === 429) blocked++;
      expect(blocked).toBe(0); // evasion IS possible in this (unsafe-for-production) configuration
      const { checkPcpProductionReadiness } = await import("@/server/config/prod-readiness-pcp");
      const { getEnv } = await import("@/server/config/env");
      const r = checkPcpProductionReadiness(getEnv(), {} as NodeJS.ProcessEnv);
      expect(r.warnings.some((w) => /TRUST_PROXY_HOPS/.test(w))).toBe(true);
    });

    it("[rl-spoofed-xff-cannot-evade-behind-proxy] with TRUST_PROXY_HOPS=1 only the proxy-appended entry counts, so rotating the forged prefix does not reset the limit", async () => {
      vi.stubEnv("TRUST_PROXY_HOPS", "1");
      vi.resetModules();
      const { POST } = await import("@/app/api/v1/admin/login/route");
      const { jreq: jr } = await import("./helpers/pcp");
      let blocked = 0;
      for (let i = 0; i < 14; i++) {
        const r = await POST(
          jr("http://localhost/api/v1/admin/login", { body: { email: "nobody@example.com", password: "wrongpassword" }, headers: { "x-forwarded-for": `10.9.8.${i + 1}, 203.0.113.77` } })
        );
        if (r.status === 429) blocked++;
      }
      expect(blocked).toBeGreaterThanOrEqual(4);
      // a different real client (different proxy-appended entry) is unaffected
      const other = await POST(jr("http://localhost/api/v1/admin/login", { body: { email: "nobody@example.com", password: "wrongpassword" }, headers: { "x-forwarded-for": "10.9.8.1, 203.0.113.78" } }));
      expect(other.status).toBe(401);
    });
  });
});

describe("production pre-flight (PCP extras)", () => {
  it("[preflight-pcp] flags unsafe deployment settings and passes a safe one", async () => {
    const { checkPcpProductionReadiness } = await import("@/server/config/prod-readiness-pcp");
    const { getEnv } = await import("@/server/config/env");
    const base = getEnv();
    const bad = checkPcpProductionReadiness({ ...base, TRUST_PROXY_HOPS: undefined, CRON_SECRET: "short", APP_URL: "http://x.example" }, { RATE_LIMIT_POLICY: "off", STORAGE_PROVIDER: "s3", S3_ENDPOINT: "http://s3.example" } as unknown as NodeJS.ProcessEnv);
    expect(bad.errors.length).toBe(2);
    expect(bad.warnings.length).toBe(3);
    const good = checkPcpProductionReadiness({ ...base, TRUST_PROXY_HOPS: 1, CRON_SECRET: "c".repeat(40), APP_URL: "https://app.example.com" }, {} as NodeJS.ProcessEnv);
    expect(good).toEqual({ errors: [], warnings: [] });
  });
});

// ---------------------------------------------------------------------------
describe("secret exposure", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git", "backups", "coverage"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }
  const SECRET_PATTERNS: Array<[string, RegExp]> = [
    ["razorpay live key", /rzp_live_[A-Za-z0-9]{8,}/],
    ["AWS access key id", /AKIA[0-9A-Z]{16}/],
    ["private key block", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["stripe-style live key", /sk_live_[A-Za-z0-9]{10,}/],
    ["slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ["google api key", /AIza[0-9A-Za-z_-]{35}/],
  ];

  it("[secrets-none-in-source] no live-looking credential or private key in src/, scripts/, tests/, docs or env templates", () => {
    const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts")), ...walk(path.join(ROOT, "tests")), ...fs.readdirSync(ROOT).filter((f) => /\.(md|example|json)$/.test(f)).map((f) => path.join(ROOT, f))].filter(
      (f) => !f.endsWith("pcp-security.test.ts") && !f.endsWith("package-lock.json")
    );
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${label}: ${path.relative(ROOT, f)}`);
    }
    expect(hits).toEqual([]);
  });

  it("[secrets-env-example-is-placeholders] .env.example has no filled-in secret values", () => {
    const text = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const filled: string[] = [];
    for (const line of text.split("\n")) {
      const m = /^([A-Z0-9_]*(SECRET|PASSWORD|API_KEY|TOKEN|PRIVATE|PASSPHRASE|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*"?([^"#\n]*)"?/.exec(line.trim());
      if (m && m[3].trim() !== "" && !/^(change-me|your-|<|xxx|placeholder|replace)/i.test(m[3].trim())) filled.push(m[1]);
    }
    expect(filled).toEqual([]);
  });

  it("[secrets-not-in-client-bundle-config] no NEXT_PUBLIC_ variable carries a secret, and no client component imports server modules", () => {
    const files = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE|API_KEY|TOKEN|WEBHOOK)/.test(text)) offenders.push(`public secret var: ${path.relative(ROOT, f)}`);
      if (/^["']use client["']/m.test(text.slice(0, 200)) && /from ["']@\/server\//.test(text)) offenders.push(`client imports server: ${path.relative(ROOT, f)}`);
    }
    const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE|API_KEY|TOKEN)/.test(env)) offenders.push(".env.example NEXT_PUBLIC secret");
    expect(offenders).toEqual([]);
  });

  it("[secrets-errors-do-not-leak] an unexpected failure returns a generic message (no stack, SQL or file paths)", async () => {
    // malformed JSON + oversized garbage on a body-parsing route
    const res = await adminLogin(new NextRequest("http://localhost/api/v1/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules|select .* from|\/home\//i);
  });
});
