"use client";

/**
 * Interest / shortlist / chat / match list endpoints only return a name and
 * a profile id for each counterpart. To show a photo, age and city on those
 * rows we read GET /profiles/:id for each distinct id (a deliberate, bounded
 * N+1 — see B16_AUDIT §11). The backend decides what is visible: a profile
 * that is not visible to the viewer answers 404 and the row falls back to
 * the name alone.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { ProfileViewResponse } from "@/lib/api/types";
import { fromProfileView, type CardProfile } from "./cardModel";

export type Summary = { state: "loading" } | { state: "ok"; card: CardProfile } | { state: "unavailable" };

const TTL_MS = 60_000;
const MAX_PARALLEL = 4;
const cache = new Map<string, { at: number; card: CardProfile | null }>();
const pending = new Map<string, Promise<CardProfile | null>>();
const queue: Array<() => void> = [];
let running = 0;

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    running += 1;
    queue.shift()!();
  }
}

function fetchOne(id: string): Promise<CardProfile | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.card);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const p = new Promise<CardProfile | null>((resolve) => {
    queue.push(() => {
      api
        .get<ProfileViewResponse>(`/profiles/${id}`)
        .then((view) => {
          const card = fromProfileView(view);
          cache.set(id, { at: Date.now(), card });
          resolve(card);
        })
        .catch(() => resolve(null)) // 404 (not visible / blocked), 403, network: show the name only
        .finally(() => {
          running -= 1;
          pending.delete(id);
          pump();
        });
    });
    pump();
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
