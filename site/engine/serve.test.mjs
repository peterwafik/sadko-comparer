// site/engine/serve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';
import { rankOffers } from './serve.mjs';

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
