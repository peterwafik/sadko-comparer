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
