# SADKO Price Comparer — Catalog Engine Design

**Date:** 2026-07-19
**Status:** approved for implementation (Milestone 1)

## Problem

The comparer answers a customer query by fanning out to 85 stores live. Measured
against the query `SHARP TV 75 Inch 4K Smart`:

| Status | Count | Meaning |
|---|---|---|
| `empty` | 56 | reached and searched, nothing matched |
| `timeout` | 23 | never finished inside its budget |
| `ok` | 5 | returned a relevant offer |

Neither failure mode is "the store lacks the product":

- The 23 timeouts are lost coverage — the per-store budget (9s plain / 15s auto /
  32s headless) expires before the store replies.
- The 56 empties are largely a **query** problem. The engine posts a six-word
  English string into storefront search boxes that mostly index Arabic and
  degrade badly on long queries, falling back only to `"sharp tv"`. A shop
  listing «شاشة شارب ٧٥ بوصة» never matches.

Live per-query fan-out is structurally wrong for comprehensiveness. Established
comparison engines crawl continuously into a product index and serve lookups from
it.

### Evidence that indexing works here

A sitemap probe across the registry (`scripts/probe-sitemaps.mjs`):

- **33 of 84 stores expose a usable sitemap**, totalling **~104,792 product URLs**.
- Large catalogs are routine: rayashop 22,076 · hyper-techno 17,333 ·
  jumia 10,000 · 2B 7,611 · B.TECH 7,205 · ElAraby 6,369 · egyptlaptop 6,193 ·
  ElGhazawy 6,179 · amanstores 4,885.
- **7 stores whose search is broken are fully indexable**, including tier-1
  `amanstores.com` (4,885) and `egyptlaptop.com` (6,193). Indexing rescues them.
- Conversely `raneen`, `amazon.eg`, `noon`, `carrefouregypt` publish **no**
  sitemap yet are the best live-search performers.

The two paths cover disjoint sets of stores. The design keeps both.

## Goals

1. Comprehensive: results drawn from the whole indexed catalog, not the handful of
   stores that happen to answer in time.
2. Accurate: the offer crowned cheapest is genuinely the **same product**, and its
   displayed price is verified fresh.
3. Category-general: works for any electronic appliance. Adding a category is a
   table entry, not code.
4. Zero runtime dependencies, consistent with the existing codebase.

## Non-goals

- Replacing the live adapters. They are retained for verification, for
  sitemap-less stores, and as the index-miss fallback.
- Real-time price accuracy for every offer. Only displayed top candidates are
  re-verified live.

## Architecture

```
crawler.mjs ──► catalog.mjs (SQLite FTS5) ◄── server.mjs
   sitemaps        products, offers,            search → candidates
   category pages  price_history                     │
   aggregators           ▲                           ▼
   (robots-aware,        │                    matcher.mjs → identity groups
    rate-limited,        └──── live re-verify ◄──── top 10 cheapest
    resumable)                (existing adapters)        │
                                                         ▼
                                                   ranked results
```

**Search path.** FTS5 lookup over the whole catalog (instant) → `matcher` groups
candidates into product identities → cheapest 10 get a live price re-fetch →
ranked output. Verified offers render `✓ verified now`; the remainder show index
age.

**Crawl path.** Per store: fetch `robots.txt`, honour `Disallow` and
`Crawl-delay`, read the sitemap (fall back to category pagination), fetch product
pages, extract JSON-LD/microdata, normalize, upsert. Resumable via a per-store
cursor so an interrupted crawl continues rather than restarts.

### Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `crawler.mjs` | discover product URLs, fetch pages, emit raw records | robots/sitemap parsing |
| `catalog.mjs` | SQLite storage, FTS search, price history | `node:sqlite` |
| `matcher.mjs` | product identity: extract specs, decide sameness | pure, no I/O |
| `server.mjs` | HTTP, ranking, live verification, response shape | all of the above |

`matcher.mjs` is pure and therefore unit-testable without a network.

## Product identity (core)

Everything reduces to: *are these two listings the same product?* Today this is
`isRelevant()` — token overlap with hardcoded assumptions and no concept of
identity. The replacement is data-driven and category-agnostic.

### Layer 1 — universal

Every listing yields `{brand, category, model_number, attrs{}}`. A matching
normalized model number is **definitive** identity: `4T-C75FN6EX` is the same TV
in every store, `WD70J5410AW` the same washer. This layer knows nothing about any
specific category.

Normalization: casefold, strip non-alphanumerics, unify Arabic/Latin digits.

### Layer 2 — spec attributes

Used when no model number is available. A `CATEGORIES` table declares each
category's **defining** attributes:

```js
tv:        { units: ['inch'],           specs: ['resolution','smart'] }
fridge:    { units: ['liter','feet'],   specs: ['doors','nofrost'] }
washer:    { units: ['kg','rpm'],       specs: ['loading'] }
ac:        { units: ['hp'],             specs: ['inverter','type'] }
microwave: { units: ['liter','watt'],   specs: ['grill'] }
oven:      { units: ['liter'],          specs: ['fuel'] }
fryer:     { units: ['liter'],          specs: ['digital'] }
heater:    { units: ['liter'],          specs: ['fuel'] }
laptop:    { units: ['inch','gb','tb'], specs: ['cpu','ram'] }
phone:     { units: ['gb'],             specs: ['ram','5g'] }
```

A shared extraction engine reads `quantity + unit` pairs in either language:
`75 بوصة` / `75 inch` / `٧٥"` → `{inch:75}`; `7 كجم` / `7KG` → `{kg:7}`;
`1.5 حصان` / `1.5HP` → `{hp:1.5}`. Unit synonyms extend the existing `SYN_RAW`
groups.

### Matching rule

> A defining attribute **present in both** listings and **different** ⇒ different
> products. **Present in one only** ⇒ unknown; allowed, lower confidence. All
> present attributes equal, same brand, same category ⇒ same product.

One rule, every category. A 7kg washer cannot match a 9kg; a 16ft fridge cannot
match an 18ft; a 1.5HP AC cannot match a 2.25HP — with no category-specific code.
Adding air fryers or water heaters is one table row.

### Confidence tiers

| Tier | Condition | Eligible for #1 |
|---|---|---|
| `exact` | model numbers match | yes |
| `strong` | brand + category + all present specs agree | yes |
| `weak` | brand + category only | no — visible, never crowned |

This is what prevents the engine confidently crowning a cheaper *different*
product.

## Schema

```sql
products (id, brand, category, model_norm, attrs_json, title_canonical)
offers   (id, product_id, store_domain, url UNIQUE, price, currency,
          in_stock, title_raw, confidence, first_seen, last_checked)
price_history (offer_id, price, seen_at)
crawl_state   (store_domain, last_sitemap_etag, cursor, last_run, status)
products_fts  -- FTS5(title_canonical, brand, model_norm) tokenize='unicode61'
```

`offers` keyed by URL; `products` by identity. Price history rides on offers,
preserving the drop/rise data the current index collects.

FTS5 with `unicode61` is verified to tokenize Arabic correctly and to match model
numbers exactly when query terms are quoted.

## Error handling and politeness

- `robots.txt` respected, including `Crawl-delay`; conservative default delay
  when unspecified.
- Identifying User-Agent with a contact URL.
- Hard cap on pages per store per run; per-store circuit breaker retained.
- A store that bot-walls is marked and backed off, not hammered.
- Crawl failures never affect serving — a stale catalog still answers.
- Aggregator sources (`egprices.com`, `eg.labeb.com`, `pricena.com`) were checked:
  all three permit crawling via robots.txt. `SKIP_DOMAINS` must be updated, as it
  currently blocks `pricena`. Yaoota is defunct.

## Testing

- **`matcher.mjs`: fixture-based unit tests, no network.** Real titles harvested
  from the sweep across TV, fridge, washer, AC, microwave, laptop, phone, with
  expected same/different verdicts. Negative cases are mandatory: 7kg vs 9kg,
  65" vs 75", 128GB vs 256GB, 1.5HP vs 2.25HP.
- **`catalog.mjs`:** in-memory SQLite, round-trip upsert/search/history.
- **`crawler.mjs`:** integration tests against saved HTML/XML fixtures.
- **End-to-end:** probe set spanning ≥6 appliance categories, compared against the
  current live fan-out baseline.

## Milestone 1

**Stores (13).** SADKO's own catalog plus the twelve highest-value sitemap stores:

`sadko-group.com` (local), `2b.com.eg`, `btech.com`, `elarabygroup.com`,
`jumia.com.eg`, `rayashop.com`, `amanstores.com`, `egypt.sharafdg.com`,
`elghazawy.com`, `egyptlaptop.com`, `kenzz.com`, `hyper-techno.com`,
`awadserag.com`

**94,482 product URLs** across the twelve sitemap stores, plus SADKO's own
catalog. Deliberately includes four stores whose live search
is broken (`rayashop`, `amanstores`, `egyptlaptop`, `awadserag`) to demonstrate
that indexing rescues them.

Live adapters remain active for `raneen`, `amazon.eg`, `noon`, `carrefouregypt`,
which publish no sitemap.

**Success metric — measured, not asserted.** A probe set spanning ≥6 appliance
categories. For each query, compare offers returned and correctness of the crowned
cheapest against the current live fan-out baseline.

Target: **≥3× offers per query at <3s response, with zero mis-identified winners
in the fixture set.**

Both numbers come from a script committed alongside the code, so the claim is
reproducible rather than a matter of assertion.

## Deployment

Runs locally today via `start-comparer.bat`. The crawler is a scheduled
background task in the same process, so local operation is unchanged.

For 24/7 hosting, an always-on VM (e.g. Oracle Cloud Always Free) suits the
crawler far better than serverless: Vercel's function timeouts and lack of
persistent disk are hostile to crawling and to a SQLite file. The static site can
still be served from Vercel/GitHub Pages with the engine's API hosted separately.

## Risks

| Risk | Mitigation |
|---|---|
| Crawl volume trips bot protection | robots-compliant delays, page caps, per-store breaker, identifying UA |
| Matcher wrongly merges distinct products | confidence tiers; only `exact`/`strong` crowned; negative fixtures |
| Indexed prices drift | top-10 live re-verification before display; visible age on the rest |
| SQLite file growth | price history capped per offer; stale offers pruned by `last_checked` |
| Scope creep beyond one session | staged milestones, each independently verifiable |
