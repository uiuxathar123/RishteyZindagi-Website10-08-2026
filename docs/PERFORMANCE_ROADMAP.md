# Performance Roadmap

**Nothing in this document is a measurement.** Every item comes from reading the code. Query counts are counted from the code path, not observed. Before changing anything, measure it first (see §3). The earlier B13 measured report is `PERFORMANCE_REPORT.md`, and its load-test numbers came from a local machine.

No change has been made. Every item needs the owner's approval.

## 1. Per-request fixed cost

Every `/api/v1` request passes through `withErrorHandling` and usually `authenticate()`. Database round trips before any feature logic runs (production defaults):

| Step | Queries | Source |
|---|---|---|
| Shared rate-limit policy (Postgres store in production) | 1 upsert per rule hit, 2 when a bearer token is present | `src/server/middleware/rate-limit-policy.ts`, `src/server/lib/rate-limit-store.ts` |
| Maintenance gate (reads `platform_settings`, no cache) | 1 (0 for `/admin`, `/webhooks`, `/internal`, `/health`, `/site-status`, which are exempt) | `src/server/middleware/maintenance.ts` |
| Session lookup + user/admin lookup | 2 | `src/server/middleware/authenticate.ts` |
| `last_seen_at` update (fire-and-forget, every request) | 1 write | same |
| `requirePermission()` (admin routes, no cache) | 2 | `src/server/middleware/rbac.ts` |

So a signed-in member request costs about 6 round trips (2 rate-limit + 1 maintenance + 2 auth + 1 `last_seen_at`), and an admin request about 7 (no maintenance read, plus 2 for each `requirePermission()` call), before its own queries. Outside production the rate-limit store defaults to in-memory, so local numbers are lower. Browser calls also take an extra loopback HTTP hop through `/bff`. With a pool of 10 connections (`src/server/db/client.ts`), this fixed cost is the first thing to watch under load.

## 2. Findings (ordered by expected impact)

| ID | Finding | Evidence | Proposed direction |
|---|---|---|---|
| P-1 | **Search pages are N+1.** For each result row, `resolveLookups()` runs up to 8 single-row reference lookups and `listPhotos()` runs one more. A page of 20 is therefore up to about 180 queries, plus filter validation that awaits one query per supplied id in sequence. Only recommendations has a query-count regression test. | `src/server/modules/search/search.service.ts` (`searchProfiles`, `validateFilters`); `profiles.service.ts:117` | Load reference tables once into an in-process cache (they change rarely) and fetch photos for the page in one `IN (...)` query. Add a `perf-query-counts` case for search first. |
| P-2 | **Photos are served full-size and never cached.** Originals up to 5 MB are streamed through the API (and the BFF hop) with `Cache-Control: private, no-store`; `next/image` is set to `unoptimized` for them. A search page of 20 cards can download every original again on each visit. Gate 1 proposed `private, max-age=86400, immutable`; the tree does not have it. | `src/app/api/v1/profiles/photos/[photoId]/file/route.ts`; `src/lib/photo.ts`; `gate1/files/...` | Generate thumbnails at upload (card size + full size). Allow private browser caching, keyed by photo id (ids are immutable). Longer term, serve via presigned S3/CDN URLs. |
| P-3 | **Recommendations are computed on every request.** The SQL hard filter fetches up to 2,000 candidates (`CANDIDATE_FETCH_CAP`), then scoring runs in JavaScript, plus a batch behaviour query. There is no cache or precomputation. | `src/server/modules/recommendations/recommendations.repository.ts:31`; `recommendations.service.ts` | Cache a member's ranked list for a short time, or precompute nightly with a job. Keep the existing query-count test. |
| P-4 | **Live chat polls the database.** Each open SSE stream queries every 1.5 s (`CHAT_STREAM_POLL_MS`), up to 4 streams per user per instance, reconnecting every 55 s. 1,000 members with chat open is roughly 650 queries per second from polling alone. | `src/server/modules/chat/chat-stream.ts:23-26` | Use Postgres `LISTEN/NOTIFY` or a small pub/sub, or poll less often when idle. Measure concurrent open chats first. |
| P-5 | **Missing composite indexes for common orderings** (candidates; confirm with `EXPLAIN` on realistic data): `messages (chat_id, sent_at)`, `notifications (user_id, is_read, created_at)`, `profiles (updated_at)` for the default search sort, `audit_logs (created_at)`, `interests (to_user_id, status)`. | `src/server/db/schema.ts` index definitions | Add only the ones `EXPLAIN ANALYZE` shows are needed, in a new additive migration. |
| P-6 | **OFFSET pagination plus `count(*)` on search and admin lists.** Deep pages get slower as tables grow. | `search.repository.ts`, admin repositories | Keyset (cursor) pagination for search and messages; cap admin page depth. |
| P-7 | **Uncached settings and permissions.** Maintenance, OTP policy, search settings and role permissions are read from the database on every use. | `platform-settings.service.ts`, `rbac.ts` | A short in-process cache (for example 5–10 s) would remove most of these reads. It trades immediacy, which the current design chose deliberately; needs a decision. |
| P-8 | **Unpaginated member lists.** Likes, interests, shortlist, blocks, matches and chats return every row. | `interactions.repository.ts:114-120`; `chat.service.ts` | Add pagination with the shared page shape before members accumulate history. |
| P-9 | **bcrypt runs on the event loop.** `bcryptjs` (pure JS, cost 12) blocks the Node thread for each login, sign-up, password change and deletion check. | `src/server/lib/password.ts` | Native `bcrypt` or `argon2` run off the main thread; or keep it and scale instances. Measure under login load first. |
| P-10 | **Fixed pool size of 10.** Not configurable. | `src/server/db/client.ts` | Make it an environment setting; size it against Postgres `max_connections` across all instances. |
| P-11 | **Client-side rendering for data pages.** 98 client-component files; search, dashboard and admin pages fetch after load. Fine for private data. 51 page files export `metadata`, but how much of each public page renders on the server was not checked (most components are PENDING). There is no sitemap or robots route (S-8). | `src/app`, `src/components` | Add `sitemap.ts` / `robots.ts`. No change needed for private pages. |
| P-12 | **Fire-and-forget writes on every request** (`last_seen_at`). Unbounded concurrent writes under load. | `authenticate.ts` | Throttle like `last_active_at` (already throttled to 5 minutes). |

## 3. Measure first (before any change)

1. Seed realistic volumes with `scripts/seed-perf-data.ts` on a **separate** database (never the test or production one).
2. Enable `pg_stat_statements` and `log_min_duration_statement` on that database.
3. Use the existing `getQueryCount()` hook (`src/server/db/client.ts`) to record queries per request for search, profile view, recommendations, chat list, notifications and the admin dashboard.
4. Run `tests/performance-load.test.ts` before and after each change, and record results in `PERFORMANCE_REPORT.md`.
5. For photos, measure bytes transferred for one search page in the browser's network panel.

## 4. Suggested order

1. P-1 (search N+1) and P-2 (photo thumbnails and caching): biggest user-visible gains, contained changes.
2. P-8 (pagination) and P-12 (throttle `last_seen_at`): small and low risk.
3. P-5 (indexes): after `EXPLAIN` on seeded data.
4. P-3 (recommendation caching) and P-4 (chat push): design work; agree the approach first.
5. P-7, P-9, P-10: only if measurements show they matter.
