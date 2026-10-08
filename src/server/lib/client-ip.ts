/**
 * Client-IP resolution for rate limiting and audit.
 *
 * `X-Forwarded-For` is a list that every proxy APPENDS to, so the only
 * entries an attacker cannot forge are the ones written by proxies we
 * operate. With `TRUST_PROXY_HOPS = N` (the number of trusted reverse
 * proxies in front of the app) the client IP is the N-th entry from the
 * RIGHT. With the default `0` the header is treated as informational and the
 * left-most entry (what the legacy limiters already used) is returned — that
 * value is attacker-controlled unless the edge overwrites the header, which
 * is why `npm run check:prod-env` warns when TRUST_PROXY_HOPS is unset in
 * production.
 */
import { getEnv } from "@/server/config/env";

export function getClientIp(req: Request): string {
  const hops = getEnv().TRUST_PROXY_HOPS ?? 0;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      if (hops > 0) {
        const idx = parts.length - hops;
        return parts[Math.max(0, idx)];
      }
      return parts[0];
    }
  }
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}
