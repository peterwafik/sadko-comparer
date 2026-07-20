// site/engine/relevance.test.mjs
//
// isRelevant lives in compare-server.mjs, which starts an HTTP server as a
// side effect of module load. SADKO_NO_SERVE must be set BEFORE that module
// is imported, and a static `import` is hoisted above any assignment we could
// make here — so we set the env var first, then dynamically `await import(...)`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SADKO_NO_SERVE = '1';
const { isRelevant } = await import('../compare-server.mjs');

test('accessory word in a feature list (after the leading segment) is kept', () => {
  const q = 'TOSHIBA Refrigerator GR-RT468WE-PMN(49)-PRO, Inverter, Cooling Zone';
  const t = 'TOSHIBA Refrigerator GR-RT468WE-PMN(49)-PRO, Inverter, Cooling Zone, Pure BIO Filter, Tropical Compressor, Electronic temperature control, 3';
  assert.equal(isRelevant(t, q), true);
});

test('Arabic accessory word in a feature list (after a dash) is kept', () => {
  const q = 'مكنسة كهربائية سامسونج';
  const t = 'مكنسة كهربائية سامسونج 2000 وات - فلتر HEPA - كيس قماش';
  assert.equal(isRelevant(t, q), true);
});

test('a genuine water-filter accessory (Arabic) is still dropped', () => {
  const q = 'ثلاجة توشيبا';
  const t = 'فلتر مياه لثلاجة توشيبا';
  assert.equal(isRelevant(t, q), false);
});

test('a genuine water-filter accessory (English) is still dropped', () => {
  const q = 'TOSHIBA Refrigerator';
  const t = 'Water Filter for TOSHIBA Refrigerator GR-RT468WE';
  assert.equal(isRelevant(t, q), false);
});

test('a TV stand accessory is still dropped', () => {
  const q = 'شاشة سامسونج 55 بوصة';
  const t = 'حامل شاشة سامسونج 55 بوصة';
  assert.equal(isRelevant(t, q), false);
});

test('a phone back-cover accessory is still dropped', () => {
  const q = 'Samsung Galaxy S24';
  const t = 'Back Cover Case for Samsung Galaxy S24';
  assert.equal(isRelevant(t, q), false);
});

// regression guards — these behaviors must remain unchanged
test('regression: screen size mismatch is still dropped', () => {
  const q = 'شاشة شارب 75 بوصة 4K';
  const t = 'شاشة شارب 65 بوصة 4K';
  assert.equal(isRelevant(t, q), false);
});

test('regression: washing machine capacity mismatch is still dropped', () => {
  const q = 'غسالة توشيبا 8 كيلو';
  const t = 'غسالة توشيبا 10 كيلو';
  assert.equal(isRelevant(t, q), false);
});

test('regression: matching product with extra specs is still kept', () => {
  const q = 'شاشة شارب 75 بوصة';
  const t = 'شاشة شارب 75 بوصة 4K سمارت';
  assert.equal(isRelevant(t, q), true);
});
