// site/engine/shipping-regions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOVERNORATES, regionOf, metroKeyOf } from './shipping-regions.mjs';

const EXPECT = {
  metro: ['القاهرة', 'الجيزة', 'الإسكندرية'],
  delta: ['القليوبية', 'الشرقية', 'الدقهلية', 'الغربية', 'المنوفية', 'كفر الشيخ', 'دمياط', 'البحيرة',
          'بورسعيد', 'الإسماعيلية', 'السويس'],
  upper: ['الفيوم', 'بنى سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'الوادى الجديد',
          'مطروح', 'البحر الأحمر', 'الساحل الشمالى'],
};

test('every governorate lands in the region the Ecwid method names give it', () => {
  for (const [region, names] of Object.entries(EXPECT))
    for (const n of names) assert.equal(regionOf(n), region, n);
});

test('Sinai, «أخرى» and nonsense have no region, so the fee goes to customer care', () => {
  for (const n of ['شمال سيناء', 'جنوب سيناء', 'أخرى', '', null, undefined, 'Narnia'])
    assert.equal(regionOf(n), null, String(n));
});

test('the list checkout renders has all 28 entries, each labelled in both languages', () => {
  assert.equal(GOVERNORATES.length, 28);
  for (const g of GOVERNORATES) assert.ok(g.ar && g.en, JSON.stringify(g));
  assert.equal(GOVERNORATES.filter(g => g.region === null).length, 2);
});

// Review focus 1: profiles saved before this change hold other spellings.
test('spelling variants, English names and a «محافظة» prefix still resolve', () => {
  assert.equal(regionOf('بني سويف'), 'upper');
  assert.equal(regionOf('الاسكندريه'), 'metro');
  assert.equal(regionOf('محافظة الجيزة'), 'metro');
  assert.equal(regionOf('Cairo'), 'metro');
  assert.equal(regionOf('port said'), 'delta');
  assert.equal(regionOf('مرسى مطروح'), 'upper');
  assert.equal(regionOf('6 أكتوبر'), 'metro');
});

test('metroKeyOf picks which of the three metro methods applies', () => {
  assert.equal(metroKeyOf('القاهرة'), 'cairo');
  assert.equal(metroKeyOf('حلوان'), 'cairo');
  assert.equal(metroKeyOf('الجيزة'), 'giza');
  assert.equal(metroKeyOf('6 أكتوبر'), 'giza');
  assert.equal(metroKeyOf('الإسكندرية'), 'alex');
  assert.equal(metroKeyOf('سوهاج'), null);
});
