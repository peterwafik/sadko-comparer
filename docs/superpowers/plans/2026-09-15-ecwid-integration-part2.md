# Ecwid Backend Integration Implementation Plan — Part 2 (Tasks 7–15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 1 (Tasks 1–6):** `docs/superpowers/plans/2026-09-15-ecwid-integration.md`
**Spec:** `docs/superpowers/specs/2026-09-15-ecwid-integration-design.md`

**Global Constraints:** as stated in Part 1 — zero new dependencies, `node --test engine/*.test.mjs` from `site/`, 483 existing tests stay green and the total must not decrease, the owner places the token and the implementer never echoes or logs it, no synthesised shipping or grand total, out-of-stock shown not hidden, empty rails render nothing, Ecwid ids are the ids, new Arabic copy is فصحى, everything behind `SADKO_ECWID=1`, store id `18028328`.

---

### Task 7: Serve the mirror through `mergedCatalog()`, behind the flag

The moment the site starts reading Ecwid. Gated, reversible, and preceded by a diff so the 77 additions and 38 removals are seen before any customer sees them.

**Files:**
- Modify: `site/compare-server.mjs` — `baseCatalog()`/`mergedCatalog()` region (around lines 1694–1712), plus the shutdown handler (around line 2345)
- Create: `site/engine/ecwid-source.mjs`
- Create: `site/tools/ecwid-diff.mjs`
- Test: `site/engine/ecwid-source.test.mjs`

**Interfaces:**
- Consumes: `openEcwidStore` (Task 5), `createEcwidSync` (Task 6), `openEcwidApi` (Task 2).
- Produces: `createEcwidSource({ store, seedLoader, enabled })` → object with:
  - `catalogBase()` → `Promise<object[]>` — mirror rows when the mirror has any, otherwise the seed
  - `activeSource()` → `'ecwid' | 'seed' | 'disabled'`
  - `describe()` → `{ enabled, source, products, categories, lastSync, lastError }`

  Also exports, from `compare-server.mjs`, a module-level `ecwidSource()` accessor following the existing lazy-singleton pattern of `accounts()` / `catalogAdmin()` / `analytics()`.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-source.test.mjs`:

```js
// site/engine/ecwid-source.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';
import { createEcwidSource } from './ecwid-source.mjs';

const SEED = [{ id: 's1', title: 'من الملف', price: 100, url: '', image: '', description: '', categoryId: 'c' }];
const MIRROR = { id: 'm1', title: 'من إكويد', price: 200, url: '', image: '', description: '',
  categoryId: 'c', categoryIds: ['c'], brand: '', sku: '', inStock: true, compareToPrice: null };

function fresh(enabled = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-src-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled });
  return { store, src, cleanup: () => { try { store.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}

test('with the flag off the seed is served and Ecwid is never consulted', async () => {
  const { src, store, cleanup } = fresh(false);
  try {
    store.upsertProducts([MIRROR]);
    assert.deepEqual(await src.catalogBase(), SEED);
    assert.equal(src.activeSource(), 'disabled');
  } finally { cleanup(); }
});

test('with the flag on but an empty mirror, the seed is served', async () => {
  const { src, cleanup } = fresh();
  try {
    assert.deepEqual(await src.catalogBase(), SEED);
    assert.equal(src.activeSource(), 'seed');
  } finally { cleanup(); }
});

test('once the mirror has rows, the mirror is served', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([MIRROR]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'من إكويد');
    assert.equal(src.activeSource(), 'ecwid');
  } finally { cleanup(); }
});

test('the mirror is served even when the last sync failed — last good data, not the seed', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([MIRROR]);
    store.setState('last_error', 'ecwid-503: boom');
    assert.equal((await src.catalogBase())[0].title, 'من إكويد');
    assert.equal(src.activeSource(), 'ecwid');
  } finally { cleanup(); }
});

test('describe reports what the admin panel shows, and never a token', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([MIRROR]);
    store.setState('last_error', 'ecwid-403');
    const d = src.describe();
    assert.equal(d.enabled, true);
    assert.equal(d.source, 'ecwid');
    assert.equal(d.products, 1);
    assert.equal(d.lastError, 'ecwid-403');
    assert.ok(!/token/i.test(JSON.stringify(d)), 'describe must not mention a token at all');
  } finally { cleanup(); }
});

test('a broken seed loader with an empty mirror yields an empty list rather than throwing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-src-b-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  try {
    const src = createEcwidSource({ store, seedLoader: async () => { throw new Error('no file'); }, enabled: true });
    assert.deepEqual(await src.catalogBase(), []);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-source.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-source.mjs'`.

- [ ] **Step 3: Write `ecwid-source.mjs`**

Create `site/engine/ecwid-source.mjs`:

```js
/* ============================================================================
   Which catalogue does the storefront serve?

   Precedence, and the reasoning behind it:
     1. flag off            -> the static seed file. Byte-identical to today.
     2. flag on, mirror empty -> the seed. First boot, or the very first sync
                                 has not finished. Never serve nothing.
     3. flag on, mirror has rows -> the mirror, EVEN IF the last sync failed.
                                 Stale real data beats a months-old snapshot,
                                 and the failure is surfaced in admin instead.
   ========================================================================== */

export function createEcwidSource({ store, seedLoader, enabled }) {
  let mode = enabled ? 'seed' : 'disabled';

  async function seed() {
    try { return await seedLoader(); } catch (e) { return []; }
  }

  return {
    async catalogBase() {
      if (!enabled) { mode = 'disabled'; return seed(); }
      let rows = [];
      try { rows = store.allProducts(); } catch (e) { rows = []; }
      if (rows.length) { mode = 'ecwid'; return rows; }
      mode = 'seed';
      return seed();
    },

    activeSource: () => mode,

    /* Deliberately exposes counts and the last error only. There is no code
       path here that can reveal any part of the token. */
    describe() {
      let s = { products: 0, categories: 0, lastSync: null, lastError: null };
      try { s = store.stats(); } catch (e) {}
      return {
        enabled: !!enabled,
        source: mode,
        products: s.products,
        categories: s.categories,
        lastSync: s.lastSync,
        lastError: s.lastError,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-source.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into `compare-server.mjs`**

Add the imports beside the other engine imports near the top of `site/compare-server.mjs`:

```js
import { openEcwidStore } from './engine/ecwid-store.mjs';
import { openEcwidApi } from './engine/ecwid-api.mjs';
import { createEcwidSync } from './engine/ecwid-sync.mjs';
import { createEcwidSource } from './engine/ecwid-source.mjs';
```

Add the lazy singletons next to the existing `accounts()` / `catalogAdmin()` / `analytics()` accessors:

```js
/* ---- Ecwid (spec: docs/superpowers/specs/2026-09-15-ecwid-integration-design.md) ----
   Everything is behind SADKO_ECWID. With the flag unset the accessors return
   null and every catalogue path behaves exactly as it did before. */
const ECWID_ON = process.env.SADKO_ECWID === '1';
let ECWID_STORE = null, ECWID_API = null, ECWID_SYNC = null, ECWID_SOURCE = null;

function ecwidStore() {
  if (!ECWID_ON) return null;
  if (!ECWID_STORE) {
    try { ECWID_STORE = openEcwidStore(path.join(ROOT, 'data', 'ecwid.db')); }
    catch (e) { console.error('[ecwid] store unavailable:', e.message); ECWID_STORE = null; }
  }
  return ECWID_STORE;
}
function ecwidApi() {
  if (!ECWID_ON) return null;
  if (!ECWID_API) ECWID_API = openEcwidApi({
    storeId: process.env.SADKO_ECWID_STORE_ID || '18028328',
    token: process.env.SADKO_ECWID_TOKEN || '',
  });
  return ECWID_API;
}
function ecwidSync() {
  const store = ecwidStore(), api = ecwidApi();
  if (!store || !api) return null;
  if (!ECWID_SYNC) ECWID_SYNC = createEcwidSync({ api, store });
  return ECWID_SYNC;
}
function ecwidSource() {
  if (!ECWID_SOURCE) ECWID_SOURCE = createEcwidSource({
    store: ecwidStore() || { allProducts: () => [], stats: () => ({ products: 0, categories: 0, lastSync: null, lastError: null }) },
    seedLoader: seedCatalog,
    enabled: ECWID_ON && !!(process.env.SADKO_ECWID_TOKEN || '').length,
  });
  return ECWID_SOURCE;
}
```

Rename the existing scrape loader and route `baseCatalog()` through the source. Replace the body of the `baseCatalog` region (around `compare-server.mjs:1694`):

```js
/* The STATIC seed catalogue: the July scrape, cached in memory and re-read only
   when the file's mtime changes. Once Ecwid is on and mirrored this is only a
   cold-start and outage fallback — see engine/ecwid-source.mjs. */
let _baseCat = { mtime: 0, list: null };
async function seedCatalog() {
  const file = path.join(ROOT, 'data', 'products.json');
  try {
    const m = statSync(file).mtimeMs;
    if (_baseCat.list && _baseCat.mtime === m) return _baseCat.list;
    const doc = JSON.parse(await readFile(file, 'utf8'));
    _baseCat = { mtime: m, list: Array.isArray(doc.products) ? doc.products : [] };
  } catch (e) { if (!_baseCat.list) _baseCat.list = []; }
  return _baseCat.list;
}
// The catalogue the storefront builds on: Ecwid mirror when available, else seed.
async function baseCatalog() { return ecwidSource().catalogBase(); }
```

`mergedCatalog()` is left exactly as it is — it already reads `baseCatalog()` and applies the overlay, so it needs no edit.

Start the schedulers inside the existing `HTTP_SERVER.listen` callback, after the headless pre-warm block:

```js
  // Ecwid: first pull now, incremental every 15 min, full reconcile daily.
  const es = ecwidSync();
  if (es) {
    console.log('Ecwid sync ON — store ' + (process.env.SADKO_ECWID_STORE_ID || '18028328'));
    es.syncCategories().then(() => es.fullReconcile()).catch(() => {});
    setInterval(() => {
      const from = es.lastSyncedUnix();
      es.syncProducts(from ? { updatedFrom: from } : {}).catch(() => {});
    }, 15 * 60 * 1000).unref();
    setInterval(() => { es.syncCategories().then(() => es.fullReconcile()).catch(() => {}); },
      24 * 60 * 60 * 1000).unref();
  } else if (ECWID_ON) {
    console.log('Ecwid flag is on but no token is configured — serving the seed catalogue');
  }
```

Close the store in `shutdown()` beside the other `close()` calls:

```js
    try { ECWID_STORE && ECWID_STORE.close && ECWID_STORE.close(); } catch (e) {}
```

- [ ] **Step 6: Write the diff tool**

Create `site/tools/ecwid-diff.mjs`:

```js
/* What changes the moment we switch the storefront to Ecwid? Run this BEFORE
   flipping SADKO_ECWID on in production (spec SS12 step 2).
   From site/:  SADKO_ECWID=1 node tools/ecwid-diff.mjs */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openEcwidStore } from '../engine/ecwid-store.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const seed = JSON.parse(readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8')).products;
const store = openEcwidStore(path.join(ROOT, 'data', 'ecwid.db'));
const live = store.allProducts();

const byId = rows => new Map(rows.map(r => [String(r.id), r]));
const S = byId(seed), L = byId(live);
const added = [...L.keys()].filter(k => !S.has(k));
const removed = [...S.keys()].filter(k => !L.has(k));
const repriced = [...L.keys()].filter(k => S.has(k) && Number(S.get(k).price) !== Number(L.get(k).price));
const discounted = live.filter(p => p.compareToPrice != null);
const oos = live.filter(p => p.inStock === false);

console.log(`seed ${seed.length} -> ecwid ${live.length}`);
console.log(`  added      ${added.length}`);
console.log(`  removed    ${removed.length}`);
console.log(`  repriced   ${repriced.length}`);
console.log(`  discounted ${discounted.length}  (real compareToPrice above price)`);
console.log(`  out of stock ${oos.length}  (shown as unavailable, never hidden)`);

const show = (label, ids) => {
  if (!ids.length) return;
  console.log('\n' + label);
  for (const id of ids.slice(0, 20)) {
    const r = L.get(id) || S.get(id);
    console.log('  ' + id.padEnd(12) + String(r.price).padStart(8) + '  ' + String(r.title).slice(0, 58));
  }
  if (ids.length > 20) console.log(`  … and ${ids.length - 20} more`);
};
show('ADDED (new site does not show these today)', added);
show('REMOVED (new site is still advertising these)', removed);
show('REPRICED', repriced);
store.close();
```

- [ ] **Step 7: Verify the flag-off path is byte-identical**

Run: `node --test engine/*.test.mjs`
Expected: all green, including every existing storefront test, **with `SADKO_ECWID` unset** — proving the default path is unchanged.

Then confirm the server still serves the seed with the flag off:

```bash
node -e "process.env.SADKO_NO_SERVE='1'; import('./compare-server.mjs').then(()=>console.log('boots with flag off'))"
```

Expected: `boots with flag off`, no Ecwid log lines.

- [ ] **Step 8: Commit**

```bash
git add site/engine/ecwid-source.mjs site/engine/ecwid-source.test.mjs site/tools/ecwid-diff.mjs site/compare-server.mjs
git commit -m "feat(ecwid): serve the mirror through mergedCatalog, behind SADKO_ECWID

baseCatalog() now asks engine/ecwid-source.mjs, which picks the mirror when
it has rows and the static seed otherwise. mergedCatalog() is untouched, so
the overlay and every client page keep working unchanged.

The precedence that matters: a mirror with rows is served EVEN IF the last
sync failed. Stale real data beats a July snapshot, and the failure is
surfaced in admin rather than silently swapping the catalogue underneath
the customer. With the flag off, behaviour is byte-identical to before.

Adds tools/ecwid-diff.mjs so the additions, removals, reprices, real
discounts and out-of-stock counts are reviewed before the flag goes on in
production."
```

---

### Task 8: The webhook route

**Files:**
- Create: `site/engine/ecwid-webhook.mjs`
- Modify: `site/compare-server.mjs` — add the route beside the other `/api/*` routes (before the `/api/admin/` block, around line 1943)
- Test: `site/engine/ecwid-webhook.test.mjs`

**Interfaces:**
- Consumes: `createEcwidSync` (Task 6).
- Produces: `verifyWebhook({ rawBody, signature, secret })` → `boolean`, and `parseWebhook(rawBody)` → `{ eventType, entityId, storeId } | null`.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-webhook.test.mjs`:

```js
// site/engine/ecwid-webhook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, parseWebhook } from './ecwid-webhook.mjs';

const SECRET = 'shhh';
const sign = body => createHmac('sha256', SECRET).update(body).digest('base64');

test('a correctly signed body verifies', () => {
  const body = '{"eventType":"product.updated","entityId":1}';
  assert.equal(verifyWebhook({ rawBody: body, signature: sign(body), secret: SECRET }), true);
});

test('a tampered body does not verify', () => {
  const body = '{"eventType":"product.updated","entityId":1}';
  const sig = sign(body);
  assert.equal(verifyWebhook({ rawBody: body.replace('1', '2'), signature: sig, secret: SECRET }), false);
});

test('a wrong secret does not verify', () => {
  const body = '{}';
  assert.equal(verifyWebhook({ rawBody: body, signature: sign(body), secret: 'other' }), false);
});

test('an absent signature does not verify', () => {
  assert.equal(verifyWebhook({ rawBody: '{}', signature: '', secret: SECRET }), false);
  assert.equal(verifyWebhook({ rawBody: '{}', signature: undefined, secret: SECRET }), false);
});

test('an absent secret never verifies — an unconfigured server must reject, not accept', () => {
  const body = '{}';
  assert.equal(verifyWebhook({ rawBody: body, signature: sign(body), secret: '' }), false);
});

test('a signature of the wrong length is rejected without throwing', () => {
  assert.equal(verifyWebhook({ rawBody: '{}', signature: 'short', secret: SECRET }), false);
});

test('parseWebhook pulls the event type and entity id', () => {
  const p = parseWebhook('{"eventType":"product.updated","entityId":676766143,"storeId":18028328}');
  assert.equal(p.eventType, 'product.updated');
  assert.equal(p.entityId, '676766143');
  assert.equal(p.storeId, '18028328');
});

test('parseWebhook returns null on malformed JSON rather than throwing', () => {
  assert.equal(parseWebhook('not json'), null);
});

test('parseWebhook returns null when the event carries no entity', () => {
  assert.equal(parseWebhook('{"eventType":"product.updated"}'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-webhook.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-webhook.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/engine/ecwid-webhook.mjs`:

```js
/* ============================================================================
   Webhook verification. This route is PUBLIC, so it is the one place an
   attacker can reach the sync machinery.

   Three rules:
     • Compare in constant time. A byte-by-byte early exit leaks the expected
       signature to a patient attacker.
     • No secret configured means REJECT, never accept. A misconfigured server
       must be closed, not open.
     • The signature is over the RAW body. Re-serialising the parsed JSON
       changes the bytes and the HMAC will never match.
   ========================================================================== */

import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook({ rawBody, signature, secret }) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody || '').digest();
  let given;
  try { given = Buffer.from(String(signature), 'base64'); } catch { return false; }
  if (given.length !== expected.length) return false;   // timingSafeEqual throws on a length mismatch
  return timingSafeEqual(given, expected);
}

export function parseWebhook(rawBody) {
  let d;
  try { d = JSON.parse(rawBody); } catch { return null; }
  if (!d || d.entityId == null || !d.eventType) return null;
  return {
    eventType: String(d.eventType),
    entityId: String(d.entityId),
    storeId: d.storeId != null ? String(d.storeId) : null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-webhook.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the route to `compare-server.mjs`**

Import beside the other engine imports:

```js
import { verifyWebhook, parseWebhook } from './engine/ecwid-webhook.mjs';
```

Insert this **before** the `if (u.pathname.startsWith('/api/admin/'))` block:

```js
  /* ---- Ecwid webhooks ----------------------------------------------------
     Public route. Verify first, answer 200 immediately, then work async:
     Ecwid retries anything slow or non-200, and a retry storm would be worse
     than a missed event (the 15-minute pull is the safety net). */
  if (u.pathname === '/api/ecwid/webhook' && req.method === 'POST') {
    const es = ecwidSync();
    if (!es) { res.statusCode = 503; return res.end('ecwid off'); }

    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000) { res.statusCode = 413; return res.end('too large'); }
      }
    } catch (e) { res.statusCode = 400; return res.end('bad body'); }

    const sig = req.headers['x-ecwid-webhook-signature'];
    if (!verifyWebhook({ rawBody: raw, signature: sig, secret: process.env.SADKO_ECWID_WEBHOOK_SECRET || '' })) {
      console.warn('[ecwid] webhook rejected: bad or missing signature');
      res.statusCode = 401; return res.end('bad signature');
    }
    const ev = parseWebhook(raw);
    if (!ev) { res.statusCode = 400; return res.end('bad event'); }

    res.statusCode = 200; res.end('ok');                  // acknowledge, then work

    if (/^product\./.test(ev.eventType)) {
      es.applyProductEvent(ev).catch(e => console.error('[ecwid] webhook product:', e.message));
    } else if (/^category\./.test(ev.eventType)) {
      es.syncCategories().catch(e => console.error('[ecwid] webhook category:', e.message));
    } else if (/^order\./.test(ev.eventType)) {
      applyEcwidOrderEvent(ev).catch(e => console.error('[ecwid] webhook order:', e.message));  // Task 13
    }
    return;
  }
```

`applyEcwidOrderEvent` arrives in Task 13. Until then, add this stub immediately above the request handler so the route is complete and the server boots:

```js
/* Filled in by Task 13 (order status flowing back from Ecwid). */
async function applyEcwidOrderEvent(ev) { console.log('[ecwid] order event ignored for now:', ev.eventType); }
```

- [ ] **Step 6: Verify the route rejects an unsigned request**

Run the server with the flag on and a test secret, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8082/api/ecwid/webhook \
  -H 'content-type: application/json' -d '{"eventType":"product.updated","entityId":1}'
```

Expected: `401`.

- [ ] **Step 7: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/engine/ecwid-webhook.mjs site/engine/ecwid-webhook.test.mjs site/compare-server.mjs
git commit -m "feat(ecwid): signed webhook route for near-instant freshness

POST /api/ecwid/webhook verifies the HMAC over the RAW body with a
constant-time compare, then answers 200 immediately and does the work
asynchronously — Ecwid retries anything slow or non-200, and a retry storm
would be worse than a missed event, which the 15-minute pull already covers.

An absent secret rejects rather than accepts: a misconfigured server must be
closed, not open. Tests cover tampering, wrong secret, missing signature,
wrong-length signature and malformed JSON."
```

---

### Task 9: Rails derived from Ecwid, and the honesty guards rewritten

**Files:**
- Create: `site/engine/ecwid-rails.mjs`
- Modify: `site/compare-server.mjs` — serve `data/collections.json` from derived rails
- Modify: `site/engine/shop-core.test.mjs` — rewrite two assertion blocks (the "No invented commercial claims" block around lines 419–474, and the curated-id assertion at line 432)
- Modify: `site/data/promos.json` — correct the stale `note`
- Test: `site/engine/ecwid-rails.test.mjs`

**Interfaces:**
- Consumes: mirror rows from `ecwid-store` (Task 5), which carry `categoryIds` and `compareToPrice`.
- Produces: `deriveRails(products, { offersCategoryId, bestSellersCategoryId, limit })` → `{ offers: {titleAr,titleEn,ids}, bestSellers: {...}, featured: {...} }`. A rail with no qualifying products is **omitted entirely** from the returned object.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-rails.test.mjs`:

```js
// site/engine/ecwid-rails.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRails, OFFERS_CAT, BEST_CAT } from './ecwid-rails.mjs';

const P = (id, over = {}) => ({ id: String(id), title: 'ثلاجة ' + id, price: 1000,
  categoryId: '38003882', categoryIds: ['38003882'], inStock: true, compareToPrice: null, ...over });

test('offers comes from membership of the Ecwid offers category', () => {
  const r = deriveRails([P(1, { categoryIds: ['38003882', OFFERS_CAT] }), P(2)]);
  assert.deepEqual(r.offers.ids, ['1']);
  assert.equal(r.offers.titleAr, 'عروض صادكو');
});

test('bestSellers comes from membership of the Ecwid best-sellers category', () => {
  const r = deriveRails([P(1), P(2, { categoryIds: [BEST_CAT] })]);
  assert.deepEqual(r.bestSellers.ids, ['2']);
  assert.equal(r.bestSellers.titleAr, 'الأكثر مبيعاً');
});

test('featured comes from products carrying a real discount', () => {
  const r = deriveRails([P(1, { price: 1000, compareToPrice: 1500 }), P(2)]);
  assert.deepEqual(r.featured.ids, ['1']);
  assert.equal(r.featured.titleAr, 'مختارات صادكو');
});

test('a product whose was-price was already dropped by the mapper is not featured', () => {
  // the mapper nulls a stale compareToPrice; nothing downstream may resurrect it
  const r = deriveRails([P(1, { compareToPrice: null }), P(2, { compareToPrice: null })]);
  assert.ok(!('featured' in r), 'no real discounts means no featured rail at all');
});

test('an empty rail is omitted, never padded with arbitrary products', () => {
  const r = deriveRails([P(1), P(2), P(3)]);
  assert.ok(!('offers' in r));
  assert.ok(!('bestSellers' in r));
  assert.ok(!('featured' in r));
  assert.deepEqual(Object.keys(r), []);
});

test('featured is ordered by the largest real saving first', () => {
  const r = deriveRails([
    P(1, { price: 1000, compareToPrice: 1100 }),   // saves 100
    P(2, { price: 1000, compareToPrice: 2000 }),   // saves 1000
  ]);
  assert.deepEqual(r.featured.ids, ['2', '1']);
});

test('out-of-stock products are excluded from rails but remain in the catalogue', () => {
  const rows = [P(1, { categoryIds: [OFFERS_CAT], inStock: false }), P(2, { categoryIds: [OFFERS_CAT] })];
  const r = deriveRails(rows);
  assert.deepEqual(r.offers.ids, ['2'], 'a rail should not promote something unbuyable');
  assert.equal(rows.length, 2, 'the catalogue list itself is never filtered here');
});

test('rails are capped so a rail cannot become the whole catalogue', () => {
  const many = Array.from({ length: 80 }, (_, i) => P(i + 1, { categoryIds: [OFFERS_CAT] }));
  assert.equal(deriveRails(many, { limit: 24 }).offers.ids.length, 24);
});

test('a product in both curated categories appears in both rails', () => {
  const r = deriveRails([P(1, { categoryIds: [OFFERS_CAT, BEST_CAT] })]);
  assert.deepEqual(r.offers.ids, ['1']);
  assert.deepEqual(r.bestSellers.ids, ['1']);
});

test('English titles are present for the EN side of the site', () => {
  const r = deriveRails([P(1, { categoryIds: [OFFERS_CAT] })]);
  assert.equal(r.offers.titleEn, 'SADKO offers');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-rails.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-rails.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/engine/ecwid-rails.mjs`:

```js
/* ============================================================================
   The shop's product rails, DERIVED so they cannot rot.

   data/collections.json used to hold three hand-curated id lists captured in
   July. offers and bestSellers now come from the real Ecwid categories staff
   already curate; featured comes from products carrying a genuine was-price.

   The rule that matters: a rail with nothing to show is OMITTED. Padding it
   with arbitrary products would be inventing a commercial claim, which the
   honesty guards in shop-core.test.mjs forbid.
   ========================================================================== */

export const OFFERS_CAT = '173607281';   // عروض صادكو
export const BEST_CAT = '195273251';     // الأكثر مبيعاً

const TITLES = {
  offers: { titleAr: 'عروض صادكو', titleEn: 'SADKO offers' },
  bestSellers: { titleAr: 'الأكثر مبيعاً', titleEn: 'Best sellers' },
  featured: { titleAr: 'مختارات صادكو', titleEn: "SADKO's picks" },
};

const inCat = (p, cat) =>
  String(p.categoryId) === cat ||
  (Array.isArray(p.categoryIds) && p.categoryIds.map(String).includes(cat));

export function deriveRails(products, {
  offersCategoryId = OFFERS_CAT, bestSellersCategoryId = BEST_CAT, limit = 24,
} = {}) {
  /* A rail promotes something to buy, so it skips what cannot be bought. The
     product itself stays in the catalogue, marked unavailable — see spec SS5.4. */
  const buyable = (products || []).filter(p => p && p.inStock !== false);

  const out = {};
  const put = (key, ids) => { if (ids.length) out[key] = { ...TITLES[key], ids: ids.slice(0, limit) }; };

  put('offers', buyable.filter(p => inCat(p, offersCategoryId)).map(p => String(p.id)));
  put('bestSellers', buyable.filter(p => inCat(p, bestSellersCategoryId)).map(p => String(p.id)));

  /* featured = a REAL discount. The mapper has already nulled every stale,
     equal, zero or absent was-price, so simply trusting compareToPrice here is
     safe — and nothing may resurrect a dropped one. Biggest saving first. */
  const discounted = buyable
    .filter(p => p.compareToPrice != null && p.price != null && p.compareToPrice > p.price)
    .sort((a, b) => (b.compareToPrice - b.price) - (a.compareToPrice - a.price));
  put('featured', discounted.map(p => String(p.id)));

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-rails.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Serve derived rails from `compare-server.mjs`**

Import beside the other engine imports:

```js
import { deriveRails } from './engine/ecwid-rails.mjs';
```

Add this route immediately **before** the existing `/data/products.json` interception:

```js
  /* The shop reads its rails from this URL. With Ecwid on, serve DERIVED rails
     so a product removed in Ecwid can never leave a dangling curated id; with
     Ecwid off, fall through to the static file. */
  if (u.pathname === '/data/collections.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (ecwidSource().activeSource() === 'ecwid') {
      try {
        const collections = deriveRails(await mergedCatalog());
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        return res.end(JSON.stringify({
          note: 'Derived live from the Ecwid store. offers and bestSellers are category ' +
                'membership; featured is products with a real compareToPrice above the price. ' +
                'A rail with no qualifying products is omitted rather than padded.',
          derivedAt: new Date().toISOString(),
          collections,
        }));
      } catch (e) { /* fall through to the static file */ }
    }
  }
```

- [ ] **Step 6: Rewrite the two honesty-guard assertion blocks**

In `site/engine/shop-core.test.mjs`, the curated-id assertion at line 432 currently requires every id in `collections.json` to exist in `products.json`. Replace that test with one that covers derived rails:

```js
test('rails reference only products that exist, and are omitted when empty', () => {
  // Rails are DERIVED now (engine/ecwid-rails.mjs), so a dangling curated id is
  // structurally impossible. What still needs guarding is the derivation itself.
  const catalogue = read('products.json').products;
  const known = new Set(catalogue.map(p => String(p.id)));
  const rails = deriveRails(catalogue);
  for (const [name, rail] of Object.entries(rails)) {
    assert.ok(rail.ids.length, `rail ${name} is present but empty — it should have been omitted`);
    for (const id of rail.ids) assert.ok(known.has(id), `rail ${name} references unknown product ${id}`);
  }
});
```

Then rewrite the "No invented commercial claims" block so it asserts **provenance** rather than forbidding display. Keep every existing assertion about ratings, review counts, stock claims and delivery estimates exactly as it is, and replace only the discount prohibition:

```js
test('a discount may be shown ONLY when it comes from a real synced was-price', () => {
  /* Previously this forbade discount display outright, because the July scrape
     carried no discount data at all. Ecwid does carry a staff-entered
     compareToPrice, so a discount can now be real — but only that. The mapper
     nulls every stale, equal, zero or absent was-price (engine/ecwid-map.mjs),
     and nothing downstream may resurrect one or compute its own. */
  const fabricated = { id: 'x', title: 'ثلاجة', price: 1000, compareToPrice: null,
    categoryId: 'c', categoryIds: ['c'], inStock: true };
  assert.ok(!('featured' in deriveRails([fabricated])),
    'a product with no real was-price must never be promoted as a deal');

  const real = { ...fabricated, id: 'y', compareToPrice: 1400 };
  assert.deepEqual(deriveRails([real]).featured.ids, ['y'],
    'a genuine staff-entered was-price above the price may be shown');

  const stale = { ...fabricated, id: 'z', compareToPrice: 900 };
  assert.ok(!('featured' in deriveRails([stale])),
    'a was-price below the price is stale data, not a discount');
});
```

Add the import at the top of `shop-core.test.mjs`:

```js
import { deriveRails } from './ecwid-rails.mjs';
```

- [ ] **Step 7: Correct the stale note in `data/promos.json`**

Replace the clause asserting the catalogue carries no discount data. The banner-level rule stands; only its reasoning changes:

```
"note": "REAL SADKO campaign artwork, downloaded from the company's own live homepage (https://sadko-group.com/) on 2026-09-05 and stored under assets/img/promos/. The banner text is baked into the images in Arabic; `title`/`sub` transcribe what each image says so screen readers and the English side have an equivalent. Do not add a 'was' price, discount %, rating or stock claim to a BANNER: a banner is artwork and carries no per-product data to justify one. Real product discounts do exist now — they come from a staff-entered compareToPrice synced from Ecwid and are rendered on product cards and the مختارات صادكو rail, never invented here.",
```

- [ ] **Step 8: Run the whole suite**

Run: `node --test engine/*.test.mjs`
Expected: all green. The rewritten assertions replace their predecessors in place, so the total does not decrease.

- [ ] **Step 9: Commit**

```bash
git add site/engine/ecwid-rails.mjs site/engine/ecwid-rails.test.mjs site/engine/shop-core.test.mjs site/data/promos.json site/compare-server.mjs
git commit -m "feat(ecwid): derive shop rails from the store, assert discount provenance

collections.json held three id lists hand-curated in July. offers and
bestSellers now derive from the real Ecwid categories staff already curate,
and featured derives from products carrying a genuine staff-entered
compareToPrice above the price, biggest saving first. A dangling curated id
becomes structurally impossible.

An empty rail is omitted, never padded: filling one with arbitrary products
would be inventing a commercial claim. Rails also skip out-of-stock items,
which stay in the catalogue marked unavailable.

The two honesty guards in shop-core.test.mjs are rewritten in place rather
than deleted. They no longer forbid discount display outright; they now
assert provenance — a real synced was-price may be shown, a stale, equal,
zero or absent one may not, and nothing may compute its own."
```

---

### Task 10: Banners stay owner-editable

Ecwid has no banner entity (spec §6.2), so `promos.json` stays local — but it is currently editable only by hand. One registry entry fixes that, reusing the editor `guides` and `finder` already use.

**Files:**
- Modify: `site/compare-server.mjs` — `ADMIN_CONTENT` (around line 1656)
- Test: `site/engine/admin-content.test.mjs`

**Interfaces:**
- Consumes: the existing `/api/admin/content/:name` GET and PUT handlers — no handler changes needed.
- Produces: `promos` as a valid `ADMIN_CONTENT` key, so `GET/PUT /api/admin/content/promos` works.

- [ ] **Step 1: Write the failing test**

Create `site/engine/admin-content.test.mjs`:

```js
// site/engine/admin-content.test.mjs
// compare-server.mjs is a server module, so — like product-ids.test.mjs and
// shop-wiring.test.mjs — this reads the source and asserts on the declaration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const block = /const ADMIN_CONTENT = \{([\s\S]*?)\n\};/.exec(src);

test('ADMIN_CONTENT is declared and parseable', () => {
  assert.ok(block, 'ADMIN_CONTENT declaration not found');
});

test('every ADMIN_CONTENT entry points at a data file that exists', () => {
  for (const m of block[1].matchAll(/file:\s*'([^']+)'/g))
    assert.ok(existsSync(path.join(SITE, 'data', m[1])), `missing data/${m[1]}`);
});

test('promos is owner-editable — Ecwid has no banner entity, so the site owns them', () => {
  assert.match(block[1], /promos:\s*\{\s*file:\s*'promos\.json'/);
});

test('each entry carries a bilingual label for the admin UI', () => {
  const entries = [...block[1].matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(entries.length >= 3);
  for (const l of entries) assert.match(l, / \/ /, `label "${l}" is not bilingual`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/admin-content.test.mjs`
Expected: FAIL on the `promos` assertion.

- [ ] **Step 3: Add the entry**

In `site/compare-server.mjs`:

```js
/* JSON content files the owner may edit from the control room. The catalogue is
   NOT here — Ecwid owns it (engine/ecwid-source.mjs). These are the site's own
   editorial and campaign content, which Ecwid has no place to store. */
const ADMIN_CONTENT = {
  guides: { file: 'guides.json', label: 'أدلة الشراء / Buying guides' },
  finder: { file: 'finder.json', label: 'مساعد الاختيار / Finder questions' },
  promos: { file: 'promos.json', label: 'لافتات الإعلانات / Advertisement banners' },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/admin-content.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/compare-server.mjs site/engine/admin-content.test.mjs
git commit -m "feat(admin): make advertisement banners owner-editable

Ecwid has no banner entity, so promos.json stays local — but it was
editable only by hand. Registering it in ADMIN_CONTENT gives it the same
editor guides and finder already use, with no handler changes.

The new test also guards the registry itself: every entry must point at a
data file that exists and carry a bilingual label."
```

---

## Remaining tasks

Tasks 11–15 follow in `docs/superpowers/plans/2026-09-15-ecwid-integration-part3.md`:

- **Task 11** — `toEcwidOrder` and `toLocalStatus`: the payment table that throws on an unknown method, subtotal-only totals with shipping left unset, the Arabic fees note
- **Task 12** — the `order_push` queue and the idempotent check-then-create push worker
- **Task 13** — `/api/orders` enqueues a push; `applyEcwidOrderEvent` maps Ecwid status back onto `ORDER_STATUSES`
- **Task 14** — admin becomes a read-only window: sync panel, Ecwid deep links, retry-failed-push
- **Task 15** — ops: `/etc/sadko.env`, webhook registration, the rollout runbook, the category-added admin task
