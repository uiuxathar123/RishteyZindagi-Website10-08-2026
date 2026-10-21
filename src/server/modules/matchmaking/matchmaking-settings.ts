/**
 * Personal Matchmaking service configuration, stored in `platform_settings` under `personal_matchmaking`.
 * Everything a purchase is charged and granted comes from here (server-side), never from the client:
 *   - enabled: whether the service can be bought at all;
 *   - prices: per currency, in the smallest unit (paise / cents); a currency without a price cannot buy;
 *   - includedMembershipDays: how long the included member access (interests and chat) lasts after a verified payment.
 * Only a Super Admin may read the full setting or change it (matchmaking-admin.service.ts).
 */
import { z } from "zod";
import * as settingsRepo from "@/server/modules/platform-settings/platform-settings.repository";

export const PERSONAL_MATCHMAKING_KEY = "personal_matchmaking";
export const MATCHMAKING_CURRENCIES = ["INR", "USD"] as const;
export type MatchmakingCurrency = (typeof MATCHMAKING_CURRENCIES)[number];

/** Bump when the consent wording shown to the customer changes; a checkout must echo the current version. */
export const MATCHMAKING_CONSENT_VERSION = "2026-10-18";
export const MATCHMAKING_CONSENT_TEXT =
  "I ask RishteyZindagi's matchmaking team to review my profile and partner preferences and to share hand-picked profile suggestions with me. " +
  "Suggestions are introductions only: contacting someone still needs mutual interest, and nothing is shared with other members on my behalf.";

export interface PersonalMatchmakingSettings {
  enabled: boolean;
  prices: Record<MatchmakingCurrency, number | null>;
  includedMembershipDays: number;
}

export const PERSONAL_MATCHMAKING_DEFAULT: PersonalMatchmakingSettings = {
  enabled: false,
  prices: { INR: null, USD: null },
  includedMembershipDays: 30,
};

const price = z.number().int().positive().max(100_000_000).nullable();
export const personalMatchmakingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    prices: z.object({ INR: price, USD: price }).strict(),
    includedMembershipDays: z.number().int().min(0).max(3650),
  })
  .strict();

export async function getMatchmakingSettings(): Promise<PersonalMatchmakingSettings> {
  const row = await settingsRepo.get(PERSONAL_MATCHMAKING_KEY);
  if (!row) return structuredClone(PERSONAL_MATCHMAKING_DEFAULT);
  const parsed = personalMatchmakingSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : structuredClone(PERSONAL_MATCHMAKING_DEFAULT);
}

export async function saveMatchmakingSettings(value: PersonalMatchmakingSettings, adminId: string): Promise<PersonalMatchmakingSettings> {
  const parsed = personalMatchmakingSettingsSchema.parse(value);
  await settingsRepo.upsert(PERSONAL_MATCHMAKING_KEY, parsed, adminId);
  return parsed;
}

/** The price a member in `currency` would pay right now, or null when the service is not on sale for them. */
export function offerFor(settings: PersonalMatchmakingSettings, currency: string): { priceInPaise: number; currency: MatchmakingCurrency } | null {
  if (!settings.enabled) return null;
  if (!(MATCHMAKING_CURRENCIES as readonly string[]).includes(currency)) return null;
  const amount = settings.prices[currency as MatchmakingCurrency];
  return amount ? { priceInPaise: amount, currency: currency as MatchmakingCurrency } : null;
}
