/**
 * B8: tax-rate configuration for invoice generation.
 *
 * Ground rule (see the master B8 brief's §0): never invent a real-world
 * tax rate/law as if it were fact. `GST_RATE_PERCENT` (env.ts, default
 * 18) is a clearly-labeled, round PLACEHOLDER value — not researched,
 * not asserted as legally authoritative for this business, and
 * overridable by an operator with real business/legal input via env
 * alone, no code change or redeploy required.
 *
 * Non-INR currencies: 0% — documented judgment call, no researched basis
 * exists in this project for what (if anything) a non-Indian tax
 * authority would require, so this backend charges nothing rather than
 * fabricate a second placeholder rate for a jurisdiction nobody
 * specified.
 *
 * CGST/SGST/IGST split — NOT attempted (a documented deviation from the
 * literal invoice line-item list, explained plainly): splitting GST into
 * CGST+SGST (intra-state) vs IGST (inter-state) requires knowing whether
 * the buyer and the seller (this business) are registered in the same
 * Indian state — a fact this system has never captured anywhere (no
 * seller-state config exists, and a buyer's profile city/country is not
 * the same thing as their GST registration state). Guessing that split
 * would itself be exactly the kind of fabricated tax-law assumption
 * this brief forbids, so INR invoices show one combined "GST" line at
 * the configured rate instead of three fabricated sub-lines.
 */
import { getEnv } from "@/server/config/env";

export function getTaxRatePercent(currency: string): number {
  if (currency !== "INR") return 0;
  return getEnv().GST_RATE_PERCENT;
}

export function computeTax(amountInSmallestUnit: number, currency: string): { taxRatePercent: number; taxAmountInSmallestUnit: number } {
  const taxRatePercent = getTaxRatePercent(currency);
  const taxAmountInSmallestUnit = Math.round((amountInSmallestUnit * taxRatePercent) / 100);
  return { taxRatePercent, taxAmountInSmallestUnit };
}
