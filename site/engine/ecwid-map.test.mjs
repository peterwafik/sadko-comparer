// site/engine/ecwid-map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toSadkoProduct, decodeEntities, safeHtml } from './ecwid-map.mjs';

const FIX = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'ecwid-product.json'), 'utf8'));

/* A minimal product using the REAL Ecwid field names, taken from the captured
   payload — not the names an earlier pass guessed. Ecwid has no
   `requiresShipping` (it is `isShippingRequired`), no `trackQuantity` (stock
   tracking is `unlimited === false`) and no top-level `brand`. */
const P = (over = {}) => ({
  id: 865564964,
  sku: 'sprinter',
  name: 'مبرد مياه كولدير',
  price: 6999,
  url: 'https://www.sadko-group.com/shop/x-p865564964',
  description: 'وصف',
  imageUrl: 'https://d2j6dbq0eux0bg.cloudfront.net/images/142682751/products/865564964/a.webp',
  galleryImages: [],
  inStock: true,
  quantity: 5,
  unlimited: false,
  isShippingRequired: true,
  weight: 0,
  compareToPrice: null,
  attributes: [],
  categoryIds: [102858075],
  defaultCategoryId: 102858075,
  enabled: true,
  ...over,
});

test('maps the seven fields the storefront already reads', () => {
  const p = toSadkoProduct(P());
  assert.equal(p.id, '865564964');                   // string, as products.json always had
  assert.equal(p.title, 'مبرد مياه كولدير');
  assert.equal(p.price, 6999);
  assert.equal(p.url, 'https://www.sadko-group.com/shop/x-p865564964');
  assert.equal(p.description, 'وصف');
  assert.ok(p.image.startsWith('https://'));
  assert.equal(p.categoryId, '102858075');
});

test('decodes HTML entities, normalising &nbsp; to a REAL space', () => {
  /* Real SADKO titles contain &nbsp; — see data/products.json. It is decoded
     to an ordinary space on purpose, NOT to U+00A0: an invisible
     non-breaking space inside a product title silently breaks site search and
     the comparer's token matching, and it is impossible to spot by eye. This
     expectation was itself written with a literal U+00A0 once, and the test
     failed against output that looked identical. Keep the plain space. */
  const p = toSadkoProduct(P({ name: 'مبرد مياه&nbsp;كولدير', description: 'أ&amp;ب &lt;ج&gt;' }));
  assert.equal(p.title, 'مبرد مياه كولدير');
  assert.ok(!p.title.includes(String.fromCharCode(0xa0)), 'no U+00A0 may survive into a title');
  assert.equal(p.description, 'أ&ب <ج>');
});

test('decodeEntities handles numeric references', () => {
  assert.equal(decodeEntities('&#1587;&#x644;&#39;'), "سل'");
});

/* ---- stock: the real Ecwid model ---- */

test('stock tracking is read from `unlimited`, not a trackQuantity field', () => {
  assert.equal(toSadkoProduct(P({ unlimited: false, quantity: 5 })).stockTracked, true);
  assert.equal(toSadkoProduct(P({ unlimited: true })).stockTracked, false);
});

test('quantity is carried through when it is tracked', () => {
  assert.equal(toSadkoProduct(P({ quantity: 12 })).quantity, 12);
});

test('an unlimited product reports no quantity rather than zero', () => {
  assert.equal(toSadkoProduct(P({ unlimited: true, quantity: 0 })).quantity, null);
});

test('out of stock is reported, and the product is still returned', () => {
  const p = toSadkoProduct(P({ inStock: false, quantity: 0 }));
  assert.equal(p.inStock, false);
  assert.ok(p.id, 'hiding it here is forbidden — the sort rule handles presentation');
});

test('inStock falls back to the quantity when Ecwid omits the flag', () => {
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 0, unlimited: false })).inStock, false);
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 3, unlimited: false })).inStock, true);
  assert.equal(toSadkoProduct(P({ inStock: undefined, quantity: 0, unlimited: true })).inStock, true);
});

/* ---- the discount provenance rule ---- */

test('a real was-price is kept when it exceeds the price', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 8999 })).compareToPrice, 8999);
});

test('a stale was-price equal to or below the price is ignored', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 6999 })).compareToPrice, null);
  assert.equal(toSadkoProduct(P({ compareToPrice: 5000 })).compareToPrice, null);
});

test('a zero or absent was-price is ignored, never treated as a discount', () => {
  assert.equal(toSadkoProduct(P({ compareToPrice: 0 })).compareToPrice, null);
  assert.equal(toSadkoProduct(P({ compareToPrice: null })).compareToPrice, null);
});

test('the discount percent is derived only from a kept was-price', () => {
  assert.equal(toSadkoProduct(P({ price: 18500, compareToPrice: 23900 })).discountPercent, 23);
  assert.equal(toSadkoProduct(P({ price: 18500, compareToPrice: 100 })).discountPercent, null);
});

/* ---- shipping ---- */

test('isShippingRequired is carried, and a missing weight is null not zero', () => {
  const p = toSadkoProduct(P({ isShippingRequired: true, weight: 0 }));
  assert.equal(p.shippingRequired, true);
  assert.equal(p.weight, null, 'zero must not masquerade as a known weight of 0 kg');
});

test('a real weight is kept', () => {
  assert.equal(toSadkoProduct(P({ weight: 62.5 })).weight, 62.5);
});

/* ---- images ---- */

test('gallery images are collected, main image first, without duplicates', () => {
  const p = toSadkoProduct(P({
    imageUrl: 'https://cdn/main.webp',
    galleryImages: [{ id: 1, url: 'https://cdn/a.webp' }, { id: 2, url: 'https://cdn/main.webp' }],
  }));
  assert.deepEqual(p.images, ['https://cdn/main.webp', 'https://cdn/a.webp']);
  assert.equal(p.image, 'https://cdn/main.webp');
});

test('a product with no image at all maps with an empty image, not undefined', () => {
  const p = toSadkoProduct(P({ imageUrl: '', galleryImages: [], originalImageUrl: '', thumbnailUrl: '' }));
  assert.equal(p.image, '');
  assert.deepEqual(p.images, []);
});

/* ---- brand lives in attributes, not a top-level field ---- */

test('brand is read from a BRAND attribute when present', () => {
  const p = toSadkoProduct(P({ attributes: [{ name: 'Brand', type: 'BRAND', value: 'كريازي' }] }));
  assert.equal(p.brand, 'كريازي');
});

test('brand is empty when the store keeps no attributes — which is the SADKO case', () => {
  assert.equal(toSadkoProduct(P({ attributes: [] })).brand, '');
});

test('a non-brand attribute does not become the brand', () => {
  assert.equal(toSadkoProduct(P({ attributes: [{ name: 'Warranty', type: 'CUSTOM', value: '1 سنة' }] })).brand, '');
});

/* ---- categories ---- */

test('categoryIds are preserved so rails can use secondary membership', () => {
  const p = toSadkoProduct(P({ defaultCategoryId: 1, categoryIds: [1, 173607281] }));
  assert.deepEqual(p.categoryIds, ['1', '173607281']);
});

test('a product in no category maps with a null categoryId rather than "0"', () => {
  /* 7 ENABLED products in the live store are in no category; Ecwid reports
     defaultCategoryId 0, which must not be mistaken for a real category. */
  const p = toSadkoProduct(P({ defaultCategoryId: 0, categoryIds: [] }));
  assert.equal(p.categoryId, null);
  assert.deepEqual(p.categoryIds, []);
});

/* ---- placeholder shells ---- */

test('a product with no name is flagged as incomplete rather than silently published', () => {
  /* 463 products in the live store are empty shells: no name, no image,
     no category. They must never reach the storefront as blank cards. */
  const p = toSadkoProduct(P({ name: '', enabled: false }));
  assert.equal(p.title, '');
  assert.equal(p.incomplete, true);
});

test('a normal product is not flagged incomplete', () => {
  assert.equal(toSadkoProduct(P()).incomplete, false);
});

/* ---- price ---- */

test('a price arriving as a string is coerced to a number', () => {
  assert.equal(toSadkoProduct(P({ price: '6999.0' })).price, 6999);
});

test('an unusable price maps to null rather than zero', () => {
  assert.equal(toSadkoProduct(P({ price: null })).price, null);
});

/* ---- enabled ---- */

test('enabled is carried so the sync can respect Ecwid visibility', () => {
  assert.equal(toSadkoProduct(P({ enabled: false })).enabled, false);
  assert.equal(toSadkoProduct(P()).enabled, true);
});

/* ---- the real payload ---- */

test('the real captured Ecwid product maps without throwing and yields core fields', () => {
  const p = toSadkoProduct(FIX);
  assert.equal(typeof p.id, 'string');
  assert.ok(p.id.length);
  assert.ok(typeof p.title === 'string');
  assert.ok(p.price === null || typeof p.price === 'number');
  assert.ok(p.compareToPrice === null || p.compareToPrice > p.price);
  assert.ok(Array.isArray(p.images));
  assert.ok(p.weight === null || p.weight > 0);
});

test('the real payload has a genuine discount, and it survives the provenance rule', () => {
  /* The captured product is priced 18,500 against a compare-to of 23,900. */
  const p = toSadkoProduct(FIX);
  assert.equal(p.compareToPrice, 23900);
  assert.equal(p.discountPercent, 23);
});

test('the real payload carries no weight, which is why delivery cannot be quoted yet', () => {
  assert.equal(toSadkoProduct(FIX).weight, null);
});

/* ============================ categories (Task 4) ======================== */

import { toSadkoCategory } from './ecwid-map.mjs';

const FIXC = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'ecwid-category.json'), 'utf8'));

const C = (over = {}) => ({
  id: 206629517, parentId: 206629761, orderBy: 10,
  name: 'نو فروست', enabled: true, productCount: 197,
  url: 'https://sadko-test.company.site/products/nw-frwst',
  description: '', imageUrl: 'https://cdn/c.jpg', thumbnailUrl: 'https://cdn/t.jpg',
  ...over,
});

test('maps an Ecwid category onto the fields the taxonomy needs', () => {
  const c = toSadkoCategory(C());
  assert.equal(c.id, '206629517');
  assert.equal(c.name, 'نو فروست');
  assert.equal(c.parentId, '206629761');
  assert.equal(c.order, 10);
  assert.equal(c.enabled, true);
  assert.equal(c.productCount, 197);
  assert.equal(c.image, 'https://cdn/c.jpg');
});

test('a top-level category has a null parent, not "0"', () => {
  assert.equal(toSadkoCategory(C({ parentId: 0 })).parentId, null);
  assert.equal(toSadkoCategory(C({ parentId: null })).parentId, null);
});

test('category names are entity-decoded like product titles', () => {
  assert.equal(toSadkoCategory(C({ name: 'أفران&nbsp;وبوتاجازات' })).name, 'أفران وبوتاجازات');
});

test('a disabled category is reported as disabled rather than dropped', () => {
  assert.equal(toSadkoCategory(C({ enabled: false })).enabled, false);
});

/* ---- the English-translation trap ---- */

test('an English slot holding ARABIC text is NOT treated as a translation', () => {
  /* The live store really does this: nameTranslated.en carries the Arabic
     name. Trusting it would print Arabic on the English pages — the exact
     half-translated-title bug mkcategories.mjs guards against. */
  const c = toSadkoCategory(C({ name: 'نو فروست', nameTranslated: { en: 'نو فروست' } }));
  assert.equal(c.nameEn, null);
});

test('an English slot holding different Arabic text is still rejected', () => {
  const c = toSadkoCategory(C({ name: 'نو فروست', nameTranslated: { en: 'ثلاجات نو فروست' } }));
  assert.equal(c.nameEn, null, 'Arabic script can never be an English name');
});

test('a genuine English translation IS kept', () => {
  const c = toSadkoCategory(C({ name: 'نو فروست', nameTranslated: { en: 'No Frost' } }));
  assert.equal(c.nameEn, 'No Frost');
});

test('an absent or empty translation yields null', () => {
  assert.equal(toSadkoCategory(C({ nameTranslated: undefined })).nameEn, null);
  assert.equal(toSadkoCategory(C({ nameTranslated: { en: '   ' } })).nameEn, null);
});

test('the real captured category maps, and its English slot is correctly refused', () => {
  const c = toSadkoCategory(FIXC);
  assert.equal(typeof c.id, 'string');
  assert.ok(c.name.length);
  assert.equal(c.nameEn, null, 'the live store stores Arabic in the en slot');
});

/* ======================== orders (Task 11) ============================== */

import { toEcwidOrder, toLocalStatus, toEcwidFulfillment, PAYMENT_STATUS, FEES_NOTE_AR } from './ecwid-map.mjs';
import { ORDER_STATUSES } from './accounts.mjs';

const ORDER = (over = {}) => ({
  ref: 'SDK-A1B2C3',
  createdAt: '2026-09-22T10:00:00.000Z',
  status: 'received',
  items: [
    { id: '865565594', title: 'تليفزيون بلوتو 65 بوصة', price: 21499, qty: 1, image: 'i.webp' },
    { id: '865564749', title: 'مسطح جورنيا 4 شعلة', price: 6999, qty: 2, image: 'j.webp' },
  ],
  subtotal: 21499 + 6999 * 2,
  payment: '6798-1567006926352',
  delivery: { name: 'محمد على', phone: '+201000000000', governorate: 'القاهرة',
              address: 'شارع ١٠', floor: '3', hasLift: true },
  note: 'اتصل قبل التوصيل',
  totals: { subtotal: 21499 + 6999 * 2, deliveryFee: null, installFee: null,
            grandTotal: null, currency: 'EGP' },
  ...over });
const USER = { email: 'buyer@example.com', name: 'محمد على', phone: '+201000000000' };
/* The live payment ids, as the mirror holds them. */
const METHODS = [
  { id: '6798-1567006926352', title: 'Cash on Delivery  الدفع عند الاستلام', restricted: false },
  { id: '80361-1761810127405', title: 'تقسيط البنك الاهلي ( ١٨ شهر ) على جميع منتجات كريازى', restricted: true, brand: 'كريازى' },
];

test('every line item is carried with its id, quantity and price', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.equal(o.items.length, 2);
  assert.equal(o.items[0].productId, 865565594);
  assert.equal(o.items[0].quantity, 1);
  assert.equal(o.items[0].price, 21499);
  assert.equal(o.items[1].quantity, 2);
});

test('the local ref travels with the order so the push can be idempotent', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.ok(JSON.stringify(o).includes('SDK-A1B2C3'), 'the SDK- ref must be findable');
  assert.equal(o.externalOrderId, 'SDK-A1B2C3');
});

test('the customer and delivery details are carried', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.equal(o.email, 'buyer@example.com');
  assert.equal(o.shippingPerson.name, 'محمد على');
  assert.equal(o.shippingPerson.countryCode, 'EG');
  assert.match(o.shippingPerson.street, /شارع ١٠/);
});

test('floor and lift reach the order, because they decide how delivery is done', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.match(o.orderComments, /الطابق/);
  assert.match(o.orderComments, /مصعد/);
});

/* ---- totals: the honesty rule ---- */

test('the order total is the items subtotal and nothing else', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.equal(o.subtotal, 35497);
  assert.equal(o.total, 35497);
});

test('no shipping cost is ever invented', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.ok(!('shippingRate' in o), 'a shipping rate must not be fabricated');
  assert.equal(o.shippingOption, undefined, 'a shipping option would imply a decided cost');
});

test('the fees-to-be-confirmed note travels on the order', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.ok(o.orderComments.includes(FEES_NOTE_AR));
  assert.match(FEES_NOTE_AR, /التوصيل/);
  assert.match(FEES_NOTE_AR, /التركيب/);
});

test("the customer's own note is kept alongside the fees note", () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.ok(o.orderComments.includes('اتصل قبل التوصيل'));
});

/* ---- payment ---- */

test('a live Ecwid payment id maps to that method by name', () => {
  const o = toEcwidOrder(ORDER(), USER, METHODS);
  assert.match(o.paymentMethod, /Cash on Delivery/);
  assert.equal(o.paymentStatus, PAYMENT_STATUS);
});

test('nothing is ever pushed as PAID — no money is taken at ordering time', () => {
  assert.equal(PAYMENT_STATUS, 'AWAITING_PAYMENT');
  for (const m of METHODS)
    assert.equal(toEcwidOrder(ORDER({ payment: m.id }), USER, METHODS).paymentStatus, 'AWAITING_PAYMENT');
});

test('a restricted plan records the restriction on the order for staff to check', () => {
  /* The site cannot verify eligibility — no brand field in the catalogue — so
     it hands staff the fact rather than a silent assumption. */
  const o = toEcwidOrder(ORDER({ payment: '80361-1761810127405' }), USER, METHODS);
  assert.match(o.orderComments, /كريازى/);
  assert.match(o.orderComments, /يُراجع|تأكيد|راجع/);
});

test('an unknown payment method THROWS rather than guessing', () => {
  assert.throws(() => toEcwidOrder(ORDER({ payment: 'not-a-method' }), USER, METHODS),
    /unknown payment method/i);
});

test('a missing payment method throws too', () => {
  assert.throws(() => toEcwidOrder(ORDER({ payment: undefined }), USER, METHODS),
    /unknown payment method/i);
});

test('the legacy built-in ids still map, so an order placed before the switch pushes', () => {
  /* A customer could have checkout open from before Ecwid was turned on. */
  for (const k of ['cod', 'bank', 'showroom']) {
    const o = toEcwidOrder(ORDER({ payment: k }), USER, METHODS);
    assert.equal(o.paymentStatus, 'AWAITING_PAYMENT');
    assert.ok(o.paymentMethod, k + ' produced no payment method name');
  }
});

test('an order with no items throws rather than pushing an empty order', () => {
  assert.throws(() => toEcwidOrder(ORDER({ items: [] }), USER, METHODS), /no items/i);
});

/* ---- status coming back ---- */

test('Ecwid fulfilment statuses map onto the site statuses', () => {
  assert.equal(toLocalStatus({ fulfillmentStatus: 'AWAITING_PROCESSING' }), 'received');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'PROCESSING' }), 'preparing');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'SHIPPED' }), 'shipping');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'DELIVERED' }), 'delivered');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'READY_FOR_PICKUP' }), 'shipping');
});

test('a cancelled or refunded order maps to cancelled whatever the fulfilment says', () => {
  assert.equal(toLocalStatus({ fulfillmentStatus: 'PROCESSING', paymentStatus: 'CANCELLED' }), 'cancelled');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'SHIPPED', paymentStatus: 'REFUNDED' }), 'cancelled');
});

test('an unknown Ecwid status maps to null so the local status is left untouched', () => {
  assert.equal(toLocalStatus({ fulfillmentStatus: 'SOMETHING_NEW' }), null);
  assert.equal(toLocalStatus({}), null);
  assert.equal(toLocalStatus(), null);
});

test('every value toLocalStatus can return is a real site status', () => {
  const ALLOWED = new Set(['received', 'confirmed', 'preparing', 'shipping', 'delivered', 'cancelled']);
  for (const f of ['AWAITING_PROCESSING', 'QUEUED', 'PROCESSING', 'SHIPPED', 'DELIVERED',
                   'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'WILL_NOT_DELIVER', 'RETURNED']) {
    const s = toLocalStatus({ fulfillmentStatus: f });
    if (s !== null) assert.ok(ALLOWED.has(s), f + ' produced "' + s + '", not a site status');
  }
});

/* ===================== descriptions are HTML ============================ */

import { stripHtml } from './ecwid-map.mjs';

test('a product description is stripped to plain text', () => {
  /* ALL 981 descriptions in the live store are HTML from Ecwid's rich-text
     editor. The seed catalogue was plain text, so nothing on the site ever
     stripped markup and the shop page rendered "<ul><li>تليفزيون…" as visible
     text on every single card. */
  const p = toSadkoProduct(P({
    description: '<h2>جهاز المشي</h2><p>قم بترقية تمارينك</p><ul><li>محرك قوى</li><li>شاشة رقمية</li></ul>',
  }));
  assert.ok(!/[<>]/.test(p.description), 'no markup may survive: ' + p.description);
  assert.match(p.description, /جهاز المشي/);
  assert.match(p.description, /محرك قوى/);
});

test('block boundaries become spaces, so words do not run together', () => {
  const p = toSadkoProduct(P({ description: '<li>أ</li><li>ب</li>' }));
  assert.equal(p.description, 'أ ب');
  assert.equal(toSadkoProduct(P({ description: '<p>أ</p><p>ب</p>' })).description, 'أ ب');
  assert.equal(toSadkoProduct(P({ description: 'أ<br>ب' })).description, 'أ ب');
});

test('the tags the live catalogue actually uses are all removed', () => {
  /* Measured across the store: a, br, div, em, h2, h4, img, label, li, main,
     p, pre, section, span, strong, u, ul. */
  const html = '<main><section><h2>ع</h2><h4>ن</h4><div><p><span><strong>أ</strong></span>' +
               '<em>ب</em><u>ج</u></p><ul><li>د</li></ul><pre>ه</pre>' +
               '<a href="x">و</a><img src="y"><label>ز</label><br></div></section></main>';
  const out = stripHtml(html);
  assert.ok(!/[<>]/.test(out), 'markup survived: ' + out);
  for (const ch of ['ع','ن','أ','ب','ج','د','ه','و','ز']) assert.ok(out.includes(ch), 'lost ' + ch);
});

test('an img or a tag cannot leave a URL in the visible text', () => {
  const out = stripHtml('<img src="https://cdn/x.jpg" alt="ص"><a href="https://evil/">نص</a>');
  assert.ok(!out.includes('https://'), 'a URL leaked into the description: ' + out);
  assert.match(out, /نص/);
});

test('escaped markup in the copy stays escaped, and is not turned into a tag', () => {
  /* Stripping runs BEFORE decoding on purpose. Decoding first would turn
     &lt;b&gt; in the author's text into a real tag that the stripper then
     silently deleted, changing what staff wrote. */
  const out = stripHtml('&lt;b&gt;مهم&lt;/b&gt;');
  assert.match(out, /<b>مهم<\/b>/, 'the author wrote those characters; they must survive');
});

test('a script fragment cannot survive as markup', () => {
  const out = stripHtml('<script>alert(1)</script>نص');
  assert.ok(!/[<>]/.test(out));
  assert.match(out, /نص/);
});

test('a plain-text description is left alone', () => {
  /* The entire July seed catalogue is plain text. */
  const p = toSadkoProduct(P({ description: 'العلامة التجارية: كولدير سعة 3.2 لتر' }));
  assert.equal(p.description, 'العلامة التجارية: كولدير سعة 3.2 لتر');
});

test('stripHtml on nothing is an empty string', () => {
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml(''), '');
});

test('the REAL captured description comes out clean', () => {
  const p = toSadkoProduct(FIX);
  assert.ok(!/[<>]/.test(p.description), 'markup in the real payload survived');
  assert.ok(p.description.length > 0, 'the description was emptied entirely');
});


/* ======================================================================
   safeHtml — the PDP's rich description.

   stripHtml flattens Ecwid's rich text to a single line, which is right for a
   card and wrong for a product page: a spec list becomes a run-on sentence.
   safeHtml keeps the STRUCTURE and drops everything else.

   It is an allow-list with no attributes at all. That is deliberate and it is
   the whole security argument: this HTML is written into innerHTML on the
   site's own origin, so a surviving href/src/style/on* would run or beacon
   with the shopper's session. Staff-authored is not the same as trusted.
   ================================================================== */

test('safeHtml keeps the structure a description is written in', () => {
  const html = safeHtml('<h2>المواصفات</h2><ul><li>سعة ١٠ قدم</li><li>انفرتر</li></ul>');
  assert.match(html, /<h2>المواصفات<\/h2>/);
  assert.match(html, /<ul><li>سعة ١٠ قدم<\/li><li>انفرتر<\/li><\/ul>/);
});

test('safeHtml drops every attribute, including the harmless-looking ones', () => {
  /* An allow-list of attributes is a maintenance trap; none are needed to
     render a description. */
  const html = safeHtml('<p class="x" style="color:red" dir="rtl">نص</p>');
  assert.equal(html, '<p>نص</p>');
});

test('safeHtml removes an event handler with the tag that carried it', () => {
  const html = safeHtml('<p onclick="alert(1)">نص</p>');
  assert.ok(!/onclick/i.test(html));
  assert.equal(html, '<p>نص</p>');
});

test('safeHtml removes script and its CONTENT, not just the tags', () => {
  /* Dropping only the tags would leave the code as text — and a later
     innerHTML of that text could execute it. */
  const html = safeHtml('<p>قبل</p><script>alert(1)</script><p>بعد</p>');
  assert.ok(!html.includes('alert'), 'script body survived: ' + html);
  assert.equal(html, '<p>قبل</p><p>بعد</p>');
});

test('safeHtml removes style and iframe bodies too', () => {
  assert.ok(!safeHtml('<style>body{display:none}</style><p>ن</p>').includes('display'));
  assert.equal(safeHtml('<iframe src="https://evil.test"></iframe><p>ن</p>'), '<p>ن</p>');
});

test('safeHtml drops images and links but keeps the link TEXT', () => {
  /* Ecwid descriptions carry both. An <img> from a third-party host would
     report every product view to it; a link could be swapped for a phishing
     target. The words the author wrote are kept. */
  const html = safeHtml('<p>شوف <a href="https://evil.test">الصفحة</a></p><img src="https://evil.test/x.gif">');
  assert.ok(!html.includes('evil.test'));
  assert.ok(!/<img/i.test(html));
  assert.equal(html, '<p>شوف الصفحة</p>');
});

test('safeHtml keeps escaped markup escaped rather than reviving it', () => {
  /* &lt;script&gt; in the copy is TEXT the author wrote. Decoding it first —
     which stripHtml deliberately avoids — would turn it into a real tag. */
  const html = safeHtml('<p>اكتب &lt;script&gt; كنص</p>');
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<script'));
});

test('safeHtml does not mistake a bare < for a tag', () => {
  assert.match(safeHtml('<p>السعة < 10 لتر</p>'), /السعة/);
});

test('safeHtml returns an empty string for nothing, never null or "undefined"', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(safeHtml(v), '');
});

test('safeHtml on plain text wraps nothing and invents nothing', () => {
  assert.equal(safeHtml('نص عادى'), 'نص عادى');
});

test('a mapped product carries both the plain and the rich description', () => {
  const p = toSadkoProduct({ id: 1, name: 'ث', price: 10,
    description: '<h2>مواصفات</h2><ul><li>أ</li></ul>' });
  /* plain: what cards, search and skSpecs read */
  assert.equal(p.description, 'مواصفات أ');
  /* rich: what the PDP renders */
  assert.match(p.descriptionHtml, /<h2>مواصفات<\/h2>/);
});

test('descriptionHtml is empty when there is no description, not "undefined"', () => {
  assert.equal(toSadkoProduct({ id: 1, name: 'ث', price: 10 }).descriptionHtml, '');
});

/* ===================== site -> Ecwid fulfilment status =====================
   The reverse of toLocalStatus, for the admin orders desk pushing a status UP.
   The property that matters is not "every status maps" — it is that every
   status we DO push survives the round trip, because the webhook echo comes
   straight back through toLocalStatus and would otherwise rewrite the status
   the operator just chose. `confirmed` has no Ecwid equivalent (PROCESSING is
   already `preparing`) so it is deliberately unmapped rather than mapped to
   something that comes back as a different status. */

test('every pushable status survives the round trip through Ecwid', () => {
  for (const local of ORDER_STATUSES) {
    const remote = toEcwidFulfillment(local);
    if (remote === null) continue;                       // not pushed, by design
    assert.equal(toLocalStatus({ fulfillmentStatus: remote }), local,
      `${local} -> ${remote} -> ${toLocalStatus({ fulfillmentStatus: remote })}`);
  }
});

test('confirmed is deliberately NOT pushed: it would come back as preparing', () => {
  assert.equal(toEcwidFulfillment('confirmed'), null);
  /* Proof the exclusion is not arbitrary: the only sane candidate round-trips
     to a DIFFERENT status, which would silently overwrite the operator. */
  assert.equal(toLocalStatus({ fulfillmentStatus: 'PROCESSING' }), 'preparing');
});

test('the five pushable statuses map to the Ecwid names staff recognise', () => {
  assert.equal(toEcwidFulfillment('received'), 'AWAITING_PROCESSING');
  assert.equal(toEcwidFulfillment('preparing'), 'PROCESSING');
  assert.equal(toEcwidFulfillment('shipping'), 'SHIPPED');
  assert.equal(toEcwidFulfillment('delivered'), 'DELIVERED');
  assert.equal(toEcwidFulfillment('cancelled'), 'WILL_NOT_DELIVER');
});

test('an unknown or empty status is never pushed', () => {
  for (const v of [null, undefined, '', 'nonsense', 'RECEIVED ']) {
    assert.equal(toEcwidFulfillment(v), null);
  }
});
