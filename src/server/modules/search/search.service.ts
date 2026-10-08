/**
 * B4: deterministic profile search. Reuses B3's own privacy boundary
 * (profiles.dto.ts's toAuthenticatedPublicView / toAnonymousGatedView,
 * and profiles.service.ts's resolveLookups) rather than building a
 * second, possibly-inconsistent implementation of it — see BACKEND.md's
 * B4 section on the resolveLookups export.
 */
import { ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as profilesRepo from "@/server/modules/profiles/profiles.repository";
import * as referenceRepo from "@/server/modules/profiles/reference.repository";
import { resolveLookups } from "@/server/modules/profiles/profiles.service";
import {
  toAuthenticatedPublicView,
  toAnonymousGatedView,
  type AuthenticatedPublicProfileView,
  type AnonymousGatedProfileView,
} from "@/server/modules/profiles/profiles.dto";
import * as searchRepo from "./search.repository";
import type { SearchFilters, SearchSortField } from "./search.repository";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export interface SearchInput {
  filters: SearchFilters;
  page?: number;
  pageSize?: number;
  sortBy?: SearchSortField;
  sortDir?: "asc" | "desc";
}

export type SearchResultProfile =
  | { audience: "authenticated"; profile: AuthenticatedPublicProfileView }
  | { audience: "anonymous"; profile: AnonymousGatedProfileView };

export interface SearchResultPage {
  items: SearchResultProfile[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** §23: never trust client-supplied filter ids — confirm every one
 * actually exists before it reaches the database query. */
async function validateFilters(filters: SearchFilters): Promise<void> {
  const idListChecks: Array<[string, string[] | undefined, (id: string) => Promise<boolean>]> = [
    ["religionIds", filters.religionIds, referenceRepo.religionExists],
    ["motherTongueIds", filters.motherTongueIds, referenceRepo.motherTongueExists],
    ["educationIds", filters.educationIds, referenceRepo.educationExists],
    ["professionIds", filters.professionIds, referenceRepo.professionExists],
    ["maritalStatusIds", filters.maritalStatusIds, referenceRepo.maritalStatusExists],
  ];
  for (const [field, ids, checker] of idListChecks) {
    if (!ids) continue;
    for (const id of ids) {
      if (!(await checker(id))) throw new ValidationError(`${field} contains an id that does not exist: ${id}`);
    }
  }
  if (filters.communityIds) {
    for (const id of filters.communityIds) {
      if (!(await referenceRepo.getCommunityById(id))) throw new ValidationError(`communityIds contains an id that does not exist: ${id}`);
    }
  }
  if (filters.countryId && !(await referenceRepo.countryExists(filters.countryId))) {
    throw new ValidationError("countryId does not reference a known country.");
  }
  if (filters.cityId) {
    if (!(await referenceRepo.getCityById(filters.cityId))) throw new ValidationError("cityId does not reference a known city.");
    if (filters.countryId && !(await referenceRepo.cityBelongsToCountry(filters.cityId, filters.countryId))) {
      throw new ValidationError("cityId does not belong to the given countryId.");
    }
  }
  if ((filters.minIncome !== undefined || filters.maxIncome !== undefined) && !filters.incomeCurrency) {
    throw new ValidationError("incomeCurrency is required whenever minIncome or maxIncome is supplied.");
  }
}

export async function searchProfiles(viewer: AuthContext | null, input: SearchInput): Promise<SearchResultPage> {
  await validateFilters(input.filters);

  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const sortBy = input.sortBy ?? "updatedAt";
  const sortDir = input.sortDir ?? "desc";

  // §12: self-exclusion, enforced server-side, never left to the client.
  const excludeUserId = viewer && viewer.subject.type === "user" ? viewer.subject.id : undefined;

  const { items, total } = await searchRepo.search({
    filters: { ...input.filters, excludeUserId },
    page,
    pageSize,
    sortBy,
    sortDir,
  });

  const results = await Promise.all(
    items.map(async (row): Promise<SearchResultProfile> => {
      const [lookups, photos] = await Promise.all([resolveLookups(row.profile), profilesRepo.listPhotos(row.profile.id)]);
      if (viewer) {
        return { audience: "authenticated", profile: toAuthenticatedPublicView(row.profile, row.displayName, lookups, photos) };
      }
      return { audience: "anonymous", profile: toAnonymousGatedView(row.profile, lookups, photos.length > 0) };
    })
  );

  return {
    items: results,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
