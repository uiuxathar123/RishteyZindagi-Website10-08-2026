/**
 * B3: read access to the profile lookup/reference tables (religions,
 * mother tongues, educations, professions, countries, marital statuses —
 * all seeded, closed lists — plus cities and communities, which are
 * open-ended and populated on demand via findOrCreate*). Nothing above
 * this file queries these tables directly.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  religions,
  motherTongues,
  educations,
  professions,
  countries,
  cities,
  maritalStatuses,
  communities,
} from "@/server/db/schema";

export interface LookupRow {
  id: string;
  name: string;
}

export async function listReligions(): Promise<LookupRow[]> {
  return db.select({ id: religions.id, name: religions.name }).from(religions).orderBy(religions.name);
}

export async function listMotherTongues(): Promise<LookupRow[]> {
  return db.select({ id: motherTongues.id, name: motherTongues.name }).from(motherTongues).orderBy(motherTongues.name);
}

export async function listEducations(): Promise<LookupRow[]> {
  return db.select({ id: educations.id, name: educations.name }).from(educations).orderBy(educations.name);
}

export async function listProfessions(): Promise<LookupRow[]> {
  return db.select({ id: professions.id, name: professions.name }).from(professions).orderBy(professions.name);
}

export async function listMaritalStatuses(): Promise<LookupRow[]> {
  return db.select({ id: maritalStatuses.id, name: maritalStatuses.name }).from(maritalStatuses).orderBy(maritalStatuses.name);
}

export async function listCountries(): Promise<Array<LookupRow & { isoCode: string | null }>> {
  return db
    .select({ id: countries.id, name: countries.name, isoCode: countries.isoCode })
    .from(countries)
    .orderBy(countries.name);
}

export async function listCitiesForCountry(countryId: string): Promise<LookupRow[]> {
  return db.select({ id: cities.id, name: cities.name }).from(cities).where(eq(cities.countryId, countryId)).orderBy(cities.name);
}

export async function listCommunitiesForReligion(religionId: string): Promise<LookupRow[]> {
  return db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .where(and(eq(communities.religionId, religionId), eq(communities.isActive, true)))
    .orderBy(communities.name);
}

export async function getReligionById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: religions.id, name: religions.name }).from(religions).where(eq(religions.id, id)).limit(1);
  return row;
}

export async function getMotherTongueById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: motherTongues.id, name: motherTongues.name }).from(motherTongues).where(eq(motherTongues.id, id)).limit(1);
  return row;
}

export async function getEducationById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: educations.id, name: educations.name }).from(educations).where(eq(educations.id, id)).limit(1);
  return row;
}

export async function getProfessionById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: professions.id, name: professions.name }).from(professions).where(eq(professions.id, id)).limit(1);
  return row;
}

export async function getMaritalStatusById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db
    .select({ id: maritalStatuses.id, name: maritalStatuses.name })
    .from(maritalStatuses)
    .where(eq(maritalStatuses.id, id))
    .limit(1);
  return row;
}

export async function getCountryById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: countries.id, name: countries.name }).from(countries).where(eq(countries.id, id)).limit(1);
  return row;
}

export async function getCityById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: cities.id, name: cities.name }).from(cities).where(eq(cities.id, id)).limit(1);
  return row;
}

export async function getCommunityById(id: string): Promise<LookupRow | undefined> {
  const [row] = await db.select({ id: communities.id, name: communities.name }).from(communities).where(eq(communities.id, id)).limit(1);
  return row;
}

export async function religionExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: religions.id }).from(religions).where(eq(religions.id, id)).limit(1);
  return rows.length > 0;
}

export async function motherTongueExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: motherTongues.id }).from(motherTongues).where(eq(motherTongues.id, id)).limit(1);
  return rows.length > 0;
}

export async function educationExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: educations.id }).from(educations).where(eq(educations.id, id)).limit(1);
  return rows.length > 0;
}

export async function professionExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: professions.id }).from(professions).where(eq(professions.id, id)).limit(1);
  return rows.length > 0;
}

export async function maritalStatusExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: maritalStatuses.id }).from(maritalStatuses).where(eq(maritalStatuses.id, id)).limit(1);
  return rows.length > 0;
}

export async function countryExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: countries.id }).from(countries).where(eq(countries.id, id)).limit(1);
  return rows.length > 0;
}

export async function cityBelongsToCountry(cityId: string, countryId: string): Promise<boolean> {
  const rows = await db.select().from(cities).where(and(eq(cities.id, cityId), eq(cities.countryId, countryId))).limit(1);
  return rows.length > 0;
}

/** B18: a retired community can't be newly chosen (profiles that already have it keep it). */
export async function communityIsActive(communityId: string): Promise<boolean> {
  const [row] = await db.select({ isActive: communities.isActive }).from(communities).where(eq(communities.id, communityId)).limit(1);
  return !!row?.isActive;
}

export async function communityBelongsToReligion(communityId: string, religionId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(communities)
    .where(and(eq(communities.id, communityId), eq(communities.religionId, religionId)))
    .limit(1);
  return rows.length > 0;
}

/** Case-insensitive find-or-create, scoped to a country — cities are an
 * open-ended list (§4: "do not hard-code only Indian cities"), so rather
 * than requiring an exhaustive pre-seeded set, an unrecognized city name
 * is simply added to the lookup table the first time it's used. */
export async function findOrCreateCity(name: string, countryId: string): Promise<LookupRow> {
  const trimmed = name.trim();
  const existing = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.countryId, countryId))
    .limit(500);
  const match = existing.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;

  const [row] = await db.insert(cities).values({ name: trimmed, countryId }).returning({ id: cities.id, name: cities.name });
  return row;
}

/** Case-insensitive find-or-create, scoped to a religion — see
 * findOrCreateCity's rationale; communities/castes are similarly
 * open-ended and religion-specific. */
export async function findOrCreateCommunity(name: string, religionId: string): Promise<LookupRow> {
  const trimmed = name.trim();
  const existing = await db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .where(eq(communities.religionId, religionId))
    .limit(1000);
  const match = existing.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;

  const [row] = await db.insert(communities).values({ name: trimmed, religionId }).returning({ id: communities.id, name: communities.name });
  return row;
}

// --- Batched lookups (used by the list-card summaries endpoint) ----------------

export interface LookupIdSets {
  maritalStatus: string[];
  religion: string[];
  community: string[];
  motherTongue: string[];
  education: string[];
  profession: string[];
  country: string[];
  city: string[];
}

export type LookupMaps = { [K in keyof LookupIdSets]: Map<string, LookupRow> };

async function namesByIds(
  table: typeof religions | typeof motherTongues | typeof educations | typeof professions | typeof countries | typeof cities | typeof maritalStatuses | typeof communities,
  ids: string[]
): Promise<Map<string, LookupRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: table.id, name: table.name }).from(table as typeof religions).where(inArray(table.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** One query per lookup table that is actually needed (instead of one per profile per table). */
export async function getLookupMapsByIds(ids: LookupIdSets): Promise<LookupMaps> {
  const [maritalStatus, religion, community, motherTongue, education, profession, country, city] = await Promise.all([
    namesByIds(maritalStatuses, ids.maritalStatus),
    namesByIds(religions, ids.religion),
    namesByIds(communities, ids.community),
    namesByIds(motherTongues, ids.motherTongue),
    namesByIds(educations, ids.education),
    namesByIds(professions, ids.profession),
    namesByIds(countries, ids.country),
    namesByIds(cities, ids.city),
  ]);
  return { maritalStatus, religion, community, motherTongue, education, profession, country, city };
}
