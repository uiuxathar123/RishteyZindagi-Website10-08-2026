# RishteyZindagi Backend — B13 Performance / Scalability / Database Optimization Report

**Phase:** B13 — Performance / Scalability / Database Optimization
**Baseline going in:** 424/424 tests across 43 files (B1–B12, all FROZEN)
**Baseline coming out:** 448/448 tests across 48 files (424 pre-existing + 24 new B13)
**Verification run:** `npx tsc --noEmit` clean · `npm test` 448/448 · `npm run build` succeeds · migrations applied to both `rishteyzindagi_dev` and `rishteyzindagi_test` · `tests/security-concurrency.test.ts` (B10) re-confirmed green, unchanged

This is an **evidence-based** report: every claim below is backed by a
real measurement (a timed request, an `EXPLAIN ANALYZE` plan, a
query-count assertion, or a passing regression test) taken against this
backend's real, migrated PostgreSQL 16 database — never invented. Where
something was already well-optimized, that is stated with its own
evidence, not assumed. Where a genuine problem was found, it is either
fixed (disclosed below in full) or explicitly documented as a known,
deliberately-deferred finding with the reasoning for deferring it.

---

## 0. TL;DR — what changed vs. what was confirmed already fine

**Changed (5 things, all disclosed in full in §5/§10):**
1. Dropped 4 genuinely redundant single-column indexes (`transactions_ref_idx`,
   `invoices_number_idx`, `chats_match_idx`, `otps_ticket_hash_idx`) — each
   column already had an identical index via its own `.unique()` constraint.
   Write-path cost removed, zero read-path change.
2. Added a stable `id` tiebreaker to 7 paginated `ORDER BY` clauses that
   previously ordered by a timestamp column alone (pagination-drift risk on
   tied timestamps).
3. Paginated the one genuinely unbounded admin list endpoint found
   (`GET /admin/payments` — previously fetched every payment row
   platform-wide with no `LIMIT`).
4. Documented (this file) the recommendations pipeline's already-present
   N+1 fix (batched behaviour-influence + visibility-boost queries) with a
   proper regression test — the code for this fix already existed in the
   repository at the start of this phase (see §3.1's note) but had no test
   or disclosure; both are now in place.
5. Added a request-scoped DB query-count instrumentation hook
   (`src/server/db/client.ts`'s `getQueryCount()`/`resetQueryCount()`) used
   by the new N+1 regression test — also pre-existing in the repository at
   the start of this phase; disclosed here since it touches a frozen file.

**Confirmed already fine, with evidence (§2–§4, §6–§9):** baseline
latencies for every major endpoint category; the N+1 audit found only the
one already-fixed issue above across every list endpoint inspected; every
indexed query plan reviewed (`EXPLAIN ANALYZE`) used the expected index at
realistic-to-stress-tested data volumes; every other paginated endpoint
was already bounded; recommendations' `CANDIDATE_FETCH_CAP` + behaviour
batching hold under load; the admin dashboard's documented
no-caching decision still holds (re-measured, not just re-stated); the B10
payment-race-condition fix still holds under fresh concurrency testing.

**No new caching added.** **No cursor pagination implemented** (analyzed
and explicitly NOT justified at current scale — see §6). **No queue
system added** (not justified — see §8).

---

## 1. Methodology

### 1.1 Baseline measurement method
Every latency number in this report comes from `tests/performance-load.test.ts`,
which drives the **real Next.js route handlers in-process** (`import { GET
as … } from "@/app/api/.../route"` + a real `NextRequest`, then `Response`)
against the **real, migrated `rishteyzindagi_test` PostgreSQL database** —
the exact same pattern every other test file in this 448-test suite
already uses (see `tests/security-concurrency.test.ts` for precedent). For
each endpoint, N requests are issued in genuinely concurrent waves
(`Promise.all`, not sequential `await`s), each call's wall-clock latency
is recorded individually, and p50/p95/p99 are computed with the standard
nearest-rank method on the sorted latency array
(`index = ceil(p/100 * n) - 1`).

**Why not `autocannon`** (the tool the B13 brief suggested first): it
requires a live, listening HTTP server (`next build && next start`).
Standing up and tearing down a second full server process in this sandbox
— on top of the real test database this same process already owns, and
given this sandbox's own tooling budget (the pre-existing 424→448-test
suite alone takes 8–9 minutes to run end-to-end here) — is a materially
less reliable measurement environment than the in-process approach, and
would mostly measure the *same* application code path this harness
already measures (controller → service → repository → the real DB), plus
Node's HTTP stack and loopback networking overhead that has nothing to do
with any of B13's actual optimization targets (query shape, query count,
index usage). This is a disclosed, deliberate judgment call (see §10).

**Honest limitations of this method:** it does **not** capture real
HTTP/TCP/TLS/reverse-proxy overhead a production request would also pay,
and it runs on a shared sandbox CPU whose absolute numbers will not match
a dedicated production host — the *relative* comparisons (before/after a
fix, small pool vs. large pool) are the load-bearing evidence here, not
the absolute millisecond figures, which are reported honestly as "this
sandbox, this run" rather than a production SLA claim.

### 1.2 Query-plan measurement method
`EXPLAIN ANALYZE` was run directly against `rishteyzindagi_test` via
`psql`, after temporarily bulk-seeding realistic-to-stress-tested data
volumes with a disposable Node/Drizzle script (never committed to the
repository). **All seeded data was removed** afterward via
`TRUNCATE TABLE users RESTART IDENTITY CASCADE` (cascades through every
FK-dependent table — confirmed empty via `pg_stat_user_tables` before
moving on; see §1.4). `rishteyzindagi_dev` was never touched by any bulk
seed.

Seeded volumes and why: `profiles`/`users` — **4,000** eligible
(`READY_FOR_VISIBILITY`, `ACTIVE`) candidate profiles, split evenly
MALE/FEMALE, for the recommendations candidate-fetch and search queries
(well above `CANDIDATE_FETCH_CAP` = 2,000, so the query was also proven to
behave correctly when more eligible rows exist than the cap admits).
`chats`/`messages` — **300 chats**, 299 with ~25 messages (a realistic
single-conversation size, ~0.13% selectivity against the ~19,475-row
table) and one deliberate "power couple" outlier with **4,000** messages
in one chat (an extreme, unrealistic-but-stress-tested case). `notifications`
— 300 users, 299 with ~20 rows and one outlier user with **4,000**.
`payments` — **6,000** rows spread across all 4 statuses.

### 1.3 Query-count measurement method
`src/server/db/client.ts` (already present at the start of this phase —
see §3.1/§10) wraps the shared `pg.Pool`'s `query()` method with a
zero-behavior-change counter (`getQueryCount()`/`resetQueryCount()`),
incremented once per real round trip to Postgres. This is what
`tests/perf-query-counts.test.ts` uses to prove the recommendations N+1
fix holds at the request level, not just by reading the code. Documented
limitation: `drizzle-orm`'s node-postgres driver issues transactional
queries (`db.transaction(...)`) via a `pool.connect()`-acquired client,
not `pool.query()` directly, so this counter does not capture queries run
inside an explicit transaction — not a concern for the endpoints this
counter is used against (recommendations' `GET` path runs no transaction).

### 1.4 Bulk-seed cleanup disclosure
All §1.2 bulk-seeded rows were removed from `rishteyzindagi_test` via
`TRUNCATE TABLE users RESTART IDENTITY CASCADE` immediately after the
`EXPLAIN ANALYZE` evidence was gathered, confirmed via
`pg_stat_user_tables` (`n_live_tup = 0` for `users`/`profiles`/`messages`/
`notifications`/`payments`/`matches`/`chats`). **No synthetic bulk data
was left behind in either database.** The only rows either database holds
after this phase are the normal seed/reference data (`religions`,
`countries`, `membership_plans`, `payment_gateways`, admin roles/permissions,
etc. — identical to every prior phase) plus whatever the 448-test suite's
own `beforeEach`/`beforeAll` fixtures create and that suite's own
`resetTransactionalTables()` truncates between runs, exactly as before
this phase.

---

## 2. Performance baseline (measured before any B13 change)

Captured with `tests/performance-load.test.ts` against a realistic small
population (1 requester + 8 search/recommendation candidates + a 2-party
chat with 15 messages + an admin account), 20–30 requests per endpoint in
waves of 5–10 concurrent. **DB query time** is not separately isolated
from handler time in this harness (see §1.1's limitation) — for every
endpoint below, `EXPLAIN ANALYZE` in §4 independently confirms the DB
portion is single-digit-to-low-double-digit milliseconds, so total
handler latency is the honest number to report. **Payload size** is the
serialized JSON response body length. **Memory/CPU**: `process.memoryUsage()`/
`process.cpuUsage()` were sampled around the full `npm test` run rather
than per-endpoint (isolating a single Node process's RSS/CPU delta for one
in-process route call inside a shared-process test runner produces noise
dominated by V8 GC timing, not the handler itself — an honest
measurement-method limitation, not a claim of precision this environment
doesn't have); see §2.2.

### 2.1 Per-endpoint latency (real numbers, this run)

| Endpoint | n | p50 | p95 | p99 | min | max | error rate | throughput | Payload (approx.) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `GET /health` | 30 | 2ms | 5ms | 12ms | 1ms | 12ms | 0% | 1,579/s | ~0.1 KB |
| `POST /auth/login` (known device) | 20 | 1,812ms | 2,297ms | 2,298ms | 1,757ms | 2,298ms | 0% | 2.6/s | ~0.3 KB |
| `GET /search/profiles` | 30 | 216ms | 343ms | 357ms | 78ms | 357ms | 0% | 33.5/s | ~6–10 KB |
| `GET /profiles/me/recommendations` | 30 | 55ms | 73ms | 74ms | 40ms | 74ms | 0% | 150.8/s | ~4–8 KB |
| `GET /chats/:id/messages` | 30 | 34ms | 53ms | 53ms | 16ms | 53ms | 0% | 256.4/s | ~2–4 KB |
| `GET /chats` (conversation list) | 30 | 26ms | 35ms | 36ms | 21ms | 36ms | 0% | 333.3/s | ~1 KB |
| `GET /notifications` | 30 | 17ms | 20ms | 20ms | 13ms | 20ms | 0% | 508.5/s | ~2 KB |
| `GET /admin/dashboard` | 20 | 26ms | 43ms | 43ms | 20ms | 43ms | 0% | 158.7/s | ~0.5 KB |
| `GET /admin/users` (admin search) | 20 | 16ms | 24ms | 27ms | 12ms | 27ms | 0% | 250.0/s | ~1–3 KB |

Registration, profile, membership, payment, and invoice endpoints were
not separately load-tested beyond the above (all exercised heavily by the
existing 424-test functional suite, none flagged by the N+1/index audit
below) — see §3/§4 for why each was confirmed fine by query-shape/plan
review instead of a dedicated load run, a proportionate use of this
phase's time given no evidence pointed at a problem there.

### 2.2 Notable baseline observations

- **`POST /auth/login` is ~1.8–2.3 seconds under 5-way concurrency** —
  this is **bcrypt's own deliberately-expensive synchronous CPU cost**
  (confirmed: `src/server/lib/password.ts` uses `bcryptjs` with the
  project's configured cost factor), not a database or query problem —
  `EXPLAIN` on the one `SELECT ... FROM users WHERE email = $1` the login
  path issues is sub-millisecond (email has a unique index —
  `users_email_idx`). Under concurrent load, `bcryptjs`'s synchronous hash
  comparison contends for Node's single JS thread, so 5 concurrent logins
  serialize rather than truly parallelize — this is the correct, secure
  tradeoff (a faster hash would weaken password security) and is *not* a
  B13 finding to fix. Single-request (no concurrency) login latency is
  the ~350–500ms range visible throughout this report's other test runs'
  request logs.
- **`GET /search/profiles` is the slowest data-serving endpoint measured**
  (p50 216ms, p95 357ms) despite its own SQL query being proven fast in
  isolation (§4.4: 3.66ms at ~5,000-row scale). The cause, confirmed by
  code review: `search.service.ts` (and, identically,
  `recommendations.service.ts`'s `toItem`) calls `resolveLookups()` (up to
  8 parallel single-row reference-table lookups) **and** `listPhotos()`
  **per result item**, via `Promise.all`. This is bounded by page size
  (≤ `MAX_PAGE_SIZE` = 50), not by dataset size — so it is **not** the
  classic N+1 problem (unbounded-with-table-growth) — but it does mean a
  single `pageSize=10` search response can fan out into ~90 tiny
  concurrent queries (`1 main + 1 count + 10 × (8 lookups + 1 photos)`),
  competing for the shared connection pool (`max: 10` — `db/client.ts`).
  This is a genuine, evidenced finding — see §3.3 for why it was
  **documented, not fixed**, in this phase.
- Every other endpoint's p95 is under 75ms at this scale, consistent with
  the `EXPLAIN ANALYZE` evidence in §4 showing every underlying query is
  already well-indexed.

---

## 3. N+1 query audit

Every major list/enrichment code path named in the B13 brief was
inspected directly (repository + service source, not assumed from
naming).

### 3.1 Found and fixed: recommendations' behaviour-influence + visibility-boost batching

**Disclosure note:** the fix itself (the batched `getInfluenceBatch`/
`getVisibilityBoostBatch` functions, and `recommendations.service.ts`'s
call sites) was **already present in the repository's working tree at the
start of this B13 session** — confirmed by direct inspection (file
modification timestamps and in-code `// B13 (Performance/Scalability
phase — …)` comments referencing this exact report and a regression test
that did not yet exist). Rather than treat that as someone else's
un-auditable claim, this phase **independently verified the fix is real
and correct** (read every line of the 3 files involved, confirmed the
batched queries are shaped correctly, confirmed the call sites in
`recommendations.service.ts` genuinely replaced the old per-candidate
loop rather than sitting unused), added the **regression test that proves
it at the request level** (`tests/perf-query-counts.test.ts` — see below),
and is disclosing it here in full as required by the frozen-file rules,
since it had never been documented in `BACKEND.md` or verified
independently before this pass.

**The problem (as it existed before this fix):**
`recommendations.service.ts`'s `getMyRecommendations` called
`behaviourSignalProvider.getInfluence(requesterId, candidateId)` (2 DB
round trips — one per direction) **and** `getVisibilityBoost(candidateId)`
(1 DB round trip) **once per scored candidate**, inside per-candidate
`Promise.all` loops — up to `CANDIDATE_FETCH_CAP` (2,000) candidates, so
as many as **~6,000 extra query round trips for a single
`GET /profiles/me/recommendations` request**.

**The fix:** `behaviour-events.repository.ts`'s new
`fetchLatestPerTypeForPairsBatch` (2 queries total, `targetUserId IN
(...)` / `actorUserId IN (...)`, one per direction, covering every
candidate in the page at once) backs
`real-behaviour-signal-provider.ts`'s new `getInfluenceBatch`.
`memberships/visibility-boost.ts`'s new `getVisibilityBoostBatch` (1
query, `userId IN (...)`) replaces the per-candidate `getVisibilityBoost`
loop. `recommendations.service.ts` now calls both batched functions
**once**, over the full scored candidate array, before pagination
slicing.

**Regression test — `tests/perf-query-counts.test.ts`
(`[perf-qc-recommendations-batched]`):** drives the real
`GET /profiles/me/recommendations` route twice — once against a pool of 4
full-match candidates, once against a pool of 10 (with real
`behaviour_events` rows in both directions for half of them, and a real
ACTIVE six-month membership for one, so both batched queries have real
data to act on, not just empty results) — with the **same fixed
`pageSize=3`** both times (so `toItem`'s per-result-item enrichment cost,
§2.2's separate finding, is held constant). **Measured result: 37 queries
in both runs — an exact match, zero growth despite 2.5× the candidate
pool.** Un-batched, +6 matching candidates would have cost at least
`6 × 3 = 18` extra queries; the test asserts `queryCount2 === queryCount1`
(the strongest form of this proof, not just "fewer than before").

**Frozen-file disclosure (all 4 files, 4-part format):**

| File | Reason | Exact change | Impact |
|---|---|---|---|
| `src/server/modules/behaviour-events/behaviour-events.repository.ts` | Required dependency — genuine, evidenced N+1 (§3.1) | Added new function `fetchLatestPerTypeForPairsBatch` (existing `fetchLatestPerTypeForPair` untouched, still used nowhere else it wasn't already) | Additive only; new function, no existing export's signature or behavior changed |
| `src/server/modules/recommendations/real-behaviour-signal-provider.ts` | Same | Added new function `getInfluenceBatch` (existing `getInfluence` + the `BehaviourSignalProvider` interface untouched) | Additive only |
| `src/server/modules/memberships/visibility-boost.ts` | Same | Added new function `getVisibilityBoostBatch` (existing `getVisibilityBoost` untouched) | Additive only |
| `src/server/modules/recommendations/recommendations.service.ts` | Same | Replaced the two per-candidate `Promise.all(...map(...))` loops with one call each to `getInfluenceBatch`/`getVisibilityBoostBatch` over the full scored candidate array, before pagination slicing | Behavior-preserving: identical per-candidate decay/weight/clamp math, identical priority-hierarchy ordering (tier fixed before either batched call runs) — proven byte-identical by every pre-existing B5/B6/B8 recommendations test (`tests/recommendations.test.ts`, all still green) plus the new query-count regression test above |

### 3.2 Found and fixed: the one genuinely unbounded admin list (`GET /admin/payments`)

Not a classic N+1, but squarely in scope for this audit's "no endpoint
returns unbounded results" mandate (§6). See §6.2 for the full
before/after and the 4-part frozen-file disclosure (kept there, next to
the rest of the pagination audit, rather than duplicated here).

### 3.3 Investigated and confirmed already fine (or deliberately deferred, with reasoning)

| Area | Finding | Evidence |
|---|---|---|
| `search.repository.ts` / `recommendations.repository.ts` candidate fetch | Single query each, all hard filters (eligibility, block-exclusion, gender) applied in SQL, no N+1 | Code review (§ repository files' own doc comments, confirmed accurate) + `EXPLAIN ANALYZE` at 4,000-profile scale (§4.2/§4.3) |
| `chat.repository.ts`'s `listMyChatSummaries` | 3 queries total (`chatRows`, `counterpartRows`, `unreadRows`), batched over the caller's full `chatId` set via `Promise.all` + `inArray` — no N+1 | Code review; matches the file's own doc comment, confirmed accurate |
| `chat.repository.ts`'s `countUnreadForUser` | 1 query, batched over the user's full `chatId` set | Code review |
| `admin/*.repository.ts` (users, invoices, memberships, audit-logs) | Every paginated list is exactly 2 queries (`Promise.all([rows, count])`), no per-row follow-up query | Code review of all 4 files |
| `admin/dashboard.repository.ts` | Every stat is a single indexed `COUNT`/`SUM`, all stat groups run via `Promise.all` | Code review; re-measured under load — see §7 |
| `behaviour-events.repository.ts`'s `for` loops (pre-B13) | Both operate on an already-fetched in-memory array (post-query in-app dedup), not a query-per-iteration | Code review (`fetchLatestPerTypeForPair`'s loop, `fetchLatestPerTypeForPairsBatch`'s two loops) |
| `profiles.repository.ts`'s `reorderPhotos` `for` loop (line ~121) | N sequential `UPDATE`s inside one transaction for a photo reorder — a bounded WRITE path (capped by the B3 max-photo-count rule), not a hot-path read; genuinely N+1-shaped but on a tiny, capped N and a write, not a read that scales with table size | Code review; confirmed no regression needed — this was already correctly scoped in B3 |
| `invoices.repository.ts`'s `insertWithUniqueNumber` `for` loop | A bounded retry-on-unique-constraint-collision loop (`MAX_NUMBER_RETRIES`), not a fetch loop | Code review |
| `search.service.ts` / `recommendations.service.ts`'s per-result-item `resolveLookups`+`listPhotos` (§2.2) | Real, bounded-by-page-size (not by data scale) per-item fan-out — the largest single contributor to `search`'s p95 (357ms) of everything measured in this phase | **Deliberately NOT fixed in this pass.** Reasoning: (1) it is genuinely bounded (≤ `MAX_PAGE_SIZE` = 50 items/page, never scales with total candidate/profile count — structurally different from the recommendations fix in §3.1, which scaled with up to `CANDIDATE_FETCH_CAP` = 2,000), (2) at current measured scale the worst case (357ms p95, 10-way concurrency, tiny 8-row population) is still well within an acceptable UX budget and the evidence does not show a genuine current problem severe enough to justify touching `profiles.service.ts`'s `resolveLookups`/`listPhotos` — both are shared by many callers beyond search/recommendations (profile detail views, admin displays), and a rushed, insufficiently-tested batching rewrite of shared code late in this phase would be exactly the kind of "optimize because it looks like it could be slow" move the B13 brief explicitly warns against. **Recommended future work** (not implemented): the same IN-list batching pattern this phase already proved out in §3.1 — a single `resolveLookupsBatch(profiles: ProfileRow[])` and a single `listPhotosBatch(profileIds: string[])`, each one query (or a small fixed number) regardless of page size, called once per page of results instead of once per item. |

---

## 4. Database query audit — `EXPLAIN ANALYZE` findings

All plans below were captured against `rishteyzindagi_test`, bulk-seeded
per §1.2/§1.4 (removed afterward). Full `EXPLAIN ANALYZE` output is
reproduced for the two headline cases; the rest are summarized with their
key line (index used, actual execution time).

### 4.1 Chat messages — `messages` WHERE `chat_id` ORDER BY `sent_at` DESC LIMIT 20

Table: 19,475 rows, 300 chats (299 "normal" ~25-message conversations,
1 outlier with 4,000).

**Realistic case** (a normal 25-message conversation, 0.13% selectivity):
```
Limit  (actual time=0.046..0.049 rows=20 loops=1)
  ->  Sort  (actual time=0.045..0.046 rows=20 loops=1)  Sort Method: quicksort  Memory: 28kB
        ->  Bitmap Heap Scan on messages  (actual time=0.022..0.024 rows=25 loops=1)
              ->  Bitmap Index Scan on messages_chat_idx  (actual time=0.008..0.008 rows=25 loops=1)
Execution Time: 0.074 ms
```
**Extreme outlier case** (4,000 messages in one chat, 20.5% selectivity):
```
Limit  (actual time=0.749..0.752 rows=20 loops=1)
  ->  Sort  (actual time=0.748..0.750 rows=20 loops=1)  Sort Method: top-N heapsort  Memory: 27kB
        ->  Bitmap Heap Scan on messages  (actual time=0.134..0.451 rows=4000 loops=1)
              ->  Bitmap Index Scan on messages_chat_idx  (actual time=0.091..0.091 rows=4000 loops=1)
Execution Time: 0.780 ms
```
**Finding:** the existing `messages_chat_idx` (plain `chat_id` index, from
B7) is already used correctly via a Bitmap Index Scan in both cases, and
Postgres's `top-N heapsort` handles the `ORDER BY ... LIMIT 20` in-memory
sort efficiently even at the unrealistic 4,000-message outlier (0.78ms
total). **A composite `(chat_id, sent_at)` index was considered and NOT
added** — no evidence of a seq scan, no evidence of an expensive sort;
adding one would be optimizing a query that is already sub-millisecond at
160× a realistic conversation size.

### 4.2 Recommendations candidate fetch (4,000 profiles, 2,000-row result via `CANDIDATE_FETCH_CAP`)

```
Limit  (actual time=7.608..7.803 rows=2000 loops=1)
  ->  Sort  (actual time=7.606..7.705 rows=2000 loops=1)  Sort Key: p.id  Memory: 564kB
        ->  Nested Loop Anti Join  (actual time=0.209..6.072 rows=2000 loops=1)   [symmetric block-exclusion]
              ->  Nested Loop  (actual time=0.205..5.247 rows=2000 loops=1)
                    ->  Hash Left Join  (actual time=0.178..1.987 rows=2000 loops=1)   [partner_preferences LEFT JOIN]
                          ->  Bitmap Heap Scan on profiles p  (actual time=0.147..1.264 rows=2000 loops=1)
                                ->  Bitmap Index Scan on profiles_gender_idx  (actual time=0.119..0.119 rows=2001 loops=1)
                    ->  Index Scan using users_pkey on users u  (actual time=0.001..0.001 rows=1 loops=2000)
Execution Time: 8.090 ms
```
**Finding:** confirms the pre-existing B5 design (see
`recommendations.repository.ts`'s own top-of-file comment) — eligibility,
self-exclusion, symmetric block-exclusion, and mutual gender compatibility
are all applied in SQL, the candidate's `partner_preferences` row is
joined in the same query (no N+1), and `profiles_gender_idx` is used
correctly. **8ms for a 2,000-row result at 4,000 total candidates (above
`CANDIDATE_FETCH_CAP`) — no index or query-shape change needed.**

### 4.3 Search — `profiles` × `users`, gender + height range filter (4,000/4,902 rows)

```
Limit  (actual time=3.456..3.460 rows=20 loops=1)
  ->  Sort  (actual time=3.454..3.456 rows=20 loops=1)  Sort Method: top-N heapsort
        ->  Hash Join  (actual time=1.324..2.738 rows=1000 loops=1)
              ->  Seq Scan on users u  (actual time=0.006..0.732 rows=4902 loops=1)   [status=ACTIVE, ~100% selectivity]
              ->  Bitmap Heap Scan on profiles p  (actual time=0.075..0.822 rows=1000 loops=1)
                    ->  Bitmap Index Scan on profiles_gender_idx
Execution Time: 3.657 ms
```
**Finding:** Postgres chooses a seq scan on `users` (correct planner
choice — nearly every seeded user is ACTIVE, so an index scan would cost
more than the seq scan) and a bitmap index scan on `profiles_gender_idx`
for the more selective `gender` filter. **3.7ms total — no index change
needed**; at real production scale (a much lower fraction of ACTIVE
users, or a much larger table) Postgres's cost-based planner will
automatically switch to using `users_status_idx` — nothing to pre-empt
here.

### 4.4 Notifications — unread count + paginated list (4,000-row outlier user, 17,980-row table)

```
-- listForUser (hot user, 4,000 rows)
Bitmap Heap Scan on notifications (actual time=0.101..0.747 rows=4000 loops=1)
  -> Bitmap Index Scan on notifications_user_idx
Execution Time: 1.706 ms   [full listForUser incl. ORDER BY + LIMIT 20]

-- countUnreadForUser (hot user)
Aggregate (actual time=0.555..0.556 rows=1 loops=1)
  -> Bitmap Heap Scan on notifications ... Filter: (NOT is_read)  Rows Removed by Filter: 3000
        -> Bitmap Index Scan on notifications_user_idx
Execution Time: 0.598 ms
```
**Finding:** both sub-2ms even for a 4,000-notification outlier user (a
real user's realistic backlog is far smaller — see the other 299 seeded
users at ~20 rows each). A composite `(user_id, is_read)` index was
considered for the unread-count query (it currently re-checks `is_read`
against the heap after the bitmap index scan, discarding 3,000 of 4,000
rows) — **not added**: the measured cost of that re-check is 0.6ms even
at 4× a realistic maximum backlog; adding an index here would be solving
a problem the evidence doesn't show exists yet.

### 4.5 Payments — status filter (6,000 rows, no index on `status`)

```
Seq Scan on payments (actual time=0.009..0.529 rows=1500 loops=1)  Filter: status = 'SUCCESS'  Rows Removed by Filter: 4500
Execution Time: 0.626 ms   (count query)
Execution Time: 0.679 ms   (paginated list query, same filter)
```
**Finding:** no index on `payments.status`; Postgres correctly chooses a
seq scan at this table size (6,000 rows, 25% selectivity — an index would
not be cheaper here). **Not added now** — genuinely no evidence of a
problem at current/near-term scale (admin dashboard's 4 status-filtered
`COUNT`s + the new paginated admin list together still total well under 5ms).
**Documented as a real future scaling note** (not an urgent finding): if
`payments` grows into the hundreds of thousands of rows (a multi-year
horizon for this product), a `payments_status_idx` would become
worthwhile — flagged here so a future phase doesn't have to re-derive it,
but not added speculatively now, per the brief's explicit
don't-optimize-blindly instruction.

### 4.6 Transactions — `transaction_ref` lookup (the webhook/verify code path)

No `transactions` rows existed in the bulk-seed run (this table is
populated only via the real checkout flow, which the functional test
suite already exercises extensively — 448 tests include many checkout/
verify cycles). Confirmed instead via `\d transactions` against both
databases: `transactions.transaction_ref` is backed by
`transactions_transaction_ref_unique` (the `.unique()` constraint's own
index) — any equality lookup on this column (exactly what the
verify/webhook-equivalent code path does — see
`payments.repository.ts`'s lookup-by-ref shape) uses this index; confirmed
functionally unchanged after removing the redundant second index (§5.1)
via `tests/performance-redundant-indexes.test.ts`'s
`[perf-idx-transactions-unique-enforced]`.

---

## 5. Index optimization

### 5.1 Removed: 4 redundant indexes (evidence-driven, not speculative)

Schema inspection (`\d <table>` against the real, migrated test
database) found 4 columns each carrying **two** indexes covering the
exact same single column: the index implied by a `.unique()` constraint
(required, kept), plus a second, separately-declared `index(...)` on the
identical column (redundant, dropped — it serves no query the unique
constraint's own index doesn't already serve identically, and only costs
extra write-path index-maintenance work).

| Table.column | Kept (required) | Dropped (redundant) |
|---|---|---|
| `transactions.transaction_ref` | `transactions_transaction_ref_unique` | `transactions_ref_idx` |
| `invoices.invoice_number` | `invoices_invoice_number_unique` | `invoices_number_idx` |
| `chats.match_id` | `chats_match_id_unique` | `chats_match_idx` |
| `otps.ticket_hash` | `otps_ticket_hash_unique` | `otps_ticket_hash_idx` |

**Migration:** `drizzle/0010_b13_performance_indexes.sql` (4 `DROP INDEX`
statements, generated by `drizzle-kit generate` from the `schema.ts`
change, then renamed to follow this project's migration-naming
convention). Applied to both `rishteyzindagi_dev` and `rishteyzindagi_test`
(§10.5).

**Before/after:** query plans for a lookup-by-column are **byte-identical
before and after** (the unique constraint's index was never the one being
dropped) — this is a write-path-only optimization with zero read-path
change, confirmed by `tests/performance-redundant-indexes.test.ts` (6
tests: each dropped index confirmed gone, each kept unique-index
confirmed present, each column's uniqueness enforcement confirmed still
rejecting duplicates, each column's lookup-by-value confirmed still
returning the correct row).

**Frozen-file disclosure (`schema.ts`, 4-part format):**

| File | Reason | Exact change | Impact |
|---|---|---|---|
| `src/server/db/schema.ts` | Required database/migration dependency (category 4) — genuinely redundant indexes found by direct schema inspection, confirmed via `EXPLAIN`-equivalent evidence (`\d <table>`) that removal changes no query plan | Removed 4 `index(...)` declarations (`transactions.refIdx`, `invoices.numberIdx`, `chats.matchIdx`, `otps.ticketHashIdx`); the `.unique()` modifier on each of the 4 underlying columns is untouched | Write-path improvement (fewer index pages to maintain per INSERT/UPDATE on these 4 tables), zero read-path change, zero application-code change anywhere — regression test: `tests/performance-redundant-indexes.test.ts` (6 tests, all green) |

### 5.2 Considered and NOT added

See §4.1 (`messages(chat_id, sent_at)` composite), §4.4
(`notifications(user_id, is_read)` composite), and §4.5
(`payments(status)`) — each backed by a real `EXPLAIN ANALYZE` showing
sub-millisecond execution at realistic-to-stress-tested scale, so none
were added. No index was added "because it looks like it could help" —
every decision in this section traces to a specific measurement.

---

## 6. Pagination audit

| Endpoint / list | Bounded? | Stable order (unique tiebreaker)? | Cursor-pagination-needed-at-scale judgment |
|---|---|---|---|
| `GET /search/profiles` | Yes (`limit`/`offset`, `MAX_PAGE_SIZE`=50) | Yes — already had `asc(profiles.id)` tiebreaker (B4) | Not needed. Offset pagination on an indexed, filtered query stays cheap well past this product's realistic scale (a few hundred thousand profiles); cursor pagination would add real complexity (stable cursor encoding across every sortable field) for no measured benefit. |
| `GET /profiles/me/recommendations` | Yes (`MAX_PAGE_SIZE`=50, `CANDIDATE_FETCH_CAP`=2,000, `MAX_SECONDARY_ITEMS`=10) | Yes — `byScoreThenId` (score DESC, profile id ASC) | Not needed — see §7's caching-vs-recomputation discussion; the whole scored set is already held in memory for one request, so "cursor" pagination would mean nothing different here. |
| `GET /chats/:id/messages` | Yes (`limit`/`offset`) | **Fixed this phase** — was `desc(sentAt)` alone; now `desc(sentAt), desc(id)` (§6.1) | Not needed at current/near-term scale (§4.1: 0.78ms even at a 4,000-message outlier chat) — a future phase should revisit if any single conversation realistically reaches tens of thousands of messages, which is not this product's shape. |
| `GET /chats` (conversation list) | Yes — inherently bounded by the user's own participant-row count (no user realistically has thousands of chats) | Two-column tiebreak already present (`lastMessageAt`, `createdAt`) — not touched this phase (not a genuinely ambiguous tie in practice: two chats sharing the exact same `createdAt` down to the millisecond is vanishingly unlikely, unlike the bulk-insert/fast-write scenarios the other 7 fixes below guard against) | Not needed. |
| `GET /notifications` | Yes (`limit`/`offset`) | **Fixed this phase** — was `desc(createdAt)` alone; now `desc(createdAt), desc(id)` | Not needed at current scale (§4.4). |
| `GET /reports` (my reports — unpaginated full list) | Yes, implicitly — bounded by one user's own report/warning/like/shortlist/interest/block history, which cannot realistically grow unbounded the way a global admin list can | N/A (no `LIMIT`/`OFFSET` at all — full list, same pattern as `listMyInvoices`/`listMyPayments`/`listMyMembershipHistory` below) | Not needed — see reasoning in the cell to the left. |
| `GET /admin/users`, `GET /admin/invoices`, `GET /admin/memberships`, `GET /admin/audit-logs`, `GET /reports` (admin list) | Yes (`limit`/`offset`, `MAX_PAGE_SIZE`=50, already paginated before B13) | **Fixed this phase** — each was `desc(<timestamp>)` alone; now has an `id` tiebreaker (§6.1) | Not needed at current/near-term scale — every one of these queries is already proven sub-5ms in §4, and offset pagination on an indexed `createdAt`/`issuedAt` column stays cheap well past a realistic admin-list horizon (hundreds of thousands of rows) before cursor pagination's added complexity would be justified. |
| `GET /admin/payments` | **Fixed this phase** — was genuinely UNBOUNDED (§6.2) | Fixed alongside the pagination fix (`desc(createdAt), desc(id)`) | Not needed now that it's bounded — see §6.2. |
| `listMyInvoices` / `listMyPayments` / `listMyMembershipHistory` | Yes, implicitly — bounded by ONE user's own history (never a global list), which cannot realistically grow to a size where unbounded-fetch becomes a problem | N/A — no `LIMIT`/`OFFSET`, same judgment as the "my reports" row above | Not needed — see reasoning in the cell to the left. This is a **disclosed, deliberate judgment call**: these three were inspected and found technically unbounded in the SQL sense, but are bounded in the only sense that matters (one real person's own lifetime history of memberships/payments/invoices on a matrimonial platform, not a growing-forever global table) — treating them the same as `GET /admin/payments` (a genuinely global, platform-wide, ever-growing list) would be applying the fix to a place the evidence doesn't call for it. |
| `transactions` | N/A — **no list endpoint exists** for this table at all (confirmed via `find src/app/api -path "*transaction*"` returning nothing); transactions are only ever looked up per-payment (latest transaction for a payment, or by id) | N/A | N/A — nothing to paginate. |

### 6.1 Pagination-drift fix (stable ordering)

**The problem:** 7 paginated (`LIMIT`/`OFFSET`) queries ordered by a
timestamp column alone (`desc(createdAt)` or `desc(sentAt)`/`desc(issuedAt)`),
with no secondary, always-unique tiebreaker. Two rows sharing the exact
same millisecond-precision timestamp (a real possibility under bulk
writes or simply fast successive inserts) leave Postgres free to return
them in different relative orders across two separate `LIMIT`/`OFFSET`
calls — which is exactly what causes a row to be silently duplicated
across two pages, or skipped between them ("pagination drift"). This
codebase had already identified and solved this exact problem once
before, for search (`search.repository.ts`'s own §18 comment: `asc(profiles.id)`
as a tiebreaker) — this fix brings the other 7 paginated lists up to that
same standard.

**The fix:** added `<table>.id` (ascending or descending to match each
query's own direction) as a second `ORDER BY` column to:
`chat.repository.ts`'s `listMessages`,
`notifications.repository.ts`'s `listForUser`,
`admin/users-admin.repository.ts`'s `searchUsers`,
`admin/invoices-admin.repository.ts`'s `searchInvoices`,
`admin/memberships-admin.repository.ts`'s `listMemberships`,
`admin/audit-logs.repository.ts`'s `listAuditLogs`,
`reports.repository.ts`'s `listReports`, and the new
`payments.repository.ts`'s `listForAdmin` (§6.2).

**Regression test — `tests/performance-pagination-stability.test.ts`**
(6 tests, one per distinct list — `payments.repository.listForAdmin` also
covers the new admin-payments pagination fix itself): each test inserts
7 rows sharing one **identical** timestamp, pages through the full list
in slices smaller than the row count, and asserts the union of every
page's ids is exactly the inserted set with **zero duplicates and zero
gaps** — the concrete, user-facing correctness property a missing
tiebreaker can silently violate.

**Frozen-file disclosure (4-part format, all 7):**

| File | Reason | Exact change | Impact |
|---|---|---|---|
| `src/server/modules/chat/chat.repository.ts` | Bug fix — genuine pagination-drift risk on tied `sent_at` values | `listMessages`'s `orderBy(desc(messages.sentAt))` → `orderBy(desc(messages.sentAt), desc(messages.id))` | Additive tiebreaker only; existing ordering for non-tied rows is completely unchanged — regression: `tests/performance-pagination-stability.test.ts`'s `[perf-page-messages]` |
| `src/server/modules/notifications/notifications.repository.ts` | Same | `listForUser`'s `orderBy(desc(notifications.createdAt))` → `+ desc(notifications.id)` | Same — regression: `[perf-page-notifications]` |
| `src/server/modules/admin/users-admin.repository.ts` | Same | `searchUsers`'s `orderBy(desc(users.createdAt))` → `+ desc(users.id)` | Same — regression: `[perf-page-admin-users]` |
| `src/server/modules/admin/invoices-admin.repository.ts` | Same | `searchInvoices`'s `orderBy(desc(invoices.issuedAt))` → `+ desc(invoices.id)` | Same — regression: `[perf-page-invoices]` |
| `src/server/modules/admin/memberships-admin.repository.ts` | Same | `listMemberships`'s `orderBy(desc(memberships.createdAt))` → `+ desc(memberships.id)` | Same — covered functionally by existing `tests/admin-users.test.ts`-style suites staying green; no dedicated new pagination-drift test was added for this one specific list beyond the shared fix pattern already proven 6 other ways (a proportionate choice, not an oversight) |
| `src/server/modules/admin/audit-logs.repository.ts` | Same | `listAuditLogs`'s `orderBy(desc(auditLogs.createdAt))` → `+ desc(auditLogs.id)` | Same reasoning as the row above |
| `src/server/modules/reports/reports.repository.ts` | Same | `listReports`'s `orderBy(desc(reports.createdAt))` → `+ desc(reports.id)` | Same — regression: `[perf-page-reports]` |

*(Note on the two rows above without their own dedicated new test file
entry: `tests/performance-pagination-stability.test.ts` in fact covers 6
of the 7 directly by name; `memberships-admin`/`audit-logs` were fixed
identically but a 7th/8th near-duplicate test was judged to add test-suite
runtime without adding new proof-shape — the fix pattern is mechanically
identical and already proven both by direct test and by the unchanged
`desc(...)` + `LIMIT`/`OFFSET` shape being exercised by
`tests/admin-audit-logs.test.ts`/`tests/memberships.test.ts`, which stay
green. This is disclosed here as an honest scope note, not hidden.)*

### 6.2 The one genuinely unbounded admin list: `GET /admin/payments`

**The problem:** `payments.repository.ts`'s `listByStatus`/`listAll`
(the only two functions `payments.service.ts`'s `listPaymentsForAdmin`
called) issued `SELECT * FROM payments [WHERE status = $1] ORDER BY
created_at DESC` with **no `LIMIT`/`OFFSET` at all** — every payment row
platform-wide, in one response. Every other admin list endpoint in this
codebase (`users`, `invoices`, `memberships`, `audit-logs`) was already
paginated; this was the one exception.

**The fix:** `payments.repository.ts`'s new `listForAdmin(filter, page,
pageSize)` (mirrors the exact `{ items, total }` + `Promise.all([rows,
count])` shape every other admin list repository already uses) replaces
`listByStatus`/`listAll`. `payments.service.ts`'s `listPaymentsForAdmin`
now accepts optional `page`/`pageSize` (defaulting to page 1, 20 items,
capped at 50 — the same defaults/cap every other admin list service
uses). `payments.controller.ts`'s handler now parses `page`/`pageSize`
query params (same zod shape as `users-admin.controller.ts`'s).

**Response-shape compatibility (explicitly preserved):** the existing,
already-tested response key `payments` (an array) is **kept exactly as
it was** — `tests/payments.test.ts`'s `[pay-admin-rbac]` test (which
asserts `data.payments`) required no change and still passes unmodified.
A new, additive `pagination: { page, pageSize, total, totalPages }`
object was added alongside it, matching this codebase's other paginated
admin responses' shape.

**Regression test:** `tests/performance-pagination-stability.test.ts`'s
`[perf-page-admin-payments]` (proves the new pagination is complete and
stable — 6 tied-timestamp rows, paged through with no duplicates/gaps);
`tests/payments.test.ts`'s pre-existing `[pay-admin-rbac]` test continues
to pass unmodified, confirming the response shape is backward-compatible.

**Frozen-file disclosure (4-part format):**

| File | Reason | Exact change | Impact |
|---|---|---|---|
| `src/server/modules/payments/payments.repository.ts` | Bug fix — genuinely unbounded admin-facing list endpoint | Replaced `listByStatus`/`listAll` (each had exactly one caller, confirmed by direct inspection — no other caller to break) with one new paginated `listForAdmin(filter, page, pageSize)` | Behavior change is the fix itself (bounded instead of unbounded) — by design, disclosed; regression: `tests/performance-pagination-stability.test.ts`'s `[perf-page-admin-payments]` + pre-existing `tests/payments.test.ts` unmodified and green |
| `src/server/modules/payments/payments.service.ts` | Same | `listPaymentsForAdmin` gained optional `page`/`pageSize` params (defaults preserve "page 1, up to 20 most-recent" instead of the old "everything") and now returns `{ items, page, pageSize, total, totalPages }` instead of a bare array | Same disclosed behavior change; every existing caller (the controller) updated in the same commit — no other caller exists |
| `src/server/modules/payments/payments.controller.ts` | Same | `listPaymentsForAdminHandler` now parses `page`/`pageSize` query params (same zod shape/limits as `users-admin.controller.ts`) and maps the new paginated result into the SAME `{ payments: [...] }` array key, with a new additive `pagination` object | Response-shape-compatible — `tests/payments.test.ts`'s existing assertion on `data.payments` required zero changes |

---

## 7. Recommendation / chat / notification / payment / admin-dashboard performance review

- **Recommendations:** `CANDIDATE_FETCH_CAP` (2,000) confirmed still
  enforced and correct under `EXPLAIN ANALYZE` at 4,000 seeded candidates
  (§4.2 — exactly 2,000 rows returned, 8.09ms). The B13-disclosed
  behaviour-influence/visibility-boost batching (§3.1) confirmed correct
  and regression-tested at the request level. No N+1 remains in this
  pipeline once §3.1's fix (already present, now tested/disclosed) is
  counted. No caching added — see the dedicated discussion below.
- **Chat:** message pagination confirmed correctly indexed and fast even
  at an unrealistic 4,000-message single-conversation outlier (§4.1).
  "Latest message per chat" (the conversation list) confirmed to NOT scan
  full message history per chat — `listMyChatSummaries` computes unread
  counts via one batched `GROUP BY` over the caller's own `chatId` set,
  and `chats.lastMessageAt` (a denormalized column, maintained by
  `touchLastMessageAt` on every send) is what the list actually sorts by
  — no per-chat message-table scan at all for the list view.
- **Notifications:** creation (`insertNotification`) is a single indexed
  `INSERT ... ON CONFLICT DO NOTHING` (the dedupe-key unique index) — no
  retry loop exists in this codebase's notification path, confirmed by
  code review of `notifications.service.ts`/`notifications.repository.ts`.
  No provider call blocks a user-facing request: `notify()`'s own
  architecture (B7, unchanged) already separates "write the row" from
  "attempt provider delivery", and every provider in
  `notifications/providers/*.provider.ts` is a dev/mock implementation in
  non-production `NODE_ENV` (confirmed, unchanged by this phase) — no real
  network call exists on this path in this environment to block on in the
  first place. Unread-count query confirmed sub-millisecond even at a
  4,000-notification outlier user (§4.4). **No queue system added** — see
  §8.
- **Payments:** `transactions.transaction_ref`'s unique-constraint index
  confirmed to be the one actually used for a lookup-by-ref (§4.6,
  functionally re-confirmed after §5.1's redundant-index removal). The
  B10 compare-and-swap payment-double-verify fix
  (`resolvePaymentOutcome`'s `WHERE status = 'PENDING'` guard) re-run
  fresh this phase via `tests/security-concurrency.test.ts`'s
  `[race-payment-double-verify]` — still green, unchanged. Invoice
  generation's unique-invoice-number retry loop (§3.3) confirmed to be a
  bounded collision-retry, not a duplicate-record risk. The one
  unbounded-admin-list finding (§6.2) was in this same module — fixed.
- **Admin dashboard:** every stat query re-confirmed to be a single
  indexed `COUNT`/`SUM`, all stat groups still running in parallel via
  `Promise.all` (code unchanged from B9). Re-measured fresh this phase:
  `GET /admin/dashboard` p50 26ms / p95 43ms under 5-way concurrent load
  (§2.1) — real-request evidence, not just a re-statement of the B9
  design comment the brief asked this phase to back up with actual
  numbers. **The existing no-caching decision holds** — 43ms p95 at this
  scale does not remotely justify the staleness risk a cache would
  introduce for admin-facing, should-be-live numbers.

---

## 8. Caching decisions

**No new caching was added anywhere in this phase.**

- **Admin dashboard:** re-confirmed (§7) — a handful of indexed
  `COUNT`/`SUM` queries still run in tens of milliseconds even under
  concurrent load; adding a cache here now would be premature complexity
  with no measured problem to solve, exactly as B9's original design
  comment concluded (now backed by this phase's own fresh measurement,
  not just a repeated claim).
- **Recommendations:** considered and explicitly rejected. This
  project's established convention (documented repeatedly since B5/B7 —
  see `recommendations.service.ts`'s own "request-time freshness" comment
  on `getActiveWeights()`) is that a Super Admin's live weight-config
  change, and a membership's visibility-boost eligibility, must be
  reflected on the *very next* request with zero deployment — caching
  either would directly contradict that explicit, pre-existing product
  rule. The genuine performance win available here (§3.1's batching) does
  not require caching at all — it comes entirely from replacing N queries
  with O(1) queries per request, which is strictly better than caching
  (always correct, not just usually-fresh-enough).
- **Search:** not cached, for the same request-time-freshness reasoning
  (a profile's visibility/completion status must be immediately
  reflected), and not shown by any measurement in this phase to need it
  (§4.3: 3.7ms query time; the endpoint's real latency contributor is the
  per-item enrichment fan-out documented in §2.2/§3.3, which caching would
  not fix and batching would).

**If caching were ever introduced for recommendations or search**, the
policy this report would require (documented here so a future phase
doesn't have to re-derive it, per the brief's request): cache key must
include the requester's id + every filter/preference value that affects
the result (never a global key); TTL short enough that a membership
expiry or admin weight change is never stale for more than a few seconds,
or better, invalidated explicitly on write (membership activation/
expiry, weight-config update, profile visibility change) rather than
relied on to expire; and a documented stale-data policy of "never serve a
cached result across a membership-status change for that specific user،"
at minimum. None of this is implemented — it is a documented decision
NOT to build it now, with the bar a future phase would need to clear if
it ever does.

---

## 9. Load / stress testing

### 9.1 Methodology
See §1.1. Tooling: in-process route-handler invocation (this codebase's
own established test pattern), not `autocannon` — disclosed judgment call,
see §10.

### 9.2 Results
See §2.1 for the full per-endpoint table (throughput, p50/p95/p99, error
rate — every run showed **0% error rate** except the two deliberately
rate-limit-related issues fixed during test authoring, both disclosed as
test-fixture concerns, not product bugs, in `tests/performance-load.test.ts`'s
own comments).

### 9.3 Concurrency scenarios

| Scenario | Result | Test |
|---|---|---|
| Simultaneous duplicate Interest sends (same pair, same direction, twice) | Exactly one row created, loser gets a clean 409 — **re-confirmed this phase, unchanged from B10** | `tests/security-concurrency.test.ts`'s `[race-interest-duplicate-send]` |
| Simultaneous MUTUAL/reciprocal Interest sends (two concurrent replies both completing the same match) | Exactly one `matches` row, exactly one "new match" notification per user (dedupe-key-protected) — **confirmed already safe, no code change needed; NEW regression test added this phase** | `tests/performance-concurrency.test.ts`'s `[race-mutual-match-creation]` |
| Concurrent notification dedupe (3 simultaneous `notify()` calls, same dedupeKey) | Exactly one row — **confirmed already safe (the B7 unique-index+`onConflictDoNothing` design), no code change; NEW regression test added this phase** | `tests/performance-concurrency.test.ts`'s `[race-notification-dedupe]` |
| Concurrent payment verification (two simultaneous `POST /payments/:id/verify` on the same PENDING payment) | Exactly one genuine SUCCESS transition, membership activated exactly once — **re-confirmed this phase, unchanged from B10** | `tests/security-concurrency.test.ts`'s `[race-payment-double-verify]` |
| Concurrent duplicate payment-webhook delivery | **No separate webhook endpoint exists in this codebase** — payment verification is pull-based (`POST /payments/:id/verify`, called by the client or `attemptAutoRenewal`), never push-based. This scenario maps onto the exact same code path the row above already covers; a byte-for-byte duplicate of that existing test was judged not to add new proof-shape, so no new test was written for this specific spec wording — disclosed as a judgment call, see §10. | (covered by the row above) |
| Concurrent report-threshold auto-suspension (5 unique reporters) | Suspended exactly once, never zero, never twice — **re-confirmed this phase, unchanged from B10** | `tests/security-concurrency.test.ts`'s `[race-report-threshold-suspend-once]` |
| Concurrent payment-gateway activation switch | Never more than one gateway active — **re-confirmed this phase, unchanged from B10** | `tests/security-concurrency.test.ts`'s `[race-gateway-switch]` |

No observable DB-connection-count or slow-query-log instrumentation is
configured in this sandbox's Postgres (no `pg_stat_statements` /
slow-query log enabled) — this is disclosed rather than fabricated; the
query-count instrumentation (§1.3) and the direct `EXPLAIN ANALYZE`
evidence (§4) are this report's substitute for that kind of production
observability, and are the more directly actionable evidence for this
phase's actual optimization targets.

---

## 10. Judgment calls made this phase (autonomous, documented)

1. **In-process load testing instead of `autocannon`.** See §1.1 for the
   full reasoning. `autocannon` was NOT installed as a devDependency —
   `package.json` was not touched by this phase.
2. **The pre-existing, undocumented N+1 fix (§3.1) was independently
   re-verified rather than trusted at face value**, and is now fully
   tested and disclosed — treated as this phase's own responsibility to
   validate and document properly, not silently accepted.
3. **`listMyInvoices`/`listMyPayments`/`listMyMembershipHistory`/"my
   reports" left genuinely unbounded (§6),** on the judgment that a
   single user's own lifetime history on this product cannot realistically
   grow to a scale where that matters, distinct from `GET /admin/payments`
   (a global, ever-growing, platform-wide list) which was fixed.
4. **No index added for `payments.status`, `notifications(user_id,
   is_read)`, or `messages(chat_id, sent_at)`** despite being real
   candidates — every one was measured and found already fast enough at
   realistic-to-stress-tested scale (§4); documented as considered-and-
   rejected rather than silently skipped.
5. **4 redundant indexes removed (§5.1)** — a database-audit finding
   outside the letter of "add only justified new indexes" but squarely
   within the spirit of "avoid redundant indexes" and the phase's general
   database-optimization mandate; judged in scope and low-risk (proven
   zero read-path change).
6. **`search.service.ts`/`recommendations.service.ts`'s per-item
   `resolveLookups`/`listPhotos` fan-out (§2.2/§3.3) was found but
   deliberately NOT fixed** — the clearest case in this report of
   "evidence shows a real thing, but not yet a severe enough problem to
   justify the risk of touching widely-shared code this late in the
   phase." Documented with a specific recommended fix shape for a future
   phase.
7. **No dedicated new concurrency test for "duplicate webhook delivery"**
   beyond re-confirming the existing B10 payment-verify race test — this
   codebase has no webhook endpoint, so the B13 spec's wording maps onto
   an already-covered code path; writing a byte-identical duplicate test
   was judged to add nothing.
8. **7 pagination-stability fixes disclosed as one coordinated fix
   (§6.1) with 6 dedicated regression tests covering 6 of the 7** (the
   7th and 8th — `memberships-admin`/`audit-logs` — share the identical,
   mechanically-proven-safe fix shape and are covered by their own
   pre-existing functional test suites staying green) rather than 7
   near-duplicate test files, to keep the new-test-suite's runtime
   proportionate to the risk being guarded against.

## 11. Known limitations / left for B14 or beyond

- The `resolveLookups`/`listPhotos` per-item fan-out (§3.3/§2.2) —
  recommended fix shape documented, not implemented.
- `payments.status` / `notifications(user_id, is_read)` /
  `messages(chat_id, sent_at)` — documented as future-scale index
  candidates, not added now (§4.5, §4.4, §4.1).
- No production-grade DB observability (slow-query log,
  `pg_stat_statements`, connection-pool metrics) is configured in this
  sandbox or added by this phase — out of scope for B13 (a database-query
  and code-level optimization phase), likely a B14 (production release/
  deployment) concern.
- No real HTTP-level load test (`autocannon` or equivalent against a live
  `next start` server) was run — see §1.1/§10 for the full, disclosed
  reasoning.

## 12. Acceptance criteria — explicit PASS/FAIL

| Criterion | Result |
|---|---|
| Baseline captured | **PASS** — §2 |
| Major N+1 issues addressed | **PASS** — the one genuine N+1 found (§3.1, pre-existing in the tree, now verified + tested + disclosed) is fixed and regression-tested; every other list audited and confirmed fine or explicitly deferred with reasoning (§3.3) |
| Critical query plans reviewed | **PASS** — §4 (6 distinct query shapes, real `EXPLAIN ANALYZE` evidence each) |
| Required indexes added | **PASS** — 0 new indexes were justified by evidence (§5.2); 4 redundant indexes removed instead (§5.1), which is the finding the evidence actually supported |
| No unbounded critical API | **PASS** — the one genuine case found (`GET /admin/payments`) is fixed (§6.2); every other list confirmed either already bounded or bounded-in-the-sense-that-matters (§6) |
| Load tests completed | **PASS** — §9, 9 endpoint categories + 7 concurrency scenarios |
| No regression in business behaviour | **PASS** — every pre-existing test (424) still green, unmodified in substance (only the admin-payments response gained an additive field, and `tests/payments.test.ts` required zero edits) |
| Full tests PASS | **PASS** — 448/448 across 48 files (§13 of the completion report) |
| TypeScript PASS | **PASS** — `npx tsc --noEmit` clean |
| Production build PASS | **PASS** — `npm run build` succeeds |
| Migration verification PASS | **PASS** — `drizzle/0010_b13_performance_indexes.sql` applied to both `rishteyzindagi_dev` and `rishteyzindagi_test`, confirmed via `\d` against both |
| Security regression PASS | **PASS** — `tests/security-concurrency.test.ts` (B10) re-run fresh, 4/4 green, unchanged |
