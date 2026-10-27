// site/engine/specs-brand.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../assets/js/specs.js');
const brand = b => S.derive({ id: 1, title: 'x', brand: b }).brand;

test('a registered English brand keeps every letter (the "s" was being stripped)', () => {
  assert.deepEqual(brand('Samsung'), { en: 'Samsung', ar: 'سامسونج' });
  assert.deepEqual(brand('Toshiba'), { en: 'Toshiba', ar: 'توشيبا' });
  assert.deepEqual(brand('Sokany  Plus'), { en: 'Sokany Plus', ar: 'Sokany Plus' }, 'spaces collapse, letters stay');
});

test('Arabic spelling variants (ي/ى, ة/ه, أ/ا) still find the known brand', () => {
  assert.deepEqual(brand('كريازي'), { en: 'Kiriazi', ar: 'كريازي' });
  assert.deepEqual(brand('كريازى'), { en: 'Kiriazi', ar: 'كريازي' });
  assert.deepEqual(brand('زانوسى'), { en: 'Zanussi', ar: 'زانوسي' });
  assert.deepEqual(brand('اريستون'), { en: 'Ariston', ar: 'أريستون' });
});

test('an unknown registered brand is shown as typed rather than dropped', () => {
  assert.deepEqual(brand('سوكانى'), { en: 'سوكانى', ar: 'سوكانى' });
});

test('brands still come from the title when none is registered', () => {
  assert.equal(S.derive({ id: 1, title: 'ثلاجة كريازى ١٦ قدم' }).brand.en, 'Kiriazi');
  assert.equal(S.derive({ id: 1, title: 'Fresh Fan 18' }).brand.en, 'Fresh');
});
