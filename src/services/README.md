# Services

Application data comes from the backend through the typed API client in
`src/lib/api/` (see `client.ts`, `hooks.ts`). The only module left here is
`blogService`, which serves the static marketing articles in
`src/data/blogPosts.ts` — the backend has no CMS/blog API, so this content is
intentionally static.
