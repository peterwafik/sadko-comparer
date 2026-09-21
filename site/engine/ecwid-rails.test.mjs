// site/engine/ecwid-rails.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRails, deriveBanners, resolveRailCategories, normAr } from './ecwid-rails.mjs';

const P = (id, over = {}) => ({
  id: String(id), title: 'ثلاجة ' + id, price: 1000, image: 'i.webp', images: ['i.webp'],
  categoryId: '206629517', categoryIds: ['206629517'], inStock: true,
  compareToPrice: null, incomplete: false, sku: '', url: '', description: '', ...over,
});

/* The two real stores, which disagree on every id. */
const PROD_CATS = [
  { id: 173607281, name: 'عروض صادكو' },
  { id: 195273251, name: 'الأكثر مبيعاً' },
  { id: 38003882, name: 'ثلاجات' },
];
const TEST_CATS = [
  { id: 206629522, name: 'عروض صادكو' },
  { id: 206629765, name: 'المنتجات الاكثر مبيعاً' },
  { id: 206629761, name: 'ثلاجات' },
];

/* --------------------------- name resolution ---------------------------- */

test('the rail categories resolve on the PRODUCTION store', () => {
  const r = resolveRailCategories(PROD_CATS);
  assert.equal(r.offers, '173607281');
  assert.equal(r.bestSellers, '195273251');
});

test('the same code resolves them on the TEST store, which uses other ids and wording', () => {
  /* "الأكثر مبيعاً" vs "المنتجات الاكثر مبيعاً" — different words AND a
     different hamza. Hard-coding ids would have produced an empty rail here. */
  const r = resolveRailCategories(TEST_CATS);
  assert.equal(r.offers, '206629522');
  assert.equal(r.bestSellers, '206629765');
});

test('an explicit id override wins over name matching', () => {
  const r = resolveRailCategories(TEST_CATS, { offers: '999' });
  assert.equal(r.offers, '999');
  assert.equal(r.bestSellers, '206629765');
});

test('a missing category resolves to null rather than to something arbitrary', () => {
  const r = resolveRailCategories([{ id: 1, name: 'ثلاجات' }]);
  assert.equal(r.offers, null);
  assert.equal(r.bestSellers, null);
});

test('normAr folds the orthography that differs between the stores', () => {
  assert.equal(normAr('الأكثر مبيعاً'), normAr('الاكثر مبيعا'));
  assert.equal(normAr('  عروض   صادكو '), 'عروض صادكو');
});

test('the rail matchers do not collide with the other 28 categories', () => {
  const names = ['نو فروست', 'ثلاجات', 'مكانس', 'فريزر أفقى', 'سخانات كهرباء', '5 شعلة',
    'غسالات أطباق', 'غسالات ملابس', 'ديفروست', 'خلاطات و محضرات طعام', 'فريزرات',
    'فريزر رأسى', 'سخانات غاز', '4 شعلة', 'مكاوى', 'أفران كهربائية', 'ميكروييف',
    'أفران', 'حرف يدوية ومنتجات عضوية', 'كاتيل و ماكينات قهوة', 'غسالات',
    'تكييفات هواء', 'قلايات', 'سخانات مياه', 'تليفزيونات', 'مبردات هواء ومراوح',
    'مبردات مياه', 'اجهزة صغيرة'];
  const cats = names.map((name, i) => ({ id: 1000 + i, name }));
  const r = resolveRailCategories(cats);
  assert.equal(r.offers, null, 'nothing but عروض صادكو may match offers');
  assert.equal(r.bestSellers, null, 'nothing but the best-sellers category may match');
});

/* -------------------------------- rails --------------------------------- */

test('offers comes from membership of the resolved offers category', () => {
  const r = deriveRails([
    P(1, { categoryIds: ['206629517', '206629522'] }),
    P(2),
  ], { categories: TEST_CATS });
  assert.deepEqual(r.offers.ids, ['1']);
  assert.equal(r.offers.titleAr, 'عروض صادكو');
  assert.equal(r.offers.titleEn, 'SADKO offers');
});

test('bestSellers comes from membership of the resolved best-sellers category', () => {
  const r = deriveRails([P(1), P(2, { categoryIds: ['206629765'] })], { categories: TEST_CATS });
  assert.deepEqual(r.bestSellers.ids, ['2']);
});

test('featured comes from products carrying a real discount, biggest saving first', () => {
  const r = deriveRails([
    P(1, { price: 1000, compareToPrice: 1100 }),   // saves 100
    P(2, { price: 1000, compareToPrice: 2000 }),   // saves 1000
    P(3),
  ], { categories: TEST_CATS });
  assert.deepEqual(r.featured.ids, ['2', '1']);
  assert.equal(r.featured.titleAr, 'مختارات صادكو');
});

test('a product whose was-price the mapper already dropped is not featured', () => {
  const r = deriveRails([P(1, { compareToPrice: null }), P(2, { compareToPrice: null })],
    { categories: TEST_CATS });
  assert.ok(!('featured' in r), 'no real discounts means no featured rail at all');
});

test('an empty rail is omitted, never padded with arbitrary products', () => {
  const r = deriveRails([P(1), P(2), P(3)], { categories: TEST_CATS });
  assert.deepEqual(Object.keys(r), []);
});

test('out-of-stock products are excluded from rails but stay in the catalogue', () => {
  const rows = [
    P(1, { categoryIds: ['206629522'], inStock: false }),
    P(2, { categoryIds: ['206629522'] }),
  ];
  const r = deriveRails(rows, { categories: TEST_CATS });
  assert.deepEqual(r.offers.ids, ['2'], 'a rail should not promote something unbuyable');
  assert.equal(rows.length, 2, 'the catalogue list itself is never filtered here');
});

test('incomplete shells are excluded from rails', () => {
  const r = deriveRails([P(1, { categoryIds: ['206629522'], incomplete: true }),
                         P(2, { categoryIds: ['206629522'] })], { categories: TEST_CATS });
  assert.deepEqual(r.offers.ids, ['2']);
});

test('rails are capped so one cannot become the whole catalogue', () => {
  const many = Array.from({ length: 80 }, (_, i) => P(i + 1, { categoryIds: ['206629522'] }));
  assert.equal(deriveRails(many, { categories: TEST_CATS, limit: 24 }).offers.ids.length, 24);
});

test('a product in both curated categories appears in both rails', () => {
  const r = deriveRails([P(1, { categoryIds: ['206629522', '206629765'] })], { categories: TEST_CATS });
  assert.deepEqual(r.offers.ids, ['1']);
  assert.deepEqual(r.bestSellers.ids, ['1']);
});

test('with no categories at all, every rail is omitted rather than throwing', () => {
  assert.deepEqual(deriveRails([P(1)], {}), {});
  assert.deepEqual(deriveRails([], {}), {});
});

/* ------------------------------- banners -------------------------------- */

const B = (id, over = {}) => ({
  id: String(id), title: 'عروض الصيف', description: 'خصومات على التكييفات',
  image: 'https://cdn/banner.jpg', images: ['https://cdn/banner.jpg'],
  sku: 'hero', url: 'https://sadko/shop', ...over,
});

test('a banner entry maps to the promos.json shape', () => {
  const [b] = deriveBanners([B(1)]);
  assert.equal(b.id, 'ecwid-1');
  assert.equal(b.slot, 'hero');
  assert.equal(b.title, 'عروض الصيف');
  assert.equal(b.sub, 'خصومات على التكييفات');
  assert.equal(b.image, 'https://cdn/banner.jpg');
  assert.equal(b.href, 'https://sadko/shop');
  assert.equal(b.source, 'ecwid');
});

test('the SKU carries the slot, and an unknown slot falls back to square', () => {
  assert.equal(deriveBanners([B(1, { sku: 'wide' })])[0].slot, 'wide');
  assert.equal(deriveBanners([B(1, { sku: 'HERO' })])[0].slot, 'hero');
  assert.equal(deriveBanners([B(1, { sku: 'nonsense' })])[0].slot, 'square');
  assert.equal(deriveBanners([B(1, { sku: '' })])[0].slot, 'square');
});

test('banners are ordered hero, then wide, then square', () => {
  const out = deriveBanners([B(1, { sku: 'square' }), B(2, { sku: 'hero' }), B(3, { sku: 'wide' })]);
  assert.deepEqual(out.map(b => b.slot), ['hero', 'wide', 'square']);
});

test('a banner with no artwork is skipped rather than rendered empty', () => {
  assert.deepEqual(deriveBanners([B(1, { image: '', images: [] })]), []);
});

test('a banner with no headline is skipped', () => {
  assert.deepEqual(deriveBanners([B(1, { title: '' })]), []);
});

test('alt text is always present, taken from the headline', () => {
  /* The message is printed inside the artwork, so alt is the only thing a
     screen-reader user gets. */
  const [b] = deriveBanners([B(1)]);
  assert.equal(b.alt, 'عروض الصيف');
});

test('derived banners carry NO English fields rather than Arabic in an English slot', () => {
  /* Ecwid holds no usable translations for this store — every
     nameTranslated.en contains Arabic. Copying Arabic into titleEn is the
     exact bug the category mapper refuses, so English is left absent and
     data/promos.json stays the bilingual source. */
  const [b] = deriveBanners([B(1)]);
  for (const k of ['titleEn', 'subEn', 'ctaEn', 'altEn']) assert.ok(!(k in b), 'unexpected ' + k);
});

test('derived banners invent no commercial claim', () => {
  const [b] = deriveBanners([B(1)]);
  for (const k of ['was', 'wasPrice', 'discount', 'percent', 'price', 'rating', 'stock'])
    assert.ok(!(k in b), 'forbidden field ' + k);
});

test('an empty banner category yields no banners, not a placeholder', () => {
  assert.deepEqual(deriveBanners([]), []);
  assert.deepEqual(deriveBanners(), []);
});

test('featured excludes anything already in the offers rail', () => {
  /* In the live store 65 of the 69 offers products also carry a was-price.
     Without this exclusion عروض صادكو and مختارات صادكو would show almost the
     same items — two shop windows onto one shelf. */
  const r = deriveRails([
    P(1, { categoryIds: ['206629522'], price: 1000, compareToPrice: 2000 }),  // discounted AND in offers
    P(2, { price: 1000, compareToPrice: 1500 }),                              // discounted only
  ], { categories: TEST_CATS });
  assert.deepEqual(r.offers.ids, ['1']);
  assert.deepEqual(r.featured.ids, ['2'], 'a product in offers must not also be featured');
});

test('featured omits itself when every discount is already in offers', () => {
  const r = deriveRails([
    P(1, { categoryIds: ['206629522'], price: 1000, compareToPrice: 2000 }),
  ], { categories: TEST_CATS });
  assert.deepEqual(r.offers.ids, ['1']);
  assert.ok(!('featured' in r), 'no complementary discounts means no featured rail');
});
