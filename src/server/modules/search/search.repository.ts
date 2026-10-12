/**
 * B4: the search query itself. Filtering happens entirely at the
 * database level (§19 — never fetch every profile and filter in
 * JS/TypeScript); this file is the only place that builds the dynamic
 * WHERE clause. Enrichment (resolving lookup names, loading photos, and
 * shaping the audience-appropriate response) happens afterward in
 * search.service.ts, bounded to the one page of results this returns.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { profiles, users, blocks } from "@/server/db/schema";
import type { ProfileRow } from "@/server/modules/profiles/profiles.repository";
import { dobBoundsForAgeRange } from "./age-range";

export interface SearchFilters {
  gender?: "MALE" | "FEMALE";
  minAge?: number;
  maxAge?: number;
  religionIds?: string[];
  communityIds?: string[];
  motherTongueIds?: string[];
  educationIds?: string[];
  professionIds?: string[];
  /** §9/§4: ANY_PROFESSION — when true, professionIds (if any) is ignored
   * and no profession restriction is applied at all. */
  anyProfession?: boolean;
  maritalStatusIds?: string[];
  countryId?: string;
  cityId?: string;
  minHeightCm?: number;
  maxHeightCm?: number;
  minIncome?: number;
  maxIncome?: number;
  incomeCurrency?: string;
  /** B18: exact member-facing profile ID (RZ + 8 digits), already upper-cased by the controller. */
  profileId?: string;
  /** Self-exclusion (§12) — the signed-in requester's own users.id, never
   * applied for an anonymous search. */
  excludeUserId?: string;
}

export type SearchSortField = "updatedAt" | "createdAt";

export interface SearchQuery {
  filters: SearchFilters;
  page: number;
  pageSize: number;
  sortBy: SearchSortField;
  sortDir: "asc" | "desc";
}

export interface SearchResultRow {
  profile: ProfileRow;
  displayName: string;
}

export interface SearchPage {
  items: SearchResultRow[];
  total: number;
}

/** §11 categories combine with AND; multiple values *within* one category
 * (the inArray calls below) combine with OR — §10. */
function buildConditions(filters: SearchFilters) {
  const conditions = [
    // §11: only eligible, visible profiles — same readiness bar B3's own
    // public-profile-view route uses (READY_FOR_VISIBILITY + ACTIVE
    // account), never re-derived differently here.
    eq(profiles.profileStatus, "READY_FOR_VISIBILITY"),
    // B19: manual-approval queue — pending/rejected profiles are never searchable.
    eq(profiles.approvalStatus, "APPROVED"),
    eq(users.status, "ACTIVE"),
    // B18: a member who chose "hide my profile" never appears in search.
    eq(profiles.profileVisibility, "VISIBLE"),
  ];
  if (filters.profileId) conditions.push(eq(profiles.publicId, filters.profileId));

  if (filters.excludeUserId) {
    conditions.push(ne(profiles.userId, filters.excludeUserId));
    // B6 (disclosed, additive, required dependency — see BACKEND.md's B6
    // section for the full 4-part disclosure): the B6 spec requires that
    // a blocked user disappears from both parties' search results, but
    // this file — confirmed by direct inspection before this change —
    // never excluded blocked pairs at all (unlike
    // recommendations.repository.ts's own, separate, already-existing
    // `notBlocked` predicate). Only applied for an authenticated search
    // (the same conditionality `excludeUserId` itself already has) —
    // anonymous search has no requester identity to check blocks
    // against, exactly like self-exclusion above. Purely narrows results
    // further; no existing filter or test assertion is touched.
    conditions.push(sql`NOT EXISTS (
      SELECT 1 FROM ${blocks} b
      WHERE (b.blocker_user_id = ${filters.excludeUserId} AND b.blocked_user_id = ${users.id})
         OR (b.blocker_user_id = ${users.id} AND b.blocked_user_id = ${filters.excludeUserId})
    )`);
  }
  if (filters.gender) conditions.push(eq(profiles.gender, filters.gender));

  const { minDob, maxDob } = dobBoundsForAgeRange(filters.minAge, filters.maxAge);
  if (minDob) conditions.push(gte(profiles.dateOfBirth, minDob));
  if (maxDob) conditions.push(lte(profiles.dateOfBirth, maxDob));

  if (filters.religionIds?.length) conditions.push(inArray(profiles.religionId, filters.religionIds));
  if (filters.communityIds?.length) conditions.push(inArray(profiles.communityId, filters.communityIds));
  // Matches a profile's PRIMARY mother tongue / education / profession
  // selection only, not the optional "additional selections" jsonb
  // arrays B3 introduced — see BACKEND.md's B4 section for why (keeping
  // filtering at the database level without jsonb-containment queries).
  if (filters.motherTongueIds?.length) conditions.push(inArray(profiles.motherTongueId, filters.motherTongueIds));
  if (filters.educationIds?.length) conditions.push(inArray(profiles.educationId, filters.educationIds));
  if (!filters.anyProfession && filters.professionIds?.length) {
    conditions.push(inArray(profiles.professionId, filters.professionIds));
  }
  if (filters.maritalStatusIds?.length) conditions.push(inArray(profiles.maritalStatusId, filters.maritalStatusIds));

  if (filters.countryId) conditions.push(eq(profiles.countryId, filters.countryId));
  if (filters.cityId) conditions.push(eq(profiles.cityId, filters.cityId));

  if (filters.minHeightCm !== undefined) conditions.push(gte(profiles.heightCm, filters.minHeightCm));
  if (filters.maxHeightCm !== undefined) conditions.push(lte(profiles.heightCm, filters.maxHeightCm));

  if (filters.minIncome !== undefined || filters.maxIncome !== undefined) {
    // §21: never compare across currencies. The controller requires
    // incomeCurrency whenever either bound is supplied, so this is always
    // set here; profiles with a different currency (or no structured
    // income at all — NULL) are excluded by these comparisons naturally.
    conditions.push(eq(profiles.incomeCurrency, filters.incomeCurrency as string));
    if (filters.minIncome !== undefined) conditions.push(gte(profiles.incomeMaxAmount, filters.minIncome));
    if (filters.maxIncome !== undefined) conditions.push(lte(profiles.incomeMinAmount, filters.maxIncome));
  }

  return and(...conditions);
}

export async function search(query: SearchQuery): Promise<SearchPage> {
  const whereClause = buildConditions(query.filters);
  const orderFn = query.sortDir === "asc" ? asc : desc;
  // §18: stable ordering — the requested sort column plus profiles.id as
  // an always-ascending tie-breaker, so two profiles with an identical
  // sort value never swap places between pages.
  const sortColumn = query.sortBy === "createdAt" ? profiles.createdAt : profiles.updatedAt;

  const [items, countRows] = await Promise.all([
    db
      .select({ profile: profiles, displayName: users.name })
      .from(profiles)
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(whereClause)
      .orderBy(orderFn(sortColumn), asc(profiles.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(profiles)
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(whereClause),
  ]);

  return { items, total: countRows[0]?.count ?? 0 };
}
