/**
 * B8: renders a UTC instant into a member's own timezone for invoice
 * DISPLAY only — the stored `issuedAt` column itself is always UTC (the
 * frozen `timestamp(..., { withTimezone: true })` convention every other
 * table already uses); nothing about how it's stored changes here.
 *
 * Timezone-by-country mapping reuses the exact ISO codes seed.ts's
 * COUNTRIES array already seeds (see region.ts, which resolves a user's
 * ISO code the same way) — no new dependency, Node's built-in
 * `Intl.DateTimeFormat` does the actual rendering.
 */
const COUNTRY_TIMEZONE: Record<string, string> = {
  IN: "Asia/Kolkata",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
};
export const DEFAULT_INVOICE_TIMEZONE = "UTC";

export function timezoneForCountry(isoCode: string | null): string {
  return (isoCode && COUNTRY_TIMEZONE[isoCode]) || DEFAULT_INVOICE_TIMEZONE;
}

/** Human-readable "issued at" string in the given IANA timezone, e.g.
 * "24 Sep 2026, 21:30:05 IST" — used only for the PDF's own printed
 * text, never parsed back or stored. */
export function formatInvoiceTimestamp(at: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  return formatter.format(at);
}
