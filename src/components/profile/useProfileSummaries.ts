"use client";

/**
 * Interest / shortlist / chat / match list endpoints only return a name and
 * a profile id for each counterpart. To show a photo, age and city on those
 * rows we ask GET /profiles/summaries for all distinct ids at once (rows
 * requested within a few milliseconds share one request; was one
 * GET /profiles/:id per row). The backend decides what is visible: a profile
 * that is not visible to the viewer comes back as null and the row falls
 * back to the name alone.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { ProfileSummariesResponse } from "@/lib/api/types";
import { fromProfileView, type CardProfile } from "./cardModel";

export type Summary = { state: "loading" } | { state: "ok"; card: CardProfile } | { state: "unavailable" };

const TTL_MS = 60_000;
const BATCH_WINDOW_MS = 20;
const MAX_IDS_PER_REQUEST = 50; // matches the backend limit
const cache = new Map<string, { at: number; card: CardProfile | null }>();
const pending = new Map<string, Promise<CardProfile | null>>();
const waiting = new Map<string, Array<(card: CardProfile | null) => void>>();
let batch: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Sends every id requested within the last few milliseconds as ONE request (was: one request per row). */
function flush() {
  timer = null;
  const ids = batch;
  batch = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
    const settle = (card: (id: string, res?: ProfileSummariesResponse) => CardProfile | null, res: ProfileSummariesResponse | undefined, remember: boolean) => {
      for (const id of chunk) {
        const c = card(id, res);
        if (remember) cache.set(id, { at: Date.now(), card: c });
        pending.delete(id);
        const resolvers = waiting.get(id) ?? [];
        waiting.delete(id);
        for (const r of resolvers) r(c);
      }
    };
    api
      .get<ProfileSummariesResponse>("/profiles/summaries", { query: { ids: chunk.join(",") } })
      .then((res) => settle((id, r) => (r?.items[id] ? fromProfileView(r.items[id]!) : null), res, true))
      // network error / 401: show the name only, and do not cache the failure
      .catch(() => settle(() => null, undefined, false));
  }
}

function fetchOne(id: string): Promise<CardProfile | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.card);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const p = new Promise<CardProfile | null>((resolve) => {
    waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
    batch.push(id);
    if (!timer) timer = setTimeout(flush, BATCH_WINDOW_MS);
  });
  pending.set(id, p);
  return p;
}

export function useProfileSummaries(profileIds: Array<string | null | undefined>): Record<string, Summary> {
  const key = Array.from(new Set(profileIds.filter((x): x is string => !!x))).sort().join(",");
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    let live = true;
    setSummaries((prev) => {
      const next: Record<string, Summary> = {};
      for (const id of ids) next[id] = prev[id] ?? { state: "loading" };
      return next;
    });
    for (const id of ids) {
      void fetchOne(id).then((card) => {
        if (!live) return;
        setSummaries((prev) => ({ ...prev, [id]: card ? { state: "ok", card } : { state: "unavailable" } }));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);

  return summaries;
}
