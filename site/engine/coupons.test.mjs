// site/engine/coupons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCode, couponFromCalc, whyNotApplied, applyCoupon, couponMismatch, toEcwidCalcOrder } from './coupons.mjs';
import { totalsWith } from './delivery-order.mjs';

/* Shapes measured against the test store's /order/calculate on 2026-10-27:
   "Purchase Anniversary" is 15% and ACTIVE; a PAUSED or unknown code comes
   back with no discountCoupon at all and couponDiscount 0. */
const COUPON = { id: 0, name: 'Purchase Anniversary', code: 'G8VOJXZQUM5Q', discountType: 'PERCENT',
  status: 'ACTIVE', discount: 15, launchDate: '2026-09-16 21:00:00 +0000', usesLimit: 'UNLIMITED',
  repeatCustomerOnly: false, applicationLimit: 'UNLIMITED', orderCount: 0 };
const APPLIED = { subtotal: 37000, total: 31750, couponDiscount: 5550, discountCoupon: COUPON,
  items: [{ productId: 865564964, price: 18500, quantity: 2, couponApplied: true, couponAmount: 5550 }] };
const REFUSED = { subtotal: 37000, total: 37300, couponDiscount: 0,
  items: [{ productId: 865564964, price: 18500, quantity: 2, couponApplied: false }] };

test('codes are trimmed, upper-cased and bounded; anything else is no code', () => {
  assert.equal(normalizeCode('  g8vojxzqum5q '), 'G8VOJXZQUM5Q');
  assert.equal(normalizeCode(''), '');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode('a b'), '', 'a space is not part of any Ecwid code');
  assert.equal(normalizeCode('x'.repeat(80)), '', 'absurdly long input is refused, not truncated');
});

test('an applied coupon is read from Ecwid, with the discount Ecwid computed', () => {
  const c = couponFromCalc(APPLIED);
  assert.equal(c.ok, true);
  assert.equal(c.code, 'G8VOJXZQUM5Q');
  assert.equal(c.name, 'Purchase Anniversary');
  assert.equal(c.itemsDiscount, 5550);
  assert.equal(c.freeShipping, false);
  assert.deepEqual(c.lines, { '865564964': 5550 });
});

test('no discountCoupon in the answer means Ecwid did not apply it', () => {
  assert.deepEqual(couponFromCalc(REFUSED), { ok: false, reason: 'not-applied' });
  assert.deepEqual(couponFromCalc(null), { ok: false, reason: 'not-applied' });
});

test('a free-shipping coupon is applied even though it takes nothing off the goods', () => {
  const c = couponFromCalc({ couponDiscount: 300, discountCoupon: { ...COUPON, discountType: 'SHIPPING', discount: 0 },
    items: [{ productId: 1, couponApplied: false }] });
  assert.equal(c.ok, true);
  assert.equal(c.freeShipping, true);
  assert.equal(c.itemsDiscount, 0, 'Ecwid\'s shipping figure is its own rate, not the site\'s fee');
});

test('a coupon that would take nothing off and is not free shipping is not applied', () => {
  assert.equal(couponFromCalc({ couponDiscount: 0, discountCoupon: COUPON, items: [] }).ok, false);
});

test('without per-line amounts the order-level figure is used for a goods-only coupon', () => {
  const c = couponFromCalc({ couponDiscount: 1000, discountCoupon: { ...COUPON, discountType: 'ABS', discount: 1000 } });
  assert.equal(c.itemsDiscount, 1000);
});

test('whyNotApplied names the reason from the coupon record when Ecwid has one', () => {
  assert.equal(whyNotApplied(null, 5000), 'unknown');
  assert.equal(whyNotApplied({ status: 'PAUSED' }, 5000), 'inactive');
  assert.equal(whyNotApplied({ status: 'EXPIRED' }, 5000), 'expired');
  assert.equal(whyNotApplied({ status: 'USEDUP' }, 5000), 'used-up');
  assert.equal(whyNotApplied({ status: 'ACTIVE', totalLimit: 10000 }, 5000), 'min-subtotal');
  assert.equal(whyNotApplied({ status: 'ACTIVE', catalogLimit: { products: [1] } }, 5000), 'not-these-items');
  assert.equal(whyNotApplied({ status: 'ACTIVE' }, 5000), 'not-applicable');
});

test('the calculate payload carries the re-priced lines, the email and the code', () => {
  const p = toEcwidCalcOrder([{ id: '865564964', price: 18500, qty: 2 }], 'G8VOJXZQUM5Q', 'A@B.test');
  assert.deepEqual(p, { email: 'a@b.test', items: [{ productId: 865564964, price: 18500, quantity: 2 }],
    discountCoupon: { code: 'G8VOJXZQUM5Q' } });
});

test('applying a goods coupon to quoted totals takes it off the grand total', () => {
  const quote = { quotable: true, fee: 300, methodName: 'm', lines: [] };
  const t = applyCoupon(totalsWith(37000, quote), couponFromCalc(APPLIED));
  assert.equal(t.discount, 5550);
  assert.equal(t.deliveryFee, 300, 'the fee is still shown as charged; the coupon is a separate line');
  assert.equal(t.grandTotal, 37000 - 5550 + 300);
  assert.equal(t.coupon.code, 'G8VOJXZQUM5Q');
});

test('with no quoted delivery there is still no grand total, only the discount', () => {
  const t = applyCoupon(totalsWith(37000, { quotable: false }), couponFromCalc(APPLIED));
  assert.equal(t.discount, 5550);
  assert.equal(t.grandTotal, null);
});

test('free shipping waives exactly the fee the server quoted', () => {
  const c = { ok: true, code: 'FREE', name: 'f', type: 'SHIPPING', freeShipping: true, itemsDiscount: 0, lines: {} };
  const t = applyCoupon(totalsWith(37000, { quotable: true, fee: 1650, methodName: 'm', lines: [] }), c);
  assert.equal(t.discount, 1650);
  assert.equal(t.shippingDiscount, 1650);
  assert.equal(t.grandTotal, 37000);
  /* Unquoted: nothing to waive yet, and nothing invented. */
  const u = applyCoupon(totalsWith(37000, { quotable: false }), c);
  assert.equal(u.discount, 0);
  assert.equal(u.grandTotal, null);
});

test('a discount can never exceed the goods', () => {
  const c = { ok: true, code: 'BIG', name: 'b', type: 'ABS', freeShipping: false, itemsDiscount: 99999, lines: {} };
  assert.equal(applyCoupon(totalsWith(500, { quotable: false }), c).discount, 500);
});

test('no coupon leaves the totals untouched', () => {
  const base = totalsWith(1000, { quotable: false });
  assert.deepEqual(applyCoupon(base, null), base);
});

test('the discount the customer saw must equal the server\'s', () => {
  assert.equal(couponMismatch(5550, 5550), false);
  assert.equal(couponMismatch(5550, '5550'), false);
  assert.equal(couponMismatch(5550, 5000), true);
  assert.equal(couponMismatch(0, undefined), false, 'no coupon shown, none applied');
  assert.equal(couponMismatch(5550, undefined), true, 'a discount the customer never saw is still a change');
});

/* ---- the push: Ecwid records the coupon as its own checkout would ---- */
import { toEcwidOrder } from './ecwid-map.mjs';

const METHODS = [{ id: 'cod', title: 'الدفع عند الاستلام' }];
const orderWith = (totals, coupon) => ({
  ref: 'SDK-ABC123', createdAt: '2026-10-27T10:00:00Z', payment: 'cod', subtotal: 37000,
  items: [{ id: '865564964', title: 'ثلاجة', price: 18500, qty: 2 }],
  delivery: { name: 'م', phone: '01000000000', governorate: 'القاهرة', address: 'شارع' },
  totals, ...(coupon ? { coupon } : {}),
});

test('a pushed order carries the coupon, its discount per line, and the reduced total', () => {
  const c = couponFromCalc(APPLIED);
  const quote = { quotable: true, fee: 300, methodName: 'توصيل', lines: [] };
  const p = toEcwidOrder(orderWith(applyCoupon(totalsWith(37000, quote), c), c), { email: 'a@b.test' }, METHODS);
  assert.deepEqual(p.discountCoupon, { name: 'Purchase Anniversary', code: 'G8VOJXZQUM5Q', discountType: 'PERCENT', discount: 15 });
  assert.equal(p.couponDiscount, 5550);
  assert.equal(p.subtotal, 37000);
  assert.equal(p.total, 37000 + 300 - 5550);
  assert.equal(p.items[0].couponApplied, true);
  assert.equal(p.items[0].couponAmount, 5550);
  assert.match(p.orderComments, /G8VOJXZQUM5Q/);
});

test('an order with no coupon pushes exactly as before', () => {
  const p = toEcwidOrder(orderWith(totalsWith(37000, { quotable: false })), { email: 'a@b.test' }, METHODS);
  assert.equal(p.discountCoupon, undefined);
  assert.equal(p.couponDiscount, undefined);
  assert.equal(p.items[0].couponAmount, undefined);
  assert.equal(p.total, 37000);
});

test('an unquoted free-shipping coupon tells staff instead of inventing a figure', () => {
  const c = { ok: true, code: 'FREE', name: 'f', type: 'SHIPPING', freeShipping: true, itemsDiscount: 0, lines: {},
              raw: { code: 'FREE', discountType: 'SHIPPING', discount: 0 } };
  const p = toEcwidOrder(orderWith(applyCoupon(totalsWith(37000, { quotable: false }), c), c), { email: 'a@b.test' }, METHODS);
  assert.equal(p.couponDiscount, 0);
  assert.equal(p.total, 37000);
  assert.match(p.orderComments, /توصيل مجانى/);
});

/* ---- wiring: both order routes, the quote, and the page ---- */
import { readFileSync } from 'node:fs';
const SRV = readFileSync(new URL('../compare-server.mjs', import.meta.url), 'utf8');
const CO = readFileSync(new URL('../assets/js/checkout.js', import.meta.url), 'utf8');

test('both order routes check the coupon with Ecwid before the order exists', () => {
  assert.equal((SRV.match(/await orderCoupon\(\{/g) || []).length, 2);
  const guest = SRV.slice(SRV.indexOf("u.pathname === '/api/orders/guest'"));
  assert.ok(guest.indexOf('orderCoupon(') < guest.indexOf('putGuestOrder('), 'checked before it is stored');
  assert.match(guest, /email: order\.email/, 'the guest\'s own email, for once-per-customer');
  assert.match(SRV, /orderCoupon\(\{ lang, code: b\.coupon, items: priced\.items, email: me\.email/);
});

test('an unchecked coupon refuses the order instead of granting the discount', () => {
  const fn = /async function couponFor[\s\S]{0,900}?\n\}/.exec(SRV)[0];
  assert.match(fn, /reason: 'unavailable'/);
  const oc = /async function orderCoupon[\s\S]{0,1400}?\n\}/.exec(SRV)[0];
  assert.match(oc, /if \(!c\.ok\) return \{ response/);
  assert.ok(!/status: 503/.test(oc), 'skAuth reads a 503 as the whole service being down');
});

test('the quote asks Ecwid about a coupon and returns the server\'s totals', () => {
  const q = SRV.slice(SRV.indexOf("u.pathname === '/api/delivery/quote'"), SRV.indexOf("u.pathname === '/api/shipping-methods'"));
  assert.match(q, /couponFor\(priced\.items, b\.coupon, b\.email, priced\.subtotal\)/);
  assert.match(q, /totals = applyCoupon\(totals, c\)/);
  assert.match(q, /publicCoupon\(c, lang\)/, 'never Ecwid\'s raw record');
});

test('checkout sends the code and the discount it showed on both payloads', () => {
  assert.equal((CO.match(/coupon: couponOn\(\) \? CODE : undefined,/g) || []).length, 2);
  assert.equal((CO.match(/quotedDiscount: discount\(\),/g) || []).length, 2);
  assert.match(CO, /\/\^coupon-\/\.test\(r\.error/, 'a coupon 409 re-renders the summary');
});

test('the page shows the server\'s discount and never decides a code itself', () => {
  assert.match(CO, /const discount = \(\) => \(couponOn\(\) && TOTALS && TOTALS\.discount\) \|\| 0;/);
  assert.match(CO, /TOTALS && TOTALS\.grandTotal != null \? TOTALS\.grandTotal/);
  assert.match(CO, /summary\(items, true\)/);
});

test('checkout asks the server for messages in the page language (A.EN is a function)', () => {
  assert.ok(!/A\.EN \?/.test(CO), 'A.EN without () is always truthy, so Arabic pages got English errors');
  assert.equal((CO.match(/A\.EN\(\) \? 'en' : 'ar'/g) || []).length, 2);
});
