# Ecwid backend integration — design

**Date:** 2026-09-15
**Status:** approved for planning
**Scope:** make the Ecwid store that already backs `https://www.sadko-group.com/`
the control plane for the new site's **products, categories, product rails and
orders**. Staff keep working in Ecwid; the new site reflects their work.

---

## 1. Goal

SADKO's staff already run the business from an Ecwid store (id `18028328`),
injected into the WordPress site by the `ecwid-shopping-cart` plugin. The new
site does not read that store: it serves a one-off July scrape. So the two
diverge, and anything staff do in Ecwid is invisible on the new site.

This design makes Ecwid authoritative for the catalogue, sends new-site orders
*into* Ecwid so staff fulfil everything from the one desk they already know, and
keeps the new site's own presentation layer local.

## 2. Non-goals

- No change to the price comparer. It indexes **rival** stores; it does not read
  `data/products.json` (verified: `baseCatalog()`/`mergedCatalog()` are called
  only by the storefront and admin paths). The matcher is untouched.
- No change to `index.html` or the scroll-world.
- No new payment capability. Cash-on-delivery / bank transfer / pay-at-showroom
  stands, and no card inputs are added.
- No customer accounts in Ecwid as the login system. The new site's own
  `accounts.db` remains the identity store.
- The 30 generated `category/*.html` pages stay static files (see §9.2).
- No token-free JSON-LD ingest path is built (see §10.1).

## 3. Facts this design is built on

Verified against the live store and the repo on 2026-09-14/15.

| Fact | Value |
|---|---|
| Ecwid store id | `18028328` |
| Products live in Ecwid **now** | **510** |
| Products in `site/data/products.json` (July snapshot) | 471 |
| Added since the snapshot | **77** |
| Removed since the snapshot | **38** |
| Categories | 30 (unchanged since July) |
| Ids already aligned | `products.json` `id` and `categoryId` **are** the Ecwid product/category ids — no mapping table needed |
| Enumeration source | `https://www.sadko-group.com/wp-sitemap-ecstore-1.xml` — 540 URLs, each with a `lastmod` |
| Latest `lastmod` | 2026-09-14T07:17Z — staff are actively editing |
| REST API | `GET /api/v3/18028328/*` returns **HTTP 403** without a token; no public token is exposed anywhere in the storefront |
| Why no public token leaks | The WP plugin **server-renders** the catalogue (`ecwid-static-page`); a full headless page load produced **zero** Ecwid API requests |
| Product pages | Carry JSON-LD `Product` with `name, brand, sku, description, image[], offers.price, priceCurrency: EGP, availability` |
| Serving seam | `compare-server.mjs` intercepts `GET /data/products.json` and returns `mergedCatalog()`; **every** client page reads that one URL |
| Local admin overlay (`catalog-admin.db`) | **Empty** — 0 overrides, 0 custom, 0 hidden, 0 settings. No migration cost |
| Order statuses | `received, confirmed, preparing, shipping, delivered, cancelled` (`engine/accounts.mjs:92`) |
| Payment methods | `cod, bank, showroom` (`compare-server.mjs:1651`) |
| Order totals | `createOrder` stores `grandTotal: null` **deliberately** — delivery/installation are confirmed by customer care |
| Customer email today | **None.** The site sends no email at all; confirmation is the on-screen receipt plus a call on 19140 |
| Existing titles | Contain HTML entities (`&nbsp;`) — the mapper must decode them |

### 3.1 Why this is worth doing regardless of design

The new site is showing staff a catalogue that is 115 products adrift (77
missing, 38 phantom). Every day that gap grows.

## 4. Architecture

**Ecwid is mirrored into SQLite and served through the seam the site already
speaks.** Chosen over rewriting `data/products.json` on disk (whole-file
rewrites per webhook, write-locking, no per-product provenance) and over letting
the browser call Ecwid directly (ships a token to every visitor, couples page
render to Ecwid's uptime, breaks the server-side merge, cannot push orders).

```
Ecwid store 18028328
   |  webhook (near-instant)        |  REST pull (15 min + daily full)
   v                                v
        engine/ecwid-sync.mjs  --->  data/ecwid.db  (mirror + push queue)
                |                        |
        engine/ecwid-api.mjs             v
        engine/ecwid-map.mjs      mergedCatalog()  --->  GET /data/products.json
                                         ^                      |
                            catalog-admin.db overlay            v
                            (site-only fields: badge)     every client page
                                                          (unchanged)
```

### 4.1 Modules

| Module | Job | Depends on |
|---|---|---|
| `engine/ecwid-api.mjs` | Thin client over Ecwid REST v3. Token from env, retry with backoff, rate-limit handling, normalised errors. `listProducts({updatedFrom})`, `getProduct`, `listCategories`, `createOrder`, `findOrderByRef`, `getOrder`. Knows nothing of SADKO shapes. | injected `fetch` |
| `engine/ecwid-map.mjs` | **Pure.** `toSadkoProduct(ecwid)`, `toSadkoCategory`, `toEcwidOrder(localOrder, user)`, `toLocalStatus(ecwidOrder)`. No I/O. | nothing |
| `engine/ecwid-store.mjs` | The mirror (`data/ecwid.db`): `products`, `categories`, `sync_state`, `order_push`. WAL, migrations, prepared statements — same discipline as `accounts.mjs` / `catalog-admin.mjs`. | `node:sqlite` |
| `engine/ecwid-sync.mjs` | Orchestration: full reconcile, incremental pull, webhook application, push-queue worker, scheduling. | the three above |

The risky logic lives in the one pure module, so it is unit-testable without
network or database.

### 4.2 Changes to existing files

`compare-server.mjs` only:

- `mergedCatalog()` base becomes the mirror (seed fallback per §10).
- New `POST /api/ecwid/webhook`.
- `/api/admin/*`: sync status, manual sync, retry-failed-push; products and
  orders become read-only (§8).
- `/api/orders` POST: one call to enqueue a push.
- `ADMIN_CONTENT` gains a `promos` entry (§6.2).

No client-side page changes. They all already fetch `/data/products.json`.

## 5. Catalogue sync

### 5.1 Product shape

`toSadkoProduct` produces today's seven fields plus four new ones:

| Field | Source | Note |
|---|---|---|
| `id`, `url`, `title`, `image`, `price`, `description`, `categoryId` | as today | `title` and `description` HTML-entity-decoded |
| `brand` | Ecwid brand | new; the overlay already declares `brand` editable |
| `sku` | Ecwid sku | new |
| `inStock` | Ecwid stock / `availability` | new; drives §5.4 |
| `compareToPrice` | Ecwid compare-at price | new; drives §5.5 |

### 5.2 Three sync paths

1. **Webhook (near-instant).** Ecwid POSTs `product.created/updated/deleted` and
   `category.*`. The handler verifies the `X-Ecwid-Webhook-Signature` HMAC with a
   constant-time compare, rejects unsigned bodies, returns `200` immediately, and
   does the work asynchronously so Ecwid never retry-storms.
   **The handler ignores the event payload and re-fetches the entity from the
   API.** Convergence on current state makes replays and out-of-order delivery
   harmless — no diff is ever applied.
2. **Incremental pull (15 min).** `listProducts({updatedFrom: last_synced})`.
   The safety net for missed or dropped webhooks.
3. **Daily full reconcile.** `updatedFrom` cannot report deletions, so once a day
   the full Ecwid id set is compared against the mirror and absent rows are
   removed. This is the path that catches the 38 removals.

### 5.3 Merge and precedence

`mergedCatalog()` = mirror rows, overlay applied, hidden dropped, memory-cached
and invalidated on write.

**Ecwid wins on every field it owns** (`title, price, image, description,
categoryId, brand, sku, inStock, compareToPrice`). The overlay survives only for
fields Ecwid has no equivalent for — currently `badge`. This removes the drift
class where a local override silently masks a future Ecwid price change. The
overlay being empty (§3) means nothing is discarded.

### 5.4 Out-of-stock products

Shown, marked unavailable, add-to-cart disabled. **Not hidden** — `availability`
is real data, and hiding would make the site claim a smaller catalogue than the
store has.

### 5.5 Was-prices and discounts

`compareToPrice` is imported and **real discounts are displayed**: a discount
renders only when a staff-entered `compareToPrice` genuinely exceeds the current
`price`. Where `compareToPrice` is less than or equal to `price` (stale), it is
ignored entirely.

The honesty tests in `engine/shop-core.test.mjs` (the "No invented commercial
claims" block, around lines 419-474) currently forbid **any** discount display.
They are **rewritten, not deleted**: they stop forbidding display and start
asserting *provenance* — a discount may render if and only if it derives from a
synced `compareToPrice` greater than the price. Invented, derived or computed
discounts, ratings, review counts and delivery estimates remain forbidden.

`data/promos.json`'s `note` asserts "the catalogue carries no discount data",
which stops being true for products. The note is corrected; the banner-level rule
(banners themselves make no commercial claims) stands.

## 6. Advertisements

### 6.1 Product rails — live from Ecwid

`data/collections.json` holds three rails as hand-curated id lists, captured in
July. All three become derived, so none can rot:

| Rail | Curated today | Becomes |
|---|---|---|
| عروض صادكو (`offers`) | 38 ids | live membership of Ecwid category `173607281` |
| الأكثر مبيعاً (`bestSellers`) | 5 ids | live membership of Ecwid category `195273251` |
| مختارات صادكو (`featured`) | 13 ids | products carrying a **real** discount, i.e. a synced `compareToPrice` greater than `price` (§5.5) |

`featured` has no Ecwid category — its recorded source is "the special-price
products SADKO features on its own homepage". Deriving it from genuine
`compareToPrice` data expresses exactly that meaning, and makes it live rather
than a July snapshot. `bestSellers` gains the same benefit: the curated list held
only 5 ids where the Ecwid category holds the staff's current selection.

**Empty rails are hidden, never padded.** If no product carries a real discount,
the `featured` rail does not render. Filling it with arbitrary products would be
inventing a commercial claim, which §5.5 forbids.

This also removes a latent failure: `shop-core.test.mjs:432` asserts every
curated id exists in the catalogue, so today a product removed in Ecwid breaks
the test suite. Derived membership cannot drift.

### 6.2 Banner artwork — stays local

Ecwid has **no advertisement or banner entity**. The designed banners in
`data/promos.json` carry a slot, accent colour, bilingual title/CTA and artwork —
none of which Ecwid can hold. Faking them as products in a hidden category would
pollute the real catalogue, its search, feeds and reports.

So banners stay in the SADKO admin: `promos` is added to `ADMIN_CONTENT`
(alongside `guides` and `finder`), reusing the existing `/api/admin/content/*`
editor and the existing image-upload route. No new subsystem.

## 7. Orders

### 7.1 Flow

1. `POST /api/orders` calls `db.createOrder()`, which writes locally **first**,
   unchanged. The local order is the customer's receipt and is never blocked on
   Ecwid.
2. A row is enqueued in `order_push` (`ref`, `attempts`, `next_attempt_at`,
   `last_error`, `ecwid_order_id`).
3. A worker drains it: `toEcwidOrder()`, then `ecwid-api.createOrder()`, then the
   returned Ecwid id is stored against the local order.
4. Exponential backoff, capped attempts, then the order parks as `push-failed` and
   appears in the admin orders desk with a retry action. **No order is ever
   silently lost.**

### 7.2 Idempotency

A push that succeeds but whose response is lost would, on naive retry, create a
duplicate order and staff would ship twice. The worker therefore does
**check-then-create**: before creating, it looks for an existing Ecwid order
carrying the local ref `SDK-XXXXXX` and adopts it if found.

**Which Ecwid field can hold and be queried for that ref could not be verified**
— every API call returns 403 without a token. The design does not depend on a
specific field: first choice is a dedicated external-order-id field, fallback is
writing the ref into order comments and matching on it. **Implementation task 1 is
to confirm this against the live API before any order code ships.**

### 7.3 Status flows back

Staff mark an order shipped in Ecwid, Ecwid sends `order.updated`, `toLocalStatus`
maps Ecwid's fulfilment status onto the existing `ORDER_STATUSES`, and the
customer sees it on the new site's orders page.

Consequently the **local admin orders desk becomes read-only** with a deep link to
the Ecwid order. Status is written in exactly one place, so the two systems cannot
drift.

### 7.4 Payment mapping

An explicit table in `ecwid-map.mjs` maps `cod` / `bank` / `showroom` onto Ecwid's
payment method and payment status. An unrecognised method **throws rather than
guessing** — a wrong payment status on a real order is worse than a failed push.

### 7.5 Totals, without fabrication

`createOrder` stores `grandTotal: null` on purpose. Ecwid expects a total. The
push therefore sends the **items subtotal**, leaves shipping **unset**, and writes
the existing Arabic note ("رسوم التوصيل والتركيب بتتأكد من خدمة العملاء قبل
التنفيذ") into the order comments, so the Ecwid order states what the customer's
receipt states. Staff enter the real shipping cost in Ecwid when they confirm,
which is already their workflow. **No shipping or grand total is ever
synthesised.**

### 7.6 Customer confirmation email

Decision: **Ecwid's email becomes the single customer confirmation** — the new
site builds no email of its own — **and it is enabled only once its rendered
content has been checked** (step 3 below). At launch no customer email is sent,
which is exactly today's behaviour.

Today the site sends no email at all; the confirmation is the on-screen receipt,
which explicitly refuses to show delivery as zero (`checkout.js:62`), plus a call
on 19140. Enabling Ecwid's email therefore *introduces* customer email where none
existed, and Ecwid may render unset shipping as free — contradicting that screen.

Sequenced behind evidence:

1. Launch with Ecwid's **staff** notification on and the **customer** email off.
2. Once the token exists, place one real test order and capture what Ecwid
   actually renders.
3. Show the owner the real email. If the template carries the
   fees-to-be-confirmed line honestly, enable it; if it states or implies free
   shipping, the owner decides with the artefact in hand.

A customer-facing email that implies free delivery is a false statement, so it
stays off until step 3 clears.

### 7.7 Stock

Pushing orders decrements Ecwid stock, so inventory stays correct across both
storefronts instead of the new site overselling what the WordPress store sold.

## 8. Admin

The control room becomes a window onto Ecwid rather than a second editor.

| Surface | Change |
|---|---|
| Products | Read-only mirror view plus an "edit in Ecwid" deep link. Local create/edit/hide removed for Ecwid-owned fields; `badge` stays editable |
| Sync panel | Last sync, last error, product/category counts, pending pushes, failed pushes with retry |
| Orders | Read-only, Ecwid deep link, retry-failed-push |
| Connection | "Ecwid connected / not connected" only — never the token or any part of it |
| Audit log | Unchanged |

## 9. Configuration and operations

### 9.1 Secrets

Three values in `/etc/sadko.env`, read by `sadko.service`:

```
SADKO_ECWID_STORE_ID=18028328
SADKO_ECWID_TOKEN=<owner supplies>
SADKO_ECWID_WEBHOOK_SECRET=<owner supplies>
```

**The owner places the token; the assistant never handles its value.** It is
never logged, never committed, and never echoed in an API response or error
message. The admin panel exposes only connected/not-connected.

The webhook URL must be registered in Ecwid's app settings against the live
sslip.io host. The route is public, so it gets rate-limiting, unsigned-body
rejection and a constant-time signature compare.

### 9.2 Categories added in Ecwid

Categories sync as data, but the 30 `category/*.html` pages are static files
generated by `mkcategories.mjs` from a hardcoded Arabic-name and English-name map
with build-time asserts. A category added in Ecwid therefore has no page, and the
next rebuild fails the assert — deliberately, since an English name cannot be
invented.

So the sync **surfaces "new category needs an English name, then rebuild" as an
admin task**. Replacing the 30 files with one dynamic route is a possible later
project, out of scope here.

## 10. Degradation and error handling

| Failure | Behaviour |
|---|---|
| Ecwid unreachable | Mirror keeps serving last good data; `sync_state.last_error` surfaced in admin |
| Mirror empty (first boot) | Falls back to the static `data/products.json` seed |
| Token missing or invalid | Server boots normally, serves the seed, admin shows "Ecwid not connected" |
| Webhook signature invalid or absent | Rejected, logged, no state change |
| Webhook delivered twice | Converges to one state (re-fetch, not diff — §5.2) |
| Order push fails | Retried with backoff, then parked and surfaced for manual retry |
| Unknown payment method | Push throws; order parks rather than recording a wrong payment status |

The site must never go down, or serve an empty catalogue, because Ecwid did.

### 10.1 Cut scope: the token-free ingest path

A token-free path was proven to work (sitemap enumeration plus per-product
JSON-LD, §3) and is recorded here as a contingency. It is **not built**: orders
require a token anyway, so a second ingest path would be permanent maintenance
for a capability the primary path already covers. Cold start is covered by the
seed file.

## 11. Testing

| Target | Tests |
|---|---|
| `ecwid-map.mjs` (pure) | Real captured payloads: field mapping, HTML-entity decoding (`&nbsp;`), discount provenance rule, stale `compareToPrice` ignored, stock, Arabic text, payment mapping, unknown method throws |
| `ecwid-api.mjs` | Injected `fetch`: 429 and 5xx backoff, timeout, malformed JSON, 403 handling |
| `ecwid-store.mjs` | Temp db: upsert, deletion reconcile, queue drain, adopt-existing |
| Webhook route | Valid / invalid / absent signature; double delivery converges to one state |
| Order push | Two pushes produce **one** Ecwid order |
| Degradation | Empty mirror falls back to seed; missing token still boots and serves |
| Honesty guard | Rewritten: a discount renders if and only if a synced `compareToPrice` exceeds the price; invented claims still forbidden |
| Rails | `offers`/`bestSellers` derive from category membership; `featured` derives from real discounts; a rail with no qualifying products renders nothing |

The suite currently stands at 483 tests. The honesty-guard assertions in
`shop-core.test.mjs` are rewritten in place (§5.5) and the `collections.json`
curated-id assertion at `shop-core.test.mjs:432` is replaced by one covering
derived rails; every other test stays green, and the total does not decrease.

## 12. Rollout

Behind `SADKO_ECWID=1`:

1. Modules land with tests; flag off; nothing observable changes.
2. Mirror populates from Ecwid; **diffed against the current seed and the diff
   reviewed** — the 77 additions and 38 removals are seen before any customer
   sees them.
3. `mergedCatalog()` switches to the mirror.
4. Webhooks registered; freshness verified with a real edit in Ecwid.
5. Order push enabled after §7.2's field question is settled, verified with one
   real test order.
6. Customer email decided per §7.6 step 3.

## 13. Open item carried by implementation

One, tracked as implementation task 1: **which Ecwid order field holds and can be
queried for the local `SDK-` ref** (§7.2). Everything else in this spec is
verified or decided.
