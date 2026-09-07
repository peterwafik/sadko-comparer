// site/engine/serve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';
import { rankOffers, mergeLiveRows } from './serve.mjs';
import { identify } from './matcher.mjs';
import { CATEGORIES } from './categories.mjs';

function seeded() {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 41000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2',
    title: 'شاشة شارب 4K سمارت 75 بوصة 4T-C75FN6EX', price: 39699 });
  c.upsertOffer({ domain: 'c.com', url: 'https://c.com/3',
    title: 'شاشة شارب 65 بوصة 4K سمارت 4T-C65FN6EX', price: 28000 });
  return c;
}

test('ranks cheapest first and never crowns a different-size TV', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K', { verify: async () => null });
  assert.equal(r.cheapest.price, 39699, 'the 65-inch at 28000 must not win');
  assert.equal(r.cheapest.domain, 'b.com');
  c.close();
});

test('live verification overrides the indexed price', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K',
    { verify: async o => (o.domain === 'b.com' ? 45000 : null) });
  const b = r.results.find(x => x.domain === 'b.com');
  assert.equal(b.price, 45000);
  assert.equal(b.verified, true);
  assert.equal(r.cheapest.domain, 'a.com', 're-verification must re-order the ranking');
  c.close();
});

test('unverified offers are still returned, marked unverified', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شارب', { verify: async () => null, verifyTop: 0 });
  assert.ok(r.results.length >= 3);
  assert.ok(r.results.every(x => x.verified === false));
  c.close();
});

test('an empty query returns no results rather than throwing', async () => {
  const c = seeded();
  const r = await rankOffers(c, '', { verify: async () => null });
  assert.deepEqual(r.results, []);
  assert.equal(r.cheapest, null);
  c.close();
});

test('a terse cheaper listing that never states the size is not crowned over the genuine sized listing', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'cheap.com', url: 'https://cheap.com/1',
    title: 'شاشة شارب سمارت', price: 9000 });
  c.upsertOffer({ domain: 'real.com', url: 'https://real.com/2',
    title: 'شاشة شارب 75 بوصة 4K سمارت', price: 39699 });
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  assert.equal(r.cheapest.price, 39699, 'the terse 9000 listing must not be crowned');
  assert.equal(r.cheapest.domain, 'real.com');
  const terse = r.results.find(x => x.domain === 'cheap.com');
  assert.ok(terse, 'the terse listing must still be visible in results');
  assert.equal(terse.confidence, 'weak');
  assert.notEqual(terse.rank, 1);
  c.close();
});

test('a query that omits a spec the offer states still crowns that offer as strong', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 39699 });
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K', { verify: async () => null });
  assert.equal(r.cheapest && r.cheapest.price, 39699);
  assert.equal(r.cheapest.confidence, 'strong');
  c.close();
});

test('a size contradiction is excluded entirely, not merely deprioritized', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'شاشة شارب 65 بوصة 4K سمارت', price: 28000 });
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة', { verify: async () => null });
  assert.ok(!r.results.some(x => x.price === 28000), 'the 65-inch offer must not appear at all');
  c.close();
});

test('weak offers are returned in results but never take rank 1', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'cheap.com', url: 'https://cheap.com/1',
    title: 'شاشة شارب سمارت', price: 5000 });
  c.upsertOffer({ domain: 'cheap2.com', url: 'https://cheap2.com/2',
    title: 'شاشة شارب سمارت', price: 7000 });
  c.upsertOffer({ domain: 'real.com', url: 'https://real.com/3',
    title: 'شاشة شارب 75 بوصة 4K سمارت', price: 39699 });
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  const weakOnes = r.results.filter(x => x.confidence === 'weak');
  assert.equal(weakOnes.length, 2, 'both terse listings must be weak, not strong');
  assert.ok(weakOnes.every(x => x.rank === undefined), 'weak results must not receive any rank');
  assert.equal(r.cheapest.domain, 'real.com');
  c.close();
});

test('rankOffers reports how it interpreted the query', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'غسالة توشيبا 7 كيلو اتوماتيك فتحة علوية', price: 11000 });
  const r = await rankOffers(c, 'غسالة توشيبا 7 كيلو', { verify: async () => null });
  assert.equal(r.interpretation.category, 'washer');
  assert.equal(r.interpretation.brand, 'toshiba');
  assert.equal(r.interpretation.units.kg, 7);
  assert.equal(r.interpretation.ambiguous, false);
  c.close();
});

test('an unrecognised category is reported ambiguous with alternatives', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'كبة فريش 400 وات 1.5 لتر', price: 2200 });
  const r = await rankOffers(c, 'كبة فريش 400 وات', { verify: async () => null });
  assert.equal(r.interpretation.ambiguous, true);
  assert.ok(Array.isArray(r.interpretation.alternatives));
  c.close();
});

test('a category override is applied as a hard filter', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'غسالة توشيبا 7 كيلو اتوماتيك', price: 11000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2',
    title: 'غسالة اطباق بوش 12 فرد', price: 18000 });
  const r = await rankOffers(c, 'غسالة', {
    verify: async () => null, override: { category: 'dishwasher' } });
  assert.equal(r.interpretation.category, 'dishwasher');
  assert.ok(r.results.every(x => !x.title.includes('7 كيلو')),
    'washer offers must be filtered out when the shopper says dishwasher');
  c.close();
});

// CRITICAL 1 (M1 final review): FTS5's search() truncates by TEXT RELEVANCE
// before price ever enters the picture. Seed more offers of the SAME product
// (same explicit model number -> same product_id) than the FTS candidate
// limit, padding the genuinely cheaper one with filler text so it scores
// worse on relevance and falls outside the truncated candidate set. The
// production default limit stays 200 (see serve.mjs); this test lowers it via
// opts.limit purely so seeding stays fast while still exercising a real
// FTS-rank truncation (only `decoyCount` offers make it into the initial FTS
// candidates — the genuine cheap offer must still be found via its shared
// product_id, not merely be present in that first batch).
test('CRITICAL 1: a genuinely cheaper offer of the same product survives FTS-rank truncation', async () => {
  const c = openCatalog();
  const decoyCount = 5;
  for (let i = 0; i < decoyCount; i++) {
    c.upsertOffer({ domain: `decoy${i}.com`, url: `https://decoy${i}.com/p`,
      title: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 20000 + i * 100 });
  }
  // same model number -> same product_id as the decoys above, but padded
  // with filler so FTS ranks it below all `decoyCount` decoys on relevance
  const filler = Array(80).fill('حشو نص اضافى').join(' ');
  c.upsertOffer({ domain: 'genuine.com', url: 'https://genuine.com/p',
    title: `شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX ${filler}`, price: 5000 });

  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K', { verify: async () => null, limit: decoyCount });
  assert.equal(r.cheapest && r.cheapest.price, 5000,
    'a genuinely cheaper offer of an already-matched product must not be discarded by FTS-rank truncation');
  assert.equal(r.cheapest.domain, 'genuine.com');
  c.close();
});

// CRITICAL 2 (M1 final review): a "verified" price from a re-fetched page can
// be wildly wrong (e.g. the first JSON-LD Product on the page is a related
// carousel item, not the offer itself). A real price correction is a small
// delta; a ~95% "drop" must be rejected outright, keeping the trustworthy
// indexed price rather than re-crowning on a parsing error.
test('CRITICAL 2: an implausible verified price (~95% below indexed) is ignored', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K',
    { verify: async o => (o.domain === 'b.com' ? 1985 : null) }); // indexed 39699 -> ~95% below
  const b = r.results.find(x => x.domain === 'b.com');
  assert.equal(b.price, 39699, 'an implausible verified price must be rejected, keeping the indexed price');
  assert.equal(b.verified, false, 'a rejected verification must not be marked verified');
  assert.equal(r.cheapest.domain, 'b.com', 'the indexed price still legitimately wins the ranking');
  c.close();
});

// CRITICAL 3 (M1 final review): in_stock was selected by catalog.search but
// never read anywhere, so an unbuyable offer could be crowned "cheapest".
test('CRITICAL 3: an out-of-stock cheaper offer is shown but never crowned', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'cheap.com', url: 'https://cheap.com/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت', price: 30000, inStock: false });
  c.upsertOffer({ domain: 'real.com', url: 'https://real.com/2',
    title: 'شاشة شارب 75 بوصة 4K سمارت', price: 39699, inStock: true });
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  const oos = r.results.find(x => x.domain === 'cheap.com');
  assert.ok(oos, 'the out-of-stock offer must still appear in results');
  assert.equal(oos.inStock, false);
  assert.notEqual(oos.rank, 1, 'an out-of-stock offer must never be rank 1');
  assert.equal(r.cheapest.domain, 'real.com', 'the in-stock dearer offer must be crowned instead');
  c.close();
});

// Part 1 (browse fix): a bare category query — no brand, no model — used to
// fall through sameProduct's "insufficient identity" rule and return nothing,
// even when the catalog holds many offers of that category. It's a browse,
// not an identity match: return everything in the category, price-ascending,
// weak confidence, crowning nothing.
test('a bare category query browses every offer in that category, price-ascending, all weak, nothing crowned', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 8 كيلو اتوماتيك', price: 12000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة بوش 7 كيلو فتحة علوية', price: 9000 });
  c.upsertOffer({ domain: 'c.com', url: 'https://c.com/3', title: 'غسالة سامسونج 9 كيلو', price: 15000 });
  const r = await rankOffers(c, 'غسالة', { verify: async () => null });
  assert.equal(r.results.length, 3, 'all three washer offers must be returned');
  assert.deepEqual(r.results.map(x => x.price), [9000, 12000, 15000], 'must be price-ascending');
  assert.ok(r.results.every(x => x.confidence === 'weak'), 'a browse match is never strong/exact');
  assert.equal(r.cheapest, null, 'a browse query crowns nothing');
  assert.ok(r.results.every(x => x.rank !== 1), 'no result may carry rank 1 on a browse');
  c.close();
});

test('a bare category query with a stated unit excludes offers that state a different value for it', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 8 كيلو اتوماتيك', price: 12000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة بوش 10 كيلو فتحة علوية', price: 20000 });
  c.upsertOffer({ domain: 'c.com', url: 'https://c.com/3', title: 'غسالة سامسونج اتوماتيك', price: 15000 }); // kg unstated
  const r = await rankOffers(c, 'غسالة 8 كيلو', { verify: async () => null });
  const prices = r.results.map(x => x.price).sort((a, b) => a - b);
  assert.deepEqual(prices, [12000, 15000], 'the explicit 10kg offer must be excluded; the kg-unstated offer must stay');
  assert.equal(r.cheapest, null);
  c.close();
});

// Regression guard: a query WITH a brand must still go through sameProduct
// unchanged — identity matching and crowning must not be weakened by the
// browse path.
test('a category query WITH a brand still crowns via sameProduct, unaffected by the browse path', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', price: 12079 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة بوش 8 كيلو اتوماتيك', price: 9000 });
  const r = await rankOffers(c, 'غسالة توشيبا 8 كيلو', { verify: async () => null });
  assert.ok(r.cheapest, 'a brand-qualified query must still crown a result');
  assert.equal(r.cheapest.domain, 'a.com');
  assert.equal(r.cheapest.price, 12079);
  assert.ok(!r.results.some(x => x.domain === 'b.com'), 'the different-brand offer must not appear at all');
  c.close();
});

test('a bare category with no matching offers in the catalog returns an empty result set without throwing', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'شاشة شارب 75 بوصة 4K سمارت', price: 39699 });
  const r = await rankOffers(c, 'ثلاجة', { verify: async () => null });
  assert.deepEqual(r.results, []);
  assert.equal(r.cheapest, null);
  c.close();
});

// ===== Garbage-match review (product owner search for a real, uncatalogued
// TV returned 20 irrelevant results sharing only generic words) =====

// CRITICAL 2: ftsQuery() ORs every term together, so a five-word query
// matched any offer sharing just one common word. Seeded with the actual
// garbage titles from the bug report.
test('CRITICAL 2: a query overlapping an offer only on generic words does not match it (real garbage from bug report)', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'jumia.com.eg', url: 'https://jumia.com.eg/p/124',
    title: 'Full Cover Tempered Glass for Samsung Galaxy M33', price: 124 });
  c.upsertOffer({ domain: '2b.com.eg', url: 'https://2b.com.eg/p/429',
    title: 'DEVIA EC317 Smart Series PD Cable 100W Type-C', price: 429 });
  c.upsertOffer({ domain: '2b.com.eg', url: 'https://2b.com.eg/p/649',
    title: 'D-Link N300 Smart Router - R04', price: 649 });
  c.upsertOffer({ domain: '2b.com.eg', url: 'https://2b.com.eg/p/749',
    title: 'Devia Smart Series Multi-function Folding Stand', price: 749 });
  c.upsertOffer({ domain: '2b.com.eg', url: 'https://2b.com.eg/p/7199',
    title: 'HP Smart Tank 582 All-in-One Printer', price: 7199 });

  const r = await rankOffers(c, 'Arion 43-Inch Full HD Smart', { verify: async () => null });
  assert.equal(r.results.length, 0,
    'none of these — sharing only "Full"/"Smart"/"HD" with the query — should be returned');
  assert.equal(r.cheapest, null);
  c.close();
});

// CRITICAL 1: the signal a caller (compare-server.mjs) uses to decide whether
// the catalog produced something genuinely useful. Chosen signals: a
// `confident` boolean (true only when a crownable exact/strong result was
// actually crowned) and a `browse` boolean (true only for the intentional
// bare-category browse path, where cheapest is null by design but the answer
// is still legitimate). Both default false on the early-exit/no-match paths.
test('CRITICAL 1 signal: only-weak non-browse results are marked not confident, so a caller can fall through', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'terse.com', url: 'https://terse.com/1', title: 'شاشة شارب سمارت', price: 9000 });
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  assert.ok(r.results.length > 0, 'the terse listing is still shown, price-sorted, as weak');
  assert.equal(r.cheapest, null, 'nothing crowned');
  assert.equal(r.confident, false, 'only-weak results must not read as confident');
  assert.equal(r.browse, false, 'this is not a browse query');
  c.close();
});

test('CRITICAL 1 signal: a genuine exact/strong match IS confident, and a bare-category browse IS browse', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'real.com', url: 'https://real.com/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت', price: 39699 });
  const identified = await rankOffers(c, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  assert.ok(identified.cheapest, 'sanity: this query crowns');
  assert.equal(identified.confident, true);
  assert.equal(identified.browse, false);

  const c2 = openCatalog();
  c2.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 8 كيلو', price: 12000 });
  const browsed = await rankOffers(c2, 'غسالة', { verify: async () => null });
  assert.equal(browsed.cheapest, null, 'sanity: a browse crowns nothing');
  assert.equal(browsed.browse, true);
  assert.equal(browsed.confident, true, 'a legitimate browse still counts as a confident catalog answer');
  c.close(); c2.close();
});

// Item 3: the server's catalog branch (compare-server.mjs `compare()`) uses
// exactly `r.results.length && (r.browse || r.confident)` to decide whether
// to answer from the catalog or fall through to the live fan-out.
// compare-server.mjs starts an HTTP server at module load and exports only
// { ADAPTERS, searchStore, loadRegistry, isRelevant, fetchPage, jsonLdProducts,
// htmlHarvest } (exports intentionally left unchanged), so `compare()` itself
// is not reachable from a test without importing the whole server module.
// Testing directly at the server level is therefore impractical; this
// reproduces the server's exact branch condition against rankOffers()
// output, which is the documented, tested contract compare-server.mjs relies on.
test('server fall-through condition: catalog answers only when confident or browsing, else falls through to live', async () => {
  const answersFromCatalog = r => r.results.length && (r.browse || r.confident);

  const weakOnlyCatalog = openCatalog();
  weakOnlyCatalog.upsertOffer({ domain: 'terse.com', url: 'https://terse.com/1',
    title: 'شاشة شارب سمارت', price: 9000 });
  const weakOnly = await rankOffers(weakOnlyCatalog, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  assert.ok(!answersFromCatalog(weakOnly), 'only-weak results must fall through to live fan-out');
  weakOnlyCatalog.close();

  const garbageCatalog = openCatalog();
  garbageCatalog.upsertOffer({ domain: 'jumia.com.eg', url: 'https://jumia.com.eg/p/124',
    title: 'Full Cover Tempered Glass for Samsung Galaxy M33', price: 124 });
  const garbage = await rankOffers(garbageCatalog, 'Arion 43-Inch Full HD Smart', { verify: async () => null });
  assert.ok(!answersFromCatalog(garbage), 'zero-result garbage query must fall through to live fan-out');
  garbageCatalog.close();

  const confidentCatalog = openCatalog();
  confidentCatalog.upsertOffer({ domain: 'real.com', url: 'https://real.com/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت', price: 39699 });
  const confident = await rankOffers(confidentCatalog, 'شاشة شارب 75 بوصة 4K سمارت', { verify: async () => null });
  assert.ok(answersFromCatalog(confident), 'a genuine crowned match must answer from the catalog');
  confidentCatalog.close();

  const browseCatalog = openCatalog();
  browseCatalog.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 8 كيلو', price: 12000 });
  const browsed = await rankOffers(browseCatalog, 'غسالة', { verify: async () => null });
  assert.ok(answersFromCatalog(browsed), 'a legitimate category browse must answer from the catalog');
  browseCatalog.close();
});

// Regression: the new distinctive-overlap filter must not break genuine
// matches whose distinctive tokens (brand, size) really do appear in the
// offer title — mirrors the two real catalog queries named in the fix spec.
test('regression: LG and Sharp TV queries still crown despite the new distinctive-overlap filter', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'شاشة ال جي 43 بوصة سمارت فل اتش دي', price: 14900 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2',
    title: 'شاشة شارب 32 بوصة اتش دي', price: 8699 });
  // noise: shares only generic words with both queries, no brand/size overlap
  c.upsertOffer({ domain: 'noise.com', url: 'https://noise.com/3', title: 'كابل شحن سريع سمارت', price: 150 });

  const lg = await rankOffers(c, 'شاشة ال جي 43 بوصة', { verify: async () => null });
  assert.equal(lg.cheapest && lg.cheapest.price, 14900, 'LG 43-inch TV must still crown');

  const sharp = await rankOffers(c, 'شاشة شارب 32 بوصة', { verify: async () => null });
  assert.equal(sharp.cheapest && sharp.cheapest.price, 8699, 'Sharp 32-inch TV must still crown');
  c.close();
});

// ===== Browse/category fix (شاشة سامسونج bug: a screen protector, a phone,
// a power bank and earbuds all outranked real Samsung TVs because a query
// that resolved to both a brand AND a category was letting UNCATEGORIZED
// same-brand offers slip through, and an accessory got miscategorised as
// the target category by detectCategory's leading-noun scan) =====

test('a category query returns only offers of that category; a different-category offer is excluded', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'tv.com', url: 'https://tv.com/1',
    title: 'شاشة سامسونج 55 بوصة سمارت', price: 15000 });
  c.upsertOffer({ domain: 'washer.com', url: 'https://washer.com/2',
    title: 'غسالة سامسونج 9 كيلو', price: 15000 }); // different KNOWN category
  const r = await rankOffers(c, 'شاشة سامسونج', { verify: async () => null });
  assert.ok(r.results.every(x => x.domain !== 'washer.com'),
    'the washer must be excluded from a screen/TV query even though it shares the brand');
  assert.ok(r.results.some(x => x.domain === 'tv.com'), 'the actual Samsung TV must still be returned');
  c.close();
});

test('a brand+category query excludes a different-brand offer but keeps a no-brand offer matching the category', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'samsung-tv.com', url: 'https://samsung-tv.com/1',
    title: 'شاشة سامسونج 55 بوصة سمارت', price: 15000 });
  c.upsertOffer({ domain: 'lg-tv.com', url: 'https://lg-tv.com/2',
    title: 'شاشة ال جي 55 بوصة سمارت', price: 14000 }); // different KNOWN brand
  c.upsertOffer({ domain: 'nobrand-tv.com', url: 'https://nobrand-tv.com/3',
    title: 'شاشة 55 بوصة سمارت بدون ماركة', price: 13000 }); // category matches, no brand detected
  // and the bug's actual regression targets: uncategorized same-brand junk
  c.upsertOffer({ domain: 'phone.com', url: 'https://phone.com/4',
    title: 'سامسونج جالاكسي A14 128 جيجا', price: 5000 });
  c.upsertOffer({ domain: 'powerbank.com', url: 'https://powerbank.com/5',
    title: 'باور بانك سلكي سامسونج 10000', price: 999 });
  const r = await rankOffers(c, 'شاشة سامسونج', { verify: async () => null });
  const domains = r.results.map(x => x.domain);
  assert.ok(!domains.includes('lg-tv.com'), 'a different known brand must be excluded');
  assert.ok(!domains.includes('phone.com'), 'an uncategorized same-brand phone must be excluded');
  assert.ok(!domains.includes('powerbank.com'), 'an uncategorized same-brand power bank must be excluded');
  assert.ok(domains.includes('samsung-tv.com'), 'the genuine Samsung TV must be kept');
  assert.ok(domains.includes('nobrand-tv.com'), 'a no-brand offer matching the category must be kept');
  c.close();
});

test('an accessory is excluded from the device query but included when the query itself asks for it', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'tv.com', url: 'https://tv.com/1',
    title: 'شاشة سامسونج 55 بوصة سمارت', price: 15000 });
  c.upsertOffer({ domain: 'protector.com', url: 'https://protector.com/2',
    title: 'حماية شاشة سامسونج', price: 119 });
  const deviceQuery = await rankOffers(c, 'شاشة سامسونج', { verify: async () => null });
  assert.ok(!deviceQuery.results.some(x => x.domain === 'protector.com'),
    'the screen protector must not be returned for a TV query');

  const accessoryQuery = await rankOffers(c, 'حماية شاشة', { verify: async () => null });
  assert.ok(accessoryQuery.results.some(x => x.domain === 'protector.com'),
    'a query that itself asks for the accessory must still find it');
  c.close();
});

test('regression: bare category browse and model-bearing crown are unaffected by the accessory/category/brand gate', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 8 كيلو اتوماتيك', price: 12000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة بوش 7 كيلو فتحة علوية', price: 9000 });
  c.upsertOffer({ domain: 'c.com', url: 'https://c.com/3', title: 'غسالة سامسونج 9 كيلو', price: 15000 });
  const washers = await rankOffers(c, 'غسالة', { verify: async () => null });
  assert.equal(washers.results.length, 3, 'a bare category browse must still return all washers');
  assert.equal(washers.cheapest, null, 'a browse still crowns nothing');

  const c2 = openCatalog();
  c2.upsertOffer({ domain: 'lg.com', url: 'https://lg.com/1',
    title: 'شاشة ال جي 43 بوصة سمارت فل اتش دي 43LM6370PVA', price: 14900 });
  const modelQuery = await rankOffers(c2, '43LM6370PVA', { verify: async () => null });
  assert.equal(modelQuery.cheapest && modelQuery.cheapest.price, 14900,
    'a model-bearing query must still crown via exact model match');
  c.close(); c2.close();
});

test('removing a unit override widens the result set', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 7 كيلو', price: 11000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة توشيبا 9 كيلو', price: 13000 });
  const narrow = await rankOffers(c, 'غسالة توشيبا 7 كيلو', { verify: async () => null });
  const wide = await rankOffers(c, 'غسالة توشيبا 7 كيلو', {
    verify: async () => null, override: { units: {} } });
  assert.ok(wide.results.length > narrow.results.length,
    'clearing the kg filter must return both capacities');
  c.close();
});

/* ---------------------------------------------------------------------------
   mergeLiveRows — the catalog is a PARTIAL mirror.

   scripts/crawl-m1.mjs fills catalog.db from product sitemaps, so it only ever
   holds the stores that publish one. amazon.eg, carrefouregypt.com and every
   other headless/JS-only store are absent from it by construction, and the
   live fan-out is the only code path that ever queries them. A confident
   catalog match therefore is not a complete answer, and crowning a "cheapest"
   from it alone hides real, cheaper offers: the reported case was a Midea
   MF-CY85WK air fryer crowned at 6,498 from Sharaf DG while Amazon Egypt
   listed the same model at 5,800.
   --------------------------------------------------------------------------- */

const catRow = (domain, price, rank) => ({
  store: domain, domain, type: 'local', title: 'Midea Airfryer MF-CY85WK',
  price, effectivePrice: price, currency: 'EGP', url: `https://${domain}/p`,
  checkedAt: 1, flags: [], rank, verified: false,
});
const liveRow = (domain, price, flags = []) => ({
  store: domain, domain, type: 'mega', title: 'Midea Airfryer MF-CY85WK',
  price, effectivePrice: price, currency: 'EGP', url: `https://${domain}/dp`,
  checkedAt: 2, flags, tier: 1, rank: flags.length ? undefined : 1,
});

test('a live store the catalog cannot cover is added and can take the crown', () => {
  const merged = mergeLiveRows([catRow('egypt.sharafdg.com', 6498, 1)],
                               [liveRow('amazon.eg', 5800)]);
  assert.equal(merged.length, 2, 'the Amazon offer must survive the merge');
  const crown = merged.find(r => r.rank === 1);
  assert.equal(crown.domain, 'amazon.eg', 'the genuinely cheapest offer must be crowned');
  assert.equal(crown.price, 5800);
  assert.equal(merged.find(r => r.domain === 'egypt.sharafdg.com').rank, 2);
});

test('the merged list stays price-ascending', () => {
  const merged = mergeLiveRows([catRow('a.com', 6498, 1), catRow('b.com', 7000, 2)],
                               [liveRow('amazon.eg', 5800)]);
  assert.deepEqual(merged.map(r => r.price), [5800, 6498, 7000]);
});

test('a live row from a domain the catalog already matched is dropped', () => {
  // the catalog cleared sameProduct's identity check; the live fan-out only
  // cleared isRelevant. On a domain both cover, the stricter one wins rather
  // than letting a looser match undercut it.
  const merged = mergeLiveRows([catRow('jumia.com.eg', 6498, 1)],
                               [liveRow('jumia.com.eg', 4000)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price, 6498);
});

test('a flagged live row is shown but never crowned, even when cheapest', () => {
  const merged = mergeLiveRows([catRow('a.com', 6498, 1)],
                               [liveRow('amazon.eg', 3000, ['variant'])]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].price, 3000, 'it is still shown, price-sorted');
  assert.equal(merged[0].rank, undefined, 'but an uncertain match cannot be the winner');
  assert.equal(merged.find(r => r.domain === 'a.com').rank, 1);
});

test('an uncrownable catalog row stays uncrowned after the merge', () => {
  // rank undefined = rankOffers refused to crown it (weak match, or out of stock)
  const merged = mergeLiveRows([catRow('a.com', 100, undefined)],
                               [liveRow('amazon.eg', 5800)]);
  assert.equal(merged[0].price, 100);
  assert.equal(merged[0].rank, undefined);
  assert.equal(merged.find(r => r.domain === 'amazon.eg').rank, 1);
});

test('no live rows is an identity operation — order and ranks are untouched', () => {
  const rows = [catRow('a.com', 6498, 1), catRow('b.com', 7000, 2)];
  const merged = mergeLiveRows(rows, []);
  assert.deepEqual(merged.map(r => [r.domain, r.price, r.rank]),
                   [['a.com', 6498, 1], ['b.com', 7000, 2]]);
});

test('crowning stops at five', () => {
  const cat = [catRow('a.com', 100, 1)];
  const live = [200, 300, 400, 500, 600, 700].map((p, i) => liveRow('s' + i + '.com', p));
  const merged = mergeLiveRows(cat, live);
  assert.equal(merged.filter(r => r.rank != null).length, 5);
  assert.deepEqual(merged.slice(0, 5).map(r => r.rank), [1, 2, 3, 4, 5]);
  assert.equal(merged[5].rank, undefined);
});

test('a live accessory FOR the product is dropped, not crowned', () => {
  // the real regression: isRelevant let a 165 EGP fridge divider through, and
  // being cheapest it took the crown over a genuine 16,333 EGP Toshiba fridge
  const q = 'ثلاجة توشيبا';
  const want = identify(q);
  const cat = [{ ...catRow('awadserag.com', 16333, 1), title: 'ثلاجه توشيبا 296 لتر 2 باب سلفر GR-EF31-SL' }];
  const live = [{ ...liveRow('elarabygroup.com', 165), title: 'حاجز أدوية ثلاجة توشيبا و تورنيدو 351 لتر شفاف' }];
  const merged = mergeLiveRows(cat, live, q, want);
  assert.equal(merged.length, 1, 'the accessory must not appear at all');
  assert.equal(merged[0].domain, 'awadserag.com');
  assert.equal(merged[0].rank, 1, 'the real fridge keeps the crown');
});

test('a live row for a different brand is dropped', () => {
  const q = 'ثلاجة توشيبا';
  const want = identify(q);
  const cat = [{ ...catRow('awadserag.com', 16333, 1), title: 'ثلاجه توشيبا 296 لتر 2 باب سلفر GR-EF31-SL' }];
  const live = [{ ...liveRow('x.com', 9000), title: 'ثلاجة سامسونج 300 لتر' }];
  const merged = mergeLiveRows(cat, live, q, want);
  assert.equal(merged.length, 1, 'a Samsung fridge is not an answer to a Toshiba query');
});

test('a genuine live offer still merges and crowns once the gate is on', () => {
  const q = 'Midea Airfryer MF-CY85WK';
  const want = identify(q);
  const merged = mergeLiveRows([catRow('egypt.sharafdg.com', 6498, 1)],
                               [liveRow('amazon.eg', 5800)], q, want);
  assert.equal(merged.length, 2, 'the gate must not reject the real Amazon listing');
  assert.equal(merged.find(r => r.rank === 1).domain, 'amazon.eg');
});

test('a regional model suffix is shown and flagged, never dropped', () => {
  // sameProduct compares model strings exactly, so TW-BJ100M4EG reads as a
  // 'model mismatch' against TW-BJ100M4. Dropping on that hid Amazon's 22,620
  // listing of exactly the washer the shopper typed.
  const q = 'Toshiba Washing Machine TW-BJ100M4';
  const want = identify(q);
  const cat = [{ ...catRow('kenzz.com', 22800, 1),
    title: 'Toshiba Automatic Washing Machine - 8 Kg - Morandi Gray- Tw-Bk90Gf4Eg(SK)' }];
  const live = [{ ...liveRow('amazon.eg', 22620),
    title: 'TOSHIBA Washing Machine - Silver - 9Kg - Inverter - TW-BJ100M4EG' }];
  const merged = mergeLiveRows(cat, live, q, want);
  const am = merged.find(r => r.domain === 'amazon.eg');
  assert.ok(am, 'the cheaper Amazon listing must be visible to the shopper');
  assert.equal(am.price, 22620);
  assert.ok(am.flags.includes('variant'), 'flagged, because the engine is not certain');
  assert.equal(am.rank, undefined, 'and never crowned on an uncertain identity');
});

/* ---------------------------------------------------------------------------
   Browse vs. product search.

   A pasted marketplace title names a category too, and with no brand or model
   the engine recognises it took the bare-category browse path: a search for
   "Instant Pot Duo 6 Qt 7-in-1 Electric Pressure Cooker…" answered with 225
   Egyptian gas cookers from 500 EGP, and — because compare() skips the live
   fan-out for a browse — never asked a single store about the actual product.
   --------------------------------------------------------------------------- */

test('a bare category query still browses', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 7 كيلو', price: 11000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة سامسونج 9 كيلو', price: 15000 });
  const r = await rankOffers(c, 'غسالة', { verify: async () => null });
  assert.equal(r.browse, true, 'the washer aisle is a browse');
  assert.equal(r.results.length, 2);
  c.close();
});

test('a category name plus one qualifier still browses', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 7 كيلو', price: 11000 });
  const r = await rankOffers(c, 'غسالة اوتوماتيك', { verify: async () => null });
  assert.equal(r.browse, true, 'one extra word is still the aisle, not a product');
  c.close();
});

test('a pasted product title that merely NAMES a category is not a browse', async () => {
  const c = openCatalog();
  // the catalogue's cookers — none of them an Instant Pot
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'بوتجاز مسطح 4 شعلة سوبر كلاسيك', price: 500 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'بوتجاز يونيون 60*90 استانلس', price: 4083 });
  const q = 'Instant Pot Duo 6 Qt 7-in-1 Electric Pressure Cooker, Stainless Steel | multicooker, ' +
            '6 quart, slow cook, rice, steam, sauté, yogurt, sterilizer, keep warm, app with guided recipes, family';
  const r = await rankOffers(c, q, { verify: async () => null });
  assert.equal(r.browse, false, 'a pasted title is a product search, not the cooker aisle');
  assert.equal(r.confident, false, 'and the catalogue cannot identify it, so the caller must fall through');
  assert.ok(!r.results.some(x => /بوتجاز/.test(x.title)),
    'a gas cooker must never be offered as an answer to an Instant Pot query');
  c.close();
});
