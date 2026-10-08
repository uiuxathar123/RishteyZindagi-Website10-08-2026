"use client";

import { Select } from "@/components/ui/Input";
import type { LookupRow } from "@/lib/api/types";

/** Single-select over backend reference rows; value is the row's UUID ("" = none). */
export function LookupSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled,
  loading,
  groups,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  options?: LookupRow[];
  /** Optional grouped options (used for communities). */
  groups?: Array<{ sect: string; items: Array<LookupRow & { label: string }> }>;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Select id={id} value={value} disabled={disabled || loading} onChange={(e) => onChange(e.target.value)}>
      <option value="">{loading ? "Loading…" : placeholder}</option>
      {groups
        ? groups.map((g) => (
            <optgroup key={g.sect} label={g.sect}>
              {g.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))
        : (options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
    </Select>
  );
}
