/**
 * Search filters <-> URL. The URL uses the backend's own query-parameter
 * names (GET /search/profiles), so a copied link, the browser's back button
 * and the homepage shortcuts all speak the same language as the API.
 *
 * Only the filters the API supports exist here. (It has no diet / verified /
 * has-photo / free-text filters, and the sort is limited to updatedAt /
 * createdAt, so none of those are offered.)
 */
export interface SearchFilters {
  gender?: "MALE" | "FEMALE";
  minAge?: number;
  maxAge?: number;
  minHeightCm?: number;
  maxHeightCm?: number;
  religionId?: string;
  communityId?: string;
  motherTongueId?: string;
  educationId?: string;
  professionId?: string;
  maritalStatusId?: string;
  countryId?: string;
  cityId?: string;
  /** Member-facing profile ID, RZ + 8 digits (an advanced-search filter). */
  profileId?: string;
  sortBy: "updatedAt" | "createdAt";
  sortDir: "asc" | "desc";
  page: number;
}

export const PAGE_SIZE = 12;

export const PROFILE_ID_PATTERN = /^RZ\d{8}$/;

/** Filters that need a plan with advanced search (the server enforces this; the UI only locks them). */
export const ADVANCED_FILTER_KEYS = ["minHeightCm", "maxHeightCm", "educationId", "professionId", "profileId"] as const;

export function advancedFilterCount(f: SearchFilters): number {
  return ADVANCED_FILTER_KEYS.filter((k) => f[k] !== undefined).length;
}

/** The same filters without the advanced ones. */
export function withoutAdvanced(f: SearchFilters): SearchFilters {
  return { ...f, minHeightCm: undefined, maxHeightCm: undefined, educationId: undefined, professionId: undefined, profileId: undefined, page: 1 };
}

export const DEFAULT_FILTERS: SearchFilters = { sortBy: "updatedAt", sortDir: "desc", page: 1 };

export const SORT_OPTIONS = [
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "createdAt:desc", label: "Newest members" },
  { value: "createdAt:asc", label: "Oldest members" },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reader = { get(name: string): string | null };

function id(sp: Reader, key: string): string | undefined {
  const first = sp.get(key)?.split(",")[0]?.trim();
  return first && UUID.test(first) ? first : undefined;
}

function int(sp: Reader, key: string, min: number, max: number): number | undefined {
  const raw = sp.get(key);
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined;
  const n = Number.parseInt(raw, 10);
  return n >= min && n <= max ? n : undefined;
}

function profileIdParam(sp: Reader): string | undefined {
  const raw = sp.get("profileId")?.trim().toUpperCase();
  return raw && PROFILE_ID_PATTERN.test(raw) ? raw : undefined;
}

export function parseFilters(sp: Reader): SearchFilters {
  const gender = sp.get("gender");
  const sortBy = sp.get("sortBy");
  const sortDir = sp.get("sortDir");
  return {
    gender: gender === "MALE" || gender === "FEMALE" ? gender : undefined,
    minAge: int(sp, "minAge", 18, 100),
    maxAge: int(sp, "maxAge", 18, 100),
    minHeightCm: int(sp, "minHeightCm", 90, 250),
    maxHeightCm: int(sp, "maxHeightCm", 90, 250),
    religionId: id(sp, "religionIds"),
    communityId: id(sp, "communityIds"),
    motherTongueId: id(sp, "motherTongueIds"),
    educationId: id(sp, "educationIds"),
    professionId: id(sp, "professionIds"),
    maritalStatusId: id(sp, "maritalStatusIds"),
    countryId: id(sp, "countryId"),
    cityId: id(sp, "cityId"),
    profileId: profileIdParam(sp),
    sortBy: sortBy === "createdAt" ? "createdAt" : "updatedAt",
    sortDir: sortDir === "asc" ? "asc" : "desc",
    page: int(sp, "page", 1, 10_000) ?? 1,
  };
}

/** Query parameters for BOTH the page URL and the API call. */
export function toQuery(f: SearchFilters, opts: { forApi?: boolean } = {}): Record<string, string | number | undefined> {
  const q: Record<string, string | number | undefined> = {
    gender: f.gender,
    minAge: f.minAge,
    maxAge: f.maxAge,
    minHeightCm: f.minHeightCm,
    maxHeightCm: f.maxHeightCm,
    religionIds: f.religionId,
    communityIds: f.religionId ? f.communityId : undefined, // a community only means something within its religion
    motherTongueIds: f.motherTongueId,
    educationIds: f.educationId,
    professionIds: f.professionId,
    maritalStatusIds: f.maritalStatusId,
    countryId: f.countryId,
    cityId: f.countryId ? f.cityId : undefined,
    profileId: f.profileId,
    // Keep the URL tidy: only write non-default sort / page.
    sortBy: opts.forApi || f.sortBy !== DEFAULT_FILTERS.sortBy || f.sortDir !== DEFAULT_FILTERS.sortDir ? f.sortBy : undefined,
    sortDir: opts.forApi || f.sortBy !== DEFAULT_FILTERS.sortBy || f.sortDir !== DEFAULT_FILTERS.sortDir ? f.sortDir : undefined,
    page: opts.forApi || f.page > 1 ? f.page : undefined,
    pageSize: opts.forApi ? PAGE_SIZE : undefined,
  };
  return q;
}

export function toSearchString(f: SearchFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(toQuery(f))) if (v !== undefined && v !== "") params.set(k, String(v));
  return params.toString();
}

export function activeFilterCount(f: SearchFilters): number {
  return [f.gender, f.minAge, f.maxAge, f.minHeightCm, f.maxHeightCm, f.religionId, f.communityId, f.motherTongueId, f.educationId, f.professionId, f.maritalStatusId, f.countryId, f.cityId, f.profileId].filter(
    (v) => v !== undefined
  ).length;
}
