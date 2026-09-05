// site/engine/storefront.test.mjs
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/* ============================================================================
   Bilingual defaults (Task 12)
   ----------------------------------------------------------------------------
   Every default string this module can emit on its own — with no caller-supplied
   label at all — must be correct in BOTH languages. Three of them were Arabic-only
   and shipped as latent bugs: rail()'s see-all label and toolbar()'s sort options
   were masked because every current caller happens to pass an override, and
   promoHero()'s sample marker (deliberately not overridable) was live in English.
   These tests remove the mask: they call each renderer with NO labels at all.
   ========================================================================== */

// isEN() reads window.skLang, so EN mode is simulated exactly the way the existing
// card() language tests above do it — set global.window, restore it in `finally`.
function inEN(fn) {
  const savedWindow = global.window;
  global.window = { skLang: { get: () => 'en' } };
  try { return fn(); } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
}

const AR = /[؀-ۿ]/;

test('rail default see-all label is English in EN mode — no override supplied', () => {
  const html = inEN(() => ui.rail('Best value', [P], 'shop.html?cat=38003882'));
  const more = html.match(/<a class="rail__more"[^>]*>([^<]*)<\/a>/);
  assert.ok(more, 'rail__more link missing');
  assert.equal(more[1], 'See all');
  assert.ok(!AR.test(more[1]), 'Arabic leaked into the EN see-all label');
});

test('rail default see-all label is still Arabic when no window/skLang says otherwise', () => {
  const html = ui.rail('الأوفر', [P], 'shop.html?cat=38003882');
  assert.ok(html.includes('شوف الكل'));
});

test('rail honours an explicit labels.more override in EN mode too', () => {
  const html = inEN(() => ui.rail('Best value', [P], 'shop.html?cat=1', { more: 'Browse all' }));
  assert.ok(html.includes('Browse all'));
  assert.ok(!html.includes('See all'));
});

test('toolbar default sort labels are English in EN mode — no sorts map supplied', () => {
  const html = inEN(() => ui.toolbar(core.parseState(''), 3, { count: n => n + ' products' }));
  const opts = [...html.matchAll(/<option value="([a-z-]+)"[^>]*>([^<]*)<\/option>/g)]
    .map(m => [m[1], m[2]]);
  assert.deepEqual(opts, [
    ['default', 'Default order'],
    ['price-asc', 'Price: low to high'],
    ['price-desc', 'Price: high to low'],
  ]);
  for (const [, label] of opts) assert.ok(!AR.test(label), 'Arabic leaked into an EN sort label: ' + label);
});

test('toolbar default sort labels stay Arabic outside EN mode', () => {
  const html = ui.toolbar(core.parseState(''), 3, { count: n => n + ' منتج' });
  assert.ok(html.includes('الترتيب الافتراضى'));
  assert.ok(html.includes('السعر: من الأقل للأعلى'));
  assert.ok(html.includes('السعر: من الأعلى للأقل'));
});

test('toolbar sorts override still wins in EN mode, per key, over the EN defaults', () => {
  const html = inEN(() => ui.toolbar(core.parseState(''), 1,
    { count: n => n + '', sorts: { 'price-asc': 'Cheapest first' } }));
  assert.ok(html.includes('Cheapest first'));
  assert.ok(!html.includes('Price: low to high'));
  // the keys it did not override fall back to the EN defaults, not the Arabic ones
  assert.ok(html.includes('Default order'));
  assert.ok(html.includes('Price: high to low'));
});

test('promoHero sample marker is readable in EN — the honesty warning must not be Arabic-only', () => {
  const html = inEN(() => ui.promoHero([{ id: 'a', title: 'Kitchen', href: 'shop.html?cat=1', sample: true }]));
  const marker = html.match(/<span class="promo__sample">([^<]*)<\/span>/);
  assert.ok(marker, 'sample marker missing in EN mode');
  assert.equal(marker[1], 'Sample content');
  assert.ok(!AR.test(marker[1]));
});

test('promoHero sample marker stays Arabic outside EN mode, and is still not caller-overridable', () => {
  // `labels`-style keys on the promo itself must not be able to suppress or reword it
  const html = ui.promoHero([{ id: 'a', title: 'تكييفات', href: '#', sample: true, sampleLabel: 'Deal' }]);
  assert.ok(html.includes('<span class="promo__sample">محتوى تجريبي</span>'));
  assert.ok(!html.includes('Deal'));
});

test('no renderer emits an Arabic default when the page language is English', () => {
  // A single sweep over every string this module can produce with no labels at all.
  const html = inEN(() =>
    ui.breadcrumb([{ label: 'Home', href: '/' }, { label: 'Shop' }]) +
    ui.promoHero([{ id: 'a', title: 'Kitchen', sub: 'Sub', cta: 'Go', href: '#', sample: true }]) +
    ui.categoryTile({ name: 'Refrigerators', count: 76, href: '#' }) +
    ui.brandTile({ name: 'Kiriazi', count: 58, href: '#' }) +
    ui.priceBands([{ key: '0-5000', href: '#' }], ['Under 5,000']) +
    ui.rail('Best value', [{ ...P, title: 'Fridge', description: 'desc' }], '#') +
    ui.toolbar(core.parseState(''), 5, { count: n => n + ' products' }) +
    ui.pager(1, 3, n => '?page=' + n)
  );
  // P's own title/description are Arabic catalogue data, not module defaults — strip
  // the card bodies before asserting, so this test fails only on chrome we author.
  const chrome = html.replace(/<article class="card"[\s\S]*?<\/article>/g, '');
  assert.ok(!AR.test(chrome), 'Arabic default leaked into EN chrome: ' +
    (chrome.match(/[^<>]*[؀-ۿ][^<>]*/) || [''])[0]);
});

/* ============================================================================
   Search box (finding 1)
   ----------------------------------------------------------------------------
   The rewrite shipped shop.html with no search input at all, which made the ?q=
   plumbing in shop-core/shop.js unreachable. The control belongs in the browse
   toolbar, so these assert it is really there, carries the current term, and is
   named exactly what parseState()/stateToSearch() round-trip.
   ========================================================================== */

test('searchBox renders a real search input named q', () => {
  const html = ui.searchBox('');
  assert.match(html, /<input type="search"[^>]*\bid="q"/);
  assert.match(html, /<input type="search"[^>]*\bname="q"/);
  assert.match(html, /<form class="ssearch"[^>]*role="search"/);
  assert.match(html, /<button type="submit"/);
});

test('searchBox shows the active term so a shopper can see and refine it', () => {
  assert.match(ui.searchBox('ثلاجة'), /value="ثلاجة"/);
  // an absent term is an empty field, not the string "undefined" or "null"
  assert.match(ui.searchBox(undefined), /value=""/);
  assert.match(ui.searchBox(null), /value=""/);
});

test('searchBox escapes a term that would otherwise break out of the attribute', () => {
  const html = ui.searchBox('" onfocus="alert(1)');
  assert.ok(!html.includes('" onfocus="alert(1)"'));
  assert.ok(html.includes('&quot;'));
});

test('searchBox is bilingual: Arabic by default, English under skLang=en', () => {
  const ar = ui.searchBox('');
  const ph = ar.match(/placeholder="([^"]*)"/)[1];
  const al = ar.match(/aria-label="([^"]*)"/)[1];
  assert.ok(AR.test(ph), 'Arabic placeholder expected, got: ' + ph);
  assert.ok(AR.test(al), 'Arabic aria-label expected, got: ' + al);

  const en = inEN(() => ui.searchBox(''));
  const enPh = en.match(/placeholder="([^"]*)"/)[1];
  const enAl = en.match(/aria-label="([^"]*)"/)[1];
  const enBtn = en.match(/<button type="submit"[^>]*>([^<]*)<\/button>/)[1];
  assert.ok(!AR.test(enPh), 'Arabic leaked into the EN placeholder: ' + enPh);
  assert.ok(!AR.test(enAl), 'Arabic leaked into the EN aria-label: ' + enAl);
  assert.ok(!AR.test(enBtn), 'Arabic leaked into the EN submit label: ' + enBtn);
  assert.ok(enPh.length && enAl.length && enBtn.length);
});

test('searchBox labels are caller-overridable through L.search', () => {
  const html = ui.searchBox('', { search: { placeholder: 'Find a fridge', label: 'Find', submit: 'Go' } });
  assert.ok(html.includes('placeholder="Find a fridge"'));
  assert.ok(html.includes('aria-label="Find"'));
  assert.ok(html.includes('>Go</button>'));
});

test('toolbar carries the search box alongside the count and sort', () => {
  const html = ui.toolbar(core.parseState('?q=%D8%AB%D9%84%D8%A7%D8%AC%D8%A9'), 12, { count: n => n + ' منتج' });
  assert.match(html, /<form class="ssearch"/);
  // and it is populated from state.q, not blanked on every render
  assert.match(html, /<input type="search"[^>]*value="ثلاجة"/);
  assert.ok(html.includes('12'));
  assert.ok(html.includes('id="sortSel"'));
});

test('toolbar renders an empty search field when no term is active', () => {
  const html = ui.toolbar(core.parseState(''), 471, { count: n => n + ' منتج' });
  assert.match(html, /<input type="search"[^>]*value=""/);
});

/* ============================================================================
   Compact pager (finding 5)
   ----------------------------------------------------------------------------
   Spec §7: numbered on desktop, "prev / صفحة N من M / next" at ≤860px. 20 pills
   measured 347×130px on a 393px phone. One markup, one mechanism; storefront.css
   shows exactly one of the two forms per breakpoint.
   ========================================================================== */

test('pager emits prev/next steps and a page-of-pages status alongside the numbers', () => {
  const html = ui.pager(2, 5, n => '?page=' + n);
  assert.match(html, /class="pager__step pager__step--prev"[^>]*href="\?page=1"/);
  assert.match(html, /class="pager__step pager__step--next"[^>]*href="\?page=3"/);
  assert.match(html, /<span class="pager__status">صفحة 2 من 5<\/span>/);
  // the numbered form is still present for desktop, inside its own hideable box
  assert.match(html, /<span class="pager__pgs">/);
  assert.ok(html.includes('aria-current="page"'));
});

test('pager disables prev on the first page and next on the last, with no href to click', () => {
  const first = ui.pager(1, 5, n => '?page=' + n);
  assert.match(first, /<span class="pager__step pager__step--prev is-off" aria-disabled="true">/);
  assert.doesNotMatch(first, /pager__step--prev"[^>]*href/);
  assert.match(first, /class="pager__step pager__step--next"[^>]*href="\?page=2"/);

  const last = ui.pager(5, 5, n => '?page=' + n);
  assert.match(last, /<span class="pager__step pager__step--next is-off" aria-disabled="true">/);
  assert.doesNotMatch(last, /pager__step--next"[^>]*href/);
  assert.match(last, /class="pager__step pager__step--prev"[^>]*href="\?page=4"/);
});

test('pager status and step labels are English under skLang=en', () => {
  const html = inEN(() => ui.pager(3, 7, n => '?page=' + n));
  const status = html.match(/<span class="pager__status">([^<]*)<\/span>/)[1];
  assert.equal(status, 'Page 3 of 7');
  assert.ok(!AR.test(html.replace(/<span class="pager__pgs">[\s\S]*?<\/span>/, '')),
    'Arabic leaked into the EN pager');
});

test('pager labels are caller-overridable, status included', () => {
  const html = ui.pager(2, 4, n => '?page=' + n,
    { pager: { prev: 'Back', next: 'Forward', status: (a, b) => a + '/' + b } });
  assert.ok(html.includes('>Back</a>'));
  assert.ok(html.includes('>Forward</a>'));
  assert.ok(html.includes('<span class="pager__status">2/4</span>'));
});

test('pager still renders nothing at all for a single page — no orphan prev/next', () => {
  assert.equal(ui.pager(1, 1, n => '?page=' + n), '');
});

/* ============================================================================
   Promo grid arrangement (finding 2)
   ----------------------------------------------------------------------------
   Three promos in a bare 2fr/1fr grid auto-place into r1c1, r1c2, r2c1 and leave
   a reserved, empty r2c2 — measured 440×200px at 1440px. promoHero publishes the
   count as a class (no :has(); older Android/Safari would ignore it silently) and
   storefront.css keys the arrangement off it. Both halves are asserted, because
   either one alone would let the hole come back.
   ========================================================================== */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/css/storefront.css'), 'utf8');
const promo = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, title: 'Promo ' + i, href: '#' }));

test('promoHero publishes the promo count as a class on the grid container', () => {
  assert.match(ui.promoHero(promo(1)), /<div class="promos promos--n1">/);
  assert.match(ui.promoHero(promo(2)), /<div class="promos promos--n2">/);
  assert.match(ui.promoHero(promo(3)), /<div class="promos promos--n3">/);
  assert.match(ui.promoHero(promo(5)), /<div class="promos promos--many">/);
});

test('the count class counts RENDERED promos, not raw input rows', () => {
  // a title-less promo is filtered out, so the class must not claim three
  const html = ui.promoHero([{ id: 'a', title: 'A' }, { id: 'b' }, { id: 'c', title: 'C' }]);
  assert.match(html, /<div class="promos promos--n2">/);
  assert.equal((html.match(/<a class="promo /g) || []).length, 2);
});

test('storefront.css defines an arrangement for every count class promoHero can emit', () => {
  for (const cls of ['promos--n1', 'promos--n2', 'promos--n3', 'promos--many']) {
    assert.ok(CSS.includes('.' + cls), 'storefront.css has no rule for .' + cls);
  }
});

test('the three-promo layout spans the first slot down both rows, so no cell is left empty', () => {
  // The hole was structural: 3 items, 2 columns, nothing occupying r2c2. The row
  // span on the first promo is what turns that into one large + a stacked pair.
  const rule = CSS.match(/\.promos--n3 > \.promo:first-child \{([^}]*)\}/);
  assert.ok(rule, '.promos--n3 > .promo:first-child rule missing');
  assert.match(rule[1], /grid-row:\s*1\s*\/\s*span 2/);
  const grid = CSS.match(/\.promos--n3 \{([^}]*)\}/);
  assert.ok(grid, '.promos--n3 rule missing');
  assert.match(grid[1], /grid-template-columns:\s*2fr 1fr/);
  assert.match(grid[1], /grid-template-rows:\s*1fr 1fr/);
});

test('the single-column mobile breakpoint releases the row span', () => {
  // Left in place, the span would stretch the first promo over two auto rows in a
  // one-column stack. The reset must live inside the ≤860px block.
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 860px)'));
  assert.match(mobile, /\.promos--n3 > \.promo:first-child \{ grid-row: auto; \}/);
  assert.match(mobile, /\.promos--n3[^{]*\{[^}]*grid-template-columns: 1fr/);
});

test('the compact pager form is the one shown at the mobile breakpoint', () => {
  const base = CSS.slice(0, CSS.indexOf('@media (max-width: 860px)'));
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 860px)'));
  // desktop: numbers visible, status hidden
  assert.match(base, /\.pager__status \{ display: none;/);
  // mobile: the reverse — exactly one of the two forms is ever on screen
  assert.match(mobile, /\.pager__pgs \{ display: none; \}/);
  assert.match(mobile, /\.pager__status \{ display: inline-flex; \}/);
});

/* ============================================================================
   One English name per category (finding 6)
   ----------------------------------------------------------------------------
   Three maps decide what a category is called in English:
     · appshell.js CATS      -> the browse facet rail and the PDP breadcrumb
     · nav.js CAT_EN         -> the shop menu and translateCategoryPage()'s <title>
     · mkcategories.mjs      -> each generated page's data-cat-name-en
   They disagreed on the same id (Washing machines/Washers, Televisions/TVs,
   Cookers & ovens/Ovens & Cookers, and four more on empty categories), so the
   name changed under a shopper clicking from the facet rail into the category
   page. appshell.js is the authority — it is what is already live site-wide.
   This test is source-level and says so; it exists because the three maps have
   no runtime relationship that could otherwise catch the drift.
   ========================================================================== */

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(SITE, f), 'utf8');

// appshell.js: "'38005652':  { ar: '…', en: '…' },"
function appshellCats(src) {
  const out = {};
  const block = src.slice(src.indexOf('const CATS = {'), src.indexOf('const catName'));
  for (const m of block.matchAll(/'(\d+)':\s*\{\s*ar:\s*'([^']*)',\s*en:\s*'([^']*)'\s*\}/g)) {
    out[m[1]] = { ar: m[2], en: m[3] };
  }
  return out;
}
// a named "'<arabic>': '<english>'" map, read out of one const block
function pairs(src, startMarker, endMarker) {
  const block = src.slice(src.indexOf(startMarker), src.indexOf(endMarker, src.indexOf(startMarker)));
  const out = {};
  for (const m of block.matchAll(/'([^']+)':\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

const APPSHELL = appshellCats(read('assets/js/appshell.js'));
const MK_SRC = read('mkcategories.mjs');
const MK_NAMES = pairs(MK_SRC, 'const NAMES = {', '};');
const MK_EN = pairs(MK_SRC, 'const CAT_EN = {', '};');
const NAV_EN = pairs(read('assets/js/nav.js'), 'const CAT_EN = {', '};');

test('the category-name extractors actually found the three maps', () => {
  // guards the test itself: a regex that silently matched nothing would make
  // every assertion below vacuously true.
  assert.ok(Object.keys(APPSHELL).length >= 19, 'appshell CATS: ' + Object.keys(APPSHELL).length);
  assert.ok(Object.keys(MK_NAMES).length === 30, 'mkcategories NAMES: ' + Object.keys(MK_NAMES).length);
  assert.ok(Object.keys(MK_EN).length >= 30, 'mkcategories CAT_EN: ' + Object.keys(MK_EN).length);
  assert.equal(APPSHELL['38005652'].en, 'Washing machines');
});

test('every category appshell.js names in English is named identically by the generated pages', () => {
  const seen = [];
  for (const id of Object.keys(APPSHELL)) {
    const ar = MK_NAMES[id];
    assert.ok(ar, 'mkcategories NAMES has no id ' + id);
    assert.equal(MK_EN[ar], APPSHELL[id].en,
      'id ' + id + ': category page says "' + MK_EN[ar] + '", the facet rail says "' + APPSHELL[id].en + '"');
    seen.push(id);
  }
  assert.ok(seen.length >= 19);
});

test('nav.js CAT_EN agrees too, so the <title> matches the page it titles', () => {
  // translateCategoryPage() rewrites <title> from nav.js's map while shop.js
  // renders the heading from data-cat-name-en; a divergence shows up as a tab
  // titled "Washers" above a page headed "Washing machines".
  for (const id of Object.keys(APPSHELL)) {
    assert.equal(NAV_EN[MK_NAMES[id]], APPSHELL[id].en, 'nav.js CAT_EN disagrees for id ' + id);
  }
});

test('mkcategories CAT_EN stays a verbatim copy of nav.js CAT_EN', () => {
  assert.deepEqual(MK_EN, NAV_EN);
});

test('no two category nodes share an English name', () => {
  // "غسالات" taking appshell's "Washing machines" would otherwise collide with its
  // own child "غسالات ملابس", listing the same label twice in the shop menu.
  const byEn = {};
  for (const [ar, en] of Object.entries(NAV_EN)) (byEn[en] = byEn[en] || []).push(ar);
  const dupes = Object.entries(byEn).filter(([, list]) => list.length > 1);
  assert.deepEqual(dupes, [], 'duplicate English category names: ' + JSON.stringify(dupes));
});

/* ============================================================================
   Generated category page shape
   ----------------------------------------------------------------------------
   shop.js reads data-cat / data-cat-name / data-cat-name-en off #shop-root, and
   the storefront depends on the category.css -> app.css -> storefront.css load
   order. Neither was guarded by anything.
   ========================================================================== */

test('a generated category page carries the attributes shop.js reads', () => {
  const html = read('category/38005652.html');
  assert.match(html, /<main id="shop-root" data-cat="38005652" data-cat-name="غسالات" data-cat-name-en="Washing machines">/);
});

test('every generated category page keeps the load-bearing stylesheet order', () => {
  const { readdirSync } = require('node:fs');
  const files = readdirSync(join(SITE, 'category')).filter(f => f.endsWith('.html'));
  assert.equal(files.length, 30);
  for (const f of files) {
    const html = read('category/' + f);
    const order = [...html.matchAll(/<link rel="stylesheet" href="\.\.\/assets\/css\/([a-z]+)\.css/g)].map(m => m[1]);
    assert.deepEqual(order, ['category', 'app', 'storefront'], f + ' stylesheet order: ' + order.join(' -> '));
    // and the page must be able to render the browse view at all
    assert.ok(html.includes('assets/js/shop-core.js'), f + ' missing shop-core.js');
    assert.ok(html.includes('assets/js/storefront.js'), f + ' missing storefront.js');
    assert.ok(html.includes('assets/js/shop.js'), f + ' missing shop.js');
  }
});
