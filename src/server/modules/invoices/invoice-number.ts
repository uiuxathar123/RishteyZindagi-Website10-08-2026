/**
 * B8: invoice number generation — `RZ-YYYYMMDD-HHMMSS-mmm` (milliseconds
 * included specifically to make same-second collisions vanishingly
 * unlikely, though never assumed impossible — see invoices.repository
 * .ts's `insertWithUniqueNumber` for the honest retry-on-conflict loop
 * this format's own uniqueness is NOT relied upon alone to guarantee).
 * All components in UTC — this is an INTERNAL identifier, not the
 * invoice's user-visible DISPLAYED date/time (see timezone.ts for that).
 */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function generateInvoiceNumber(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1, 2);
  const d = pad(now.getUTCDate(), 2);
  const hh = pad(now.getUTCHours(), 2);
  const mm = pad(now.getUTCMinutes(), 2);
  const ss = pad(now.getUTCSeconds(), 2);
  const ms = pad(now.getUTCMilliseconds(), 3);
  return `RZ-${y}${m}${d}-${hh}${mm}${ss}-${ms}`;
}

/** The exact format `generateInvoiceNumber` produces — used by tests
 * (and available for any future validation need) rather than duplicating
 * the pattern inline. */
export const INVOICE_NUMBER_PATTERN = /^RZ-\d{8}-\d{6}-\d{3}$/;
