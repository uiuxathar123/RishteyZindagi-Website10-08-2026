/**
 * Homepage "Find Your Life Partner" form: a signed-out visitor is asked to log in or create an account instead of
 * searching, the chosen filters survive the trip through /login or /signup (?next=, validated by safeNext), a
 * signed-in member goes straight to /search, and repeat submits never navigate twice. Pure logic; no database.
 */
import { describe, it, expect, vi } from "vitest";
import { authHref, buildSearchHref, checkSession, createHeroSearchSubmitter, type HeroFilters, type SessionState } from "@/components/home/heroSearch";
import { safeNext } from "@/components/auth/safeNext";
import { parseFilters } from "@/components/search/searchFilters";

const NONE: HeroFilters = { gender: "", age: "", religionId: "", countryId: "", tongueId: "" };
const RELIGION = "096d5066-5919-4ee7-bb24-e715bd3a63cd";
const COUNTRY = "451cc3ec-491b-46a1-b3e1-7f6f520ede1a";
const TONGUE = "be6a8729-dc0a-43bf-8eec-d158a83f9bf0";
const CHOSEN: HeroFilters = { gender: "FEMALE", age: "26-30", religionId: RELIGION, countryId: COUNTRY, tongueId: TONGUE };

function setup(state: SessionState | Promise<SessionState>) {
  const statuses: string[] = [];
  const navigate = vi.fn();
  const check = vi.fn(async () => state);
  const submit = createHeroSearchSubmitter({ check, navigate, setStatus: (s) => statuses.push(s) });
  return { submit, navigate, check, statuses };
}

/** What LoginForm (and SignupFlow) do with ?next=: read it from the URL and pass it through safeNext. */
const nextFromAuthLink = (href: string) => safeNext(new URL(href, "http://localhost").searchParams.get("next"), "");

describe("homepage search login gate", () => {
  it("[hero-href] filters map to the same /search query as before; no filters is plain /search", () => {
    expect(buildSearchHref(NONE)).toBe("/search");
    expect(buildSearchHref(CHOSEN)).toBe(`/search?gender=FEMALE&minAge=26&maxAge=30&religionIds=${RELIGION}&countryId=${COUNTRY}&motherTongueIds=${TONGUE}`);
    expect(buildSearchHref({ ...NONE, age: "36-100" })).toBe("/search?minAge=36&maxAge=100");
  });

  it("[hero-signed-out] a signed-out submit shows the log in / create account prompt and does not navigate", async () => {
    const { submit, navigate, statuses } = setup("signed-out");
    await submit(buildSearchHref(CHOSEN));
    expect(statuses).toEqual(["checking", "needs-auth"]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("[hero-filters-survive] the login and signup links carry the search, and /search restores every chosen filter", () => {
    const href = buildSearchHref(CHOSEN);
    for (const page of ["login", "signup"] as const) {
      const link = authHref(page, href);
      expect(link.startsWith(`/${page}?next=`)).toBe(true);
      const back = nextFromAuthLink(link);
      expect(back).toBe(href);
      const restored = parseFilters(new URL(back, "http://localhost").searchParams);
      expect(restored).toMatchObject({ gender: "FEMALE", minAge: 26, maxAge: 30, religionId: RELIGION, countryId: COUNTRY, motherTongueId: TONGUE });
    }
  });

  it("[hero-signed-in] a signed-in submit goes straight to /search with the filters", async () => {
    const { submit, navigate, statuses } = setup("signed-in");
    const href = buildSearchHref(CHOSEN);
    await submit(href);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(href);
    expect(statuses).toEqual(["checking"]);
  });

  it("[hero-no-duplicates] double clicks while checking, and clicks after navigating, start nothing new", async () => {
    let resolve!: (s: SessionState) => void;
    const pending = new Promise<SessionState>((r) => (resolve = r));
    const { submit, navigate, check } = setup(pending);
    const first = submit("/search?gender=MALE");
    void submit("/search?gender=MALE");
    void submit("/search?gender=MALE");
    resolve("signed-in");
    await first;
    await submit("/search?gender=MALE");
    expect(check).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("[hero-check-failure] if the sign-in check fails the form shows an error, does not navigate, and can be retried", async () => {
    let state: SessionState = "unknown";
    const statuses: string[] = [];
    const navigate = vi.fn();
    const submit = createHeroSearchSubmitter({ check: async () => state, navigate, setStatus: (s) => statuses.push(s) });
    await submit("/search");
    expect(statuses).toEqual(["checking", "error"]);
    expect(navigate).not.toHaveBeenCalled();
    state = "signed-in";
    await submit("/search");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("[hero-session-check] the session check maps the proxy's answers and never throws", async () => {
    const res = (status: number) => vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await checkSession(res(200))).toBe("signed-in");
    expect(await checkSession(res(401))).toBe("signed-out");
    expect(await checkSession(res(500))).toBe("unknown");
    expect(await checkSession(res(503))).toBe("unknown");
    expect(await checkSession((async () => { throw new TypeError("network down"); }) as unknown as typeof fetch)).toBe("unknown");
    const spy = res(200);
    await checkSession(spy);
    expect(spy).toHaveBeenCalledWith("/bff/users/me", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it("[hero-open-redirect] external or unsafe return targets are dropped from the auth links and rejected by safeNext", () => {
    const hostile = [
      "https://evil.example/search",
      "//evil.example/search",
      "/\\evil.example",
      "javascript:alert(1)",
      "%2F%2Fevil.example",
      "/search\u0000x",
      "/login?next=/search",
      "",
    ];
    for (const target of hostile) {
      expect(authHref("login", target), JSON.stringify(target)).toBe("/login");
      expect(authHref("signup", target), JSON.stringify(target)).toBe("/signup");
      expect(safeNext(target, "/dashboard"), JSON.stringify(target)).toBe("/dashboard");
    }
    // a hand-edited link with a hostile next is refused when it is read back too
    expect(nextFromAuthLink("/login?next=https%3A%2F%2Fevil.example")).toBe("");
    expect(nextFromAuthLink("/signup?next=%2F%2Fevil.example")).toBe("");
  });
});
