"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/api/hooks";
import type { ApiError } from "@/lib/api/errors";
import { issuesByPath } from "./profileForm";

/**
 * Draft/dirty/save state for one independently-saved form section.
 *
 *  - `toState(source)` maps what the server returned to editable draft state;
 *  - `dirty` compares the draft with that server-derived baseline;
 *  - a success message is only set after `submit` resolved (the API said OK);
 *  - when the source changes elsewhere (another section saved, a reload) the
 *    draft follows it unless this section has unsaved edits.
 */
export function useSection<S, D extends object>(opts: {
  source: S;
  toState: (source: S) => D;
  validate?: (draft: D, baseline: D) => Record<string, string>;
  /** Performs the API call; resolves with the fresh server value. */
  submit: (draft: D, baseline: D) => Promise<S>;
  onSaved: (fresh: S) => void;
}) {
  const baseline = opts.toState(opts.source);
  const baseKey = JSON.stringify(baseline);
  const [draft, setDraftState] = useState<D>(baseline);
  const [saved, setSaved] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const lastBaseKey = useRef(baseKey);

  useEffect(() => {
    if (lastBaseKey.current === baseKey) return;
    const wasDirty = JSON.stringify(draftRef.current) !== lastBaseKey.current;
    lastBaseKey.current = baseKey;
    if (!wasDirty) setDraftState(baselineRef.current);
  }, [baseKey]);

  const action = useAction(async () => optsRef.current.submit(draftRef.current, baselineRef.current));

  const set = useCallback((patch: Partial<D>) => {
    setDraftState((d) => ({ ...d, ...patch }));
    setSaved(false);
    setClientErrors({});
  }, []);

  const dirty = JSON.stringify(draft) !== baseKey;

  const save = useCallback(async () => {
    setSaved(false);
    const errs = optsRef.current.validate?.(draftRef.current, baselineRef.current) ?? {};
    setClientErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const fresh = await action.run();
    if (fresh === undefined) return;
    const next = optsRef.current.toState(fresh);
    lastBaseKey.current = JSON.stringify(next);
    setDraftState(next);
    optsRef.current.onSaved(fresh);
    setSaved(true);
  }, [action]);

  const reset = useCallback(() => {
    setDraftState(baselineRef.current);
    setSaved(false);
    setClientErrors({});
    action.clearError();
  }, [action]);

  const apiError: ApiError | null = action.error;
  const fieldErrors = { ...issuesByPath(apiError), ...clientErrors };

  return { draft, set, dirty, save, reset, saving: action.pending, saved, apiError, fieldErrors, clientErrors };
}
