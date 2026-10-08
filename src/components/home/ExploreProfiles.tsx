"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { pickPreferred, searchHref, useBrowseLookups } from "./browseLookups";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Skeleton } from "@/components/ui/States";

/**
 * "Explore" shortcuts. Every entry is a real reference-data row (religion,
 * Indian city, profession, country) and links to /search with that row's id,
 * so a click always lands on a filtered result list. Nothing is listed if the
 * reference data could not be loaded.
 */
export function ExploreProfiles() {
  const { loading, failed, base, india, indianCities } = useBrowseLookups();

  const groups = base
    ? [
        {
          title: "By Religion",
          items: pickPreferred(base.religions, ["Hindu", "Muslim", "Christian", "Sikh", "Jain"], 5).map((r) => ({ label: r.name, href: searchHref({ religionIds: r.id }) })),
        },
        {
          title: "By City",
          items: india
            ? pickPreferred(indianCities, ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad"], 5).map((c) => ({ label: c.name, href: searchHref({ countryId: india.id, cityId: c.id }) }))
            : [],
        },
        {
          title: "By Profession",
          items: pickPreferred(base.professions, ["Doctor", "Software Engineer", "Chartered Accountant", "Business Owner", "Government"], 5).map((p) => ({ label: p.name, href: searchHref({ professionIds: p.id }) })),
        },
        {
          title: "By Country",
          items: pickPreferred(base.countries, ["India", "United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait"], 5).map((c) => ({ label: c.name, href: searchHref({ countryId: c.id }) })),
        },
      ].filter((g) => g.items.length > 0)
    : [];

  return (
    <Section className="bg-rz-cream">
      <Container>
        <SectionHeading eyebrow="Explore" title="Explore Matrimonial Profiles" align="left" />
        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-rz-muted">
            {failed ? "Browse shortcuts couldn't be loaded right now. " : ""}
            You can still{" "}
            <Link href="/search" className="rz-focus font-semibold text-rz-maroon underline underline-offset-2">
              search all profiles
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {groups.map((cat) => (
              <div key={cat.title} className="rounded-lg border border-rz-border bg-white p-5">
                <p className="mb-3 font-serif text-base font-semibold text-rz-navy">{cat.title}</p>
                <ul className="space-y-2">
                  {cat.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="rz-focus group flex items-center justify-between text-[13.5px] text-rz-muted hover:text-rz-maroon">
                        {item.label}
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}
