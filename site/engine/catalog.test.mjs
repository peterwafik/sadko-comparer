import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';

const seed = c => {
  c.upsertOffer({ domain: '2b.com.eg', url: 'https://2b.com.eg/p/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 41000, inStock: true });
  c.upsertOffer({ domain: 'elarabygroup.com', url: 'https://elarabygroup.com/p/2',
    title: 'شاشة شارب 4K سمارت بدون فريم 75 بوصة 4T-C75FN6EX', price: 39699, inStock: true });
  c.upsertOffer({ domain: 'btech.com', url: 'https://btech.com/p/3',
    title: 'غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', price: 12079, inStock: true });
};

test('upsert then search finds Arabic titles', () => {
  const c = openCatalog();
  seed(c);
  const r = c.search('شارب 75');
  assert.ok(r.length >= 2, `expected >=2 got ${r.length}`);
  c.close();
});

test('search matches an exact model number', () => {
  const c = openCatalog();
  seed(c);
  const r = c.search('4T-C75FN6EX');
  assert.equal(r.length, 2);
  c.close();
});

test('offers sharing a model number share one product_id', () => {
  const c = openCatalog();
  seed(c);
  const r = c.search('4T-C75FN6EX');
  assert.equal(r[0].product_id, r[1].product_id);
  c.close();
});

test('re-upserting the same URL updates price and records history', () => {
  const c = openCatalog();
  const { offerId } = c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p',
    title: 'ثلاجة تورنيدو 395 لتر RF-51FTV', price: 29179, inStock: true });
  c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p',
    title: 'ثلاجة تورنيدو 395 لتر RF-51FTV', price: 27999, inStock: true });
  const hist = c.priceHistory(offerId);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].price, 29179);
  assert.equal(hist[1].price, 27999);
  const rows = c.search('تورنيدو');
  assert.equal(rows.length, 1, 'URL is unique — no duplicate offer row');
  assert.equal(rows[0].price, 27999);
  c.close();
});

test('search does not throw on hyphenated or quote-bearing input', () => {
  const c = openCatalog();
  seed(c);
  assert.doesNotThrow(() => c.search('RF-40FTV-BK'));
  assert.doesNotThrow(() => c.search('75" شاشة'));
  assert.doesNotThrow(() => c.search(''));
  c.close();
});
