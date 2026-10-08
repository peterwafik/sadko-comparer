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

/* :memory: per test: fast, and nothing left on disk. */
async function fresh({ enabled = true, bannerCategoryId = null } = {}) {
  const store = await openEcwidStore(':memory:');
  const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled, bannerCategoryId });
  return { store, src, cleanup: () => { try { store.close(); } catch (e) {} } };
}

/* ---------------------------- source precedence ------------------------- */

test('with the flag off the seed is served and the mirror is never consulted', async () => {
  const { src, store, cleanup } = await fresh({ enabled: false });
  try {
    await store.upsertProducts([M(1)]);
    assert.deepEqual(await src.catalogBase(), SEED);
    assert.equal(src.activeSource(), 'disabled');
  } finally { cleanup(); }
});

test('with the flag on but an empty mirror, the seed is served', async () => {
  const { src, cleanup } = await fresh();
  try {
    assert.deepEqual(await src.catalogBase(), SEED);
    assert.equal(src.activeSource(), 'seed');
  } finally { cleanup(); }
});

test('once the mirror has rows, the mirror is served', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'ثلاجة 1');
    assert.equal(src.activeSource(), 'ecwid');
  } finally { cleanup(); }
});

test('the mirror is served even when the last sync failed — last good data, not the seed', async () => {
  /* Stale real data beats a months-old snapshot; the failure is surfaced in
     admin instead of silently swapping the catalogue under the customer. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    await store.setState('last_error', 'ecwid-503: boom');
    assert.equal((await src.catalogBase())[0].title, 'ثلاجة 1');
    assert.equal(src.activeSource(), 'ecwid');
  } finally { cleanup(); }
});

test('a broken seed loader with an empty mirror yields an empty list rather than throwing', async () => {
  const store = await openEcwidStore(':memory:');
  try {
    const src = createEcwidSource({ store, seedLoader: async () => { throw new Error('no file'); }, enabled: true });
    assert.deepEqual(await src.catalogBase(), []);
  } finally { store.close(); }
});

/* ------------------------------- filtering ------------------------------ */

test('disabled products never reach the storefront', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1), M(2, { enabled: false })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('incomplete shells never reach the storefront', async () => {
  /* 463 products in the live store have no name, no image and no category.
     Publishing them would put blank cards in front of customers. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1), M(2, { title: '', incomplete: true })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('an out-of-stock product IS served — it is ordered last, not hidden', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { inStock: false })]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1, 'hiding it would understate the range SADKO carries');
    assert.equal(out[0].inStock, false);
  } finally { cleanup(); }
});

/* -------------------------- the banner category ------------------------- */

test('banner entries are excluded from the catalogue entirely', async () => {
  /* Banners live as entries in a dedicated Ecwid category. They are not
     products and must never be purchasable or appear in browse or search. */
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([
      M(1),
      M(2, { categoryId: '999', categoryIds: ['999'] }),
      M(3, { categoryId: '206629517', categoryIds: ['206629517', '999'] }),
    ]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1'],
      'a banner in any of its categories must be excluded');
  } finally { cleanup(); }
});

test('with no banner category configured nothing is excluded on that basis', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: null });
  try {
    await store.upsertProducts([M(1), M(2, { categoryId: '999', categoryIds: ['999'] })]);
    assert.equal((await src.catalogBase()).length, 2);
  } finally { cleanup(); }
});

test('banners() returns the banner entries, and only those', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([M(1), M(2, { categoryId: '999', categoryIds: ['999'], sku: 'hero' })]);
    const b = await src.banners();
    assert.equal(b.length, 1);
    assert.equal(b[0].id, '2');
    assert.equal(b[0].sku, 'hero', 'the SKU carries the slot');
  } finally { cleanup(); }
});

test('banners() is empty when no banner category is configured', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: null });
  try {
    await store.upsertProducts([M(1)]);
    assert.deepEqual(await src.banners(), []);
  } finally { cleanup(); }
});

test('the slot SKU constant is exported so the sync and the storefront agree', async () => {
  assert.ok(Array.isArray(BANNER_CATEGORY_SKU));
  assert.ok(BANNER_CATEGORY_SKU.includes('hero'));
});

/* --------------------------------- order -------------------------------- */

test('in-stock products come before out-of-stock ones', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { inStock: false }), M(2), M(3, { inStock: false }), M(4)]);
    const out = await src.catalogBase();
    assert.deepEqual(out.map(p => p.inStock), [true, true, false, false]);
  } finally { cleanup(); }
});

test('within the same stock state, the original order is preserved', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(10), M(20), M(30)]);
    const ids = (await src.catalogBase()).map(p => p.id);
    assert.deepEqual(ids, ['10', '20', '30']);
  } finally { cleanup(); }
});

/* -------------------------------- describe ------------------------------ */

test('describe reports what the admin panel shows, and never a token', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1), M(2, { inStock: false })]);
    await store.setState('last_error', 'ecwid-403');
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

test('describe works before any catalogue read', async () => {
  const { src, cleanup } = await fresh();
  try {
    const d = src.describe();
    assert.equal(d.products, 0);
    assert.equal(d.source, 'seed');
  } finally { cleanup(); }
});

/* --------------------------------- caching ------------------------------ */

test('a repeated read is served from cache until the mirror changes', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
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

test('activeSource reports ecwid BEFORE any catalogue read', async () => {
  /* The bug this pins: `mode` used to be assigned as a side effect inside
     catalogBase(), so a route checking activeSource() first saw "seed" and
     served the static July file. /data/collections.json did exactly that —
     shipping curated July ids while /data/products.json served Ecwid. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    /* refresh() is what every request runs first; it loads the snapshot, it
       does not build the catalogue, so catalogBase() has still never run. */
    await src.refresh();
    assert.equal(src.activeSource(), 'ecwid', 'the gate must not depend on a prior read');
    assert.equal(src.describe().source, 'ecwid');
  } finally { cleanup(); }
});

test('activeSource still reports seed when the mirror is genuinely empty', async () => {
  const { src, cleanup } = await fresh();
  try { assert.equal(src.activeSource(), 'seed'); } finally { cleanup(); }
});

test('banner entries are found even though they are DISABLED products', async () => {
  /* Banner entries are deliberately disabled in Ecwid so they never appear in
     Ecwid own storefront — the category description tells staff to keep them
     that way. Requiring enabled here would therefore find nothing, ever. */
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([M(2, { categoryId: '999', categoryIds: ['999'], enabled: false, sku: 'hero' })]);
    const b = await src.banners();
    assert.equal(b.length, 1, 'a disabled banner entry must still be readable');
    assert.equal(b[0].sku, 'hero');
  } finally { cleanup(); }
});

test('a disabled banner entry is still kept OUT of the catalogue', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([M(1), M(2, { categoryId: '999', categoryIds: ['999'], enabled: false })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { cleanup(); }
});

test('describe reports served correctly BEFORE any catalogue read', async () => {
  /* Same stale-value trap as activeSource(): `served` used to be captured
     during the last catalogue build, so an admin opening the panel before the
     storefront had been hit saw 0 of 1,453 products served. */
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([
      M(1),                                                    // served
      M(2, { inStock: false }),                                // served, last
      M(3, { enabled: false }),                                // not served
      M(4, { incomplete: true, title: '' }),                   // not served
      M(5, { categoryId: '999', categoryIds: ['999'] }),       // banner, not served
    ]);
    await src.refresh();
    assert.equal(src.describe().served, 2, 'counted fresh, not from a prior build');
  } finally { cleanup(); }
});

test('the served count matches what catalogBase actually returns', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([M(1), M(2, { enabled: false }), M(3, { categoryId: '999', categoryIds: ['999'] })]);
    await src.refresh();
    const n = src.describe().served;
    const list = await src.catalogBase();
    assert.equal(list.length, n, 'the panel must not disagree with the storefront');
  } finally { cleanup(); }
});

/* ---------------- banners without a category (the SKU signal) ----------- */

test('a product whose SKU starts with banner- is a banner, with NO category', async () => {
  /* This signal exists because Ecwid does NOT report a DISABLED category in a
     product's categoryIds — verified against the live store by assigning a
     real product to the disabled banner category and watching the API keep
     reporting only its enabled one. A hidden banner category is therefore
     hidden from us too, so the SKU carries the signal instead and no category
     is needed at all. */
  const { src, store, cleanup } = await fresh({ bannerCategoryId: null });
  try {
    await store.upsertProducts([M(1), M(2, { sku: 'banner-hero' })]);
    const b = await src.banners();
    assert.equal(b.length, 1);
    assert.equal(b[0].id, '2');
  } finally { cleanup(); }
});

test('a banner identified by SKU is kept OUT of the catalogue', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: null });
  try {
    await store.upsertProducts([M(1), M(2, { sku: 'banner-wide' })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1'],
      'a banner must never be purchasable');
  } finally { cleanup(); }
});

test('an ordinary SKU is not mistaken for a banner', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: null });
  try {
    /* Real SKUs in the live store look like 600330254. */
    await store.upsertProducts([M(1, { sku: '600330254' }), M(2, { sku: 'bannerette' })]);
    assert.deepEqual(await src.banners(), []);
    assert.equal((await src.catalogBase()).length, 2);
  } finally { cleanup(); }
});

test('either signal works, and both together do not double-count', async () => {
  const { src, store, cleanup } = await fresh({ bannerCategoryId: '999' });
  try {
    await store.upsertProducts([
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
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { descriptionHtml: '<h2>مواصفات</h2>' })]);
    const out = await src.catalogBase();
    assert.equal(out.length, 1);
    assert.ok(!('descriptionHtml' in out[0]),
      'descriptionHtml is in /data/products.json, which every page loads');
    /* the plain one is still there — cards and search read it */
    assert.equal(out[0].description, 'وصف');
  } finally { cleanup(); }
});

test('productDetail returns the rich description the list withheld', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { descriptionHtml: '<h2>مواصفات</h2><ul><li>أ</li></ul>' })]);
    await src.refresh();
    const d = src.productDetail('1');
    assert.equal(d.id, '1');
    assert.equal(d.descriptionHtml, '<h2>مواصفات</h2><ul><li>أ</li></ul>');
  } finally { cleanup(); }
});

test('productDetail takes a number id as readily as a string', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    await src.refresh();
    assert.ok(src.productDetail(1));
  } finally { cleanup(); }
});

test('productDetail refuses a disabled product', async () => {
  /* Ecwid disabling a product is a withdrawal. Guessing its id must not
     resurrect a page for it. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { enabled: false })]);
    await src.refresh();
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

test('productDetail refuses an incomplete shell', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { incomplete: true })]);
    await src.refresh();
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

test('productDetail refuses a banner entry, so an advert cannot be opened as a product', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { sku: 'banner-hero-1' })]);
    await src.refresh();
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

test('productDetail returns null for an unknown id rather than throwing', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    await src.refresh();
    assert.equal(src.productDetail('nope'), null);
    assert.equal(src.productDetail(null), null);
  } finally { cleanup(); }
});

test('productDetail is null with the flag off — there is no mirror to read', async () => {
  const { src, store, cleanup } = await fresh({ enabled: false });
  try {
    await store.upsertProducts([M(1)]);
    await src.refresh();
    assert.equal(src.productDetail('1'), null);
  } finally { cleanup(); }
});

/* ======================================================================
   An unpriced product is not an offer.

   The near miss this closes: an advert lost its ad-folder assignment in the
   Ecwid panel — the folder is what marks it an advert — so isBanner() stopped
   catching it. It is an enabled product with a name and a price of 0.00, and
   it would have been served as an appliance costing nothing.
   ================================================================== */

test('a product priced at zero is NOT served', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { price: 0 }), M(2, { price: 1500 })]);
    const list = await src.catalogBase();
    assert.deepEqual(list.map(p => p.id), ['2'],
      'a 0.00 product reached the storefront');
  } finally { cleanup(); }
});

test('a product with no price at all is NOT served', async () => {
  /* The mapper nulls a missing price rather than coercing it to 0, so both
     shapes have to be refused. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { price: null }), M(2, { price: 1500 })]);
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['2']);
  } finally { cleanup(); }
});

test('an orphaned advert cannot become a sellable product', async () => {
  /* Exactly the near miss: no ad folder, no banner SKU, enabled, named,
     price 0. Before the price guard this was a purchasable appliance. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([
      M(1, { title: 'إعلان رئيسى ٢', sku: 'contact2', price: 0, categoryIds: [], categoryId: null }),
      M(2, { price: 1500 }),
    ]);
    const list = await src.catalogBase();
    assert.ok(!list.some(p => String(p.id) === '1'), 'the orphaned advert is on sale');
    assert.equal(list.length, 1);
  } finally { cleanup(); }
});

test('the served COUNT agrees with what is served', async () => {
  /* describe() and build() share isServed, so the admin panel cannot report
     a number the storefront disagrees with.

     async/await, not a returned promise: `finally { cleanup() }` runs the
     moment the try block returns, so a promise resolved afterwards found the
     store already closed and describe() reported 0. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1, { price: 0 }), M(2, { price: 1500 }), M(3, { price: 900 })]);
    const list = await src.catalogBase();
    assert.equal(list.length, 2);
    assert.equal(src.describe().served, 2);
  } finally { cleanup(); }
});

test('a normal priced product is unaffected', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1), M(2)]);
    assert.equal((await src.catalogBase()).length, 2);
  } finally { cleanup(); }
});

/* ======================================================================
   Advert destinations are checked against the real catalogue.

   The SKU says where the owner wants the advert to go. Nothing was
   checking that the destination still exists — square advert 3 shipped
   pointing at product:837495061, which had been removed from the store,
   so the advert was a link to a 404.
   ================================================================== */

test('an advert pointing at a product that is served keeps its link', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1), M(77, { sku: 'product:1' })]);
    await src.catalogBase();
    assert.equal(src.adDestinationOf({ sku: 'product:1' }), 'product.html?id=1');
  } finally { cleanup(); }
});

test('an advert pointing at a product that is GONE loses its link', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    await src.catalogBase();
    assert.equal(src.adDestinationOf({ sku: 'product:837495061' }), null,
      'a dead product id must not become an href');
  } finally { cleanup(); }
});

test('a product that is disabled or unpriced is just as dead a destination', async () => {
  /* Both 404 on the product page, so both are broken links. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1), M(2, { enabled: false }), M(3, { price: 0 })]);
    await src.catalogBase();
    assert.equal(src.adDestinationOf({ sku: 'product:2' }), null);
    assert.equal(src.adDestinationOf({ sku: 'product:3' }), null);
    assert.equal(src.adDestinationOf({ sku: 'product:1' }), 'product.html?id=1');
  } finally { cleanup(); }
});

test('a site page destination is not subject to any lookup', async () => {
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    await src.catalogBase();
    assert.equal(src.adDestinationOf({ sku: 'contact' }), 'contact.html');
  } finally { cleanup(); }
});

test('the destination world is rebuilt after invalidate(), not frozen at boot', async () => {
  /* A product added in Ecwid must become a usable destination on the next
     sync rather than at the next restart. */
  const { src, store, cleanup } = await fresh();
  try {
    await store.upsertProducts([M(1)]);
    await src.catalogBase();
    assert.equal(src.adDestinationOf({ sku: 'product:9' }), null);
    await store.upsertProducts([M(9)]);
    src.invalidate();
    await src.refresh();            // the snapshot reloads because invalidate() asked it to
    assert.equal(src.adDestinationOf({ sku: 'product:9' }), 'product.html?id=9');
  } finally { cleanup(); }
});

test('an empty mirror strips no destinations at all', async () => {
  /* A failed read must not silently un-link every advert on the site. */
  const { src, cleanup } = await fresh();
  try {
    assert.equal(src.adDestinationOf({ sku: 'product:837495061' }), 'product.html?id=837495061');
  } finally { cleanup(); }
});

/* ======================================================================
   The in-memory snapshot, and when it is re-read.

   On Vercel each instance holds the catalogue in memory and the mirror is
   a network away. refresh() must cost one small read at most every few
   seconds, reload 1,500 products only when the catalogue version moved,
   and be safe to call from every request at once.
   ================================================================== */

/* Counts the reads that matter, without changing what the store does. */
function counting(store) {
  const n = { meta: 0, products: 0 };
  return {
    n,
    store: {
      ...store,
      catalogMeta: async () => { n.meta++; return store.catalogMeta(); },
      allProducts: async () => { n.products++; return store.allProducts(); },
    },
  };
}

test('before the first refresh every accessor reads as an empty mirror', async () => {
  const store = await openEcwidStore(':memory:');
  try {
    await store.upsertProducts([M(1)]);
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    assert.equal(src.activeSource(), 'seed');
    assert.equal(src.productDetail('1'), null);
    assert.equal(src.describe().products, 0);
    assert.equal(src.describe().served, 0);
    assert.equal(src.storedAdFolders(), undefined, 'nothing loaded: let the sync use its own copy');
    await src.refresh();
    assert.equal(src.activeSource(), 'ecwid');
    assert.ok(src.productDetail('1'));
  } finally { store.close(); }
});

test('refresh reloads the catalogue only when the version changed', async () => {
  const real = await openEcwidStore(':memory:');
  try {
    await real.upsertProducts([M(1)]);
    const { n, store } = counting(real);
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    assert.equal(await src.refresh({ maxAgeMs: 0 }), true, 'first refresh loads');
    assert.equal(n.products, 1);
    assert.equal(await src.refresh({ maxAgeMs: 0 }), false, 'same version: nothing to reload');
    assert.equal(await src.refresh({ maxAgeMs: 0 }), false);
    assert.equal(n.products, 1, 'the products were re-read although nothing changed');
    assert.equal(n.meta, 3, 'but the version is checked every time maxAgeMs allows');
    await real.setState('last_sync', { at: 'now' });                 // not a catalogue write
    assert.equal(await src.refresh({ maxAgeMs: 0 }), false);
    await real.upsertProducts([M(2)]);                               // a catalogue write
    assert.equal(await src.refresh({ maxAgeMs: 0 }), true);
    assert.equal(n.products, 2);
    assert.ok(src.productDetail('2'), 'the new product is served after the reload');
  } finally { real.close(); }
});

test('a write made by ANOTHER instance shows up here without invalidate()', async () => {
  /* Two sources over one database: the version is the only signal. */
  const store = await openEcwidStore(':memory:');
  try {
    const here = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    await store.upsertProducts([M(1)]);
    assert.deepEqual((await here.catalogBase()).map(p => p.id), ['1']);
    await store.upsertProducts([M(2)]);                              // "the other instance"
    await here.refresh({ maxAgeMs: 0 });
    assert.deepEqual((await here.catalogBase()).map(p => p.id).sort(), ['1', '2'],
      'the built catalogue must be dropped when the snapshot reloads');
    await store.deleteProduct('1');
    await here.refresh({ maxAgeMs: 0 });
    assert.equal(here.productDetail('1'), null, 'a product deleted elsewhere must stop being served');
  } finally { store.close(); }
});

test('within maxAgeMs refresh does not touch the database at all', async () => {
  const real = await openEcwidStore(':memory:');
  try {
    const { n, store } = counting(real);
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    await src.refresh({ maxAgeMs: 60_000 });
    for (let i = 0; i < 20; i++) await src.refresh({ maxAgeMs: 60_000 });
    assert.equal(n.meta, 1, 'every request would pay a round trip');
  } finally { real.close(); }
});

test('concurrent refreshes share ONE read', async () => {
  const real = await openEcwidStore(':memory:');
  try {
    await real.upsertProducts([M(1)]);
    const { n, store } = counting(real);
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    const all = await Promise.all(Array.from({ length: 10 }, () => src.refresh({ maxAgeMs: 0 })));
    assert.equal(n.meta, 1);
    assert.equal(n.products, 1);
    assert.deepEqual(all, Array(10).fill(true), 'every caller sees the one load');
  } finally { real.close(); }
});

test('invalidate() forces a reload even when the version did not move', async () => {
  const real = await openEcwidStore(':memory:');
  try {
    await real.upsertProducts([M(1)]);
    const { n, store } = counting(real);
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    await src.refresh({ maxAgeMs: 60_000 });
    src.invalidate();
    assert.equal(await src.refresh({ maxAgeMs: 60_000 }), true, 'invalidate must defeat maxAgeMs and the version check');
    assert.equal(n.products, 2);
  } finally { real.close(); }
});

test('a failed refresh keeps the last good snapshot and never rejects', async () => {
  const real = await openEcwidStore(':memory:');
  try {
    await real.upsertProducts([M(1)]);
    let broken = false;
    const store = { ...real,
      catalogMeta: async () => { if (broken) throw new Error('turso down'); return real.catalogMeta(); } };
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    await src.refresh({ maxAgeMs: 0 });
    broken = true;
    assert.equal(await src.refresh({ maxAgeMs: 0 }), false);
    assert.equal(src.activeSource(), 'ecwid', 'an outage must not swap the catalogue for the seed');
    assert.deepEqual((await src.catalogBase()).map(p => p.id), ['1']);
  } finally { real.close(); }
});

test('the flag off never reads the mirror, refresh included', async () => {
  const real = await openEcwidStore(':memory:');
  try {
    const { n, store } = counting(real);
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: false });
    assert.equal(await src.refresh(), false);
    await src.catalogBase();
    assert.equal(n.meta + n.products, 0);
  } finally { real.close(); }
});

test('describe reports the status the last version check read', async () => {
  const store = await openEcwidStore(':memory:');
  try {
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    await store.upsertProducts([M(1), M(2, { inStock: false })]);
    await store.setState('last_error', 'ecwid-503');
    await store.upsertPaymentMethods([{ id: 'cod', title: 'COD', enabled: true, order: 1 }]);
    await src.refresh();
    const d = src.describe();
    assert.equal(d.lastError, 'ecwid-503');
    assert.equal(d.paymentMethods, 1);
    const s = await store.stats();
    for (const k of ['products', 'categories', 'outOfStock', 'buyable', 'incomplete', 'discounted'])
      assert.equal(d[k], s[k], k + ' counted over the snapshot must match stats() in SQL');
  } finally { store.close(); }
});

test('the stored ad-folder state comes with the snapshot', async () => {
  const store = await openEcwidStore(':memory:');
  try {
    const src = createEcwidSource({ store, seedLoader: async () => SEED, enabled: true });
    await src.refresh();
    assert.equal(src.storedAdFolders(), null);
    await store.setState('ad_folders', { contents: { '500': ['7'] } });
    await src.refresh({ maxAgeMs: 0 });
    assert.deepEqual(src.storedAdFolders(), { contents: { '500': ['7'] } },
      'an ad-folder write must move the version so other instances pick it up');
  } finally { store.close(); }
});
