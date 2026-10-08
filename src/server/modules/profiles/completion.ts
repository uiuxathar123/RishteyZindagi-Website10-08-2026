/**
 * B3 §8: deterministic, backend-only profile completion. Pure functions —
 * no DB access here — so the exact same logic drives both the persisted
 * profileCompletionPercent/profileStatus columns (kept in sync by
 * profiles.service.ts's recomputeProfileState, called after every
 * mutation that can affect them) and any on-demand recomputation a GET
 * response wants to do for freshness. The backend is the sole authority;
 * nothing here ever trusts a client-supplied percentage.
 */
import type { ProfileRow } from "./profiles.repository";

export type ProfileStatus = "INCOMPLETE" | "COMPLETE" | "READY_FOR_VISIBILITY";

/** The required-field checklist from the B3 brief §8, in display order.
 * `age`/`photo` aren't real profiles columns — age is derived from
 * dateOfBirth (always present once a profile row exists, so it's not a
 * meaningful gate) and photo readiness is checked separately via the
 * live photo count, not a profiles column, since it can change without a
 * profile update touching this row at all. */
export const REQUIRED_PROFILE_FIELDS: Array<{ key: string; label: string; present: (p: ProfileRow) => boolean }> = [
  { key: "gender", label: "Gender", present: (p) => !!p.gender },
  { key: "dateOfBirth", label: "Date of birth", present: (p) => !!p.dateOfBirth },
  { key: "countryId", label: "Country", present: (p) => !!p.countryId },
  { key: "cityId", label: "City", present: (p) => !!p.cityId },
  { key: "maritalStatusId", label: "Marital status", present: (p) => !!p.maritalStatusId },
  { key: "religionId", label: "Religion", present: (p) => !!p.religionId },
  { key: "communityId", label: "Community / Caste", present: (p) => !!p.communityId },
  { key: "motherTongueId", label: "Mother tongue", present: (p) => !!p.motherTongueId },
  { key: "educationId", label: "Education", present: (p) => !!p.educationId },
  { key: "professionId", label: "Profession", present: (p) => !!p.professionId },
  { key: "incomeRange", label: "Income", present: (p) => !!p.incomeRange },
  { key: "heightCm", label: "Height", present: (p) => p.heightCm !== null && p.heightCm !== undefined },
];

export interface CompletionResult {
  profileCompletionPercent: number;
  missingRequiredFields: string[];
  hasProfilePhoto: boolean;
  profileStatus: ProfileStatus;
}

export function computeCompletion(profile: ProfileRow, hasProfilePhoto: boolean): CompletionResult {
  const missing = REQUIRED_PROFILE_FIELDS.filter((f) => !f.present(profile)).map((f) => f.key);
  const percent = Math.round(((REQUIRED_PROFILE_FIELDS.length - missing.length) / REQUIRED_PROFILE_FIELDS.length) * 100);

  const fieldsComplete = missing.length === 0;
  let status: ProfileStatus = "INCOMPLETE";
  if (fieldsComplete && hasProfilePhoto) status = "READY_FOR_VISIBILITY";
  else if (fieldsComplete) status = "COMPLETE";

  const missingWithPhoto = hasProfilePhoto ? missing : [...missing, "profilePhoto"];

  return {
    profileCompletionPercent: percent,
    missingRequiredFields: missingWithPhoto,
    hasProfilePhoto,
    profileStatus: status,
  };
}

/** Whole-years age from a date of birth, computed at read time — never
 * stored, so it can never drift out of sync with dateOfBirth (B3 §4: "do
 * not allow inconsistent manually stored age"). */
export function computeAge(dateOfBirth: Date, asOf: Date = new Date()): number {
  let age = asOf.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = asOf.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}
