"use client";

/**
 * What the signed-in member has already done to other members (liked,
 * shortlisted, sent / received interests, mutual matches).
 *
 * The profile DTOs do not say "you already liked this person", so the UI
 * asks the interaction APIs once (five small list calls) and shares the
 * answer between every card on the page. Every mutation here updates the
 * shared state ONLY after the API call resolved, and rethrows the ApiError
 * so the caller can show the real message.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { InterestView, LikeView, MatchView, ShortlistView, SendInterestResult } from "@/lib/api/types";

export interface Relations {
  status: "idle" | "loading" | "ready" | "signed_out";
  /** true when at least one of the list calls failed (state may be incomplete) */
  incomplete: boolean;
  likes: ReadonlySet<string>;
  shortlist: ReadonlySet<string>;
  sent: ReadonlyMap<string, InterestView>;
  received: ReadonlyMap<string, InterestView>;
  matches: ReadonlySet<string>;
}

const EMPTY: Relations = {
  status: "idle",
  incomplete: false,
  likes: new Set(),
  shortlist: new Set(),
  sent: new Map(),
  received: new Map(),
  matches: new Set(),
};

let state: Relations = EMPTY;
let inflight: Promise<void> | null = null;
let consumers = 0;
const listeners = new Set<() => void>();

function set(next: Relations) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function loadRelations(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && (state.status === "ready" || state.status === "signed_out")) return Promise.resolve();
  if (state.status === "idle") set({ ...state, status: "loading" });

  inflight = (async () => {
    const results = await Promise.allSettled([
      api.get<{ likes: LikeView[] }>("/interactions/likes", { query: { direction: "sent" } }),
      api.get<{ shortlist: ShortlistView[] }>("/interactions/shortlist"),
      api.get<{ interests: InterestView[] }>("/interactions/interests", { query: { direction: "sent" } }),
      api.get<{ interests: InterestView[] }>("/interactions/interests", { query: { direction: "received" } }),
      api.get<{ matches: MatchView[] }>("/interactions/matches"),
    ]);
    const unauthorized = results.some((r) => r.status === "rejected" && isApiError(r.reason) && r.reason.kind === "unauthorized");
    if (unauthorized) {
      set({ ...EMPTY, status: "signed_out" });
      return;
    }
    const val = <T,>(i: number): T | null => {
      const r = results[i];
      return r.status === "fulfilled" ? (r.value as T) : null;
    };
    const likes = val<{ likes: LikeView[] }>(0);
    const shortlist = val<{ shortlist: ShortlistView[] }>(1);
    const sent = val<{ interests: InterestView[] }>(2);
    const received = val<{ interests: InterestView[] }>(3);
    const matches = val<{ matches: MatchView[] }>(4);
    set({
      status: "ready",
      incomplete: results.some((r) => r.status === "rejected"),
      likes: new Set((likes?.likes ?? []).map((l) => l.toUserId)),
      shortlist: new Set((shortlist?.shortlist ?? []).map((s) => s.targetUserId)),
      sent: new Map((sent?.interests ?? []).map((i) => [i.toUserId, i])),
      received: new Map((received?.interests ?? []).map((i) => [i.fromUserId, i])),
      matches: new Set((matches?.matches ?? []).map((m) => m.counterpart.userId)),
    });
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Forget cached relations (e.g. after another screen changed them). */
export function invalidateRelations() {
  if (state.status === "ready") void loadRelations(true);
}

/** Subscribes to the shared state and loads it once the first consumer mounts. */
export function useRelations(enabled = true): Relations {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY
  );
  useEffect(() => {
    if (!enabled) return;
    consumers += 1;
    void loadRelations();
    return () => {
      consumers -= 1;
      // When nothing on screen uses the state any more (e.g. the person went
      // through /login and may come back as someone else) forget it, so the
      // next screen never shows another account's likes or shortlist.
      setTimeout(() => {
        if (consumers === 0 && !inflight) set(EMPTY);
      }, 0);
    };
  }, [enabled]);
  return snapshot;
}

function withSet(s: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const n = new Set(s);
  if (on) n.add(id);
  else n.delete(id);
  return n;
}

// --- mutations (state changes only after the API resolved) ----------------

export async function likeUser(userId: string): Promise<void> {
  await api.post("/interactions/likes", { toUserId: userId });
  set({ ...state, likes: withSet(state.likes, userId, true) });
}

export async function unlikeUser(userId: string): Promise<void> {
  await api.delete(`/interactions/likes/${userId}`);
  set({ ...state, likes: withSet(state.likes, userId, false) });
}

export async function shortlistUser(userId: string): Promise<void> {
  await api.post("/interactions/shortlist", { targetUserId: userId });
  set({ ...state, shortlist: withSet(state.shortlist, userId, true) });
}

export async function unshortlistUser(userId: string): Promise<void> {
  await api.delete(`/interactions/shortlist/${userId}`);
  set({ ...state, shortlist: withSet(state.shortlist, userId, false) });
}

export async function sendInterestTo(userId: string): Promise<SendInterestResult> {
  const result = await api.post<SendInterestResult>("/interactions/interests", { toUserId: userId });
  const sent = new Map(state.sent);
  sent.set(userId, result.interest);
  const next: Relations = { ...state, sent };
  if (result.matched) {
    next.matches = withSet(state.matches, userId, true);
    const received = new Map(state.received);
    received.delete(userId);
    next.received = received;
  }
  set(next);
  return result;
}
