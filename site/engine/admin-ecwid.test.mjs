// site/engine/admin-ecwid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productPatch, couponPayload, adDescription, parseAdDescription, adSku, adName, imageSize,
         shapeProblem, AD_SHAPES, paymentPatch, adPagePreview, cleanDestination } from './admin-ecwid.mjs';

test('a product edit becomes Ecwid fields, and only known ones', () => {
  assert.deepEqual(productPatch({ title: ' ثلاجة ', price: '12999.5', compareToPrice: 15000, enabled: false,
    badge: 'عرض', quantity: 4, description: 'وصف', categoryId: '38003882', hack: 1 }), {
    name: 'ثلاجة', price: 12999.5, compareToPrice: 15000, enabled: false, ribbon: { text: 'عرض', color: '#0F766E' },
    quantity: 4, unlimited: false, description: 'وصف', defaultCategoryId: 38003882,
  });
});

test('clearing a badge, a was-price, or stock tracking says so explicitly', () => {
  assert.deepEqual(productPatch({ badge: '', compareToPrice: null, quantity: null }),
    { ribbon: { text: '', color: '' }, compareToPrice: 0, unlimited: true });
});

test('bad numbers and empty names are refused rather than sent', () => {
  assert.equal(productPatch({ price: -1 }).error, 'bad-price');
  assert.equal(productPatch({ price: 'abc' }).error, 'bad-price');
  assert.equal(productPatch({ title: '  ' }).error, 'bad-title');
  assert.equal(productPatch({ quantity: 1.5 }).error, 'bad-quantity');
  assert.equal(productPatch({ compareToPrice: 100, price: 200 }).error, 'was-below-price');
});

test('coupon form → Ecwid coupon', () => {
  assert.deepEqual(couponPayload({ name: 'رمضان', code: ' ramadan15 ', type: 'PERCENT', discount: '15',
    status: 'ACTIVE', minSubtotal: '5000', once: true, from: '2026-11-01', to: '2026-11-30' }), {
    name: 'رمضان', code: 'RAMADAN15', discountType: 'PERCENT', discount: 15, status: 'ACTIVE',
    totalLimit: 5000, usesLimit: 'ONCEPERCUSTOMER', applicationLimit: 'UNLIMITED',
    launchDate: '2026-11-01 00:00:00 +0200', expirationDate: '2026-11-30 23:59:59 +0200',
  });
});

test('coupon validation', () => {
  assert.equal(couponPayload({ code: 'XYZ', type: 'PERCENT', discount: 150 }).error, 'bad-discount');
  assert.equal(couponPayload({ code: 'a b', type: 'ABS', discount: 10 }).error, 'bad-code');
  assert.equal(couponPayload({ code: 'OK1', type: 'NOPE', discount: 10 }).error, 'bad-type');
  assert.equal(couponPayload({ code: 'OK1', type: 'SHIPPING' }).discount, 0, 'free delivery has no amount');
  assert.equal(couponPayload({ code: 'OK1', type: 'ABS', discount: 10, from: '2026-12-01', to: '2026-11-01' }).error, 'bad-dates');
});

test('an ad message carries Arabic and English in the Ecwid description, and reads back', () => {
  const d = adDescription('عرض الصيف', 'Summer offer');
  assert.deepEqual(parseAdDescription(d), { ar: 'عرض الصيف', en: 'Summer offer' });
  assert.deepEqual(parseAdDescription('<p>عرض</p>'), { ar: 'عرض', en: '' }, 'older ads with Arabic only');
  assert.deepEqual(parseAdDescription(''), { ar: '', en: '' });
});

test('destinations are an allow-list and become a unique SKU', () => {
  assert.equal(cleanDestination({ kind: 'page', value: 'contact' }), 'contact');
  assert.equal(cleanDestination({ kind: 'cat', value: '38003882' }), 'cat:38003882');
  assert.equal(cleanDestination({ kind: 'product', value: '837495061' }), 'product:837495061');
  assert.equal(cleanDestination({ kind: 'page', value: 'admin' }), null);
  assert.equal(cleanDestination({ kind: 'url', value: 'https://evil' }), null);
  assert.match(adSku('contact'), /^contact~[a-z0-9]{6}$/);
  assert.match(adSku(null), /^ad~[a-z0-9]{6}$/);
});

test('ad names carry the slot and position, which is what orders them', () => {
  assert.equal(adName('square', 2), 'إعلان مربع 2');
  assert.equal(adName('hero', 1), 'إعلان البانر الرئيسى 1');
  assert.equal(adName('wide', 3), 'إعلان عريض 3');
});

/* ---- artwork shape ---- */
const png = (w, h) => { const b = Buffer.alloc(33); b.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w, h) => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, ...Array(14).fill(0), 0xFF, 0xC0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, ...Array(9).fill(0)]);

test('image sizes are read from PNG and JPEG headers', () => {
  assert.deepEqual(imageSize(png(1600, 608)), { w: 1600, h: 608 });
  assert.deepEqual(imageSize(jpeg(900, 900)), { w: 900, h: 900 });
  assert.equal(imageSize(Buffer.from('nope')), null);
});

test('a square picture cannot go in a wide slot, and the reverse', () => {
  assert.equal(shapeProblem('wide', { w: 1600, h: 608 }), null);
  assert.equal(shapeProblem('hero', { w: 1920, h: 730 }), null);
  assert.equal(shapeProblem('square', { w: 900, h: 900 }), null);
  assert.equal(shapeProblem('square', { w: 1600, h: 608 }), 'wrong-shape');
  assert.equal(shapeProblem('wide', { w: 900, h: 900 }), 'wrong-shape');
  assert.equal(shapeProblem('wide', { w: 400, h: 152 }), 'too-small');
  assert.equal(shapeProblem('wide', null), null, 'unreadable size is left to the browser check');
  assert.ok(AD_SHAPES.wide.ratio > 2.5);
});

test('payment method edits: on/off, title and instructions only', () => {
  assert.deepEqual(paymentPatch({ enabled: false, title: 'كاش', instructions: 'ادفع للمندوب', processor: 'x' }),
    { enabled: false, checkoutTitle: 'كاش', instructionsForCustomer: { instructionsTitle: 'كاش', instructions: '<p>ادفع للمندوب</p>' } });
});

test('the category-page preview follows the storefront rule: own campaigns first, then brand-wide, three at most', () => {
  const ads = [
    { id: 'a', slot: 'wide', href: 'shop.html?cat=10' },
    { id: 'b', slot: 'wide', href: 'contact.html' },
    { id: 'c', slot: 'wide', href: 'shop.html?cat=20' },
    { id: 'd', slot: 'square', href: 'contact.html' },
    { id: 'e', slot: 'hero', href: 'delivery.html' },
  ];
  assert.deepEqual(adPagePreview(ads, '10', { 10: true }).map(a => a.id), ['a', 'b', 'e']);
  assert.deepEqual(adPagePreview(ads, '20', { 20: true }).map(a => a.id), ['c', 'b', 'e']);
});

import { adDestination } from './ecwid-ads.mjs';
test('the SKU tail survives Ecwid: "~" is read like "#", whose character Ecwid drops', () => {
  assert.equal(adDestination('cat:38003882~a1b2c3'), 'shop.html?cat=38003882');
  assert.equal(adDestination('product:837495061~9f'), 'product.html?id=837495061');
  assert.equal(adDestination('contact~0319f4'), 'contact.html');
  const sku = adSku(cleanDestination({ kind: 'cat', value: '38003882' }));
  assert.equal(adDestination(sku), 'shop.html?cat=38003882', 'what the portal writes, the storefront reads');
});

import { htmlToText, textToHtml } from './admin-ecwid.mjs';
test('payment instructions are edited as plain lines and saved as escaped paragraphs', () => {
  assert.equal(htmlToText('<p><strong>سيتم التواصل</strong></p><p>لإرسال الرابط</p>'), 'سيتم التواصل\nلإرسال الرابط');
  assert.equal(textToHtml('سطر ١\n\n<b>سطر ٢</b>'), '<p>سطر ١</p><p>&lt;b&gt;سطر ٢&lt;/b&gt;</p>');
});
