/**
 * `?next=` is attacker-controllable, so only same-origin relative paths are
 * ever followed after login. Anything else (absolute URLs, protocol-relative
 * `//evil.com`, backslash tricks, control characters) falls back.
 */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  // Never bounce back into the auth screens themselves.
  if (/^\/(login|signup|forgot-password)(\/|\?|$)/.test(value)) return fallback;
  return value;
}
