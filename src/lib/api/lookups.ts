"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import type { LookupRow, ReferenceOptions } from "./types";

const cache = new Map<string, Promise<ReferenceOptions>>();

/** Cached fetch of `/reference/profile-options` (optionally with communities / cities). */
export function loadReference(params: { religionId?: string; countryId?: string } = {}): Promise<ReferenceOptions> {
  const key = `${params.religionId ?? ""}|${params.countryId ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = api.get<ReferenceOptions>("/reference/profile-options", { query: params }).catch((e) => {
      cache.delete(key); // do not cache failures
      throw e;
    });
    cache.set(key, p);
  }
  return p;
}

export function useReference(params: { religionId?: string; countryId?: string } = {}) {
  const [data, setData] = useState<ReferenceOptions | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const religionId = params.religionId;
  const countryId = params.countryId;
  useEffect(() => {
    let live = true;
    loadReference({ religionId, countryId })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [religionId, countryId]);
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
