/**
 * The single place the browser talks to the backend.
 *
 *  - All calls go to the same-origin session proxy (`/bff/*`), which holds
 *    the httpOnly session cookie and forwards to `/api/v1/*`. This client
 *    never sees, stores or sends a session token.
 *  - Unwraps the backend's `{ success, data, message }` envelope and turns
 *    every failure into a typed `ApiError` (network failures and aborts
 *    included).
 *  - A 401 on a signed-in call notifies the registered handler once so the
 *    app can send the person to the right login screen.
 */
import { ApiError, kindFromStatus, type ApiFieldIssue } from "./errors";

export type Query = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

/** Which identity a client speaks as. */
export type Realm = "member" | "admin";


export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

type UnauthorizedHandler = (realm: Realm) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  unauthorizedHandler = fn;
}

/** Auth-entry calls legitimately 401 (wrong password, wrong code) — those
 * must show an inline message, not trigger a redirect. */
const NO_REDIRECT_ON_401 = /^\/(auth\/(login|verify-|request-login-otp|set-password|register|resend-otp|forgot-password|reset-password|recover-account\/)|login)/;

function parseErrorBody(payload: unknown, status: number): ApiError {
  const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  const details: ApiFieldIssue[] = Array.isArray(err?.details)
    ? (err!.details as Array<{ path?: unknown; message?: unknown }>).map((d) => ({
        path: String(d?.path ?? ""),
        message: String(d?.message ?? ""),
      }))
    : [];
  return new ApiError({
    status,
    code: err?.code ?? `HTTP_${status}`,
    message: err?.message ?? `Request failed (${status}).`,
    kind: kindFromStatus(status),
    details,
  });
}

async function request<T>(realm: Realm, prefix: string, method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${prefix}${path}${buildQuery(opts.query)}`;
  const init: RequestInit = { method, credentials: "same-origin", signal: opts.signal, headers: { Accept: "application/json" } };

  if (opts.formData) {
    init.body = opts.formData; // the browser sets the multipart boundary itself
  } else if (opts.body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      throw new ApiError({ status: 0, code: "ABORTED", message: "Request cancelled.", kind: "aborted" });
    }
    throw new ApiError({ status: 0, code: "NETWORK_ERROR", message: "Network error.", kind: "network" });
  }

  let payload: unknown = null;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }

  if (!res.ok || (payload && (payload as { success?: boolean }).success === false)) {
    const error = parseErrorBody(payload, res.status);
    if (error.kind === "unauthorized" && !NO_REDIRECT_ON_401.test(path)) unauthorizedHandler?.(realm);
    throw error;
  }

  return ((payload as { data?: T } | null)?.data ?? (null as unknown)) as T;
}

function makeClient(realm: Realm, prefix: string) {
  return {
    get: <T>(path: string, opts?: Omit<RequestOptions, "body" | "formData">) => request<T>(realm, prefix, "GET", path, opts),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) =>
      request<T>(realm, prefix, "POST", path, { ...opts, body: body ?? {} }),
    put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) =>
      request<T>(realm, prefix, "PUT", path, { ...opts, body: body ?? {} }),
    patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) =>
      request<T>(realm, prefix, "PATCH", path, { ...opts, body: body ?? {} }),
    delete: <T>(path: string, opts?: Omit<RequestOptions, "body" | "formData">) => request<T>(realm, prefix, "DELETE", path, opts),
    upload: <T>(path: string, formData: FormData, opts?: Omit<RequestOptions, "body" | "formData">) =>
      request<T>(realm, prefix, "POST", path, { ...opts, formData }),
    /** URL (not data) for use in <img src> / <a href>: the browser attaches the cookie itself. */
    url: (path: string, query?: Query) => `${prefix}${path}${buildQuery(query)}`,
  };
}

/** Member-facing API (everything under /api/v1 except admin routes). */
export const api = makeClient("member", "/bff");
/** Admin API: paths are relative to /api/v1/admin, e.g. `adminApi.get("/users")`. */
export const adminApi = makeClient("admin", "/bff/admin");
/** Non-admin endpoints an admin is allowed to call with the ADMIN session
 * (viewing a profile, loading photo files). Paths are relative to /api/v1. */
export const asAdminApi = makeClient("admin", "/bff/as-admin");
