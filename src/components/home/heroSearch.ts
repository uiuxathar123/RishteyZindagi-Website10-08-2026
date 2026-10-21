/**
 * The homepage "Find Your Life Partner" form asks visitors to sign in before it runs a search. The search API
 * itself stays public (signed-out visitors get the anonymised view, which the homepage's featured profiles also
 * use), so this gate belongs to the form, not the API. The chosen filters travel through the existing,
 * validated `?next=` return path of the login and signup pages.
 */
import { safeNext } from "@/components/auth/safeNext";

export const AGE_BANDS = [
  { value: "21-25", label: "21 – 25", min: 21, max: 25 },
  { value: "26-30", label: "26 – 30", min: 26, max: 30 },
  { value: "31-35", label: "31 – 35", min: 31, max: 35 },
  { value: "36-100", label: "36+", min: 36, max: 100 },
];

export interface HeroFilters {
  gender: string;
  age: string;
  religionId: string;
  countryId: string;
  tongueId: string;
}

/** The /search URL for the chosen filters, in the query parameters GET /search/profiles takes. */
export function buildSearchHref(f: HeroFilters): string {
  const q = new URLSearchParams();
  if (f.gender) q.set("gender", f.gender);
  const band = AGE_BANDS.find((b) => b.value === f.age);
  if (band) {
    q.set("minAge", String(band.min));
    q.set("maxAge", String(band.max));
  }
  if (f.religionId) q.set("religionIds", f.religionId);
  if (f.countryId) q.set("countryId", f.countryId);
  if (f.tongueId) q.set("motherTongueIds", f.tongueId);
  const s = q.toString();
  return s ? `/search?${s}` : "/search";
}

/** /login or /signup carrying a return destination; anything that is not a safe local path is dropped. */
export function authHref(page: "login" | "signup", next: string | null | undefined): string {
  const safe = safeNext(next, "");
  return safe ? `/${page}?next=${encodeURIComponent(safe)}` : `/${page}`;
}

export type SessionState = "signed-in" | "signed-out" | "unknown";

/** Asks the session proxy who is signed in — the same check the site header makes. */
export async function checkSession(fetchImpl: typeof fetch = fetch): Promise<SessionState> {
  try {
    const res = await fetchImpl("/bff/users/me", { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
    if (res.ok) return "signed-in";
    if (res.status === 401) return "signed-out";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export type HeroSearchStatus = "idle" | "checking" | "needs-auth" | "error";

/**
 * Submit handler for the form: one check at a time (double clicks and repeat submits while checking are
 * ignored), navigation only for a signed-in visitor, and never more than one navigation per submit.
 */
export function createHeroSearchSubmitter(deps: {
  check: () => Promise<SessionState>;
  navigate: (href: string) => void;
  setStatus: (s: HeroSearchStatus) => void;
}) {
  let inFlight = false;
  let navigated = false;
  return async function submit(href: string): Promise<void> {
    if (inFlight || navigated) return;
    inFlight = true;
    deps.setStatus("checking");
    try {
      const state = await deps.check();
      if (state === "signed-in") {
        // Stays "checking" (button disabled) and ignores further submits while the search page loads.
        navigated = true;
        deps.navigate(href);
        return;
      }
      deps.setStatus(state === "signed-out" ? "needs-auth" : "error");
    } finally {
      inFlight = false;
    }
  };
}
