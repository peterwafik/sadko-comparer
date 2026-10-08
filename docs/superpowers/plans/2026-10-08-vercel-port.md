# Port SADKO to Vercel (Turso + Vercel Functions)

Date: 2026-10-08. Branch: `feat/vercel`. The GCP VM expires today, so the
site must run fully on Vercel, on the **Hobby** plan, against the **Ecwid
test store 142682751**. Compare Prices and My appliances stay hidden
(`HIDDEN_PAGES` in `site/assets/js/nav.js`).

## Why a port and not a config file

`site/compare-server.mjs` is one long-running Node process: it serves the
static site and the API, keeps five `node:sqlite` files on disk, and runs
timers (Ecwid poll + daily sync, order-push retries every 2 min, session
sweeps, comparer refresher). Vercel functions have no lasting disk, no
long-lived process, and on Hobby cron runs once a day.

## Target shape

| Concern | VM today | Vercel |
|---|---|---|
| Static pages, JS, images | node static handler + allow-list | Vercel CDN, only allow-listed files copied into `public/` by `tools/vercel-build.mjs` |
| API (`/api/*`, `/healthz`, dynamic `/data/*.json`, `/api/ecwid/webhook`) | `compare-server.mjs` | the SAME request handler, exported from `api/index.mjs` and reached by rewrites |
| accounts / ecwid mirror / catalogue overlay / analytics | 4 SQLite files | ONE Turso database (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`); per-store `<name>_migrations` tables |
| Comparer price index (`catalog.db`, `price-index.json`) | disk | not deployed (page hidden) |
| Admin image uploads | `data/uploads/` on disk | `uploads` table in Turso, served by the function with long cache headers |
| Admin edits to `data/*.json` content | overwrote the file | `content` table in Turso, overriding the bundled file |
| Ecwid catalogue freshness | poll every N s + daily full sync | Ecwid webhooks (instant) + opportunistic incremental sync on traffic (at most every 5 min) + daily cron full sync |
| Unsent order pushes | retried every 2 min | retried opportunistically after requests (`waitUntil`), plus the daily cron |
| Session/login-fail sweeps | timer | done on read + daily cron |

## Store conversion contract (engine/*.mjs)

- Use `engine/db.mjs`: `openDb(spec, {authToken})`, `db.prepare(sql).get/all/run/bind`, `db.batch([...])`, `db.exec`, `db.migrate(name, MIGRATIONS)`, and `storeSpec(localFile)` to choose Turso vs the local file.
- `openX(file)` becomes `async` and returns the same-shaped API object; every method that touches the database returns a Promise. Pure helpers stay synchronous.
- Multi-statement writes are `db.batch`, never BEGIN/COMMIT. No reliance on `ON DELETE CASCADE`: delete child rows explicitly in the same batch.
- No `setInterval`/`setTimeout` inside a store. Expose the work (e.g. `sweep()`) and let the caller schedule it.
- `close()` stays synchronous.
- Migration store names: `accounts`, `ecwid`, `catalog_admin`, `analytics`.
- Tests become `async`, keep every assertion's intent, and must all pass.

## Ecwid catalogue in memory

`ecwid-source.mjs` keeps a per-instance snapshot of products and categories.
`await source.refresh()` re-reads them only when the store's catalogue version
(bumped on every product/category write) has changed, checked at most every
few seconds. All read accessors stay synchronous over the snapshot, so the
request code that builds pages keeps its shape.

## Owner actions (cannot be done by Claude)

1. Back up the VM data before it expires (command given in chat) into `D:\SADKO\vm-backup\`.
2. Create/link the Turso database (Vercel Marketplace or turso.tech) and accept its terms.
3. Put secrets into the Vercel project: `SADKO_ECWID_TOKEN`, `SADKO_ECWID_WEBHOOK_SECRET`, plus the non-secret settings.
4. In the Ecwid app settings, point the webhook URL at the new Vercel domain.
5. Add the Vercel domain as an authorised origin on the Google sign-in client.
