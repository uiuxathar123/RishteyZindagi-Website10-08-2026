"use client";

import { Calendar, Globe2, Heart, Languages, LockKeyhole, Search, SlidersHorizontal, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Hero.module.css";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FieldLabel, Select } from "@/components/ui/Input";
import { useReference } from "@/lib/api/lookups";
import type { LookupRow } from "@/lib/api/types";
import { HOME_REFERENCE_QUERY } from "./browseLookups";
import { AGE_BANDS, authHref, buildSearchHref, checkSession, createHeroSearchSubmitter, type HeroSearchStatus } from "./heroSearch";

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
 * and the API all agree). Every field is optional. Searching needs an
 * account: a signed-out visitor is offered log in / create account, and the
 * chosen filters come back with them through `?next=` (see heroSearch.ts).
 */
export function HeroSearchForm() {
  const router = useRouter();
  // Same request as the "browse by" sections below, so the homepage fetches reference data once.
  const ref = useReference(HOME_REFERENCE_QUERY);
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [religionId, setReligionId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [tongueId, setTongueId] = useState("");

  const [status, setStatus] = useState<HeroSearchStatus>("idle");
  const promptRef = useRef<HTMLHeadingElement>(null);
  const searchHref = buildSearchHref({ gender, age, religionId, countryId, tongueId });
  const submitSearch = useMemo(
    () => createHeroSearchSubmitter({ check: () => checkSession(), navigate: (href) => router.push(href), setStatus }),
    [router]
  );

  useEffect(() => {
    if (status === "needs-auth") promptRef.current?.focus();
  }, [status]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void submitSearch(searchHref);
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

      {status === "needs-auth" && (
        <div role="region" aria-labelledby="rz-search-login-title" className="mb-3 rounded-lg border border-rz-border bg-rz-cream p-4 text-left">
          <h2 id="rz-search-login-title" ref={promptRef} tabIndex={-1} className="flex items-center gap-2 font-serif text-base font-semibold text-rz-navy outline-none">
            <LockKeyhole className="h-4 w-4 text-rz-maroon" aria-hidden />
            Log in to see matching profiles
          </h2>
          <p className="mt-1 text-[13px] text-rz-muted">Create a free account or log in. We&apos;ll keep the filters you chose.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ButtonLink href={authHref("login", searchHref)} size="sm" fullWidth>
              Log in
            </ButtonLink>
            <ButtonLink href={authHref("signup", searchHref)} variant="outline" size="sm" fullWidth>
              Create account
            </ButtonLink>
          </div>
        </div>
      )}
      {status === "error" && (
        <p role="alert" className="mb-3 text-xs text-rz-danger">
          We couldn&apos;t check whether you&apos;re signed in. Please try again.
        </p>
      )}

      <Button type="submit" fullWidth icon={<Search className="h-4 w-4" />} disabled={status === "checking"} aria-busy={status === "checking"}>
        {status === "checking" ? "Checking…" : "Search Profiles"}
      </Button>
      <Link href="/search" className="rz-focus mt-3.5 flex w-full items-center justify-center gap-1.5 py-1.5 text-[13.5px] font-semibold text-rz-muted hover:text-rz-maroon">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Advanced Search
      </Link>
    </form>
  );
}
