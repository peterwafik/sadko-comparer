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

// ---- number-rule defect: bare counts in a feature list ("1 x USB-A", "3
// Ports") were being treated as mandatory standalone-number specs, the same
// way "75 بوصة" or "8 كيلو" are — dropping every plausible listing for a
// real, long, copy-pasted marketing query. Only a digit immediately followed
// by a unit word in the query text is mandatory; unit-bearing size/capacity
// numbers must still gate exactly as before. ----
const ANKER_Q = 'Anker Zolo Wall Charger 140W PD, GaN, 3Ports x USB-C, 1 x USB-A, Touchscreen, Compatible with iPhone';

test('number-rule fix: near-verbatim long title is kept (incidental "1" and "3" not mandatory)', () => {
  const t = 'Anker Zolo Wall Charger 140W PD GaN 3 Ports USB-C USB-A Touchscreen';
  assert.equal(isRelevant(t, ANKER_Q), true);
});

test('number-rule fix: a shorter genuine listing missing most feature bullets is kept', () => {
  const t = 'Anker Zolo 140W Wall Charger with Touchscreen';
  assert.equal(isRelevant(t, ANKER_Q), true);
});

test('number-rule fix: another shorter genuine listing (different feature subset) is kept', () => {
  const t = 'Anker 140W GaN Charger 3 Port USB-C';
  assert.equal(isRelevant(t, ANKER_Q), true);
});

test('number-rule regression: screen size mismatch (75 vs 65) is still dropped', () => {
  const q = 'شاشة شارب 75 بوصة 4K';
  const t = 'شاشة شارب 65 بوصة 4K سمارت';
  assert.equal(isRelevant(t, q), false);
});

test('number-rule regression: washing machine capacity mismatch (8 vs 10 كيلو) is still dropped', () => {
  const q = 'غسالة توشيبا 8 كيلو';
  const t = 'غسالة توشيبا 10 كيلو اتوماتيك';
  assert.equal(isRelevant(t, q), false);
});

test('number-rule regression: fridge capacity mismatch (16 vs 18 قدم) is still dropped', () => {
  const q = 'ثلاجة كريازى 16 قدم';
  const t = 'ثلاجة كريازى 18 قدم';
  assert.equal(isRelevant(t, q), false);
});

test('number-rule regression: AC horsepower mismatch (2.25 vs 3 حصان) is still dropped', () => {
  const q = 'تكييف شارب 2.25 حصان';
  const t = 'تكييف شارب 3 حصان';
  assert.equal(isRelevant(t, q), false);
});

test('number-rule regression: fridge water-filter accessory (Arabic) is still dropped', () => {
  const q = 'ثلاجة توشيبا';
  const t = 'فلتر مياه لثلاجة توشيبا';
  assert.equal(isRelevant(t, q), false);
});

test('number-rule regression: phone back-cover accessory (English) is still dropped', () => {
  const q = 'Samsung Galaxy S24';
  const t = 'Back Cover Case for Samsung Galaxy S24';
  assert.equal(isRelevant(t, q), false);
});

// ---- unit-mismatch defect: "140W" fuses the number and unit into ONE word
// token ("140w"), so it never hits the mandatory standalone-number rule (that
// only fires for digit-only tokens) and never hits UNIT_TOKENS (which only
// knows the bare word "watt"/"وات"). A 20W charger was passing the 60%
// word-overlap check on shared words ("anker", "zolo", "wall", "charger",
// "gan", "usb"...) and being crowned "cheapest" for a 140W search — the same
// wrong-product failure class as a 65-inch TV matching a 75-inch search.
// extractUnits (engine/units.mjs) parses "140W"/"20 W" uniformly regardless
// of spacing; isRelevant now uses it directly: a unit VALUE the query states
// must not be CONTRADICTED by a value the title states for that same unit.
// Absence in the title is unknown, not a contradiction — the identical
// asymmetry engine/matcher.mjs's sameProduct() already uses for the catalog
// path (present in both + differ => different product; present in one only
// => unknown, allowed). ----
test('unit-mismatch fix: a 20W charger is dropped for a 140W query (amazon-style title)', () => {
  const t = 'Anker A2699 ZOLO 20W GaN Single-Port Fast Charger';
  assert.equal(isRelevant(t, ANKER_Q), false);
});

test('unit-mismatch fix: a 20W charger is dropped for a 140W query (spaced "20 W", noon-style title)', () => {
  const t = 'Anker Zolo 1C Wall Charger Type-C 20 W Fast Charger';
  assert.equal(isRelevant(t, ANKER_Q), false);
});

test('unit-mismatch fix: a 20W charger is dropped for a 140W query (trailing "20W", different model line)', () => {
  const t = 'Anker A2149L21 Power Port Wall Chargers, III 20W';
  assert.equal(isRelevant(t, ANKER_Q), false);
});

test('unit-mismatch fix: a genuine 140W listing (Arabic transliteration) is kept', () => {
  const t = 'شاحن انكر زولو 140 وات حائط USB-C';
  assert.equal(isRelevant(t, ANKER_Q), true);
});

test('unit-mismatch fix: a title stating NO wattage is kept — absence is not a contradiction', () => {
  const t = 'Anker Zolo Wall Charger GaN 3 Ports USB-C Touchscreen';
  assert.equal(isRelevant(t, ANKER_Q), true);
});

// ---- AI-distilled relevance (isRelevant's optional 3rd `attrs` parameter) ----
// Reported case: a shopper pastes a full Amazon title mentioning "Samsung" only
// as a compatibility target ("...for iPhone 16/15, MacBook, Samsung and
// More..."). Without AI, the raw-string brand rule reads "Samsung" as the
// product's own brand and rejects every genuine Anker listing. With AI, the
// distilled attrs (brand:"Anker", compatible_brands:["Samsung"]) fix this:
// attrs.brand is the only brand enforced, and the 60% overlap check runs
// against the AI's short canonical query_en/query_ar instead of the raw,
// marketing-copy-laden pasted title. These attrs are hand-written here — no
// network call — exactly matching what a live understandQuery() would return.
const POWERBANK_Q = 'Anker Laptop Power Bank (25,000 mAh, 165W, Built-In and Retractable Cables), ' +
  'Effortless Multi-Device Fast Charging, for iPhone 16/15, MacBook, Samsung and More, Space Black - 18 Months Warranty';
const POWERBANK_AI = {
  category_en: 'Power Bank', category_ar: 'باور بانك', brand: 'Anker', model_number: null,
  size_value: 25000, size_unit: 'mAh', resolution: null, wants_used: false,
  query_en: 'Anker power bank 25000mAh 165W',
  query_ar: 'باور بانك انكر 25000 مللي امبير 165 وات',
  compatible_brands: ['Samsung'],
};

test('AI attrs: compatibility-brand mention no longer required — long marketing title, near-verbatim listing', () => {
  const t = 'Anker Laptop Power Bank 25000mAh 165W Built-In Retractable Cables Space Black';
  assert.equal(isRelevant(t, POWERBANK_Q, POWERBANK_AI), true);
});

test('AI attrs: compatibility-brand mention no longer required — shorter genuine listing, different model line', () => {
  const t = 'Anker 737 Power Bank 25000mAh 165W PowerCore';
  assert.equal(isRelevant(t, POWERBANK_Q, POWERBANK_AI), true);
});

test('AI attrs: compatibility-brand mention no longer required — Arabic-titled listing', () => {
  const t = 'باور بانك انكر 25000 مللي امبير 165 وات اسود';
  assert.equal(isRelevant(t, POWERBANK_Q, POWERBANK_AI), true);
});

test('AI attrs: a compatibility brand is still NOT a free pass — wrong product entirely is dropped', () => {
  const t = 'Samsung 25W Travel Adapter';
  assert.equal(isRelevant(t, POWERBANK_Q, POWERBANK_AI), false);
});

test('AI attrs: wrong capacity/wattage still drops even with AI on — unit mismatch rule is not weakened', () => {
  const t = 'Anker Power Bank 10000mAh 22.5W';
  assert.equal(isRelevant(t, POWERBANK_Q, POWERBANK_AI), false);
});

test('AI attrs omitted: reproduces today\'s behavior exactly — same genuine Anker listing is still dropped', () => {
  // No 3rd argument at all: this must behave byte-identically to the
  // pre-AI engine, including the compatibility-brand bug being reported —
  // the raw-string rule still misreads "Samsung" as a required brand.
  const t = 'Anker Laptop Power Bank 25000mAh 165W Built-In Retractable Cables Space Black';
  assert.equal(isRelevant(t, POWERBANK_Q), false);
});

test('AI attrs explicitly null: also reproduces today\'s behavior exactly', () => {
  const t = 'Anker Laptop Power Bank 25000mAh 165W Built-In Retractable Cables Space Black';
  assert.equal(isRelevant(t, POWERBANK_Q, null), false);
});

test('AI attrs malformed (not an object): fails soft to today\'s rule-based behavior', () => {
  const t = 'Anker Laptop Power Bank 25000mAh 165W Built-In Retractable Cables Space Black';
  assert.equal(isRelevant(t, POWERBANK_Q, 'not-an-object'), false);
});

test('AI attrs malformed (empty object, no usable fields): fails soft to today\'s rule-based behavior', () => {
  const t = 'Anker Laptop Power Bank 25000mAh 165W Built-In Retractable Cables Space Black';
  assert.equal(isRelevant(t, POWERBANK_Q, {}), false);
});

test('AI attrs: existing regression guards are unaffected when attrs is supplied for an unrelated query', () => {
  const q = 'شاشة شارب 75 بوصة 4K';
  const t = 'شاشة شارب 65 بوصة 4K سمارت';
  const attrs = { brand: 'Sharp', query_en: 'Sharp TV 75 inch 4K', query_ar: 'شاشة شارب 75 بوصة 4K', compatible_brands: [] };
  assert.equal(isRelevant(t, q, attrs), false);
});
