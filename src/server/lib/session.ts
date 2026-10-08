/**
 * Session/device-session token foundation (B1 §7). A session token is an
 * opaque random value, never a JWT — nothing about who the user is or
 * what they can do is encoded in the token itself, so a leaked
 * AUTH_SECRET can't be used to forge one, and revoking a session is a
 * plain database row update rather than a token-blocklist problem.
 *
 * Only the SHA-256 hash of the token is ever stored (`device_sessions
 * .token_hash`); the raw token is returned to the client exactly once, at
 * login, inside the response body — never logged (see logger.ts's
 * REDACTED_KEYS), never persisted in plaintext anywhere.
 */
import { randomBytes, createHash } from "crypto";
import { getEnv } from "@/server/config/env";

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  // HMAC-style keyed hash (secret as a pepper) rather than a bare SHA-256,
  // so a stolen device_sessions table alone isn't enough to replay a
  // session even if a token were somehow guessable.
  const env = getEnv();
  return createHash("sha256").update(`${env.AUTH_SECRET}:${token}`).digest("hex");
}

export function sessionExpiryDate(): Date {
  const env = getEnv();
  return new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
}
