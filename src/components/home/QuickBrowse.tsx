"use client";

import Link from "next/link";
import { pickPreferred, searchHref, useBrowseLookups } from "./browseLookups";
import { Container } from "@/components/ui/Container";

/**
 * Quick filter chips. Each chip is built from a real reference-data row and
 * opens /search with that row's id; a chip whose row doesn't exist in the
 * backend's lists is simply not shown.
 */
export function QuickBrowse() {
  const { base, failed, india, indianCities } = useBrowseLookups();
  if (failed) return null;
  if (!base) return <div className="min-h-[68px] border-b border-rz-border bg-white" aria-hidden="true" />;

  const find = (rows: { id: string; name: string }[], name: string) => rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  const chips: Array<{ label: string; href: string }> = [];

  for (const name of ["Hindu", "Muslim", "Christian", "Sikh"]) {
    const r = find(base.religions, name);
    if (r) chips.push({ label: `${name} Matrimony`, href: searchHref({ religionIds: r.id }) });
  }
  for (const [label, name] of [["Doctors", "Doctor"], ["Engineers", "Software Engineer"]] as const) {
    const r = find(base.professions, name);
    if (r) chips.push({ label, href: searchHref({ professionIds: r.id }) });
  }
  const divorced = find(base.maritalStatuses, "Divorced");
  if (divorced) chips.push({ label: "Divorcee Remarriage", href: searchHref({ maritalStatusIds: divorced.id }) });
  if (india) {
    for (const c of pickPreferred(indianCities, ["Mumbai", "Delhi", "Bengaluru"], 3)) {
      chips.push({ label: c.name, href: searchHref({ countryId: india.id, cityId: c.id }) });
    }
  }
  const uae = base.countries.find((c) => /emirates|uae/i.test(c.name));
  if (uae) chips.push({ label: "UAE", href: searchHref({ countryId: uae.id }) });

  if (chips.length === 0) return null;
  return (
    <div className="border-b border-rz-border bg-white">
      <Container className="flex flex-wrap items-center gap-2.5 py-5">
        <span className="mr-1 text-[13px] font-semibold text-rz-muted">Browse by:</span>
        {chips.map((chip) => (
          <Link
            key={chip.label}
            href={chip.href}
            className="rz-focus rounded-full border border-rz-border px-3.5 py-1.5 text-[13px] font-medium text-rz-text transition-colors hover:border-rz-maroon hover:text-rz-maroon"
          >
            {chip.label}
          </Link>
        ))}
      </Container>
    </div>
  );
}
