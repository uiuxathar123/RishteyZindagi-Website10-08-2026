"use client";

import { SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { FilterPanel, type AdvancedAccess } from "./FilterPanel";
import { PAGE_SIZE, SORT_OPTIONS, activeFilterCount, advancedFilterCount, parseFilters, toQuery, toSearchString, withoutAdvanced, type SearchFilters } from "./searchFilters";
import { Pager } from "@/components/profile/Pager";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { fromSearchItem } from "@/components/profile/cardModel";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState, ErrorState, ProfileCardSkeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { Page, SearchItem } from "@/lib/api/types";

export function SearchClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(qs)), [qs]);
  const apiKey = JSON.stringify(toQuery(filters, { forApi: true }));

  const results = useAsync(
    (signal) => api.get<Page<SearchItem>>("/search/profiles", { query: toQuery(filters, { forApi: true }), signal }),
    [apiKey]
  );

  // Which filters this caller may use (a UI hint — the server enforces the rule on every search).
  const accessState = useAsync((signal) => api.get<{ audience: "visitor" | "member"; advancedSearch: boolean }>("/search/access", { signal }), []);
  const here0 = toSearchString(filters);
  const access: AdvancedAccess = {
    allowed: accessState.data ? accessState.data.advancedSearch : true, // unknown yet → don't flash a lock; a 403 is handled below
    audience: accessState.data?.audience ?? "member",
    loginHref: `/login?next=${encodeURIComponent(here0 ? `/search?${here0}` : "/search")}`,
  };
  const entitlementBlocked =
    !!results.error && results.error.status === 403 && results.error.details.some((d) => d.path === "entitlement");

  const go = (next: SearchFilters) => {
    const s = toSearchString(next);
    router.push(s ? `${pathname}?${s}` : pathname);
  };
  const reset = () => router.push(pathname);

  const data = results.data;
  const cards = useMemo(() => (data ? data.items.map(fromSearchItem) : []), [data]);
  const visitor = !!data && data.items.length > 0 && data.items.every((i) => i.audience === "anonymous");
  const sortValue = `${filters.sortBy}:${filters.sortDir}`;
  const here = toSearchString(filters);
  const loginNext = here ? `/search?${here}` : "/search";
  const count = activeFilterCount(filters);

  return (
    <Container className="py-8 md:py-12">
      <div className="mb-6 flex flex-col gap-2 border-b border-rz-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-rz-navy md:text-3xl">Search Profiles</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-rz-muted" aria-live="polite">
            <Users className="h-4 w-4" />
            {data ? `${data.total} profile${data.total === 1 ? "" : "s"} ${count ? "match your filters" : "found"}` : results.loading ? "Searching…" : "—"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-rz-muted">
          Sort by
          <select
            className="rz-focus rounded-md border border-rz-border bg-white px-3 py-2 text-sm text-rz-text"
            value={sortValue}
            onChange={(e) => {
              const [sortBy, sortDir] = e.target.value.split(":") as [SearchFilters["sortBy"], SearchFilters["sortDir"]];
              go({ ...filters, sortBy, sortDir, page: 1 });
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Mobile: collapsible native <details> sheet */}
        <details className="group rounded-lg border border-rz-border bg-white lg:hidden">
          <summary className="rz-focus flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-rz-navy">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Filters{count ? ` (${count})` : ""}
            </span>
            <span className="text-rz-muted transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-rz-border p-4">
            <FilterPanel idPrefix="m" value={filters} onApply={go} onReset={reset} access={access} />
          </div>
        </details>

        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-lg border border-rz-border bg-white p-5">
            <p className="mb-4 flex items-center gap-2 font-serif text-base font-semibold text-rz-navy">
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </p>
            <FilterPanel idPrefix="d" value={filters} onApply={go} onReset={reset} access={access} />
          </div>
        </aside>

        <div className="min-w-0">
          {visitor && (
            <div className="mb-5 rounded-lg border border-rz-gold/40 bg-rz-champagne/50 px-4 py-3 text-sm text-rz-navy">
              You&apos;re browsing as a visitor, so photos, names and full details are hidden.{" "}
              <Link href={`/login?next=${encodeURIComponent(loginNext)}`} className="rz-focus font-semibold text-rz-maroon underline underline-offset-2">
                Log in
              </Link>{" "}
              or{" "}
              <Link href="/signup" className="rz-focus font-semibold text-rz-maroon underline underline-offset-2">
                create a free profile
              </Link>{" "}
              to see more.
            </div>
          )}

          {entitlementBlocked ? (
            <div role="alert" className="rounded-lg border border-rz-gold/40 bg-rz-champagne/50 p-6 text-center" data-testid="advanced-search-blocked">
              <h2 className="font-serif text-lg font-semibold text-rz-navy">Advanced search needs a plan</h2>
              <p className="mt-1 text-sm text-rz-text">
                {results.error?.friendlyMessage} {advancedFilterCount(filters) > 0 ? `This link uses ${advancedFilterCount(filters)} advanced filter${advancedFilterCount(filters) === 1 ? "" : "s"}.` : ""}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Button variant="outline" size="sm" onClick={() => go(withoutAdvanced(filters))}>
                  Search without them
                </Button>
                {access.audience === "visitor" ? (
                  <Link href={access.loginHref} className="rz-focus text-sm font-semibold text-rz-maroon underline underline-offset-2">Log in</Link>
                ) : (
                  <Link href="/membership" className="rz-focus text-sm font-semibold text-rz-maroon underline underline-offset-2">See plans</Link>
                )}
              </div>
            </div>
          ) : data === null && results.loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading profiles">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProfileCardSkeleton key={i} />
              ))}
            </div>
          ) : data === null && results.error ? (
            results.error.kind === "validation" ? (
              <ErrorState
                title="Those filters can't be used"
                description={results.error.friendlyMessage}
                onRetry={reset}
              />
            ) : (
              <ApiErrorView error={results.error} onRetry={results.reload} />
            )
          ) : data && data.items.length === 0 ? (
            <EmptyState
              title="No profiles found"
              description={count ? "Try widening your age range or clearing a filter." : "No members are visible yet. Check back soon."}
              action={count ? <Button variant="outline" size="sm" onClick={reset}>Clear all filters</Button> : undefined}
            />
          ) : data ? (
            <div className={results.loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={results.loading}>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((c) => (
                  <ProfileCard key={c.profileId} profile={c} loginNext={loginNext} />
                ))}
              </div>
              {results.error && (
                <p role="alert" className="mt-4 text-sm text-rz-danger">
                  Couldn&apos;t refresh: {results.error.friendlyMessage}
                </p>
              )}
              <Pager page={data.page} totalPages={data.totalPages} disabled={results.loading} onPage={(p) => go({ ...filters, page: p })} label="Search results pages" />
              <p className="mt-2 text-center text-xs text-rz-muted">
                Showing {(data.page - 1) * PAGE_SIZE + 1}–{(data.page - 1) * PAGE_SIZE + data.items.length} of {data.total}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Container>
  );
}
