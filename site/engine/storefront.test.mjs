// site/engine/storefront.test.mjs
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
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

/* ------------------------------------------------------- rail arrows --- */

// The native scrollbar under every rail was the one piece of chrome belonging to
// no design system. It is replaced by two arrows — and their sides are PHYSICAL:
// "‹" left, "›" right, in Arabic and English alike, because the arrow points at
// where the strip will travel on screen and that does not flip with the script.
test('rail renders a slider with a left and a right arrow', () => {
  const html = ui.rail('T', [P], '', {});
  assert.match(html, /class="rail__slider"/, 'the track is not wrapped in a slider');
  assert.match(html, /rail__nav--l[^>]*data-rail="-1"/, 'no left arrow, or it does not step backwards');
  assert.match(html, /rail__nav--r[^>]*data-rail="1"/, 'no right arrow, or it does not step forwards');
  // the glyphs, and their order in the markup
  assert.ok(html.indexOf('rail__nav--l') < html.indexOf('rail__nav--r'));
  assert.ok(html.includes('‹') && html.includes('›'));
});

test('the arrow sides are pinned physically, not with logical properties', () => {
  // inset-inline-start/end would swap the arrows in Arabic; left/right must not.
  const nav = CSS.slice(CSS.indexOf('.rail__nav--l'), CSS.indexOf('.rail__nav--l') + 200);
  assert.match(nav, /\.rail__nav--l \{ left:/, 'the left arrow is not pinned with `left`');
  assert.match(nav, /\.rail__nav--r \{ right:/, 'the right arrow is not pinned with `right`');
  assert.ok(!/\.rail__nav--[lr] \{ inset-inline/.test(CSS),
    'an arrow is pinned with a logical property — it will swap sides in Arabic');
  // and the glyph must not inherit the LTR mirror the breadcrumb chevron uses
  assert.match(CSS, /\.rail__nav i \{ display: block; transform: none;/);
});

test('the banner arrows are pinned the same way as the rail arrows', () => {
  // The ad hero is a second carousel with its own controls; it kept the old
  // direction-sensitive treatment (inset-inline + an LTR scaleX flip) after the
  // rails were converted, which put `›` on the left of every banner.
  assert.match(CSS, /\.adhero__nav--prev \{ left:/, 'the previous-banner arrow is not pinned with `left`');
  assert.match(CSS, /\.adhero__nav--next \{ right:/, 'the next-banner arrow is not pinned with `right`');
  assert.ok(!/\.adhero__nav--(prev|next) \{ inset-inline/.test(CSS),
    'a banner arrow is pinned with a logical property — it will swap sides in Arabic');
  assert.ok(!/html\[dir="?ltr"?\] \.adhero__nav i/.test(CSS),
    'the banner glyphs are still mirrored in LTR — that swaps the two arrows');
});

test('neither carousel lets the bidi algorithm mirror its arrow glyphs', () => {
  // U+2039/U+203A are Bidi_Mirrored: inside an RTL paragraph the engine draws `‹`
  // as `›` by itself, so pinning the buttons physically is not enough — the glyph
  // has to sit in its own LTR run or Arabic shows both arrows pointing inward.
  for (const sel of ['.rail__nav i', '.adhero__nav i']) {
    const rule = CSS.slice(CSS.indexOf(sel + ' {'), CSS.indexOf(sel + ' {') + 160);
    assert.match(rule, /direction: ltr/, sel + ' does not force an LTR run');
    assert.match(rule, /unicode-bidi: isolate/, sel + ' does not isolate its bidi run');
  }
});

test('the rail scrollbar is hidden in every engine', () => {
  const track = CSS.slice(CSS.indexOf('.rail__track {'), CSS.indexOf('.rail__track > .card'));
  assert.match(track, /scrollbar-width: none/, 'Firefox would still draw a scrollbar');
  assert.match(track, /-ms-overflow-style: none/, 'old Edge would still draw a scrollbar');
  assert.match(CSS, /\.rail__track::-webkit-scrollbar \{[^}]*height: 0/, 'WebKit/Blink would still draw a scrollbar');
  // the strip must still be scrollable by wheel/touch — only the bar is gone
  assert.match(track, /overflow-x: auto/);
});

test('the arrow labels are bilingual', () => {
  const ar = ui.rail('T', [P], '', {});
  assert.ok(/aria-label="حرّك لليسار"/.test(ar) && /aria-label="حرّك لليمين"/.test(ar));
  const en = inEN(() => ui.rail('T', [P], '', {}));
  assert.ok(/aria-label="Scroll left"/.test(en) && /aria-label="Scroll right"/.test(en));
  assert.ok(!/حرّك/.test(en), 'Arabic label left on the English arrows');
});

/* ---------------------------------------------- card layout regressions --- */

// The bug this pins: .card__row used to hold the price AND the buy link, and
// nav.js's enhanceCategoryCards() then appended "Details" and "Add to cart" into
// that same flex row. Four controls fought over ~306px — measured live, the
// details link collapsed to 65px across three wrapped lines and the add button to
// 49px across four. .card__row is the element nav.js appends into, so it must stay
// the ACTION container only; the price sits outside it.
test('the price is not inside .card__row (which nav.js fills with buttons)', () => {
  const html = ui.card(P, {});
  const row = html.slice(html.indexOf('<div class="card__row">'));
  assert.ok(!row.includes('card__price'),
    '.card__price is back inside .card__row — the action row will crowd again');
  assert.ok(html.indexOf('card__price') < html.indexOf('card__row'),
    'the price should render above the action row');
});

test('.card__row ships exactly one action, leaving room for nav.js to append two', () => {
  const html = ui.card(P, {});
  const row = html.slice(html.indexOf('<div class="card__row">'));
  assert.equal((row.match(/<a /g) || []).length, 1,
    '.card__row should contain only the buy link at render time');
  assert.match(row, /class="card__buy"/);
});

// 193 of the 471 catalogue products carry HTML entities as literal text, so
// esc()ing without decoding first rendered "Giza &amp;amp; Alex" on the card.
test('clean() decodes the entities the scraped catalogue actually contains', () => {
  assert.equal(ui.clean('Cairo, Giza &amp; Alex'), 'Cairo, Giza & Alex');
  assert.equal(ui.clean('كولدير&nbsp;2 حنفية'), 'كولدير 2 حنفية');
  assert.equal(ui.clean('a &#39;b&#39; c'), "a 'b' c");
  assert.equal(ui.clean('&quot;x&quot;'), '"x"');
});

test('clean() leaves an unknown entity verbatim rather than guessing', () => {
  assert.equal(ui.clean('50 &deg; &widget;'), '50 &deg; &widget;');
});

// Decoding must never be able to inject live markup: every consumer escapes.
test('a decoded entity is re-escaped by card(), not emitted as markup', () => {
  const html = ui.card(Object.assign({}, P, { title: '&lt;script&gt;x&lt;/script&gt;' }), {});
  assert.ok(!html.includes('<script>'), 'decoded markup reached the card unescaped');
  assert.ok(html.includes('&lt;script&gt;'), 'the title should render as visible text');
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

/* A card used to href p.url — Ecwid's own storefront page — so clicking any
   product left the site. Both links now go to the site's product page, and
   NEITHER may contain the Ecwid host. */
test('card__imgwrap hrefs the site product page, not Ecwid', () => {
  const html = ui.card(P, {});
  assert.match(html, /class="card__imgwrap" href="product\.html\?id=157676934"/);
  assert.ok(!html.includes('example.test/p'), 'the card still links out to Ecwid');
});

test('card__buy hrefs the site product page too', () => {
  const html = ui.card(P, {});
  assert.match(html, /class="card__buy" href="product\.html\?id=157676934"/);
});

test('the buy link does not open a new tab — it is the same site now', () => {
  assert.ok(!/card__buy[^>]*target="_blank"/.test(ui.card(P, {})));
});

test('an explicit opts.href still wins', () => {
  assert.match(ui.card(P, { href: 'shop.html?x=1' }), /class="card__imgwrap" href="shop\.html\?x=1"/);
});

test('the product id is URL-encoded into the href', () => {
  /* Ecwid ids are numeric, but a seed/derived id must not break the query. */
  assert.match(ui.card({ ...P, id: 'a b&c' }, {}), /href="product\.html\?id=a%20b%26c"/);
});

test('a product with no id falls back to its catalogue url rather than a dead link', () => {
  const html = ui.card({ ...P, id: '' }, {});
  assert.match(html, /class="card__imgwrap" href="https:\/\/example\.test\/p"/);
});

test('nav.js resolves a card by data-id, so the internal href cannot break add-to-cart', () => {
  /* This is the pairing the change depends on: if nav.js went back to
     resolving only by pathname, every card would lose its add-to-cart. */
  const nav = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/js/nav.js'), 'utf8');
  const fn = /function enhanceCategoryCards\(\)[\s\S]{0,2000}/.exec(nav)[0];
  assert.match(fn, /byId\[String\(card\.getAttribute\('data-id'\)/);
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
    assert.match(html, /class="card__buy"[^>]*>اعرض المنتج</);
    assert.ok(!html.includes('View product'));
  } finally {
    if (savedWindow === undefined) delete global.window;
    else global.window = savedWindow;
  }
});

// EN mode: the card's link must read the English default, never the Arabic
// literal, and an explicit opts.buyLabel must still win over both defaults.
// The label reads "View product" because that is where it now goes — the
// site's own product page. It used to say "Buy now ↗" and jump to Ecwid.
test('card in EN mode uses the English link label by default, and honours an explicit override', () => {
  const savedWindow = global.window;
  global.window = { skLang: { get: () => 'en' } };
  try {
    const html = ui.card(P, {});
    assert.match(html, /class="card__buy"[^>]*>View product</);
    assert.ok(!html.includes('اعرض المنتج'));
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

// The brand row sits high on the page — on a phone it is the first band under the
// search box — so the marks that are on screen when it renders must not wait on an
// intersection. The ones past the visible strip still do.
test('the first brand marks load eagerly and the rest stay lazy', () => {
  const b = { key: 'kiriazi', name: 'كريازى', count: 12, href: '#', logo: 'assets/img/brands/kiriazi.svg' };
  assert.ok(!/loading="lazy"/.test(ui.brandTile(b, 0)), 'the first mark is lazy — it will pop in');
  assert.ok(!/loading="lazy"/.test(ui.brandTile(b, 3)));
  assert.match(ui.brandTile(b, 4), /loading="lazy"/, 'every mark is eager — the whole row downloads up front');
  // called without an index (a direct caller, not .map) it must not go lazy either
  assert.ok(!/loading="lazy"/.test(ui.brandTile(b)));
  // a brand with no logo still renders the wordmark disc and asks for nothing
  assert.match(ui.brandTile({ key: 'x', name: 'X', count: 1, href: '#' }, 0), /btile__mark--nologo/);
  assert.ok(!/<img/.test(ui.brandTile({ key: 'x', name: 'X', count: 1, href: '#' }, 0)));
});

// The manifest is what stops the row asking for twelve logos that are not there.
// If it names a file that was never committed, the tile 404s into the wordmark
// fallback and nobody notices until someone looks at the shop.
test('every logo the manifest names is actually committed', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../assets/img/brands');
  const manifest = JSON.parse(readFileSync(join(dir, 'logos.json'), 'utf8'));
  assert.equal(typeof manifest.logos, 'object');
  assert.ok(!Array.isArray(manifest.logos), 'the manifest is back to a bare key list — file names are lost');
  const keys = Object.keys(manifest.logos);
  assert.ok(keys.length >= 12, 'expected a logo per brand tile, got ' + keys.length);
  for (const k of keys) {
    const f = manifest.logos[k];
    assert.match(f, /^[a-z0-9._-]+\.(png|svg|webp)$/i, k + ' names something that is not a plain image file: ' + f);
    assert.ok(existsSync(join(dir, f)), 'logos.json lists ' + f + ' for "' + k + '" but that file is not committed');
  }
});

// The row shows the twelve biggest brands, and a brand with no logo renders as a
// bare text disc among eleven logos. LG did exactly that: the logos had been
// chosen from the seed catalogue, where LG is not in the top twelve, while in the
// live Ecwid catalogue it is 6th. The live catalogue is not in git, so its row is
// pinned by name as well as by what the seed catalogue computes.
test('every brand that reaches the brand row has a logo', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../assets/img/brands');
  const logos = JSON.parse(readFileSync(join(dir, 'logos.json'), 'utf8')).logos;
  const prev = globalThis.window;
  globalThis.window = {};
  try {
    require('../assets/js/specs.js');
    const S = globalThis.window.skSpecs;
    const seed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../data/products.json'), 'utf8')).products;
    const row = core.brandsOf(seed, p => S.of(p)).filter(b => b.key !== '__none__').slice(0, 12).map(b => b.key);
    // The live catalogue's row on 2026-09-28, with Gree and Panasonic trading the 12th place.
    const live = ['tornado', 'fresh', 'toshiba', 'kiriazi', 'sharp', 'lg', 'beko', 'zanussi', 'samsung', 'midea', 'haier', 'gree', 'panasonic'];
    for (const k of new Set([...row, ...live])) {
      assert.ok(logos[k], 'the brand row shows "' + k + '" but logos.json has no logo for it');
    }
  } finally { globalThis.window = prev; }
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
  assert.ok(htmlDefault.includes('عرض الكل'));
  const htmlCustom = ui.rail('Deals', [P], 'shop.html?cat=38003882', { more: 'See all' });
  assert.ok(htmlCustom.includes('See all'));
  assert.ok(!htmlCustom.includes('عرض الكل'));
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
   promoHero()'s sample marker (not overridable) was live in English. promoHero
   itself has since been removed with the seeded sample promos — the point stands
   for every default that remains.
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
  assert.ok(html.includes('عرض الكل'));
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
   Stylesheet-level assertions
   ----------------------------------------------------------------------------
   Some layout guarantees live only in CSS, where no renderer can be asked about
   them. These read the stylesheet directly and say so.

   (The promo-grid tests that used to sit here went with promoHero: the seeded
   sample promos it rendered — a text overlay on a coloured panel — were replaced
   by SADKO's own campaign artwork, which carries its message inside the image.
   adHero/adSlot render the artwork alone, so there is no overlay grid left to
   leave a hole in.)
   ========================================================================== */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/css/storefront.css'), 'utf8');


test('the compact pager form is the one shown at the mobile breakpoint', () => {
  const base = CSS.slice(0, CSS.indexOf('@media (max-width: 860px)'));
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 860px)'));
  // desktop: numbers visible, status hidden
  assert.match(base, /\.pager__status \{ display: none;/);
  // mobile: the reverse — exactly one of the two forms is ever on screen
  assert.match(mobile, /\.pager__pgs \{ display: none; \}/);
  assert.match(mobile, /\.pager__status \{ display: inline-flex; \}/);
});

/* ------------------------------------------------ phone: brand strip --- */

const CAT_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/css/category.css'), 'utf8');
const NAV_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/js/nav.js'), 'utf8');

// A wrapping grid only ever fit two brand marks across a 360-400px phone, so a
// dozen brands cost six rows of scrolling before the first product appeared.
test('on phones the brand row is one swipeable strip of three', () => {
  // The brand strip's own 640px block (the section jump bar has an earlier one).
  const i = CSS.search(/@media \(max-width: 640px\) \{\s*\.btiles \{/);
  assert.ok(i > CSS.indexOf('@media (max-width: 480px)'),
    'the phone brand block must come AFTER the 480px block or that one wins');
  const phone = CSS.slice(i);
  assert.match(phone, /\.btiles \{[^}]*grid-auto-flow: column/,
    'the brand row still wraps instead of scrolling sideways');
  assert.match(phone, /grid-auto-columns: calc\(\(100% - 2 \* var\(--sk-gap-sm\)\) \/ 3\)/,
    'the column width no longer resolves to exactly three across the viewport');
  assert.match(phone, /\.btiles \{[^}]*overflow-x: auto/);
  // no scrollbar — the swipe is the affordance, same as the product rails
  assert.match(phone, /\.btiles \{[^}]*scrollbar-width: none/);
  assert.match(phone, /\.btiles::-webkit-scrollbar \{[^}]*height: 0/);
  // and the 480px block must no longer re-grid .btiles underneath it
  const narrow = CSS.slice(CSS.indexOf('@media (max-width: 480px)'), i);
  assert.ok(!/\.btiles/.test(narrow),
    'the 480px block still sets .btiles — two rules fighting over the same row');
});

// The hidden label is position:absolute; with no positioned ancestor it resolves
// against the initial containing block, escapes the strip's clip, and lands
// ~1400px out — which dragged the whole document into horizontal scroll.
test('the brand tile is a containing block for its visually-hidden label', () => {
  const tile = CSS.slice(CSS.indexOf('.btile {'), CSS.indexOf('.btile__mark {'));
  assert.match(tile, /position: relative/,
    '.btile is not positioned — the hidden .btile__name will escape the strip');
  assert.match(CSS, /\.btile__mark--nologo ~ \.btile__name \{\s*position: absolute/,
    'this test guards an absolutely-positioned label that no longer exists');
});

/* ------------------------------------------------- phone: card actions --- */

// flex-wrap has to change WITH the direction: in a column container the main axis
// is vertical, so the primary button's `flex: 1 1 100%` claimed the row's whole
// height and pushed the two quiet links into a second column, off the side of a
// 160px card. Only the amber button was visible.
test('on phones the three card actions stack and stay inside the card', () => {
  const phone = CAT_CSS.slice(CAT_CSS.indexOf('@media (max-width: 640px)'));
  assert.match(phone, /\.card__row \{[^}]*flex-direction: column/);
  assert.match(phone, /\.card__row \{[^}]*flex-wrap: nowrap/,
    'a column flex container that still wraps pushes the extra actions sideways');
  assert.match(phone, /\.card__row \.sk-addbtn,\s*\.card__row \.sk-detbtn,\s*\.card__row \.card__buy \{ flex: 0 0 auto/,
    'the row-direction flex sizing is not reset, so an action can still claim the height');
  // and the primary shrinks — it is no longer carrying the row on its own
  const base = CAT_CSS.slice(0, CAT_CSS.indexOf('@media (max-width: 640px)'));
  const basePad = /\.card__row \.sk-addbtn \{[^}]*padding: (\d+)px/.exec(base);
  const phonePad = /\.card__row \.sk-addbtn \{ font-size: [^;]+; padding: (\d+)px/.exec(phone);
  assert.ok(basePad && phonePad, 'could not read the primary button padding on both sides');
  assert.ok(Number(phonePad[1]) < Number(basePad[1]),
    'the phone primary button is not smaller than the desktop one');
});

/* ---------------------------------------------- phone: nav clearance --- */

// Two rules cleared the same fixed strap: a margin AND a padding whose fallback
// nav height (86px) is only right on desktop. On a phone that stacked 64 + 106px
// of dead space above a 62px strap.
test('the phone strap is cleared once, not twice', () => {
  const mobile = NAV_JS.slice(NAV_JS.indexOf('@media (max-width:1080px){'));
  const rule = /\.sk-nav--solid\+\*\{margin-top:64px;padding-top:(\d+)px!important;\}/.exec(mobile);
  assert.ok(rule, 'the phone rule no longer pins its own padding, so the 86px desktop fallback returns');
  // the gap above the first block should read like the rhythm below it, not like
  // a second strap's worth of margin
  assert.ok(Number(rule[1]) <= 32,
    'the phone clearance padding is back above the section rhythm (' + rule[1] + 'px)');
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

/* ======================================================================
   Advert artwork must not be cropped.

   Both advert frames used `object-fit: cover`, which fills by trimming
   whatever does not fit — and an advert is a composed image with its own
   headline, logo and call to action baked in, so cover was removing part of
   the message. A 1284x1437 upload in a 1:1 tile lost about 11% of its
   height, whatever the designer had put at the top or bottom.
   ================================================================== */

test('advert artwork FILLS its frame rather than cropping to it', () => {
  for (const sel of ['.adhero__slide img', '.adslot__ad img']) {
    /* Sliced by indexOf rather than a built regex — the same idiom the arrow
       tests above use, and it needs no selector escaping. */
    const at = CSS.indexOf(sel + ' {');
    assert.ok(at > -1, 'the rule for ' + sel + ' is gone');
    const m = [CSS.slice(at, CSS.indexOf('}', at) + 1)];
    assert.match(m[0], /object-fit:\s*fill/, sel + ' does not fill its frame: ' + m[0]);
    assert.ok(!/object-fit:\s*cover/.test(m[0]), sel + ' crops the artwork again');
  }
});

test('an advert frame still pins an aspect ratio, so a row stays even', () => {
  /* Without it, three uploads of different shapes would make a ragged row —
     which is why the ratio is fixed per layout and the IMAGE stretches to it
     rather than the frame growing to the image. */
  assert.match(CSS, /\.adslot--grid \.adslot__ad \{ aspect-ratio: 1 \/ 1; \}/);
  assert.match(CSS, /\.adslot--solo \.adslot__ad \{ aspect-ratio: 1600 \/ 608; \}/);
  assert.match(CSS, /\.adhero \{[^}]*aspect-ratio: 1600 \/ 608/);
});

test('the recommended upload ratios are written where the rule is', () => {
  /* "fill" only distorts when the upload does not match the frame, so the
     ratio that avoids it has to be findable by whoever prepares artwork. */
  assert.match(CSS, /1600x608/);
  assert.match(CSS, /1:1/);
});

test('PRODUCT photos are still contained, never stretched', () => {
  /* The opposite trade: a distorted appliance is a misrepresentation, and a
     product photo carries no baked-in text to lose. */
  for (const sel of ['.pdp__frame img', '.pdp__thumb img']) {
    /* Sliced by indexOf rather than a built regex — the same idiom the arrow
       tests above use, and it needs no selector escaping. */
    const at = CSS.indexOf(sel + ' {');
    assert.ok(at > -1, 'the rule for ' + sel + ' is gone');
    const m = [CSS.slice(at, CSS.indexOf('}', at) + 1)];
    assert.match(m[0], /object-fit:\s*contain/, sel + ' should contain, not ' + m[0]);
  }
});
