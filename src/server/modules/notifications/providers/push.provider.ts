/**
 * Push notification provider — Firebase Cloud Messaging HTTP v1.
 *
 *   1. OAuth2 service-account flow: sign a JWT (RS256) {iss: FCM_CLIENT_EMAIL,
 *      scope: https://www.googleapis.com/auth/firebase.messaging, aud: token URL,
 *      iat, exp = iat+3600} with FCM_PRIVATE_KEY and POST it to
 *      https://oauth2.googleapis.com/token (grant_type=
 *      urn:ietf:params:oauth:grant-type:jwt-bearer) → access_token (cached until
 *      shortly before expiry).
 *   2. POST https://fcm.googleapis.com/v1/projects/{FCM_PROJECT_ID}/messages:send
 *      with Bearer access_token and { message: { token, notification: {title, body} } }.
 *   3. A 404 / UNREGISTERED answer means the device token is dead → that token is
 *      revoked in `device_push_tokens` so it is not retried.
 *
 * Env: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (PEM, "\n" escapes allowed).
 * Tokens/keys are never logged. Valid Firebase credentials are an external
 * prerequisite (REQUIRES EXTERNAL CREDENTIALS).
 */
import { createSign } from "crypto";
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { httpRequest, pick, resolveBase } from "@/server/modules/payments/providers/http";
import * as pushTokens from "@/server/modules/devices/push-tokens.repository";
import type { NotificationProvider, NotificationSendParams } from "./types";

const DEFAULT_API = "https://fcm.googleapis.com";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let tokenCache: { value: string; expiresAt: number; key: string } | null = null;
export function __clearFcmTokenCacheForTests() {
  tokenCache = null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function signJwt(clientEmail: string, privateKey: string, audience: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: audience, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(privateKey).toString("base64url")}`;
}

export class PushNotificationProvider implements NotificationProvider {
  readonly channel = "PUSH" as const;

  missingSettings(): string[] {
    const env = getEnv();
    const m: string[] = [];
    if (!env.FCM_PROJECT_ID) m.push("FCM_PROJECT_ID");
    if (!env.FCM_CLIENT_EMAIL) m.push("FCM_CLIENT_EMAIL");
    if (!env.FCM_PRIVATE_KEY) m.push("FCM_PRIVATE_KEY");
    return m;
  }

  isConfigured(): boolean {
    return this.missingSettings().length === 0;
  }

  private async accessToken(): Promise<string> {
    const env = getEnv();
    const cacheKey = `${env.FCM_CLIENT_EMAIL}`;
    if (tokenCache && tokenCache.key === cacheKey && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.value;
    const tokenUrl = env.NODE_ENV !== "production" && env.FCM_TOKEN_URL ? env.FCM_TOKEN_URL : DEFAULT_TOKEN_URL;
    let assertion: string;
    try {
      assertion = signJwt(env.FCM_CLIENT_EMAIL as string, (env.FCM_PRIVATE_KEY as string).replace(/\\n/g, "\n"), tokenUrl);
    } catch {
      throw new ServiceUnavailableError("FCM_PRIVATE_KEY is not a valid PEM private key.");
    }
    const res = await httpRequest("Google OAuth", tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      timeoutMs: 10_000,
    });
    const token = pick(res.json, "access_token");
    if (res.status !== 200 || typeof token !== "string") {
      logError("fcm-auth-failed", new Error(`Google OAuth answered HTTP ${res.status}`), { httpStatus: res.status });
      throw new ServiceUnavailableError("Push delivery could not authenticate with Firebase.");
    }
    const ttl = Number(pick(res.json, "expires_in")) || 3600;
    tokenCache = { value: token, expiresAt: Date.now() + ttl * 1000, key: cacheKey };
    return token;
  }

  async send(params: NotificationSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(`Push notification delivery is not configured. Set ${this.missingSettings().join(", ")}.`);
    }
    const env = getEnv();
    const access = await this.accessToken();
    const url = `${resolveBase(env.FCM_API_BASE, DEFAULT_API)}/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID as string)}/messages:send`;
    const res = await httpRequest("Firebase Cloud Messaging", url, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: params.to, notification: { title: params.title.slice(0, 120), body: params.body.slice(0, 500) } } }),
      timeoutMs: 10_000,
    });
    if (res.status >= 200 && res.status < 300) return;

    const status = String(pick(res.json, "error", "status") ?? "");
    if (res.status === 404 || status === "NOT_FOUND" || status === "UNREGISTERED") {
      // Dead device token: stop using it.
      try {
        const row = await pushTokens.findByToken(params.to);
        if (row) await pushTokens.markRevoked(row.id);
      } catch {
        /* best effort */
      }
      throw new ServiceUnavailableError("The device token is no longer valid.");
    }
    if (res.status === 401) tokenCache = null;
    logError("fcm-send-failed", new Error(`FCM answered HTTP ${res.status}`), { httpStatus: res.status });
    throw new ServiceUnavailableError("The push notification could not be delivered.");
  }
}
