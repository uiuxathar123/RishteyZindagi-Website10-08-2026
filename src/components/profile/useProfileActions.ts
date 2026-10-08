"use client";

import { useCallback, useState } from "react";
import { ApiError, isApiError } from "@/lib/api/errors";
import type { SendInterestResult } from "@/lib/api/types";
import { likeUser, loadRelations, sendInterestTo, shortlistUser, unlikeUser, unshortlistUser, useRelations } from "./relations";

export type InterestUiState = "none" | "sent_pending" | "received_pending" | "matched" | "declined";
type Busy = "like" | "shortlist" | "interest" | null;

function asApiError(e: unknown): ApiError {
  return isApiError(e) ? e : new ApiError({ status: 0, code: "UNKNOWN", message: "Something went wrong.", kind: "unknown" });
}

/**
 * Like / shortlist / interest controls for one member (addressed by USER id).
 * Each call has its own pending flag; state changes and the success notice
 * appear only after the API answered OK, otherwise `error` carries the real
 * ApiError.
 */
export function useProfileActions(userId: string | undefined) {
  const rel = useRelations(!!userId);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async <T,>(kind: Exclude<Busy, null>, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      const err = asApiError(e);
      if (err.kind === "conflict") void loadRelations(true); // our picture of the relation was out of date
      if (err.kind !== "aborted") setError(err);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const liked = !!userId && rel.likes.has(userId);
  const shortlisted = !!userId && rel.shortlist.has(userId);
  const sent = userId ? rel.sent.get(userId) : undefined;
  const received = userId ? rel.received.get(userId) : undefined;
  const matched = !!userId && rel.matches.has(userId);

  let interest: InterestUiState = "none";
  if (matched) interest = "matched";
  else if (received?.status === "PENDING") interest = "received_pending";
  else if (sent?.status === "PENDING") interest = "sent_pending";
  else if (sent?.status === "DECLINED") interest = "declined";

  return {
    ready: rel.status === "ready",
    busy,
    error,
    notice,
    clear: () => {
      setError(null);
      setNotice(null);
    },
    liked,
    shortlisted,
    interest,
    receivedInterestId: received?.status === "PENDING" ? received.id : undefined,
    toggleLike: () => {
      if (!userId) return Promise.resolve(undefined);
      return run("like", async () => {
        if (liked) await unlikeUser(userId);
        else await likeUser(userId);
      });
    },
    toggleShortlist: () => {
      if (!userId) return Promise.resolve(undefined);
      return run("shortlist", async () => {
        if (shortlisted) await unshortlistUser(userId);
        else await shortlistUser(userId);
      });
    },
    sendInterest: async (): Promise<SendInterestResult | undefined> => {
      if (!userId) return undefined;
      const result = await run("interest", () => sendInterestTo(userId));
      if (result) setNotice(result.matched ? "It's a match! You can now chat." : "Interest sent.");
      return result;
    },
  };
}
