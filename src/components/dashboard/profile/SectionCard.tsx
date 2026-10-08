"use client";

import { Button } from "@/components/ui/Button";
import type { ApiError } from "@/lib/api/errors";
import { CheckCircle2 } from "lucide-react";
import { ReactNode } from "react";
import { unmappedIssues } from "./profileForm";

/** A heading + fields + its own Save / Discard row. Success is only shown by the caller after the API resolved. */
export function SectionCard({
  title,
  description,
  dirty,
  saving,
  saved,
  error,
  knownPaths,
  clientErrors,
  onSave,
  onReset,
  saveLabel = "Save changes",
  savedLabel = "Saved",
  savedExtra,
  children,
}: {
  title: string;
  description?: string;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: ApiError | null;
  /** Field paths rendered inline; other validation issues are listed in the alert. */
  knownPaths: string[];
  clientErrors?: Record<string, string>;
  onSave: () => void;
  onReset: () => void;
  saveLabel?: string;
  savedLabel?: string;
  savedExtra?: ReactNode;
  children: ReactNode;
}) {
  const leftovers = error ? unmappedIssues(error, knownPaths) : [];
  const hasClientErrors = clientErrors && Object.keys(clientErrors).length > 0;
  return (
    <section className="border-t border-rz-border pt-6 first:border-t-0 first:pt-0" aria-label={title}>
      <h3 className="font-serif text-lg font-semibold text-rz-navy">{title}</h3>
      {description && <p className="mt-1 text-sm text-rz-muted">{description}</p>}
      <div className="mt-5">{children}</div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3" aria-live="polite">
        {error && (
          <div role="alert" className="mr-auto min-w-0 flex-1 rounded-md border border-rz-danger/30 bg-rz-danger/5 px-3 py-2 text-sm text-rz-danger">
            <p>{error.kind === "validation" ? error.message : error.friendlyMessage}</p>
            {leftovers.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-[13px]">
                {leftovers.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!error && hasClientErrors && (
          <p role="alert" className="mr-auto text-sm text-rz-danger">
            Please fix the highlighted fields.
          </p>
        )}
        {!error && !hasClientErrors && saved && !dirty && (
          <p className="mr-auto flex items-center gap-1.5 text-sm font-medium text-rz-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {savedLabel}
            {savedExtra}
          </p>
        )}
        {!error && !hasClientErrors && dirty && !saving && <p className="mr-auto text-sm text-rz-muted">You have unsaved changes.</p>}
        <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={onReset}>
          Discard
        </Button>
        <Button type="button" disabled={!dirty || saving} onClick={onSave}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </section>
  );
}

/** Label + control + inline error/hint, with the error wired for assistive tech. */
export function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-semibold text-rz-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-rz-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-rz-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
