import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, decodeEntities, isProductOffer } from './offer-gate.mjs';

test('parsePrice accepts plausible EGP and rejects the rest', () => {
  assert.equal(parsePrice('39,699'), 39699);
  assert.equal(parsePrice('٣٩٦٩٩'), 39699);
  assert.equal(parsePrice(41000), 41000);
  assert.equal(parsePrice('99'), 0);          // below floor
  assert.equal(parsePrice('9999999'), 0);     // above ceiling
  assert.equal(parsePrice('abc'), 0);
});

test('decodeEntities unwraps html entities and strips tags', () => {
  assert.equal(decodeEntities('Cooling&nbsp;&amp;&nbsp;Heating'), 'Cooling & Heating');
  assert.equal(decodeEntities('<b>شارب</b> 75'), 'شارب 75');
});

test('isProductOffer rejects UI chrome and non-product URLs', () => {
  const ok = { title: 'شاشة شارب 75 بوصة 4K', price: 39699, url: 'https://s.com/product/1' };
  assert.equal(isProductOffer(ok), true);
  assert.equal(isProductOffer({ ...ok, title: 'إضافة إلى السلة' }), false);
  assert.equal(isProductOffer({ ...ok, title: 'Add to cart' }), false);
  assert.equal(isProductOffer({ ...ok, url: 'https://s.com/?add-to-cart=3991' }), false);
  assert.equal(isProductOffer({ ...ok, url: 'https://s.com/cart' }), false);
  assert.equal(isProductOffer({ ...ok, url: 'https://s.com/' }), false);   // bare root = nav
  assert.equal(isProductOffer({ ...ok, price: 0 }), false);
  assert.equal(isProductOffer({ ...ok, title: 'short' }), false);
});
