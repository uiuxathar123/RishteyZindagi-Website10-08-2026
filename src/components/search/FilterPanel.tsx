"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Select } from "@/components/ui/Input";
import { LookupSelect } from "@/components/forms/LookupSelect";
import { groupCommunities, useReference } from "@/lib/api/lookups";
import { formatHeight } from "@/lib/format";
import { DEFAULT_FILTERS, type SearchFilters } from "./searchFilters";

const AGES = Array.from({ length: 53 }, (_, i) => 18 + i); // 18..70
const HEIGHTS = Array.from({ length: 13 }, (_, i) => 140 + i * 5); // 140..200 cm

/**
 * Search filters. The values come from the URL (`value`), edits stay in a
 * draft until "Apply Filters", and every option list is the backend's own
 * reference data (religion, community within a religion, country, city
 * within a country, mother tongue, education, profession, marital status).
 */
export function FilterPanel({
  value,
  onApply,
  onReset,
  idPrefix = "f",
}: {
  value: SearchFilters;
  onApply: (next: SearchFilters) => void;
  onReset: () => void;
  idPrefix?: string;
}) {
  const [draft, setDraft] = useState<SearchFilters>(value);
  const [problem, setProblem] = useState<string | null>(null);
  const urlKey = JSON.stringify(value);
  useEffect(() => {
    setDraft(value);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  const ref = useReference({ religionId: draft.religionId, countryId: draft.countryId });
  const loading = ref.loading;
  const set = (patch: Partial<SearchFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const id = (name: string) => `${idPrefix}-${name}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (draft.minAge && draft.maxAge && draft.minAge > draft.maxAge) {
      setProblem("The minimum age can't be higher than the maximum age.");
      return;
    }
    if (draft.minHeightCm && draft.maxHeightCm && draft.minHeightCm > draft.maxHeightCm) {
      setProblem("The minimum height can't be higher than the maximum height.");
      return;
    }
    setProblem(null);
    onApply({ ...draft, page: 1 });
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Search filters">
      <div>
        <FieldLabel htmlFor={id("looking-for")}>Looking for</FieldLabel>
        <Select id={id("looking-for")} value={draft.gender ?? ""} onChange={(e) => set({ gender: (e.target.value || undefined) as SearchFilters["gender"] })}>
          <option value="">Anyone</option>
          <option value="FEMALE">Bride</option>
          <option value="MALE">Groom</option>
        </Select>
      </div>

      <div>
        <FieldLabel>Age Range</FieldLabel>
        <div className="flex items-center gap-2">
          <Select value={draft.minAge ?? ""} onChange={(e) => set({ minAge: e.target.value ? Number(e.target.value) : undefined })} aria-label="Minimum age">
            <option value="">Min</option>
            {AGES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <span className="text-rz-muted">–</span>
          <Select value={draft.maxAge ?? ""} onChange={(e) => set({ maxAge: e.target.value ? Number(e.target.value) : undefined })} aria-label="Maximum age">
            <option value="">Max</option>
            {AGES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <FieldLabel>Height</FieldLabel>
        <div className="flex items-center gap-2">
          <Select value={draft.minHeightCm ?? ""} onChange={(e) => set({ minHeightCm: e.target.value ? Number(e.target.value) : undefined })} aria-label="Minimum height">
            <option value="">Min</option>
            {HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {formatHeight(h)}
              </option>
            ))}
          </Select>
          <span className="text-rz-muted">–</span>
          <Select value={draft.maxHeightCm ?? ""} onChange={(e) => set({ maxHeightCm: e.target.value ? Number(e.target.value) : undefined })} aria-label="Maximum height">
            <option value="">Max</option>
            {HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {formatHeight(h)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <FieldLabel htmlFor={id("marital")}>Marital Status</FieldLabel>
        <LookupSelect id={id("marital")} value={draft.maritalStatusId ?? ""} onChange={(v) => set({ maritalStatusId: v || undefined })} options={ref.data?.maritalStatuses} placeholder="Any" loading={loading} />
      </div>

      <div>
        <FieldLabel htmlFor={id("religion")}>Religion</FieldLabel>
        <LookupSelect
          id={id("religion")}
          value={draft.religionId ?? ""}
          onChange={(v) => set({ religionId: v || undefined, communityId: undefined })}
          options={ref.data?.religions}
          placeholder="Any Religion"
          loading={loading && !ref.data}
        />
      </div>

      {draft.religionId && ref.data?.communities && ref.data.communities.length > 0 && (
        <div>
          <FieldLabel htmlFor={id("community")}>Community / Caste</FieldLabel>
          <LookupSelect id={id("community")} value={draft.communityId ?? ""} onChange={(v) => set({ communityId: v || undefined })} groups={groupCommunities(ref.data.communities)} placeholder="Any" />
        </div>
      )}

      <div>
        <FieldLabel htmlFor={id("tongue")}>Mother Tongue</FieldLabel>
        <LookupSelect id={id("tongue")} value={draft.motherTongueId ?? ""} onChange={(v) => set({ motherTongueId: v || undefined })} options={ref.data?.motherTongues} placeholder="Any Language" loading={loading && !ref.data} />
      </div>

      <div>
        <FieldLabel htmlFor={id("education")}>Education</FieldLabel>
        <LookupSelect id={id("education")} value={draft.educationId ?? ""} onChange={(v) => set({ educationId: v || undefined })} options={ref.data?.educations} placeholder="Any" loading={loading && !ref.data} />
      </div>

      <div>
        <FieldLabel htmlFor={id("profession")}>Profession</FieldLabel>
        <LookupSelect id={id("profession")} value={draft.professionId ?? ""} onChange={(v) => set({ professionId: v || undefined })} options={ref.data?.professions} placeholder="Any" loading={loading && !ref.data} />
      </div>

      <div>
        <FieldLabel htmlFor={id("country")}>Country</FieldLabel>
        <LookupSelect
          id={id("country")}
          value={draft.countryId ?? ""}
          onChange={(v) => set({ countryId: v || undefined, cityId: undefined })}
          options={ref.data?.countries}
          placeholder="Any Country"
          loading={loading && !ref.data}
        />
      </div>

      {draft.countryId && ref.data?.cities && ref.data.cities.length > 0 && (
        <div>
          <FieldLabel htmlFor={id("city")}>City</FieldLabel>
          <LookupSelect id={id("city")} value={draft.cityId ?? ""} onChange={(v) => set({ cityId: v || undefined })} options={ref.data.cities} placeholder="Any City" />
        </div>
      )}

      {ref.error && (
        <p role="alert" className="text-xs text-rz-danger">
          Some filter options could not be loaded. Reload the page to try again.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs text-rz-danger">
          {problem}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button type="submit" fullWidth>
          Apply Filters
        </Button>
        <Button type="button" variant="ghost" onClick={() => { setDraft({ ...DEFAULT_FILTERS, sortBy: value.sortBy, sortDir: value.sortDir }); setProblem(null); onReset(); }}>
          Reset
        </Button>
      </div>
    </form>
  );
}
