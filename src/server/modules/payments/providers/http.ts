/**
 * PCP: the one HTTP helper every real payment/notification adapter uses.
 *
 *  - hard timeout (AbortController) — a hung gateway can never hang a request;
 *  - never logs or returns request headers/bodies (they hold secrets);
 *  - errors carry only a provider label and an HTTP status, never a URL query,
 *    header, or response body;
 *  - base-URL overrides (used ONLY to point tests at a local mock server) are
 *    ignored when NODE_ENV=production, so a production deployment cannot be
 *    redirected to another host through configuration.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";

export interface HttpResult {
  status: number;
  /** Parsed JSON body, or null when the body was empty / not JSON. */
  json: unknown;
}

export function resolveBase(override: string | undefined, defaultBase: string): string {
  const base = getEnv().NODE_ENV !== "production" && override && override.trim() ? override.trim() : defaultBase;
  return base.replace(/\/+$/, "");
}

export async function httpRequest(
  label: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, json };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new ServiceUnavailableError(aborted ? `${label} did not respond in time.` : `${label} could not be reached.`);
  } finally {
    clearTimeout(timer);
  }
}

/** Safe string accessor for untyped gateway JSON. */
export function pick(json: unknown, ...path: Array<string | number>): unknown {
  let cur: unknown = json;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}
