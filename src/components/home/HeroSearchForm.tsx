"use client";

import { Calendar, Globe2, Heart, Languages, Search, SlidersHorizontal, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import styles from "./Hero.module.css";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Select } from "@/components/ui/Input";
import { useReference } from "@/lib/api/lookups";
import type { LookupRow } from "@/lib/api/types";

const AGE_BANDS = [
  { value: "21-25", label: "21 – 25", min: 21, max: 25 },
  { value: "26-30", label: "26 – 30", min: 26, max: 30 },
  { value: "31-35", label: "31 – 35", min: 31, max: 35 },
  { value: "36-100", label: "36+", min: 36, max: 100 },
];

function Options({ rows, loading }: { rows?: LookupRow[]; loading: boolean }) {
  if (!rows) return loading ? <option value="" disabled>Loading…</option> : null;
  return (
    <>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </>
  );
}

/**
 * The hero search form. Religion, country and mother-tongue options are the
 * backend's own reference rows, and submitting opens /search with the same
 * query parameters GET /search/profiles takes (so the results page, the URL
 * and the API all agree). Every field is optional.
 */
export function HeroSearchForm() {
  const router = useRouter();
  const ref = useReference();
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [religionId, setReligionId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [tongueId, setTongueId] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (gender) q.set("gender", gender);
    const band = AGE_BANDS.find((b) => b.value === age);
    if (band) {
      q.set("minAge", String(band.min));
      q.set("maxAge", String(band.max));
    }
    if (religionId) q.set("religionIds", religionId);
    if (countryId) q.set("countryId", countryId);
    if (tongueId) q.set("motherTongueIds", tongueId);
    const s = q.toString();
    router.push(s ? `/search?${s}` : "/search");
  }

  return (
    <form className="w-full" onSubmit={submit} aria-label="Search profiles">
      <div className={styles.fields}>
        <div>
          <FieldLabel htmlFor="rz-looking-for">Looking for</FieldLabel>
          <Select id="rz-looking-for" value={gender} onChange={(e) => setGender(e.target.value)} icon={<User className="h-4 w-4" />}>
            <option value="">Anyone</option>
            <option value="FEMALE">Bride</option>
            <option value="MALE">Groom</option>
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="rz-age">Age Range</FieldLabel>
          <Select id="rz-age" value={age} onChange={(e) => setAge(e.target.value)} icon={<Calendar className="h-4 w-4" />}>
            <option value="">Any Age</option>
            {AGE_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="rz-religion">Religion</FieldLabel>
          <Select id="rz-religion" value={religionId} onChange={(e) => setReligionId(e.target.value)} icon={<Heart className="h-4 w-4" />}>
            <option value="">Any Religion</option>
            <Options rows={ref.data?.religions} loading={ref.loading} />
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="rz-location">Location</FieldLabel>
          <Select id="rz-location" value={countryId} onChange={(e) => setCountryId(e.target.value)} icon={<Globe2 className="h-4 w-4" />}>
            <option value="">Any Country</option>
            <Options rows={ref.data?.countries} loading={ref.loading} />
          </Select>
        </div>
        <div className={styles.fieldFull}>
          <FieldLabel htmlFor="rz-tongue">Mother Tongue</FieldLabel>
          <Select id="rz-tongue" value={tongueId} onChange={(e) => setTongueId(e.target.value)} icon={<Languages className="h-4 w-4" />}>
            <option value="">Any Language</option>
            <Options rows={ref.data?.motherTongues} loading={ref.loading} />
          </Select>
        </div>
      </div>
      {ref.error && (
        <p role="alert" className="-mt-2 mb-3 text-xs text-rz-danger">
          Some options could not be loaded, but you can still search.
        </p>
      )}

      <Button type="submit" fullWidth icon={<Search className="h-4 w-4" />}>
        Search Profiles
      </Button>
      <Link href="/search" className="rz-focus mt-3.5 flex w-full items-center justify-center gap-1.5 py-1.5 text-[13.5px] font-semibold text-rz-muted hover:text-rz-maroon">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Advanced Search
      </Link>
    </form>
  );
}
