/**
 * Shared helpers for the member profile editor: how backend fields map to
 * form state, which section owns which backend key, and how API validation
 * issues map back onto fields. Everything here is presentation glue — the
 * backend remains the only authority on validity and on profile completion.
 */
import type { ApiError } from "@/lib/api/errors";
import type { OwnerProfile } from "@/lib/api/types";

/** Tab ids used by the editor (also targets for the "missing fields" links). */
export type EditorTab = "basic" | "about" | "career" | "lifestyle" | "photos" | "preferences";

/**
 * Display text for the keys in the backend's `missingRequiredFields`.
 * (The list itself, the percentage and the status all come from the API.)
 */
export const MISSING_FIELD_INFO: Record<string, { label: string; tab: EditorTab }> = {
  gender: { label: "Gender", tab: "basic" },
  dateOfBirth: { label: "Date of birth", tab: "basic" },
  countryId: { label: "Country", tab: "basic" },
  cityId: { label: "City", tab: "basic" },
  maritalStatusId: { label: "Marital status", tab: "basic" },
  religionId: { label: "Religion", tab: "basic" },
  communityId: { label: "Community / caste", tab: "basic" },
  motherTongueId: { label: "Mother tongue", tab: "basic" },
  educationId: { label: "Education", tab: "career" },
  professionId: { label: "Profession", tab: "career" },
  incomeRange: { label: "Income", tab: "career" },
  heightCm: { label: "Height", tab: "basic" },
  profilePhoto: { label: "Profile photo", tab: "photos" },
};

export function missingFieldInfo(key: string): { label: string; tab: EditorTab } {
  return MISSING_FIELD_INFO[key] ?? { label: key, tab: "basic" };
}

/** UI says Bride / Groom; the backend stores FEMALE / MALE. */
export const GENDER_OPTIONS: Array<{ value: "FEMALE" | "MALE"; label: string }> = [
  { value: "FEMALE", label: "Bride (female)" },
  { value: "MALE", label: "Groom (male)" },
];

/** ISO-4217 codes offered for income. The backend accepts any 3-letter code. */
export const INCOME_CURRENCIES = ["INR", "USD", "AED", "GBP", "CAD", "AUD", "SGD", "EUR", "SAR", "QAR", "KWD", "OMR", "BHD", "MYR", "NZD"];

export const DIET_OPTIONS = [
  { value: "VEGETARIAN", label: "Vegetarian" },
  { value: "NON_VEGETARIAN", label: "Non-vegetarian" },
  { value: "EGGETARIAN", label: "Eggetarian" },
  { value: "VEGAN", label: "Vegan" },
  { value: "JAIN", label: "Jain" },
] as const;

export const HABIT_OPTIONS = [
  { value: "NO", label: "No" },
  { value: "OCCASIONALLY", label: "Occasionally" },
  { value: "YES", label: "Yes" },
] as const;

export const FAMILY_TYPE_OPTIONS = [
  { value: "NUCLEAR", label: "Nuclear" },
  { value: "JOINT", label: "Joint" },
] as const;

export const FAMILY_VALUES_OPTIONS = [
  { value: "TRADITIONAL", label: "Traditional" },
  { value: "MODERATE", label: "Moderate" },
  { value: "LIBERAL", label: "Liberal" },
] as const;

/** `dateOfBirth` comes back as an ISO timestamp at UTC midnight; inputs want yyyy-mm-dd. */
export function dobToInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export function numToInput(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

/** "" -> undefined, otherwise a whole number (NaN -> undefined). */
export function inputToInt(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Order-insensitive comparison for chip multi-selects. */
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
}

/** Issues the backend returned, keyed by field path (first message per path). */
export function issuesByPath(error: ApiError | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of error?.details ?? []) {
    if (d.path && !out[d.path]) out[d.path] = d.message;
  }
  return out;
}

/** Issues that did not point at a specific known field (shown in the section alert). */
export function unmappedIssues(error: ApiError | null, knownPaths: string[]): string[] {
  const known = new Set(knownPaths);
  return (error?.details ?? [])
    .filter((d) => !d.path || ![...known].some((k) => d.path === k || d.path.startsWith(`${k}.`) || d.path.startsWith(`${k}[`)))
    .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message));
}

export function profileDisplayStatus(status: OwnerProfile["profileStatus"]): { label: string; tone: "neutral" | "gold" | "success" } {
  switch (status) {
    case "READY_FOR_VISIBILITY":
      return { label: "Ready for visibility", tone: "success" };
    case "COMPLETE":
      return { label: "Complete — add a photo", tone: "gold" };
    default:
      return { label: "Incomplete", tone: "neutral" };
  }
}

export function verificationDisplay(status: OwnerProfile["verificationStatus"]): { label: string; tone: "neutral" | "gold" | "success" | "maroon"; help: string } {
  switch (status) {
    case "VERIFIED":
      return { label: "Verified", tone: "success", help: "Our team has verified your profile." };
    case "PENDING":
      return { label: "Verification pending", tone: "gold", help: "Our team is reviewing your profile." };
    case "REJECTED":
      return { label: "Verification rejected", tone: "maroon", help: "Our team could not verify your profile. Review your details and photos." };
    default:
      return { label: "Not verified", tone: "neutral", help: "Verification is carried out by our team; there is nothing to submit here." };
  }
}
