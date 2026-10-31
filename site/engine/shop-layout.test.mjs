// site/engine/shop-layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_KEYS, defaultLayout, cleanLayout, pinOrder, publicLayout } from './shop-layout.mjs';

test('the default layout is today\'s shop page, in today\'s order', () => {
  const d = defaultLayout();
  assert.deepEqual(d.sections.map(s => s.key), ['brands', 'offers', 'adWide', 'categories', 'featured', 'bestSellers']);
  assert.ok(d.sections.every(s => s.on));
  assert.deepEqual(d.limits, { offers: 8, featured: 8, bestSellers: 8 });
  assert.equal(d.brands.mode, 'auto');
  assert.equal(d.brands.max, 12);
  assert.equal(d.categories.mode, 'auto');
  assert.deepEqual(SECTION_KEYS, d.sections.map(s => s.key).slice().sort((a, b) => SECTION_KEYS.indexOf(a) - SECTION_KEYS.indexOf(b)));
});

test('a saved order and switches survive; every section appears exactly once', () => {
  const l = cleanLayout({ sections: [{ key: 'bestSellers', on: true }, { key: 'brands', on: false }, { key: 'brands', on: true }, { key: 'nope', on: true }] });
  assert.deepEqual(l.sections.slice(0, 2), [{ key: 'bestSellers', on: true }, { key: 'brands', on: false }]);
  assert.equal(l.sections.length, SECTION_KEYS.length, 'missing sections are added back, switched on');
  assert.equal(new Set(l.sections.map(s => s.key)).size, SECTION_KEYS.length);
});

test('titles only for titled sections, trimmed and bounded', () => {
  const l = cleanLayout({ titles: { offers: { ar: ' عروض الأسبوع ', en: 'Weekly deals' }, adWide: { ar: 'x' }, brands: { ar: 'م'.repeat(200) } } });
  assert.deepEqual(l.titles.offers, { ar: 'عروض الأسبوع', en: 'Weekly deals' });
  assert.equal(l.titles.adWide, undefined);
  assert.equal(l.titles.brands.ar.length, 80);
});

test('limits are whole numbers from 1 to 24', () => {
  const l = cleanLayout({ limits: { offers: 3, featured: 0, bestSellers: 99 } });
  assert.deepEqual(l.limits, { offers: 3, featured: 1, bestSellers: 24 });
});

test('brands: mode, count, a unique picked list, and logos that can only be site images', () => {
  const l = cleanLayout({ brands: { mode: 'manual', max: 50, pick: ['kiriazi', 'kiriazi', 'سوكانى', ''],
    logos: { kiriazi: 'assets/img/brands/kiriazi.svg', 'سوكانى': 'data/uploads/pabc123.png', evil: 'https://x.y/z.png', bad: 'javascript:1' },
    names: { 'سوكانى': { ar: 'سوكانى', en: 'Sokany' } } } });
  assert.equal(l.brands.mode, 'manual');
  assert.equal(l.brands.max, 30);
  assert.deepEqual(l.brands.pick, ['kiriazi', 'سوكانى']);
  assert.deepEqual(l.brands.logos, { kiriazi: 'assets/img/brands/kiriazi.svg', 'سوكانى': 'data/uploads/pabc123.png' });
  assert.deepEqual(l.brands.names, { 'سوكانى': { ar: 'سوكانى', en: 'Sokany' } });
});

test('categories and pinned rail order take Ecwid ids only', () => {
  const l = cleanLayout({ categories: { mode: 'manual', pick: ['38003882', 'x', '38003882', '12'] }, order: { offers: ['1', '2', 'a'], bestSellers: [3], other: ['9'] } });
  assert.deepEqual(l.categories, { mode: 'manual', pick: ['38003882', '12'] });
  assert.deepEqual(l.order, { offers: ['1', '2'], bestSellers: ['3'] });
});

test('garbage in gives the default, never a throw', () => {
  assert.deepEqual(cleanLayout(null), defaultLayout());
  assert.deepEqual(cleanLayout('x'), defaultLayout());
  assert.deepEqual(cleanLayout({ sections: 'x', brands: 7 }), defaultLayout());
});

test('pinned products come first in the pinned order; the rest keep theirs; strangers are ignored', () => {
  assert.deepEqual(pinOrder(['a', 'b', 'c', 'd'], ['c', 'x', 'a']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(pinOrder(['a', 'b'], []), ['a', 'b']);
});

test('the public copy leaves out nothing the page needs and nothing it does not', () => {
  const p = publicLayout(cleanLayout({ brands: { mode: 'auto', max: 6 } }));
  assert.deepEqual(Object.keys(p).sort(), ['brands', 'categories', 'limits', 'sections', 'titles']);
  assert.equal(p.brands.max, 6);
  assert.equal(p.order, undefined, 'rail order is applied on the server, in collections.json');
});

/* ---- shop.js renders what the layout says ---- */
import { readFileSync } from 'node:fs';
const SHOP = readFileSync(new URL('../assets/js/shop.js', import.meta.url), 'utf8');

test('the shop page falls back to exactly the default order', () => {
  const m = /var HUB_SECTIONS = \[([^\]]*)\];/.exec(SHOP);
  assert.ok(m, 'HUB_SECTIONS is missing');
  assert.deepEqual(JSON.parse('[' + m[1].replace(/'/g, '"') + ']'), defaultLayout().sections.map(s => s.key));
});

test('every section the layout can name has a builder, and the hub follows the layout order', () => {
  const hub = SHOP.slice(SHOP.indexOf('function renderHub('), SHOP.indexOf('U.afterGrid(root);', SHOP.indexOf('function renderHub(')));
  for (const k of SECTION_KEYS) assert.ok(hub.includes(' ' + k + ': function () {'), k + ' has no builder');
  assert.match(hub, /var order = L && L\.sections \? L\.sections : HUB_SECTIONS/);
  assert.match(hub, /order\.filter\(function \(s\) \{ return s && s\.on !== false && BLOCKS\[s\.key\]; \}\)/);
});

test('the default still interleaves: every ad block sits between two rails', () => {
  const keys = defaultLayout().sections.map(s => s.key);
  for (const ad of ['adWide']) {
    const i = keys.indexOf(ad);
    assert.ok(i > 0 && i < keys.length - 1, ad + ' is at an end');
    assert.ok(!/^ad/.test(keys[i - 1]) && !/^ad/.test(keys[i + 1]), ad + ' is next to another ad');
  }
});

test('the rails take their size and title from the layout', () => {
  const rail = SHOP.slice(SHOP.indexOf('function collectionRail('), SHOP.indexOf('function collectionRail(') + 900);
  assert.match(rail, /\.slice\(0, railLimit\(key\)\)/);
  assert.match(rail, /sectionTitle\(key, col\.titleAr, col\.titleEn\)/);
});

test('a saved layout that still names the removed square ad tiles is cleaned of them', () => {
  const L = cleanLayout({ sections: [{ key: 'brands', on: true }, { key: 'adGrid', on: true }, { key: 'offers', on: true }] });
  assert.ok(!L.sections.some(s => s.key === 'adGrid'), 'adGrid survived cleaning');
  assert.ok(!SECTION_KEYS.includes('adGrid'));
});
