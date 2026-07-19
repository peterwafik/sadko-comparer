import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, sameProduct } from './matcher.mjs';

const id = t => identify(t);

test('identical model numbers are exact matches across languages', () => {
  const a = id('ثلاجة تورنيدو 2 باب انفرتر نوفروست 355 لتر – اسود RF-40FTV-BK');
  const b = id('Tornado Refrigerator No Frost 355L Black RF – 40 FTV – BK');
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'exact');
});

test('different capacity means different product — washers', () => {
  const a = id('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية');
  const b = id('غسالة توشيبا 10 كيلو اتوماتيك فتحة علوية');
  assert.equal(sameProduct(a, b).same, false);
});

test('different size means different product — TVs', () => {
  const a = id('شاشة شارب 75 بوصة 4K سمارت');
  const b = id('شاشة شارب 65 بوصة 4K سمارت');
  assert.equal(sameProduct(a, b).same, false);
});

test('different horsepower means different product — AC', () => {
  const a = id('تكييف شارب اسبليت 2.25 حصان بارد ساخن انفرتر');
  const b = id('تكييف شارب اسبليت 3 حصان بارد ساخن انفرتر');
  assert.equal(sameProduct(a, b).same, false);
});

test('different storage means different product — phones', () => {
  const a = id('موبايل سامسونج 128 جيجا');
  const b = id('موبايل سامسونج 256 جيجا');
  assert.equal(sameProduct(a, b).same, false);
});

test('different brand is never the same product', () => {
  const a = id('غسالة توشيبا 8 كيلو');
  const b = id('غسالة زانوسي 8 كيلو');
  assert.equal(sameProduct(a, b).same, false);
});

test('different category is never the same product', () => {
  const a = id('ثلاجة تورنيدو 395 لتر');
  const b = id('فريزر تورنيدو 395 لتر');
  assert.equal(sameProduct(a, b).same, false);
});

test('same brand+category+specs with no model is a strong match', () => {
  const a = id('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية');
  const b = id('Toshiba washing machine 8 kg automatic top load');
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'strong');
});

/* REGRESSION: an attribute absent from BOTH listings was once counted as
   "missing", demoting every otherwise-perfect match to 'weak'. Neither of these
   washer titles states RPM — that is agreement, not a gap. */
test('an attribute absent from both listings still allows a strong match', () => {
  const a = id('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية');       // no RPM stated
  const b = id('Toshiba washing machine 8 kg automatic top load'); // no RPM stated
  assert.equal(sameProduct(a, b).confidence, 'strong');
});

test('a spec present in only one listing does not block the match, but weakens it', () => {
  const a = id('شاشة شارب 75 بوصة 4K سمارت');
  const b = id('شاشة شارب 75 بوصة');   // resolution + smart absent
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'weak');
});

test('the water-cooler trap does not match a fridge', () => {
  const cooler = id('مبرد مياه كولدير 2 حنفية بارد / ساخن بالثلاجة شاشة ديجيتال اسود');
  const fridge = id('ثلاجة كولدير 2 باب 395 لتر');
  assert.equal(sameProduct(cooler, fridge).same, false);
});

/* CONFIRMED FALSE POSITIVES: fan size, oven burner count, and heater control
   type were not declared as identity-defining attributes, so genuinely
   different products compared as SAME. */
test('different fan size means different product', () => {
  const a = id('مروحة توشيبا 18 بوصة ستاند');
  const b = id('مروحة توشيبا 30 بوصة ستاند');
  assert.equal(sameProduct(a, b).same, false);
});

test('different burner count means different product — ovens', () => {
  const a = id('فرن كريازى 4 شعلة');
  const b = id('فرن كريازى 5 شعلة');
  assert.equal(sameProduct(a, b).same, false);
});

test('digital vs mechanical control means different product — heaters', () => {
  const a = id('سخان اوليمبك 30 لتر ديجيتال');
  const b = id('سخان اوليمبك 30 لتر ميكانيكي');
  assert.equal(sameProduct(a, b).same, false);
});

/* Further audit fixes: dishwasher width (45cm slimline vs 60cm full-size) and
   water-cooler hot/cold mode were also undeclared identity-defining
   attributes. (freezer gained 'nofrost' too, mirroring fridge, but — like
   fridge's own nofrost — it only ever registers a positive match; no
   contradiction case exists in the catalog to assert here.) */
test('different width means different product — dishwashers', () => {
  const a = id('غسالة اطباق بيكو 45 سم 10 فرد');
  const b = id('غسالة اطباق بيكو 60 سم 10 فرد');
  assert.equal(sameProduct(a, b).same, false);
});

test('hot/cold mode vs cold-only means different product — water coolers', () => {
  const a = id('مبرد مياه كولدير 2 حنفية بارد ساخن');
  const b = id('مبرد مياه كولدير 2 حنفية بارد فقط');
  assert.equal(sameProduct(a, b).same, false);
});

/* Review finding: the 'exact' tier previously short-circuited before the
   brand/category guards ran, so a coincidental model-token match across
   brands or categories was wrongly declared 'exact'. At 471 products this
   never collided; at ~94,000 products across 13 stores it will. */
test('same model token but different brand is not the same product', () => {
  const a = { brand: 'sharp', category: 'tv', model: 'ABC123', units: {}, specs: {}, key: 'x', title: '' };
  const b = { brand: 'samsung', category: 'tv', model: 'ABC123', units: {}, specs: {}, key: 'y', title: '' };
  const r = sameProduct(a, b);
  assert.equal(r.same, false);
  assert.notEqual(r.confidence, 'exact');
});

test('same model token but different category is not the same product', () => {
  const a = { brand: 'sharp', category: 'tv', model: 'ABC123', units: {}, specs: {}, key: 'x', title: '' };
  const b = { brand: 'sharp', category: 'fridge', model: 'ABC123', units: {}, specs: {}, key: 'y', title: '' };
  const r = sameProduct(a, b);
  assert.equal(r.same, false);
  assert.notEqual(r.confidence, 'exact');
});

test('same model token with one brand null is still exact — absence is not a conflict', () => {
  const a = { brand: null, category: 'tv', model: 'ABC123', units: {}, specs: {}, key: 'x', title: '' };
  const b = { brand: 'sharp', category: 'tv', model: 'ABC123', units: {}, specs: {}, key: 'y', title: '' };
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'exact');
});

/* PINNED (not asserted as ideal): a model present on only one side never
   enters the bothKnown/oneMissing scoring that demotes other one-sided
   attributes to 'weak' — it falls straight through to the general
   brand+category+specs path below. A missing model is treated as a terse
   listing, not a contradiction. This test pins today's actual behavior so a
   future change to it is a deliberate decision, not an accident. */
test('a model present on only one side does not by itself block or demote the match', () => {
  const a = id('شاشة شارب 75 بوصة 4K سمارت XY-75');
  const b = id('شاشة شارب 75 بوصة 4K سمارت'); // no model token present
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'strong');
});

test('identity key is stable and equal for the same product', () => {
  const a = id('ثلاجة تورنيدو 2 باب انفرتر نوفروست 355 لتر – اسود RF-40FTV-BK');
  const b = id('Tornado Refrigerator 355L RF-40FTV-BK');
  assert.equal(a.key, b.key);
});
