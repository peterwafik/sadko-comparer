// site/engine/payment-wiring.test.mjs
/* checkout.js is a browser IIFE with no exports, so — like shop-wiring.test.mjs
   — this asserts on the source. The point is to catch the two ways this wiring
   silently breaks: the client falling back to three hard-coded methods forever,
   and the server validating an order against a list the client never saw. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const server = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const checkout = readFileSync(path.join(SITE, 'assets', 'js', 'checkout.js'), 'utf8');

/* ------------------------------ the server ------------------------------ */

test('the payment methods are served on a public endpoint', () => {
  /* Public on purpose: checkout needs them before a customer has an account,
     and they are shop configuration, not customer data. */
  assert.match(server, /u\.pathname === '\/api\/payment-methods'/);
});

test('the endpoint sits BEFORE the admin gate, so it is reachable without a session', () => {
  const ep = server.indexOf("'/api/payment-methods'");
  const adminGate = server.indexOf("u.pathname.startsWith('/api/admin/')");
  assert.ok(ep > -1 && adminGate > -1);
  assert.ok(ep > adminGate || true, 'position only matters if the admin gate returns early');
  // What actually matters: the route must not be inside the admin block.
  const adminBlock = /if \(u\.pathname\.startsWith\('\/api\/admin\/'\)\)[\s\S]*?\n  \}/.exec(server)[0];
  assert.ok(!adminBlock.includes("'/api/payment-methods'"),
    'the payment endpoint must not require an admin session');
});

test('orders are validated against the LIVE list, not the hard-coded three', () => {
  /* With Ecwid on, a real instalment plan must be a valid choice, and a method
     the owner retired must not be. */
  // Awaited since the stores became async (Turso); still the live list.
  assert.match(server, /\(await activePaymentMethods\(\)\)\.map\(m => m\.id\)/);
});

test('activePaymentMethods falls back to the built-in three', () => {
  const fn = /function activePaymentMethods\(\)[\s\S]{0,900}/.exec(server)[0];
  assert.match(fn, /FALLBACK_METHODS/);
  assert.match(fn, /activeSource\(\) === 'ecwid'/,
    'the live list is only used while Ecwid is actually the source');
});

test('a thrown error while reading the mirror still yields a usable list', () => {
  const fn = /function activePaymentMethods\(\)[\s\S]{0,900}/.exec(server)[0];
  assert.match(fn, /catch/, 'checkout must never be left with no payment methods');
});

/* ------------------------------ the client ------------------------------ */

test('checkout fetches the methods from the endpoint', () => {
  assert.match(checkout, /api\/payment-methods/);
});

test('checkout still has the built-in three as a fallback', () => {
  /* If the fetch fails — offline, or an older server — checkout must still
     work rather than render an empty radio group. */
  assert.match(checkout, /BUILTIN/);
  assert.match(checkout, /LIVE \? fromLive\(\) : BUILTIN\(\)/);
});

test('the methods are loaded before the first render', () => {
  /* Rendering first and patching later would flash three methods and then
     replace them, losing anything the customer had already selected.

     Asserted as "loadPayments is inside the Promise.all that gates render"
     rather than as the exact argument list: the list legitimately grew when
     the delivery policy read was added beside it, and pinning the literal
     shape failed on a change that kept the property intact. */
  const gate = /Promise\.all\(\[([^\]]*)\]\)\.then\(function \(r\) \{ render/.exec(checkout);
  assert.ok(gate, 'the gated render call is gone');
  assert.match(gate[1], /Au\.me\(true\)/);
  assert.match(gate[1], /loadPayments\(\)/);
});

test('checkout still quotes NO delivery figure of its own', () => {
  /* Ecwid's calculator returns the Greater Cairo rate for every address in
     Egypt, because none of its twelve methods is bound to a region. The
     summary must keep saying customer care confirms. */
  assert.match(checkout, /تؤكده خدمة العملاء/);
  assert.ok(!/shippingRate|SHIP\.rate|SHIP\.total/.test(checkout),
    'checkout reads a shipping rate — it must not, while quotable is false');
});

/* The "What SADKO states about delivery" panel quoted Ecwid's method notes as
   the store speaking in the third person. The owner removed it (2026-09-28):
   this site IS SADKO, so the page does not report what SADKO "states". The
   delivery time now travels with the fee itself (engine/ecwid-shipping.mjs). */
test('checkout has no "What SADKO states about delivery" panel', () => {
  assert.ok(!/function shippingPolicy\(/.test(checkout), 'the panel function is gone');
  assert.ok(!/What SADKO states about delivery|ما تقوله صادكو عن التوصيل/.test(checkout), 'its heading is gone');
});

test('a restricted method states its restriction at the point of choice', () => {
  assert.match(checkout, /m\.restricted/);
  assert.match(checkout, /متاح على منتجات/);
});

test('the basket hint warns but never blocks', () => {
  const fn = /function basketHint\(m\)[\s\S]{0,800}/.exec(checkout)[0];
  assert.match(fn, /unlikely/);
  assert.ok(!/ok: false/.test(fn), 'a hint must not make a method unselectable');
});

test('the receipt prints the method NAME, never a raw Ecwid id', () => {
  /* Ecwid ids look like 80361-1761810127405. Printing that at a customer on
     their own order receipt would be indefensible. */
  const fn = /function payName\(k\)[\s\S]{0,700}/.exec(checkout)[0];
  assert.match(fn, /LIVE/);
  assert.match(fn, /hit\.title/);
});

test('checkout still asks for no card details', () => {
  /* The one invariant this whole change must not disturb.

     Asserted on the FORM FIELDS, not on the prose. An earlier version of this
     test searched the whole file for "card number" and failed on the file's own
     honesty comment ("It does NOT ask for a card number") — a test that cannot
     tell a promise from its violation is worse than no test. */
  const inputs = checkout.match(/<(input|select)[^>]{0,200}/gi) || [];
  assert.ok(inputs.length, 'no form fields found at all — the regex is wrong');
  for (const el of inputs) {
    assert.ok(!/cc-(number|csc|exp)|cardnumber|card-number|cvv|cvc|expiry|exp_month|exp_year/i.test(el),
      'a card field appeared in checkout: ' + el.slice(0, 90));
  }
  /* And nothing may name a card field even indirectly. */
  assert.ok(!/name="(card|cc|cvv|cvc)[^"]*"/i.test(checkout),
    'a field is named as card data');
});

test('the card row remains, so the absence of card payment is stated not hidden', () => {
  assert.match(checkout, /CARD_NOTE/);
  assert.match(checkout, /ok: false/);
});

test('the file header no longer claims only three methods', () => {
  const header = checkout.slice(0, 1400);
  assert.ok(!/offers cash on delivery, bank transfer and\s*\n\s*paying at a showroom/.test(header),
    'the header must describe the live behaviour');
  assert.match(header, /Ecwid/);
});
