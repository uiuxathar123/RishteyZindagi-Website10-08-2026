```
STATUS: B13 — PASS — FROZEN
Tests:  448/448 passing (48 test files; +24 net new vs B12's 424/424)
tsc:    clean
build:  clean (npm run build succeeds, no new errors/warnings)
```

# B13 — Performance / Scalability / Database Optimization

Independently verified by the orchestrating session after subagent delivery — every claim below was re-checked against real source, a real re-run of the full test suite, and direct `psql` inspection of both `rishteyzindagi_dev` and `rishteyzindagi_test`, not taken on the subagent's word alone.

## Summary

Evidence-based performance pass across the whole backend. Baseline captured first (in-process route-handler load harness against the real migrated test DB, p50/p95/p99 per endpoint category — see `PERFORMANCE_REPORT.md` §2). Genuine findings were fixed with evidence; everything else audited was confirmed already fine and documented as such rather than rewritten speculatively. No caching added, no cursor pagination, no queue system — all three evaluated and rejected with real measurements backing the rejection.

## What changed

- **One genuine N+1 fixed and proven**: `recommendations.service.ts`'s per-candidate calls to the behaviour-influence and visibility-boost providers (up to ~6,000 extra query round trips at `CANDIDATE_FETCH_CAP`=2000) were already batched in the working tree at the start of this phase, but undocumented and untested. The subagent independently re-verified the batched implementation line-by-line (not trusted at face value), then added the missing regression proof: `tests/perf-query-counts.test.ts` drives the real recommendations route at two different matching-candidate-pool sizes (4 vs 10) with a fixed page size, and asserts the exact DB query count is identical both times (confirmed: 37 == 37, not just "fewer than before") via new `getQueryCount()`/`resetQueryCount()` instrumentation in `src/server/db/client.ts`.
- **4 redundant indexes removed** (`transactions_ref_idx`, `invoices_number_idx`, `chats_match_idx`, `otps_ticket_hash_idx`) — each was a plain `index()` duplicating a column that already had its own `.unique()`-backed index. Write-path-only improvement, zero read-path change. Migration `drizzle/0010_b13_performance_indexes.sql`, independently confirmed applied to both `rishteyzindagi_dev` and `rishteyzindagi_test` via direct `psql` query (all 4 dropped indexes absent, all 4 unique indexes present, in both DBs).
- **7 list endpoints got a stable ORDER BY tiebreaker fix** (`+desc(id)` alongside the existing timestamp sort) to eliminate pagination drift on tied timestamps: chat messages, notifications, admin users/invoices/memberships/audit-logs, reports. Independently spot-checked in source — confirmed present exactly as disclosed.
- **One genuinely unbounded admin endpoint fixed**: `GET /admin/payments` had no LIMIT at all. Replaced with a new `listForAdmin(filter, page, pageSize)` following the same `{items, total}` + `Promise.all` shape every other admin repository already uses. Spot-checked in source — confirmed.
- **0 new indexes added** — every other candidate (payments.status, notifications(user_id,is_read), messages(chat_id,sent_at)) was measured via real `EXPLAIN ANALYZE` against a temporarily bulk-seeded test DB (4,000 profiles / ~20,000 messages / ~18,000 notifications / 6,000 payments) and found fast enough already (sub-millisecond to low-single-digit-ms) — documented as future-scale watch items, not implemented speculatively.

## Confirmed already fine (no change needed)

Recommendations' `CANDIDATE_FETCH_CAP`=2000 bound, search/recommendations SQL-level filtering (no N+1), admin dashboard's parallel single-aggregate-query pattern, chat conversation list (denormalized `lastMessageAt`, no per-chat message scan), notification creation (single indexed `INSERT ... ON CONFLICT DO NOTHING`), payment verification's B10 compare-and-swap race guard (re-run standalone by this session: `tests/security-concurrency.test.ts` 4/4 green, unchanged), invoice-number retry loop and profile-photo-reorder loop (both bounded, non-scaling, correctly not N+1).

## Deliberately not done

- No caching anywhere — explicitly rejected against this project's established "request-time freshness" convention (weight-config changes, membership activation must be visible on the very next request); a documented future caching policy (per-requester keys, explicit invalidation) is written into `PERFORMANCE_REPORT.md` §8 but nothing implemented.
- No cursor pagination — every list stays cheap on offset pagination per real EXPLAIN evidence; would add complexity with no measured benefit.
- No queue system for notifications — not evidenced as needed; providers are already non-blocking dev/mock outside production.
- `autocannon` evaluated, not installed — in-process route-handler load testing (this codebase's own established test pattern) was judged to measure the actual target (query shape/count/index usage) without adding a second live-server process purely to re-measure loopback/HTTP overhead. `package.json` untouched.
- One real-but-bounded fan-out left unfixed: `search`/`recommendations` `toItem()` calls `resolveLookups()` + `listPhotos()` per result item (bounded by page size ≤50, not a classic N+1, but the largest contributor to search's measured p95 of 357ms). Documented as recommended future work (a batched `resolveLookupsBatch`/`listPhotosBatch`), not fixed this phase — judgment call, not an oversight.

## Frozen-file exceptions (all independently spot-checked against source)

`src/server/db/schema.ts` (4 redundant index removals, category 4 — required migration dependency), `src/server/modules/chat/chat.repository.ts`, `notifications/notifications.repository.ts`, `admin/users-admin.repository.ts`, `admin/invoices-admin.repository.ts`, `admin/memberships-admin.repository.ts`, `admin/audit-logs.repository.ts`, `reports/reports.repository.ts` (pagination tiebreaker fixes, category 1 — bug fix), `payments/payments.repository.ts` + `payments.service.ts` + `payments.controller.ts` (unbounded-list bug fix). Also disclosed: `behaviour-events.repository.ts`, `recommendations/real-behaviour-signal-provider.ts`, `memberships/visibility-boost.ts`, `recommendations/recommendations.service.ts`, `db/client.ts` — found already modified (batching + query-count instrumentation) at the start of this phase, undocumented; independently re-verified, tested, and disclosed rather than accepted at face value. Full 4-part disclosure (file/reason/change/impact) for every entry is in `BACKEND.md` §57 and `PERFORMANCE_REPORT.md`.

## Verification performed independently by the orchestrating session

PostgreSQL restarted where needed; `npx tsc --noEmit` re-run clean; full `npm test` re-run fresh (48 files / 448 tests, matching the subagent's claim exactly); `npm run build` re-run, succeeds; `tests/security-concurrency.test.ts` re-run standalone, 4/4 green; migration presence/absence of all 4 dropped/kept indexes directly queried via `psql` against both `rishteyzindagi_dev` and `rishteyzindagi_test`; confirmed zero leftover synthetic `perf-test-*` rows in either database; `PERFORMANCE_REPORT.md` read (820 lines, 12 sections) and spot-checked; `BACKEND.md` banner and new §57 confirmed present and accurate; several disclosed frozen-file changes read directly in source and confirmed to match the claimed diff.

## Next step

B14 — Production Release / Deployment / Backup / DR.
