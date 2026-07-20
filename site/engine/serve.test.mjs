// site/engine/serve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';
import { rankOffers } from './serve.mjs';
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
