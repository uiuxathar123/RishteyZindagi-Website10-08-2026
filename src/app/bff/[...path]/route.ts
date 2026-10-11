/**
 * Same-origin session proxy: `/bff/<path>`  →  `/api/v1/<path>`.
 *
 *  - Login-type responses have their `sessionToken` moved out of the JSON
 *    body into an httpOnly cookie (member and admin use DIFFERENT cookies).
 *  - Every other request gets `Authorization: Bearer <cookie>` attached
 *    server-side. The browser never sees, stores or sends a raw token.
 *  - Member and admin are kept strictly apart: `/bff/admin/*` and
 *    `/bff/as-admin/*` only ever use the admin cookie; everything else only
 *    the member cookie.
 *  - Non-GET requests are CSRF-checked (Origin / Sec-Fetch-Site).
 *  - Status codes, bodies and binary responses (photos, PDFs) are relayed
 *    unchanged — all validation, authorization and rate limiting still
 *    happen in the real backend handlers.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  DEVICE_COOKIE,
  MEMBER_COOKIE,
  PUBLIC_AUTH_PATHS,
  internalApiOrigin,
  isProduction,
} from "@/lib/bff/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_SEGMENT = /^[A-Za-z0-9._~@-]+$/;
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "user-agent", "x-forwarded-for", "x-real-ip"];
const RELAYED_RESPONSE_HEADERS = ["content-type", "content-disposition", "content-length", "content-language", "x-accel-buffering"];
// Relayed on every response, JSON included, so clients can honour rate-limit back-off.
const RELAYED_ALWAYS = ["retry-after"];

function fail(status: number, code: string, message: string) {
  const res = NextResponse.json({ success: false, error: { code, message } }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Cross-site request forgery guard for state-changing methods. Browsers
 * always attach Origin (and Sec-Fetch-Site) to cross-site POST/PATCH/DELETE;
 * non-browser clients carry no cookies, so there is nothing to forge. */
function sameOriginOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  return true;
}

function cookieOptions(maxAgeSeconds: number, admin: boolean) {
  return {
    httpOnly: true,
    secure: isProduction(),
    // Admin sessions never need to survive a cross-site navigation.
    sameSite: (admin ? "strict" : "lax") as "strict" | "lax",
    path: "/",
    maxAge: Math.max(60, Math.floor(maxAgeSeconds)),
  };
}

async function handle(req: NextRequest, { params }: { params: { path: string[] } }) {
  const method = req.method.toUpperCase();
  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) {
    return fail(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  }
  if (method !== "GET" && !sameOriginOk(req)) {
    return fail(403, "AUTHORIZATION_ERROR", "Cross-site request rejected.");
  }

  const segments = params.path ?? [];
  if (segments.length === 0 || segments.some((s) => !SAFE_SEGMENT.test(s) || s === "." || s === "..")) {
    return fail(400, "VALIDATION_ERROR", "Invalid path.");
  }

  // --- routing: which identity, which upstream path --------------------
  let asAdmin = false;
  let upstreamSegments = segments;
  if (segments[0] === "admin") {
    asAdmin = true;
    if (segments.length === 2 && segments[1] === "logout") upstreamSegments = ["auth", "logout"];
  } else if (segments[0] === "as-admin") {
    asAdmin = true;
    upstreamSegments = segments.slice(1);
    if (upstreamSegments.length === 0) return fail(400, "VALIDATION_ERROR", "Invalid path.");
  }
  const upstreamKey = upstreamSegments.join("/");
  const isLogout = upstreamKey === "auth/logout" || upstreamKey === "auth/logout-all";
  const isPublicAuth = PUBLIC_AUTH_PATHS.has(segments.join("/"));
  const cookieName = asAdmin ? ADMIN_COOKIE : MEMBER_COOKIE;

  // --- build the upstream request --------------------------------------
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  const existingDevice = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice && /^[0-9a-f-]{36}$/i.test(existingDevice) ? existingDevice : crypto.randomUUID();
  headers.set("x-device-id", deviceId);

  const token = req.cookies.get(cookieName)?.value;
  const attachedToken = !isPublicAuth && !!token;
  if (attachedToken) headers.set("authorization", `Bearer ${token}`);

  const url = new URL(req.url);
  const upstreamUrl =
    `${internalApiOrigin(req.url)}/api/v1/${upstreamSegments.map(encodeURIComponent).join("/")}` + url.search;

  let body: ArrayBuffer | undefined;
  if (method !== "GET") body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { method, headers, body, redirect: "manual", cache: "no-store" });
  } catch {
    return fail(503, "SERVICE_UNAVAILABLE", "The service is temporarily unreachable.");
  }

  // --- relay the response ----------------------------------------------
  const contentType = upstream.headers.get("content-type") ?? "";
  let res: NextResponse;

  if (contentType.includes("application/json")) {
    const text = await upstream.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* leave as raw text */
    }

    const data = (payload as { data?: Record<string, unknown> } | null)?.data;
    const issuedToken = data && typeof data.sessionToken === "string" ? (data.sessionToken as string) : null;

    if (upstream.ok && issuedToken && data) {
      const expiresAt = typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
      const ttl = Number.isFinite(expiresAt) ? (expiresAt - Date.now()) / 1000 : 30 * 24 * 3600;
      delete data.sessionToken; // the browser must never receive it
      res = NextResponse.json(payload, { status: upstream.status });
      res.cookies.set(cookieName, issuedToken, cookieOptions(ttl, asAdmin));
    } else {
      res =
        payload === null
          ? new NextResponse(text, { status: upstream.status, headers: { "content-type": contentType } })
          : NextResponse.json(payload, { status: upstream.status });
    }
  } else {
    // Binary / other: stream straight through (photos, invoice PDFs).
    res = new NextResponse(upstream.body, { status: upstream.status });
    for (const name of RELAYED_RESPONSE_HEADERS) {
      const v = upstream.headers.get(name);
      if (v) res.headers.set(name, v);
    }
  }

  for (const name of RELAYED_ALWAYS) {
    const v = upstream.headers.get(name);
    if (v) res.headers.set(name, v);
  }

  // Session end: explicit logout, or the backend said the session is invalid.
  if ((isLogout && upstream.ok) || (attachedToken && upstream.status === 401)) {
    res.cookies.set(cookieName, "", { ...cookieOptions(60, asAdmin), maxAge: 0 });
  }

  if (!existingDevice || existingDevice !== deviceId) {
    res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
      maxAge: 400 * 24 * 3600,
    });
  }

  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
