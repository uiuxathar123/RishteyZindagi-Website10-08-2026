"use client";

import { DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isApiError } from "./errors";

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Re-run the loader (keeps showing stale data while reloading). */
  reload: () => void;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

function toApiError(e: unknown): ApiError {
  if (isApiError(e)) return e;
  return new ApiError({ status: 0, code: "UNKNOWN", message: "Something went wrong.", kind: "unknown" });
}

/**
 * Loads data on mount / when `deps` change, cancelling the in-flight
 * request on change or unmount. Never leaves a promise unhandled and never
 * leaves `loading` stuck: every outcome (data, error) ends it.
 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDataState(result);
        setLoading(false);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        const err = toApiError(e);
        if (err.kind === "aborted") return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (updater: T | null | ((prev: T | null) => T | null)) =>
      setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | null) => T | null)(prev) : updater)),
    []
  );

  return { data, error, loading, reload, setData };
}

/**
 * Wraps a mutation: tracks `pending`, captures the error, and returns the
 * result (or `undefined` on failure) so callers can `if (!(await run(...))) return`.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      const err = toApiError(e);
      if (err.kind !== "aborted") setError(err);
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(null) };
}
