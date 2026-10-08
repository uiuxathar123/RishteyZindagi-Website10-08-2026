"use client";

import { AsyncView } from "@/components/ui/AsyncView";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { LookupSelect } from "@/components/forms/LookupSelect";
import { MultiSelect } from "@/components/forms/MultiSelect";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import { groupCommunities, loadReference } from "@/lib/api/lookups";
import type { PartnerPreferences, ReferenceOptions } from "@/lib/api/types";
import Link from "next/link";
import { useRef } from "react";
import { Field, SectionCard } from "./SectionCard";
import { GENDER_OPTIONS, INCOME_CURRENCIES, inputToInt, numToInput, sameSet } from "./profileForm";
import { useCitiesForCountries, useCommunities } from "./useReferenceLists";
import { useSection } from "./useSection";

interface Draft {
  ageMin: string;
  ageMax: string;
  heightMinCm: string;
  heightMaxCm: string;
  genderPreference: string;
  religionId: string;
  maritalStatusIds: string[];
  communityIds: string[];
  motherTongueIds: string[];
  educationIds: string[];
  professionAny: boolean;
  professionIds: string[];
  countryIds: string[];
  cityIds: string[];
  incomeCurrency: string;
  incomeMin: string;
  incomeMax: string;
  notes: string;
}

/** `null` = the member has never saved preferences (the API answers with `preferences: null`). */
type Source = { prefs: PartnerPreferences | null };

const toState = ({ prefs: p }: Source): Draft => ({
  ageMin: numToInput(p?.ageMin),
  ageMax: numToInput(p?.ageMax),
  heightMinCm: numToInput(p?.heightMinCm),
  heightMaxCm: numToInput(p?.heightMaxCm),
  genderPreference: p?.genderPreference ?? "",
  religionId: p?.religion?.id ?? "",
  maritalStatusIds: p?.maritalStatusIds ?? [],
  communityIds: p?.communityIds ?? [],
  motherTongueIds: p?.motherTongueIds ?? [],
  educationIds: p?.educationIds ?? [],
  professionAny: p?.professionAny ?? false,
  professionIds: p?.professionIds ?? [],
  countryIds: p?.countryIds ?? [],
  cityIds: p?.cityIds ?? [],
  incomeCurrency: p?.incomeCurrency ?? "INR",
  incomeMin: numToInput(p?.incomeMinAmount),
  incomeMax: numToInput(p?.incomeMaxAmount),
  notes: p?.notes ?? "",
});

const CANNOT_CLEAR = "A value can’t be removed once saved — widen the range instead.";

export function PartnerPreferencesPanel({ reference }: { reference: ReferenceOptions | null }) {
  const load = useAsync(async (signal) => {
    const r = await api.get<{ preferences: PartnerPreferences | null }>("/profiles/me/partner-preferences", { signal });
    return { prefs: r.preferences } as Source;
  }, []);

  return (
    <AsyncView data={load.data} error={load.error} loading={load.loading} reload={load.reload}>
      {(source) => <PreferencesForm source={source} reference={reference} onSaved={(s) => load.setData(s)} />}
    </AsyncView>
  );
}

function PreferencesForm({ source, reference, onSaved }: { source: Source; reference: ReferenceOptions | null; onSaved: (s: Source) => void }) {
  const s = useSection<Source, Draft>({
    source,
    toState,
    onSaved,
    validate: (d, b) => {
      const e: Record<string, string> = {};
      const ageMin = inputToInt(d.ageMin);
      const ageMax = inputToInt(d.ageMax);
      const hMin = inputToInt(d.heightMinCm);
      const hMax = inputToInt(d.heightMaxCm);
      const iMin = inputToInt(d.incomeMin);
      const iMax = inputToInt(d.incomeMax);
      if (d.ageMin.trim() && (ageMin === undefined || ageMin < 18 || ageMin > 100)) e.ageMin = "Age must be between 18 and 100.";
      if (d.ageMax.trim() && (ageMax === undefined || ageMax < 18 || ageMax > 100)) e.ageMax = "Age must be between 18 and 100.";
      if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax && !e.ageMin) e.ageMin = "“From” must not be more than “to”.";
      if (d.heightMinCm.trim() && (hMin === undefined || hMin < 90 || hMin > 250)) e.heightMinCm = "Height must be between 90 and 250 cm.";
      if (d.heightMaxCm.trim() && (hMax === undefined || hMax < 90 || hMax > 250)) e.heightMaxCm = "Height must be between 90 and 250 cm.";
      if (hMin !== undefined && hMax !== undefined && hMin > hMax && !e.heightMinCm) e.heightMinCm = "“From” must not be more than “to”.";
      if (d.incomeMin.trim() && (iMin === undefined || iMin < 0)) e.incomeMinAmount = "Enter a whole number, 0 or more.";
      if (d.incomeMax.trim() && (iMax === undefined || iMax < 0)) e.incomeMaxAmount = "Enter a whole number, 0 or more.";
      if (iMin !== undefined && iMax !== undefined && iMin > iMax && !e.incomeMinAmount) e.incomeMinAmount = "“From” must not be more than “to”.";
      for (const k of ["ageMin", "ageMax", "heightMinCm", "heightMaxCm"] as const) if (b[k] && !d[k].trim()) e[k] = CANNOT_CLEAR;
      if (b.incomeMin && !d.incomeMin.trim()) e.incomeMinAmount = CANNOT_CLEAR;
      if (b.incomeMax && !d.incomeMax.trim()) e.incomeMaxAmount = CANNOT_CLEAR;
      if (b.genderPreference && !d.genderPreference) e.genderPreference = CANNOT_CLEAR;
      if (b.religionId && !d.religionId) e.religionId = CANNOT_CLEAR;
      if (d.notes.length > 1000) e.notes = "Keep this under 1000 characters.";
      return e;
    },
    submit: async (d, b) => {
      const p: Record<string, unknown> = {};
      const num = (draft: string, base: string, key: string) => {
        if (draft !== base) {
          const n = inputToInt(draft);
          if (n !== undefined) p[key] = n;
        }
      };
      num(d.ageMin, b.ageMin, "ageMin");
      num(d.ageMax, b.ageMax, "ageMax");
      num(d.heightMinCm, b.heightMinCm, "heightMinCm");
      num(d.heightMaxCm, b.heightMaxCm, "heightMaxCm");
      num(d.incomeMin, b.incomeMin, "incomeMinAmount");
      num(d.incomeMax, b.incomeMax, "incomeMaxAmount");
      if (d.genderPreference !== b.genderPreference) p.genderPreference = d.genderPreference;
      if (d.religionId !== b.religionId) p.religionId = d.religionId;
      for (const k of ["maritalStatusIds", "communityIds", "motherTongueIds", "educationIds", "countryIds", "cityIds"] as const) {
        if (!sameSet(d[k], b[k])) p[k] = d[k];
      }
      if (d.professionAny !== b.professionAny) p.professionAny = d.professionAny;
      // professionIds must be empty whenever "any profession" is on.
      if (d.professionAny) {
        if (b.professionIds.length > 0) p.professionIds = [];
      } else if (!sameSet(d.professionIds, b.professionIds)) p.professionIds = d.professionIds;
      if (d.incomeCurrency !== b.incomeCurrency || ((p.incomeMinAmount !== undefined || p.incomeMaxAmount !== undefined) && !source.prefs?.incomeCurrency)) {
        p.incomeCurrency = d.incomeCurrency;
      }
      if (d.notes !== b.notes) p.notes = d.notes;
      const r = await api.patch<{ preferences: PartnerPreferences }>("/profiles/me/partner-preferences", p);
      return { prefs: r.preferences };
    },
  });
  const { draft, set, fieldErrors } = s;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const communities = useCommunities(draft.religionId || undefined);
  const cities = useCitiesForCountries(draft.countryIds);
  const notConfigured = source.prefs === null;

  const unknownPaths = ["ageMin", "ageMax", "heightMinCm", "heightMaxCm", "genderPreference", "religionId", "maritalStatusIds", "communityIds", "motherTongueIds", "educationIds", "professionAny", "professionIds", "countryIds", "cityIds", "incomeMinAmount", "incomeMaxAmount", "incomeCurrency", "notes"];

  return (
    <div>
      {notConfigured && !s.saved && (
        <div className="mb-5 rounded-md border border-rz-gold/40 bg-rz-champagne px-4 py-3 text-sm text-rz-gold-deep">
          You haven’t set partner preferences yet. Until you do, recommendations can’t be personalised to you. Leave anything you don’t mind about empty — empty means “no restriction”.
        </div>
      )}
      <SectionCard
        title="Partner preferences"
        description="Who you’d like to be matched with. Only you can see these."
        dirty={s.dirty}
        saving={s.saving}
        saved={s.saved}
        error={s.apiError}
        clientErrors={s.clientErrors}
        knownPaths={unknownPaths}
        onSave={s.save}
        onReset={s.reset}
        saveLabel="Save preferences"
        savedLabel="Preferences saved. "
        savedExtra={
          <Link href="/dashboard/matches" className="ml-1 font-semibold text-rz-maroon underline underline-offset-2">
            Your recommendations now use them — see your matches
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="pref-ageMin" label="Preferred age — from" error={fieldErrors.ageMin}>
            <Input id="pref-ageMin" type="number" inputMode="numeric" min={18} max={100} value={draft.ageMin} onChange={(e) => set({ ageMin: e.target.value })} aria-invalid={!!fieldErrors.ageMin} />
          </Field>
          <Field id="pref-ageMax" label="Preferred age — to" error={fieldErrors.ageMax}>
            <Input id="pref-ageMax" type="number" inputMode="numeric" min={18} max={100} value={draft.ageMax} onChange={(e) => set({ ageMax: e.target.value })} aria-invalid={!!fieldErrors.ageMax} />
          </Field>
          <Field id="pref-heightMin" label="Preferred height — from (cm)" error={fieldErrors.heightMinCm}>
            <Input id="pref-heightMin" type="number" inputMode="numeric" min={90} max={250} value={draft.heightMinCm} onChange={(e) => set({ heightMinCm: e.target.value })} aria-invalid={!!fieldErrors.heightMinCm} />
          </Field>
          <Field id="pref-heightMax" label="Preferred height — to (cm)" error={fieldErrors.heightMaxCm}>
            <Input id="pref-heightMax" type="number" inputMode="numeric" min={90} max={250} value={draft.heightMaxCm} onChange={(e) => set({ heightMaxCm: e.target.value })} aria-invalid={!!fieldErrors.heightMaxCm} />
          </Field>
          <Field id="pref-gender" label="Looking for a" error={fieldErrors.genderPreference}>
            <Select id="pref-gender" value={draft.genderPreference} onChange={(e) => set({ genderPreference: e.target.value })}>
              <option value="">No preference</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="pref-religion" label="Preferred religion" error={fieldErrors.religionId}>
            <LookupSelect
              id="pref-religion"
              value={draft.religionId}
              onChange={(v) => set({ religionId: v, communityIds: [] })}
              options={reference?.religions}
              loading={!reference}
              placeholder="Any religion"
            />
          </Field>
        </div>

        <div className="mt-6 space-y-6">
          {draft.religionId && (
            <PrefGroup label="Preferred communities / castes" error={fieldErrors.communityIds}>
              {communities.loading ? (
                <p className="text-sm text-rz-muted">Loading…</p>
              ) : communities.rows.length === 0 ? (
                <p className="text-sm text-rz-muted">No community options are available for this religion.</p>
              ) : (
                <div className="space-y-3">
                  {groupCommunities(communities.rows).map((g) => (
                    <div key={g.sect}>
                      <p className="mb-1.5 text-xs font-semibold text-rz-muted">{g.sect}</p>
                      <MultiSelect
                        label={`Communities — ${g.sect}`}
                        value={draft.communityIds}
                        onChange={(ids) => {
                          const others = draft.communityIds.filter((id) => !g.items.some((i) => i.id === id));
                          set({ communityIds: [...others, ...ids.filter((id) => g.items.some((i) => i.id === id))] });
                        }}
                        options={g.items.map((i) => ({ id: i.id, name: i.label }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </PrefGroup>
          )}
          {!draft.religionId && <p className="text-xs text-rz-muted">Choose a preferred religion to pick preferred communities.</p>}

          <PrefGroup label="Preferred marital status" error={fieldErrors.maritalStatusIds}>
            <MultiSelect label="Preferred marital status" value={draft.maritalStatusIds} onChange={(ids) => set({ maritalStatusIds: ids })} options={reference?.maritalStatuses ?? []} />
          </PrefGroup>
          <PrefGroup label="Preferred mother tongue" error={fieldErrors.motherTongueIds}>
            <MultiSelect label="Preferred mother tongue" value={draft.motherTongueIds} onChange={(ids) => set({ motherTongueIds: ids })} options={reference?.motherTongues ?? []} />
          </PrefGroup>
          <PrefGroup label="Preferred education" error={fieldErrors.educationIds}>
            <MultiSelect label="Preferred education" value={draft.educationIds} onChange={(ids) => set({ educationIds: ids })} options={reference?.educations ?? []} />
          </PrefGroup>
          <PrefGroup label="Preferred profession" error={fieldErrors.professionIds}>
            <label className="mb-3 flex items-center gap-2 text-sm text-rz-text">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#A51E3B]"
                checked={draft.professionAny}
                onChange={(e) => set({ professionAny: e.target.checked, professionIds: e.target.checked ? [] : draft.professionIds })}
              />
              Any profession
            </label>
            {!draft.professionAny && (
              <MultiSelect label="Preferred profession" value={draft.professionIds} onChange={(ids) => set({ professionIds: ids })} options={reference?.professions ?? []} />
            )}
          </PrefGroup>
          <PrefGroup label="Preferred country of residence" error={fieldErrors.countryIds}>
            <MultiSelect
              label="Preferred country"
              value={draft.countryIds}
              onChange={(ids) => {
                set({ countryIds: ids });
                const removed = draft.countryIds.filter((c) => !ids.includes(c));
                if (removed.length > 0) {
                  // Drop the cities that belonged to the countries just deselected.
                  void Promise.all(removed.map((c) => loadReference({ countryId: c })))
                    .then((all) => {
                      const gone = new Set(all.flatMap((d) => (d.cities ?? []).map((x) => x.id)));
                      set({ cityIds: draftRef.current.cityIds.filter((id) => !gone.has(id)) });
                    })
                    .catch(() => undefined);
                }
              }}
              options={reference?.countries ?? []}
            />
          </PrefGroup>
          {draft.countryIds.length > 0 && (
            <PrefGroup label="Preferred cities" error={fieldErrors.cityIds}>
              {cities.loading ? (
                <p className="text-sm text-rz-muted">Loading…</p>
              ) : cities.rows.length === 0 ? (
                <p className="text-sm text-rz-muted">No city options are available for the selected countries.</p>
              ) : (
                <MultiSelect label="Preferred cities" value={draft.cityIds} onChange={(ids) => set({ cityIds: ids })} options={cities.rows} />
              )}
            </PrefGroup>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field id="pref-currency" label="Income currency" error={fieldErrors.incomeCurrency}>
            <Select id="pref-currency" value={draft.incomeCurrency} onChange={(e) => set({ incomeCurrency: e.target.value })}>
              {(INCOME_CURRENCIES.includes(draft.incomeCurrency) ? INCOME_CURRENCIES : [draft.incomeCurrency, ...INCOME_CURRENCIES]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="pref-incomeMin" label="Annual income — from" error={fieldErrors.incomeMinAmount}>
            <Input id="pref-incomeMin" type="number" inputMode="numeric" min={0} value={draft.incomeMin} onChange={(e) => set({ incomeMin: e.target.value })} aria-invalid={!!fieldErrors.incomeMinAmount} />
          </Field>
          <Field id="pref-incomeMax" label="Annual income — to" error={fieldErrors.incomeMaxAmount}>
            <Input id="pref-incomeMax" type="number" inputMode="numeric" min={0} value={draft.incomeMax} onChange={(e) => set({ incomeMax: e.target.value })} aria-invalid={!!fieldErrors.incomeMaxAmount} />
          </Field>
        </div>

        <Field id="pref-notes" label="Anything else you’re looking for" error={fieldErrors.notes} className="mt-6">
          <Textarea id="pref-notes" rows={3} maxLength={1000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        <p className="mt-4 text-xs text-rz-muted">
          Choosing nothing in a list means no restriction. Single values (age, height, income, religion) can be changed but not removed once saved — widen the range if you want to relax one.
        </p>
      </SectionCard>
    </div>
  );
}

function PrefGroup({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-semibold text-rz-muted">{label}</p>
      {children}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-rz-danger">
          {error}
        </p>
      )}
    </div>
  );
}
