// site/engine/order-pricing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repriceLines } from './order-pricing.mjs';

const CAT = [
  { id: '865565209', title: 'ثلاجة مينى بار جالانز 97 لتر', price: 15400, image: 'fridge.webp' },
  { id: '865565594', title: 'ثلاجة توشيبا 470 لتر', price: 38999, image: 'tosh.webp' },
  { id: '900000001', title: 'منتج بسعر صفر', price: 0, image: '' },
];

test('a price the browser sent is REPLACED by the catalogue price', () => {
  /* The whole point. A customer posting a 15,400 refrigerator at 1 gets
     charged 15,400. */
  const r = repriceLines([{ id: '865565209', title: 'ثلاجة', price: 1, qty: 1 }], CAT);
  assert.equal(r.ok, true);
  assert.equal(r.items[0].price, 15400);
  assert.equal(r.subtotal, 15400);
});

test('the TITLE comes from the catalogue too', () => {
  /* Otherwise the receipt and the Ecwid order line could name a different
     appliance than the one being charged for. */
  const r = repriceLines([{ id: '865565209', title: 'شاشة تليفزيون', price: 1, qty: 1 }], CAT);
  assert.match(r.items[0].title, /ثلاجة مينى بار/);
});

test('QUANTITY stays the customer\'s choice, only bounded', () => {
  const r = repriceLines([{ id: '865565209', price: 1, qty: 3 }], CAT);
  assert.equal(r.items[0].qty, 3);
  assert.equal(r.subtotal, 46200);
  assert.equal(repriceLines([{ id: '865565209', qty: 9999 }], CAT).items[0].qty, 20);
  assert.equal(repriceLines([{ id: '865565209', qty: -5 }], CAT).items[0].qty, 1);
  assert.equal(repriceLines([{ id: '865565209', qty: 'x' }], CAT).items[0].qty, 1);
});

test('a product that is not in the served catalogue is REFUSED, not re-priced', () => {
  /* The served catalogue already excludes disabled, unpriced and deleted
     products, so a miss is not a pricing question — it is not for sale. */
  const r = repriceLines([{ id: '000000', price: 100, qty: 1 }], CAT);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'item-unavailable');
  assert.equal(r.id, '000000');
});

test('a catalogue price of zero is refused rather than believed', () => {
  /* A zero would silently become a free refrigerator. */
  const r = repriceLines([{ id: '900000001', price: 500, qty: 1 }], CAT);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'item-unavailable');
});

test('one bad line refuses the whole order', () => {
  /* Dropping it would ship an order missing something the customer believes
     they bought. */
  const r = repriceLines([{ id: '865565209', qty: 1 }, { id: 'nope', qty: 1 }], CAT);
  assert.equal(r.ok, false);
  assert.equal(r.id, 'nope');
});

test('an empty cart is refused', () => {
  assert.equal(repriceLines([], CAT).error, 'empty-cart');
  assert.equal(repriceLines(null, CAT).error, 'empty-cart');
});

test('ids are compared as strings, so a numeric id still matches', () => {
  /* products.json carries string ids; a client could post a number. */
  const r = repriceLines([{ id: 865565209, qty: 1 }], CAT);
  assert.equal(r.ok, true);
  assert.equal(r.items[0].price, 15400);
});

test('a Map is accepted as well as a list, so a caller need not rebuild it', () => {
  const m = new Map(CAT.map(p => [p.id, p]));
  assert.equal(repriceLines([{ id: '865565594', qty: 1 }], m).items[0].price, 38999);
});

test('a missing or empty catalogue refuses everything rather than trusting the browser', () => {
  /* Failing open here would restore exactly the bug this exists to fix. */
  assert.equal(repriceLines([{ id: '865565209', qty: 1 }], []).ok, false);
  assert.equal(repriceLines([{ id: '865565209', qty: 1 }], null).ok, false);
});

test('nothing else from the posted line survives', () => {
  /* No status, no injected total, no extra fields. */
  const r = repriceLines([{ id: '865565209', qty: 1, hacked: true, price: 1 }], CAT);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ['id', 'image', 'price', 'qty', 'title']);
});
