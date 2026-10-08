/**
 * PCP: central rate-limit POLICY, applied once by `withErrorHandling` to every
 * `/api/v1` route (see error-handler.ts). Before this existed ~59 handlers —
 * profile/photo mutations, the public profile read, logout, verify — had no
 * limiter at all, and the limiters that did exist were per-process. A table of
 * (method, path pattern, limit) here covers the whole surface in one reviewed
 * place, backed by the shared store in lib/rate-limit-store.ts.
 *
 * Every request is counted against its client IP; if it carries a bearer token
 * it is ALSO counted against a per-session key (hash of the token — never the
 * token) so one noisy account cannot hide behind many IPs and one shared NAT
 * cannot starve everyone. The first matching rule wins; the last two rules are
 * catch-alls so a newly added route is throttled by default.
 *
 * Existing in-controller limiters keep running (defence in depth) — nothing
 * was removed.
 *
 * Disabled when NODE_ENV=test unless RATE_LIMIT_POLICY=on, because the frozen
 * B1–B15 suites fire hundreds of requests from one synthetic IP; the policy
 * has its own dedicated tests that switch it on.
 */
import { createHash } from "crypto";
import { RateLimitError } from "@/server/lib/errors";
import { getClientIp } from "@/server/lib/client-ip";
import { hitRateLimit } from "@/server/lib/rate-limit-store";
import { getEnv } from "@/server/config/env";

export class PolicyRateLimitError extends RateLimitError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please try again shortly.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface Rule {
  name: string;
  methods: readonly string[] | "*";
  pattern: RegExp;
  /** hits allowed per window, per client IP */
  ipLimit: number;
  /** hits allowed per window, per session token (only when a token is present) */
  subjectLimit?: number;
  windowMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const READ = ["GET", "HEAD"] as const;
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;

export const RATE_LIMIT_RULES: readonly Rule[] = [
  // --- unauthenticated, credential / OTP surfaces: tightest ---------------
  { name: "admin-login", methods: ["POST"], pattern: /^\/admin\/login$/, ipLimit: 10, windowMs: MIN },
  {
    name: "auth-entry",
    methods: ["POST"],
    pattern: /^\/auth\/(login|register|request-login-otp|verify-signup-otp|verify-login-otp|verify-device|set-password|resend-otp|forgot-password|reset-password|recover-account\/(request|confirm))$/,
    ipLimit: 30,
    windowMs: MIN,
  },
  { name: "auth-session", methods: ["POST"], pattern: /^\/auth\/(logout|logout-all)$/, ipLimit: 60, subjectLimit: 30, windowMs: MIN },
  // --- account lifecycle --------------------------------------------------
  { name: "account-delete", methods: ["POST"], pattern: /^\/users\/me\/delete-account$/, ipLimit: 10, subjectLimit: 5, windowMs: HOUR },
  // --- money --------------------------------------------------------------
  { name: "webhooks", methods: ["POST"], pattern: /^\/webhooks\/[a-z]+$/, ipLimit: 600, windowMs: MIN },
  { name: "payments", methods: WRITE, pattern: /^\/(memberships\/(checkout|me\/renew|me\/auto-renew-attempt)|payments\/.*)$/, ipLimit: 60, subjectLimit: 20, windowMs: MIN },
  // --- member content mutation --------------------------------------------
  { name: "photo-mutation", methods: WRITE, pattern: /^\/profiles\/me\/photos(\/.*)?$/, ipLimit: 90, subjectLimit: 30, windowMs: MIN },
  { name: "profile-mutation", methods: WRITE, pattern: /^\/profiles\/me(\/.*)?$/, ipLimit: 120, subjectLimit: 60, windowMs: MIN },
  { name: "interactions", methods: WRITE, pattern: /^\/interactions\/.*$/, ipLimit: 180, subjectLimit: 60, windowMs: MIN },
  { name: "chat-write", methods: WRITE, pattern: /^\/chats\/.*$/, ipLimit: 300, subjectLimit: 120, windowMs: MIN },
  { name: "reports", methods: ["POST"], pattern: /^\/reports$/, ipLimit: 30, subjectLimit: 10, windowMs: MIN },
  // --- reading other people's data (scraping) -----------------------------
  { name: "profile-read", methods: READ, pattern: /^\/(profiles\/(?!me)[^/]+|search\/profiles|profiles\/me\/recommendations)$/, ipLimit: 240, subjectLimit: 120, windowMs: MIN },
  // --- admin plane --------------------------------------------------------
  { name: "admin-write", methods: WRITE, pattern: /^\/admin\/.*$/, ipLimit: 240, subjectLimit: 90, windowMs: MIN },
  { name: "admin-read", methods: READ, pattern: /^\/admin\/.*$/, ipLimit: 600, subjectLimit: 300, windowMs: MIN },
  // --- catch-alls: nothing under /api/v1 is unthrottled -------------------
  { name: "default-write", methods: WRITE, pattern: /^\/.*$/, ipLimit: 240, subjectLimit: 120, windowMs: MIN },
  { name: "default-read", methods: READ, pattern: /^\/.*$/, ipLimit: 900, subjectLimit: 600, windowMs: MIN },
];

/** Routes that must never be throttled by this policy (probes + cron, which has its own secret). */
const EXEMPT = /^\/(health(\/ready)?|internal\/jobs\/.*)$/;

export function isRateLimitPolicyEnabled(): boolean {
  const env = getEnv();
  if (process.env.RATE_LIMIT_POLICY === "on") return true;
  if (process.env.RATE_LIMIT_POLICY === "off") return false;
  return env.NODE_ENV !== "test";
}

export function matchRateLimitRule(method: string, apiPath: string): Rule | undefined {
  const m = method.toUpperCase();
  return RATE_LIMIT_RULES.find((r) => (r.methods === "*" || r.methods.includes(m)) && r.pattern.test(apiPath));
}

function bearerFingerprint(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  return createHash("sha256").update(match[1]).digest("hex").slice(0, 24);
}

export async function enforceRateLimitPolicy(req: Request): Promise<void> {
  if (!isRateLimitPolicyEnabled()) return;
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/v1")) return;
  const apiPath = url.pathname.slice("/api/v1".length) || "/";
  if (EXEMPT.test(apiPath)) return;
  if (req.method.toUpperCase() === "OPTIONS") return;

  const rule = matchRateLimitRule(req.method, apiPath);
  if (!rule) return;

  const ip = getClientIp(req);
  const ipHit = await hitRateLimit(`pol:${rule.name}:ip:${ip}`, rule.ipLimit, rule.windowMs);
  if (!ipHit.allowed) throw new PolicyRateLimitError(ipHit.retryAfterSeconds);

  const fp = bearerFingerprint(req);
  if (fp && rule.subjectLimit) {
    const subjHit = await hitRateLimit(`pol:${rule.name}:s:${fp}`, rule.subjectLimit, rule.windowMs);
    if (!subjHit.allowed) throw new PolicyRateLimitError(subjHit.retryAfterSeconds);
  }
}
