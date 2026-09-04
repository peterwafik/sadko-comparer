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
