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

test('detects new appliance categories: iron, hob, food_processor, hand_mixer', () => {
  assert.equal(detectCategory('مكواة بخار فيليبس 2400 وات'), 'iron');
  assert.equal(detectCategory('مسطح طباخ اريستون 60 سم 4 شعلة غاز'), 'hob');
  assert.equal(detectCategory('محضر طعام كينوود متعدد الاستخدامات 1.5 لتر'), 'food_processor');
  assert.equal(detectCategory('قطاعة كبة ستانلس'), 'food_processor');
  assert.equal(detectCategory('مضرب بيض كهربائي فيليبس 300 وات'), 'hand_mixer');
  assert.equal(detectCategory('هاند بلندر براون 600 وات'), 'hand_mixer');

  const iron = extractSpecs('مكواة بخار فيليبس 2400 وات', 'iron');
  assert.equal(iron.steam, true);

  const hob = extractSpecs('مسطح طباخ اريستون 60 سم 4 شعلة غاز', 'hob');
  assert.equal(hob.burners, '4');
  assert.equal(hob.fuel, 'gas');
});

test('spelling variants of existing categories are recognised', () => {
  assert.equal(detectCategory('تكيف يورك 1.5 حصان بارد فقط'), 'ac');
  assert.equal(detectCategory('ميكرويف توشيبا 20 لتر'), 'microwave');
  assert.equal(detectCategory('مايكرويف شارب 25 لتر ديجيتال'), 'microwave');
  assert.equal(detectCategory('كاتيل كهربائي بلاستيك 1.7 لتر'), 'kettle');
});

test('fan type spec matches Arabic and returns the canonical English value', () => {
  assert.equal(extractSpecs('مروحة عمود توشيبا 16 بوصة', 'fan').type, 'stand');
  assert.equal(extractSpecs('مروحة حائط توشيبا 16 بوصة', 'fan').type, 'wall');
  assert.equal(extractSpecs('مروحة سقف توشيبا', 'fan').type, 'ceiling');
  assert.equal(extractSpecs('مروحة مكتب صغيرة', 'fan').type, 'desk');
  assert.equal(extractSpecs('مروحة ستاند توشيبا', 'fan').type, 'stand');
});
