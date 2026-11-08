# Services

Application data comes from the backend through the typed API client in
`src/lib/api/` (see `client.ts`, `hooks.ts`). Blog articles used to be a
static file served from here; they now live in the database and are managed
in Admin → Blog (`src/server/modules/blog/`).
