/**
 * B4: shapes a partner_preferences row into the response the owner sees.
 * Preferences are private to their owner (§3: "A normal USER can only
 * create/read/update their own preferences") — there is no second,
 * narrower audience view the way profiles has owner/authenticated/
 * anonymous, so this file only has the one mapper.
 */
import type { PartnerPreferenceRow } from "./preferences.repository";
import type { LookupRow } from "@/server/modules/profiles/reference.repository";

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export interface PartnerPreferenceView {
  id: string;
  profileId: string;
  ageMin: number | null;
  ageMax: number | null;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  genderPreference: string | null;
  religion: LookupRow | null;
  maritalStatusIds: string[];
  communityIds: string[];
  motherTongueIds: string[];
  educationIds: string[];
  professionIds: string[];
  professionAny: boolean;
  countryIds: string[];
  cityIds: string[];
  incomeMinAmount: number | null;
  incomeMaxAmount: number | null;
  incomeCurrency: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `null` when the profile has never set any preferences yet — B4 §7:
 * "If a preference has not been configured: Return a clear empty/default
 * state," never a set of invented restrictive defaults. */
export function toPartnerPreferenceView(row: PartnerPreferenceRow | undefined, religion: LookupRow | null): PartnerPreferenceView | null {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profileId,
    ageMin: row.ageMin,
    ageMax: row.ageMax,
    heightMinCm: row.heightMinCm,
    heightMaxCm: row.heightMaxCm,
    genderPreference: row.genderPreference,
    religion,
    maritalStatusIds: asIdArray(row.maritalStatusIds),
    communityIds: asIdArray(row.communityIds),
    motherTongueIds: asIdArray(row.motherTongueIds),
    educationIds: asIdArray(row.educationIds),
    professionIds: asIdArray(row.professionIds),
    professionAny: row.professionAny,
    countryIds: asIdArray(row.countryIds),
    cityIds: asIdArray(row.cityIds),
    incomeMinAmount: row.incomeMinAmount,
    incomeMaxAmount: row.incomeMaxAmount,
    incomeCurrency: row.incomeCurrency,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
