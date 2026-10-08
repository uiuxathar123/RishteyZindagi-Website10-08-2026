"use client";

import { cn } from "@/lib/utils";
import type { LookupRow } from "@/lib/api/types";

/** Toggle-chip multi-select over backend reference rows (value = UUIDs). */
export function MultiSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  options: LookupRow[];
  label: string;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.id)}
            className={cn(
              "rz-focus rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              on ? "border-rz-maroon bg-rz-maroon text-white" : "border-rz-border bg-white text-rz-text hover:border-rz-maroon/50"
            )}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
