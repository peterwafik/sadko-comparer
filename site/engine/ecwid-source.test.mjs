// site/engine/ecwid-source.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';
import { createEcwidSource, BANNER_CATEGORY_SKU } from './ecwid-source.mjs';

const SEED = [{ id: 's1', title: 'من الملف', price: 100, url: '', image: '', description: '', categoryId: 'c' }];

const M = (id, over = {}) => ({
  id: String(id), url: 'u' + id, title: 'ثلاجة ' + id, image: 'i.webp', images: ['i.webp'],
  price: 1000 + Number(id), description: 'وصف', categoryId: '206629517',
  categoryIds: ['206629517'], brand: '', sku: 'S' + id, inStock: true,
  stockTracked: true, quantity: 5, compareToPrice: null, discountPercent: null,
  shippingRequired: true, weight: null, enabled: true, incomplete: false, ...over,
});

function fresh({ enabled = true, bannerCategoryId = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-src-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled, bannerCategoryId });
  return { store, src, cleanup: () => { try { store.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}

/* ---------------------------- source precedence ------------------------- */

test('with the flag off the seed is served and the mirror is never consulted', async () => {
  const { src, store, cleanup } = fresh({ enabled: false });
  try {
    store.upsertProducts([M(1)]);
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
    store.upsertProducts([M(1)]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'ثلاجة 1');
    assert.equal(src.activeSource(), 'ecwid');
  } finally { cleanup(); }
});

test('the mirror is served even when the last sync failed — last good data, not the seed', async () => {
  /* Stale real data beats a months-old snapshot; the failure is surfaced in
     admin instead of silently swapping the catalogue under the customer. */
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1)]);
    store.setState('last_error', 'ecwid-503: boom');
    assert.equal((await src.catalogBase())[0].title, 'ثلاجة 1');
    assert.equal(src.activeSource(), 'ecwid');
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

/* ------------------------------- filtering ------------------------------ */

test('disabled products never reach the storefront', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1), M(2, { enabled: false })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('incomplete shells never reach the storefront', async () => {
  /* 463 products in the live store have no name, no image and no category.
     Publishing them would put blank cards in front of customers. */
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1), M(2, { title: '', incomplete: true })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('an out-of-stock product IS served — it is ordered last, not hidden', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { inStock: false })]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1, 'hiding it would understate the range SADKO carries');
    assert.equal(out[0].inStock, false);
  } finally { cleanup(); }
});

/* -------------------------- the banner category ------------------------- */

test('banner entries are excluded from the catalogue entirely', async () => {
  /* Banners live as entries in a dedicated Ecwid category. They are not
     products and must never be purchasable or appear in browse or search. */
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([
      M(1),
      M(2, { categoryId: '999', categoryIds: ['999'] }),
      M(3, { categoryId: '206629517', categoryIds: ['206629517', '999'] }),
    ]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1'],
      'a banner in any of its categories must be excluded');
  } finally { cleanup(); }
});

test('with no banner category configured nothing is excluded on that basis', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: null });
  try {
    store.upsertProducts([M(1), M(2, { categoryId: '999', categoryIds: ['999'] })]);
    assert.equal((await src.catalogBase()).length, 2);
  } finally { cleanup(); }
});

test('banners() returns the banner entries, and only those', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([M(1), M(2, { categoryId: '999', categoryIds: ['999'], sku: 'hero' })]);
    const b = await src.banners();
    assert.equal(b.length, 1);
    assert.equal(b[0].id, '2');
    assert.equal(b[0].sku, 'hero', 'the SKU carries the slot');
  } finally { cleanup(); }
});

test('banners() is empty when no banner category is configured', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: null });
  try {
    store.upsertProducts([M(1)]);
    assert.deepEqual(await src.banners(), []);
  } finally { cleanup(); }
});

test('the slot SKU constant is exported so the sync and the storefront agree', () => {
  assert.ok(Array.isArray(BANNER_CATEGORY_SKU));
  assert.ok(BANNER_CATEGORY_SKU.includes('hero'));
});

/* --------------------------------- order -------------------------------- */

test('in-stock products come before out-of-stock ones', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { inStock: false }), M(2), M(3, { inStock: false }), M(4)]);
    const out = await src.catalogBase();
    assert.deepEqual(out.map(p => p.inStock), [true, true, false, false]);
  } finally { cleanup(); }
});

test('within the same stock state, the original order is preserved', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(10), M(20), M(30)]);
    const ids = (await src.catalogBase()).map(p => p.id);
    assert.deepEqual(ids, ['10', '20', '30']);
  } finally { cleanup(); }
});

/* -------------------------------- describe ------------------------------ */

test('describe reports what the admin panel shows, and never a token', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1), M(2, { inStock: false })]);
    store.setState('last_error', 'ecwid-403');
    await src.catalogBase();
    const d = src.describe();
    assert.equal(d.enabled, true);
    assert.equal(d.source, 'ecwid');
    assert.equal(d.products, 2);
    assert.equal(d.served, 2);
    assert.equal(d.outOfStock, 1);
    assert.equal(d.lastError, 'ecwid-403');
    assert.ok(!/token/i.test(JSON.stringify(d)), 'describe must not mention a token at all');
  } finally { cleanup(); }
});

test('describe works before any catalogue read', () => {
  const { src, cleanup } = fresh();
  try {
    const d = src.describe();
    assert.equal(d.products, 0);
    assert.equal(d.source, 'seed');
  } finally { cleanup(); }
});

/* --------------------------------- caching ------------------------------ */

test('a repeated read is served from cache until the mirror changes', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1)]);
    const a = await src.catalogBase();
    const b = await src.catalogBase();
    assert.equal(a, b, 'the same array instance should come back');
    src.invalidate();
    const c = await src.catalogBase();
    assert.notEqual(a, c, 'after invalidate the catalogue is rebuilt');
    assert.deepEqual(c.map(p => p.id), ['1']);
  } finally { cleanup(); }
});

/* ------------------------- regression: the gate -------------------------- */

test('activeSource reports ecwid BEFORE any catalogue read', () => {
  /* The bug this pins: `mode` used to be assigned as a side effect inside
     catalogBase(), so a route checking activeSource() first saw "seed" and
     served the static July file. /data/collections.json did exactly that —
     shipping curated July ids while /data/products.json served Ecwid. */
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1)]);
    assert.equal(src.activeSource(), 'ecwid', 'the gate must not depend on a prior read');
    assert.equal(src.describe().source, 'ecwid');
  } finally { cleanup(); }
});

test('activeSource still reports seed when the mirror is genuinely empty', () => {
  const { src, cleanup } = fresh();
  try { assert.equal(src.activeSource(), 'seed'); } finally { cleanup(); }
});

test('banner entries are found even though they are DISABLED products', async () => {
  /* Banner entries are deliberately disabled in Ecwid so they never appear in
     Ecwid own storefront — the category description tells staff to keep them
     that way. Requiring enabled here would therefore find nothing, ever. */
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([M(2, { categoryId: '999', categoryIds: ['999'], enabled: false, sku: 'hero' })]);
    const b = await src.banners();
    assert.equal(b.length, 1, 'a disabled banner entry must still be readable');
    assert.equal(b[0].sku, 'hero');
  } finally { cleanup(); }
});

test('a disabled banner entry is still kept OUT of the catalogue', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([M(1), M(2, { categoryId: '999', categoryIds: ['999'], enabled: false })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('describe reports served correctly BEFORE any catalogue read', () => {
  /* Same stale-value trap as activeSource(): `served` used to be captured
     during the last catalogue build, so an admin opening the panel before the
     storefront had been hit saw 0 of 1,453 products served. */
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([
      M(1),                                                    // served
      M(2, { inStock: false }),                                // served, last
      M(3, { enabled: false }),                                // not served
      M(4, { incomplete: true, title: '' }),                   // not served
      M(5, { categoryId: '999', categoryIds: ['999'] }),       // banner, not served
    ]);
    assert.equal(src.describe().served, 2, 'counted fresh, not from a prior build');
  } finally { cleanup(); }
});

test('the served count matches what catalogBase actually returns', () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([M(1), M(2, { enabled: false }), M(3, { categoryId: '999', categoryIds: ['999'] })]);
    const n = src.describe().served;
    return src.catalogBase().then(list => {
      assert.equal(list.length, n, 'the panel must not disagree with the storefront');
    }).finally(cleanup);
  } catch (e) { cleanup(); throw e; }
});

/* ---------------- banners without a category (the SKU signal) ----------- */

test('a product whose SKU starts with banner- is a banner, with NO category', async () => {
  /* This signal exists because Ecwid does NOT report a DISABLED category in a
     product's categoryIds — verified against the live store by assigning a
     real product to the disabled banner category and watching the API keep
     reporting only its enabled one. A hidden banner category is therefore
     hidden from us too, so the SKU carries the signal instead and no category
     is needed at all. */
  const { src, store, cleanup } = fresh({ bannerCategoryId: null });
  try {
    store.upsertProducts([M(1), M(2, { sku: 'banner-hero' })]);
    const b = await src.banners();
    assert.equal(b.length, 1);
    assert.equal(b[0].id, '2');
  } finally { cleanup(); }
});

test('a banner identified by SKU is kept OUT of the catalogue', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: null });
  try {
    store.upsertProducts([M(1), M(2, { sku: 'banner-wide' })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1'],
      'a banner must never be purchasable');
  } finally { cleanup(); }
});

test('an ordinary SKU is not mistaken for a banner', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: null });
  try {
    /* Real SKUs in the live store look like 600330254. */
    store.upsertProducts([M(1, { sku: '600330254' }), M(2, { sku: 'bannerette' })]);
    assert.deepEqual(await src.banners(), []);
    assert.equal((await src.catalogBase()).length, 2);
  } finally { cleanup(); }
});

test('either signal works, and both together do not double-count', async () => {
  const { src, store, cleanup } = fresh({ bannerCategoryId: '999' });
  try {
    store.upsertProducts([
      M(1),
      M(2, { categoryId: '999', categoryIds: ['999'] }),   // by category
      M(3, { sku: 'banner-square' }),                      // by SKU
      M(4, { categoryId: '999', categoryIds: ['999'], sku: 'banner-hero' }),  // both
    ]);
    const b = await src.banners();
    assert.deepEqual(b.map(p => p.id).sort(), ['2', '3', '4']);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('the slot helper reads both the bare and the prefixed SKU form', async () => {
  const { bannerSlotOf, BANNER_SKU_PREFIX } = await import('./ecwid-source.mjs');
  assert.equal(BANNER_SKU_PREFIX, 'banner-');
  assert.equal(bannerSlotOf({ sku: 'banner-hero' }), 'hero');
  assert.equal(bannerSlotOf({ sku: 'hero' }), 'hero');
  assert.equal(bannerSlotOf({ sku: 'banner-nonsense' }), 'square');
  assert.equal(bannerSlotOf({ sku: '' }), 'square');
  assert.equal(bannerSlotOf({}), 'square');
});


/* ======================================================================
   The product page's own read.

   The rich description belongs to ONE page, so it must not ride along in the
   list every other page fetches — and the detail read must not become a way
   to reach a product the storefront refuses to serve.
   ================================================================== */

test('the list drops descriptionHtml — it must not ship to every page', async () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { descriptionHtml: '<h2>مواصفات</h2>' })]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1);
    assert.ok(!('descriptionHtml' in out[0]),
      'descriptionHtml is in /data/products.json, which every page loads');
    /* the plain one is still there — cards and search read it */
    assert.equal(out[0].description, 'وصف');
  } finally { cleanup(); }
});

test('productDetail returns the rich description the list withheld', () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { descriptionHtml: '<h2>مواصفات</h2><ul><li>أ</li></ul>' })]);
    const d = src.productDetail('1');
    assert.equal(d.id, '1');
    assert.equal(d.descriptionHtml, '<h2>مواصفات</h2><ul><li>أ</li></ul>');
  } finally { cleanup(); }
});

test('productDetail takes a number id as readily as a string', () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1)]);
    assert.ok(src.productDetail(1));
  } finally { cleanup(); }
});

test('productDetail refuses a disabled product', () => {
  /* Ecwid disabling a product is a withdrawal. Guessing its id must not
     resurrect a page for it. */
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { enabled: false })]);
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

test('productDetail refuses an incomplete shell', () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { incomplete: true })]);
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

test('productDetail refuses a banner entry, so an advert cannot be opened as a product', () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1, { sku: 'banner-hero-1' })]);
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

test('productDetail returns null for an unknown id rather than throwing', () => {
  const { src, store, cleanup } = fresh();
  try {
    store.upsertProducts([M(1)]);
    assert.equal(src.productDetail('nope'), null);
    assert.equal(src.productDetail(null), null);
  } finally { cleanup(); }
});

test('productDetail is null with the flag off — there is no mirror to read', () => {
  const { src, store, cleanup } = fresh({ enabled: false });
  try {
    store.upsertProducts([M(1)]);
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});
