// site/engine/storefront.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ui = require('../assets/js/storefront.js');
const core = require('../assets/js/shop-core.js');

const P = { id: '157676934', title: 'ثلاجة كريازى 10 قدم', price: 15785,
            image: 'https://example.test/a.jpg', url: 'https://example.test/p',
            description: 'وصف', categoryId: '38003882' };

// nav.js (enhanceCategoryCards, injectFinderCta) and prefs.js (applyToCards)
// query these exact hooks. Losing any of them breaks the whole site, not just
// the shop, so they are asserted individually.
const REQUIRED = ['card__imgwrap', 'card__body', 'card__title', 'card__teaser',
                  'card__row', 'card__price', 'card__buy'];

test('card renders an article.card root', () => {
  assert.match(ui.card(P, {}), /<article class="card"/);
});

test('card keeps every hook nav.js and prefs.js depend on', () => {
  const html = ui.card(P, {});
  for (const cls of REQUIRED) assert.ok(html.includes(cls), 'missing ' + cls);
});

test('card exposes id and category as data attributes', () => {
  const html = ui.card(P, {});
  assert.ok(html.includes('data-id="157676934"'));
  assert.ok(html.includes('data-cat="38003882"'));
});

// enhanceCategoryCards resolves products via new URL(link.href).pathname against
// the catalogue's own urls. An internal href would make every lookup miss and
// add-to-cart would silently never appear on any card.
test('card__imgwrap hrefs the catalogue url so nav.js can resolve the product', () => {
  const html = ui.card(P, {});
  assert.match(html, /class="card__imgwrap" href="https:\/\/example\.test\/p"/);
});

test('card__buy hrefs the catalogue url too', () => {
  const html = ui.card(P, {});
  assert.match(html, /class="card__buy" href="https:\/\/example\.test\/p"/);
});

test('card escapes HTML in the title', () => {
  const html = ui.card({ ...P, title: '<img src=x onerror=alert(1)>' }, {});
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('card renders the price and never a was-price', () => {
  const html = ui.card(P, {});
  // Independent oracle — does not call ui.money(), so a broken money() (e.g. always
  // returning '', or a wrong digit script) cannot make this assertion pass by accident.
  // 15785 in Arabic-Indic numerals (this Node build has full ICU, so ar-EG renders those,
  // grouped with a U+066C Arabic thousands separator) is "١٥٬٧٨٥"; on a small-ICU build
  // ar-EG silently falls back to Latin digits/comma ("15,785").
  assert.match(html, /15,?785|١٥٬٧٨٥/);
  // Guards the fallback path (non-finite price) independently of the regex above.
  assert.ok(ui.money(P.price).length > 0);
  assert.ok(!/was|كان|<del|<s>/i.test(html));
});

test('card tolerates a missing image without emitting a broken src', () => {
  const html = ui.card({ ...P, image: '' }, {});
  assert.ok(!html.includes('src=""'));
});

test('card renders EN digits and currency when window.skLang reports en', () => {
  const savedWindow = global.window;
  global.window = { skLang: { get: () => 'en' } };
  try {
    const html = ui.card(P, {});
    // Independent oracle: calls Number.prototype.toLocaleString directly, not ui.money().
    assert.ok(html.includes((15785).toLocaleString('en-EG')));
    assert.ok(html.includes('EGP'));
    assert.ok(!html.includes('جنيه'));
  } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
});

test('promoHero renders nothing for missing, empty or malformed input', () => {
  assert.equal(ui.promoHero(null), '');
  assert.equal(ui.promoHero([]), '');
  assert.equal(ui.promoHero('not an array'), '');
  assert.equal(ui.promoHero([{}]), '');            // no title -> skipped
});

test('promoHero marks sample content so it is never read as a live campaign', () => {
  const html = ui.promoHero([{ id: 'a', title: 'تكييفات', href: 'shop.html?cat=1', sample: true }]);
  assert.ok(html.includes('محتوى تجريبي'));
});

test('promoHero omits the marker for real campaigns', () => {
  const html = ui.promoHero([{ id: 'a', title: 'تكييفات', href: 'shop.html?cat=1' }]);
  assert.ok(!html.includes('محتوى تجريبي'));
});

test('promoHero maps accent names to token classes, never raw hex', () => {
  const html = ui.promoHero([{ id: 'a', title: 'x', href: '#', accent: 'amber' }]);
  assert.ok(html.includes('promo--amber'));
  assert.ok(!/#[0-9a-f]{6}/i.test(html));
});

test('promoHero falls back to a typographic panel when image is absent', () => {
  const html = ui.promoHero([{ id: 'a', title: 'x', href: '#' }]);
  assert.ok(!html.includes('<img'));
});

test('rail renders one card per product and a see-all link', () => {
  const html = ui.rail('الأوفر', [P, { ...P, id: '2' }], 'shop.html?cat=38003882');
  assert.equal((html.match(/<article class="card"/g) || []).length, 2);
  assert.ok(html.includes('shop.html?cat=38003882'));
});

test('rail returns empty string when there are no products', () => {
  assert.equal(ui.rail('الأوفر', [], '#'), '');
});

test('categoryTile shows its real count', () => {
  const html = ui.categoryTile({ id: '38003882', name: 'ثلاجات', count: 76, href: 'shop.html?cat=38003882' });
  assert.ok(html.includes('76'));
  assert.ok(html.includes('ثلاجات'));
});

const FDATA = {
  cats: [{ id: '38003882', name: 'ثلاجات', count: 76, href: 'shop.html?cat=38003882' }],
  brands: [{ key: 'kiriazi', name: 'كريازى', count: 2 }, { key: '__none__', name: 'غير محدد', count: 1 }],
  bands: [{ key: '0-5000', label: 'تحت ٥٬٠٠٠', href: 'shop.html?max=5000' }]
};
const FLABELS = { cats: 'الفئة', brands: 'الماركة', price: 'السعر', clear: 'امسح الفلاتر' };

test('facets mark the active category as checked', () => {
  const html = ui.facets(core.parseState('?cat=38003882'), FDATA, FLABELS);
  assert.ok(/checked/.test(html));
});

test('facets always offer the unspecified-brand bucket', () => {
  const html = ui.facets(core.parseState(''), FDATA, FLABELS);
  assert.ok(html.includes('__none__'));
  assert.ok(html.includes('غير محدد'));
});

test('pager renders nothing for a single page', () => {
  assert.equal(ui.pager(1, 1, p => '?page=' + p), '');
});

test('pager marks the current page and links the others', () => {
  const html = ui.pager(2, 3, p => '?page=' + p);
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('?page=1'));
  assert.ok(html.includes('?page=3'));
});

test('breadcrumb renders the last entry as text, not a link', () => {
  const html = ui.breadcrumb([{ label: 'البيت', href: 'index.html' }, { label: 'المتجر' }]);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.ok(html.includes('المتجر'));
});

test('toolbar reports the result count and marks the active sort', () => {
  const html = ui.toolbar(core.parseState('?sort=price-asc'), 42, { count: n => n + ' منتج' });
  assert.ok(html.includes('42'));
  assert.ok(/selected/.test(html));
});
