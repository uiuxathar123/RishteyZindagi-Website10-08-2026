/**
 * Rate-limit FOUNDATION (B1 §8 asks for the foundation only — full OTP
 * rate limiting is explicit B2 scope). This is an in-memory fixed-window
 * counter, intentionally simple:
 *
 *   - Correct and sufficient for a single Node process (this sandbox, or
 *     a single-instance deployment).
 *   - NOT correct across multiple server instances/processes, since each
 *     would keep its own counters — a real production deployment behind a
 *     load balancer needs a shared store (Redis is the standard choice)
 *     before this can be trusted as an actual defense. That swap is a
 *     same-interface change (`checkRateLimit`'s signature doesn't need to
 *     change), not a redesign.
 */
import { RateLimitError } from "@/server/lib/errors";

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  if (existing.count >= limit) {
    throw new RateLimitError();
  }

  existing.count += 1;
}

/** Test-only: clears all counters between test cases. */
export function __resetRateLimitsForTests() {
  buckets.clear();
}
