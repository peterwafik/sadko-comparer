# SADKO storefront rebuild — design

**Date:** 2026-09-04
**Status:** approved for planning
**Scope:** the shopping experience (`shop.html`, `category/*.html`, `product.html`). The 3D scroll-world home page (`index.html`) is explicitly out of scope.

---

## 1. Goal

Turn SADKO's shop from a thin product list into a storefront that reads like a
mainstream e-commerce site (BestBuy / Amazon / Jumia): a merchandising landing
page with promotional slots and category entry points, a real faceted browse
with shareable URLs, and a product page with a conventional gallery + buy-box
layout.

The home page stays a deliberately unusual 3D scroll-world whose job is to grab
attention. The moment a visitor enters the shop, navigation should feel familiar.

Branding does not change: the storefront is built from the tokens already in
`assets/css/app.css`, not a new palette.

## 2. Non-goals

- No change to `index.html` or any of the scroll-world modules.
- No change to cart, checkout, account, admin, auth or order logic.
- No new payment capability. The cash-on-delivery / bank-transfer / pay-at-showroom
  rule and the deliberate absence of card inputs stand.
- No build step. The site stays static files served by `compare-server.mjs`.
- No ratings, reviews-count, stock levels or delivery estimates on cards — the
  catalogue has none and inventing them is forbidden (§4).

## 3. Catalogue facts this design is built on

Verified against `site/data/products.json` on 2026-09-04:

| Fact | Value |
|---|---|
| Products | 471 |
| Fields per product | `id, url, title, image, price, description, categoryId` |
| Products with no usable price | 0 |
| Price min / median / max | 65 / 11,363 / 54,479 EGP |
| Distinct `categoryId` values in use | **10** |
| `scrapedAt` | a single timestamp for the whole file |

Two consequences that shape the design:

1. **There is no per-product date.** A "new arrivals" rail cannot be derived
   honestly, so it is not in this design.
2. **Products are tagged only at top level.** Every subcategory node in the
   current `shop.js` `TREE` (نو فروست, ديفروست, غسالات ملابس, غسالات أطباق, the six
   small-appliance children, …) matches **zero** products, and one top-level node
   (`167433056` حرف يدوية ومنتجات عضوية) is also empty. The existing sidebar
   therefore offers dead filters. Facets in the new browse are derived from real
   counts via `skApp.liveCats()`; a node with no products is never rendered.

Live categories and counts:

| Count | categoryId | Category |
|---|---|---|
| 157 | 112439376 | أجهزة صغيرة |
| 76 | 38003882 | ثلاجات |
| 49 | 38005652 | غسالات |
| 35 | 38003799 | أفران وبوتاجازات |
| 35 | 38032005 | تكييفات هواء |
| 32 | 38022381 | تليفزيونات |
| 28 | 50318054 | مبردات هواء ومراوح |
| 27 | 40507239 | سخانات مياه |
| 22 | 38005648 | فريزرات |
| 10 | 102858075 | مبردات مياه |

## 4. Non-negotiable constraints

Inherited from the buying-journey layer and still binding:

- **Never invent a spec, price or delivery cost.** No "was" prices, no fabricated
  discount percentages, no invented stock or delivery dates. Where a value is
  unknown, show "غير متوفر" and say to confirm with the seller.
- **Never claim a capability the site lacks.** No price alerts, no live stock.
- **A missing spec never hides a product.** A product whose brand could not be
  derived must still appear in unfiltered results, and must only disappear when
  the user explicitly selects a *different* brand.
- Prices shown are catalogue prices with the existing caveat line already used on
  the PDP ("سعر صادكو وقت آخر تحديث للكتالوج — أكّد السعر قبل الشراء").

### 4.1 The `article.card` contract

`nav.js` (`enhanceCategoryCards`, `injectFinderCta`, add-to-cart injection) and
`prefs.js` (`applyToCards`, filter-by-my-place) both query `article.card` and read
`.card__body`. Every product card the storefront renders **must** keep this
structure:

```html
<article class="card" data-id="…" data-cat="…">
  <a class="card__imgwrap" href="…"><img loading="lazy" decoding="async" src="…" alt="…"></a>
  <div class="card__body">
    <h3 class="card__title">…</h3>
    <p class="card__teaser">…</p>
    <div class="card__row">
      <span class="card__price">…<small>جنيه</small></span>
      <a class="card__buy" href="…">…</a>
    </div>
  </div>
</article>
```

New classes may be added; these may not be removed or renamed. After any grid
renders, the storefront calls the same hooks `nav.js` uses on load so injected
controls appear on dynamically rendered cards too.

## 5. Architecture

**New files**

| File | Responsibility |
|---|---|
| `assets/css/storefront.css` | Commerce design system built on `app.css` tokens: cards, rails, promo hero, facet rail, pager, PDP grid. No new colour values. |
| `assets/js/storefront.js` | `window.skShopUI` — pure render helpers, no page-specific logic. |
| `data/promos.json` | Owner-editable promotional slots (§9). |

**Rewritten**

| File | Change |
|---|---|
| `shop.html` | Shell for both hub and browse. |
| `assets/js/shop.js` | Routing between hub/browse, facet state, URL sync. |
| `category/*.html` (×30) | Thin shells that render the browse view for a fixed category. |
| `product.html` | Loads `storefront.css`; shell otherwise unchanged. |
| `assets/js/product.js` | **Only** `render()` and `head()` are rewritten (§8). |

**Untouched:** `index.html`, all scroll-world modules, `nav.js`, `appshell.js`,
`specs.js`, `store.js`, `prefs.js`, `homes.js`, `auth.js`, `cart.html`,
`checkout.html`, `account.html`, `admin.html`.

### 5.1 `skShopUI` surface

`storefront.js` exposes only pure functions returning HTML strings, plus two
mount helpers. It holds no state and reads no URL.

```
skShopUI.card(product, opts)        -> article.card markup (§4.1)
skShopUI.rail(title, products, more)-> horizontally scrolling product rail
skShopUI.promoHero(promos)          -> hero slot(s) from promos.json
skShopUI.categoryTile(cat, count)   -> category entry tile
skShopUI.brandTile(brand, count)    -> brand entry tile
skShopUI.priceBands(bands)          -> price-band entry row
skShopUI.facets(state, data)        -> facet rail markup
skShopUI.toolbar(state, total)      -> count + sort + view toggle
skShopUI.pager(page, pages, hrefFor)-> numbered pagination
skShopUI.breadcrumb(trail)          -> breadcrumb nav
skShopUI.afterGrid(rootEl)          -> re-runs nav.js/prefs.js card hooks
skShopUI.mountRailScroll(rootEl)    -> arrow/drag behaviour for rails
```

Rationale: keeping rendering in one stateless module is what stops the 30
category pages from drifting from `shop.html`. Each unit is independently
readable and testable, and `shop.js` stays about state, not markup.

## 6. Surface: storefront hub

`shop.html` with no recognised query parameter.

Order down the page:

1. **Breadcrumb** — البيت ← المتجر
2. **Promo hero** — slots from `promos.json`. A single wide slot on mobile; a
   2-up arrangement (one large, one stacked pair) on desktop. If `promos.json` is
   empty or fails to load the whole block is omitted — never a broken frame.
3. **Category tiles** — the 10 live categories with real product counts.
4. **Shop by brand** — brand tiles from `skSpecs.of()` across the catalogue,
   ordered by product count, capped at 12, with a count each.
5. **Price bands** — تحت ٥٬٠٠٠ / ٥٬٠٠٠–١٥٬٠٠٠ / ١٥٬٠٠٠–٣٠٬٠٠٠ / فوق ٣٠٬٠٠٠, each
   linking into browse with `min`/`max` set. Bands are chosen to spread the real
   distribution (median 11,363).
6. **Category rails** — for the **top 4 categories by product count** (أجهزة
   صغيرة, ثلاجات, غسالات, أفران وبوتاجازات), a horizontal rail of that category's
   **8 lowest-priced** products, titled "الأوفر فى <category>" with a "شوف الكل"
   link into browse. This is a factual ordering, not a discount claim.

Every element is a link into the browse view; the hub holds no filter state.

## 7. Surface: browse & search

`shop.html` with any of `cat, q, brand, min, max, sort, page, all`.

- `?all=1` browses the whole catalogue.
- Presence of any recognised parameter selects browse over hub.

**Layout** — facet rail (right in RTL, left in LTR) + results column. On ≤860px
the facet rail collapses into a "الفلاتر" button opening a full-height sheet, with
an apply/clear footer.

**Facets**
- *Category* — live categories with counts; single-select.
- *Brand* — derived via `skSpecs.of(p).brand`, with counts; multi-select.
  Products with no derivable brand group under "غير محدد" and are never removed
  by a brand filter unless the user selects a different brand explicitly (§4).
- *Price* — the four bands plus a min/max numeric pair.

**Toolbar** — result count, sort (`default | price-asc | price-desc`), and a
grid/list view toggle persisted per device under `localStorage` key
`sadko-shop-view` (verified not to collide with the 18 keys already in use).

**Search** — matches the existing catalogue conventions: bilingual token match
over title + description, reusing the translator already loaded via
`catalog-i18n.js` so an English query matches Arabic titles.

**Pagination** — numbered, 24 per page, driven by `?page=`. On ≤860px it renders
as prev / "صفحة N من M" / next. One mechanism only; no infinite scroll.

**URL is the single source of truth.** Every facet change rewrites the query
string via `history.pushState` and re-renders from it, so results are shareable
and browser back/forward moves through filter states. On load, state is read from
the URL. Empty results render the existing empty state plus one-click "امسح
الفلاتر".

## 8. Surface: product page

`product.html` stays a thin shell. In `product.js`, **only** `render()` and
`head()` change. Every other section function keeps its current signature and
output, so the suitability logic, numeric space check, running-cost model,
specs panel, reviews, Q&A and guides embed are carried over unmodified:

`suitability` · `spaceCheck` · `spaceVerdict` · `goodToKnow` · `cheaperTwin` ·
`energyPanel` · `specsPanel` · `reviewsPanel` · `qaPanel` · `guides` · `wire`

New `render()` composition:

1. Breadcrumb — البيت ← <category> ← <product>
2. Two-column hero: **gallery** (single catalogue image, presented in a proper
   frame with zoom-on-hover) and **buy-box** from the new `head()`.
3. The existing panels, in their current order, inside the new page chrome.
4. **Related rail** — `skShopUI.rail()` over the `peers` array `render()` already
   computes.

New `head()` renders: title, brand/capacity/energy chips, price with the existing
caveat line, and the existing action set (اشترى من صادكو, قارن الأسعار, احفظ,
ضيفه لخطة). The buy-box is `position: sticky` on ≥980px.

**Constraint:** `wire()` binds by element id (`#btnSave`, `#qaForm`, …). Those ids
must survive the rewrite verbatim or the handlers silently stop working. This is
the single highest-risk edit in the project and gets an explicit test.

## 9. Data: `data/promos.json`

```json
{
  "note": "Sample content. Replace with real SADKO campaigns. Never add a 'was' price that isn't real.",
  "promos": [
    {
      "id": "sample-cooling",
      "sample": true,
      "title": "تكييفات وتبريد",
      "sub": "٣٥ موديل من صادكو",
      "cta": "تسوّق التكييفات",
      "href": "shop.html?cat=38032005",
      "image": "assets/img/…",
      "accent": "teal",
      "titleEn": "…", "subEn": "…", "ctaEn": "…"
    }
  ]
}
```

- `sample: true` renders a small "محتوى تجريبي" marker so seeded content is never
  mistaken for a live campaign. Removing the flag removes the marker.
- `accent` is one of `teal | amber | ink` — token names, not hex values.
- No price, discount or percentage field exists in this schema, by design. If a
  real campaign later needs one it must come from a real source.
- 3–4 seeded promos pointing at real, populated categories.

**Artwork.** The repository has no banner images — only the scroll-world room
scenes and logos. This design therefore adds **no new image assets and spends no
generation credits**:

- `image` is **optional**. When absent, the slot renders as a typographic panel
  in its `accent` token — which is the default presentation.
- The seeded samples reuse room stills already in the repo
  (`still_1.jpg` living, `still_2.jpg` kitchen, `still_3.jpg` laundry), which
  genuinely depict SADKO rooms, darkened under a token-coloured scrim so the
  Cairo type stays legible in both languages.
- A missing or 404 `image` falls back to the typographic panel rather than a
  broken frame.

## 10. Bilingual & RTL

The storefront follows the existing model exactly: `nav.js` owns `window.skLang`;
category names come from `window.skCatEn`; product titles from
`window.skCatalogI18n`. Every new string is added to a `T` dictionary with `ar`
and `en` entries in the module that renders it — no bare literals in markup.

Authored RTL-first, with `html[dir=ltr]` mirrors for anything directional (facet
rail side, breadcrumb arrow, rail scroll direction, card row order).

## 11. Testing

Manual, in-browser, both languages, at 393px and 1440px:

1. Hub renders; every category tile count matches a `liveCats` count; brand tiles
   and price bands link into browse with the right parameters.
2. `promos.json` missing / empty / malformed → hub renders without the promo block
   and without a console error.
3. Facet round-trip: apply category + brand + price, reload the URL, get identical
   results; back/forward walks filter states.
4. A product with no derivable brand appears in unfiltered results and under
   "غير محدد", and is not removed by an unrelated brand filter.
5. No dead facets: every rendered facet returns ≥1 result.
6. **`nav.js` add-to-cart and the "التفاصيل والمقاس" link appear on dynamically
   rendered cards** (the `afterGrid` hook), and `skPrefs` filter-by-my-place still
   binds to the new grid.
7. PDP: `#btnSave` saves, Q&A submits, running-cost and space-check render the
   same values as before the rewrite for a sampled product in each family.
8. All 30 category pages load and show their category's products.
9. Mobile: facet sheet opens/closes, pager works, no horizontal page scroll.
10. No console errors on any surface; existing pages (home, cart, checkout,
    account) still load.

## 12. Risks

| Risk | Mitigation |
|---|---|
| `product.js` `wire()` breaks silently on the `render()`/`head()` rewrite | Preserve ids verbatim; explicit test 7 |
| New cards break `nav.js` / `prefs.js` injection site-wide | `article.card` contract (§4.1) + `afterGrid` + test 6 |
| 30 category pages drift from `shop.html` | They are thin shells; all rendering lives in `storefront.js` |
| Brand facet hides products with underivable brands | "غير محدد" bucket + test 4 |
| Seeded promos read as real offers | `sample: true` marker + note field |
| Scope creep into checkout/auth | Explicit non-goal (§2) |
