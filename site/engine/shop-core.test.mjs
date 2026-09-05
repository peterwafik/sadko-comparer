// site/engine/shop-core.test.mjs
// shop-core.js is a classic browser script with a dual CommonJS export, so it
// is pulled in with createRequire rather than a static ESM import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../assets/js/shop-core.js');

test('parseState returns defaults for an empty query string', () => {
  const s = core.parseState('');
  assert.deepEqual(s, { cat: '', q: '', brands: [], min: null, max: null, sort: 'default', page: 1, all: false });
});

test('parseState reads every recognised parameter', () => {
  const s = core.parseState('?cat=38003882&q=%D8%AB%D9%84%D8%A7%D8%AC%D8%A9&brand=kiriazi,lg&min=5000&max=15000&sort=price-asc&page=3');
  assert.equal(s.cat, '38003882');
  assert.equal(s.q, 'ثلاجة');
  assert.deepEqual(s.brands, ['kiriazi', 'lg']);
  assert.equal(s.min, 5000);
  assert.equal(s.max, 15000);
  assert.equal(s.sort, 'price-asc');
  assert.equal(s.page, 3);
});

test('stateToSearch omits defaults', () => {
  const s = core.parseState('');
  s.cat = '38003882';
  assert.equal(core.stateToSearch(s), '?cat=38003882');
});

test('parseState and stateToSearch round-trip', () => {
  const original = '?cat=38003882&brand=kiriazi,lg&min=5000&sort=price-desc&page=2';
  const round = core.stateToSearch(core.parseState(original));
  assert.deepEqual(core.parseState(round), core.parseState(original));
});

test('page below 1 and non-numeric prices are rejected, not crashed on', () => {
  const s = core.parseState('?page=0&min=abc&max=-5');
  assert.equal(s.page, 1);
  assert.equal(s.min, null);
  assert.equal(s.max, null);
});

test('isBrowse is false for the bare hub and true for any recognised parameter', () => {
  assert.equal(core.isBrowse(core.parseState('')), false);
  assert.equal(core.isBrowse(core.parseState('?all=1')), true);
  assert.equal(core.isBrowse(core.parseState('?cat=38003882')), true);
  assert.equal(core.isBrowse(core.parseState('?q=lg')), true);
});

const SAMPLE = [
  { id: '1', title: 'ثلاجة كريازى 10 قدم', price: 15785, categoryId: '38003882' },
  { id: '2', title: 'ثلاجة كريازى 12 قدم', price: 21000, categoryId: '38003882' },
  { id: '3', title: 'غسالة LG 7 كيلو',     price: 9500,  categoryId: '38005652' },
  { id: '4', title: 'خلاط بدون ماركة',      price: 650,   categoryId: '112439376' }
];
// stand-in for window.skSpecs.of — returns no brand for product 4
const specOf = p => ({ brand: p.title.includes('كريازى') ? { ar: 'كريازى', en: 'Kiriazi', key: 'kiriazi' }
                        : p.title.includes('LG') ? { ar: 'إل جى', en: 'LG', key: 'lg' } : undefined });

test('liveCategories counts only categories that have products, count-desc', () => {
  const cats = core.liveCategories(SAMPLE);
  assert.deepEqual(cats, [
    { id: '38003882', count: 2 },
    { id: '38005652', count: 1 },
    { id: '112439376', count: 1 }
  ]);
});

test('brandsOf counts derivable brands and buckets the rest under __none__ last', () => {
  const brands = core.brandsOf(SAMPLE, specOf);
  assert.equal(brands[0].key, 'kiriazi');
  assert.equal(brands[0].count, 2);
  assert.equal(brands[brands.length - 1].key, '__none__');
  assert.equal(brands[brands.length - 1].count, 1);
});

test('PRICE_BANDS cover the catalogue range with no gaps and an open top band', () => {
  const b = core.PRICE_BANDS;
  assert.equal(b[0].min, 0);
  assert.equal(b[b.length - 1].max, null);
  for (let i = 1; i < b.length; i++) assert.equal(b[i].min, b[i - 1].max);
});

test('filter by category', () => {
  const s = core.parseState('?cat=38003882');
  assert.equal(core.filter(SAMPLE, s, specOf).length, 2);
});

test('filter by price range is inclusive of min and exclusive of max', () => {
  const s = core.parseState('?min=9500&max=21000');
  const ids = core.filter(SAMPLE, s, specOf).map(p => p.id);
  assert.deepEqual(ids, ['1', '3']);
});

test('an unbranded product survives an unrelated brand filter only via __none__', () => {
  const only = core.parseState('?brand=kiriazi');
  assert.deepEqual(core.filter(SAMPLE, only, specOf).map(p => p.id), ['1', '2']);
  const withNone = core.parseState('?brand=kiriazi,__none__');
  assert.deepEqual(core.filter(SAMPLE, withNone, specOf).map(p => p.id), ['1', '2', '4']);
});

test('an unbranded product is present when no brand filter is applied', () => {
  assert.ok(core.filter(SAMPLE, core.parseState(''), specOf).some(p => p.id === '4'));
});

test('search matches title case-insensitively', () => {
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=lg'), specOf).map(p => p.id), ['3']);
});

test('sortList does not mutate its input', () => {
  const before = SAMPLE.map(p => p.id);
  core.sortList(SAMPLE, 'price-asc');
  assert.deepEqual(SAMPLE.map(p => p.id), before);
});

test('sortList orders by price both ways', () => {
  assert.deepEqual(core.sortList(SAMPLE, 'price-asc').map(p => p.id), ['4', '3', '1', '2']);
  assert.deepEqual(core.sortList(SAMPLE, 'price-desc').map(p => p.id), ['2', '1', '3', '4']);
});

test('paginate reports totals and clamps an out-of-range page', () => {
  const r = core.paginate(SAMPLE, 99, 2);
  assert.equal(r.total, 4);
  assert.equal(r.pages, 2);
  assert.equal(r.page, 2);
  assert.deepEqual(r.items.map(p => p.id), ['3', '4']);
});

test('paginate on an empty list yields one page and no items', () => {
  const r = core.paginate([], 1, 24);
  assert.deepEqual(r, { items: [], page: 1, pages: 1, total: 0 });
});

/* ============================================================================
   Search (finding 1)
   ----------------------------------------------------------------------------
   The storefront rewrite dropped the search box and, with it, master's
   English-query-against-Arabic-title branch. SAMPLE below is Arabic-titled, the
   way the real 471-product catalogue is, so an English query can only match
   through the injected translator — these tests fail against a filter() that
   ignores `trTitle`.
   ========================================================================== */

// Stand-in for window.skCatalogI18n.translateTitle, matching only the two words
// it is asked about. Not an identity function: an implementation that forgot to
// call it, or called it with the wrong argument, gets nothing back.
const trTitle = s => s
  .replace('ثلاجة', 'Refrigerator')
  .replace('غسالة', 'Washing machine')
  .replace('كريازى', 'Kiriazi')
  // A token ONLY the translator can produce: "refrigerator" now reaches the Arabic
  // title through the search synonym table, and "kiriazi" reaches it through the
  // brand, so neither can prove any more that trTitle was consulted. "foot" can.
  .replace('قدم', 'foot');

test('an English query finds Arabic-titled products through the injected translator', () => {
  // Probes with "foot" rather than "refrigerator": the search synonym table now maps
  // fridge/refrigerator onto "ثلاجه" directly, and "kiriazi" reaches the same
  // products through the brand, so neither could fail the sanity check below any
  // more. "foot" is produced ONLY by the translator, so it still proves the trTitle
  // branch is wired.
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=foot'), specOf).map(p => p.id), []);
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=foot'), specOf, trTitle).map(p => p.id),
    ['1', '2']);
});

test('the English branch is case-insensitive and matches mid-title words', () => {
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=WASHING'), specOf, trTitle).map(p => p.id), ['3']);
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=Kiriazi'), specOf, trTitle).map(p => p.id), ['1', '2']);
});

test('an Arabic query still matches the raw title with a translator present', () => {
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=%D8%BA%D8%B3%D8%A7%D9%84%D8%A9'), specOf, trTitle).map(p => p.id), ['3']);
});

test('search also matches the description, not just the title', () => {
  const list = [{ id: 'd', title: 'جهاز', description: 'انفرتر موفر للكهرباء', price: 100, categoryId: '1' }];
  assert.equal(core.filter(list, core.parseState('?q=%D8%A7%D9%86%D9%81%D8%B1%D8%AA%D8%B1'), specOf).length, 1);
});

test('a query no side matches returns nothing rather than everything', () => {
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=zzzz'), specOf, trTitle), []);
});

test('a throwing translator degrades to "no English match", it does not empty the results', () => {
  const boom = () => { throw new Error('translator blew up'); };
  // the Arabic side still matches …
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=%D8%BA%D8%B3%D8%A7%D9%84%D8%A9'), specOf, boom).map(p => p.id), ['3']);
  // … and a translator-only query simply finds nothing instead of throwing.
  // "foot" for the same reason as above: no synonym entry and no brand match, so a
  // dead translator really does mean no match.
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=foot'), specOf, boom), []);
});

/* ============================================================================
   Advanced search
   ========================================================================== */

test('Arabic normalisation folds alef, teh marbuta and alef maksura', () => {
  // the catalogue writes "ثلاجة"; a shopper types "ثلاجه" — and vice versa
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=%D8%AB%D9%84%D8%A7%D8%AC%D9%87'), specOf).map(p => p.id), ['1', '2']);
  assert.equal(core.norm('أسود'), core.norm('اسود'));
  assert.equal(core.norm('كريازى'), core.norm('كريازي'));
  assert.equal(core.norm('ثلاجــة'), 'ثلاجه');            // tatweel stripped
  assert.equal(core.norm('مُبَرِّد'), 'مبرد');              // harakat stripped
});

test('Arabic-Indic digits search the same as ASCII digits', () => {
  assert.equal(core.norm('١٠ قدم'), '10 قدم');
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=10'), specOf).map(p => p.id), ['1']);
});

test('multiple words must ALL match, in any order and across fields', () => {
  // "ثلاجة" is in the title, "kiriazi" only in the brand — both must hit
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=kiriazi%20%D8%AB%D9%84%D8%A7%D8%AC%D8%A9'), specOf).map(p => p.id),
    ['1', '2']);
  // order is irrelevant
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=%D8%AB%D9%84%D8%A7%D8%AC%D8%A9%20kiriazi'), specOf).map(p => p.id),
    ['1', '2']);
  // a second word that matches nothing narrows to empty rather than being ignored
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=kiriazi%20zzz'), specOf), []);
});

test('the brand is searchable even though it is not in the title', () => {
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=kiriazi'), specOf).map(p => p.id), ['1', '2']);
  // product 4 has no derivable brand and must not match a brand query
  assert.ok(!core.filter(SAMPLE, core.parseState('?q=lg'), specOf).some(p => p.id === '4'));
});

test('synonyms bridge English and Arabic without the translator', () => {
  // the everyday words a shopper actually types
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=fridge'), specOf).map(p => p.id), ['1', '2']);
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=washer'), specOf).map(p => p.id), ['3']);
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=blender'), specOf).map(p => p.id), ['4']);
});

// Precision guard. A synonym asserts what a product IS, so it is matched only
// against the identity fields (title, translated title, brand) — never the
// description, where other categories get mentioned in passing. Against the real
// catalogue, expanding "tv" into the description via "شاشة" (display) returned 128
// products of which only 32 were televisions: blenders and water coolers included.
test('a synonym does not match via the description, only the typed word does', () => {
  const list = [
    { id: 'tv', title: 'تليفزيون سامسونج 43 بوصة', description: 'جهاز عرض', price: 9000, categoryId: 'a' },
    { id: 'blender', title: 'خلاط ميانتا 500 وات', description: 'بشاشه رقميه لعرض السرعه', price: 650, categoryId: 'b' }
  ];
  // "tv" expands to شاشه — which appears only in the blender's DESCRIPTION, so the
  // blender must not come back
  assert.deepEqual(core.filter(list, core.parseState('?q=tv'), specOf).map(p => p.id), ['tv']);
  // …but a literal word is still searched for in the description. Probed with
  // "رقميه", which is in no synonym group: typing "شاشه" itself would legitimately
  // return the television too, since that word IS the group's Arabic member.
  assert.deepEqual(core.filter(list, core.parseState('?q=%D8%B1%D9%82%D9%85%D9%8A%D9%87'), specOf).map(p => p.id), ['blender']);
});

test('a short latin token matches as a whole word, not inside a model code', () => {
  const list = [
    { id: 'real', title: 'تليفزيون TV سمارت', description: '', price: 9000, categoryId: 'a' },
    { id: 'code', title: 'خلاط موديل BTVX-9', description: '', price: 650, categoryId: 'b' }
  ];
  assert.deepEqual(core.filter(list, core.parseState('?q=tv'), specOf).map(p => p.id), ['real']);
});

test('a quoted phrase must match as a run, not as separate words', () => {
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=%22%D8%AB%D9%84%D8%A7%D8%AC%D8%A9%20%D9%83%D8%B1%D9%8A%D8%A7%D8%B2%D9%89%22'), specOf).map(p => p.id),
    ['1', '2']);
  // the same two words in the wrong order are not a phrase match
  assert.deepEqual(
    core.filter(SAMPLE, core.parseState('?q=%22%D9%83%D8%B1%D9%8A%D8%A7%D8%B2%D9%89%20%D8%AB%D9%84%D8%A7%D8%AC%D8%A9%22'), specOf), []);
});

test('a -term excludes matching products', () => {
  assert.deepEqual(core.filter(SAMPLE, core.parseState('?q=fridge%20-12'), specOf).map(p => p.id), ['1']);
});

test('parseQuery separates terms, phrases and exclusions', () => {
  const q = core.parseQuery('fridge "10 قدم" -lg');
  assert.equal(q.phrases.length, 1);
  assert.deepEqual(q.not, ['lg']);
  assert.ok(q.must.length === 1 && q.must[0].indexOf('ثلاجه') >= 0,
    'fridge should expand to its Arabic synonym');
});

test('an empty or whitespace query still matches everything', () => {
  assert.equal(core.filter(SAMPLE, core.parseState('?q=%20%20'), specOf).length, SAMPLE.length);
  assert.equal(core.matchesQuery(SAMPLE[0], '', null, specOf), true);
});

test('the translator is never consulted when there is no query', () => {
  let calls = 0;
  const counting = s => { calls++; return s; };
  assert.equal(core.filter(SAMPLE, core.parseState(''), specOf, counting).length, SAMPLE.length);
  assert.equal(calls, 0);
});

test('search composes with category, brand and price rather than replacing them', () => {
  // "Kiriazi" translates onto products 1 and 2; the price window keeps only 1.
  const s = core.parseState('?q=foot&cat=38003882&brand=kiriazi&min=9000&max=20000');
  assert.deepEqual(core.filter(SAMPLE, s, specOf, trTitle).map(p => p.id), ['1']);
});

test('q survives the URL round-trip so a search is shareable', () => {
  const s = core.parseState('?q=fridge&cat=38003882&page=2');
  assert.equal(core.stateToSearch(s), '?cat=38003882&q=fridge&page=2');
  assert.equal(core.parseState(core.stateToSearch(s)).q, 'fridge');
});

test('a bare ?q= selects browse over the hub', () => {
  assert.equal(core.isBrowse(core.parseState('?q=fridge')), true);
  assert.equal(core.isBrowse(core.parseState('')), false);
});

/* ============================================================================
   bandCounts (extracted from shop.js's liveBands)
   ========================================================================== */

test('bandCounts uses filter()\'s own min-inclusive / max-exclusive boundaries', () => {
  const onBoundary = [
    { id: 'a', title: 'x', price: 5000, categoryId: '1' },
    { id: 'b', title: 'x', price: 4999, categoryId: '1' },
    { id: 'c', title: 'x', price: 15000, categoryId: '1' },
    { id: 'd', title: 'x', price: 30000, categoryId: '1' }
  ];
  const counts = core.bandCounts(onBoundary);
  assert.deepEqual(counts.map(b => b.count), [1, 1, 1, 1]);
  // and each count equals what selecting that band actually filters to
  counts.forEach(b => {
    const state = Object.assign(core.parseState(''), { min: b.min, max: b.max });
    assert.equal(core.filter(onBoundary, state, specOf).length, b.count, b.key);
  });
});

test('bandCounts keeps every band, including empty ones, for the caller to prune', () => {
  assert.equal(core.bandCounts([]).length, core.PRICE_BANDS.length);
  assert.deepEqual(core.bandCounts([]).map(b => b.count), [0, 0, 0, 0]);
});

/* ============================================================================
   localizePromos (finding 7)
   ----------------------------------------------------------------------------
   The old shop.js fallback was `x.titleEn || x.title`, which rendered Arabic to
   an English shopper for any promo the (owner-editable, unvalidated) promos.json
   had not fully translated.
   ========================================================================== */

const AR_RE = /[\u0600-\u06FF]/;
const PROMO = { id: 'p1', sample: true, accent: 'teal', href: '#',
                title: 'ركن الغسيل', titleEn: 'The laundry corner',
                sub: '٤٩ غسالة', subEn: '49 washing machines',
                cta: 'تسوّق', ctaEn: 'Shop washing machines' };

test('localizePromos leaves the list untouched in Arabic mode', () => {
  const out = core.localizePromos([PROMO], false);
  assert.equal(out[0].title, 'ركن الغسيل');
  assert.equal(out[0].sub, '٤٩ غسالة');
});

test('localizePromos swaps in every *En field in English mode', () => {
  const out = core.localizePromos([PROMO], true);
  assert.equal(out[0].title, 'The laundry corner');
  assert.equal(out[0].sub, '49 washing machines');
  assert.equal(out[0].cta, 'Shop washing machines');
  assert.ok(!AR_RE.test(out[0].title + out[0].sub + out[0].cta));
});

test('localizePromos does not mutate the promo it was given', () => {
  const input = { ...PROMO };
  core.localizePromos([input], true);
  assert.equal(input.title, 'ركن الغسيل');
  assert.equal(input.sub, '٤٩ غسالة');
});

test('a promo with no titleEn is dropped in English, never shown in Arabic', () => {
  const untranslated = { id: 'p2', title: 'عرض بدون ترجمة', sub: 'وصف', cta: 'اشتر' };
  const dropped = [];
  const out = core.localizePromos([PROMO, untranslated], true, x => dropped.push(x.id));
  assert.deepEqual(out.map(x => x.id), ['p1']);
  assert.deepEqual(dropped, ['p2']);
  // the whole rendered payload must carry no Arabic at all
  assert.ok(!AR_RE.test(JSON.stringify(out.map(x => [x.title, x.sub, x.cta]))));
});

test('a missing subEn/ctaEn drops just that line instead of falling back to Arabic', () => {
  const partial = { id: 'p3', title: 'عنوان', titleEn: 'Title', sub: 'وصف عربى', cta: 'اشتر' };
  const out = core.localizePromos([partial], true);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Title');
  assert.equal(out[0].sub, undefined);
  assert.equal(out[0].cta, undefined);
  assert.ok(!('sub' in out[0]));
  assert.ok(!('cta' in out[0]));
});

test('localizePromos passes a null/non-array payload straight through', () => {
  assert.equal(core.localizePromos(null, true), null);
  assert.equal(core.localizePromos(undefined, true), undefined);
});

/* The shipped data must never need the drop path above: every promo is fully
   bilingual. This is the validation promos.json never had.

   The `sample: true` assertion that used to sit here is gone ON PURPOSE. It
   existed because the file held seeded placeholder campaigns that must never read
   as live offers. The file now holds SADKO's own artwork, downloaded from the
   company's live homepage — real campaigns, so marking them "sample content" would
   itself be the false statement. What replaces it: provenance must be recorded
   (where the artwork came from and when), the sample marker must still be honoured
   if anyone re-seeds placeholder content, and the ban on invented commercial
   fields stays exactly as strict. */
/* collections.json backs the "Hot offers" / "Best sellers" rails. Those names are
   claims, and the catalogue cannot support them: products.json has no discount,
   sales-rank or date field. They are only honest because the ids come from SADKO's
   own live offers and best-sellers pages, so the file must record where and when,
   must be bilingual, and must not reference a product the shop cannot render. */
test('data/collections.json is provenanced, bilingual and resolvable', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const read = f => JSON.parse(readFileSync(join(here, '../data/' + f), 'utf8'));
  const data = read('collections.json');
  const known = new Set(read('products.json').products.map(p => String(p.id)));

  assert.match(String(data.captured), /^\d{4}-\d{2}-\d{2}$/, 'no capture date');
  assert.ok(data.sources && Object.keys(data.sources).length, 'no sources recorded');
  const cols = data.collections;
  assert.ok(cols && Object.keys(cols).length, 'no collections');
  for (const [key, col] of Object.entries(cols)) {
    assert.ok(data.sources[key], key + ': no source URL recorded for this claim');
    assert.ok(col.titleAr, key + ': missing Arabic title');
    assert.ok(col.titleEn, key + ': missing English title');
    assert.ok(!AR_RE.test(col.titleEn), key + ': titleEn contains Arabic');
    assert.ok(Array.isArray(col.ids) && col.ids.length, key + ': no ids');
    const missing = col.ids.filter(id => !known.has(String(id)));
    assert.equal(missing.length, 0, key + ': ids not in the catalogue: ' + missing.slice(0, 3));
  }
});

test('every promo in data/promos.json carries its English counterparts', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(readFileSync(join(here, '../data/promos.json'), 'utf8'));
  assert.ok(Array.isArray(data.promos) && data.promos.length, 'promos.json has no promos');
  // Provenance: the artwork is someone's real campaign, so the file has to say
  // whose and as of when, or nobody can tell later whether an ad is still current.
  assert.ok(data.source, 'promos.json does not record where the artwork came from');
  assert.match(String(data.captured), /^\d{4}-\d{2}-\d{2}$/, 'promos.json has no capture date');
  for (const promo of data.promos) {
    assert.ok(promo.title, promo.id + ': no Arabic title');
    assert.ok(promo.titleEn, promo.id + ': missing titleEn');
    if (promo.sub) assert.ok(promo.subEn, promo.id + ': has sub but no subEn');
    if (promo.cta) assert.ok(promo.ctaEn, promo.id + ': has cta but no ctaEn');
    // The message is printed inside the artwork, so `alt` is the ONLY thing a
    // screen-reader user or an English shopper gets from it.
    assert.ok(promo.alt, promo.id + ': no alt text for the artwork');
    assert.ok(promo.altEn, promo.id + ': missing altEn');
    for (const k of ['titleEn', 'subEn', 'ctaEn', 'altEn']) {
      if (promo[k]) assert.ok(!AR_RE.test(promo[k]), promo.id + ': ' + k + ' contains Arabic');
    }
    // If anyone re-seeds placeholder content, it must still say so.
    if ('sample' in promo) assert.equal(promo.sample, true, promo.id + ': sample must be true or absent');
    // No invented commercial claims, exactly as strict as before.
    for (const k of ['was', 'wasPrice', 'discount', 'percent', 'price', 'rating', 'stock']) {
      assert.ok(!(k in promo), promo.id + ': forbidden field ' + k);
    }
  }
  // and nothing is dropped when the real file is localised
  assert.equal(core.localizePromos(data.promos, true).length, data.promos.length);
});
