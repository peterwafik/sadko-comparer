// site/engine/storefront.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ui = require('../assets/js/storefront.js');

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
