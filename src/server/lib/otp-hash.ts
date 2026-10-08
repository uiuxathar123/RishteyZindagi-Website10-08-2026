/**
 * Keyed-hash + code-generation helpers for OTP codes and verification
 * tickets — the same "never store the raw secret, only a keyed hash of it"
 * pattern session.ts uses for session tokens.
 *
 * `generateOtpCode` uses `crypto.randomInt`, not `Math.random()`, since the
 * latter is not a cryptographically secure source and OTP codes are a
 * guessing-resistance boundary.
 */
import { createHash, randomInt, randomBytes, timingSafeEqual } from "crypto";
import { getEnv } from "@/server/config/env";

export function generateOtpCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += String(randomInt(0, 10));
  }
  return code;
}

/** Hashes an OTP code, bound to its identifier+purpose so a hash leaked
 * from one row can't be replayed against a different identifier/purpose
 * even if an attacker somehow found a matching plaintext code elsewhere. */
export function hashOtpCode(code: string, identifier: string, purpose: string): string {
  const env = getEnv();
  return createHash("sha256")
    .update(`${env.AUTH_SECRET}:otp:${purpose}:${identifier.trim().toLowerCase()}:${code}`)
    .digest("hex");
}

export function generateVerificationTicket(): string {
  return randomBytes(32).toString("hex");
}

export function hashVerificationTicket(ticket: string): string {
  const env = getEnv();
  return createHash("sha256").update(`${env.AUTH_SECRET}:otp-ticket:${ticket}`).digest("hex");
}

/** Constant-time comparison of two equal-length hex hashes, so verifying an
 * OTP code (or anything else compared as a hash here) doesn't leak timing
 * information about how many leading characters matched. Both inputs are
 * always fixed-length sha256 hex digests in this codebase, so a length
 * mismatch (treated as "not equal") should never legitimately occur. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
