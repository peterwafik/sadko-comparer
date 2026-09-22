// site/engine/ecwid-payments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  restrictionOf, basketFit, toStorefrontMethods, stripHtml, normAr, FALLBACK_METHODS,
} from './ecwid-payments.mjs';

/* The ten real method titles, copied from the live store's profile. */
const LIVE_TITLES = [
  'Cash on Delivery  الدفع عند الاستلام',
  'تقسيط البنك الاهلي ( ٦ اشهر بدون فوائد )',
  'مبادرة العربى تقسيط ( منتجات العربى فقط )',
  'Valu',
  'Souhoola',
  'Fawry',
  'Mogo',
  'SEVEN',
  'تقسيط البنك الاهلي ( ١٨ شهر بدون فوائد ) على جميع منتجات كريازى',
  'Forsa',
];

/* ------------------------- restriction detection ------------------------ */

test('the El Araby plan is detected as restricted, with the brand named', () => {
  const r = restrictionOf('مبادرة العربى تقسيط ( منتجات العربى فقط )');
  assert.equal(r.restricted, true);
  assert.equal(r.brandEn, 'El Araby');
});

test('the 18-month Kiriazi plan is detected as restricted, with the brand named', () => {
  const r = restrictionOf('تقسيط البنك الاهلي ( ١٨ شهر بدون فوائد ) على جميع منتجات كريازى');
  assert.equal(r.restricted, true);
  assert.equal(r.brandEn, 'Kiriazi');
});

test('exactly two of the ten live methods are restricted', () => {
  /* If Ecwid grows an eleventh restricted plan this fails, which is the
     point — a restriction nobody noticed is a plan offered on the wrong
     basket. */
  const restricted = LIVE_TITLES.filter(t => restrictionOf(t).restricted);
  assert.equal(restricted.length, 2, 'restricted: ' + JSON.stringify(restricted));
});

test('an unrestricted plan is not falsely flagged', () => {
  for (const t of ['Valu', 'Souhoola', 'Fawry', 'Mogo', 'SEVEN', 'Forsa',
                   'Cash on Delivery  الدفع عند الاستلام',
                   'تقسيط البنك الاهلي ( ٦ اشهر بدون فوائد )']) {
    assert.equal(restrictionOf(t).restricted, false, t + ' was wrongly flagged as restricted');
  }
});

test('the 6-month plan is NOT restricted while the 18-month one IS', () => {
  /* The two differ only in the tail of the label, which is exactly the kind of
     distinction a looser match would lose. */
  assert.equal(restrictionOf('تقسيط البنك الاهلي ( ٦ اشهر بدون فوائد )').restricted, false);
  assert.equal(restrictionOf('تقسيط البنك الاهلي ( ١٨ شهر بدون فوائد ) على جميع منتجات كريازى').restricted, true);
});

test('spelling variants of the brand fold to the same restriction', () => {
  const a = restrictionOf('تقسيط على جميع منتجات كريازى');
  const b = restrictionOf('تقسيط على جميع منتجات كريازي');
  assert.equal(a.brandEn, 'Kiriazi');
  assert.equal(b.brandEn, 'Kiriazi');
  assert.equal(a.brandKey, b.brandKey);
});

test('an unrecognised brand still reports the restriction, with no invented name', () => {
  const r = restrictionOf('تقسيط على جميع منتجات فلانية');
  assert.equal(r.restricted, true, 'the restriction matters even when the brand does not parse');
  assert.equal(r.brandEn, null, 'no English name may be invented for an unknown brand');
});

test('normAr folds the orthography the store actually mixes', () => {
  assert.equal(normAr('كريازى'), normAr('كريازي'));
  assert.equal(normAr('العربى'), normAr('العربي'));
});

/* ----------------------------- basket fit ------------------------------- */

test('an unrestricted method always fits', () => {
  assert.equal(basketFit({ restricted: false }, []), 'ok');
  assert.equal(basketFit({ restricted: false }, ['ثلاجة سامسونج']), 'ok');
});

test('a restricted method fits when the basket mentions its brand', () => {
  const m = restrictionOf('تقسيط على جميع منتجات كريازى');
  assert.equal(basketFit(m, ['8900 فرن كريازى 5 ش ستانلس ستيل']), 'ok');
});

test('a restricted method is UNLIKELY when the basket does not mention its brand', () => {
  const m = restrictionOf('تقسيط على جميع منتجات كريازى');
  assert.equal(basketFit(m, ['تليفزيون سامسونج 55 بوصة']), 'unlikely');
});

test('an empty basket gives "unknown", never a false negative', () => {
  const m = restrictionOf('تقسيط على جميع منتجات كريازى');
  assert.equal(basketFit(m, []), 'unknown');
});

test('a brand with no English name is still matched against the basket', () => {
  /* KNOWN_BRANDS exists only to supply an English label — it does not decide
     whether a brand is real. A restriction naming a brand we have no
     translation for is still a restriction, and the extracted token is still
     the right thing to look for in the basket. The warning is guidance, never
     a block, so the cost of being wrong here is a "confirm with customer care"
     note rather than a refused order. */
  const m = restrictionOf('تقسيط على جميع منتجات فلانية');
  assert.equal(m.restricted, true);
  assert.equal(m.brandEn, null, 'no English name may be invented');
  assert.equal(basketFit(m, ['تليفزيون سامسونج']), 'unlikely');
  assert.equal(basketFit(m, ['ثلاجة فلانية 12 قدم']), 'ok');
});

test('"unknown" is reserved for the case we genuinely cannot judge', () => {
  /* An empty basket. Warning off a plan here would be guessing. */
  const m = restrictionOf('تقسيط على جميع منتجات كريازى');
  assert.equal(basketFit(m, []), 'unknown');
  assert.equal(basketFit({ restricted: true, brandKey: null }, ['أى شئ']), 'unknown');
});

test('the brand match survives spelling variation between label and title', () => {
  const m = restrictionOf('تقسيط على جميع منتجات كريازي');
  assert.equal(basketFit(m, ['فرن كريازى 5 شعلة']), 'ok');
});

/* --------------------------- storefront shaping ------------------------- */

const MIRRORED = [
  { id: 'cod', title: 'Cash on Delivery  الدفع عند الاستلام', enabled: true, order: 1,
    instructions: '' },
  { id: 'valu', title: 'Valu', enabled: true, order: 4,
    instructions: '<p><strong><span style="font-size: 16px;">Valu سيتم التواصل لارسال رابط الخاص بالدفع</span></strong></p>' },
  { id: 'nbe18', title: 'تقسيط البنك الاهلي ( ١٨ شهر بدون فوائد ) على جميع منتجات كريازى', enabled: true, order: 9,
    instructions: '<p><strong>سيتم التواصل لارسال الرابط الخاص بالدفع</strong></p>' },
  { id: 'off', title: 'Retired plan', enabled: false, order: 2 },
  { id: 'blank', title: '   ', enabled: true, order: 3 },
];

test('only enabled, named methods reach the storefront', () => {
  const out = toStorefrontMethods(MIRRORED);
  assert.deepEqual(out.map(m => m.id), ['cod', 'valu', 'nbe18']);
});

test('the methods keep Ecwid ordering', () => {
  const out = toStorefrontMethods(MIRRORED);
  assert.deepEqual(out.map(m => m.order), [1, 4, 9]);
});

test('the instructions reach the customer as text, not as markup', () => {
  const valu = toStorefrontMethods(MIRRORED).find(m => m.id === 'valu');
  assert.match(valu.instructions, /سيتم التواصل/);
  assert.ok(!/</.test(valu.instructions), 'no HTML may reach the storefront');
  assert.ok(!/font-size/.test(valu.instructions), 'no leftover style text');
});

test('the restricted method carries its restriction through to the storefront', () => {
  const nbe = toStorefrontMethods(MIRRORED).find(m => m.id === 'nbe18');
  assert.equal(nbe.restricted, true);
  assert.equal(nbe.brandEn, 'Kiriazi');
});

test('no method claims an English title', () => {
  /* Ecwid holds no usable translations for this store. Copying the Arabic into
     titleEn is the exact bug the category mapper refuses. */
  for (const m of toStorefrontMethods(MIRRORED)) assert.ok(!('titleEn' in m), m.id + ' invented an English title');
});

test('an empty or absent mirror yields an empty list, not a crash', () => {
  assert.deepEqual(toStorefrontMethods([]), []);
  assert.deepEqual(toStorefrontMethods(), []);
});

test('the fallback list is exactly the three methods the site offered before', () => {
  assert.deepEqual(FALLBACK_METHODS.map(m => m.id), ['cod', 'bank', 'showroom']);
  for (const m of FALLBACK_METHODS) assert.equal(m.restricted, false);
});

/* ------------------------------- stripHtml ------------------------------ */

test('stripHtml turns Ecwid rich text into a clean sentence', () => {
  assert.equal(stripHtml('<p><strong>سيتم&nbsp;التواصل</strong></p>'), 'سيتم التواصل');
});

test('stripHtml handles a line break as a space, not a join', () => {
  assert.equal(stripHtml('<p>أ</p><p>ب</p>'), 'أ ب');
  assert.equal(stripHtml('أ<br>ب'), 'أ ب');
});

test('stripHtml cannot leave an executable fragment behind', () => {
  const out = stripHtml('<script>alert(1)</script>ok');
  assert.ok(!/</.test(out) && !/>/.test(out));
});

test('stripHtml on nothing is an empty string, never "undefined"', () => {
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(''), '');
});

/* ------------------- the live store, as captured -------------------- */

test('every live method title classifies without throwing', () => {
  const fix = path.join(import.meta.dirname, 'fixtures', 'ecwid-profile.json');
  const profile = JSON.parse(readFileSync(fix, 'utf8'));
  const opts = (profile.payment && profile.payment.paymentOptions) || profile.paymentOptions || [];
  assert.ok(opts.length >= 10, 'expected the ten live methods, got ' + opts.length);
  const shaped = toStorefrontMethods(opts.map(o => ({
    id: o.id, title: o.checkoutTitle, enabled: o.enabled, order: o.orderBy,
    instructions: (o.instructionsForCustomer || {}).instructions,
  })));
  assert.equal(shaped.length, 10, 'all ten enabled methods should survive');
  assert.equal(shaped.filter(m => m.restricted).length, 2, 'exactly two are product-restricted');
});
