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

// Finding 1 (CRITICAL): contentless FTS5 'delete' must be given the
// ORIGINAL indexed values, not NULLs, or the old tokens are orphaned in the
// index forever. This pins the regression: a title change must make the old
// token unsearchable, not just add the new one.
test('re-upserting a URL with a changed title removes the OLD token from search and adds the NEW one', () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p1',
    title: 'ثلاجة UNIQUEWORDONE 355 لتر', price: 29179, inStock: true });
  c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p1',
    title: 'ثلاجة UNIQUEWORDTWO 355 لتر', price: 27999, inStock: true });

  const fresh = c.search('UNIQUEWORDTWO');
  assert.equal(fresh.length, 1, 'new token must be searchable');

  const stale = c.search('UNIQUEWORDONE');
  assert.equal(stale.length, 0, 'old token must NOT still be searchable — stale FTS posting leaked');
  c.close();
});

// Finding 1 extended: the FTS delete must reconstruct not just title_raw but
// also the brand/model_norm columns that were actually indexed, or a brand
// or model-number change leaks the old brand/model token forever even
// though the title_raw token itself was cleaned up correctly.
test('title change also updates the searchable brand and model_norm FTS columns, not just title_raw', () => {
  const c = openCatalog();
  const { offerId } = c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p2',
    title: 'غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', price: 12079, inStock: true });

  const brandBefore = c.db.prepare("SELECT rowid FROM offers_fts WHERE offers_fts MATCH 'brand:toshiba'").all();
  assert.equal(brandBefore.length, 1, 'sanity: brand column indexed on first insert');
  const modelBefore = c.db.prepare("SELECT rowid FROM offers_fts WHERE offers_fts MATCH 'model_norm:AEW8460SUP'").all();
  assert.equal(modelBefore.length, 1, 'sanity: model_norm column indexed on first insert');

  c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p2',
    title: 'غسالة بوش 9 كيلو اتوماتيك WAJ2018FC', price: 13500, inStock: true });

  const staleBrand = c.db.prepare("SELECT rowid FROM offers_fts WHERE offers_fts MATCH 'brand:toshiba'").all();
  assert.equal(staleBrand.length, 0, 'old brand token must not linger in the brand column');
  const staleModel = c.db.prepare("SELECT rowid FROM offers_fts WHERE offers_fts MATCH 'model_norm:AEW8460SUP'").all();
  assert.equal(staleModel.length, 0, 'old model_norm token must not linger in the model_norm column');

  const freshBrand = c.db.prepare("SELECT rowid FROM offers_fts WHERE offers_fts MATCH 'brand:bosch'").all();
  assert.equal(freshBrand.length, 1, 'new brand token must be indexed');
  assert.equal(freshBrand[0].rowid, offerId);
  const freshModel = c.db.prepare("SELECT rowid FROM offers_fts WHERE offers_fts MATCH 'model_norm:WAJ2018FC'").all();
  assert.equal(freshModel.length, 1, 'new model_norm token must be indexed');
  c.close();
});

// Finding 2 (Important): the multi-statement write in upsertOffer must be
// transactional. Force a real mid-sequence failure — price_history.price is
// NOT NULL, and passing price=null lets the offer UPDATE succeed (offers.price
// has no NOT NULL constraint) while the subsequent price_history INSERT
// throws — and assert the whole upsert is rolled back: no changed offer row,
// no stray history row, and (critically) no orphaned FTS delete either.
test('a mid-sequence failure during upsert rolls back all writes, including the FTS delete', () => {
  const c = openCatalog();
  const { offerId } = c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p3',
    title: 'ثلاجة UNIQUEWORDTHREE 355 لتر', price: 29179, inStock: true });

  assert.throws(() => {
    c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p3',
      title: 'ثلاجة UNIQUEWORDTHREE 355 لتر', price: null, inStock: true });
  }, /NOT NULL constraint failed: price_history\.price/);

  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM offers').get().n, 1, 'no orphan offer row');
  assert.equal(c.db.prepare('SELECT price FROM offers WHERE id=?').get(offerId).price, 29179,
    'offer price update must have been rolled back');
  assert.equal(c.priceHistory(offerId).length, 1, 'no stray price_history row');
  assert.equal(c.search('UNIQUEWORDTHREE').length, 1,
    'the FTS delete issued mid-transaction must be rolled back too — old token must still be searchable');
  c.close();
});
