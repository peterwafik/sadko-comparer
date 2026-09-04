# SADKO Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild SADKO's shopping experience — a merchandising hub, a faceted browse with shareable URLs, 30 regenerated category pages and a relaid-out product page — in a mainstream e-commerce shape, on the existing brand tokens.

**Architecture:** Pure logic (URL state, filtering, derivations) lives in `shop-core.js`; HTML-string rendering lives in `storefront.js`; page-level wiring lives in `shop.js`. Both new modules use a dual browser/Node export so their pure functions are unit-tested with `node --test`. The 30 category pages become thin shells over the same renderer so they cannot drift.

**Tech Stack:** Vanilla ES5-compatible browser JS (classic `<script>`, IIFE + `window.*` globals), plain CSS with custom properties, `node:test` + `node:assert/strict` for unit tests. No build step, no dependencies, no package.json.

**Spec:** `docs/superpowers/specs/2026-09-04-sadko-storefront-design.md`

## Global Constraints

- **Never invent a spec, price or delivery cost.** No "was" prices, no fabricated discounts, no invented stock or delivery dates. Unknown values render "غير متوفر".
- **A missing spec never hides a product.** A product with no derivable brand appears in unfiltered results and only disappears when a *different* brand is explicitly selected.
- **The `article.card` contract is binding.** `nav.js` (`enhanceCategoryCards`, `injectFinderCta`) and `prefs.js` (`applyToCards`) query `article.card` and read `.card__body`. Required descendants: `.card__imgwrap`, `.card__body`, `.card__title`, `.card__teaser`, `.card__row`, `.card__price`, `.card__buy`.
- **`card__imgwrap` and `card__buy` must href `product.url`** (the sadko-group.com shop URL), not `product.html?id=…`. `enhanceCategoryCards` looks products up by `new URL(link.href).pathname`, so an internal href makes every lookup miss and add-to-cart silently never appears. `nav.js` appends the internal "التفاصيل والمقاس" link itself.
- **`nav.js` gets exactly two additive edits** (Task 8): an idempotency guard and a `window.skNav` export. No logic change, no behaviour change for existing pages. Nothing else in `nav.js` may be touched.
- **`product.js` `wire()` binds by element id.** Ids `btnSave` and `qaForm` must survive the `render()`/`head()` rewrite verbatim.
- **No new colour values.** Use only tokens already in `assets/css/app.css`: `--teal #7ebec5`, `--teal-deep #2e7e88`, `--ink #14343a`, `--ink-soft #5b6b6e`, `--amber #fe9800`, `--bg #f7f5f1`, `--card #fff`, `--line #e6e2da`, `--ok #17795a`, `--warn #b06a10`, `--bad #b23b3b`, `--radius 18px`.
- **Bilingual parity.** Every user-visible string has `ar` and `en` entries in a `T` dictionary. Language comes from `window.skLang`; category names from `window.skCatEn`; product titles from `window.skCatalogI18n`. No bare literals in markup.
- **RTL-first**, with `html[dir=ltr]` mirrors for anything directional.
- **Out of scope, do not modify:** `index.html`, all scroll-world modules (`scrub-engine.js`, `hotspots.js`, `posters.js`, `guide.js`), `nav.js`, `appshell.js`, `specs.js`, `store.js`, `prefs.js`, `cart.html`, `checkout.html`, `account.html`, `admin.html`, and all auth/order logic.
- **Catalogue facts:** 471 products; fields `id, url, title, image, price, description, categoryId`; 10 live categories; every subcategory id matches zero products; no per-product date; no discount data.
- **Run tests from the repo root** (`D:\SADKO`): `node --test site/engine/<name>.test.mjs`
- **Commit after every task.**

---

## File Structure

| File | Responsibility |
|---|---|
| `site/assets/js/shop-core.js` | **New.** Pure data logic, no DOM: URL state parse/serialise, catalogue derivations, filter/sort/paginate. Dual export (`window.skShopCore` + `module.exports`). |
| `site/assets/js/storefront.js` | **New.** Pure HTML-string renderers (`window.skShopUI`) + browser-only mount helpers. Dual export. |
| `site/assets/css/storefront.css` | **New.** Commerce design system on existing tokens. |
| `site/data/promos.json` | **New.** Owner-editable promo slots, seeded with samples. |
| `site/shop.html` | **Rewrite.** Shell for hub + browse. |
| `site/assets/js/shop.js` | **Rewrite.** Routes hub vs browse, owns state, syncs URL. |
| `site/category/*.html` (×30) | **Regenerate.** Thin shells rendering browse for a fixed category. |
| `site/assets/js/product.js` | **Modify** `render()` and `head()` only (lines ~72–110). |
| `site/product.html` | **Modify.** Add `storefront.css` + `storefront.js`/`shop-core.js` script tags. |
| `site/engine/shop-core.test.mjs` | **New.** Unit tests for `shop-core.js`. |
| `site/engine/storefront.test.mjs` | **New.** Unit tests for `storefront.js` renderers + the card contract. |
| `site/engine/product-ids.test.mjs` | **New.** Regression guard for `wire()` element ids. |

---

### Task 1: shop-core — URL state round-trip

**Files:**
- Create: `site/assets/js/shop-core.js`
- Test: `site/engine/shop-core.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `skShopCore.parseState(search) -> State`, `skShopCore.stateToSearch(state) -> string`, `skShopCore.isBrowse(state) -> boolean`, and the `State` shape `{cat:string, q:string, brands:string[], min:number|null, max:number|null, sort:string, page:number, all:boolean}`. Every later task reads and writes this shape.

- [ ] **Step 1: Write the failing test**

Create `site/engine/shop-core.test.mjs`:

```js
// site/engine/shop-core.test.mjs
// shop-core.js is a classic browser script with a dual CommonJS export, so it
// is pulled in with createRequire rather than a static ESM import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/shop-core.js');

test('parseState returns defaults for an empty query string', () => {
  const s = core.parseState('');
  assert.deepEqual(s, { cat: '', q: '', brands: [], min: null, max: null, sort: 'default', page: 1, all: false });
});

test('parseState reads every recognised parameter', () => {
  const s = core.parseState('?cat=38003882&q=%D8%AB%D9%84%D8%A7%D8%AC%D8%A9&brand=kiriazi,lg&min=5000&max=15000&sort=price-asc&page=3');
  assert.equal(s.cat, '38003882');
  assert.equal(s.q, 'ثلاجة');
  assert.deepEqual(s.brands, ['kiriazi', 'lg']);
  assert.equal(s.min, 5000);
  assert.equal(s.max, 15000);
  assert.equal(s.sort, 'price-asc');
  assert.equal(s.page, 3);
});

test('stateToSearch omits defaults', () => {
  const s = core.parseState('');
  s.cat = '38003882';
  assert.equal(core.stateToSearch(s), '?cat=38003882');
});

test('parseState and stateToSearch round-trip', () => {
  const original = '?cat=38003882&brand=kiriazi,lg&min=5000&sort=price-desc&page=2';
  const round = core.stateToSearch(core.parseState(original));
  assert.deepEqual(core.parseState(round), core.parseState(original));
});

test('page below 1 and non-numeric prices are rejected, not crashed on', () => {
  const s = core.parseState('?page=0&min=abc&max=-5');
  assert.equal(s.page, 1);
  assert.equal(s.min, null);
  assert.equal(s.max, null);
});

test('isBrowse is false for the bare hub and true for any recognised parameter', () => {
  assert.equal(core.isBrowse(core.parseState('')), false);
  assert.equal(core.isBrowse(core.parseState('?all=1')), true);
  assert.equal(core.isBrowse(core.parseState('?cat=38003882')), true);
  assert.equal(core.isBrowse(core.parseState('?q=lg')), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/shop-core.test.mjs`
Expected: FAIL — `Cannot find module '../assets/js/shop-core.js'`

- [ ] **Step 3: Write minimal implementation**

Create `site/assets/js/shop-core.js`:

```js
/* SADKO shop-core — pure catalogue + URL-state logic. No DOM, no globals read.
   Loaded as a classic script in the browser (window.skShopCore) and required
   directly by node --test, so it must stay free of browser-only APIs. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.skShopCore = api;
})(this, function () {
  'use strict';

  var SORTS = ['default', 'price-asc', 'price-desc'];

  function num(v) {
    var n = parseInt(v, 10);
    return (isFinite(n) && n >= 0) ? n : null;
  }

  function parseState(search) {
    var p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    var page = parseInt(p.get('page'), 10);
    var sort = p.get('sort') || 'default';
    return {
      cat: p.get('cat') || '',
      q: p.get('q') || '',
      brands: (p.get('brand') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      min: num(p.get('min')),
      max: num(p.get('max')),
      sort: SORTS.indexOf(sort) >= 0 ? sort : 'default',
      page: (isFinite(page) && page >= 1) ? page : 1,
      all: p.get('all') === '1'
    };
  }

  function stateToSearch(s) {
    var p = new URLSearchParams();
    if (s.all) p.set('all', '1');
    if (s.cat) p.set('cat', s.cat);
    if (s.q) p.set('q', s.q);
    if (s.brands && s.brands.length) p.set('brand', s.brands.join(','));
    if (s.min != null) p.set('min', String(s.min));
    if (s.max != null) p.set('max', String(s.max));
    if (s.sort && s.sort !== 'default') p.set('sort', s.sort);
    if (s.page && s.page > 1) p.set('page', String(s.page));
    var q = p.toString();
    return q ? '?' + q : '';
  }

  function isBrowse(s) {
    return !!(s.all || s.cat || s.q || (s.brands && s.brands.length) ||
              s.min != null || s.max != null || s.sort !== 'default' || s.page > 1);
  }

  return { SORTS: SORTS, parseState: parseState, stateToSearch: stateToSearch, isBrowse: isBrowse };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/shop-core.test.mjs`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/shop-core.js site/engine/shop-core.test.mjs
git commit -m "feat(shop): url state parse/serialise for the storefront"
```

---

### Task 2: shop-core — catalogue derivations

**Files:**
- Modify: `site/assets/js/shop-core.js`
- Test: `site/engine/shop-core.test.mjs`

**Interfaces:**
- Consumes: Task 1's `State`.
- Produces: `liveCategories(products) -> [{id, count}]` sorted count-desc; `brandsOf(products, specOf) -> [{key, ar, en, count}]` sorted count-desc with the unbranded bucket last under `key: '__none__'`; `PRICE_BANDS -> [{key, min, max}]`. `specOf` is injected (it is `window.skSpecs.of` in the browser) so this stays testable.

- [ ] **Step 1: Write the failing test**

Append to `site/engine/shop-core.test.mjs`:

```js
const SAMPLE = [
  { id: '1', title: 'ثلاجة كريازى 10 قدم', price: 15785, categoryId: '38003882' },
  { id: '2', title: 'ثلاجة كريازى 12 قدم', price: 21000, categoryId: '38003882' },
  { id: '3', title: 'غسالة LG 7 كيلو',     price: 9500,  categoryId: '38005652' },
  { id: '4', title: 'خلاط بدون ماركة',      price: 650,   categoryId: '112439376' }
];
// stand-in for window.skSpecs.of — returns no brand for product 4
const specOf = p => ({ brand: p.title.includes('كريازى') ? { ar: 'كريازى', en: 'Kiriazi', key: 'kiriazi' }
                        : p.title.includes('LG') ? { ar: 'إل جى', en: 'LG', key: 'lg' } : undefined });

test('liveCategories counts only categories that have products, count-desc', () => {
  const cats = core.liveCategories(SAMPLE);
  assert.deepEqual(cats, [
    { id: '38003882', count: 2 },
    { id: '38005652', count: 1 },
    { id: '112439376', count: 1 }
  ]);
});

test('brandsOf counts derivable brands and buckets the rest under __none__ last', () => {
  const brands = core.brandsOf(SAMPLE, specOf);
  assert.equal(brands[0].key, 'kiriazi');
  assert.equal(brands[0].count, 2);
  assert.equal(brands[brands.length - 1].key, '__none__');
  assert.equal(brands[brands.length - 1].count, 1);
});

test('PRICE_BANDS cover the catalogue range with no gaps and an open top band', () => {
  const b = core.PRICE_BANDS;
  assert.equal(b[0].min, 0);
  assert.equal(b[b.length - 1].max, null);
  for (let i = 1; i < b.length; i++) assert.equal(b[i].min, b[i - 1].max);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/shop-core.test.mjs`
Expected: FAIL — `core.liveCategories is not a function`

- [ ] **Step 3: Write minimal implementation**

Inside the factory in `site/assets/js/shop-core.js`, before the `return`:

```js
  var PRICE_BANDS = [
    { key: '0-5000',      min: 0,     max: 5000 },
    { key: '5000-15000',  min: 5000,  max: 15000 },
    { key: '15000-30000', min: 15000, max: 30000 },
    { key: '30000+',      min: 30000, max: null }
  ];

  function liveCategories(products) {
    var by = {};
    products.forEach(function (p) {
      var id = String(p.categoryId);
      by[id] = (by[id] || 0) + 1;
    });
    return Object.keys(by)
      .map(function (id) { return { id: id, count: by[id] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // `specOf` is injected so this function has no dependency on window.skSpecs.
  // Products whose brand cannot be derived are counted under '__none__', which is
  // always sorted last — they must remain visible, never silently dropped.
  function brandsOf(products, specOf) {
    var by = {};
    products.forEach(function (p) {
      var b = (specOf(p) || {}).brand;
      var key = (b && (b.key || b.en || b.ar)) ? String(b.key || b.en || b.ar).toLowerCase() : '__none__';
      if (!by[key]) by[key] = { key: key, ar: b ? b.ar : 'غير محدد', en: b ? b.en : 'Unspecified', count: 0 };
      by[key].count++;
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return b.count - a.count;
      });
  }
```

Add `PRICE_BANDS`, `liveCategories` and `brandsOf` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/shop-core.test.mjs`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/shop-core.js site/engine/shop-core.test.mjs
git commit -m "feat(shop): live category, brand and price-band derivations"
```

---

### Task 3: shop-core — filter, sort, paginate

**Files:**
- Modify: `site/assets/js/shop-core.js`
- Test: `site/engine/shop-core.test.mjs`

**Interfaces:**
- Consumes: Task 1 `State`, Task 2 `specOf`.
- Produces: `filter(products, state, specOf) -> Product[]`, `sortList(list, sort) -> Product[]` (new array), `paginate(list, page, per) -> {items, page, pages, total}`.

- [ ] **Step 1: Write the failing test**

Append to `site/engine/shop-core.test.mjs`:

```js
test('filter by category', () => {
  const s = core.parseState('?cat=38003882');
  assert.equal(core.filter(SAMPLE, s, specOf).length, 2);
});

test('filter by price range is inclusive of min and exclusive of max', () => {
  const s = core.parseState('?min=9500&max=21000');
  const ids = core.filter(SAMPLE, s, specOf).map(p => p.id);
  assert.deepEqual(ids, ['1', '3']);
});

test('an unbranded product survives an unrelated brand filter only via __none__', () => {
  const only = core.parseState('?brand=kiriazi');
  assert.deepEqual(core.filter(SAMPLE, only, specOf).map(p => p.id), ['1', '2']);
  const withNone = core.parseState('?brand=kiriazi,__none__');
  assert.deepEqual(core.filter(SAMPLE, withNone, specOf).map(p => p.id), ['1', '2', '4']);
});

test('an unbranded product is present when no brand filter is applied', () => {
  assert.ok(core.filter(SAMPLE, core.parseState(''), specOf).some(p => p.id === '4'));
});

test('search matches title case-insensitively', () => {
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=lg'), specOf).map(p => p.id), ['3']);
});

test('sortList does not mutate its input', () => {
  const before = SAMPLE.map(p => p.id);
  core.sortList(SAMPLE, 'price-asc');
  assert.deepEqual(SAMPLE.map(p => p.id), before);
});

test('sortList orders by price both ways', () => {
  assert.deepEqual(core.sortList(SAMPLE, 'price-asc').map(p => p.id), ['4', '3', '1', '2']);
  assert.deepEqual(core.sortList(SAMPLE, 'price-desc').map(p => p.id), ['2', '1', '3', '4']);
});

test('paginate reports totals and clamps an out-of-range page', () => {
  const r = core.paginate(SAMPLE, 99, 2);
  assert.equal(r.total, 4);
  assert.equal(r.pages, 2);
  assert.equal(r.page, 2);
  assert.deepEqual(r.items.map(p => p.id), ['3', '4']);
});

test('paginate on an empty list yields one page and no items', () => {
  const r = core.paginate([], 1, 24);
  assert.deepEqual(r, { items: [], page: 1, pages: 1, total: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/shop-core.test.mjs`
Expected: FAIL — `core.filter is not a function`

- [ ] **Step 3: Write minimal implementation**

Inside the factory, before the `return`:

```js
  function norm(s) {
    return String(s || '').replace(/&nbsp;/g, ' ').toLowerCase();
  }

  function filter(products, state, specOf) {
    var q = norm(state.q);
    return products.filter(function (p) {
      if (state.cat && String(p.categoryId) !== String(state.cat)) return false;
      if (state.min != null && !(p.price >= state.min)) return false;
      if (state.max != null && !(p.price < state.max)) return false;
      if (q && norm(p.title).indexOf(q) < 0 && norm(p.description).indexOf(q) < 0) return false;
      if (state.brands && state.brands.length) {
        var b = (specOf(p) || {}).brand;
        var key = (b && (b.key || b.en || b.ar)) ? String(b.key || b.en || b.ar).toLowerCase() : '__none__';
        if (state.brands.indexOf(key) < 0) return false;
      }
      return true;
    });
  }

  function sortList(list, sort) {
    var out = list.slice();
    if (sort === 'price-asc') out.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price-desc') out.sort(function (a, b) { return b.price - a.price; });
    return out;
  }

  function paginate(list, page, per) {
    per = per || 24;
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / per));
    var pg = Math.min(Math.max(1, page || 1), pages);
    return { items: list.slice((pg - 1) * per, pg * per), page: pg, pages: pages, total: total };
  }
```

Add `filter`, `sortList` and `paginate` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/shop-core.test.mjs`
Expected: PASS — 18 tests

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/shop-core.js site/engine/shop-core.test.mjs
git commit -m "feat(shop): filter, sort and paginate the catalogue"
```

---

### Task 4: storefront — the product card and its contract

**Files:**
- Create: `site/assets/js/storefront.js`
- Test: `site/engine/storefront.test.mjs`

**Interfaces:**
- Consumes: nothing (pure string builder).
- Produces: `skShopUI.card(product, opts) -> string`, `skShopUI.esc(s) -> string`, `skShopUI.money(n) -> string`. `opts` is `{href, buyLabel, currency}`.

This task guards the highest-risk contract in the project: if this markup drifts, `nav.js` add-to-cart and `prefs.js` filtering silently stop working site-wide.

- [ ] **Step 1: Write the failing test**

Create `site/engine/storefront.test.mjs`:

```js
// site/engine/storefront.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ui = require('../assets/js/storefront.js');

const P = { id: '157676934', title: 'ثلاجة كريازى 10 قدم', price: 15785,
            image: 'https://example.test/a.jpg', url: 'https://example.test/p',
            description: 'وصف', categoryId: '38003882' };

// nav.js (enhanceCategoryCards, injectFinderCta) and prefs.js (applyToCards)
// query these exact hooks. Losing any of them breaks the whole site, not just
// the shop, so they are asserted individually.
const REQUIRED = ['card__imgwrap', 'card__body', 'card__title', 'card__teaser',
                  'card__row', 'card__price', 'card__buy'];

test('card renders an article.card root', () => {
  assert.match(ui.card(P, {}), /<article class="card"/);
});

test('card keeps every hook nav.js and prefs.js depend on', () => {
  const html = ui.card(P, {});
  for (const cls of REQUIRED) assert.ok(html.includes(cls), 'missing ' + cls);
});

test('card exposes id and category as data attributes', () => {
  const html = ui.card(P, {});
  assert.ok(html.includes('data-id="157676934"'));
  assert.ok(html.includes('data-cat="38003882"'));
});

// enhanceCategoryCards resolves products via new URL(link.href).pathname against
// the catalogue's own urls. An internal href would make every lookup miss and
// add-to-cart would silently never appear on any card.
test('card__imgwrap hrefs the catalogue url so nav.js can resolve the product', () => {
  const html = ui.card(P, {});
  assert.match(html, /class="card__imgwrap" href="https:\/\/example\.test\/p"/);
});

test('card__buy hrefs the catalogue url too', () => {
  const html = ui.card(P, {});
  assert.match(html, /class="card__buy" href="https:\/\/example\.test\/p"/);
});

test('card escapes HTML in the title', () => {
  const html = ui.card({ ...P, title: '<img src=x onerror=alert(1)>' }, {});
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('card renders the price and never a was-price', () => {
  const html = ui.card(P, {});
  assert.ok(/15[,\u066c\u002c]?785/.test(html.replace(/\s/g, '')) || html.includes('15785'));
  assert.ok(!/was|كان|<del|<s>/i.test(html));
});

test('card tolerates a missing image without emitting a broken src', () => {
  const html = ui.card({ ...P, image: '' }, {});
  assert.ok(!html.includes('src=""'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/storefront.test.mjs`
Expected: FAIL — `Cannot find module '../assets/js/storefront.js'`

- [ ] **Step 3: Write minimal implementation**

Create `site/assets/js/storefront.js`:

```js
/* SADKO storefront — pure HTML-string renderers shared by the shop hub, the
   browse view, the 30 category pages and the product page. Holds no state and
   reads no URL, so every renderer is unit-testable under node --test.
   Dual export: window.skShopUI in the browser, module.exports for tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.skShopUI = api;
})(this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clean(s) { return String(s == null ? '' : s).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return v.toLocaleString('ar-EG');
  }

  // MUST keep every class nav.js/prefs.js query, and MUST href the catalogue url:
  // enhanceCategoryCards resolves products by URL pathname, so an internal href
  // breaks add-to-cart on every card. See storefront.test.mjs.
  function card(p, opts) {
    opts = opts || {};
    var href = opts.href || p.url || '#';
    var title = clean(p.title);
    var teaser = clean(p.description).slice(0, 120);
    var img = p.image
      ? '<img loading="lazy" decoding="async" src="' + esc(p.image) + '" alt="' + esc(title) + '">'
      : '<span class="card__noimg" aria-hidden="true"></span>';
    return '<article class="card" data-id="' + esc(p.id) + '" data-cat="' + esc(p.categoryId) + '">' +
      '<a class="card__imgwrap" href="' + esc(href) + '">' + img + '</a>' +
      '<div class="card__body">' +
        '<h3 class="card__title">' + esc(title) + '</h3>' +
        '<p class="card__teaser">' + esc(teaser) + '</p>' +
        '<div class="card__row">' +
          '<span class="card__price">' + money(p.price) + ' <small>' + esc(opts.currency || 'جنيه') + '</small></span>' +
          '<a class="card__buy" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(opts.buyLabel || 'اشترى الآن') + '</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  return { esc: esc, clean: clean, money: money, card: card };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/storefront.test.mjs`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/storefront.js site/engine/storefront.test.mjs
git commit -m "feat(shop): product card renderer with the nav/prefs contract locked by tests"
```

---

### Task 5: storefront — promo hero, tiles and rails

**Files:**
- Modify: `site/assets/js/storefront.js`
- Test: `site/engine/storefront.test.mjs`

**Interfaces:**
- Consumes: Task 4 `card`, `esc`.
- Produces: `promoHero(promos) -> string`, `categoryTile(cat) -> string`, `brandTile(brand) -> string`, `priceBands(bands, labels) -> string`, `rail(title, products, moreHref) -> string`. `cat` is `{id, name, count, href}`; `brand` is `{key, name, count, href}`; `bands` is `PRICE_BANDS` and `labels` a parallel array of display strings.

- [ ] **Step 1: Write the failing test**

Append to `site/engine/storefront.test.mjs`:

```js
test('promoHero renders nothing for missing, empty or malformed input', () => {
  assert.equal(ui.promoHero(null), '');
  assert.equal(ui.promoHero([]), '');
  assert.equal(ui.promoHero('not an array'), '');
  assert.equal(ui.promoHero([{}]), '');            // no title -> skipped
});

test('promoHero marks sample content so it is never read as a live campaign', () => {
  const html = ui.promoHero([{ id: 'a', title: 'تكييفات', href: 'shop.html?cat=1', sample: true }]);
  assert.ok(html.includes('محتوى تجريبي'));
});

test('promoHero omits the marker for real campaigns', () => {
  const html = ui.promoHero([{ id: 'a', title: 'تكييفات', href: 'shop.html?cat=1' }]);
  assert.ok(!html.includes('محتوى تجريبي'));
});

test('promoHero maps accent names to token classes, never raw hex', () => {
  const html = ui.promoHero([{ id: 'a', title: 'x', href: '#', accent: 'amber' }]);
  assert.ok(html.includes('promo--amber'));
  assert.ok(!/#[0-9a-f]{6}/i.test(html));
});

test('promoHero falls back to a typographic panel when image is absent', () => {
  const html = ui.promoHero([{ id: 'a', title: 'x', href: '#' }]);
  assert.ok(!html.includes('<img'));
});

test('rail renders one card per product and a see-all link', () => {
  const html = ui.rail('الأوفر', [P, { ...P, id: '2' }], 'shop.html?cat=38003882');
  assert.equal((html.match(/<article class="card"/g) || []).length, 2);
  assert.ok(html.includes('shop.html?cat=38003882'));
});

test('rail returns empty string when there are no products', () => {
  assert.equal(ui.rail('الأوفر', [], '#'), '');
});

test('categoryTile shows its real count', () => {
  const html = ui.categoryTile({ id: '38003882', name: 'ثلاجات', count: 76, href: 'shop.html?cat=38003882' });
  assert.ok(html.includes('76'));
  assert.ok(html.includes('ثلاجات'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/storefront.test.mjs`
Expected: FAIL — `ui.promoHero is not a function`

- [ ] **Step 3: Write minimal implementation**

Inside the factory, before the `return`:

```js
  var ACCENTS = { teal: 'promo--teal', amber: 'promo--amber', ink: 'promo--ink' };

  // A promo with no title is unusable; a missing/!Array input renders nothing at
  // all rather than an empty frame. `sample:true` is always marked.
  function promoHero(promos) {
    if (!promos || !Array.isArray(promos)) return '';
    var items = promos.filter(function (x) { return x && x.title; });
    if (!items.length) return '';
    return '<div class="promos">' + items.map(function (x) {
      var accent = ACCENTS[x.accent] || ACCENTS.teal;
      return '<a class="promo ' + accent + '" href="' + esc(x.href || '#') + '">' +
        (x.image ? '<img class="promo__bg" src="' + esc(x.image) + '" alt="" aria-hidden="true" onerror="this.remove()">' : '') +
        '<span class="promo__body">' +
          (x.sample ? '<span class="promo__sample">محتوى تجريبي</span>' : '') +
          '<span class="promo__title">' + esc(x.title) + '</span>' +
          (x.sub ? '<span class="promo__sub">' + esc(x.sub) + '</span>' : '') +
          (x.cta ? '<span class="promo__cta">' + esc(x.cta) + '</span>' : '') +
        '</span></a>';
    }).join('') + '</div>';
  }

  function categoryTile(c) {
    return '<a class="ctile" href="' + esc(c.href) + '">' +
      '<span class="ctile__name">' + esc(c.name) + '</span>' +
      '<span class="ctile__count">' + esc(String(c.count)) + '</span></a>';
  }

  function brandTile(b) {
    return '<a class="btile" href="' + esc(b.href) + '">' +
      '<span class="btile__name">' + esc(b.name) + '</span>' +
      '<span class="btile__count">' + esc(String(b.count)) + '</span></a>';
  }

  function priceBands(bands, labels) {
    return '<div class="bands">' + bands.map(function (b, i) {
      return '<a class="band" href="' + esc(b.href) + '">' + esc(labels[i]) + '</a>';
    }).join('') + '</div>';
  }

  function rail(title, products, moreHref) {
    if (!products || !products.length) return '';
    return '<section class="rail">' +
      '<div class="rail__head"><h2 class="rail__title">' + esc(title) + '</h2>' +
      (moreHref ? '<a class="rail__more" href="' + esc(moreHref) + '">' + esc('شوف الكل') + '</a>' : '') +
      '</div><div class="rail__track">' +
      products.map(function (p) { return card(p, {}); }).join('') +
      '</div></section>';
  }
```

Add all five to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/storefront.test.mjs`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/storefront.js site/engine/storefront.test.mjs
git commit -m "feat(shop): promo hero, category/brand tiles and product rails"
```

---

### Task 6: storefront — facets, toolbar, pager, breadcrumb

**Files:**
- Modify: `site/assets/js/storefront.js`
- Test: `site/engine/storefront.test.mjs`

**Interfaces:**
- Consumes: Task 1 `State`, Task 2 derivations.
- Produces: `facets(state, data, labels) -> string`, `toolbar(state, total, labels) -> string`, `pager(page, pages, hrefFor) -> string`, `breadcrumb(trail) -> string`. `data` is `{cats:[{id,name,count,href}], brands:[{key,name,count}], bands:[{key,label,href}]}`; `hrefFor` is `page => string`; `trail` is `[{label, href}]` with the last entry rendered as plain text.

- [ ] **Step 1: Write the failing test**

Append to `site/engine/storefront.test.mjs`:

```js
const FDATA = {
  cats: [{ id: '38003882', name: 'ثلاجات', count: 76, href: 'shop.html?cat=38003882' }],
  brands: [{ key: 'kiriazi', name: 'كريازى', count: 2 }, { key: '__none__', name: 'غير محدد', count: 1 }],
  bands: [{ key: '0-5000', label: 'تحت ٥٬٠٠٠', href: 'shop.html?max=5000' }]
};
const FLABELS = { cats: 'الفئة', brands: 'الماركة', price: 'السعر', clear: 'امسح الفلاتر' };

test('facets mark the active category as checked', () => {
  const html = ui.facets(core.parseState('?cat=38003882'), FDATA, FLABELS);
  assert.ok(/checked/.test(html));
});

test('facets always offer the unspecified-brand bucket', () => {
  const html = ui.facets(core.parseState(''), FDATA, FLABELS);
  assert.ok(html.includes('__none__'));
  assert.ok(html.includes('غير محدد'));
});

test('pager renders nothing for a single page', () => {
  assert.equal(ui.pager(1, 1, p => '?page=' + p), '');
});

test('pager marks the current page and links the others', () => {
  const html = ui.pager(2, 3, p => '?page=' + p);
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('?page=1'));
  assert.ok(html.includes('?page=3'));
});

test('breadcrumb renders the last entry as text, not a link', () => {
  const html = ui.breadcrumb([{ label: 'البيت', href: 'index.html' }, { label: 'المتجر' }]);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.ok(html.includes('المتجر'));
});

test('toolbar reports the result count and marks the active sort', () => {
  const html = ui.toolbar(core.parseState('?sort=price-asc'), 42, { count: n => n + ' منتج' });
  assert.ok(html.includes('42'));
  assert.ok(/selected/.test(html));
});
```

Add `const core = require('../assets/js/shop-core.js');` to the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/storefront.test.mjs`
Expected: FAIL — `ui.facets is not a function`

- [ ] **Step 3: Write minimal implementation**

Inside the factory, before the `return`:

```js
  function facets(state, data, L) {
    var cats = data.cats.map(function (c) {
      var on = String(state.cat) === String(c.id);
      return '<label class="facet__row"><input type="radio" name="cat" value="' + esc(c.id) + '"' +
        (on ? ' checked' : '') + '><span>' + esc(c.name) + '</span><b>' + esc(String(c.count)) + '</b></label>';
    }).join('');
    var brands = data.brands.map(function (b) {
      var on = state.brands.indexOf(b.key) >= 0;
      return '<label class="facet__row"><input type="checkbox" name="brand" value="' + esc(b.key) + '"' +
        (on ? ' checked' : '') + '><span>' + esc(b.name) + '</span><b>' + esc(String(b.count)) + '</b></label>';
    }).join('');
    var bands = data.bands.map(function (b) {
      return '<a class="facet__band" href="' + esc(b.href) + '">' + esc(b.label) + '</a>';
    }).join('');
    return '<form class="facets" id="facets">' +
      '<fieldset class="facet"><legend>' + esc(L.cats) + '</legend>' + cats + '</fieldset>' +
      '<fieldset class="facet"><legend>' + esc(L.brands) + '</legend>' + brands + '</fieldset>' +
      '<fieldset class="facet"><legend>' + esc(L.price) + '</legend>' + bands +
        '<div class="facet__range"><input type="number" name="min" min="0" value="' + (state.min == null ? '' : state.min) + '">' +
        '<input type="number" name="max" min="0" value="' + (state.max == null ? '' : state.max) + '"></div>' +
      '</fieldset>' +
      '<button type="button" class="facet__clear" id="facetClear">' + esc(L.clear) + '</button>' +
    '</form>';
  }

  function toolbar(state, total, L) {
    var opts = [['default', 'الترتيب الافتراضى'], ['price-asc', 'السعر: من الأقل للأعلى'], ['price-desc', 'السعر: من الأعلى للأقل']];
    return '<div class="stoolbar">' +
      '<span class="stoolbar__count">' + esc(L.count(total)) + '</span>' +
      '<select class="stoolbar__sort" id="sortSel">' + opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></div>';
  }

  function pager(page, pages, hrefFor) {
    if (pages <= 1) return '';
    var out = [];
    for (var i = 1; i <= pages; i++) {
      out.push(i === page
        ? '<span class="pager__pg" aria-current="page">' + i + '</span>'
        : '<a class="pager__pg" href="' + esc(hrefFor(i)) + '">' + i + '</a>');
    }
    return '<nav class="pager">' + out.join('') + '</nav>';
  }

  function breadcrumb(trail) {
    return '<nav class="scrumb">' + trail.map(function (x, i) {
      return i === trail.length - 1
        ? '<span>' + esc(x.label) + '</span>'
        : '<a href="' + esc(x.href) + '">' + esc(x.label) + '</a>';
    }).join(' <i>←</i> ') + '</nav>';
  }
```

Add all four to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/storefront.test.mjs`
Expected: PASS — 20 tests

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/storefront.js site/engine/storefront.test.mjs
git commit -m "feat(shop): facet rail, toolbar, pager and breadcrumb renderers"
```

---

### Task 7: storefront.css + promos.json

**Files:**
- Create: `site/assets/css/storefront.css`
- Create: `site/data/promos.json`

**Interfaces:**
- Consumes: class names emitted by Tasks 4–6.
- Produces: the visual layer. No JS interface.

- [ ] **Step 1: Write `site/data/promos.json`**

Seeded with samples that point at real, populated categories and reuse room stills already in the repo. No `image` on the third so the typographic fallback is exercised in practice.

```json
{
  "note": "Sample content. Replace with real SADKO campaigns. Never add a 'was' price that isn't real — the catalogue has no discount data.",
  "promos": [
    { "id": "sample-kitchen", "sample": true, "accent": "teal",
      "title": "كل حاجة للمطبخ", "titleEn": "Everything for the kitchen",
      "sub": "١٥٧ جهاز صغير من صادكو", "subEn": "157 small appliances",
      "cta": "تسوّق الأجهزة الصغيرة", "ctaEn": "Shop small appliances",
      "href": "shop.html?cat=112439376", "image": "assets/img/still_2.jpg" },
    { "id": "sample-cooling", "sample": true, "accent": "amber",
      "title": "تبريد لبيتك", "titleEn": "Cooling for your home",
      "sub": "ثلاجات وفريزرات وتكييفات", "subEn": "Fridges, freezers and air conditioners",
      "cta": "شوف الثلاجات", "ctaEn": "See refrigerators",
      "href": "shop.html?cat=38003882", "image": "assets/img/still_1.jpg" },
    { "id": "sample-laundry", "sample": true, "accent": "ink",
      "title": "ركن الغسيل", "titleEn": "The laundry corner",
      "sub": "٤٩ غسالة", "subEn": "49 washing machines",
      "cta": "تسوّق الغسالات", "ctaEn": "Shop washers",
      "href": "shop.html?cat=38005652" }
  ]
}
```

- [ ] **Step 2: Verify the JSON parses**

Run: `node -e "const p=require('./site/data/promos.json'); if(p.promos.length!==3) throw new Error('expected 3'); console.log('ok', p.promos.map(x=>x.id).join(', '))"`
Expected: `ok sample-kitchen, sample-cooling, sample-laundry`

- [ ] **Step 3: Write `site/assets/css/storefront.css`**

Build on `app.css` tokens — this file defines **no new colour values**. Required blocks, in order:

1. `.scrumb` — breadcrumb row; `<i>` arrow flips via `html[dir=ltr] .scrumb i{transform:scaleX(-1)}`.
2. `.promos` — CSS grid, `grid-template-columns:1fr` at ≤860px, `2fr 1fr` above. `.promo` is `position:relative;overflow:hidden;border-radius:var(--radius);min-height:200px;display:grid;align-items:end`. `.promo__bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}`. `.promo__body{position:relative;padding:20px;background:linear-gradient(to top,color-mix(in srgb,var(--ink) 78%,transparent),transparent)}` so type stays legible over a photo. `.promo--teal{background:var(--teal-deep)}`, `.promo--amber{background:var(--amber)}`, `.promo--ink{background:var(--ink)}` (the typographic fallback when there is no image). `.promo__sample` is a small pill: `background:color-mix(in srgb,#fff 85%,transparent);color:var(--ink)`.
3. `.ctiles`/`.ctile`, `.btiles`/`.btile` — responsive `repeat(auto-fill,minmax(150px,1fr))` grids; card background, `--line` border, `--radius`, `--shadow`.
4. `.bands`/`.band` — pill row, wraps.
5. `.rail` — `.rail__head` is a flex row (title + see-all). `.rail__track{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(190px,1fr);gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:thin}` with `.rail__track > .card{scroll-snap-align:start}`.
6. `.shopgrid` — the browse layout: `display:grid;grid-template-columns:260px minmax(0,1fr);gap:26px;align-items:start`. Collapses to one column at ≤860px.
7. `.facets` — sticky (`position:sticky;top:86px`) card. `.facet` fieldsets have no border. `.facet__row` is a flex label row with the count pushed to the end. At ≤860px the whole form becomes a sheet: `position:fixed;inset:0;z-index:60;overflow:auto` shown only when `.is-open` is present on it.
8. `.stoolbar` — flex row, wraps, count + sort.
9. `.pager`/`.pager__pg` — centred flex row; `[aria-current]` gets `background:var(--accent);color:#fff`.
10. `.card__noimg` — a neutral `--line` block with the card's aspect ratio, for products with no image.
11. `.pdp` — PDP grid: `grid-template-columns:minmax(0,460px) minmax(0,1fr)`, one column at ≤980px. `.pdp__buy{position:sticky;top:86px}` only above 980px.

- [ ] **Step 4: Verify the CSS is syntactically sound and token-only**

Run: `node -e "const c=require('fs').readFileSync('site/assets/css/storefront.css','utf8'); const open=(c.match(/{/g)||[]).length, close=(c.match(/}/g)||[]).length; if(open!==close) throw new Error('brace mismatch '+open+'/'+close); const hex=c.match(/#[0-9a-fA-F]{3,8}\b/g)||[]; const bad=hex.filter(h=>!['#fff','#ffffff','#000'].includes(h.toLowerCase())); if(bad.length) throw new Error('non-token colours: '+bad.join(', ')); console.log('css ok,',open,'rules, no stray colours')"`
Expected: `css ok, <n> rules, no stray colours`

- [ ] **Step 5: Commit**

```bash
git add site/assets/css/storefront.css site/data/promos.json
git commit -m "feat(shop): storefront stylesheet and seeded promo slots"
```

---

### Task 8: shop.html shell + hub view

**Files:**
- Rewrite: `site/shop.html`
- Rewrite: `site/assets/js/shop.js`

**Interfaces:**
- Consumes: `skShopCore`, `skShopUI`, `skApp`, `skSpecs`, `window.skLang`, `window.skCatEn`.
- Produces: `renderHub(root)` and `renderBrowse(root, state)` inside `shop.js`; `shop.html` exposes `<main id="shop-root">`.

- [ ] **Step 1: Rewrite `site/shop.html`**

Keep the existing `<head>` (fonts, favicon, description) and footer. Replace the body content with a single root and the new script chain. Script order matters: `shop-core` and `storefront` must load before `shop.js`.

```html
<link rel="stylesheet" href="assets/css/category.css?v=c2">
<link rel="stylesheet" href="assets/css/app.css?v=a6">
<link rel="stylesheet" href="assets/css/storefront.css?v=s1">
...
<main class="wrap wrap--wide" id="shop-root">
  <div class="empty" data-i18n="loading">جارى التحميل…</div>
</main>
<footer data-footer></footer>

<script src="assets/js/catalog-i18n.js?v=g2" defer></script>
<script src="assets/js/nav.js?v=g17" defer></script>
<script src="assets/js/appshell.js?v=a4" defer></script>
<script src="assets/js/specs.js?v=a4" defer></script>
<script src="assets/js/store.js?v=a4" defer></script>
<script src="assets/js/homes.js?v=a4" defer></script>
<script src="assets/js/prefs.js?v=a4" defer></script>
<script src="assets/js/shop-core.js?v=s1" defer></script>
<script src="assets/js/storefront.js?v=s1" defer></script>
<script src="assets/js/shop.js?v=s1" defer></script>
```

- [ ] **Step 2: Write the hub renderer in `site/assets/js/shop.js`**

Replace the file. This step delivers the hub only; browse comes in Task 9.

```js
/* SADKO shop — routes between the storefront hub and the faceted browse view.
   All rendering lives in skShopUI; all catalogue/URL logic in skShopCore. This
   file owns state and the DOM only. */
(function () {
  'use strict';
  var C = window.skShopCore, U = window.skShopUI;
  var EN = (window.skLang && window.skLang.get()) === 'en';
  function t(ar, en) { return EN ? en : ar; }

  var BAND_LABELS = [t('تحت ٥٬٠٠٠', 'Under 5,000'), t('٥٬٠٠٠ – ١٥٬٠٠٠', '5,000 – 15,000'),
                     t('١٥٬٠٠٠ – ٣٠٬٠٠٠', '15,000 – 30,000'), t('فوق ٣٠٬٠٠٠', 'Over 30,000')];

  function bandHref(b) {
    var s = { brands: [], sort: 'default', page: 1 };
    s.min = b.min; s.max = b.max;
    return 'shop.html' + C.stateToSearch(Object.assign({ cat: '', q: '', all: false }, s));
  }

  function specOf(p) { return window.skSpecs ? window.skSpecs.of(p) : {}; }

  function renderHub(root, products, promos) {
    var A = window.skApp;
    var cats = C.liveCategories(products).map(function (c) {
      return { id: c.id, count: c.count, name: A.catName(c.id), href: 'shop.html?cat=' + c.id };
    });
    var brands = C.brandsOf(products, specOf).filter(function (b) { return b.key !== '__none__'; }).slice(0, 12)
      .map(function (b) { return { key: b.key, count: b.count, name: t(b.ar, b.en), href: 'shop.html?brand=' + encodeURIComponent(b.key) }; });
    var bands = C.PRICE_BANDS.map(function (b) { return { key: b.key, href: bandHref(b) }; });

    var rails = cats.slice(0, 4).map(function (c) {
      var items = C.sortList(products.filter(function (p) { return String(p.categoryId) === c.id; }), 'price-asc').slice(0, 8);
      return U.rail(t('الأوفر فى ', 'Best value in ') + c.name, items, c.href);
    }).join('');

    root.innerHTML =
      U.breadcrumb([{ label: t('البيت', 'Home'), href: 'index.html' }, { label: t('المتجر', 'Shop') }]) +
      U.promoHero(promos) +
      '<h2 class="shop-h2">' + t('تسوّق حسب الفئة', 'Shop by category') + '</h2>' +
      '<div class="ctiles">' + cats.map(U.categoryTile).join('') + '</div>' +
      '<h2 class="shop-h2">' + t('تسوّق حسب الماركة', 'Shop by brand') + '</h2>' +
      '<div class="btiles">' + brands.map(U.brandTile).join('') + '</div>' +
      '<h2 class="shop-h2">' + t('تسوّق حسب السعر', 'Shop by price') + '</h2>' +
      U.priceBands(bands, BAND_LABELS) +
      rails;
    U.afterGrid(root);
  }

  function boot() {
    var root = document.getElementById('shop-root');
    var state = C.parseState(location.search);
    Promise.all([
      window.skApp.products(),
      fetch('data/promos.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var products = res[0], promos = (res[1] && res[1].promos) || null;
      if (C.isBrowse(state)) renderBrowse(root, state, products);
      else renderHub(root, products, promos);
    });
  }
  window.addEventListener('DOMContentLoaded', function () { window.skApp.footer(); boot(); });
})();
```

- [ ] **Step 3: Make `nav.js` re-runnable, then add `afterGrid`**

Verified during planning: `nav.js` exports only `skLang`, `skCatEn` and `skCart`. `enhanceCategoryCards` is internal, runs once on `DOMContentLoaded`, has **no** idempotency guard, and there is no event or MutationObserver. `prefs.js` does already export `applyToCards`.

Two additive edits to `nav.js`, and nothing else in that file:

**(a) Idempotency guard** — inside the `document.querySelectorAll('article.card').forEach(card => {` loop in `enhanceCategoryCards` (~line 460), immediately after `if (!link) return;`:

```js
        if (card.__skProduct) return;   // already enhanced; re-runs must not double the buttons
```

**(b) Export the hooks** — beside `window.skCart = skCart;` (~line 119):

```js
  // The storefront re-renders its grid on every facet change, so it needs to
  // re-run these over the new cards. Additive only; existing pages are unaffected.
  window.skNav = { enhanceCategoryCards, injectFinderCta };
```

Then add to `storefront.js`:

```js
  // Browser-only. After any grid renders, re-run the site-wide card hooks so
  // add-to-cart, the details link and filter-by-my-place appear on new cards.
  // Safe to call repeatedly: nav.js guards on card.__skProduct.
  function afterGrid(rootEl) {
    if (typeof document === 'undefined') return;
    try { if (window.skNav && window.skNav.enhanceCategoryCards) window.skNav.enhanceCategoryCards(); } catch (e) {}
    try { if (window.skPrefs && window.skPrefs.applyToCards) window.skPrefs.applyToCards(rootEl); } catch (e) {}
  }
```

Add `afterGrid` to the returned object.

- [ ] **Step 4: Verify in the browser**

Start the server: `node site/compare-server.mjs` (port 8082). Open `http://127.0.0.1:8082/shop.html`.
Expected: breadcrumb, 3 promo slots (two with photos, one typographic, all marked محتوى تجريبي), 10 category tiles whose counts read 157/76/49/35/35/32/28/27/22/10, up to 12 brand tiles, 4 price bands, and 4 "الأوفر فى" rails. No console errors.

- [ ] **Step 5: Commit**

```bash
git add site/shop.html site/assets/js/shop.js site/assets/js/storefront.js
git commit -m "feat(shop): storefront hub with promos, category/brand tiles and value rails"
```

---

### Task 9: browse view + URL sync

**Files:**
- Modify: `site/assets/js/shop.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `renderBrowse(root, state, products)`.

- [ ] **Step 1: Write `renderBrowse` and the URL sync**

Add to `shop.js` before `boot()`:

```js
  function go(state) {
    history.pushState(null, '', 'shop.html' + C.stateToSearch(state));
    render();
  }

  function renderBrowse(root, state, products) {
    var A = window.skApp;
    var matched = C.filter(products, state, specOf);
    var sorted = C.sortList(matched, state.sort);
    var pg = C.paginate(sorted, state.page, 24);

    // Facet counts are computed against everything EXCEPT the facet being shown,
    // so a user can always see what selecting another value would give them.
    var forCats = C.filter(products, Object.assign({}, state, { cat: '' }), specOf);
    var forBrands = C.filter(products, Object.assign({}, state, { brands: [] }), specOf);

    var data = {
      cats: C.liveCategories(forCats).map(function (c) {
        return { id: c.id, count: c.count, name: A.catName(c.id), href: 'shop.html?cat=' + c.id };
      }),
      brands: C.brandsOf(forBrands, specOf).map(function (b) {
        return { key: b.key, count: b.count, name: t(b.ar, b.en) };
      }),
      bands: C.PRICE_BANDS.map(function (b, i) { return { key: b.key, label: BAND_LABELS[i], href: bandHref(b) }; })
    };

    var title = state.cat ? A.catName(state.cat) : (state.q ? t('نتائج البحث', 'Search results') : t('كل المنتجات', 'All products'));
    root.innerHTML =
      U.breadcrumb([{ label: t('البيت', 'Home'), href: 'index.html' },
                    { label: t('المتجر', 'Shop'), href: 'shop.html' }, { label: title }]) +
      '<div class="shopgrid">' +
        '<aside class="shopgrid__side">' +
          '<button class="facets__toggle" id="facetToggle">' + t('الفلاتر', 'Filters') + '</button>' +
          U.facets(state, data, { cats: t('الفئة', 'Category'), brands: t('الماركة', 'Brand'),
                                  price: t('السعر', 'Price'), clear: t('امسح الفلاتر', 'Clear filters') }) +
        '</aside>' +
        '<div class="shopgrid__main">' +
          U.toolbar(state, pg.total, { count: function (n) { return EN ? n + ' products' : n + ' منتج'; } }) +
          (pg.total ? '<div class="grid">' + pg.items.map(function (p) { return U.card(p, {}); }).join('') + '</div>'
                    : '<p class="empty">' + t('مفيش نتايج للبحث ده — جرّب كلمة تانية.', 'No results — try another search.') + '</p>') +
          U.pager(pg.page, pg.pages, function (n) {
            return 'shop.html' + C.stateToSearch(Object.assign({}, state, { page: n }));
          }) +
        '</div>' +
      '</div>';
    U.afterGrid(root);
    wireBrowse(root, state);
  }

  function wireBrowse(root, state) {
    var form = root.querySelector('#facets');
    if (form) {
      form.addEventListener('change', function () {
        var fd = new FormData(form);
        go({
          cat: fd.get('cat') || '', q: state.q,
          brands: fd.getAll('brand'),
          min: fd.get('min') ? parseInt(fd.get('min'), 10) : null,
          max: fd.get('max') ? parseInt(fd.get('max'), 10) : null,
          sort: state.sort, page: 1, all: state.all
        });
      });
    }
    var clear = root.querySelector('#facetClear');
    if (clear) clear.addEventListener('click', function () {
      go({ cat: '', q: state.q, brands: [], min: null, max: null, sort: 'default', page: 1, all: true });
    });
    var sortSel = root.querySelector('#sortSel');
    if (sortSel) sortSel.addEventListener('change', function () {
      go(Object.assign({}, state, { sort: sortSel.value, page: 1 }));
    });
    var toggle = root.querySelector('#facetToggle');
    if (toggle) toggle.addEventListener('click', function () { form.classList.toggle('is-open'); });
  }
```

Refactor `boot()` into a reusable `render()` that reads `location.search` each time, and bind it:

```js
  var CACHE = null;
  function render() {
    var root = document.getElementById('shop-root');
    var state = C.parseState(location.search);
    if (C.isBrowse(state)) renderBrowse(root, state, CACHE.products);
    else renderHub(root, CACHE.products, CACHE.promos);
  }
  window.addEventListener('popstate', render);
```

`boot()` fills `CACHE` then calls `render()`.

- [ ] **Step 2: Verify the URL round-trip in the browser**

Open `http://127.0.0.1:8082/shop.html?cat=38003882`, tick a brand, set a price, then:
- copy the URL, reload it → identical results
- press Back → returns to the previous filter state
- Expected: the count in the toolbar always equals the number of cards when total ≤ 24.

- [ ] **Step 3: Verify no dead facets**

In the browser console on `shop.html?all=1`:
```js
[...document.querySelectorAll('.facet__row b')].every(b => +b.textContent > 0)
```
Expected: `true` — every facet offered returns at least one product.

- [ ] **Step 4: Verify the unbranded bucket**

Open `shop.html?brand=__none__`.
Expected: a non-empty grid; every card is a product whose brand `skSpecs` could not derive.

- [ ] **Step 5: Commit**

```bash
git add site/assets/js/shop.js
git commit -m "feat(shop): faceted browse with URL-driven state and history"
```

---

### Task 10: regenerate the 30 category pages

**Files:**
- Create: `site/mkcategories.mjs`
- Rewrite: `site/category/*.html` (×30)

**Interfaces:**
- Consumes: `shop.js` `renderBrowse` via a `data-cat` attribute on the root.
- Produces: 30 thin shells. No new JS interface.

- [ ] **Step 1: Teach `shop.js` to honour a fixed category**

In `render()`, before parsing state:

```js
    var root = document.getElementById('shop-root');
    var fixed = root.getAttribute('data-cat');
    var state = C.parseState(location.search);
    if (fixed) { state.cat = fixed; state.all = false; }
```

and in `go()`, keep the fixed category pinned:

```js
  function go(state) {
    var root = document.getElementById('shop-root');
    var fixed = root && root.getAttribute('data-cat');
    var path = fixed ? location.pathname : 'shop.html';
    history.pushState(null, '', path + C.stateToSearch(fixed ? Object.assign({}, state, { cat: '' }) : state));
    render();
  }
```

- [ ] **Step 2: Write the generator**

Create `site/mkcategories.mjs`:

```js
// Regenerates site/category/*.html as thin storefront shells. Run from repo root:
//   node site/mkcategories.mjs
// Every page shares one template, so the browse experience cannot drift between
// the shop and the category URLs.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATDIR = join(HERE, 'category');
const cat = JSON.parse(readFileSync(join(HERE, 'data/products.json'), 'utf8'));
const NAMES = {
  '38003882': 'ثلاجات', '38005648': 'فريزرات', '38003799': 'أفران وبوتاجازات',
  '38005652': 'غسالات', '40507239': 'سخانات مياه', '112439376': 'أجهزة صغيرة',
  '38032005': 'تكييفات هواء', '38022381': 'تليفزيونات',
  '50318054': 'مبردات هواء ومراوح', '102858075': 'مبردات مياه'
};

const page = (id, name) => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${name} — صادكو جروب</title>
<meta name="description" content="تصفّح ${name} من صادكو جروب — بالسعر والصورة والمواصفات.">
<link rel="icon" href="../assets/img/sadko-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/category.css?v=c2">
<link rel="stylesheet" href="../assets/css/app.css?v=a6">
<link rel="stylesheet" href="../assets/css/storefront.css?v=s1">
</head>
<body>
<main class="wrap wrap--wide" id="shop-root" data-cat="${id}">
  <div class="empty">جارى التحميل…</div>
</main>
<footer data-footer></footer>
<script src="../assets/js/catalog-i18n.js?v=g2" defer></script>
<script src="../assets/js/nav.js?v=g17" defer></script>
<script src="../assets/js/appshell.js?v=a4" defer></script>
<script src="../assets/js/specs.js?v=a4" defer></script>
<script src="../assets/js/store.js?v=a4" defer></script>
<script src="../assets/js/homes.js?v=a4" defer></script>
<script src="../assets/js/prefs.js?v=a4" defer></script>
<script src="../assets/js/shop-core.js?v=s1" defer></script>
<script src="../assets/js/storefront.js?v=s1" defer></script>
<script src="../assets/js/shop.js?v=s1" defer></script>
</body>
</html>
`;

const counts = {};
cat.products.forEach(p => { counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });

let written = 0;
for (const file of readdirSync(CATDIR).filter(f => f.endsWith('.html'))) {
  const id = file.replace('.html', '');
  const name = NAMES[id] || 'منتجات';
  writeFileSync(join(CATDIR, file), page(id, name));
  written++;
  if (!counts[id]) console.warn('  (no products) ' + file);
}
console.log('wrote ' + written + ' category pages');
```

- [ ] **Step 3: Run the generator**

Run: `node site/mkcategories.mjs`
Expected: `wrote 30 category pages`, plus `(no products)` warnings for the 20 subcategory ids — those pages will render the browse view with an empty state, which is correct and honest.

- [ ] **Step 4: Verify in the browser**

Open `http://127.0.0.1:8082/category/38003882.html`.
Expected: breadcrumb, facet rail, 76 refrigerators, working pager. Changing a facet keeps the URL on `/category/38003882.html` and never navigates to `shop.html`.

- [ ] **Step 5: Commit**

```bash
git add site/mkcategories.mjs site/category site/assets/js/shop.js
git commit -m "feat(shop): regenerate the 30 category pages as storefront shells"
```

---

### Task 11: product page relayout

**Files:**
- Modify: `site/assets/js/product.js` (`render()` ~line 72, `head()` ~line 93)
- Modify: `site/product.html`
- Test: `site/engine/product-ids.test.mjs`

**Interfaces:**
- Consumes: `skShopUI.rail`, `skShopUI.breadcrumb`.
- Produces: no new interface. Every other section function keeps its exact signature.

- [ ] **Step 1: Write the failing regression test**

The failure mode this guards: `wire()` binds by id, so renaming an id in `head()` silently kills the save button and the Q&A form.

Create `site/engine/product-ids.test.mjs`:

```js
// product.js is a browser IIFE, so this is a source-level guard rather than a
// behavioural test: every id that wire() looks up must still be produced by the
// render path. Renaming one in head() would otherwise fail silently in the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/js/product.js', import.meta.url), 'utf8');

const REQUIRED_IDS = ['btnSave', 'qaForm', 'guidesBox'];

test('every id wire() depends on is still emitted by the render path', () => {
  for (const id of REQUIRED_IDS) {
    assert.ok(src.includes("id=\"" + id + "\"") || src.includes("id='" + id + "'"),
      'render path no longer emits id ' + id);
  }
});

test('the section functions the PDP relies on all still exist', () => {
  for (const fn of ['suitability', 'spaceCheck', 'goodToKnow', 'energyPanel',
                    'specsPanel', 'reviewsPanel', 'qaPanel', 'guides', 'wire']) {
    assert.match(src, new RegExp('function\\s+' + fn + '\\s*\\('), 'missing ' + fn);
  }
});
```

- [ ] **Step 2: Run test to verify it passes against the CURRENT file**

Run: `node --test site/engine/product-ids.test.mjs`
Expected: PASS — this is a guard, so it must be green *before* the rewrite. If it fails now, the id list is wrong; fix the list, not the source.

- [ ] **Step 3: Rewrite `render()` and `head()`**

Replace only these two functions. Every other function is untouched.

```js
    function render(p, s, peers) {
      var U = window.skShopUI;
      document.title = p.title.replace(/&nbsp;/g, ' ').slice(0, 70) + ' — ' + t('صادكو جروب', 'SADKO Group');
      root.innerHTML =
        U.breadcrumb([
          { label: t('البيت', 'Home'), href: A.P('index.html') },
          { label: t('المتجر', 'Shop'), href: A.P('shop.html') },
          { label: A.catName(p.categoryId), href: A.catHref(p.categoryId) },
          { label: t('تفاصيل المنتج', 'Product details') }
        ]) +
        '<div class="pdp">' +
          '<div class="pdp__media"><div class="panel pdp__frame">' +
            '<img src="' + esc(p.image) + '" alt="' + esc(p.title) + '">' +
          '</div></div>' +
          '<div class="pdp__buy">' + head(p, s) + '</div>' +
        '</div>' +
        '<div class="grid2 mt24">' +
          '<div>' + suitability(p, s) + spaceCheck(p, s) + '</div>' +
          '<div>' + goodToKnow(p, s, peers) + energyPanel(p, s, peers) + '</div>' +
        '</div>' +
        specsPanel(p, s) +
        '<div class="grid2 mt16"><div>' + reviewsPanel(p) + '</div><div>' + qaPanel(p) + '</div></div>' +
        '<div id="guidesBox"></div>' +
        U.rail(t('منتجات مشابهة', 'Related products'), peers.slice(0, 8), A.catHref(p.categoryId));
      wire(p, s, peers);
      guides(p);
      U.afterGrid(root);
    }
```

`head()` keeps its existing content and, critically, `id="btnSave"`. Wrap it in the buy-box shell:

```js
    function head(p, s) {
      var saved = St.saved.has(p.id);
      return '<h1 class="pdp__title">' + esc(p.title) + '</h1>' +
        '<div class="chips mt8">' +
          (s.brand ? '<span class="chip">' + esc(t(s.brand.ar, s.brand.en)) + '</span>' : '') +
          (s.headline ? '<span class="chip chip--mute">' + A.num(s.headline.v) + ' ' + esc(t(s.headline.u, s.headline.uEn)) + '</span>' : '') +
          (s.energy.cls ? '<span class="chip chip--ok">' + t('كفاءة طاقة ', 'Energy class ') + esc(s.energy.cls) + '</span>' : '') +
          (s.energy.inverter ? '<span class="chip chip--ok">' + t('انفرتر', 'Inverter') + '</span>' : '') +
        '</div>' +
        '<p class="pdp__price">' + A.money(p.price) + '</p>' +
        '<p class="muted small pdp__caveat">' + t('سعر صادكو وقت آخر تحديث للكتالوج — أكّد السعر قبل الشراء.', 'SADKO price at the last catalogue update — confirm before buying.') + '</p>' +
        '<div class="chips">' +
          '<a class="btn btn--primary" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + t('اشترى من صادكو', 'Buy from SADKO') + '</a>' +
          '<a class="btn btn--teal" href="' + A.P('compare.html') + '?q=' + encodeURIComponent(cleanTitle(p.title)) + '">' + t('قارن الأسعار', 'Compare prices') + '</a>' +
          '<button class="btn btn--ghost" id="btnSave">' + (saved ? t('محفوظ ✓', 'Saved ✓') : t('احفظ', 'Save')) + '</button>' +
          '<a class="btn btn--ghost" href="' + A.P('plan.html') + '?add=' + encodeURIComponent(p.id) + '">' + t('ضيفه لخطة', 'Add to a plan') + '</a>' +
        '</div>';
    }
```

- [ ] **Step 4: Add the new assets to `product.html` and re-run the guard**

Add before `product.js`:
```html
<link rel="stylesheet" href="assets/css/storefront.css?v=s1">
<script src="assets/js/shop-core.js?v=s1" defer></script>
<script src="assets/js/storefront.js?v=s1" defer></script>
```
Bump `product.js?v=a4` to `?v=a5`.

Run: `node --test site/engine/product-ids.test.mjs`
Expected: PASS — both tests still green after the rewrite.

- [ ] **Step 5: Verify the preserved logic in the browser**

Open a product from each family, e.g. `product.html?id=157676934` (fridge) and one small appliance.
Expected: breadcrumb with 4 levels; image frame beside a sticky buy-box; **Save toggles and persists across reload**; Q&A textarea accepts input and submits; suitability, space-check, running-cost, specs, reviews and guides all render exactly the values they did before; a related rail at the bottom. No console errors.

- [ ] **Step 6: Commit**

```bash
git add site/assets/js/product.js site/product.html site/engine/product-ids.test.mjs
git commit -m "feat(shop): relay out the product page with a sticky buy box and related rail"
```

---

### Task 12: full-suite QA

**Files:**
- Modify: any file needing a fix found here.

**Interfaces:** none.

- [ ] **Step 1: Run every unit test**

Run: `node --test site/engine/`
Expected: all suites pass, including the 48 pre-existing tests — no regressions.

- [ ] **Step 2: Confirm the card hooks fire, once and only once**

On `shop.html?all=1`, in the console:
```js
const cards = document.querySelectorAll('article.card');
[cards.length,
 document.querySelectorAll('.sk-addbtn').length,   // add-to-cart, one per card
 document.querySelectorAll('.sk-detbtn').length]   // "التفاصيل والمقاس", one per card
```
Expected: all three equal. Then change a facet and re-run — still equal, never doubled. A doubled count means the `card.__skProduct` guard from Task 8 Step 3(a) is missing or placed after the buttons are appended.

- [ ] **Step 3: Verify filter-by-my-place still binds**

With a home profile set, toggle "فلتر حسب مكانى" on `shop.html?cat=38003882`.
Expected: the grid filters; a product with a missing spec is never hidden.

- [ ] **Step 4: Bilingual pass**

Switch to EN via the nav toggle. Visit hub, browse, a category page and a PDP.
Expected: `dir="ltr"`, every string translated, facet rail mirrored to the left, breadcrumb arrow flipped, no Arabic left in chrome.

- [ ] **Step 5: Mobile pass at 393×852**

Expected: facet sheet opens and closes; pager usable; rails scroll horizontally; **no horizontal page scroll**; promo slots stack.

- [ ] **Step 6: Confirm out-of-scope pages still work**

Load `index.html` (scroll-world), `cart.html`, `checkout.html`, `account.html`.
Expected: unchanged behaviour, no console errors.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A site
git commit -m "fix(shop): QA pass across storefront surfaces"
```

---

## Self-Review

**Spec coverage:** §5 architecture → Tasks 1–7. §6 hub (promos, category tiles, brand tiles, price bands, 4 rails) → Task 8. §7 browse (facets, toolbar, pagination, URL truth, empty state) → Task 9. §8 PDP → Task 11. §9 promos.json → Task 7. §10 bilingual/RTL → every render task + Task 12 Step 4. §11 testing → Tasks 1–6 (automated) and Task 12 (manual). §4.1 card contract → Task 4 (locked by test) and Task 12 Step 2. §3 dead subcategories → Task 2 `liveCategories` and Task 10 Step 3 warning.

**Known gap, deliberately left:** the spec's §7 grid/list view toggle and `sadko-shop-view` key are **not** implemented in any task. It is presentation-only, adds a persistence key and a second card layout, and nothing else depends on it. Add it after Task 12 if wanted.

**Type consistency:** `State` is defined once in Task 1 and used unchanged in Tasks 3, 6, 9, 10. `specOf` has the same injected signature in Tasks 2, 3 and 9. `skShopUI.card(p, opts)` is defined in Task 4 and called identically in Tasks 5, 9 and 11. `afterGrid(rootEl)` is defined in Task 8 Step 3 and called in Tasks 8, 9 and 11. `hrefFor` is `page => string` in both Task 6 and Task 9.

**Risks closed during planning (both would have shipped a silently broken shop):**

1. `enhanceCategoryCards` has no idempotency guard — the storefront re-renders its grid on every facet change, so add-to-cart and details buttons would have doubled on each interaction. Closed by Task 8 Step 3(a), asserted by Task 12 Step 2.
2. `enhanceCategoryCards` resolves products by **URL pathname**, not id. The card originally specified `product.html?id=…` for `card__imgwrap`, which would have made every lookup miss — no add-to-cart on any card, anywhere, with no error to notice. Closed by the href rule in Global Constraints, asserted by two tests in Task 4.

**Risk remaining:** none identified that the plan cannot close. The `nav.js` edits are two additive lines whose blast radius is limited to pages that already call `enhanceCategoryCards`; Task 12 Step 6 re-checks those.
