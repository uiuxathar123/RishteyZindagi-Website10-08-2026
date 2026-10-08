/**
 * B8: resolves a member's region — currency for checkout, IANA timezone
 * for invoice display — from real account data.
 *
 * Judgment call (documented again in BACKEND.md's B8 section): the task
 * brief points at `users.country`/`users.city` as the source, but a
 * direct inspection (re-verified while writing this file) found those
 * two columns are dead — B1 schema-only scaffolding that no B1-B7 write
 * path has EVER populated (grep confirms: no `.set({ country: ... })`
 * or `.values({ country: ... })` call exists anywhere in `src/server`).
 * The real, actually-populated source of a member's country is
 * `profiles.countryId -> countries.isoCode` (set by B3's own profile
 * PATCH flow, and the same field B4/B5 already treat as the country of
 * record for search/matching). Using the dead `users.country` column
 * would make every single user resolve to the "no country on file"
 * default, which is not an honest reading of "use the user's country" —
 * so this file reads the real column instead.
 *
 * Currency judgment call: India (IN) -> INR; UAE/Saudi Arabia/Qatar/
 * Kuwait (AE/SA/QA/KW — the exact four the brief names, reusing the
 * exact ISO codes seed.ts's COUNTRIES array already seeds) -> USD; no
 * profile, no countryId set, or any other country -> INR (the
 * documented default — this platform's primary market is India, so INR
 * is the safer default for "unknown/unset" over USD).
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { profiles, countries } from "@/server/db/schema";

export type SupportedCurrency = "INR" | "USD";

/** Exactly the four Gulf ISO codes the brief names — deliberately not
 * "every Gulf country" (Oman/Bahrain are also seeded in countries.ts but
 * were never named for USD pricing), so this stays a data-driven mapping
 * off the brief's own explicit list rather than an inferred generalization. */
const USD_ISO_CODES = new Set(["AE", "SA", "QA", "KW"]);

/** IANA timezone per ISO country code, for invoice display only (see
 * invoice-pdf.ts) — `issuedAt` itself is always stored as UTC (schema.ts's
 * usual withTimezone:true timestamp convention), never converted at rest. */
const COUNTRY_TIMEZONE: Record<string, string> = {
  IN: "Asia/Kolkata",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
};
const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_CURRENCY: SupportedCurrency = "INR";

export interface UserRegion {
  isoCode: string | null;
  currency: SupportedCurrency;
  timezone: string;
}

/** Never throws — a user with no profile yet, or a profile with no
 * country set, resolves to the documented default region rather than
 * blocking checkout on an unrelated onboarding gap. */
export async function resolveUserRegion(userId: string): Promise<UserRegion> {
  const [row] = await db
    .select({ isoCode: countries.isoCode })
    .from(profiles)
    .innerJoin(countries, eq(profiles.countryId, countries.id))
    .where(eq(profiles.userId, userId))
    .limit(1);

  const isoCode = row?.isoCode ?? null;
  const currency: SupportedCurrency = isoCode && USD_ISO_CODES.has(isoCode) ? "USD" : DEFAULT_CURRENCY;
  const timezone = (isoCode && COUNTRY_TIMEZONE[isoCode]) || DEFAULT_TIMEZONE;
  return { isoCode, currency, timezone };
}
