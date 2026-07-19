// site/engine/units.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUnits } from './units.mjs';

test('extracts Arabic units with and without spaces', () => {
  assert.equal(extractUnits('ثلاجة تورنيدو 395 لتر').liter, 395);
  assert.equal(extractUnits('قلاية هوائية بيكو اسود4.7لتر سعة سلة3.9لتر1500وات').liter, 4.7);
  assert.equal(extractUnits('قلاية هوائية بيكو اسود4.7لتر 1500وات').watt, 1500);
  assert.equal(extractUnits('غسالة توشيبا 8 كيلو اتوماتيك').kg, 8);
  assert.equal(extractUnits('غسالة زانوسى 7 ك ديجيتال 1200 لفة').kg, 7);
  assert.equal(extractUnits('غسالة زانوسى 7 ك ديجيتال 1200 لفة').rpm, 1200);
});

test('extracts English units and bilingual run-together titles', () => {
  assert.equal(extractUnits('Sharp 75 inch 4K Smart TV').inch, 75);
  assert.equal(extractUnits('Kiriazi Refrigerator E280 - 2 Doors 10 Feetثلاجة كريازى 10 قدم').feet, 10);
  assert.equal(extractUnits('Kiriazi KAC 18 CH Split Air Conditioner – 2.25 HP').hp, 2.25);
  assert.equal(extractUnits('تكييف شارب اسبليت 2.25 حصان بارد').hp, 2.25);
});

test('handles Arabic-Indic digits', () => {
  assert.equal(extractUnits('شاشة شارب ٧٥ بوصة').inch, 75);
});

test('does not invent units that are absent', () => {
  const u = extractUnits('تلفزيون سامسونج سمارت');
  assert.equal(Object.keys(u).length, 0);
});

test('dimension pairs do not produce a bogus single value', () => {
  // "90 × 60 سم" is a size pair, not one cm measurement
  assert.equal(extractUnits('بوتاجاز فري ستاند 90 × 60 سم 5 شعلة').cm, undefined);
});
