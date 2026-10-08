/**
 * Minimal real-HTTP smoke-test toolkit (no test framework): a cookie-jar client that talks to a
 * RUNNING server over TCP exactly like a browser would (same-origin Origin header, httpOnly
 * cookies kept in a jar), plus PASS/FAIL accounting. Nothing here imports application code.
 */
export const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";

let seq = 0;
export class Client {
  jar: Record<string, string> = {};
  lastSetCookie: string[] = [];
  /** one distinct "client IP" per Client, delivered as a single X-Forwarded-For entry (TRUST_PROXY_HOPS=1) */
  ip = `10.88.${Math.floor(Math.random() * 200)}.${++seq + 1}`;
  constructor(public name: string) {}

  cookieHeader() {
    return Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async req(method: string, path: string, body?: unknown, extra: { headers?: Record<string, string>; raw?: boolean; noOrigin?: boolean } = {}) {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...(extra.noOrigin ? {} : { Origin: BASE }), ...(extra.headers ?? {}) };
    const c = this.cookieHeader();
    if (c) headers.cookie = c;
    let payload: BodyInit | undefined;
    if (extra.raw && typeof body === "string") payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual" });
    const setc = res.headers.getSetCookie();
    this.lastSetCookie = setc;
    for (const sc of setc) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/max-age=0|expires=Thu, 01 Jan 1970/i.test(sc) || v === "") delete this.jar[k];
      else this.jar[k] = v;
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    seenBodies.push(text);
    return { status: res.status, json, text, headers: res.headers, data: json?.data, err: json?.error };
  }
  get(p: string, e?: Parameters<Client["req"]>[3]) {
    return this.req("GET", p, undefined, e);
  }
  post(p: string, b: unknown = {}, e?: Parameters<Client["req"]>[3]) {
    return this.req("POST", p, b, e);
  }
  put(p: string, b: unknown = {}, e?: Parameters<Client["req"]>[3]) {
    return this.req("PUT", p, b, e);
  }
  patch(p: string, b: unknown = {}, e?: Parameters<Client["req"]>[3]) {
    return this.req("PATCH", p, b, e);
  }
}

/** every response body seen by any Client, so the run can finish with "no secret ever appeared" */
export const seenBodies: string[] = [];

export const results: Array<{ name: string; ok: boolean; detail: string }> = [];
export function check(name: string, cond: unknown, detail = "") {
  const ok = Boolean(cond);
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
  return ok;
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function finish(label: string): never {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${label}: ${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

/**
 * Fails the run if any value in `secrets` appears in any response body seen so far, or if a `oneTime` value (a temporary
 * password the API hands out exactly once) appears in more than the single response that created it.
 */
export function assertNoSecretsSeen(secrets: string[], oneTime: string[] = []) {
  const leaked = secrets.filter((s) => s && seenBodies.some((b) => b.includes(s)));
  check(`no secret value appeared in any of ${seenBodies.length} HTTP responses`, leaked.length === 0, leaked.map((s) => `${s.slice(0, 4)}…`).join(","));
  if (oneTime.length) {
    const repeated = oneTime.filter((s) => s && seenBodies.filter((b) => b.includes(s)).length > 1);
    check(`${oneTime.length} one-time temporary passwords each appeared in exactly one response (the one that issued it)`, repeated.length === 0, repeated.map((s) => `${s.slice(0, 2)}…`).join(","));
  }
}

export function cookieAttrs(setCookies: string[], name: string): string {
  return setCookies.find((c) => c.startsWith(`${name}=`)) ?? "";
}
