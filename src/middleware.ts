/**
 * B10: environment-configurable CORS for the versioned API.
 *
 * B1 §8 shipped CORS as a permissive `Access-Control-Allow-Origin: *`
 * static header in `next.config.js`, explicitly documented at the time as
 * "a foundation choice, not a final policy" — no real frontend/Android
 * client origin has ever been fixed in this project (still pre-launch as
 * of B10). This file replaces that static header with a request-aware
 * policy driven by one new env var, `ALLOWED_ORIGINS`:
 *
 *   - Unset or empty (the default — nothing in .env/.env.test sets it):
 *     behaves EXACTLY like the old static `*` header — every origin is
 *     allowed, reflected back verbatim. Nothing breaks today.
 *   - Set to a comma-separated allowlist (e.g.
 *     "https://app.rishteyzindagi.com,https://admin.rishteyzindagi.com"):
 *     only a request whose `Origin` header exactly matches an entry in
 *     that list gets `Access-Control-Allow-Origin` back (reflected, plus
 *     `Vary: Origin` so a shared cache never serves one origin's allowed
 *     response to another) — a non-matching or missing Origin gets no
 *     CORS header at all, which is what makes a cross-origin browser
 *     request fail the CORS check (same-origin calls, server-to-server
 *     calls, and this project's own test suite, which never sets an
 *     Origin header, are completely unaffected either way).
 *
 * This has to be middleware (not `next.config.js`'s static `headers()`)
 * because a static config value cannot vary per request — reflecting
 * "this specific caller's origin, if and only if it's allowed" requires
 * reading the incoming `Origin` header, which only a request-time layer
 * can do. Middleware is also what makes CORS preflight (`OPTIONS`) work
 * correctly: it responds to `OPTIONS` directly with a 204 + the CORS
 * headers, rather than needing every one of the ~90 route files to grow
 * its own `OPTIONS` export.
 *
 * Deliberately reads `process.env.ALLOWED_ORIGINS` directly rather than
 * through `getEnv()` (see src/server/config/env.ts) — Next.js Middleware
 * runs in the Edge runtime by default, ahead of/separately from the
 * Node-oriented request lifecycle the rest of `src/server` assumes, and
 * this is the one narrowly-scoped value this file needs; it does not
 * justify pulling the full server env-validation module (and its
 * Node-runtime assumptions) into the Edge bundle.
 */
import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
// PCP security review: X-Device-Id was missing, so a browser client on an allow-listed
// origin could not send the device id the new-device verification flow depends on
// (the preflight rejected it). Added; nothing is relaxed.
const ALLOWED_HEADERS = "Content-Type,Authorization,X-Device-Id";

/** Non-CORS security headers — unaffected by the origin policy, applied
 * to every API response (kept here, alongside the CORS logic, since this
 * is now the one place every `/api/*` response passes through before the
 * client sees it; see next.config.js's own comment for why these moved
 * out of its static `headers()`). */
function applySecurityHeaders(res: NextResponse): void {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  // Every /api/* response is either authenticated or otherwise
  // per-caller (even the "public" profile view varies by viewer — see
  // profiles.controller.ts's soft-auth doc comment) — never safe for a
  // shared cache/proxy to store and replay to a different caller.
  res.headers.set("Cache-Control", "no-store");
  // HSTS is meaningless (and, if ever misapplied to a caller not actually
  // reachable over HTTPS, actively harmful — it can pin a browser off of
  // plain HTTP for the max-age duration) unless the deployment is truly
  // HTTPS-only. This sandbox and local dev serve plain HTTP, so this only
  // ever fires in NODE_ENV=production, which this project's own
  // convention (see every *.provider.ts's isConfigured()/devMode split)
  // already treats as "a real, HTTPS-fronted deployment".
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}

function parseAllowedOrigins(): string[] | null {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return null; // unset/empty — the "allow every origin" default
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function applyCorsHeaders(res: NextResponse, requestOrigin: string | null): void {
  const allowlist = parseAllowedOrigins();

  if (allowlist === null) {
    // Default (no ALLOWED_ORIGINS configured) — identical behavior to the
    // pre-B10 static `*` header.
    res.headers.set("Access-Control-Allow-Origin", "*");
  } else if (requestOrigin && allowlist.includes(requestOrigin)) {
    res.headers.set("Access-Control-Allow-Origin", requestOrigin);
    res.headers.set("Vary", "Origin");
  }
  // else: no matching origin — no Access-Control-Allow-Origin header at
  // all, so a cross-origin browser request is rejected by the browser's
  // own CORS enforcement. Same-origin and non-browser callers (this
  // project's own test suite included) are never affected by this header
  // either way — CORS is a browser-enforced restriction, not a server
  // one.
  res.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.headers.set("Access-Control-Max-Age", "600");
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    // Preflight — short-circuit before any route handler, matching how a
    // browser's actual CORS preflight expects a bare 204 with just the
    // CORS headers, no body.
    const res = new NextResponse(null, { status: 204 });
    applyCorsHeaders(res, origin);
    return res;
  }

  const res = NextResponse.next();
  applyCorsHeaders(res, origin);
  applySecurityHeaders(res);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
