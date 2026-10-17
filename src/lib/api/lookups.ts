"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import type { LookupRow, ReferenceOptions } from "./types";

const cache = new Map<string, Promise<ReferenceOptions>>();

export interface ReferenceParams {
  religionId?: string;
  countryId?: string;
  /** ISO 3166-1 alpha-2 code: that country's cities without knowing its id. */
  countryIso?: string;
}

const cacheKey = (params: ReferenceParams) => `${params.religionId ?? ""}|${params.countryId ?? ""}|${params.countryIso ?? ""}`;

/** A `countryIso` answer also holds the base lists and that country's `countryId` answer, so later callers asking
 * for either reuse it instead of fetching again. Entries already cached are left alone. */
function shareCountryIsoAnswer(countryIso: string, data: ReferenceOptions) {
  const { cities, ...base } = data;
  const baseKey = cacheKey({});
  if (!cache.has(baseKey)) cache.set(baseKey, Promise.resolve(base));
  const country = data.countries.find((c) => c.isoCode?.toUpperCase() === countryIso.toUpperCase());
  const countryKey = country && cacheKey({ countryId: country.id });
  if (countryKey && cities && !cache.has(countryKey)) cache.set(countryKey, Promise.resolve(data));
}

/** Cached fetch of `/reference/profile-options` (optionally with communities / cities). */
export function loadReference(params: ReferenceParams = {}): Promise<ReferenceOptions> {
  const key = cacheKey(params);
  let p = cache.get(key);
  if (!p) {
    p = api
      .get<ReferenceOptions>("/reference/profile-options", { query: { ...params } })
      .then((data) => {
        if (params.countryIso && !params.religionId) shareCountryIsoAnswer(params.countryIso, data);
        return data;
      })
      .catch((e) => {
        cache.delete(key); // do not cache failures
        throw e;
      });
    cache.set(key, p);
  }
  return p;
}

/** Test-only: forget every cached answer. */
export function __clearReferenceCacheForTests() {
  cache.clear();
}

export function useReference(params: ReferenceParams = {}) {
  const [data, setData] = useState<ReferenceOptions | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const religionId = params.religionId;
  const countryId = params.countryId;
  const countryIso = params.countryIso;
  useEffect(() => {
    let live = true;
    loadReference({ religionId, countryId, countryIso })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [religionId, countryId, countryIso]);
  return { data, error, loading: !data && !error };
}

/** Communities are named "<sect> › <group>". Split into option groups for display. */
export function groupCommunities(rows: LookupRow[]): Array<{ sect: string; items: Array<LookupRow & { label: string }> }> {
  const groups = new Map<string, Array<LookupRow & { label: string }>>();
  for (const r of rows) {
    const [sect, ...rest] = r.name.split(" › ");
    const label = rest.length ? rest.join(" › ") : r.name;
    const key = rest.length ? sect : "Other";
    const list = groups.get(key) ?? [];
    list.push({ ...r, label });
    groups.set(key, list);
  }
  return [...groups.entries()].map(([sect, items]) => ({ sect, items }));
}
