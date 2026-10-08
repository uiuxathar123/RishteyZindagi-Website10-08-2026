import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchClient } from "@/components/search/SearchClient";
import { Container } from "@/components/ui/Container";
import { ProfileCardSkeleton } from "@/components/ui/States";

export const metadata: Metadata = {
  title: "Search Profiles",
  description: "Search matrimonial profiles by age, height, religion, community, location, education and more.",
  alternates: { canonical: "/search" },
};

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <Container className="py-8 md:py-12">
          <h1 className="mb-6 font-serif text-2xl font-bold text-rz-navy md:text-3xl">Search Profiles</h1>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <ProfileCardSkeleton key={i} />
            ))}
          </div>
        </Container>
      }
    >
      <SearchClient />
    </Suspense>
  );
}
