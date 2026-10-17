"use client";

import { useReference } from "@/lib/api/lookups";
import type { LookupRow, ReferenceOptions } from "@/lib/api/types";

export const searchHref = (params: Record<string, string>) => `/search?${new URLSearchParams(params).toString()}`;

/** Rows whose name matches one of `preferred` (in that order), topped up with the first remaining rows. */
export function pickPreferred(rows: LookupRow[] | undefined, preferred: string[], max: number): LookupRow[] {
  if (!rows) return [];
  const chosen: LookupRow[] = [];
  for (const want of preferred) {
    const hit = rows.find((r) => r.name.toLowerCase().includes(want.toLowerCase()) && !chosen.includes(r));
    if (hit) chosen.push(hit);
  }
  for (const r of rows) {
    if (chosen.length >= max) break;
    if (!chosen.includes(r) && !/^other$/i.test(r.name) && !/no religion/i.test(r.name)) chosen.push(r);
  }
  return chosen.slice(0, max);
}

/** The one reference request every homepage section shares: the base lists plus India's cities. */
export const HOME_REFERENCE_QUERY = { countryIso: "IN" } as const;

/** Backend reference data for the "browse by" shortcuts (religions, countries, professions, Indian cities…). */
export function useBrowseLookups(): {
  loading: boolean;
  failed: boolean;
  base: ReferenceOptions | null;
  india: LookupRow | undefined;
  indianCities: LookupRow[];
} {
  const ref = useReference(HOME_REFERENCE_QUERY);
  const india = ref.data?.countries.find((c) => c.isoCode?.toUpperCase() === HOME_REFERENCE_QUERY.countryIso);
  return {
    loading: ref.loading,
    failed: !!ref.error,
    base: ref.data,
    india,
    indianCities: india ? ref.data?.cities ?? [] : [],
  };
}
