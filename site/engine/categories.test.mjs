import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCategory, extractSpecs, CATEGORIES } from './categories.mjs';

test('detects category from the LEADING noun, not any substring', () => {
  // real title: a water cooler that mentions both شاشة (screen) and ثلاجة (fridge)
  const cooler = 'مبرد مياه كولدير 2 حنفية بارد / ساخن بالثلاجة شاشة ديجيتال اسود';
  assert.equal(detectCategory(cooler), 'cooler');

  assert.equal(detectCategory('ثلاجة تورنيدو انفرتر نوفروست 2 باب - 395 لتر'), 'fridge');
  assert.equal(detectCategory('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية'), 'washer');
  assert.equal(detectCategory('تكييف شارب اسبليت 2.25 حصان بارد - ساخن انفرتر'), 'ac');
  assert.equal(detectCategory('ميكروويف فريش 36 لتر ديجيتال بالجريل'), 'microwave');
  assert.equal(detectCategory('بوتاجاز لاجيرمانيا فري ستاند 90 × 60 سم 5 شعلة'), 'cooker');
  assert.equal(detectCategory('قلاية هوائية بيكو 4.7لتر'), 'fryer');
  assert.equal(detectCategory('سخان بلاطه سوكانى 500 وات'), 'heater');
  assert.equal(detectCategory('Sharp 75 inch 4K Smart TV'), 'tv');
  assert.equal(detectCategory('شاشة شارب 75 بوصة سمارت'), 'tv');
});

test('returns null for an unrecognised category', () => {
  assert.equal(detectCategory('كرسي مكتب جلد اسود'), null);
});

test('every category declares units and specs', () => {
  for (const [name, def] of Object.entries(CATEGORIES)) {
    assert.ok(Array.isArray(def.units), `${name}.units`);
    assert.ok(Array.isArray(def.specs), `${name}.specs`);
    assert.ok(def.names.length > 0, `${name}.names`);
  }
});

test('extractSpecs reads declared boolean specs', () => {
  const s = extractSpecs('ثلاجة تورنيدو انفرتر نوفروست 2 باب - 395 لتر', 'fridge');
  assert.equal(s.nofrost, true);
  assert.equal(s.doors, '2');

  const ac = extractSpecs('تكييف شارب اسبليت 2.25 حصان بارد - ساخن انفرتر', 'ac');
  assert.equal(ac.inverter, true);

  const tv = extractSpecs('Sharp 75 inch 4K Smart TV', 'tv');
  assert.equal(tv.resolution, '4k');
  assert.equal(tv.smart, true);
});
