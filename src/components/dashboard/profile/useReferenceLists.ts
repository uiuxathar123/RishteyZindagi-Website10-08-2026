"use client";

import { useEffect, useState } from "react";
import { loadReference } from "@/lib/api/lookups";
import type { LookupRow } from "@/lib/api/types";

/** Communities of one religion (empty until loaded; `loading` is true for the id being fetched). */
export function useCommunities(religionId: string | undefined) {
  const [state, setState] = useState<{ id: string | undefined; rows: LookupRow[]; error: boolean }>({ id: undefined, rows: [], error: false });
  useEffect(() => {
    if (!religionId) {
      setState({ id: undefined, rows: [], error: false });
      return;
    }
    let live = true;
    loadReference({ religionId })
      .then((d) => live && setState({ id: religionId, rows: d.communities ?? [], error: false }))
      .catch(() => live && setState({ id: religionId, rows: [], error: true }));
    return () => {
      live = false;
    };
  }, [religionId]);
  const loading = !!religionId && state.id !== religionId;
  return { rows: loading ? [] : state.rows, loading, error: !loading && state.error };
}

/** Cities of one country. */
export function useCities(countryId: string | undefined) {
  const [state, setState] = useState<{ id: string | undefined; rows: LookupRow[]; error: boolean }>({ id: undefined, rows: [], error: false });
  useEffect(() => {
    if (!countryId) {
      setState({ id: undefined, rows: [], error: false });
      return;
    }
    let live = true;
    loadReference({ countryId })
      .then((d) => live && setState({ id: countryId, rows: d.cities ?? [], error: false }))
      .catch(() => live && setState({ id: countryId, rows: [], error: true }));
    return () => {
      live = false;
    };
  }, [countryId]);
  const loading = !!countryId && state.id !== countryId;
  return { rows: loading ? [] : state.rows, loading, error: !loading && state.error };
}

/** Cities for several countries at once (partner preferences), merged. */
export function useCitiesForCountries(countryIds: string[]) {
  const key = [...countryIds].sort().join(",");
  const [state, setState] = useState<{ key: string; rows: LookupRow[]; error: boolean }>({ key: "", rows: [], error: false });
  useEffect(() => {
    if (!key) {
      setState({ key: "", rows: [], error: false });
      return;
    }
    let live = true;
    Promise.all(key.split(",").map((id) => loadReference({ countryId: id })))
      .then((all) => {
        if (!live) return;
        const seen = new Set<string>();
        const rows: LookupRow[] = [];
        for (const d of all) for (const c of d.cities ?? []) if (!seen.has(c.id)) (seen.add(c.id), rows.push(c));
        setState({ key, rows, error: false });
      })
      .catch(() => live && setState({ key, rows: [], error: true }));
    return () => {
      live = false;
    };
  }, [key]);
  const loading = !!key && state.key !== key;
  return { rows: loading ? [] : state.rows, loading, error: !loading && state.error };
}
