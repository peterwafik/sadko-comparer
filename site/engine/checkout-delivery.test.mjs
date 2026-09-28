// site/engine/checkout-delivery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const JS = readFileSync(new URL('../assets/js/checkout.js', import.meta.url), 'utf8');

test('checkout lists governorates from the server instead of five hard-coded ones', () => {
  assert.match(JS, /api\/delivery\/governorates/);
  assert.ok(!/'الساحل الشمالى\|North Coast', 'أخرى\|Other'/.test(JS), 'the old five-option list is gone');
});

test('checkout asks the server for a quote when the governorate changes', () => {
  assert.match(JS, /api\/delivery\/quote/);
  assert.match(JS, /gov\.addEventListener\('change'/);
});

test('both order payloads carry the fee the customer was shown', () => {
  assert.equal((JS.match(/quotedFee:/g) || []).length, 2);
});

test('a 409 delivery-fee-changed re-renders the summary instead of failing', () => {
  assert.match(JS, /delivery-fee-changed/);
});

test('the unquoted fallback sentence is still there', () => {
  assert.match(JS, /تؤكده خدمة العملاء/);
});

test('the summary shows a grand total only from the server quote', () => {
  const fn = /function deliveryRows\(subtotal\)[\s\S]{0,2400}?\n    \}/.exec(JS);
  assert.ok(fn, 'deliveryRows is missing');
  assert.match(fn[0], /QUOTE\.quotable/);
  assert.match(fn[0], /\(QUOTE_SUB != null \? QUOTE_SUB : subtotal\) \+ QUOTE\.fee/);
});

/* Ecwid's method titles carry their product lists in brackets and ran to four
   lines in the summary. The customer sees a breakdown instead: the per-order
   charge and each appliance's band and fee. The full title still goes to Ecwid. */
test('the delivery row shows a readable breakdown, not the raw Ecwid method title', () => {
  const fn = /function deliveryRows\(subtotal\)[\s\S]{0,2400}?\n    \}/.exec(JS)[0];
  assert.ok(!/QUOTE\.methodName/.test(fn), 'the raw method title is not shown to the customer');
  assert.match(fn, /QUOTE\.perOrder/);
  assert.match(fn, /QUOTE\.lines/);
  assert.match(JS, /const BAND = \{/);
});

test('the cart estimates delivery only from a saved governorate, otherwise says checkout', () => {
  const H = readFileSync(new URL('../cart.html', import.meta.url), 'utf8');
  assert.match(H, /api\/delivery\/quote/);
  assert.match(H, /api\/auth\/me/);
  assert.match(H, /تُحسب عند إتمام الطلب/);
  assert.match(H, /id="cartDelivery"/);
});

/* Review finding (Important): the total shown was cart price + fee, while the
   server stores and pushes REPRICED subtotal + fee. The summary now uses the
   subtotal the server quoted, and both payloads send it back for a 409 check. */
test('the summary total is the server-quoted subtotal plus the fee, and both payloads send it back', () => {
  assert.match(JS, /QUOTE_SUB = /, 'the quote reply subtotal is kept');
  const fn = /function deliveryRows\(subtotal\)[\s\S]{0,2400}?\n    \}/.exec(JS)[0];
  assert.match(fn, /QUOTE_SUB != null \? QUOTE_SUB : subtotal/);
  assert.equal((JS.match(/quotedSubtotal:/g) || []).length, 2);
});

/* Review finding (re-graded Important): if the governorate list failed to load,
   only the three metro areas were offered, so a Delta customer had to pick Cairo
   and was quoted — and charged — the Cairo rate. The fallback ends with «أخرى»,
   which the server maps to no region: customer care confirms the fee. */
test('the fallback governorate list offers «أخرى» so nobody is forced onto a metro rate', () => {
  assert.match(JS, /\(GOVS \|\| \[[^\]]*\{ ar: 'أخرى', en: 'Other[^']*' \}\]\)/);
});
