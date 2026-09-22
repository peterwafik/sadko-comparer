// site/engine/ecwid-shipping.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSizeBand, isRegionBound, quoteReadiness, deliveryNotes,
         deliveryZones, toStorefrontShipping } from './ecwid-shipping.mjs';

/* The live store's twelve methods, as the mirror holds them. Titles and notes
   are the real ones; this is the shape the probe returned. */
const LIVE = [
  { id: 'a', title: 'القاهرة الكبرى', enabled: true, order: 10, zoneConfigured: false,
    description: 'الحد الأقصى للشحن لعدد القطع هو 350 جنيه', deliveryTimeDays: 'الحد الأقصى للشحن لعدد القطع هو 350 جنيه' },
  { id: 'b', title: 'الجيزة', enabled: true, order: 20, zoneConfigured: false,
    description: 'الحد الأقصى للشحن لعدد القطع هو 350 جنيه', deliveryTimeDays: null },
  { id: 'c', title: 'الاسكندرية', enabled: true, order: 30, zoneConfigured: false,
    description: 'الحد الأقصى للشحن لعدد القطع هو 350 جنيه', deliveryTimeDays: null },
  { id: 'd', title: 'القليوبية - الدلتا - القناة منتجات صغيرة(مراوح-اجهزة صغيرة)', enabled: true, order: 40,
    zoneConfigured: false, description: 'يرجى العلم بأن التوصيل يكون خلال 7 أيام', deliveryTimeDays: null },
  { id: 'e', title: 'القليوبية - الدلتا - القناة منتجات كبيرة جدا( ثلاجات فوق 450 لتر)', enabled: true, order: 50,
    zoneConfigured: false, description: 'يرجى العلم بأن التوصيل يكون خلال 7 أيام', deliveryTimeDays: null },
  { id: 'f', title: 'الصعيد - مرسى مطروح - البحر الاحمر منتجات متوسطة(بوتجازات-تكييفات)', enabled: true, order: 60,
    zoneConfigured: false, description: '(عدا العطلات والاجازات الرسمية) يرجى العلم بأن التوصيل خلال 10 أيام', deliveryTimeDays: null },
];

/* ---------------------------- the size bands ---------------------------- */

test('a size-banded method is recognised from the title staff actually wrote', () => {
  assert.ok(isSizeBand('القليوبية - الدلتا - القناة منتجات صغيرة(مراوح)'));
  assert.ok(isSizeBand('الصعيد منتجات كبيرة جدا( ثلاجات فوق 450 لتر)'));
  assert.ok(isSizeBand('منتجات متوسطة'));
});

test('a plain regional method is not a size band', () => {
  assert.ok(!isSizeBand('القاهرة الكبرى'));
  assert.ok(!isSizeBand('الجيزة'));
  assert.ok(!isSizeBand(''));
  assert.ok(!isSizeBand(null));
});

/* -------------------------- the quoting gate ---------------------------- */

test('THE FINDING: with no destination zone on any method, no total can be quoted', () => {
  /* Ecwid returns 250 for every governorate in Egypt — Aswan and Marsa
     Matrouh included — because the first enabled method matches everything.
     Showing it would undercharge every customer outside Cairo. */
  const r = quoteReadiness(LIVE, { productsWithWeight: 0, productCount: 1453 });
  assert.equal(r.quotable, false);
  assert.ok(r.reasons.some(x => x.code === 'no_destination_zones'),
    'the missing zones are not reported: ' + JSON.stringify(r.reasons));
});

test('the missing weights are reported SEPARATELY, because fixing the zones alone is not enough', () => {
  /* Eight of the twelve methods are size bands. Bind every zone and the band
     still cannot be chosen without a weight. */
  const r = quoteReadiness(LIVE, { productsWithWeight: 0, productCount: 1453 });
  assert.ok(r.reasons.some(x => x.code === 'no_product_weights'));
  assert.equal(r.reasons.length, 2, 'expected exactly the two known blockers');
});

test('each reason carries the fix, so the owner is not left to guess', () => {
  const r = quoteReadiness(LIVE, { productsWithWeight: 0, productCount: 1453 });
  for (const x of r.reasons) {
    assert.ok(x.ar && x.en, 'a reason is missing a language');
    assert.match(x.fix, /Ecwid/, 'a reason does not say where to fix it');
  }
});

test('the weight count is reported as evidence, not just asserted', () => {
  const r = quoteReadiness(LIVE, { productsWithWeight: 0, productCount: 1453 });
  const w = r.reasons.find(x => x.code === 'no_product_weights');
  assert.equal(w.detail, '0 of 1453 products have a weight');
});

test('zones bound but weights still missing leaves it unquotable, for the weight reason only', () => {
  const bound = LIVE.map(m => ({ ...m, zoneConfigured: true }));
  const r = quoteReadiness(bound, { productsWithWeight: 0, productCount: 1453 });
  assert.equal(r.quotable, false);
  assert.deepEqual(r.reasons.map(x => x.code), ['no_product_weights']);
});

test('weights supplied but zones still missing is likewise unquotable', () => {
  const r = quoteReadiness(LIVE, { productsWithWeight: 1453, productCount: 1453 });
  assert.equal(r.quotable, false);
  assert.deepEqual(r.reasons.map(x => x.code), ['no_destination_zones']);
});

test('BOTH fixed flips quotable on its own — this module needs no further edit', () => {
  const bound = LIVE.map(m => ({ ...m, zoneConfigured: true }));
  const r = quoteReadiness(bound, { productsWithWeight: 1453, productCount: 1453 });
  assert.equal(r.quotable, true);
  assert.deepEqual(r.reasons, []);
});

test('a store with one flat method per region needs no weights at all', () => {
  /* The weight blocker is raised only where size bands are actually used, so
     a simpler shipping setup is not held back by it. */
  const flat = [{ id: 'x', title: 'القاهرة الكبرى', enabled: true, zoneConfigured: true }];
  const r = quoteReadiness(flat, { productsWithWeight: 0, productCount: 1453 });
  assert.equal(r.quotable, true);
});

test('partial zone coverage is its own reason, not silence', () => {
  const mixed = [{ ...LIVE[0], zoneConfigured: true }, { ...LIVE[1], zoneConfigured: false }];
  const r = quoteReadiness(mixed, { productsWithWeight: 1, productCount: 1 });
  assert.deepEqual(r.reasons.map(x => x.code), ['partial_destination_zones']);
});

test('no methods at all raises no zone complaint — there is nothing to bind', () => {
  const r = quoteReadiness([], { productsWithWeight: 0, productCount: 0 });
  assert.deepEqual(r.reasons, []);
  assert.equal(r.quotable, true);
});

test('a disabled method is ignored throughout', () => {
  const off = LIVE.map(m => ({ ...m, enabled: false }));
  assert.deepEqual(quoteReadiness(off).reasons, []);
  assert.deepEqual(deliveryNotes(off), []);
  assert.deepEqual(deliveryZones(off), []);
});

test('isRegionBound reads the flag and nothing else', () => {
  assert.ok(isRegionBound({ zoneConfigured: true }));
  assert.ok(!isRegionBound({ zoneConfigured: false }));
  assert.ok(!isRegionBound({}));
  assert.ok(!isRegionBound(null));
});

/* ---------------------------- the real notes ---------------------------- */

test('the store delivery sentences are surfaced — the site showed none of them', () => {
  const n = deliveryNotes(LIVE);
  const texts = n.map(x => x.text);
  assert.ok(texts.includes('الحد الأقصى للشحن لعدد القطع هو 350 جنيه'));
  assert.ok(texts.some(x => /التوصيل يكون خلال 7 أيام/.test(x)));
});

test('the same sentence repeated across methods is shown once', () => {
  /* Three methods carry the identical 350 note, and Cairo carries it in both
     its fields. */
  const n = deliveryNotes(LIVE).filter(x => /350/.test(x.text));
  assert.equal(n.length, 1);
});

test('each note says which method stated it, so it is attributed not asserted', () => {
  for (const n of deliveryNotes(LIVE)) assert.ok(n.method, 'a note has no method');
});

test('notes are plain text — staff write these in a rich-text field', () => {
  const n = deliveryNotes([{ id: 'h', title: 'ت', enabled: true,
    description: '<p>التوصيل <strong>خلال 7 أيام</strong></p>' }]);
  assert.equal(n[0].text, 'التوصيل خلال 7 أيام');
});

test('an empty or missing note is skipped rather than shown blank', () => {
  assert.deepEqual(deliveryNotes([{ id: 'i', title: 'ت', enabled: true, description: '   ', deliveryTimeDays: null }]), []);
  assert.deepEqual(deliveryNotes([{ id: 'j', title: 'ت', enabled: true }]), []);
});

/* ---------------------------- the zone names ---------------------------- */

test('the four Delta size bands collapse to one zone name', () => {
  const z = deliveryZones(LIVE);
  assert.ok(z.includes('القاهرة الكبرى'));
  const delta = z.filter(x => /الدلتا/.test(x));
  assert.equal(delta.length, 1, 'the Delta appears more than once: ' + JSON.stringify(delta));
});

test('the same region typed with different spacing is ONE zone', () => {
  /* The live store really does carry all three spellings, which listed Upper
     Egypt three times to the customer. */
  const variants = [
    { id: '1', title: 'الصعيد - مرسى مطروح - البحر الاحمر منتجات صغيرة(مراوح)', enabled: true },
    { id: '2', title: 'الصعيد -مرسى مطروح-البحر الاحمر منتجات متوسطة(بوتجازات)', enabled: true },
    { id: '3', title: 'الصعيد-مرسى مطروح-البحر الاحمر منتجات كبيرة جدا( ثلاجات)', enabled: true },
  ];
  assert.deepEqual(deliveryZones(variants), ['الصعيد - مرسى مطروح - البحر الاحمر']);
});

test('the fixture methods collapse to the distinct areas behind them', () => {
  /* Six methods, five areas: the two Delta rows are one area and so the count
     drops by exactly one. Asserted as the exact list, because a bound would
     have passed while listing a region twice. */
  assert.deepEqual(deliveryZones(LIVE), [
    'القاهرة الكبرى',
    'الجيزة',
    'الاسكندرية',
    'القليوبية - الدلتا - القناة',
    'الصعيد - مرسى مطروح - البحر الاحمر',
  ]);
});

test('a zone name keeps the region and drops the band', () => {
  const z = deliveryZones([LIVE[3]]);
  assert.equal(z.length, 1);
  assert.ok(/القليوبية/.test(z[0]) && /الدلتا/.test(z[0]));
  assert.ok(!/منتجات/.test(z[0]), 'the band survived in: ' + z[0]);
  assert.ok(!/\(\s*\)/.test(z[0]), 'an empty bracket was left behind: ' + z[0]);
});

test('deliveryZones does NOT invent a governorate list', () => {
  /* The store has not told Ecwid which governorates "الصعيد" covers, so
     expanding it here would be our assumption presented as store policy.

     Asserted as containment rather than a blocklist of governorate names: a
     blocklist gives false positives, because the real zone "القناة" (the
     Canal) contains "قنا" (Qena) as a substring. Every word of every zone
     name must come from a method title the store actually wrote — which
     forbids additions of any kind, not just the ones I thought to list. */
  const titles = LIVE.map(m => m.title).join(' | ');
  for (const zone of deliveryZones(LIVE)) {
    for (const word of zone.split(/\s+/).filter(Boolean)) {
      assert.ok(titles.includes(word),
        'the zone name contains a word no method title has: ' + word + ' (in "' + zone + '")');
    }
  }
});

/* --------------------------- the storefront shape ----------------------- */

test('the storefront payload carries the gate, the reasons and the real notes', () => {
  const out = toStorefrontShipping(LIVE, { productsWithWeight: 0, productCount: 1453 });
  assert.equal(out.quotable, false);
  assert.equal(out.reasons.length, 2);
  assert.equal(out.methodCount, 6);
  assert.ok(out.notes.length >= 2);
  assert.ok(out.zones.length >= 3);
});

test('the payload never contains a rate, a total or a currency figure', () => {
  /* The whole point: this module describes delivery, it does not price it. */
  const out = JSON.stringify(toStorefrontShipping(LIVE, { productsWithWeight: 0, productCount: 1453 }));
  const parsed = toStorefrontShipping(LIVE, { productsWithWeight: 0, productCount: 1453 });
  for (const k of ['rate', 'shippingRate', 'total', 'cost', 'price']) {
    assert.ok(!(k in parsed), 'the payload exposes ' + k);
  }
  /* 350 appears only inside the store's own quoted sentence, attributed to
     the method that says it — never as a field the UI could add up. */
  assert.ok(out.includes('350'), 'the store own note was dropped');
  assert.ok(!/"(rate|total|cost)":/.test(out));
});

test('an empty mirror produces a usable empty payload, not a throw', () => {
  const out = toStorefrontShipping([], {});
  assert.equal(out.methodCount, 0);
  assert.deepEqual(out.notes, []);
  assert.deepEqual(out.zones, []);
});
