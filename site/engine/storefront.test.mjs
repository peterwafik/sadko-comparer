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

// AR (default) behaviour is the pre-existing baseline: title/teaser stay in
// Arabic and unhidden, and the buy button reads the Arabic default — none of
// this changes when no EN branch is exercised. window is left untouched
// (undefined under node:test unless a prior test set it) so this is exactly
// today's code path.
test('card in AR mode (default) keeps title, teaser and buy label unchanged', () => {
  const savedWindow = global.window;
  delete global.window;
  try {
    const html = ui.card(P, {});
    assert.ok(html.includes('>' + P.title + '<'));
    assert.ok(html.includes('>' + P.description + '<'));
    assert.ok(!/class="card__teaser"[^>]*\bhidden\b/.test(html));
    assert.match(html, /class="card__buy"[^>]*>اشترى الآن</);
    assert.ok(!html.includes('Buy now'));
  } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
});

// EN mode: the buy button must read the English default, never the Arabic
// literal, and an explicit opts.buyLabel must still win over both defaults.
test('card in EN mode uses the English buy label by default, and honours an explicit override', () => {
  const savedWindow = global.window;
  global.window = { skLang: { get: () => 'en' } };
  try {
    const html = ui.card(P, {});
    assert.match(html, /class="card__buy"[^>]*>Buy now/);
    assert.ok(!html.includes('اشترى الآن'));
    const overridden = ui.card(P, { buyLabel: 'Custom label' });
    assert.match(overridden, /class="card__buy"[^>]*>Custom label</);
  } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
});

// EN mode: specs/teasers exist only in Arabic (same rationale as nav.js's
// translateCategoryPage), so the teaser must be hidden — but the element
// itself must still exist, since prefs.js/nav.js query .card__body's
// children by fixed structure, not by presence of the teaser.
test('card in EN mode hides the teaser but keeps the .card__teaser element in the markup', () => {
  const savedWindow = global.window;
  global.window = { skLang: { get: () => 'en' } };
  try {
    const html = ui.card(P, {});
    assert.match(html, /<p class="card__teaser"[^>]*\bhidden\b[^>]*>/);
  } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
});

// EN mode with no catalog translator loaded (e.g. a page that forgot the
// <script>, or a future consumer of card() outside the shop pages): must not
// throw, and must fall back to the untranslated Arabic title rather than
// producing empty/garbled text.
test('card in EN mode falls back to the untranslated title when window.skCatalogI18n is absent', () => {
  const savedWindow = global.window;
  global.window = { skLang: { get: () => 'en' } };   // no skCatalogI18n on this window
  try {
    assert.doesNotThrow(() => ui.card(P, {}));
    const html = ui.card(P, {});
    assert.ok(html.includes('>' + P.title + '<'));
  } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
});

// EN mode with a catalog translator present: the title actually gets routed
// through it. The mock returns a marker string unrelated to any real
// translation logic, so this proves card() calls translateTitle rather than
// happening to produce translated-looking text on its own.
test('card in EN mode routes the title through window.skCatalogI18n.translateTitle when present', () => {
  const savedWindow = global.window;
  global.window = {
    skLang: { get: () => 'en' },
    skCatalogI18n: { translateTitle: () => '__TRANSLATED_MARKER__' }
  };
  try {
    const html = ui.card(P, {});
    assert.ok(html.includes('__TRANSLATED_MARKER__'));
    assert.ok(!html.includes(P.title));
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

// storefront.css keys its no-image fallback scrim off this class (not a :has()
// selector, for older-Android/Safari support), so both directions matter: a
// promo without an image must carry it, and a promo with one must not.
test('promoHero marks a promo with no image as promo--noimg, and one with an image as not', () => {
  const withoutImage = ui.promoHero([{ id: 'a', title: 'x', href: '#' }]);
  assert.ok(withoutImage.includes('promo--noimg'));
  const withImage = ui.promoHero([{ id: 'a', title: 'x', href: '#', image: 'assets/img/still_1.jpg' }]);
  assert.ok(!withImage.includes('promo--noimg'));
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

test('brandTile shows its real count and hrefs the brand filter', () => {
  const html = ui.brandTile({ key: 'kiriazi', name: 'كريازى', count: 12, href: 'shop.html?brand=kiriazi' });
  assert.ok(html.includes('12'));
  assert.ok(html.includes('كريازى'));
  assert.ok(html.includes('href="shop.html?brand=kiriazi"'));
});

// priceBands' contract: entries must be caller-built {key, label?, href} objects,
// not raw shop-core PRICE_BANDS entries ({key,min,max} — no href). Tasks 8/9 map
// PRICE_BANDS through a bandHref() helper before calling this. These two tests
// pin that contract independently of any caller.
test('priceBands renders the href and label the caller supplied', () => {
  const html = ui.priceBands([{ key: '0-5000', href: 'shop.html?max=5000' }], ['تحت ٥٬٠٠٠']);
  assert.ok(html.includes('href="shop.html?max=5000"'));
  assert.ok(html.includes('تحت ٥٬٠٠٠'));
});

test('priceBands renders an empty href when the caller omits one — documented behaviour, not a bug the signature can fix (frozen for Tasks 8/9)', () => {
  const html = ui.priceBands([{ key: '0-5000' }], ['تحت ٥٬٠٠٠']);
  assert.ok(html.includes('href=""'));
});

test('rail uses the supplied see-all label, defaulting to the current Arabic when none is given', () => {
  const htmlDefault = ui.rail('الأوفر', [P], 'shop.html?cat=38003882');
  assert.ok(htmlDefault.includes('شوف الكل'));
  const htmlCustom = ui.rail('Deals', [P], 'shop.html?cat=38003882', { more: 'See all' });
  assert.ok(htmlCustom.includes('See all'));
  assert.ok(!htmlCustom.includes('شوف الكل'));
});

const FDATA = {
  cats: [
    { id: '38003882', name: 'ثلاجات', count: 76, href: 'shop.html?cat=38003882' },
    { id: '77009911', name: 'غسالات', count: 40, href: 'shop.html?cat=77009911' }
  ],
  brands: [{ key: 'kiriazi', name: 'كريازى', count: 2 }, { key: '__none__', name: 'غير محدد', count: 1 }],
  bands: [{ key: '0-5000', label: 'تحت ٥٬٠٠٠', href: 'shop.html?max=5000' }]
};
const FLABELS = { cats: 'الفئة', brands: 'الماركة', price: 'السعر', clear: 'امسح الفلاتر' };

test('facets checks only the category row matching state.cat, not any other row', () => {
  // Deliberately targets FDATA.cats[1] (id 77009911), NOT cats[0] (38003882):
  // an "always check index 0" regression would happen to match cats[0]'s id and
  // pass a test that targeted it, exactly as toolbar's price-asc (option index 1,
  // not 0) test is sabotage-proof. Targeting the non-first row here closes the
  // same gap for facets.
  const html = ui.facets(core.parseState('?cat=77009911'), FDATA, FLABELS);
  // Independent of position/order: matches the exact matching-row markup, and
  // separately proves the non-matching row's markup carries no `checked` at all —
  // this fails if `checked` were hoisted onto every row (or the first row)
  // unconditionally, unlike a bare /checked/.test(html).
  assert.match(html, /<input type="radio" name="cat" value="77009911" checked>/);
  assert.doesNotMatch(html, /<input type="radio" name="cat" value="38003882"[^>]*checked/);
  assert.match(html, /<input type="radio" name="cat" value="38003882">/);
});

test('facets always offer the unspecified-brand bucket', () => {
  const html = ui.facets(core.parseState(''), FDATA, FLABELS);
  assert.ok(html.includes('__none__'));
  assert.ok(html.includes('غير محدد'));
});

test('facets escapes state.min/state.max so a crafted state cannot break out of the value attribute', () => {
  // state is documented as parseState's Number|null output, but facets(state,...)
  // takes it generically with no such guarantee at the call boundary. The attack
  // relies on an unescaped '"' to close the attribute early; esc() turns every
  // '"' into '&quot;', so the literal break-out sequence must never appear intact
  // even though harmless characters like '=' pass through unchanged.
  const html = ui.facets({ cat: '', brands: [], min: '1" onmouseover="alert(1)', max: null }, FDATA, FLABELS);
  assert.ok(!html.includes('value="1" onmouseover="alert(1)"'));
  assert.ok(html.includes('&quot;'));
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

test('toolbar reports the result count and selects only the option matching state.sort', () => {
  const html = ui.toolbar(core.parseState('?sort=price-asc'), 42, { count: n => n + ' منتج' });
  assert.ok(html.includes('42'));
  // Independent of position: pins `selected` to the price-asc option specifically
  // and proves the other two options carry no `selected` at all — this fails if
  // `selected` were hardcoded onto the first (or any fixed) option.
  assert.match(html, /<option value="price-asc" selected>/);
  assert.doesNotMatch(html, /<option value="default"[^>]*selected/);
  assert.doesNotMatch(html, /<option value="price-desc"[^>]*selected/);
});

test('toolbar uses supplied sort labels, defaulting to the current Arabic when omitted', () => {
  const L = { count: n => n + '' };
  const htmlDefault = ui.toolbar(core.parseState('?sort=price-asc'), 1, L);
  assert.ok(htmlDefault.includes('السعر: من الأقل للأعلى'));
  const htmlCustom = ui.toolbar(core.parseState('?sort=price-asc'), 1,
    { count: n => n + '', sorts: { 'price-asc': 'Price: low to high' } });
  assert.ok(htmlCustom.includes('Price: low to high'));
  assert.ok(!htmlCustom.includes('السعر: من الأقل للأعلى'));
  // Labels not overridden fall back to Arabic even when `sorts` supplies only one key.
  assert.ok(htmlCustom.includes('الترتيب الافتراضى'));
});
