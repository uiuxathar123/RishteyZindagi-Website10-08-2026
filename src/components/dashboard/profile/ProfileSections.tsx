"use client";

import { Input, Select, Textarea } from "@/components/ui/Input";
import { LookupSelect } from "@/components/forms/LookupSelect";
import { MultiSelect } from "@/components/forms/MultiSelect";
import { api } from "@/lib/api/client";
import { groupCommunities } from "@/lib/api/lookups";
import type { FamilyDetails, Lifestyle, OwnerProfile, ReferenceOptions } from "@/lib/api/types";
import { Field, SectionCard } from "./SectionCard";
import {
  DIET_OPTIONS,
  FAMILY_TYPE_OPTIONS,
  FAMILY_VALUES_OPTIONS,
  GENDER_OPTIONS,
  HABIT_OPTIONS,
  INCOME_CURRENCIES,
  dobToInput,
  inputToInt,
  numToInput,
  sameSet,
} from "./profileForm";
import { useCities, useCommunities } from "./useReferenceLists";
import { useSection } from "./useSection";
import { useRef } from "react";

interface SectionProps {
  profile: OwnerProfile;
  reference: ReferenceOptions | null;
  onSaved: (profile: OwnerProfile) => void;
}

const patchProfile = (payload: Record<string, unknown>) =>
  api.patch<{ profile: OwnerProfile }>("/profiles/me", payload).then((r) => r.profile);

const CANNOT_CLEAR = "This can’t be removed once set — choose a different value instead.";

function ageFromInput(dob: string): number | null {
  const t = Date.parse(dob);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 365.25);
}

// ---------------------------------------------------------------------------
// Basic details
// ---------------------------------------------------------------------------
interface BasicDraft {
  gender: string;
  dob: string;
  maritalStatusId: string;
  heightCm: string;
  religionId: string;
  communityId: string;
  motherTongueId: string;
  motherTongueIds: string[];
}

const basicState = (p: OwnerProfile): BasicDraft => ({
  gender: p.gender,
  dob: dobToInput(p.dateOfBirth),
  maritalStatusId: p.maritalStatus?.id ?? "",
  heightCm: numToInput(p.heightCm),
  religionId: p.religion?.id ?? "",
  communityId: p.community?.id ?? "",
  motherTongueId: p.motherTongue?.id ?? "",
  motherTongueIds: p.motherTongueIds,
});

export function BasicSection({ profile, reference, onSaved }: SectionProps) {
  const communitiesRef = useRef<{ rows: { id: string }[]; loading: boolean }>({ rows: [], loading: false });
  const s = useSection({
    source: profile,
    toState: basicState,
    onSaved,
    validate: (d, b) => {
      const e: Record<string, string> = {};
      if (!d.dob) e.dateOfBirth = "Enter your date of birth.";
      else {
        const age = ageFromInput(d.dob);
        if (age === null) e.dateOfBirth = "Enter a valid date.";
        else if (age < 18 || age > 100) e.dateOfBirth = "Age must be between 18 and 100.";
      }
      if (b.maritalStatusId && !d.maritalStatusId) e.maritalStatusId = CANNOT_CLEAR;
      if (b.motherTongueId && !d.motherTongueId) e.motherTongueId = CANNOT_CLEAR;
      if (b.religionId && !d.religionId) e.religionId = CANNOT_CLEAR;
      if (b.heightCm && !d.heightCm.trim()) e.heightCm = CANNOT_CLEAR;
      if (d.heightCm.trim()) {
        const h = inputToInt(d.heightCm);
        if (h === undefined || h < 90 || h > 250) e.heightCm = "Height must be between 90 and 250 cm.";
      }
      const religionChanged = d.religionId !== b.religionId;
      if (!religionChanged && b.communityId && !d.communityId) e.communityId = CANNOT_CLEAR;
      if (religionChanged && d.religionId && !d.communityId && communitiesRef.current.rows.length > 0 && !communitiesRef.current.loading) {
        e.communityId = "Choose a community for the new religion.";
      }
      return e;
    },
    submit: (d, b) => {
      const p: Record<string, unknown> = {};
      if (d.gender !== b.gender) p.gender = d.gender;
      if (d.dob !== b.dob) p.dateOfBirth = d.dob;
      if (d.maritalStatusId !== b.maritalStatusId) p.maritalStatusId = d.maritalStatusId;
      if (d.heightCm !== b.heightCm) p.heightCm = inputToInt(d.heightCm);
      if (d.religionId !== b.religionId) p.religionId = d.religionId;
      if (d.communityId && (d.communityId !== b.communityId || d.religionId !== b.religionId)) p.communityId = d.communityId;
      if (d.motherTongueId !== b.motherTongueId) p.motherTongueId = d.motherTongueId;
      if (!sameSet(d.motherTongueIds, b.motherTongueIds)) p.motherTongueIds = d.motherTongueIds;
      return patchProfile(p);
    },
  });
  const { draft, set, fieldErrors } = s;
  const communities = useCommunities(draft.religionId || undefined);
  communitiesRef.current = communities;
  const showCommunity = !!draft.religionId;
  const dobAge = draft.dob === dobToInput(profile.dateOfBirth) ? profile.age : null;

  return (
    <SectionCard
      title="Basic details"
      description="Your age is worked out from your date of birth."
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["gender", "dateOfBirth", "maritalStatusId", "heightCm", "religionId", "communityId", "motherTongueId", "motherTongueIds"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="displayName" label="Full name" hint="Your name comes from your account and can’t be changed here.">
          <Input id="displayName" value={profile.displayName} readOnly disabled />
        </Field>
        <Field id="gender" label="Profile is for a" error={fieldErrors.gender}>
          <Select id="gender" value={draft.gender} onChange={(e) => set({ gender: e.target.value })}>
            {GENDER_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="dob"
          label="Date of birth"
          error={fieldErrors.dateOfBirth}
          hint={dobAge !== null ? `Age: ${dobAge}` : undefined}
        >
          <Input id="dob" type="date" value={draft.dob} onChange={(e) => set({ dob: e.target.value })} aria-invalid={!!fieldErrors.dateOfBirth} />
        </Field>
        <Field id="heightCm" label="Height (cm)" error={fieldErrors.heightCm}>
          <Input
            id="heightCm"
            type="number"
            inputMode="numeric"
            min={90}
            max={250}
            value={draft.heightCm}
            onChange={(e) => set({ heightCm: e.target.value })}
            aria-invalid={!!fieldErrors.heightCm}
          />
        </Field>
        <Field id="maritalStatusId" label="Marital status" error={fieldErrors.maritalStatusId}>
          <LookupSelect
            id="maritalStatusId"
            value={draft.maritalStatusId}
            onChange={(v) => set({ maritalStatusId: v })}
            options={reference?.maritalStatuses}
            loading={!reference}
          />
        </Field>
        <Field id="motherTongueId" label="Mother tongue" error={fieldErrors.motherTongueId}>
          <LookupSelect
            id="motherTongueId"
            value={draft.motherTongueId}
            onChange={(v) => set({ motherTongueId: v })}
            options={reference?.motherTongues}
            loading={!reference}
          />
        </Field>
        <Field id="religionId" label="Religion" error={fieldErrors.religionId}>
          <LookupSelect
            id="religionId"
            value={draft.religionId}
            onChange={(v) => set({ religionId: v, communityId: "" })}
            options={reference?.religions}
            loading={!reference}
          />
        </Field>
        {showCommunity && (
          <Field
            id="communityId"
            label="Community / caste"
            error={fieldErrors.communityId}
            hint={
              !communities.loading && communities.rows.length === 0
                ? communities.error
                  ? "Couldn’t load communities. Try again later."
                  : "No community options are available yet for this religion."
                : undefined
            }
          >
            <LookupSelect
              id="communityId"
              value={draft.communityId}
              onChange={(v) => set({ communityId: v })}
              groups={groupCommunities(communities.rows)}
              loading={communities.loading}
              disabled={!communities.loading && communities.rows.length === 0}
            />
          </Field>
        )}
      </div>
      <details className="mt-5 rounded-md border border-rz-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-rz-navy">Other languages you speak (optional)</summary>
        <div className="mt-3">
          {reference ? (
            <MultiSelect
              label="Other languages you speak"
              value={draft.motherTongueIds}
              onChange={(ids) => set({ motherTongueIds: ids })}
              options={reference.motherTongues}
            />
          ) : (
            <p className="text-sm text-rz-muted">Loading…</p>
          )}
          {fieldErrors.motherTongueIds && (
            <p role="alert" className="mt-1.5 text-xs text-rz-danger">
              {fieldErrors.motherTongueIds}
            </p>
          )}
        </div>
      </details>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
interface LocationDraft {
  countryId: string;
  cityId: string;
}
const locationState = (p: OwnerProfile): LocationDraft => ({ countryId: p.country?.id ?? "", cityId: p.city?.id ?? "" });

export function LocationSection({ profile, reference, onSaved }: SectionProps) {
  const citiesRef = useRef<{ rows: { id: string }[]; loading: boolean }>({ rows: [], loading: false });
  const s = useSection({
    source: profile,
    toState: locationState,
    onSaved,
    validate: (d, b) => {
      const e: Record<string, string> = {};
      const countryChanged = d.countryId !== b.countryId;
      if (b.countryId && !d.countryId) e.countryId = CANNOT_CLEAR;
      if (!countryChanged && b.cityId && !d.cityId) e.cityId = CANNOT_CLEAR;
      if (countryChanged && d.countryId && !d.cityId && citiesRef.current.rows.length > 0 && !citiesRef.current.loading) {
        e.cityId = "Choose a city in the new country.";
      }
      return e;
    },
    submit: (d, b) => {
      const p: Record<string, unknown> = {};
      if (d.countryId !== b.countryId) p.countryId = d.countryId;
      if (d.cityId && (d.cityId !== b.cityId || d.countryId !== b.countryId)) p.cityId = d.cityId;
      return patchProfile(p);
    },
  });
  const { draft, set, fieldErrors } = s;
  const cities = useCities(draft.countryId || undefined);
  citiesRef.current = cities;

  return (
    <SectionCard
      title="Location"
      description="Where you live now."
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["countryId", "cityId"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="countryId" label="Country" error={fieldErrors.countryId}>
          <LookupSelect
            id="countryId"
            value={draft.countryId}
            onChange={(v) => set({ countryId: v, cityId: "" })}
            options={reference?.countries}
            loading={!reference}
          />
        </Field>
        <Field
          id="cityId"
          label="City"
          error={fieldErrors.cityId}
          hint={
            draft.countryId && !cities.loading && cities.rows.length === 0
              ? cities.error
                ? "Couldn’t load cities. Try again later."
                : "No city options are available yet for this country."
              : !draft.countryId
                ? "Choose a country first."
                : undefined
          }
        >
          <LookupSelect
            id="cityId"
            value={draft.cityId}
            onChange={(v) => set({ cityId: v })}
            options={cities.rows}
            loading={cities.loading}
            disabled={!draft.countryId || (!cities.loading && cities.rows.length === 0)}
          />
        </Field>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// About me
// ---------------------------------------------------------------------------
const ABOUT_MAX = 2000;
export function AboutSection({ profile, onSaved }: Omit<SectionProps, "reference">) {
  const s = useSection({
    source: profile,
    toState: (p) => ({ aboutMe: p.aboutMe ?? "" }),
    onSaved,
    validate: (d): Record<string, string> => (d.aboutMe.length > ABOUT_MAX ? { aboutMe: `Please keep this under ${ABOUT_MAX} characters.` } : {}),
    submit: (d) => patchProfile({ aboutMe: d.aboutMe }),
  });
  const err = s.fieldErrors.aboutMe;
  return (
    <SectionCard
      title="About me"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["aboutMe"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <Field id="aboutMe" label="About me" error={err} hint="A thoughtful bio helps prospective matches understand who you are beyond the basics.">
        <Textarea id="aboutMe" rows={7} maxLength={ABOUT_MAX + 500} value={s.draft.aboutMe} onChange={(e) => s.set({ aboutMe: e.target.value })} aria-invalid={!!err} />
      </Field>
      <p className="mt-1 text-right text-xs text-rz-muted">
        {s.draft.aboutMe.length} / {ABOUT_MAX}
      </p>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Education & profession
// ---------------------------------------------------------------------------
interface CareerDraft {
  educationId: string;
  educationIds: string[];
  professionId: string;
  professionIds: string[];
}
const careerState = (p: OwnerProfile): CareerDraft => ({
  educationId: p.education?.id ?? "",
  educationIds: p.educationIds,
  professionId: p.profession?.id ?? "",
  professionIds: p.professionIds,
});

export function CareerSection({ profile, reference, onSaved }: SectionProps) {
  const s = useSection({
    source: profile,
    toState: careerState,
    onSaved,
    validate: (d, b) => {
      const e: Record<string, string> = {};
      if (b.educationId && !d.educationId) e.educationId = CANNOT_CLEAR;
      if (b.professionId && !d.professionId) e.professionId = CANNOT_CLEAR;
      return e;
    },
    submit: (d, b) => {
      const p: Record<string, unknown> = {};
      if (d.educationId !== b.educationId) p.educationId = d.educationId;
      if (!sameSet(d.educationIds, b.educationIds)) p.educationIds = d.educationIds;
      if (d.professionId !== b.professionId) p.professionId = d.professionId;
      if (!sameSet(d.professionIds, b.professionIds)) p.professionIds = d.professionIds;
      return patchProfile(p);
    },
  });
  const { draft, set, fieldErrors } = s;
  return (
    <SectionCard
      title="Education & profession"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["educationId", "educationIds", "professionId", "professionIds"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="educationId" label="Highest education" error={fieldErrors.educationId}>
          <LookupSelect id="educationId" value={draft.educationId} onChange={(v) => set({ educationId: v })} options={reference?.educations} loading={!reference} />
        </Field>
        <Field id="professionId" label="Profession" error={fieldErrors.professionId}>
          <LookupSelect id="professionId" value={draft.professionId} onChange={(v) => set({ professionId: v })} options={reference?.professions} loading={!reference} />
        </Field>
      </div>
      <details className="mt-5 rounded-md border border-rz-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-rz-navy">Additional qualifications and professions (optional)</summary>
        <div className="mt-3 space-y-4">
          {reference ? (
            <>
              <div>
                <p className="mb-2 text-[12.5px] font-semibold text-rz-muted">Other qualifications</p>
                <MultiSelect label="Other qualifications" value={draft.educationIds} onChange={(ids) => set({ educationIds: ids })} options={reference.educations} />
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-semibold text-rz-muted">Other professions</p>
                <MultiSelect label="Other professions" value={draft.professionIds} onChange={(ids) => set({ professionIds: ids })} options={reference.professions} />
              </div>
            </>
          ) : (
            <p className="text-sm text-rz-muted">Loading…</p>
          )}
        </div>
      </details>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------
interface IncomeDraft {
  incomeRange: string;
  incomeCurrency: string;
  incomeMin: string;
  incomeMax: string;
}
const incomeState = (p: OwnerProfile): IncomeDraft => ({
  incomeRange: p.incomeRange ?? "",
  incomeCurrency: p.incomeCurrency ?? "INR",
  incomeMin: numToInput(p.incomeMinAmount),
  incomeMax: numToInput(p.incomeMaxAmount),
});

function incomeLabel(currency: string, min: string, max: string): string {
  const fmt = (s: string) => {
    const n = inputToInt(s);
    return n === undefined ? "" : n.toLocaleString(currency === "INR" ? "en-IN" : "en-US");
  };
  const a = fmt(min);
  const b = fmt(max);
  if (a && b) return `${currency} ${a} – ${b} per year`;
  if (a) return `${currency} ${a}+ per year`;
  if (b) return `Up to ${currency} ${b} per year`;
  return "";
}

export function IncomeSection({ profile, onSaved }: Omit<SectionProps, "reference">) {
  const s = useSection({
    source: profile,
    toState: incomeState,
    onSaved,
    validate: (d, b) => {
      const e: Record<string, string> = {};
      if (b.incomeRange && !d.incomeRange.trim()) e.incomeRange = CANNOT_CLEAR;
      if (d.incomeRange.trim().length > 100) e.incomeRange = "Keep this under 100 characters.";
      if (!/^[A-Za-z]{3}$/.test(d.incomeCurrency)) e.incomeCurrency = "Choose a currency.";
      const lo = inputToInt(d.incomeMin);
      const hi = inputToInt(d.incomeMax);
      if (d.incomeMin.trim() && (lo === undefined || lo < 0)) e.incomeMinAmount = "Enter a whole number, 0 or more.";
      if (d.incomeMax.trim() && (hi === undefined || hi < 0)) e.incomeMaxAmount = "Enter a whole number, 0 or more.";
      if (lo !== undefined && hi !== undefined && lo > hi) e.incomeMinAmount = "Minimum must not be more than the maximum.";
      if (b.incomeMin && !d.incomeMin.trim()) e.incomeMinAmount = CANNOT_CLEAR;
      if (b.incomeMax && !d.incomeMax.trim()) e.incomeMaxAmount = CANNOT_CLEAR;
      return e;
    },
    submit: (d, b) => {
      const p: Record<string, unknown> = {};
      // The profile needs an income label to count as complete; if none was typed, derive it from the amounts entered.
      const label = d.incomeRange.trim() || incomeLabel(d.incomeCurrency, d.incomeMin, d.incomeMax);
      if (label && label !== b.incomeRange) p.incomeRange = label;
      if (d.incomeCurrency !== b.incomeCurrency) p.incomeCurrency = d.incomeCurrency;
      if (d.incomeMin !== b.incomeMin) p.incomeMinAmount = inputToInt(d.incomeMin);
      if (d.incomeMax !== b.incomeMax) p.incomeMaxAmount = inputToInt(d.incomeMax);
      return patchProfile(p);
    },
  });
  const { draft, set, fieldErrors } = s;
  const suggested = incomeLabel(draft.incomeCurrency, draft.incomeMin, draft.incomeMax);

  return (
    <SectionCard
      title="Income"
      description="Annual income, in whole units of the currency. It is used for matching and as the income shown on your profile."
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["incomeRange", "incomeCurrency", "incomeMinAmount", "incomeMaxAmount"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field id="incomeCurrency" label="Currency" error={fieldErrors.incomeCurrency}>
          <Select id="incomeCurrency" value={draft.incomeCurrency} onChange={(e) => set({ incomeCurrency: e.target.value })}>
            {(INCOME_CURRENCIES.includes(draft.incomeCurrency) ? INCOME_CURRENCIES : [draft.incomeCurrency, ...INCOME_CURRENCIES]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="incomeMin" label="Annual income — from" error={fieldErrors.incomeMinAmount}>
          <Input id="incomeMin" type="number" inputMode="numeric" min={0} value={draft.incomeMin} onChange={(e) => set({ incomeMin: e.target.value })} aria-invalid={!!fieldErrors.incomeMinAmount} />
        </Field>
        <Field id="incomeMax" label="Annual income — to" error={fieldErrors.incomeMaxAmount}>
          <Input id="incomeMax" type="number" inputMode="numeric" min={0} value={draft.incomeMax} onChange={(e) => set({ incomeMax: e.target.value })} aria-invalid={!!fieldErrors.incomeMaxAmount} />
        </Field>
        <Field id="incomeRange" label="Income as shown on your profile" error={fieldErrors.incomeRange} className="sm:col-span-3">
          <Input id="incomeRange" maxLength={100} value={draft.incomeRange} onChange={(e) => set({ incomeRange: e.target.value })} placeholder="e.g. INR 10,00,000 – 15,00,000 per year" aria-invalid={!!fieldErrors.incomeRange} />
          {suggested && suggested !== draft.incomeRange && (
            <button type="button" className="rz-focus mt-2 rounded text-xs font-semibold text-rz-maroon underline-offset-2 hover:underline" onClick={() => set({ incomeRange: suggested })}>
              Use “{suggested}”
            </button>
          )}
        </Field>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Lifestyle
// ---------------------------------------------------------------------------
interface LifestyleDraft {
  diet: string;
  smoking: string;
  drinking: string;
  disability: string;
}
const lifestyleState = (p: OwnerProfile): LifestyleDraft => ({
  diet: p.lifestyle?.diet ?? "",
  smoking: p.lifestyle?.smoking ?? "",
  drinking: p.lifestyle?.drinking ?? "",
  disability: p.lifestyle?.disability ?? "",
});

export function LifestyleSection({ profile, onSaved }: Omit<SectionProps, "reference">) {
  const s = useSection({
    source: profile,
    toState: lifestyleState,
    onSaved,
    validate: (d): Record<string, string> => (d.disability.length > 200 ? { "lifestyle.disability": "Keep this under 200 characters." } : {}),
    submit: (d) => {
      const lifestyle: Lifestyle = {};
      if (d.diet) lifestyle.diet = d.diet as Lifestyle["diet"];
      if (d.smoking) lifestyle.smoking = d.smoking as Lifestyle["smoking"];
      if (d.drinking) lifestyle.drinking = d.drinking as Lifestyle["drinking"];
      if (d.disability.trim()) lifestyle.disability = d.disability.trim();
      return patchProfile({ lifestyle });
    },
  });
  const { draft, set, fieldErrors } = s;
  return (
    <SectionCard
      title="Lifestyle"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["lifestyle"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field id="diet" label="Diet" error={fieldErrors["lifestyle.diet"]}>
          <Select id="diet" value={draft.diet} onChange={(e) => set({ diet: e.target.value })}>
            <option value="">Not specified</option>
            {DIET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="smoking" label="Smoking" error={fieldErrors["lifestyle.smoking"]}>
          <Select id="smoking" value={draft.smoking} onChange={(e) => set({ smoking: e.target.value })}>
            <option value="">Not specified</option>
            {HABIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="drinking" label="Drinking" error={fieldErrors["lifestyle.drinking"]}>
          <Select id="drinking" value={draft.drinking} onChange={(e) => set({ drinking: e.target.value })}>
            <option value="">Not specified</option>
            {HABIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="disability" label="Disability (optional)" error={fieldErrors["lifestyle.disability"]} className="sm:col-span-3">
          <Input id="disability" maxLength={200} value={draft.disability} onChange={(e) => set({ disability: e.target.value })} aria-invalid={!!fieldErrors["lifestyle.disability"]} />
        </Field>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------
interface FamilyDraft {
  familyType: string;
  familyValues: string;
  fatherOccupation: string;
  motherOccupation: string;
  siblings: string;
  notes: string;
}
const familyState = (p: OwnerProfile): FamilyDraft => ({
  familyType: p.familyDetails?.familyType ?? "",
  familyValues: p.familyDetails?.familyValues ?? "",
  fatherOccupation: p.familyDetails?.fatherOccupation ?? "",
  motherOccupation: p.familyDetails?.motherOccupation ?? "",
  siblings: numToInput(p.familyDetails?.siblings),
  notes: p.familyDetails?.notes ?? "",
});

export function FamilySection({ profile, onSaved }: Omit<SectionProps, "reference">) {
  const s = useSection({
    source: profile,
    toState: familyState,
    onSaved,
    validate: (d) => {
      const e: Record<string, string> = {};
      if (d.siblings.trim()) {
        const n = inputToInt(d.siblings);
        if (n === undefined || n < 0 || n > 20) e["familyDetails.siblings"] = "Enter a number from 0 to 20.";
      }
      if (d.fatherOccupation.length > 200) e["familyDetails.fatherOccupation"] = "Keep this under 200 characters.";
      if (d.motherOccupation.length > 200) e["familyDetails.motherOccupation"] = "Keep this under 200 characters.";
      if (d.notes.length > 1000) e["familyDetails.notes"] = "Keep this under 1000 characters.";
      return e;
    },
    submit: (d) => {
      const fd: FamilyDetails = {};
      if (d.familyType) fd.familyType = d.familyType as FamilyDetails["familyType"];
      if (d.familyValues) fd.familyValues = d.familyValues as FamilyDetails["familyValues"];
      if (d.fatherOccupation.trim()) fd.fatherOccupation = d.fatherOccupation.trim();
      if (d.motherOccupation.trim()) fd.motherOccupation = d.motherOccupation.trim();
      const sib = inputToInt(d.siblings);
      if (sib !== undefined) fd.siblings = sib;
      if (d.notes.trim()) fd.notes = d.notes.trim();
      return patchProfile({ familyDetails: fd });
    },
  });
  const { draft, set, fieldErrors } = s;
  return (
    <SectionCard
      title="Family"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.apiError}
      clientErrors={s.clientErrors}
      knownPaths={["familyDetails"]}
      onSave={s.save}
      onReset={s.reset}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="familyType" label="Family type" error={fieldErrors["familyDetails.familyType"]}>
          <Select id="familyType" value={draft.familyType} onChange={(e) => set({ familyType: e.target.value })}>
            <option value="">Not specified</option>
            {FAMILY_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="familyValues" label="Family values" error={fieldErrors["familyDetails.familyValues"]}>
          <Select id="familyValues" value={draft.familyValues} onChange={(e) => set({ familyValues: e.target.value })}>
            <option value="">Not specified</option>
            {FAMILY_VALUES_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="fatherOccupation" label="Father’s occupation" error={fieldErrors["familyDetails.fatherOccupation"]}>
          <Input id="fatherOccupation" maxLength={200} value={draft.fatherOccupation} onChange={(e) => set({ fatherOccupation: e.target.value })} />
        </Field>
        <Field id="motherOccupation" label="Mother’s occupation" error={fieldErrors["familyDetails.motherOccupation"]}>
          <Input id="motherOccupation" maxLength={200} value={draft.motherOccupation} onChange={(e) => set({ motherOccupation: e.target.value })} />
        </Field>
        <Field id="siblings" label="Siblings" error={fieldErrors["familyDetails.siblings"]}>
          <Input id="siblings" type="number" inputMode="numeric" min={0} max={20} value={draft.siblings} onChange={(e) => set({ siblings: e.target.value })} aria-invalid={!!fieldErrors["familyDetails.siblings"]} />
        </Field>
        <Field id="familyNotes" label="Anything else about your family" error={fieldErrors["familyDetails.notes"]} className="sm:col-span-2">
          <Textarea id="familyNotes" rows={3} maxLength={1000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </SectionCard>
  );
}
