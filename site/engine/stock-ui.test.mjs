// site/engine/stock-ui.test.mjs
/* The storefront never had stock data before Ecwid, so nothing in it honoured
   availability. With Ecwid live, 470 of the 990 products it serves are OUT OF
   STOCK — so every surface that offers a product for sale has to say so, or the
   site takes money for things SADKO cannot ship.

   These tests cover the data-shaping side (shop-core) and the markup side
   (storefront.card), both of which are plain modules. The DOM enhancement in
   nav.js is asserted from source, like shop-wiring.test.mjs does. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');

/* These files are CommonJS-compatible, so they load the same way
   storefront.test.mjs and shop-core.test.mjs load them. */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const ui = require_('../assets/js/storefront.js');
const core = require_('../assets/js/shop-core.js');

const P = (id, over = {}) => ({
  id: String(id), title: 'ثلاجة ' + id, price: 1000 + Number(id),
  image: 'i.webp', images: ['i.webp'], description: 'وصف',
  categoryId: 'c', url: 'https://sadko/p' + id, inStock: true,
  compareToPrice: null, discountPercent: null, ...over,
});

/* ---------------------- ordering: shop-core.sortList -------------------- */

test('the default order keeps out-of-stock last', () => {
  const out = core.sortList([P(1, { inStock: false }), P(2), P(3, { inStock: false }), P(4)], 'default');
  assert.deepEqual(out.map(p => p.inStock), [true, true, false, false]);
});

test('sorting by price ASC still keeps out-of-stock last', () => {
  /* This is the case the data layer cannot cover: price-asc re-sorts the whole
     list, so without the guard a cheap unavailable product would head the grid. */
  const out = core.sortList([
    P(1, { price: 100, inStock: false }),
    P(2, { price: 900 }),
    P(3, { price: 200 }),
  ], 'price-asc');
  assert.deepEqual(out.map(p => p.id), ['3', '2', '1']);
  assert.equal(out[out.length - 1].inStock, false);
});

test('sorting by price DESC still keeps out-of-stock last', () => {
  const out = core.sortList([
    P(1, { price: 9999, inStock: false }),
    P(2, { price: 100 }),
    P(3, { price: 500 }),
  ], 'price-desc');
  assert.deepEqual(out.map(p => p.id), ['3', '2', '1']);
});

test('out-of-stock products are never DROPPED, only ranked last', () => {
  const rows = [P(1, { inStock: false }), P(2, { inStock: false })];
  for (const s of ['default', 'price-asc', 'price-desc'])
    assert.equal(core.sortList(rows, s).length, 2, s + ' dropped a product');
});

test('a product with no stock field at all is treated as available', () => {
  /* The seed catalogue has no inStock field. With the flag off it must behave
     exactly as it always did. */
  const rows = [{ id: 'a', price: 1 }, { id: 'b', price: 2 }];
  assert.deepEqual(core.sortList(rows, 'default').map(p => p.id), ['a', 'b']);
});

test('in-stock order is preserved within the sort, not reshuffled', () => {
  const out = core.sortList([P(10), P(20), P(30)], 'default');
  assert.deepEqual(out.map(p => p.id), ['10', '20', '30']);
});

/* ------------------------- markup: storefront.card ---------------------- */

test('an in-stock card still offers the buy link, unchanged', () => {
  const html = ui.card(P(1), {});
  assert.match(html, /card__buy/);
  assert.ok(!/data-stock="out"/.test(html));
});

test('an out-of-stock card is marked, and does NOT offer a buy link', () => {
  const html = ui.card(P(1, { inStock: false }), {});
  assert.match(html, /data-stock="out"/);
  assert.ok(!/card__buy/.test(html), 'an unbuyable product must not show a buy link');
});

/* The module reads the language from window.skLang, not from opts, and prices
   render in Arabic-Indic numerals in Arabic mode — so an English assertion has
   to switch the global, and an Arabic one cannot look for "23,900". */
function withLang(lang, fn) {
  const prev = globalThis.window;
  globalThis.window = { skLang: { get: () => lang } };
  try { return fn(); } finally { globalThis.window = prev; }
}

test('an out-of-stock card says so in words, in Arabic', () => {
  assert.match(ui.card(P(1, { inStock: false }), {}), /غير متوفر/);
});

test('an out-of-stock card says so in words, in English', () => {
  const html = withLang('en', () => ui.card(P(1, { inStock: false }), {}));
  assert.match(html, /Out of stock/i);
  assert.ok(!/غير متوفر/.test(html), 'the English card must not fall back to Arabic');
});

test('a real was-price renders with the saving, and the current price stays primary', () => {
  const html = ui.card(P(1, { price: 18500, compareToPrice: 23900, discountPercent: 23 }), {});
  assert.match(html, /card__was/);
  assert.match(html, /card__off/);
  assert.match(html, /-23%/);
  // The struck-through price is the OLD one; the live price stays in card__price.
  assert.match(html, /class="card__price">[^<]*١٨/, 'the current price must lead');
  assert.match(html, /class="card__was">٢٣/, 'the was-price must be the higher one');
});

test('the was-price is struck through, so it cannot be mistaken for the price', () => {
  const html = ui.card(P(1, { price: 100, compareToPrice: 200 }), {});
  assert.match(html, /<s class="card__was">/);
});

test('no was-price means no discount markup at all', () => {
  const html = ui.card(P(1, { compareToPrice: null }), {});
  assert.ok(!/card__was/.test(html), 'a product with no real was-price must claim no discount');
  assert.ok(!/%/.test(html.replace(/[^%]/g, '')) || !/card__off/.test(html));
});

test('a stale was-price below the price is not rendered even if it reaches the card', () => {
  /* The mapper already nulls these, but the card is the last line of defence:
     a "discount" where the old price is lower is a lie either way. */
  const html = ui.card(P(1, { price: 1000, compareToPrice: 500, discountPercent: -100 }), {});
  assert.ok(!/card__was/.test(html));
});

test('the card still escapes a hostile title with stock markup present', () => {
  const html = ui.card(P(1, { title: '<img src=x onerror=alert(1)>', inStock: false }), {});
  assert.ok(!/<img src=x/.test(html));
});

/* --------------------- the DOM layer: nav.js add-to-cart ---------------- */

const navJs = readFileSync(path.join(SITE, 'assets', 'js', 'nav.js'), 'utf8');

test('nav.js does not attach an enabled add-to-cart to an out-of-stock product', () => {
  /* Anchored on the button-creation code itself. An earlier version of this
     test anchored on the function NAME with a fixed character window, which
     matched the first of four mentions and missed the body entirely — a
     distance-based assertion is brittle by construction. */
  const btn = /b\.className = 'sk-addbtn'[\s\S]{0,600}|prod\.inStock === false[\s\S]{0,600}/.exec(navJs);
  assert.ok(btn, 'the sk-addbtn creation code was not found');
  const region = navJs.slice(Math.max(0, navJs.indexOf('sk-addbtn') - 900),
                             navJs.indexOf('sk-addbtn') + 900);
  assert.match(region, /prod\.inStock === false/,
    'the add-to-cart button must consult stock before becoming clickable');
  assert.match(region, /b\.disabled = true/, 'an unavailable product needs a disabled button');
});

test('nav.js has a bilingual out-of-stock label', () => {
  for (const k of ['soldOut'])
    assert.ok(navJs.split(k + ':').length - 1 >= 2, `${k} needs Arabic and English`);
});

/* ------------------------- the cart itself ------------------------------ */

test('skCart.add refuses an out-of-stock product', () => {
  /* The cart lives in nav.js, not store.js. Defence in depth: the button is
     disabled and the buy link is gone, but a page left open before a sync could
     still reach add(). */
  const add = /add\(p, qty\)[\s\S]{0,900}/.exec(navJs)[0];
  assert.match(add, /inStock === false/, 'skCart.add must refuse an out-of-stock product');
});

test('the SAVED list still accepts an out-of-stock product', () => {
  /* Deliberately NOT guarded. Saving something unavailable for later is
     exactly what a shopper should be able to do — it is the cart that must
     refuse, not the wishlist. */
  const storeJs = readFileSync(path.join(SITE, 'assets', 'js', 'store.js'), 'utf8');
  const savedAdd = /add\(p, extra\)[\s\S]{0,500}/.exec(storeJs);
  assert.ok(savedAdd, 'the saved-list add() was not found');
  assert.ok(!/inStock === false/.test(savedAdd[0]),
    'the wishlist must not refuse out-of-stock products');
});
