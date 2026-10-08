/**
 * Shared constants + helpers for the same-origin session proxy (`/bff/*`).
 *
 * WHY THIS EXISTS (B16): the backend authenticates with
 * `Authorization: Bearer <sessionToken>` only — it never reads cookies.
 * Keeping that token in `localStorage` would hand it to any injected
 * script, so the browser never receives it at all: the proxy stores it in
 * an httpOnly cookie and attaches it server-side. The backend is
 * untouched and remains the sole authority on who may do what.
 */

/** Member session. Never sent to admin endpoints. */
export const MEMBER_COOKIE = "rz_session";
/** Admin session. Never sent to member endpoints. */
export const ADMIN_COOKIE = "rz_admin_session";
/** Non-secret random device id the backend's new-device verification keys on. */
export const DEVICE_COOKIE = "rz_device_id";

/** Auth-entry endpoints: called while signed out (or to START a session), so
 * no stored session is attached to them. */
export const PUBLIC_AUTH_PATHS = new Set([
  "auth/register",
  "auth/verify-signup-otp",
  "auth/set-password",
  "auth/resend-otp",
  "auth/login",
  "auth/verify-device",
  "auth/request-login-otp",
  "auth/verify-login-otp",
  "auth/forgot-password",
  "auth/reset-password",
  // PCP: a pending-deletion account has no session, so recovery runs signed out.
  "auth/recover-account/request",
  "auth/recover-account/confirm",
  "admin/login",
]);

/** Where the proxy forwards to. Defaults to this same server on loopback so
 * a request never leaves the machine; set `INTERNAL_API_ORIGIN` when the app
 * listens somewhere else (e.g. behind a container network). */
export function internalApiOrigin(requestUrl: string): string {
  const configured = process.env.INTERNAL_API_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = new URL(requestUrl).port || process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

export const isProduction = () => process.env.NODE_ENV === "production";

/** True when the backend's dev-only OTP reveal may exist at all. */
export const devToolsAllowedByEnv = () => !isProduction();
