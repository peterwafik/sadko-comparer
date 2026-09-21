// site/engine/ecwid-map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toSadkoProduct, decodeEntities } from './ecwid-map.mjs';

const FIX = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'ecwid-product.json'), 'utf8'));

/* A minimal product using the REAL Ecwid field names, taken from the captured
   payload — not the names an earlier pass guessed. Ecwid has no
   `requiresShipping` (it is `isShippingRequired`), no `trackQuantity` (stock
   tracking is `unlimited === false`) and no top-level `brand`. */
const P = (over = {}) => ({
  id: 865564964,
  sku: 'sprinter',
  name: 'مبرد مياه كولدير',
  price: 6999,
  url: 'https://www.sadko-group.com/shop/x-p865564964',
  description: 'وصف',
  imageUrl: 'https://d2j6dbq0eux0bg.cloudfront.net/images/142682751/products/865564964/a.webp',
  galleryImages: [],
  inStock: true,
  quantity: 5,
  unlimited: false,
  isShippingRequired: true,
  weight: 0,
  compareToPrice: null,
  attributes: [],
  categoryIds: [102858075],
  defaultCategoryId: 102858075,
  enabled: true,
  ...over,
});

test('maps the seven fields the storefront already reads', () => {
  const p = toSadkoProduct(P());
  assert.equal(p.id, '865564964');                   // string, as products.json always had
  assert.equal(p.title, 'مبرد مياه كولدير');
  assert.equal(p.price, 6999);
  assert.equal(p.url, 'https://www.sadko-group.com/shop/x-p865564964');
  assert.equal(p.description, 'وصف');
  assert.ok(p.image.startsWith('https://'));
  assert.equal(p.categoryId, '102858075');
});

test('decodes HTML entities, normalising &nbsp; to a REAL space', () => {
  /* Real SADKO titles contain &nbsp; — see data/products.json. It is decoded
     to an ordinary space on purpose, NOT to U+00A0: an invisible
     non-breaking space inside a product title silently breaks site search and
     the comparer's token matching, and it is impossible to spot by eye. This
     expectation was itself written with a literal U+00A0 once, and the test
     failed against output that looked identical. Keep the plain space. */
  const p = toSadkoProduct(P({ name: 'مبرد مياه&nbsp;كولدير', description: 'أ&amp;ب &lt;ج&gt;' }));
  assert.equal(p.title, 'مبرد مياه كولدير');
  assert.ok(!p.title.includes(String.fromCharCode(0xa0)), 'no U+00A0 may survive into a title');
  assert.equal(p.description, 'أ&ب <ج>');
});

test('decodeEntities handles numeric references', () => {
  assert.equal(decodeEntities('&#1587;&#x644;&#39;'), "سل'");
});

/* ---- stock: the real Ecwid model ---- */

test('stock tracking is read from `unlimited`, not a trackQuantity field', () => {
  assert.equal(toSadkoProduct(P({ unlimited: false, quantity: 5 })).stockTracked, true);
  assert.equal(toSadkoProduct(P({ unlimited: true })).stockTracked, false);
});

test('quantity is carried through when it is tracked', () => {
  assert.equal(toSadkoProduct(P({ quantity: 12 })).quantity, 12);
});

test('an unlimited product reports no quantity rather than zero', () => {
  assert.equal(toSadkoProduct(P({ unlimited: true, quantity: 0 })).quantity, null);
});

test('out of stock is reported, and the product is still returned', () => {
  const p = toSadkoProduct(P({ inStock: false, quantity: 0 }));
  assert.equal(p.inStock, false);
  assert.ok(p.id, 'hiding it here is forbidden — the sort rule handles presentation');
});

test('inStock falls back to the quantity when Ecwid omits the flag', () => {
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 0, unlimited: false })).inStock, false);
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 3, unlimited: false })).inStock, true);
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 0, unlimited: true })).inStock, true);
});

/* ---- the discount provenance rule ---- */

test('a real was-price is kept when it exceeds the price', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 8999 })).compareToPrice, 8999);
});

test('a stale was-price equal to or below the price is ignored', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 6999 })).compareToPrice, null);
  assert.equal(toSadkoProduct(P({ compareToPrice: 5000 })).compareToPrice, null);
});

test('a zero or absent was-price is ignored, never treated as a discount', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 0 })).compareToPrice, null);
  assert.equal(toSadkoProduct(P({ compareToPrice: null })).compareToPrice, null);
});

test('the discount percent is derived only from a kept was-price', () => {
  assert.equal(toSadkoProduct(P({ price: 18500, compareToPrice: 23900 })).discountPercent, 23);
  assert.equal(toSadkoProduct(P({ price: 18500, compareToPrice: 100 })).discountPercent, null);
});

/* ---- shipping ---- */

test('isShippingRequired is carried, and a missing weight is null not zero', () => {
  const p = toSadkoProduct(P({ isShippingRequired: true, weight: 0 }));
  assert.equal(p.shippingRequired, true);
  assert.equal(p.weight, null, 'zero must not masquerade as a known weight of 0 kg');
});

test('a real weight is kept', () => {
  assert.equal(toSadkoProduct(P({ weight: 62.5 })).weight, 62.5);
});

/* ---- images ---- */

test('gallery images are collected, main image first, without duplicates', () => {
  const p = toSadkoProduct(P({
    imageUrl: 'https://cdn/main.webp',
    galleryImages: [{ id: 1, url: 'https://cdn/a.webp' }, { id: 2, url: 'https://cdn/main.webp' }],
  }));
  assert.deepEqual(p.images, ['https://cdn/main.webp', 'https://cdn/a.webp']);
  assert.equal(p.image, 'https://cdn/main.webp');
});

test('a product with no image at all maps with an empty image, not undefined', () => {
  const p = toSadkoProduct(P({ imageUrl: '', galleryImages: [], originalImageUrl: '', thumbnailUrl: '' }));
  assert.equal(p.image, '');
  assert.deepEqual(p.images, []);
});

/* ---- brand lives in attributes, not a top-level field ---- */

test('brand is read from a BRAND attribute when present', () => {
  const p = toSadkoProduct(P({ attributes: [{ name: 'Brand', type: 'BRAND', value: 'كريازي' }] }));
  assert.equal(p.brand, 'كريازي');
});

test('brand is empty when the store keeps no attributes — which is the SADKO case', () => {
  assert.equal(toSadkoProduct(P({ attributes: [] })).brand, '');
});

test('a non-brand attribute does not become the brand', () => {
  assert.equal(toSadkoProduct(P({ attributes: [{ name: 'Warranty', type: 'CUSTOM', value: '1 سنة' }] })).brand, '');
});

/* ---- categories ---- */

test('categoryIds are preserved so rails can use secondary membership', () => {
  const p = toSadkoProduct(P({ defaultCategoryId: 1, categoryIds: [1, 173607281] }));
  assert.deepEqual(p.categoryIds, ['1', '173607281']);
});

test('a product in no category maps with a null categoryId rather than "0"', () => {
  /* 7 ENABLED products in the live store are in no category; Ecwid reports
     defaultCategoryId 0, which must not be mistaken for a real category. */
  const p = toSadkoProduct(P({ defaultCategoryId: 0, categoryIds: [] }));
  assert.equal(p.categoryId, null);
  assert.deepEqual(p.categoryIds, []);
});

/* ---- placeholder shells ---- */

test('a product with no name is flagged as incomplete rather than silently published', () => {
  /* 463 products in the live store are empty shells: no name, no image,
     no category. They must never reach the storefront as blank cards. */
  const p = toSadkoProduct(P({ name: '', enabled: false }));
  assert.equal(p.title, '');
  assert.equal(p.incomplete, true);
});

test('a normal product is not flagged incomplete', () => {
  assert.equal(toSadkoProduct(P()).incomplete, false);
});

/* ---- price ---- */

test('a price arriving as a string is coerced to a number', () => {
  assert.equal(toSadkoProduct(P({ price: '6999.0' })).price, 6999);
});

test('an unusable price maps to null rather than zero', () => {
  assert.equal(toSadkoProduct(P({ price: null })).price, null);
});

/* ---- enabled ---- */

test('enabled is carried so the sync can respect Ecwid visibility', () => {
  assert.equal(toSadkoProduct(P({ enabled: false })).enabled, false);
  assert.equal(toSadkoProduct(P()).enabled, true);
});

/* ---- the real payload ---- */

test('the real captured Ecwid product maps without throwing and yields core fields', () => {
  const p = toSadkoProduct(FIX);
  assert.equal(typeof p.id, 'string');
  assert.ok(p.id.length);
  assert.ok(typeof p.title === 'string');
  assert.ok(p.price === null || typeof p.price === 'number');
  assert.ok(p.compareToPrice === null || p.compareToPrice > p.price);
  assert.ok(Array.isArray(p.images));
  assert.ok(p.weight === null || p.weight > 0);
});

test('the real payload has a genuine discount, and it survives the provenance rule', () => {
  /* The captured product is priced 18,500 against a compare-to of 23,900. */
  const p = toSadkoProduct(FIX);
  assert.equal(p.compareToPrice, 23900);
  assert.equal(p.discountPercent, 23);
});

test('the real payload carries no weight, which is why delivery cannot be quoted yet', () => {
  assert.equal(toSadkoProduct(FIX).weight, null);
});
