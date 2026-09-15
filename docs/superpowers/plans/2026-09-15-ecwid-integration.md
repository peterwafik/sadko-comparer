# Ecwid Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ecwid store `18028328` — which already backs `sadko-group.com` — the control plane for the new site's products, categories, product rails and orders, so staff keep working in the admin they already know.

**Architecture:** Ecwid is mirrored into a SQLite database (`site/data/ecwid.db`) and served through the seam the site already speaks: `GET /data/products.json`, which `compare-server.mjs` already intercepts and answers from `mergedCatalog()`. No client page changes. Freshness comes from Ecwid webhooks (which re-fetch the entity rather than applying the event payload, so replays and out-of-order delivery are harmless), with a 15-minute incremental pull as a safety net and a daily full reconcile to catch deletions. Orders are written locally first, then pushed into Ecwid through an idempotent check-then-create queue; status flows back by webhook.

**Tech Stack:** Node 24 (`node:sqlite`, `node:test`, `node:crypto`, global `fetch`) — **zero new dependencies**. The repo has no `package.json` and must keep none.

**Spec:** `docs/superpowers/specs/2026-09-15-ecwid-integration-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Zero new dependencies.** No `package.json`, no `npm install`. Use `node:sqlite`, `node:test`, `node:crypto`, `node:fs`, global `fetch`.
- **Test command:** `node --test engine/*.test.mjs`, run from `D:\SADKO\site`.
- **Test suite currently stands at 483 tests.** Every existing test stays green and the total must not decrease. Two assertion blocks are rewritten in place (Task 9), never deleted.
- **The API token is the owner's to place.** It goes in `/etc/sadko.env` as `SADKO_ECWID_TOKEN`, read by `sadko.service`. The implementer never types, echoes, commits, or logs its value. Error messages and API responses expose only "connected" / "not connected".
- **Never synthesise a shipping cost or grand total.** `createOrder` stores `grandTotal: null` deliberately. Pushes send the items subtotal, leave shipping unset, and carry the Arabic fees-to-be-confirmed note.
- **Out-of-stock products are shown as unavailable, never hidden.**
- **Empty rails render nothing, never padded** with arbitrary products.
- **Ecwid ids are the ids.** `products.json` `id` and `categoryId` already equal the Ecwid product/category ids. Never build a mapping table.
- **All new user-facing Arabic copy is فصحى** (Modern Standard Arabic), matching the rest of the site.
- **Everything ships behind `SADKO_ECWID=1`.** With the flag off, behaviour is byte-identical to today.
- **Ecwid store id:** `18028328`. **Image CSP is already `img-src 'self' data: https:`**, so any Ecwid image host works without a CSP change.

---

### Task 1: Connect, capture real fixtures, settle the order-ref field

The spec's one open item (§13). Everything downstream tests against **real** captured payloads, so this task produces them. No production code ships here.

**Files:**
- Create: `site/engine/fixtures/ecwid-product.json`
- Create: `site/engine/fixtures/ecwid-category.json`
- Create: `site/engine/fixtures/ecwid-order.json`
- Create: `site/engine/fixtures/README.md`
- Create: `site/tools/ecwid-capture.mjs`
- Test: `site/engine/ecwid-fixtures.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: three fixture files whose shapes every later task's tests import. `site/tools/ecwid-capture.mjs` is a developer tool, not part of the server.

**Prerequisite (owner action, not implementer action):** the owner creates an access token in the Ecwid control panel (Settings → Apps → API access, or My Apps → custom app) and places it in the environment as `SADKO_ECWID_TOKEN`. Until that exists this task cannot run, and no later task can be verified against real data.

- [ ] **Step 1: Write the capture tool**

Create `site/tools/ecwid-capture.mjs`:

```js
/* Developer tool. Captures REAL Ecwid payloads as test fixtures.
   Run once, from site/:  node tools/ecwid-capture.mjs
   Reads SADKO_ECWID_TOKEN from the environment; never prints it. */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const STORE = process.env.SADKO_ECWID_STORE_ID || '18028328';
const TOKEN = process.env.SADKO_ECWID_TOKEN;
if (!TOKEN) { console.error('SADKO_ECWID_TOKEN is not set — nothing captured.'); process.exit(1); }

const BASE = `https://app.ecwid.com/api/v3/${STORE}`;
const OUT = path.join(import.meta.dirname, '..', 'engine', 'fixtures');

async function get(p) {
  const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

/* Scrub every field that could carry a real customer's identity. A fixture is
   committed to git; a real name, phone, email or address must never be. */
function scrubOrder(o) {
  const FAKE = {
    email: 'test@example.com', name: 'عميل تجريبي', phone: '+200000000000',
    street: 'شارع تجريبي', city: 'القاهرة', postalCode: '00000',
    companyName: 'SADKO test', firstName: 'عميل', lastName: 'تجريبي',
  };
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = k in FAKE ? FAKE[k] : walk(x);
      return out;
    }
    return v;
  };
  return walk(o);
}

mkdirSync(OUT, { recursive: true });

const products = await get('/products?limit=1');
const product = products.items[0];
writeFileSync(path.join(OUT, 'ecwid-product.json'), JSON.stringify(product, null, 1));
console.log('captured product', product.id, '— keys:', Object.keys(product).join(', '));

const cats = await get('/categories?limit=1');
writeFileSync(path.join(OUT, 'ecwid-category.json'), JSON.stringify(cats.items[0], null, 1));
console.log('captured category', cats.items[0].id);

const orders = await get('/orders?limit=1');
if (orders.items && orders.items.length) {
  const o = scrubOrder(orders.items[0]);
  writeFileSync(path.join(OUT, 'ecwid-order.json'), JSON.stringify(o, null, 1));
  console.log('captured order (scrubbed) — keys:', Object.keys(o).join(', '));
  /* THE OPEN ITEM (spec §7.2): which field can carry and be queried for our
     local SDK- ref. Print the candidates so a human can decide. */
  const cand = Object.keys(o).filter(k => /external|orderNumber|refer|comment|custom/i.test(k));
  console.log('\nREF-FIELD CANDIDATES on a real order:', cand.join(', ') || '(none found)');
} else {
  console.log('no orders in the store yet — ecwid-order.json not written');
}
```

- [ ] **Step 2: Owner runs it; implementer records the answer**

Run, from `site/`: `node tools/ecwid-capture.mjs`

Expected: three fixture files written, and a printed `REF-FIELD CANDIDATES` line.

Then answer the open item by testing each candidate: create a throwaway Ecwid order via the API carrying `SDK-TEST01` in the candidate field, then try to find it again. Record the outcome in `site/engine/fixtures/README.md`:

```markdown
# Ecwid fixtures

Captured from store 18028328 with `node tools/ecwid-capture.mjs`.
Customer identity fields in `ecwid-order.json` are SCRUBBED — see the tool.

## Order-ref field (spec §7.2, the open item)

- Field that holds our local `SDK-` ref: `<FIELD NAME AS VERIFIED>`
- Query used to find an order by that ref: `<EXACT QUERY AS VERIFIED>`
- Verified on: <DATE>

If no field is both writable and queryable, the fallback stands: write the ref
into order comments and match on it while scanning recent orders.
```

- [ ] **Step 3: Write a test that pins the fixture shapes**

Create `site/engine/ecwid-fixtures.test.mjs`:

```js
// site/engine/ecwid-fixtures.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, 'fixtures');
const read = n => JSON.parse(readFileSync(path.join(DIR, n), 'utf8'));

test('product fixture carries every field the mapper needs', () => {
  const p = read('ecwid-product.json');
  for (const k of ['id', 'name', 'price', 'url']) assert.ok(k in p, `missing ${k}`);
});

test('category fixture carries id and name', () => {
  const c = read('ecwid-category.json');
  for (const k of ['id', 'name']) assert.ok(k in c, `missing ${k}`);
});

test('order fixture carries no real customer identity', () => {
  if (!existsSync(path.join(DIR, 'ecwid-order.json'))) return;  // store had no orders yet
  const raw = readFileSync(path.join(DIR, 'ecwid-order.json'), 'utf8');
  assert.ok(!/@(?!example\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(raw), 'a real email address leaked into the fixture');
  assert.ok(!/\+?20\d{9,}/.test(raw.replace(/\+200000000000/g, '')), 'a real Egyptian phone number leaked into the fixture');
});

test('the order-ref field question is answered, not left open', () => {
  const doc = readFileSync(path.join(DIR, 'README.md'), 'utf8');
  assert.ok(!/<FIELD NAME AS VERIFIED>/.test(doc), 'README still has the placeholder — the open item is unresolved');
  assert.match(doc, /Field that holds our local `SDK-` ref: `\S+`/);
});
```

- [ ] **Step 4: Run the tests**

Run: `node --test engine/ecwid-fixtures.test.mjs`
Expected: PASS once the fixtures exist and the README placeholder is replaced. Before that it correctly FAILS on the placeholder — that failure is the gate on the open item.

- [ ] **Step 5: Commit**

```bash
git add site/tools/ecwid-capture.mjs site/engine/fixtures/ site/engine/ecwid-fixtures.test.mjs
git commit -m "feat(ecwid): capture real store fixtures and settle the order-ref field

Adds tools/ecwid-capture.mjs, which pulls one real product, category and
order from store 18028328 and writes them as test fixtures. Customer
identity fields on the order are scrubbed before the fixture is written,
so no real name, phone, email or address reaches git.

Also answers the spec's one open item (SS7.2) by recording the verified
Ecwid field that can hold and be queried for our local SDK- order ref.
A test fails while that answer is still a placeholder."
```

---

### Task 2: `ecwid-api.mjs` — the REST client

**Files:**
- Create: `site/engine/ecwid-api.mjs`
- Test: `site/engine/ecwid-api.test.mjs`

**Interfaces:**
- Consumes: nothing (the fixtures are used by later mapping tasks, not here).
- Produces: `openEcwidApi({ storeId, token, fetchImpl?, retries?, baseDelayMs? })` returning an object with:
  - `configured` → `boolean`
  - `listProducts({ updatedFrom?, offset?, limit? })` → `Promise<{ items: object[], total: number, count: number }>`
  - `listAllProductIds()` → `Promise<Set<string>>`
  - `getProduct(id)` → `Promise<object | null>` (`null` on 404)
  - `listCategories()` → `Promise<object[]>`
  - `createOrder(payload)` → `Promise<{ id: string }>`
  - `findOrderByRef(ref)` → `Promise<{ id: string } | null>`
  - `getOrder(id)` → `Promise<object | null>`

Retries on 429 and 5xx with exponential backoff; does **not** retry 4xx other than 429. Throws `Error` with `err.status` set.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-api.test.mjs`:

```js
// site/engine/ecwid-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openEcwidApi } from './ecwid-api.mjs';

/* A fake fetch: hand it a queue of responses, it returns them in order and
   records the requests it saw. No network, so the tests are fast and honest. */
function fakeFetch(queue) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = queue.shift();
    if (!next) throw new Error('fake fetch: queue exhausted for ' + url);
    if (next.throw) throw new Error(next.throw);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}
const api = (queue, extra = {}) => openEcwidApi({
  storeId: '18028328', token: 'tkn', fetchImpl: fakeFetch(queue), baseDelayMs: 0, ...extra });

test('reports not configured when the token is absent', () => {
  const a = openEcwidApi({ storeId: '18028328', token: '', fetchImpl: fakeFetch([]) });
  assert.equal(a.configured, false);
});

test('listProducts sends the token as a bearer header and returns items', async () => {
  const f = fakeFetch([{ status: 200, body: { items: [{ id: 1 }], total: 1, count: 1 } }]);
  const a = openEcwidApi({ storeId: '18028328', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  const out = await a.listProducts({});
  assert.deepEqual(out.items, [{ id: 1 }]);
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer tkn');
});

test('listProducts passes updatedFrom through as a query parameter', async () => {
  const f = fakeFetch([{ status: 200, body: { items: [], total: 0, count: 0 } }]);
  const a = openEcwidApi({ storeId: '18028328', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  await a.listProducts({ updatedFrom: 1757000000 });
  assert.match(f.calls[0].url, /updatedFrom=1757000000/);
});

test('retries a 429 and then succeeds', async () => {
  const a = api([
    { status: 429, body: { error: 'slow down' } },
    { status: 200, body: { items: [{ id: 7 }], total: 1, count: 1 } },
  ]);
  const out = await a.listProducts({});
  assert.deepEqual(out.items, [{ id: 7 }]);
});

test('retries a 500 and then succeeds', async () => {
  const a = api([
    { status: 500, body: 'boom' },
    { status: 200, body: { items: [], total: 0, count: 0 } },
  ]);
  assert.deepEqual((await a.listProducts({})).items, []);
});

test('does NOT retry a 403 — a bad token must fail loudly and fast', async () => {
  const f = fakeFetch([{ status: 403, body: 'forbidden' }]);
  const a = openEcwidApi({ storeId: '18028328', token: 'bad', fetchImpl: f, baseDelayMs: 0 });
  await assert.rejects(() => a.listProducts({}), e => e.status === 403);
  assert.equal(f.calls.length, 1, 'a 403 must not be retried');
});

test('gives up after the retry budget and throws with the status', async () => {
  const a = api([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }], { retries: 2 });
  await assert.rejects(() => a.listProducts({}), e => e.status === 503);
});

test('malformed JSON raises a clear error rather than a TypeError', async () => {
  const a = api([{ status: 200, body: 'not json at all' }]);
  await assert.rejects(() => a.listProducts({}), /malformed JSON/i);
});

test('getProduct returns null on 404 instead of throwing', async () => {
  const a = api([{ status: 404, body: 'nope' }]);
  assert.equal(await a.getProduct('123'), null);
});

test('a network throw is retried too', async () => {
  const a = api([{ throw: 'ECONNRESET' }, { status: 200, body: { items: [], total: 0, count: 0 } }]);
  assert.deepEqual((await a.listProducts({})).items, []);
});

test('listAllProductIds pages until every id is collected', async () => {
  const a = api([
    { status: 200, body: { items: [{ id: 1 }, { id: 2 }], total: 3, count: 2 } },
    { status: 200, body: { items: [{ id: 3 }], total: 3, count: 1 } },
  ]);
  const ids = await a.listAllProductIds();
  assert.deepEqual([...ids].sort(), ['1', '2', '3']);
});

test('the token never appears in a thrown error message', async () => {
  const a = api([{ status: 403, body: 'forbidden' }]);
  await assert.rejects(() => a.listProducts({}), e => !String(e.message).includes('tkn'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-api.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-api.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/engine/ecwid-api.mjs`:

```js
/* ============================================================================
   Ecwid REST v3 client — thin, dependency-free, and deliberately ignorant of
   SADKO's data shapes (engine/ecwid-map.mjs owns every translation).

   Two rules worth knowing before editing:
     • 429 and 5xx are retried with exponential backoff; other 4xx are NOT.
       A bad token must fail on the first call, loudly, not after four retries.
     • The token never reaches a log line or an error message. Errors carry a
       status and the response body, never the Authorization header.
   ========================================================================== */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function openEcwidApi({ storeId, token, fetchImpl, retries = 3, baseDelayMs = 400 } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const base = `https://app.ecwid.com/api/v3/${storeId}`;
  const configured = !!(storeId && token);

  async function call(pathAndQuery, { method = 'GET', body, allow404 = false } = {}) {
    if (!configured) { const e = new Error('ecwid-not-configured'); e.status = 0; throw e; }
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(baseDelayMs * 2 ** (attempt - 1));
      let res, text;
      try {
        res = await doFetch(base + pathAndQuery, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: body == null ? undefined : JSON.stringify(body),
        });
        text = await res.text();
      } catch (netErr) {
        lastErr = new Error('ecwid-network: ' + netErr.message);
        lastErr.status = 0;
        continue;                                     // network blips are retryable
      }
      if (res.status === 404 && allow404) return null;
      if (!res.ok) {
        const e = new Error(`ecwid-${res.status}: ${String(text).slice(0, 300)}`);
        e.status = res.status;
        if (!RETRYABLE.has(res.status)) throw e;       // fail fast on 401/403/400
        lastErr = e;
        continue;
      }
      if (!text) return null;
      try { return JSON.parse(text); }
      catch { const e = new Error('ecwid: malformed JSON in response'); e.status = res.status; throw e; }
    }
    throw lastErr || Object.assign(new Error('ecwid: exhausted retries'), { status: 0 });
  }

  const qs = o => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v));
    const s = p.toString();
    return s ? '?' + s : '';
  };

  return {
    configured,

    listProducts: ({ updatedFrom, offset = 0, limit = 100 } = {}) =>
      call('/products' + qs({ updatedFrom, offset, limit })),

    getProduct: id => call(`/products/${encodeURIComponent(id)}`, { allow404: true }),

    listCategories: async () => {
      const out = [];
      for (let offset = 0; ; ) {
        const page = await call('/categories' + qs({ offset, limit: 100 }));
        const items = (page && page.items) || [];
        out.push(...items);
        offset += items.length;
        if (!items.length || offset >= (page.total ?? out.length)) break;
      }
      return out;
    },

    /* The full id set, used by the daily reconcile to find DELETIONS — which
       updatedFrom can never report. */
    listAllProductIds: async () => {
      const ids = new Set();
      for (let offset = 0; ; ) {
        const page = await call('/products' + qs({ offset, limit: 100 }));
        const items = (page && page.items) || [];
        for (const it of items) ids.add(String(it.id));
        offset += items.length;
        if (!items.length || offset >= (page.total ?? ids.size)) break;
      }
      return ids;
    },

    createOrder: payload => call('/orders', { method: 'POST', body: payload }),
    getOrder: id => call(`/orders/${encodeURIComponent(id)}`, { allow404: true }),

    /* Idempotency support (spec SS7.2). REF_QUERY is filled in from the verified
       answer recorded in engine/fixtures/README.md by Task 1. */
    findOrderByRef: async ref => {
      const page = await call('/orders' + qs({ keywords: ref, limit: 10 }));
      const hit = ((page && page.items) || []).find(o => JSON.stringify(o).includes(ref));
      return hit ? { id: String(hit.id) } : null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-api.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite**

Run: `node --test engine/*.test.mjs`
Expected: all green, total ≥ 483 + new.

- [ ] **Step 6: Commit**

```bash
git add site/engine/ecwid-api.mjs site/engine/ecwid-api.test.mjs
git commit -m "feat(ecwid): REST v3 client with fail-fast auth errors

Thin dependency-free client over Ecwid REST v3, with fetch injected so
every test runs without network. Retries 429 and 5xx with exponential
backoff and retries network throws, but deliberately does NOT retry other
4xx: a bad token must fail on the first call rather than after four.

The token is never placed in a log line or an error message, and a test
asserts it cannot leak into a thrown error."
```

---

### Task 3: `ecwid-map.mjs` — product mapping

**Files:**
- Create: `site/engine/ecwid-map.mjs`
- Test: `site/engine/ecwid-map.test.mjs`

**Interfaces:**
- Consumes: `site/engine/fixtures/ecwid-product.json` (Task 1).
- Produces: `toSadkoProduct(ecwidProduct)` → `{ id, url, title, image, price, description, categoryId, brand, sku, inStock, compareToPrice }` where `compareToPrice` is `null` unless it genuinely exceeds `price`. Also exports `decodeEntities(str)`.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-map.test.mjs`:

```js
// site/engine/ecwid-map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toSadkoProduct, decodeEntities } from './ecwid-map.mjs';

const FIX = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'ecwid-product.json'), 'utf8'));

/* A minimal hand-built product for the rule-by-rule tests. The fixture test
   below proves the rules also hold against a REAL payload. */
const P = (over = {}) => ({
  id: 676766143, name: 'مبرد مياه كولدير', price: 6999,
  url: 'https://www.sadko-group.com/shop/x-p676766143',
  description: 'وصف', sku: '190220013', brand: 'كولدير',
  imageUrl: 'https://d2j6dbq0eux0bg.cloudfront.net/images/18028328/a.webp',
  inStock: true, ...over });

test('maps the seven fields the storefront already reads', () => {
  const p = toSadkoProduct(P());
  assert.equal(p.id, '676766143');                   // string, as products.json has always had
  assert.equal(p.title, 'مبرد مياه كولدير');
  assert.equal(p.price, 6999);
  assert.equal(p.url, 'https://www.sadko-group.com/shop/x-p676766143');
  assert.equal(p.description, 'وصف');
  assert.ok(p.image.startsWith('https://'));
});

test('carries the four new fields', () => {
  const p = toSadkoProduct(P());
  assert.equal(p.brand, 'كولدير');
  assert.equal(p.sku, '190220013');
  assert.equal(p.inStock, true);
  assert.equal(p.compareToPrice, null);              // none set on this product
});

test('decodes HTML entities in title and description', () => {
  // Real SADKO titles contain &nbsp; — see data/products.json
  const p = toSadkoProduct(P({ name: 'مبرد مياه&nbsp;كولدير', description: 'أ&amp;ب &lt;ج&gt;' }));
  assert.equal(p.title, 'مبرد مياه\u00a0كولدير');
  assert.equal(p.description, 'أ&ب <ج>');
});

test('decodeEntities handles numeric references', () => {
  assert.equal(decodeEntities('&#1587;&#x644;&#39;'), "سل'");
});

/* ---- the discount provenance rule (spec SS5.5) ---- */

test('a real was-price is kept when it exceeds the price', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 8999 })).compareToPrice, 8999);
});

test('a stale was-price equal to the price is ignored', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 6999 })).compareToPrice, null);
});

test('a stale was-price below the price is ignored', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 5000 })).compareToPrice, null);
});

test('a zero or absent was-price is ignored, never treated as a discount', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 0 })).compareToPrice, null);
  assert.equal(toSadkoProduct(P({ compareToPrice: null })).compareToPrice, null);
});

/* ---- stock ---- */

test('out of stock is reported, not hidden', () => {
  const p = toSadkoProduct(P({ inStock: false }));
  assert.equal(p.inStock, false);
  assert.ok(p.id, 'the product is still returned — hiding it is forbidden');
});

test('quantity zero with tracking on means out of stock', () => {
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 0, trackQuantity: true })).inStock, false);
});

test('unknown stock defaults to in stock rather than silently hiding the product', () => {
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: undefined })).inStock, true);
});

/* ---- category ---- */

test('categoryId comes from the default category when Ecwid gives several', () => {
  const p = toSadkoProduct(P({ defaultCategoryId: 102858075, categoryIds: [102858075, 173607281] }));
  assert.equal(p.categoryId, '102858075');
});

test('categoryIds is preserved so rails can use secondary membership', () => {
  const p = toSadkoProduct(P({ defaultCategoryId: 1, categoryIds: [1, 173607281] }));
  assert.deepEqual(p.categoryIds, ['1', '173607281']);
});

test('a product in no category still maps, with a null categoryId', () => {
  const p = toSadkoProduct(P({ defaultCategoryId: undefined, categoryIds: [] }));
  assert.equal(p.categoryId, null);
});

/* ---- price ---- */

test('a price arriving as a string is coerced to a number', () => {
  assert.equal(toSadkoProduct(P({ price: '6999.0' })).price, 6999);
});

test('an unusable price maps to null rather than zero', () => {
  assert.equal(toSadkoProduct(P({ price: null })).price, null);
});

/* ---- the real payload ---- */

test('the real captured Ecwid product maps without throwing and yields core fields', () => {
  const p = toSadkoProduct(FIX);
  assert.equal(typeof p.id, 'string');
  assert.ok(p.id.length);
  assert.ok(p.title && typeof p.title === 'string');
  assert.ok(p.price === null || typeof p.price === 'number');
  assert.ok(p.compareToPrice === null || p.compareToPrice > p.price);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-map.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/engine/ecwid-map.mjs`:

```js
/* ============================================================================
   Ecwid <-> SADKO translation. PURE: no network, no database, no clock.
   Every risky decision in this integration lives here, which is why it is the
   one module with no I/O — it can be tested exhaustively against real captured
   payloads (engine/fixtures/).
   ========================================================================== */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

export function decodeEntities(s) {
  if (s == null) return '';
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const k = g.toLowerCase();
    return k in NAMED ? NAMED[k] : m;
  });
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* Stock. Unknown means IN stock: the catalogue has always shown these products,
   and guessing "out of stock" would hide real inventory. Out of stock is
   reported so the storefront can disable buying — never used to drop the row
   (spec SS5.4). */
function stockOf(e) {
  if (typeof e.inStock === 'boolean') return e.inStock;
  if (e.trackQuantity && e.quantity != null) return num(e.quantity) > 0;
  if (typeof e.availability === 'string') return !/outofstock/i.test(e.availability);
  return true;
}

export function toSadkoProduct(e) {
  const price = num(e.price);
  /* Discount provenance (spec SS5.5): a was-price survives ONLY when a staff
     member genuinely set one above the current price. Stale, equal, zero and
     absent values are dropped, so no discount can ever be implied from them. */
  const rawWas = num(e.compareToPrice);
  const compareToPrice = (rawWas != null && price != null && rawWas > price) ? rawWas : null;

  const catIds = (Array.isArray(e.categoryIds) ? e.categoryIds : []).map(String);
  const defaultCat = e.defaultCategoryId != null ? String(e.defaultCategoryId) : (catIds[0] ?? null);

  return {
    id: String(e.id),
    url: e.url || '',
    title: decodeEntities(e.name).trim(),
    image: e.imageUrl || e.thumbnailUrl || e.originalImageUrl || '',
    price,
    description: decodeEntities(e.description).trim(),
    categoryId: defaultCat,
    categoryIds: catIds,
    brand: e.brand ? decodeEntities(e.brand).trim() : '',
    sku: e.sku ? String(e.sku) : '',
    inStock: stockOf(e),
    compareToPrice,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add site/engine/ecwid-map.mjs site/engine/ecwid-map.test.mjs
git commit -m "feat(ecwid): pure product mapping with discount provenance

toSadkoProduct maps an Ecwid product onto the seven fields the storefront
already reads, plus brand, sku, inStock and compareToPrice.

Two rules carry the weight. A was-price survives only when a staff member
genuinely set one ABOVE the current price, so stale, equal, zero and absent
values can never imply a discount. And unknown stock means in stock, since
guessing otherwise would hide real inventory; out of stock is reported for
the storefront to act on, never used to drop the row.

Titles are HTML-entity decoded, because the live catalogue contains &nbsp;."
```

---

### Task 4: `ecwid-map.mjs` — category mapping

**Files:**
- Modify: `site/engine/ecwid-map.mjs`
- Test: `site/engine/ecwid-map.test.mjs`

**Interfaces:**
- Consumes: `toSadkoProduct` (Task 3), `fixtures/ecwid-category.json` (Task 1).
- Produces: `toSadkoCategory(ecwidCategory)` → `{ id, name, parentId, order, enabled, image }`.

- [ ] **Step 1: Write the failing tests**

Append to `site/engine/ecwid-map.test.mjs`:

```js
import { toSadkoCategory } from './ecwid-map.mjs';

const FIXC = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'ecwid-category.json'), 'utf8'));

test('maps an Ecwid category onto the fields the taxonomy needs', () => {
  const c = toSadkoCategory({ id: 38003882, name: 'ثلاجات', parentId: 0, orderBy: 10,
    enabled: true, imageUrl: 'https://cdn/x.png' });
  assert.equal(c.id, '38003882');
  assert.equal(c.name, 'ثلاجات');
  assert.equal(c.parentId, null);          // Ecwid uses 0 for "top level"
  assert.equal(c.order, 10);
  assert.equal(c.enabled, true);
  assert.equal(c.image, 'https://cdn/x.png');
});

test('a nested category keeps its parent', () => {
  assert.equal(toSadkoCategory({ id: 38022268, name: 'نو فروست', parentId: 38003882 }).parentId, '38003882');
});

test('category names are entity-decoded too', () => {
  assert.equal(toSadkoCategory({ id: 1, name: 'أفران&nbsp;وبوتاجازات' }).name, 'أفران\u00a0وبوتاجازات');
});

test('a disabled category is reported as disabled rather than dropped', () => {
  assert.equal(toSadkoCategory({ id: 1, name: 'x', enabled: false }).enabled, false);
});

test('the real captured Ecwid category maps without throwing', () => {
  const c = toSadkoCategory(FIXC);
  assert.equal(typeof c.id, 'string');
  assert.ok(c.name.length);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: FAIL — `toSadkoCategory is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `site/engine/ecwid-map.mjs`:

```js
/* Ecwid uses parentId 0 for a top-level category; null reads better and keeps
   the taxonomy code from treating 0 as a real id. `enabled: false` is reported
   rather than dropped, so the sync can decide policy in one place. */
export function toSadkoCategory(e) {
  return {
    id: String(e.id),
    name: decodeEntities(e.name).trim(),
    parentId: e.parentId ? String(e.parentId) : null,
    order: num(e.orderBy) ?? 0,
    enabled: e.enabled !== false,
    image: e.imageUrl || e.thumbnailUrl || '',
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add site/engine/ecwid-map.mjs site/engine/ecwid-map.test.mjs
git commit -m "feat(ecwid): category mapping

toSadkoCategory normalises an Ecwid category: parentId 0 becomes null so
the taxonomy never treats 0 as a real id, names are entity-decoded like
product titles, and a disabled category is reported as disabled rather
than silently dropped so the sync owns that policy in one place."
```

---

### Task 5: `ecwid-store.mjs` — the mirror

**Files:**
- Create: `site/engine/ecwid-store.mjs`
- Test: `site/engine/ecwid-store.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `openEcwidStore(file)` → object with:
  - `upsertProducts(rows)` → `{ written: number }` (rows are `toSadkoProduct` output)
  - `upsertCategories(rows)` → `{ written: number }`
  - `deleteProduct(id)`, `deleteMissingProducts(keepIdSet)` → `{ removed: number }`
  - `allProducts()` → `object[]`, `allCategories()` → `object[]`
  - `productIds()` → `Set<string>`
  - `getState(key)` / `setState(key, value)` (JSON round-trip)
  - `stats()` → `{ products, categories, lastSync, lastError }`
  - `close()`

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-store.test.mjs`:

```js
// site/engine/ecwid-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-ecwid-'));
  const db = openEcwidStore(path.join(dir, 'ecwid.db'));
  return { db, dir, cleanup: () => { try { db.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}
const P = (id, over = {}) => ({
  id: String(id), url: 'u' + id, title: 'ثلاجة ' + id, image: 'i' + id + '.webp',
  price: 1000 + Number(id), description: 'وصف', categoryId: '38003882',
  categoryIds: ['38003882'], brand: 'كريازي', sku: 'S' + id,
  inStock: true, compareToPrice: null, ...over });

test('upsert then read back returns the product with every field intact', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1)]);
    const [r] = db.allProducts();
    assert.equal(r.id, '1');
    assert.equal(r.title, 'ثلاجة 1');
    assert.equal(r.price, 1001);
    assert.equal(r.brand, 'كريازي');
    assert.equal(r.inStock, true);
    assert.equal(r.compareToPrice, null);
    assert.deepEqual(r.categoryIds, ['38003882']);
  } finally { cleanup(); }
});

test('upsert is idempotent — the same id twice leaves one row, updated', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1)]);
    db.upsertProducts([P(1, { price: 2222, title: 'ثلاجة معدلة' })]);
    const rows = db.allProducts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, 2222);
    assert.equal(rows[0].title, 'ثلاجة معدلة');
  } finally { cleanup(); }
});

test('a real was-price survives the round trip', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1, { price: 1000, compareToPrice: 1500 })]);
    assert.equal(db.allProducts()[0].compareToPrice, 1500);
  } finally { cleanup(); }
});

test('out of stock survives the round trip as false, not as a missing row', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1, { inStock: false })]);
    const rows = db.allProducts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].inStock, false);
  } finally { cleanup(); }
});

test('deleteMissingProducts removes exactly what Ecwid no longer has', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2), P(3)]);
    const r = db.deleteMissingProducts(new Set(['1', '3']));
    assert.equal(r.removed, 1);
    assert.deepEqual(db.allProducts().map(p => p.id).sort(), ['1', '3']);
  } finally { cleanup(); }
});

test('deleteMissingProducts with an empty keep-set is refused as a safety guard', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    assert.throws(() => db.deleteMissingProducts(new Set()), /refusing/i);
    assert.equal(db.allProducts().length, 2, 'a failed reconcile must not empty the mirror');
  } finally { cleanup(); }
});

test('deleteProduct removes one row', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    db.deleteProduct('1');
    assert.deepEqual(db.allProducts().map(p => p.id), ['2']);
  } finally { cleanup(); }
});

test('productIds returns a set for the reconcile to diff against', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    assert.deepEqual([...db.productIds()].sort(), ['1', '2']);
  } finally { cleanup(); }
});

test('categories upsert and read back', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertCategories([{ id: '38003882', name: 'ثلاجات', parentId: null, order: 1, enabled: true, image: 'x.png' }]);
    const [c] = db.allCategories();
    assert.equal(c.name, 'ثلاجات');
    assert.equal(c.parentId, null);
    assert.equal(c.enabled, true);
  } finally { cleanup(); }
});

test('state round-trips JSON values', () => {
  const { db, cleanup } = fresh();
  try {
    db.setState('last_sync', { at: '2026-09-15T00:00:00Z', count: 510 });
    assert.deepEqual(db.getState('last_sync'), { at: '2026-09-15T00:00:00Z', count: 510 });
    assert.equal(db.getState('never_set'), null);
  } finally { cleanup(); }
});

test('stats reports what the admin panel needs', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    db.upsertCategories([{ id: 'c', name: 'x', parentId: null, order: 0, enabled: true, image: '' }]);
    db.setState('last_error', 'ecwid-503');
    const s = db.stats();
    assert.equal(s.products, 2);
    assert.equal(s.categories, 1);
    assert.equal(s.lastError, 'ecwid-503');
  } finally { cleanup(); }
});

test('reopening the same file keeps the data — migrations are idempotent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-ecwid-re-'));
  const file = path.join(dir, 'ecwid.db');
  try {
    const a = openEcwidStore(file); a.upsertProducts([P(9)]); a.close();
    const b = openEcwidStore(file);
    assert.equal(b.allProducts().length, 1);
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-store.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-store.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/engine/ecwid-store.mjs`:

```js
/* ============================================================================
   The Ecwid mirror. Same discipline as engine/accounts.mjs and
   engine/catalog-admin.mjs: node:sqlite, WAL, numbered migrations, prepared
   statements.

   This is a CACHE of someone else's data, so it is always safe to delete the
   file and re-sync. The one thing it must never do is empty itself because a
   sync went wrong, which is why deleteMissingProducts refuses an empty keep-set.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [{
  id: 1, name: 'ecwid mirror base',
  sql: `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  `,
}];

const nowISO = () => new Date().toISOString();

export function openEcwidStore(file) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(m.id, m.name, nowISO());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const putP = db.prepare('INSERT INTO products (id, data_json, synced_at) VALUES (?,?,?) ' +
                          'ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, synced_at = excluded.synced_at');
  const putC = db.prepare('INSERT INTO categories (id, data_json, synced_at) VALUES (?,?,?) ' +
                          'ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, synced_at = excluded.synced_at');
  const delP = db.prepare('DELETE FROM products WHERE id = ?');
  const allP = db.prepare('SELECT data_json FROM products');
  const allC = db.prepare('SELECT data_json FROM categories ORDER BY id');
  const idsP = db.prepare('SELECT id FROM products');
  const getS = db.prepare('SELECT value_json FROM state WHERE key = ?');
  const putS = db.prepare('INSERT INTO state (key, value_json, updated_at) VALUES (?,?,?) ' +
                          'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at');
  const cntP = db.prepare('SELECT COUNT(*) c FROM products');
  const cntC = db.prepare('SELECT COUNT(*) c FROM categories');

  const parse = rows => rows.map(r => JSON.parse(r.data_json));

  function bulk(stmt, rows) {
    if (!rows.length) return { written: 0 };
    const at = nowISO();
    db.exec('BEGIN');
    try {
      for (const r of rows) stmt.run(String(r.id), JSON.stringify(r), at);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { written: rows.length };
  }

  return {
    upsertProducts: rows => bulk(putP, rows),
    upsertCategories: rows => bulk(putC, rows),

    deleteProduct: id => { delP.run(String(id)); },

    /* Called by the daily reconcile. An empty keep-set means the API call that
       produced it failed or returned nothing — obeying it would wipe the whole
       catalogue, so refuse. */
    deleteMissingProducts(keep) {
      if (!keep || !keep.size) throw new Error('refusing to reconcile against an empty keep-set');
      const have = [...idsP.all().map(r => String(r.id))];
      const gone = have.filter(id => !keep.has(id));
      if (!gone.length) return { removed: 0 };
      db.exec('BEGIN');
      try { for (const id of gone) delP.run(id); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return { removed: gone.length };
    },

    allProducts: () => parse(allP.all()),
    allCategories: () => parse(allC.all()),
    productIds: () => new Set(idsP.all().map(r => String(r.id))),

    getState(key) { const r = getS.get(key); if (!r) return null; try { return JSON.parse(r.value_json); } catch { return null; } },
    setState(key, value) { putS.run(key, JSON.stringify(value ?? null), nowISO()); },

    stats() {
      return {
        products: cntP.get().c,
        categories: cntC.get().c,
        lastSync: this.getState('last_sync'),
        lastError: this.getState('last_error'),
      };
    },

    close: () => { try { db.close(); } catch (e) {} },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-store.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/engine/ecwid-store.mjs site/engine/ecwid-store.test.mjs
git commit -m "feat(ecwid): SQLite mirror for products and categories

node:sqlite with WAL and numbered migrations, matching accounts.mjs and
catalog-admin.mjs. The mirror is a cache of someone else's data, so it is
always safe to delete and re-sync.

The one guard that matters: deleteMissingProducts refuses an empty
keep-set. An API call that failed or returned nothing would otherwise
wipe the entire catalogue, and a test asserts the mirror survives it."
```

---

### Task 6: `ecwid-sync.mjs` — pull and reconcile

**Files:**
- Create: `site/engine/ecwid-sync.mjs`
- Test: `site/engine/ecwid-sync.test.mjs`

**Interfaces:**
- Consumes: `openEcwidApi` (Task 2), `toSadkoProduct`/`toSadkoCategory` (Tasks 3–4), `openEcwidStore` (Task 5).
- Produces: `createEcwidSync({ api, store, map })` → object with:
  - `syncCategories()` → `Promise<{ written: number }>`
  - `syncProducts({ updatedFrom })` → `Promise<{ written: number, pages: number }>`
  - `fullReconcile()` → `Promise<{ written: number, removed: number }>`
  - `applyProductEvent({ entityId, eventType })` → `Promise<{ action: 'upserted'|'deleted' }>`
  - `lastSyncedUnix()` → `number | null`

`map` defaults to the real mapper; tests inject it. Every method records `last_sync` on success and `last_error` on failure, and **never throws out of a scheduled call** — failures are recorded, not propagated.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-sync.test.mjs`:

```js
// site/engine/ecwid-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';
import { createEcwidSync } from './ecwid-sync.mjs';

function fresh(api) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-sync-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  const sync = createEcwidSync({ api, store });
  return { store, sync, cleanup: () => { try { store.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}
const E = (id, over = {}) => ({ id, name: 'ثلاجة ' + id, price: 1000 + id, url: 'u' + id,
  description: 'd', sku: 'S' + id, brand: 'b', imageUrl: 'i.webp', inStock: true,
  defaultCategoryId: 38003882, categoryIds: [38003882], ...over });

const stubApi = over => ({
  configured: true,
  listProducts: async () => ({ items: [], total: 0, count: 0 }),
  listCategories: async () => [],
  listAllProductIds: async () => new Set(),
  getProduct: async () => null,
  ...over,
});

test('syncProducts writes mapped products into the mirror', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1), E(2)], total: 2, count: 2 }) }));
  try {
    const r = await sync.syncProducts({});
    assert.equal(r.written, 2);
    const rows = store.allProducts();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title.startsWith('ثلاجة'), true);
  } finally { cleanup(); }
});

test('syncProducts pages until every product is written', async () => {
  let call = 0;
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => {
      call++;
      return call === 1
        ? { items: [E(1), E(2)], total: 3, count: 2 }
        : { items: [E(3)], total: 3, count: 1 };
    } }));
  try {
    const r = await sync.syncProducts({});
    assert.equal(r.written, 3);
    assert.equal(r.pages, 2);
    assert.equal(store.allProducts().length, 3);
  } finally { cleanup(); }
});

test('a successful sync records last_sync and clears last_error', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1)], total: 1, count: 1 }) }));
  try {
    store.setState('last_error', 'stale failure');
    await sync.syncProducts({});
    assert.ok(store.getState('last_sync'));
    assert.equal(store.getState('last_error'), null);
  } finally { cleanup(); }
});

test('a failing sync records last_error and does NOT throw', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => { const e = new Error('ecwid-503: boom'); e.status = 503; throw e; } }));
  try {
    const r = await sync.syncProducts({});
    assert.equal(r.written, 0);
    assert.match(String(store.getState('last_error')), /503/);
  } finally { cleanup(); }
});

test('a failing sync leaves the previously mirrored data in place', async () => {
  let fail = false;
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => { if (fail) throw new Error('down'); return { items: [E(1)], total: 1, count: 1 }; } }));
  try {
    await sync.syncProducts({});
    fail = true;
    await sync.syncProducts({});
    assert.equal(store.allProducts().length, 1, 'last good data must survive an outage');
  } finally { cleanup(); }
});

test('syncCategories writes mapped categories', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listCategories: async () => [{ id: 38003882, name: 'ثلاجات', parentId: 0, enabled: true }] }));
  try {
    await sync.syncCategories();
    assert.equal(store.allCategories()[0].name, 'ثلاجات');
  } finally { cleanup(); }
});

test('fullReconcile removes products Ecwid no longer has', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1), E(3)], total: 2, count: 2 }),
    listAllProductIds: async () => new Set(['1', '3']) }));
  try {
    store.upsertProducts([{ id: '2', title: 'phantom', price: 1, url: '', image: '', description: '',
      categoryId: null, categoryIds: [], brand: '', sku: '', inStock: true, compareToPrice: null }]);
    const r = await sync.fullReconcile();
    assert.equal(r.removed, 1);
    assert.deepEqual(store.allProducts().map(p => p.id).sort(), ['1', '3']);
  } finally { cleanup(); }
});

test('fullReconcile does not empty the mirror when the id listing fails', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1)], total: 1, count: 1 }),
    listAllProductIds: async () => { throw new Error('down'); } }));
  try {
    await sync.syncProducts({});
    const r = await sync.fullReconcile();
    assert.equal(r.removed, 0);
    assert.equal(store.allProducts().length, 1);
  } finally { cleanup(); }
});

/* ---- webhook application: re-fetch, never trust the payload ---- */

test('a product event re-fetches the entity and upserts it', async () => {
  let asked = null;
  const { store, sync, cleanup } = fresh(stubApi({
    getProduct: async id => { asked = id; return E(5, { name: 'اسم جديد' }); } }));
  try {
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(asked, '5');
    assert.equal(r.action, 'upserted');
    assert.equal(store.allProducts()[0].title, 'اسم جديد');
  } finally { cleanup(); }
});

test('applying the same event twice converges to one row', async () => {
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => E(5) }));
  try {
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(store.allProducts().length, 1, 'replays must be harmless');
  } finally { cleanup(); }
});

test('a delete event removes the row', async () => {
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => E(5) }));
  try {
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.deleted' });
    assert.equal(r.action, 'deleted');
    assert.equal(store.allProducts().length, 0);
  } finally { cleanup(); }
});

test('an update event for a product Ecwid 404s deletes it rather than keeping a ghost', async () => {
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => null }));
  try {
    store.upsertProducts([{ id: '5', title: 'ghost', price: 1, url: '', image: '', description: '',
      categoryId: null, categoryIds: [], brand: '', sku: '', inStock: true, compareToPrice: null }]);
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(r.action, 'deleted');
    assert.equal(store.allProducts().length, 0);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-sync.test.mjs`
Expected: FAIL — `Cannot find module './ecwid-sync.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `site/engine/ecwid-sync.mjs`:

```js
/* ============================================================================
   Sync orchestration: pull, reconcile, and apply webhook events.

   Two design rules, both load-bearing:

     • A webhook handler IGNORES the event payload and RE-FETCHES the entity.
       We converge on current state instead of applying a diff, which makes
       replays and out-of-order delivery harmless. Never "optimise" this by
       trusting the payload.
     • Nothing here throws. These methods are called from timers and from a
       public HTTP route; a failure records last_error and returns a zero
       result, leaving the last good mirror in place. The site must never go
       down, or serve an empty catalogue, because Ecwid did.
   ========================================================================== */

import { toSadkoProduct, toSadkoCategory } from './ecwid-map.mjs';

const PAGE = 100;

export function createEcwidSync({ api, store, map = { toSadkoProduct, toSadkoCategory } }) {
  const fail = (where, e) => {
    const msg = `${where}: ${(e && e.message) || e}`;
    try { store.setState('last_error', msg); } catch (x) {}
    console.error('[ecwid] ' + msg);
  };
  const ok = extra => {
    try {
      store.setState('last_sync', { at: new Date().toISOString(), ...extra });
      store.setState('last_error', null);
    } catch (x) {}
  };

  async function syncCategories() {
    try {
      const raw = await api.listCategories();
      const rows = raw.map(map.toSadkoCategory);
      const r = store.upsertCategories(rows);
      ok({ categories: rows.length });
      return r;
    } catch (e) { fail('syncCategories', e); return { written: 0 }; }
  }

  async function syncProducts({ updatedFrom } = {}) {
    let written = 0, pages = 0;
    try {
      for (let offset = 0; ; ) {
        const page = await api.listProducts({ updatedFrom, offset, limit: PAGE });
        const items = (page && page.items) || [];
        pages++;
        if (items.length) {
          store.upsertProducts(items.map(map.toSadkoProduct));
          written += items.length;
        }
        offset += items.length;
        const total = page && page.total != null ? page.total : offset;
        if (!items.length || offset >= total) break;
      }
      ok({ products: written, incremental: updatedFrom != null });
      return { written, pages };
    } catch (e) { fail('syncProducts', e); return { written, pages }; }
  }

  /* Daily. updatedFrom can never report deletions, so the only way to find a
     removed product is to compare the full id set. */
  async function fullReconcile() {
    const { written } = await syncProducts({});
    try {
      const live = await api.listAllProductIds();
      const { removed } = store.deleteMissingProducts(live);
      ok({ products: written, removed, reconcile: true });
      return { written, removed };
    } catch (e) { fail('fullReconcile', e); return { written, removed: 0 }; }
  }

  async function applyProductEvent({ entityId, eventType }) {
    const id = String(entityId);
    try {
      if (/deleted/i.test(String(eventType))) {
        store.deleteProduct(id);
        ok({ event: eventType, id });
        return { action: 'deleted' };
      }
      const live = await api.getProduct(id);
      if (!live) {                          // 404: it is gone, don't keep a ghost
        store.deleteProduct(id);
        ok({ event: eventType, id, gone: true });
        return { action: 'deleted' };
      }
      store.upsertProducts([map.toSadkoProduct(live)]);
      ok({ event: eventType, id });
      return { action: 'upserted' };
    } catch (e) { fail('applyProductEvent ' + id, e); return { action: 'error' }; }
  }

  return {
    syncCategories,
    syncProducts,
    fullReconcile,
    applyProductEvent,
    lastSyncedUnix() {
      const s = store.getState('last_sync');
      if (!s || !s.at) return null;
      const t = Date.parse(s.at);
      return Number.isFinite(t) ? Math.floor(t / 1000) : null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-sync.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/engine/ecwid-sync.mjs site/engine/ecwid-sync.test.mjs
git commit -m "feat(ecwid): sync orchestration — pull, reconcile, apply events

Two rules carry this module. Webhook application ignores the event payload
and re-fetches the entity, so we converge on current state rather than
applying a diff; replays and out-of-order delivery become harmless, and a
test asserts applying one event twice yields one row.

And nothing here throws. These run from timers and a public HTTP route, so
a failure records last_error and returns zero, leaving the last good mirror
serving. Tests cover an outage mid-sync and a failed id listing, both of
which must leave the catalogue intact rather than empty it."
```

---

## Remaining tasks

Tasks 7–10 are in `docs/superpowers/plans/2026-09-15-ecwid-integration-part2.md`; Tasks 11–15 are in `docs/superpowers/plans/2026-09-15-ecwid-integration-part3.md`.

- **Task 7** — wire `mergedCatalog()` to the mirror behind `SADKO_ECWID`, with seed fallback and a diff CLI that shows the 77 additions and 38 removals before any customer sees them
- **Task 8** — `POST /api/ecwid/webhook`: HMAC signature verification with constant-time compare, unsigned rejection, immediate 200, async work
- **Task 9** — rails derived (`offers`/`bestSellers` from Ecwid categories, `featured` from real discounts), and the two honesty-guard assertion blocks rewritten to assert provenance
- **Task 10** — `promos` added to `ADMIN_CONTENT` so banners stay owner-editable
- **Task 11** — `toEcwidOrder` and `toLocalStatus`: payment table that throws on an unknown method, subtotal-only totals, the Arabic fees note
- **Task 12** — `order_push` queue and the idempotent check-then-create push worker
- **Task 13** — `/api/orders` enqueues; `order.updated` webhook maps status back
- **Task 14** — admin becomes a read-only window: sync panel, Ecwid deep links, retry-failed-push
- **Task 15** — ops: `/etc/sadko.env`, webhook registration, rollout runbook, the category-added admin task
