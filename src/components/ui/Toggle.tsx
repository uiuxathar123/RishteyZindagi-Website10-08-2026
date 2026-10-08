"use client";

import { cn } from "@/lib/utils";

/** Accessible on/off switch — used throughout Dashboard Settings and
 * Admin Settings wherever a boolean preference needs a control (not a
 * checkbox, which reads as a form field rather than a live toggle). */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start justify-between gap-4 py-3",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-rz-text">{label}</span>
        {description && <span className="mt-0.5 text-xs text-rz-muted">{description}</span>}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        aria-label={label}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={cn(
          "rz-focus relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
          checked ? "bg-rz-maroon" : "bg-rz-border"
        )}
      >
        <span
          className={cn(
            "inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-card-sm transition-transform duration-200",
            checked ? "translate-x-[22px]" : "translate-x-[3px]"
          )}
        />
      </span>
    </label>
  );
}
