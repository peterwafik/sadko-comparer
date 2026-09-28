# Automatic Delivery Fees and Shipment Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checkout shows the exact delivery fee from Ecwid's own Shipping & Pickup rates, the Ecwid order carries it, and customers can see the Ecwid tracking number and status.

**Architecture:** Three pure modules. `shipping-regions` maps a governorate to a region, `size-class` maps a product to a size band, and the rate card plus quote live in the existing `ecwid-shipping`. The server recomputes every fee itself (the browser's figure is only compared, never trusted), stores it on the order, and pushes it to Ecwid as a shipping line. Tracking rides on the existing live read of Ecwid orders (`fromEcwidOrder` / `mergeOrders`). Guests look up status through Ecwid by the order id stored in `order_push`, because guest details are deliberately deleted from this server after the push.

**Tech Stack:** Node 24, zero dependencies, `node:test`, `node:sqlite`; vanilla browser JS (classic scripts, no build step).

**Spec:** `docs/superpowers/specs/2026-09-28-shipping-and-tracking-design.md`

**Deviations from the spec (simplifications):**
- §4.7 said tracking would be stored on the local order by the webhook. It is read live instead, through the existing `fromEcwidOrder` / `mergeOrders` path (60 s cache), so there is no new storage and no new write path.
- The customer's order row shows the status chip plus the tracking number and link, rather than a separate timeline graphic.

## Global Constraints

- Run all tests from `site/`: `node --test engine/*.test.mjs`. The suite is 1390 passing before this work, and must stay fully green after every task.
- Never key anything on an Ecwid category or product **id**: the test store (142682751) and production (18028328) share none. Use category **names**.
- The site never invents a number: any missing input → `quotable: false`, and the customer sees «تؤكده خدمة العملاء» / "confirmed by customer care".
- No cap on the metro fee: `perOrder + perItem × total quantity`.
- Sinai (شمال سيناء، جنوب سيناء) and unknown governorates → region `null`. North Coast (الساحل الشمالى) → `upper`.
- There is no carrier field; the tracking link falls back to `https://movex.com.eg`.
- Every changed browser file gets its `?v=` bumped in every HTML page that loads it (`grep -rl "file.js?v=" --include=*.html site`).
- New server files under `site/engine/` are never served: `engine/static-allow.mjs` already refuses them. Browser code gets data only through `/api/…`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Legacy or English governorate values** in saved profiles («أخرى», "Cairo", «محافظة الجيزة»): `regionOf` must resolve the real ones and return `null` for «أخرى». Pinned in Task 1.
2. **An old checkout tab with no `quotedFee`** placing an order that is now quotable: it must get `409 delivery-fee-changed`, never a silent charge. Pinned in Task 4.
3. **First boot before the first Ecwid sync** (no shipping methods stored): the quote must return `quotable:false, reason:'no-rates'` without throwing. Pinned in Task 3.
4. **Guest phone formats** (`+201027890565` vs `01027890565` vs spaces): the lookup must match on the last 10 digits, and still refuse a different number. Pinned in Task 8.
5. **Quantity > 1** of one product in the Delta or Upper Egypt region: the fee is `perItem × qty`, not charged once. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `site/engine/shipping-regions.mjs` (new) | governorate list, `regionOf`, `metroKeyOf` |
| `site/engine/size-class.mjs` (new) | `sizeClassOf(product, categoryName)` |
| `site/assets/js/specs.js` (modify, last lines) | also export via `module.exports`, so the server shares the browser's parser |
| `site/engine/ecwid-sync.mjs` (modify `toShippingMethod`) | keep `rates` and `flatRate` from Ecwid |
| `site/engine/ecwid-shipping.mjs` (modify, append) | `rateCard(methods)`, `quoteDelivery({lines, governorate, card})` |
| `site/engine/fixtures/ecwid-shipping-options.json` (new) | the real `GET /profile/shippingOptions` response (no personal data) |
| `site/engine/accounts.mjs` (modify `createOrder`) | accept a `deliveryQuote` and store fee and grand total |
| `site/compare-server.mjs` (modify) | `/api/delivery/governorates`, `/api/delivery/quote`, fee recompute plus 409 on both order routes, `/api/orders/track`, `/api/admin/delivery-classes` |
| `site/engine/ecwid-map.mjs` (modify `toEcwidOrder`) | `shippingOption`, total and breakdown for quotable orders |
| `site/engine/ecwid-customers.mjs` (modify) | `trackingOf(remote)`; tracking in `fromEcwidOrder` and `mergeOrders` |
| `site/assets/js/checkout.js`, `site/assets/js/account.js`, `site/orders.html`, `site/cart.html`, `site/assets/js/admin.js` (modify) | the UI |

---

### Task 1: Governorate → region

**Files:**
- Create: `site/engine/shipping-regions.mjs`
- Test: `site/engine/shipping-regions.test.mjs`

**Interfaces:**
- Produces:
  - `GOVERNORATES: Array<{ar:string, en:string, region:'metro'|'delta'|'upper'|null}>`, in display order.
  - `regionOf(name:string) → 'metro'|'delta'|'upper'|null`.
  - `metroKeyOf(name:string) → 'cairo'|'giza'|'alex'|null`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/shipping-regions.test.mjs`
Expected: FAIL with `Cannot find module … shipping-regions.mjs`

- [ ] **Step 3: Write the implementation**

```js
// site/engine/shipping-regions.mjs
/* ============================================================================
   Governorate → delivery region.

   Every Ecwid shipping method has destinationZone WORLD, so Ecwid cannot tell
   Aswan from Cairo; the region exists only in the method NAMES. This is that
   reading, made explicit: three regions exactly as the store titles them, and
   null — "customer care confirms the fee" — for anywhere they do not name.
   ========================================================================== */

const LIST = [
  ['القاهرة', 'Cairo', 'metro', 'cairo'], ['الجيزة', 'Giza', 'metro', 'giza'],
  ['الإسكندرية', 'Alexandria', 'metro', 'alex'],
  ['القليوبية', 'Qalyubia', 'delta'], ['الشرقية', 'Sharqia', 'delta'], ['الدقهلية', 'Dakahlia', 'delta'],
  ['الغربية', 'Gharbia', 'delta'], ['المنوفية', 'Monufia', 'delta'], ['كفر الشيخ', 'Kafr El Sheikh', 'delta'],
  ['دمياط', 'Damietta', 'delta'], ['البحيرة', 'Beheira', 'delta'], ['بورسعيد', 'Port Said', 'delta'],
  ['الإسماعيلية', 'Ismailia', 'delta'], ['السويس', 'Suez', 'delta'],
  ['الفيوم', 'Fayoum', 'upper'], ['بنى سويف', 'Beni Suef', 'upper'], ['المنيا', 'Minya', 'upper'],
  ['أسيوط', 'Assiut', 'upper'], ['سوهاج', 'Sohag', 'upper'], ['قنا', 'Qena', 'upper'],
  ['الأقصر', 'Luxor', 'upper'], ['أسوان', 'Aswan', 'upper'], ['الوادى الجديد', 'New Valley', 'upper'],
  ['مطروح', 'Matrouh', 'upper'], ['البحر الأحمر', 'Red Sea', 'upper'],
  ['الساحل الشمالى', 'North Coast', 'upper'],
  ['شمال سيناء', 'North Sinai', null], ['جنوب سيناء', 'South Sinai', null],
];

/* Names people actually type or had saved, mapped onto an entry above. */
const ALIASES = [
  ['مرسى مطروح', 'مطروح'], ['حلوان', 'القاهرة'], ['6 أكتوبر', 'الجيزة'], ['السادس من أكتوبر', 'الجيزة'],
  ['الشيخ زايد', 'الجيزة'], ['القاهرة الكبرى', 'القاهرة'],
];

export function normGov(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/^محافظه\s+/, '').replace(/\s+/g, ' ');
}

const BY = new Map();
for (const [ar, en, region, metro] of LIST) {
  const v = { region: region || null, metro: metro || null };
  BY.set(normGov(ar), v); BY.set(normGov(en), v);
}
for (const [alias, target] of ALIASES) {
  const t = BY.get(normGov(target));
  if (t) BY.set(normGov(alias), { region: t.region, metro: alias === '6 أكتوبر' || alias === 'السادس من أكتوبر' || alias === 'الشيخ زايد' ? 'giza' : t.metro });
}

export const GOVERNORATES = LIST.map(([ar, en, region]) => ({ ar, en, region: region || null }));
export function regionOf(name) { const v = BY.get(normGov(name)); return v ? v.region : null; }
export function metroKeyOf(name) { const v = BY.get(normGov(name)); return v ? v.metro : null; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test engine/shipping-regions.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add site/engine/shipping-regions.mjs site/engine/shipping-regions.test.mjs
git commit -m "feat(delivery): governorate to region, as the Ecwid method names draw it"
```

---

### Task 2: Product → size class (and share the specs parser with the server)

**Files:**
- Modify: `site/assets/js/specs.js` (the single `window.skSpecs = …` line near the end)
- Create: `site/engine/size-class.mjs`
- Test: `site/engine/size-class.test.mjs`

**Interfaces:**
- Consumes: `require('../assets/js/specs.js').derive(product)` → `{ cap: { litre?, inch? } }`.
- Produces: `sizeClassOf(product:{title:string, description?:string}, categoryName:string) → { cls: 'small'|'medium'|'large'|'xl'|'craft'|null, why: { ar:string, en:string } }` and `CLASS_LABELS: { small:{ar,en}, medium:{ar,en}, large:{ar,en}, xl:{ar,en}, craft:{ar,en} }`.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/size-class.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeClassOf } from './size-class.mjs';

const cls = (title, cat) => sizeClassOf({ title }, cat).cls;

test('each category name maps to its band', () => {
  assert.equal(cls('خلاط براون', 'خلاطات و محضرات طعام'), 'small');
  assert.equal(cls('مكواة فيليبس', 'مكاوى'), 'small');
  assert.equal(cls('ميكرويف شارب 25 لتر', 'ميكروييف'), 'small');
  assert.equal(cls('مكنسة هوفر', 'مكانس'), 'small');
  assert.equal(cls('قلاية هوائية', 'قلايات'), 'small');
  assert.equal(cls('بوتاجاز فريش', '5 شعلة'), 'medium');
  assert.equal(cls('تكييف شارب 1.5 حصان', 'تكييفات هواء'), 'medium');
  assert.equal(cls('سخان اوليمبيك', 'سخانات كهرباء'), 'medium');
  assert.equal(cls('غسالة اطباق بيكو', 'غسالات أطباق'), 'medium');
  assert.equal(cls('غسالة توشيبا 8 كيلو', 'غسالات ملابس'), 'medium');
  assert.equal(cls('ديب فريزر', 'فريزر أفقى'), 'large');
  assert.equal(cls('زيت زيتون', 'حرف يدوية ومنتجات عضوية'), 'craft');
});

test('refrigerators split on 450 litres, and a 4-door is extra-large', () => {
  assert.equal(cls('ثلاجة شارب 450 لتر', 'نو فروست'), 'large');
  assert.equal(cls('ثلاجة شارب 451 لتر', 'نو فروست'), 'xl');
  assert.equal(cls('ثلاجة توشيبا 350 لتر 4 باب', 'ديفروست'), 'xl');
  assert.equal(cls('ثلاجة بدون سعة', 'نو فروست'), null, 'no litres in the title → no guess');
});

test('televisions split at 50 and 75 inches', () => {
  assert.equal(cls('شاشة سامسونج 49 بوصة', 'تليفزيونات'), 'medium');
  assert.equal(cls('شاشة سامسونج 50 بوصة', 'تليفزيونات'), 'large');
  assert.equal(cls('شاشة سامسونج 75 بوصة', 'تليفزيونات'), 'large');
  assert.equal(cls('شاشة سامسونج 76 بوصة', 'تليفزيونات'), 'xl');
  assert.equal(cls('شاشة سامسونج', 'تليفزيونات'), null);
});

test('the fans-and-coolers category is split by what the product is', () => {
  const C = 'مبردات هواء ومراوح';
  assert.equal(cls('مروحة ستاند توشيبا', C), 'small');
  assert.equal(cls('دفاية زيت ديلونجى 9 ريشة', C), 'small');
  assert.equal(cls('شفاط حمام فريش 6 بوصة', C), 'small');
  assert.equal(cls('شفاط تورنيدو 25 سم بالشبكة', C), 'small');
  assert.equal(cls('شفاط بيكو 90 سم – استيل', C), 'medium', 'a cooker hood is an installation, not a small appliance');
  assert.equal(cls('شفاط بوتاجاز فريش 60 سم', C), 'medium');
  assert.equal(cls('مبرد هواء كولدير', C), 'medium');
  assert.equal(cls('جهاز غامض', C), null);
});

test('a wash-tower washer is extra-large', () => {
  assert.equal(cls('غسالة ال جى واش تاور', 'غسالات ملابس'), 'xl');
  assert.equal(cls('LG Wash Tower 13kg', 'غسالات ملابس'), 'xl');
});

test('unknown categories classify only on an unambiguous title', () => {
  assert.equal(cls('ثلاجة شارب 300 لتر', 'عروض صادكو'), 'large');
  assert.equal(cls('جهاز المشي ProForm', ''), null);
  assert.equal(cls('إعلان مربع ١', undefined), null);
});

test('every answer carries a reason in both languages', () => {
  for (const [t, c] of [['ثلاجة بدون سعة', 'نو فروست'], ['مروحة', 'مبردات هواء ومراوح'], ['x', 'y']]) {
    const r = sizeClassOf({ title: t }, c);
    assert.ok(r.why && r.why.ar && r.why.en, JSON.stringify(r));
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/size-class.test.mjs`
Expected: FAIL with `Cannot find module … size-class.mjs`

- [ ] **Step 3: Make specs.js loadable from Node.** Replace its last assignment line:

```js
  window.skSpecs = { derive, of, norm, sizeFor, acHpFor, BRANDS, FAMILY };
```

with:

```js
  /* The server derives delivery size classes from the same parser, so the
     product page and the delivery fee can never disagree about a size. */
  const api = { derive, of, norm, sizeFor, acHpFor, BRANDS, FAMILY };
  if (typeof window !== 'undefined') window.skSpecs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
```

- [ ] **Step 4: Write size-class.mjs**

```js
// site/engine/size-class.mjs
/* ============================================================================
   Product → delivery size band.

   Ecwid charges the Delta and Upper Egypt per item by band — small, medium,
   large, extra-large — and defines each band only in words inside the method
   titles. This reads a product into one of those bands, by category NAME
   (the test and production stores share no ids), and uses the product's own
   size where the store splits a category by it. It returns null rather than
   guessing: a null band means customer care confirms the fee.
   ========================================================================== */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const specs = require('../assets/js/specs.js');

export const CLASS_LABELS = {
  small: { ar: 'منتجات صغيرة', en: 'Small appliance' },
  medium: { ar: 'منتجات متوسطة', en: 'Medium appliance' },
  large: { ar: 'منتجات كبيرة', en: 'Large appliance' },
  xl: { ar: 'منتجات كبيرة جدا', en: 'Extra-large appliance' },
  craft: { ar: 'حرف يدوية ومنتجات عضوية', en: 'Handicrafts & organic' },
};

const N = s => String(s == null ? '' : s).trim().toLowerCase()
  .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ');

const why = (ar, en) => ({ ar, en });
const ok = (cls, ar, en) => ({ cls, why: why(ar, en) });
const no = (ar, en) => ({ cls: null, why: why(ar, en) });

function fridge(p) {
  const t = N(p.title);
  if (/(4|٤)\s*باب/.test(t)) return ok('xl', 'ثلاجة 4 باب', '4-door refrigerator');
  const l = specs.derive(p).cap.litre;
  if (!l) return no('ثلاجة بدون سعة باللتر فى العنوان', 'refrigerator with no litres in its title');
  return l > 450 ? ok('xl', `ثلاجة ${l} لتر (فوق 450)`, `${l} L refrigerator (over 450)`)
                 : ok('large', `ثلاجة ${l} لتر (حتى 450)`, `${l} L refrigerator (up to 450)`);
}
function tv(p) {
  const i = specs.derive(p).cap.inch;
  if (!i) return no('شاشة بدون مقاس بالبوصة فى العنوان', 'television with no inches in its title');
  if (i < 50) return ok('medium', `شاشة ${i} بوصة`, `${i}" television`);
  if (i <= 75) return ok('large', `شاشة ${i} بوصة (50–75)`, `${i}" television (50–75)`);
  return ok('xl', `شاشة ${i} بوصة (فوق 75)`, `${i}" television (over 75)`);
}
function washer(p) {
  return /واش\s*تاور|وتش\s*تور|wash\s*tower/i.test(p.title || '')
    ? ok('xl', 'غسالة واش تاور', 'wash-tower washer') : ok('medium', 'غسالة ملابس', 'washing machine');
}
function fanOrCooler(p) {
  const t = N(p.title);
  if (/شفاط/.test(t)) {
    const cm = Number((/(\d{2,3})\s*سم/.exec(t) || [])[1]);
    if (/بوتاجاز|بوتجاز|هرمي|مدخنه/.test(t) || cm >= 60)
      return ok('medium', 'شفاط بوتاجاز', 'cooker hood');
    return ok('small', 'شفاط', 'extractor fan');
  }
  if (/مروحه|مراوح|دفايه|دفاده|\bfan\b|heater/.test(t)) return ok('small', 'مروحة أو دفاية', 'fan or heater');
  if (/مبرد|cooler/.test(t)) return ok('medium', 'مبرد هواء', 'air cooler');
  return no('منتج غير واضح فى قسم المراوح والمبردات', 'unclear product in fans & coolers');
}

const BY_CATEGORY = new Map([
  ...['خلاطات و محضرات طعام', 'مكاوي', 'كاتيل و ماكينات قهوه', 'ميكروييف', 'مكانس', 'قلايات', 'افران كهربائيه']
    .map(c => [c, () => ok('small', 'جهاز صغير', 'small appliance')]),
  ...['تكييفات هواء', 'سخانات كهرباء', 'سخانات غاز', '5 شعله', '4 شعله', 'غسالات اطباق', 'مبردات مياه']
    .map(c => [c, () => ok('medium', 'جهاز متوسط', 'medium appliance')]),
  ...['فريزر راسي', 'فريزر افقي'].map(c => [c, () => ok('large', 'فريزر', 'freezer')]),
  ['نو فروست', fridge], ['ديفروست', fridge], ['تليفزيونات', tv], ['غسالات ملابس', washer],
  ['مبردات هواء ومراوح', fanOrCooler],
  ['حرف يدويه ومنتجات عضويه', () => ok('craft', 'حرف يدوية', 'handicraft')],
]);

/* For categories the table does not name (offers, unnamed folders): the title
   alone, and only when exactly one family matches. */
const BY_TITLE = [
  [/ثلاج/, fridge], [/شاشه|تليفزيون|تلفزيون/, tv], [/غساله ملابس|غساله [^ا]/, washer],
  [/تكييف|سخان|بوتاجاز|بوتجاز/, () => ok('medium', 'جهاز متوسط', 'medium appliance')],
  [/مروحه|دفايه/, () => ok('small', 'مروحة أو دفاية', 'fan or heater')],
  [/ميكرويف|مكواه|خلاط|كاتل|مكنسه/, () => ok('small', 'جهاز صغير', 'small appliance')],
];

export function sizeClassOf(product, categoryName) {
  const p = { title: String((product && product.title) || ''), description: String((product && product.description) || '') };
  const rule = BY_CATEGORY.get(N(categoryName));
  if (rule) return rule(p);
  const t = N(p.title);
  const hits = BY_TITLE.filter(([re]) => re.test(t));
  if (hits.length === 1) return hits[0][1](p);
  return no('القسم غير معروف لتحديد فئة الشحن', 'category not recognised for delivery');
}
```

- [ ] **Step 5: Run the tests to verify they pass, including the suites that load specs.js in the browser style**

Run: `node --test engine/size-class.test.mjs engine/storefront.test.mjs engine/shop-wiring.test.mjs`
Expected: PASS, all tests

- [ ] **Step 6: Measure against the real catalogue** (a sanity check, not a test; `data/ecwid.db` is local-only)

Run from `site/`:
```bash
node --input-type=module -e "
import { sizeClassOf } from './engine/size-class.mjs';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/ecwid.db', { readOnly: true });
const cats = new Map(db.prepare('select id,data_json from categories').all().map(r => [String(r.id), JSON.parse(r.data_json).name]));
const t = {};
for (const r of db.prepare('select data_json from products').all()) { const p = JSON.parse(r.data_json);
  const c = sizeClassOf(p, cats.get(String(p.categoryId))).cls || 'null'; t[c] = (t[c] || 0) + 1; }
console.log(t);"
```
Expected: `null` of roughly 40–45 (treadmills and advert placeholders); every other product has a class.

- [ ] **Step 7: Bump the specs.js version and commit**

```bash
grep -rl "specs.js?v=a4" --include=*.html site | xargs sed -i 's/specs\.js?v=a4/specs.js?v=a5/g'
git add site/assets/js/specs.js site/engine/size-class.mjs site/engine/size-class.test.mjs site/*.html site/category/*.html
git commit -m "feat(delivery): derive each product's delivery size band from category and size"
```

---

### Task 3: Rate card and quote

**Files:**
- Create: `site/engine/fixtures/ecwid-shipping-options.json`
- Modify: `site/engine/ecwid-sync.mjs` (`toShippingMethod`, around line 43)
- Modify: `site/engine/ecwid-shipping.mjs` (append)
- Test: `site/engine/delivery-quote.test.mjs`

**Interfaces:**
- Consumes: `regionOf`, `metroKeyOf` (Task 1).
- Produces:
  - `rateCard(methods) → { metro:{cairo?,giza?,alex?}, delta:{small?,medium?,large?,xl?}, upper:{…same}, craft?:Rate, problems:Array<{title,code}> } | null`, where `Rate = { perOrder:number, perItem:number, title:string, note:string|null }`.
  - `quoteDelivery({ lines:Array<{id:string, qty:number, cls:string|null}>, governorate:string, card }) → { quotable:true, fee:number, lines:Array<{id,cls,fee}>, perOrder:Array<{title,fee}>, methodName:string, notes:string[] } | { quotable:false, reason:'no-region'|'no-rates'|'unclassified'|'no-rate'|'craft-area', id?:string }`.
  - `toShippingMethod` output gains `rates: { basedOn, rows: Array<{from, to, perOrder, perItem}> } | null` and `flatRate: { type, rate } | null`.

- [ ] **Step 1: Capture the fixture.** From `site/`, with the test-store token in `.ecwid.env` (it contains titles and prices only, no personal data):

```bash
node --input-type=module -e "
import { ecwidEnv } from './tools/ecwid-env.mjs'; import { writeFileSync } from 'node:fs';
const e = ecwidEnv();
const r = await fetch('https://app.ecwid.com/api/v3/' + e.storeId + '/profile/shippingOptions', { headers: { Authorization: 'Bearer ' + e.token } });
writeFileSync('engine/fixtures/ecwid-shipping-options.json', JSON.stringify(await r.json(), null, 1));"
node -e "const o=require('./engine/fixtures/ecwid-shipping-options.json');console.log(o.length, o.filter(x=>x.enabled).length)"
```
Expected: `18 12`

- [ ] **Step 2: Write the failing test**

```js
// site/engine/delivery-quote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rateCard, quoteDelivery } from './ecwid-shipping.mjs';
import { toShippingMethodForTest } from './ecwid-sync.mjs';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/ecwid-shipping-options.json', import.meta.url), 'utf8'));
const METHODS = RAW.map(toShippingMethodForTest).filter(m => m.enabled);
const CARD = rateCard(METHODS);
const q = (governorate, lines) => quoteDelivery({ governorate, lines, card: CARD });

test('the rate card reads the real store: metro, both banded regions, and crafts', () => {
  assert.deepEqual([CARD.metro.cairo.perOrder, CARD.metro.cairo.perItem], [200, 50]);
  assert.ok(CARD.metro.giza && CARD.metro.alex);
  assert.deepEqual(['small', 'medium', 'large', 'xl'].map(k => CARD.delta[k].perItem), [275, 525, 630, 1140]);
  assert.deepEqual(['small', 'medium', 'large', 'xl'].map(k => CARD.upper[k].perItem), [330, 605, 845, 1320]);
  assert.equal(CARD.craft.perOrder, 50);
  assert.deepEqual(CARD.problems, []);
});

test('the worked examples from the spec', () => {
  const cart = [{ id: 'f', qty: 1, cls: 'xl' }, { id: 'a', qty: 1, cls: 'small' }];
  const sohag = q('سوهاج', cart);
  assert.equal(sohag.quotable, true);
  assert.equal(sohag.fee, 1650);
  assert.deepEqual(sohag.lines.map(l => l.fee), [1320, 330]);
  assert.equal(q('القاهرة', cart).fee, 300);
});

test('metro has no cap: five items cost 200 + 5 × 50', () => {
  assert.equal(q('الجيزة', [{ id: 'x', qty: 5, cls: 'small' }]).fee, 450);
});

// Review focus 5
test('quantity multiplies the per-item band rate', () => {
  assert.equal(q('الدقهلية', [{ id: 'x', qty: 3, cls: 'medium' }]).fee, 3 * 525);
});

test('crafts: a flat 50 in Cairo and Giza, added to appliances, refused elsewhere', () => {
  assert.equal(q('القاهرة', [{ id: 'c', qty: 2, cls: 'craft' }]).fee, 50);
  assert.equal(q('الجيزة', [{ id: 'c', qty: 1, cls: 'craft' }, { id: 'f', qty: 1, cls: 'large' }]).fee, 50 + 200 + 50);
  assert.deepEqual(q('الإسكندرية', [{ id: 'c', qty: 1, cls: 'craft' }]), { quotable: false, reason: 'craft-area' });
});

test('anything unknown refuses the whole quote rather than half of it', () => {
  assert.deepEqual(q('شمال سيناء', [{ id: 'x', qty: 1, cls: 'small' }]), { quotable: false, reason: 'no-region' });
  assert.deepEqual(q('سوهاج', [{ id: 'x', qty: 1, cls: 'small' }, { id: 'y', qty: 1, cls: null }]),
    { quotable: false, reason: 'unclassified', id: 'y' });
  const noXl = rateCard(METHODS.filter(m => !/كبيرة جدا/.test(m.title) || !/الصعيد/.test(m.title)));
  assert.deepEqual(quoteDelivery({ governorate: 'أسوان', lines: [{ id: 'x', qty: 1, cls: 'xl' }], card: noXl }),
    { quotable: false, reason: 'no-rate', id: 'x' });
});

// Review focus 3
test('before the first sync there is no card, and the quote says so without throwing', () => {
  assert.equal(rateCard([]), null);
  assert.deepEqual(quoteDelivery({ governorate: 'القاهرة', lines: [{ id: 'x', qty: 1, cls: 'small' }], card: null }),
    { quotable: false, reason: 'no-rates' });
});

test('a tiered table is reported, never half-applied', () => {
  const tiered = METHODS.map(m => /الدلتا/.test(m.title) && /صغيرة/.test(m.title)
    ? { ...m, rates: { basedOn: 'weight', rows: [{ from: 0, to: 10, perOrder: 0, perItem: 275 }, { from: 10, to: null, perOrder: 0, perItem: 400 }] } } : m);
  const c = rateCard(tiered);
  assert.equal(c.delta.small, undefined);
  assert.ok(c.problems.some(p => p.code === 'tiered'));
});

test('the store delivery-time sentence travels with the quote', () => {
  assert.ok(q('سوهاج', [{ id: 'x', qty: 1, cls: 'small' }]).notes.some(n => /14/.test(n)));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test engine/delivery-quote.test.mjs`
Expected: FAIL with `does not provide an export named 'rateCard'`

- [ ] **Step 4: Keep the rates in the sync.** In `site/engine/ecwid-sync.mjs`, add these two fields to the object `toShippingMethod` returns (after `zoneConfigured`), and export the function for tests:

```js
    /* The rate itself, which the delivery quote reads (engine/ecwid-shipping.mjs
       rateCard). Kept as Ecwid states it; interpretation happens there. */
    rates: o.ratesTable ? {
      basedOn: o.ratesTable.tableBasedOn || null,
      rows: (o.ratesTable.rates || []).map(r => {
        const c = r.conditions || {};
        const from = c.weightFrom ?? c.discountedSubtotalFrom ?? c.subtotalFrom ?? 0;
        const to = c.weightTo ?? c.discountedSubtotalTo ?? c.subtotalTo ?? null;
        const rt = r.rate || {};
        return { from: Number(from) || 0, to: to == null ? null : Number(to),
                 perOrder: Number(rt.perOrder) || 0, perItem: Number(rt.perItem) || 0 };
      }),
    } : null,
    flatRate: o.flatRate ? { type: String(o.flatRate.rateType || ''), rate: Number(o.flatRate.rate) || 0 } : null,
```

and below the function:

```js
export const toShippingMethodForTest = toShippingMethod;
```

- [ ] **Step 5: Append the rate card and quote to `site/engine/ecwid-shipping.mjs`**

```js
/* ============================================================================
   The delivery quote (spec 2026-09-28). The two blockers named at the top of
   this file are resolved without touching Ecwid's data: the region comes from
   engine/shipping-regions.mjs, and the band from engine/size-class.mjs.
   Weights were never needed — every banded table starts at weightFrom 0.
   ========================================================================== */
import { regionOf, metroKeyOf } from './shipping-regions.mjs';

const NT = s => String(s == null ? '' : s).replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ');

function bandOf(t) {
  if (/كبيره\s*جدا/.test(t)) return 'xl';
  if (/كبيره/.test(t)) return 'large';
  if (/متوسطه/.test(t)) return 'medium';
  if (/صغيره/.test(t)) return 'small';
  return null;
}

/* One flat figure, or refuse: a single row from zero, or an absolute flat rate. */
function simpleRate(m) {
  if (m.calcType === 'flat' && m.flatRate && /ABSOLUTE/i.test(m.flatRate.type))
    return { perOrder: m.flatRate.rate, perItem: 0 };
  if (m.calcType === 'table' && m.rates && m.rates.rows.length === 1 &&
      m.rates.rows[0].from === 0 && m.rates.rows[0].to == null)
    return { perOrder: m.rates.rows[0].perOrder, perItem: m.rates.rows[0].perItem };
  return null;
}

export function rateCard(methods = []) {
  const list = (methods || []).filter(m => m && m.enabled !== false);
  if (!list.length) return null;
  const card = { metro: {}, delta: {}, upper: {}, craft: null, problems: [] };
  for (const m of list) {
    const t = NT(m.title);
    const r = simpleRate(m);
    const note = stripHtml(m.deliveryTimeDays || m.description || '') || null;
    const put = (obj, key) => {
      if (!r) return card.problems.push({ title: m.title, code: m.calcType === 'table' ? 'tiered' : 'unsupported' });
      obj[key] = { ...r, title: String(m.title).trim(), note };
    };
    if (/حرف يدويه/.test(t)) { if (r) card.craft = { ...r, title: String(m.title).trim(), note }; else put({}, 'x'); continue; }
    if (/الدلتا/.test(t) && bandOf(t)) { put(card.delta, bandOf(t)); continue; }
    if (/الصعيد/.test(t) && bandOf(t)) { put(card.upper, bandOf(t)); continue; }
    if (/القاهره الكبري/.test(t)) { put(card.metro, 'cairo'); continue; }
    if (/^الجيزه$/.test(t.trim())) { put(card.metro, 'giza'); continue; }
    if (/^الاسكندريه$/.test(t.trim())) { put(card.metro, 'alex'); continue; }
    card.problems.push({ title: m.title, code: 'unparsed' });
  }
  return card;
}

export function quoteDelivery({ lines = [], governorate, card } = {}) {
  const region = regionOf(governorate);
  if (!region) return { quotable: false, reason: 'no-region' };
  if (!card) return { quotable: false, reason: 'no-rates' };
  const miss = lines.find(l => !l.cls);
  if (miss) return { quotable: false, reason: 'unclassified', id: String(miss.id) };

  const out = [], perOrder = [], names = new Set(), notes = new Set();
  const craft = lines.filter(l => l.cls === 'craft'), goods = lines.filter(l => l.cls !== 'craft');

  if (craft.length) {
    const mk = metroKeyOf(governorate);
    if (!card.craft || (mk !== 'cairo' && mk !== 'giza')) return { quotable: false, reason: 'craft-area' };
    perOrder.push({ title: card.craft.title, fee: card.craft.perOrder });
    names.add(card.craft.title);
    for (const l of craft) out.push({ id: String(l.id), cls: 'craft', fee: 0 });
  }

  if (goods.length && region === 'metro') {
    const rate = card.metro[metroKeyOf(governorate)];
    if (!rate) return { quotable: false, reason: 'no-rate', id: String(goods[0].id) };
    perOrder.push({ title: rate.title, fee: rate.perOrder });
    names.add(rate.title); if (rate.note) notes.add(rate.note);
    for (const l of goods) out.push({ id: String(l.id), cls: l.cls, fee: rate.perItem * l.qty });
  } else if (goods.length) {
    const used = new Set();
    for (const l of goods) {
      const rate = card[region][l.cls];
      if (!rate) return { quotable: false, reason: 'no-rate', id: String(l.id) };
      if (!used.has(l.cls) && rate.perOrder) perOrder.push({ title: rate.title, fee: rate.perOrder });
      used.add(l.cls); names.add(rate.title); if (rate.note) notes.add(rate.note);
      out.push({ id: String(l.id), cls: l.cls, fee: rate.perItem * l.qty });
    }
  }

  const fee = out.reduce((n, l) => n + l.fee, 0) + perOrder.reduce((n, p) => n + p.fee, 0);
  return { quotable: true, fee, lines: out, perOrder, methodName: [...names].join(' + '), notes: [...notes] };
}
```

Note: `import` statements must sit at the top of an ES module. Move the `import { regionOf, metroKeyOf } …` line up beside the existing `import { stripHtml } …` line.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test engine/delivery-quote.test.mjs engine/ecwid-shipping.test.mjs engine/ecwid-sync.test.mjs`
Expected: PASS, all tests

- [ ] **Step 7: Commit**

```bash
git add site/engine/fixtures/ecwid-shipping-options.json site/engine/ecwid-sync.mjs site/engine/ecwid-shipping.mjs site/engine/delivery-quote.test.mjs
git commit -m "feat(delivery): a rate card from Ecwid's own methods, and a quote that refuses rather than guesses"
```

---

### Task 4: Server — quote endpoint and the fee on both order routes

**Files:**
- Modify: `site/compare-server.mjs` (imports near line 73; after `repriceOrder` near line 2276; the guest route near line 2481; the signed-in `POST /api/orders` near line 3301)
- Modify: `site/engine/accounts.mjs` (`createOrder`, line 356)
- Test: `site/engine/delivery-wiring.test.mjs`

**Interfaces:**
- Consumes: `sizeClassOf` (Task 2); `rateCard`, `quoteDelivery` (Task 3); `GOVERNORATES` (Task 1).
- Produces:
  - `GET /api/delivery/governorates` → `{ governorates:[{ar,en}] }`.
  - `POST /api/delivery/quote` with body `{ items:[{id,qty}], governorate }` → `{ subtotal, quote }`.
  - Both order routes accept `quotedFee:number|null` and return `409 { error:'delivery-fee-changed', message, quote }` on a mismatch.
  - Stored order `totals` = `{ subtotal, deliveryFee:number|null, installFee:null, grandTotal:number|null, currency:'EGP', methodName?:string, deliveryLines?:Array<{id,cls,fee}> }`.
  - `accounts.createOrder(userId, { …, deliveryQuote })`.

- [ ] **Step 1: Write the failing test** (source-level wiring, in the style of `engine/order-wiring.test.mjs`, plus a unit test of `createOrder`)

```js
// site/engine/delivery-wiring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAccounts } from './accounts.mjs';

const SRC = readFileSync(new URL('../compare-server.mjs', import.meta.url), 'utf8');
const route = (marker, len = 5000) => SRC.slice(SRC.indexOf(marker), SRC.indexOf(marker) + len);

test('the quote and governorate endpoints exist', () => {
  assert.match(SRC, /u\.pathname === '\/api\/delivery\/quote' && req\.method === 'POST'/);
  assert.match(SRC, /u\.pathname === '\/api\/delivery\/governorates'/);
});

test('both order routes recompute the fee on the server and compare the browser figure', () => {
  for (const marker of ["u.pathname === '/api/orders/guest' && req.method === 'POST'",
                        "u.pathname === '/api/orders' && req.method === 'POST'"]) {
    const body = route(marker);
    assert.match(body, /await deliveryFor\(/, marker + ' must call deliveryFor');
    assert.match(body, /feeMismatch\(/, marker + ' must compare the quoted fee');
    assert.match(body, /json\(409/, marker + ' must answer 409 on a changed fee');
  }
});

// Review focus 2: an old tab sends no quotedFee at all.
test('feeMismatch treats a missing quotedFee as a mismatch when the order is quotable', async () => {
  const { feeMismatch } = await import('./delivery-order.mjs');
  assert.equal(feeMismatch({ quotable: true, fee: 300 }, undefined), true);
  assert.equal(feeMismatch({ quotable: true, fee: 300 }, 300), false);
  assert.equal(feeMismatch({ quotable: true, fee: 300 }, 250), true);
  assert.equal(feeMismatch({ quotable: false }, null), false);
  assert.equal(feeMismatch({ quotable: false }, undefined), false);
  assert.equal(feeMismatch({ quotable: false }, 300), true);
});

test('createOrder stores the fee and grand total when a quote is quotable', () => {
  const acc = openAccounts({ file: path.join(tmpdir(), 'sadko-deliv-' + process.pid + '.db') });
  const u = acc.register({ email: 'd' + process.pid + '@example.test', password: 'long-enough-pass', name: 'D', phone: '01000000000' });
  const uid = (u.user || u).id;
  const items = [{ id: '1', title: 'x', price: 1000, qty: 1 }];
  const a = acc.createOrder(uid, { items, payment: 'cod', deliveryQuote: { quotable: true, fee: 300, methodName: 'القاهرة الكبرى', lines: [{ id: '1', cls: 'small', fee: 50 }] } });
  assert.deepEqual([a.order.totals.deliveryFee, a.order.totals.grandTotal, a.order.totals.methodName], [300, 1300, 'القاهرة الكبرى']);
  const b = acc.createOrder(uid, { items, payment: 'cod', deliveryQuote: { quotable: false, reason: 'no-region' } });
  assert.deepEqual([b.order.totals.deliveryFee, b.order.totals.grandTotal], [null, null]);
});
```

Before writing it, check how `engine/accounts.test.mjs` opens a throwaway account store (`grep -n "openAccounts\|register(" engine/accounts.test.mjs | head`). If the factory name, its options or `register`'s argument shape differ, use exactly what that file uses.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/delivery-wiring.test.mjs`
Expected: FAIL (no route, no `delivery-order.mjs`, and totals still null)

- [ ] **Step 3: Create `site/engine/delivery-order.mjs`**, the pure glue the server calls

```js
// site/engine/delivery-order.mjs
/* The delivery fee for an order, from the served catalogue — never from the
   browser. Pure: the caller hands in the catalogue, the categories and the
   shipping methods. */
import { sizeClassOf } from './size-class.mjs';
import { rateCard, quoteDelivery } from './ecwid-shipping.mjs';

let LAST_GOOD = null;   // survives an Ecwid outage (spec §4.3)

export function cardFrom(methods) {
  const c = rateCard(methods);
  if (c && (Object.keys(c.metro).length || Object.keys(c.delta).length || Object.keys(c.upper).length)) LAST_GOOD = c;
  return LAST_GOOD;
}

export function quoteFor({ items, governorate, catalogue, categoryName, methods }) {
  const byId = new Map((catalogue || []).map(p => [String(p.id), p]));
  const lines = (items || []).map(i => {
    const p = byId.get(String(i.id));
    return { id: String(i.id), qty: Math.max(1, Math.min(20, Number(i.qty) || 1)),
             cls: p ? sizeClassOf(p, categoryName(p.categoryId)).cls : null };
  });
  return quoteDelivery({ lines, governorate, card: cardFrom(methods) });
}

/* The browser shows a fee; the server recomputes it. Any difference — including
   an old tab that never showed one — is a mismatch the customer must confirm. */
export function feeMismatch(quote, quotedFee) {
  const server = quote && quote.quotable ? quote.fee : null;
  const client = quotedFee == null ? null : Number(quotedFee);
  if (server == null) return client != null;
  return client !== server;
}

export function totalsWith(subtotal, quote) {
  const q = quote && quote.quotable ? quote : null;
  return { subtotal, deliveryFee: q ? q.fee : null, installFee: null,
           grandTotal: q ? subtotal + q.fee : null, currency: 'EGP',
           ...(q ? { methodName: q.methodName, deliveryLines: q.lines } : {}) };
}
```

- [ ] **Step 4: Server helper and endpoints.** In `compare-server.mjs`, add to the imports:

```js
import { quoteFor, feeMismatch, totalsWith } from './engine/delivery-order.mjs';
import { GOVERNORATES } from './engine/shipping-regions.mjs';
```

After `repriceOrder` (around line 2276), add:

```js
/* The delivery quote for a set of lines, from the served catalogue and the
   mirrored Ecwid methods. Ecwid off or empty → quotable:false, never a throw. */
async function deliveryFor(items, governorate) {
  let catalogue = [], methods = [], cats = new Map();
  try { catalogue = await ecwidSource().catalogBase(); } catch (e) {}
  try {
    const st = ecwidStore();
    if (st) {
      methods = st.allShippingMethods();
      cats = new Map(st.allCategories().map(c => [String(c.id), c.name || c.title || '']));
    }
  } catch (e) {}
  return quoteFor({ items, governorate, catalogue, methods, categoryName: id => cats.get(String(id)) || '' });
}
const feeChanged = (lang, quote) => ({ error: 'delivery-fee-changed', quote, message: lang === 'en'
  ? (quote.quotable ? `The delivery fee is now EGP ${quote.fee.toLocaleString('en-US')}. Please review and confirm.` : 'The delivery fee will now be confirmed by customer care. Please review and confirm.')
  : (quote.quotable ? `رسوم التوصيل أصبحت ${quote.fee.toLocaleString('en-US')} جنيه. راجع الطلب وأكّده.` : 'رسوم التوصيل ستؤكدها خدمة العملاء. راجع الطلب وأكّده.') });
```

Next to the `/api/shipping-methods` route, add:

```js
  if (u.pathname === '/api/delivery/governorates' && req.method === 'GET')
    return json(200, { governorates: GOVERNORATES.map(g => ({ ar: g.ar, en: g.en })) });

  if (u.pathname === '/api/delivery/quote' && req.method === 'POST') {
    if (rateLimited(clientIp(req))) return json(429, { error: 'too-many' });
    let b; try { b = await readJson(req, 24_000); } catch (e) { return json(400, { error: 'bad-request' }); }
    await ecwidFresh();
    const priced = await repriceOrder(b.items);
    if (!priced.ok) return json(200, { subtotal: null, quote: { quotable: false, reason: priced.error } });
    return json(200, { subtotal: priced.subtotal, quote: await deliveryFor(priced.items, String(b.governorate || '')) });
  }
```

- [ ] **Step 5: The guest route.** After `order.totals.subtotal = priced.subtotal;` add:

```js
    /* The delivery fee is the server's, never the browser's (spec §4.5). */
    const quote = await deliveryFor(order.items, order.delivery.governorate);
    if (feeMismatch(quote, body.quotedFee)) return json(409, feeChanged(lang, quote));
    order.totals = totalsWith(priced.subtotal, quote);
```

Check `validateGuestOrder` (`engine/guest-orders.mjs` line 41) for where it stores the governorate. If the order keeps it at `order.delivery.governorate`, use that; if at the top level, use `order.governorate`. Use whichever the file shows.

- [ ] **Step 6: The signed-in route.** After the `repriceOrder` failure block and before `db.createOrder`, add:

```js
        const quote = await deliveryFor(priced.items, (b.delivery && b.delivery.governorate) || '');
        if (feeMismatch(quote, b.quotedFee)) return json(409, feeChanged(lang, quote));
```

and change the create call to `db.createOrder(me.id, { ...b, items: priced.items, deliveryQuote: quote })`.

- [ ] **Step 7: `accounts.mjs` createOrder.** Change its signature to `createOrder(userId, { items, payment, delivery, note, totals, deliveryQuote })`. Replace the `totals:` object literal with:

```js
        totals: deliveryQuote && deliveryQuote.quotable
          ? { subtotal, deliveryFee: deliveryQuote.fee, installFee: null, grandTotal: subtotal + deliveryQuote.fee,
              currency: 'EGP', methodName: deliveryQuote.methodName, deliveryLines: deliveryQuote.lines,
              note: 'رسوم التركيب بتتأكد من خدمة العملاء قبل التنفيذ.' }
          : { subtotal, deliveryFee: null, installFee: null, grandTotal: null, currency: 'EGP',
              note: 'رسوم التوصيل والتركيب بتتأكد من خدمة العملاء قبل التنفيذ.' },
```

Keep the comment above it, reworded to say the fee is stored only when the server could quote it.

- [ ] **Step 8: Run the tests to verify they pass, then the whole suite**

Run: `node --test engine/delivery-wiring.test.mjs` and then `node --test engine/*.test.mjs`
Expected: PASS, and the suite fully green. If `engine/order-wiring.test.mjs` or `engine/account-wiring.test.mjs` pin the old null-only totals, update only the assertions for a *quotable* case, and keep every non-quotable assertion.

- [ ] **Step 9: Commit**

```bash
git add site/engine/delivery-order.mjs site/engine/delivery-wiring.test.mjs site/compare-server.mjs site/engine/accounts.mjs
git commit -m "feat(delivery): the server quotes the fee, stores it, and refuses a silent change"
```

---

### Task 5: The fee reaches Ecwid

**Files:**
- Modify: `site/engine/ecwid-map.mjs` (`toEcwidOrder`, lines ~288–350)
- Test: `site/engine/ecwid-map.test.mjs` (append)

**Interfaces:**
- Consumes: order `totals` from Task 4; `CLASS_LABELS` (Task 2).
- Produces: `toEcwidOrder` sets `shippingOption: { shippingMethodName, shippingRate }` and `total = subtotal + fee` when `totals.deliveryFee` is a finite number. It exports `INSTALL_NOTE_AR`.

- [ ] **Step 1: Write the failing test** (append; `ORDER`, `USER` and `METHODS` already exist in this file)

```js
import { INSTALL_NOTE_AR } from './ecwid-map.mjs';

const QUOTED = () => ORDER({ totals: { subtotal: 35497, deliveryFee: 1650, installFee: null, grandTotal: 37147,
  currency: 'EGP', methodName: 'الصعيد - منتجات كبيرة جدا + الصعيد - منتجات صغيرة',
  deliveryLines: [{ id: '865565594', cls: 'xl', fee: 1320 }, { id: '865564749', cls: 'small', fee: 330 }] } });

test('a quoted order carries the shipping line and the grand total', () => {
  const o = toEcwidOrder(QUOTED(), USER, METHODS);
  assert.deepEqual(o.shippingOption, { shippingMethodName: 'الصعيد - منتجات كبيرة جدا + الصعيد - منتجات صغيرة', shippingRate: 1650 });
  assert.equal(o.subtotal, 35497);
  assert.equal(o.total, 37147);
});

test('a quoted order names installation only as still to confirm, and itemises delivery', () => {
  const c = toEcwidOrder(QUOTED(), USER, METHODS).orderComments;
  assert.ok(c.includes(INSTALL_NOTE_AR));
  assert.ok(!c.includes(FEES_NOTE_AR), 'delivery is no longer "to be confirmed"');
  assert.match(c, /1320/);
  assert.match(c, /منتجات كبيرة جدا/);
});
```

The existing test for a non-quoted `ORDER()` (`'no shipping cost is ever invented'`) stays as it is and must keep passing.

Check how `ORDER` merges `over`: the existing helper is `ORDER = (over = {}) => ({ …, ...over })`, or it may merge differently. If the spread does not replace `totals`, build `QUOTED` as `Object.assign(ORDER(), { totals: { … } })`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: FAIL (`INSTALL_NOTE_AR` is not exported; `shippingOption` is undefined)

- [ ] **Step 3: Implement.** In `ecwid-map.mjs`:

```js
import { CLASS_LABELS } from './size-class.mjs';

export const INSTALL_NOTE_AR = 'رسوم التركيب تُؤكَّد من خدمة العملاء قبل التنفيذ.';
```

Inside `toEcwidOrder`, after `subtotal` is computed:

```js
  /* Since 2026-09-28 the SERVER can quote delivery (engine/delivery-order.mjs).
     Only a fee it computed is pushed; an unquoted order keeps the old rule —
     shipping absent, never zero. */
  const t = order.totals || {};
  const fee = Number.isFinite(t.deliveryFee) && t.deliveryFee >= 0 && t.methodName ? t.deliveryFee : null;
  const titleOf = id => ((items.find(i => String(i.id) === String(id)) || {}).title || id);
  const feeLines = fee == null ? [] : (t.deliveryLines || []).filter(l => l.fee > 0).map(l =>
    `توصيل ${String(titleOf(l.id)).slice(0, 60)} (${(CLASS_LABELS[l.cls] || {}).ar || l.cls}): ${l.fee} جنيه`);
```

In `comments`, replace the `FEES_NOTE_AR,` entry with:

```js
    fee == null ? FEES_NOTE_AR : INSTALL_NOTE_AR,
    ...(fee == null ? [] : [`رسوم التوصيل: ${fee} جنيه — ${t.methodName}`, ...feeLines]),
```

In the returned object, replace `subtotal,\n    total: subtotal,` with:

```js
    subtotal,
    total: fee == null ? subtotal : subtotal + fee,
    ...(fee == null ? {} : { shippingOption: { shippingMethodName: t.methodName, shippingRate: fee } }),
```

Update the file's header comment, so "Never add a shippingRate" now reads "Never add a shippingRate the server did not compute".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-map.test.mjs engine/ecwid-push.test.mjs engine/ecwid-sync.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/engine/ecwid-map.mjs site/engine/ecwid-map.test.mjs
git commit -m "feat(delivery): a quoted order reaches Ecwid with its shipping line and total"
```

---

### Task 6: Checkout shows the fee

**Files:**
- Modify: `site/assets/js/checkout.js` (governorate select near line 220; `summary()` line 125; `wire()` line 285; `placeGuestOrder` and `done()`)
- Test: `site/engine/checkout-delivery.test.mjs`

**Interfaces:**
- Consumes: `GET /api/delivery/governorates`, `POST /api/delivery/quote`, and the 409 body (Task 4).
- Produces: both order payloads carry `quotedFee` (`number|null`).

- [ ] **Step 1: Write the failing test** (source-level, as `engine/shop-wiring.test.mjs` does for browser files)

```js
// site/engine/checkout-delivery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const JS = readFileSync(new URL('../assets/js/checkout.js', import.meta.url), 'utf8');

test('checkout lists governorates from the server instead of five hard-coded ones', () => {
  assert.match(JS, /api\/delivery\/governorates/);
  assert.ok(!/'الساحل الشمالى\|North Coast', 'أخرى\|Other'/.test(JS), 'the old five-option list is gone');
});
test('checkout asks the server for a quote when the governorate changes', () => {
  assert.match(JS, /api\/delivery\/quote/);
  assert.match(JS, /name="governorate"[\s\S]{0,400}|addEventListener\('change'/);
});
test('both order payloads carry the fee the customer was shown', () => {
  assert.equal((JS.match(/quotedFee:/g) || []).length, 2);
});
test('a 409 delivery-fee-changed re-renders the summary instead of failing', () => {
  assert.match(JS, /delivery-fee-changed/);
});
test('the unquoted fallback sentence is still there', () => {
  assert.match(JS, /تؤكده خدمة العملاء/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/checkout-delivery.test.mjs`
Expected: FAIL on the first four tests

- [ ] **Step 3: Implement in checkout.js**

(a) State and loaders, beside `LIVE`/`SHIP` near the top of `mountCheckout`:

```js
    let GOVS = null, QUOTE = null, QUOTE_SUB = null;
    function loadGovernorates() {
      return fetch('/api/delivery/governorates').then(r => r.ok ? r.json() : null)
        .then(d => { GOVS = d && d.governorates; }).catch(() => { GOVS = null; });
    }
    function requestQuote(items, governorate) {
      if (!governorate) { QUOTE = null; return Promise.resolve(null); }
      return fetch('/api/delivery/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ governorate, items: items.map(i => ({ id: i.id, qty: i.qty })) }) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { QUOTE = d && d.quote; QUOTE_SUB = d && d.subtotal; return QUOTE; })
        .catch(() => { QUOTE = null; return null; });
    }
```

Add `loadGovernorates()` to the existing `Promise.all([...])` on line 99.

(b) Replace the hard-coded governorate options with the server list. Fall back to the three metro names if the request failed, so checkout never breaks:

```js
              '<select class="select" name="governorate" required><option value="">' + t('اختر المحافظة', 'Choose governorate') + '</option>' +
              (GOVS || [{ ar: 'القاهرة', en: 'Cairo' }, { ar: 'الجيزة', en: 'Giza' }, { ar: 'الإسكندرية', en: 'Alexandria' }])
                .map(g => '<option value="' + esc(g.ar) + '"' + (p.governorate === g.ar ? ' selected' : '') + '>' + esc(t(g.ar, g.en)) + '</option>').join('') +
```

(c) In `summary(items)`, replace the Delivery `<li>` (and the long comment above it) with:

```js
        deliveryRows(subtotal) +
```

and add the function beside `summary`:

```js
    /* The fee the SERVER quoted — this page never adds one up (engine/delivery-order.mjs). */
    function deliveryRows(subtotal) {
      if (!QUOTE || !QUOTE.quotable)
        return '<li><span class="k">' + t('التوصيل', 'Delivery') + '</span><span class="v unknown">' + t('تؤكده خدمة العملاء', 'confirmed by customer care') + '</span></li>';
      return '<li><span class="k">' + t('التوصيل', 'Delivery') + '<br><small class="muted">' + esc(QUOTE.methodName) + '</small></span><span class="v">' + A.money(QUOTE.fee) + '</span></li>' +
        (QUOTE.notes && QUOTE.notes[0] ? '<li><span class="k small muted">' + esc(QUOTE.notes[0]) + '</span><span class="v"></span></li>' : '') +
        '<li><span class="k"><b>' + t('الإجمالى', 'Total') + '</b></span><span class="v"><b>' + A.money(subtotal + QUOTE.fee) + '</b></span></li>';
    }
```

Keep the Installation `<li>` unchanged. Change the explanatory `note--soft` sentence to mention installation only when `QUOTE && QUOTE.quotable`.

(d) In `wire(user, items)`, re-quote when the governorate changes and re-render only the summary. Wrap the summary's output in `<div id="coSummary">…</div>` where `form()` places it:

```js
      const gov = f.querySelector('select[name=governorate]');
      const refresh = () => requestQuote(items, gov.value).then(() => {
        const box = root.querySelector('#coSummary'); if (box) box.innerHTML = summary(items);
      });
      gov.addEventListener('change', refresh);
      if (gov.value) refresh();
```

(e) Add `quotedFee: QUOTE && QUOTE.quotable ? QUOTE.fee : null,` to BOTH payloads (the `Au.placeOrder({...})` object and the `placeGuestOrder({...})` object).

(f) Handle the 409 before the generic error. `Au.placeOrder` returns the server body through `call()`; `placeGuestOrder` must pass `error` and `quote` through, so change its failure return to `return { ok: false, message: d.message || '', error: d.error, quote: d.quote };`. Then in `wire`:

```js
        if (!r.ok && r.error === 'delivery-fee-changed') {
          QUOTE = r.quote || null;
          const box = root.querySelector('#coSummary'); if (box) box.innerHTML = summary(items);
          root.querySelector('#coErr').innerHTML = '<div class="note note--warn mt8 small">' + esc(r.message) + '</div>';
          return;
        }
```

(g) In `done(o)`, replace the «التوصيل والتركيب» row with a delivery row when `o.totals && o.totals.deliveryFee != null`: show `A.money(o.totals.deliveryFee)` and a total row `A.money(o.totals.grandTotal)`, with installation still «يُؤكَّد هاتفياً». Otherwise keep the current row. The guest reply already returns `totals`; for the signed-in path, `r.order.totals` is the stored object.

- [ ] **Step 4: Run the tests**

Run: `node --test engine/checkout-delivery.test.mjs` and then `node --test engine/*.test.mjs`
Expected: PASS, suite green

- [ ] **Step 5: Bump checkout.js in every page and commit**

```bash
V=$(grep -rhoE "checkout\.js\?v=[a-z0-9]+" --include=*.html site | head -1 | sed 's/.*v=//'); echo "was $V"
# choose the next value, e.g. c7 -> c8, then:
grep -rl "checkout.js?v=$V" --include=*.html site | xargs sed -i "s/checkout\.js?v=$V/checkout.js?v=<NEXT>/g"
git add site/assets/js/checkout.js site/engine/checkout-delivery.test.mjs site/*.html site/category/*.html
git commit -m "feat(checkout): every governorate, and the delivery fee the server quotes"
```

(`<NEXT>` is the incremented version you just chose. Type it literally; it is not a placeholder to leave in.)

- [ ] **Step 6: Browser check** (local server: `SADKO_ECWID=1 node --env-file=.ecwid.env compare-server.mjs`). Add a 480 L fridge and a fan to the cart and open checkout as a guest.
  - With سوهاج chosen: Delivery shows **EGP 1,650** and the total is items + 1,650.
  - With شمال سيناء chosen: «تؤكده خدمة العملاء».

---

### Task 7: Cart estimate

**Files:**
- Modify: `site/cart.html` (its inline `<script defer>`, line 80)
- Test: `site/engine/checkout-delivery.test.mjs` (append)

**Interfaces:**
- Consumes: `POST /api/delivery/quote`; `window.skAuth.me()` → `{ profile:{ governorate } } | null`.

- [ ] **Step 1: Append the failing test**

```js
test('the cart estimates delivery only from a saved governorate, otherwise says checkout', () => {
  const H = readFileSync(new URL('../cart.html', import.meta.url), 'utf8');
  assert.match(H, /api\/delivery\/quote/);
  assert.match(H, /تُحسب عند إتمام الطلب|calculated at checkout/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test engine/checkout-delivery.test.mjs`
Expected: FAIL on the new test

- [ ] **Step 3: Implement.** In the cart page script, after the total is rendered, add an element `<p id="cartDelivery" class="muted small"></p>` beneath the total, and:

```js
  (async () => {
    const box = document.getElementById('cartDelivery'); if (!box) return;
    const later = t('رسوم التوصيل تُحسب عند إتمام الطلب', 'Delivery is calculated at checkout');
    box.textContent = later;
    try {
      const me = window.skAuth ? await window.skAuth.me() : null;
      const gov = me && me.profile && me.profile.governorate;
      const items = (window.skCart && window.skCart.items()) || [];
      if (!gov || !items.length) return;
      const r = await fetch('/api/delivery/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ governorate: gov, items: items.map(i => ({ id: i.id, qty: i.qty })) }) });
      const d = r.ok ? await r.json() : null;
      if (d && d.quote && d.quote.quotable)
        box.textContent = t('توصيل تقديرى إلى ', 'Estimated delivery to ') + gov + ': ' + d.quote.fee.toLocaleString('en-US') + t(' جنيه', ' EGP');
    } catch (e) { /* keep "calculated at checkout" */ }
  })();
```

Use the page's own `t` helper and cart accessor. Read the script first; if it names them differently, use its names.

- [ ] **Step 4: Run the tests**

Run: `node --test engine/checkout-delivery.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/cart.html site/engine/checkout-delivery.test.mjs
git commit -m "feat(cart): a delivery estimate for a saved governorate"
```

---

### Task 8: Tracking — confirm Ecwid's fields, show them, and let guests look up

**Files:**
- Modify: `site/engine/ecwid-customers.mjs` (`fromEcwidOrder` line 222, `mergeOrders` line 279)
- Modify: `site/compare-server.mjs` (a new route beside `/api/orders/guest`)
- Create: `site/engine/order-track.mjs`
- Modify: `site/assets/js/account.js` (orders table, ~line 525), `site/orders.html`
- Test: `site/engine/order-track.test.mjs`

**Interfaces:**
- Produces:
  - `trackingOf(remote) → { number:string, url:string|null } | null`.
  - `fromEcwidOrder(...).tracking`, which `mergeOrders` copies onto a matching local order.
  - `phoneMatches(a, b) → boolean`.
  - `publicStatus(remote) → { ref, status, tracking }`.
  - `POST /api/orders/track` with body `{ ref, phone }` → `200 { ref, status, tracking }` | `404 { error:'not-found' }` | `429`.

- [ ] **Step 1: Confirm the real field names first** (project rule: four past bugs came from guessed Ecwid names). From `site/`, set a tracking number on the test order and read the whole order back:

```bash
node --input-type=module -e "
import { ecwidEnv } from './tools/ecwid-env.mjs';
const e = ecwidEnv(), H = { Authorization: 'Bearer ' + e.token, 'content-type': 'application/json' };
const B = 'https://app.ecwid.com/api/v3/' + e.storeId + '/orders/7519';
console.log('PUT', (await fetch(B, { method: 'PUT', headers: H, body: JSON.stringify({ trackingNumber: 'MVX-TEST-7519' }) })).status);
const o = await (await fetch(B, { headers: H })).json();
console.log(JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => /track|shipment/i.test(k)))));"
```
Expected: `PUT 200`, then an object containing `"trackingNumber":"MVX-TEST-7519"`. Note whether a `trackingUrl` or `shipments[].trackingNumber` also appears. **Adjust `trackingOf` below to read exactly the keys printed**, keeping the fallbacks.

- [ ] **Step 2: Write the failing test**

```js
// site/engine/order-track.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingOf, fromEcwidOrder, mergeOrders } from './ecwid-customers.mjs';
import { phoneMatches, publicStatus } from './order-track.mjs';

test('tracking is read from the order, or from its shipments', () => {
  assert.deepEqual(trackingOf({ trackingNumber: 'MVX1' }), { number: 'MVX1', url: null });
  assert.deepEqual(trackingOf({ trackingNumber: 'MVX1', trackingUrl: 'https://t/1' }), { number: 'MVX1', url: 'https://t/1' });
  assert.deepEqual(trackingOf({ shipments: [{ trackingNumber: 'MVX2' }] }), { number: 'MVX2', url: null });
  assert.equal(trackingOf({}), null);
  assert.equal(trackingOf({ trackingNumber: '  ' }), null);
});

test('a site order picks up tracking from its Ecwid copy', () => {
  const local = [{ ref: 'SDK-AAAAAA', status: 'received', items: [], createdAt: '2026-09-28' }];
  const remote = [{ externalOrderId: 'SDK-AAAAAA', fulfillmentStatus: 'SHIPPED', trackingNumber: 'MVX9', items: [] }];
  const [o] = mergeOrders(local, remote);
  assert.equal(o.status, 'shipping');
  assert.deepEqual(o.tracking, { number: 'MVX9', url: null });
  assert.deepEqual(fromEcwidOrder(remote[0]).tracking, { number: 'MVX9', url: null });
});

// Review focus 4
test('phones match on the last ten digits, whatever the format', () => {
  assert.equal(phoneMatches('+201027890565', '01027890565'), true);
  assert.equal(phoneMatches('0102 789 0565', '+20 102 789 0565'), true);
  assert.equal(phoneMatches('01027890565', '01027890566'), false);
  assert.equal(phoneMatches('', ''), false);
  assert.equal(phoneMatches('123', '123'), false);
});

test('the guest lookup returns status and tracking, and nothing personal', () => {
  const s = publicStatus({ externalOrderId: 'SDK-AAAAAA', fulfillmentStatus: 'SHIPPED', trackingNumber: 'MVX9',
    email: 'x@y.z', shippingPerson: { name: 'N', phone: '010', street: 'S' }, items: [{ name: 'fridge' }], total: 5 });
  assert.deepEqual(s, { ref: 'SDK-AAAAAA', status: 'shipping', tracking: { number: 'MVX9', url: null } });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test engine/order-track.test.mjs`
Expected: FAIL (no `trackingOf`, no `order-track.mjs`)

- [ ] **Step 4: Implement.** In `ecwid-customers.mjs`:

```js
/* Staff enter the tracking number on the order in Ecwid (one delivery company,
   so there is no carrier to record). Field names confirmed on order 7519. */
export function trackingOf(remote) {
  if (!remote) return null;
  const sh = Array.isArray(remote.shipments) ? remote.shipments.find(s => s && s.trackingNumber) : null;
  const number = String(remote.trackingNumber || (sh && sh.trackingNumber) || '').trim();
  if (!number) return null;
  const url = String(remote.trackingUrl || (sh && sh.trackingUrl) || '').trim();
  return { number: number.slice(0, 80), url: /^https:\/\//.test(url) ? url.slice(0, 300) : null };
}
```

In `fromEcwidOrder`'s returned object, add `tracking: trackingOf(remote),`. In `mergeOrders`, inside `if (hit) { … }`, add `if (mapped.tracking) hit.tracking = mapped.tracking;`.

Create `site/engine/order-track.mjs`:

```js
// site/engine/order-track.mjs
/* The guest "Track an order" lookup. Guest details are deleted from this server
   once Ecwid has the order, so the lookup asks Ecwid, and answers with status
   and tracking ONLY — never a name, an address or the items. */
import { toLocalStatus } from './ecwid-map.mjs';
import { trackingOf } from './ecwid-customers.mjs';

const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
export function phoneMatches(a, b) { const x = last10(a), y = last10(b); return x.length === 10 && x === y; }

export function publicStatus(remote) {
  return { ref: String(remote.externalOrderId || ''), status: toLocalStatus(remote) || 'received', tracking: trackingOf(remote) };
}
```

In `compare-server.mjs`, add `import { phoneMatches, publicStatus } from './engine/order-track.mjs';`, and beside the guest route:

```js
  /* Guest order lookup: order number + phone, both required, same "not found"
     for either being wrong, and a tight per-IP budget against guessing. */
  if (u.pathname === '/api/orders/track' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!guestRateOk('track:' + ip)) return json(429, { error: 'too-many' });
    let b; try { b = await readJson(req, 2_000); } catch (e) { return json(400, { error: 'bad-request' }); }
    const ref = String(b.ref || '').trim().toUpperCase();
    const notFound = () => json(404, { error: 'not-found' });
    if (!/^SDK-[A-F0-9]{6}$/.test(ref) || !b.phone) return notFound();
    const st = ecwidStore(), api = ecwidApi();
    const row = st && st.pushRow(ref);
    if (!row || !row.ecwid_order_id || !api || !api.configured) return notFound();
    let remote = null; try { remote = await api.getOrder(row.ecwid_order_id); } catch (e) {}
    if (!remote) return notFound();
    const d = remote.shippingPerson || remote.billingPerson || {};
    if (!phoneMatches(d.phone, b.phone)) return notFound();
    return json(200, publicStatus(remote));
  }
```

`guestRateOk` allows 6 per hour per key, which is the right budget for a lookup.

- [ ] **Step 5: The UI.**
  - In `account.js`, in the orders table's Status cell, append this after the chip when `o.tracking`:
    ```js
    '<br><small class="ltr">' + esc(o.tracking.number) + '</small> <a class="small" target="_blank" rel="noopener" href="' + esc(o.tracking.url || 'https://movex.com.eg') + '">' + t('تتبع مع موڤكس', 'Track on Movex') + '</a>'
    ```
  - In `orders.html`, add a form under the existing `.track` block: `<form id="trackForm">` with inputs `ref` (placeholder `SDK-XXXXXX`) and `phone`, a submit button, and `<div id="trackOut"></div>`. On submit, `POST /api/orders/track`. On 200, show the status (reuse account.js's status names, or the six keys: received / confirmed / preparing / shipping / delivered / cancelled, with Arabic and English labels) and, when present, the tracking number plus a "Track on Movex" link. On 404: «لم نجد طلباً بهذا الرقم وهذا الهاتف» / "No order found for that number and phone". On 429: «محاولات كثيرة — حاول لاحقاً».

- [ ] **Step 6: Run the tests**

Run: `node --test engine/order-track.test.mjs engine/ecwid-customers.test.mjs` and then `node --test engine/*.test.mjs`
Expected: PASS, suite green

- [ ] **Step 7: Bump account.js and commit**

```bash
V=$(grep -rhoE "account\.js\?v=[a-z0-9]+" --include=*.html site | head -1 | sed 's/.*v=//'); echo "was $V"
grep -rl "account.js?v=$V" --include=*.html site | xargs sed -i "s/account\.js?v=$V/account.js?v=<NEXT>/g"
git add site/engine/ecwid-customers.mjs site/engine/order-track.mjs site/engine/order-track.test.mjs site/compare-server.mjs site/assets/js/account.js site/orders.html site/*.html
git commit -m "feat(tracking): Ecwid tracking numbers on the customer's orders, and a guest lookup"
```

---

### Task 9: Admin "Delivery classes" panel

**Files:**
- Modify: `site/compare-server.mjs` (the `/api/admin/` block, line ~2652)
- Modify: `site/assets/js/admin.js`
- Test: `site/engine/delivery-wiring.test.mjs` (append)

**Interfaces:**
- Consumes: `sizeClassOf`, `CLASS_LABELS` (Task 2); `rateCard` (Task 3).
- Produces: `GET /api/admin/delivery-classes` → `{ counts:{small,medium,large,xl,craft,null}, unclassified:[{id,title,category,why}], problems:[{title,code}], products:[{id,title,cls}] }`.

- [ ] **Step 1: Append the failing test**

```js
test('the admin delivery-classes route exists behind the admin guard', () => {
  const i = SRC.indexOf("rest === 'delivery-classes'");
  assert.ok(i > SRC.indexOf("u.pathname.startsWith('/api/admin/')"), 'must live inside the admin block');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test engine/delivery-wiring.test.mjs`
Expected: FAIL on the new test

- [ ] **Step 3: Implement the route**, inside the admin block after `rest` is computed (where other `rest === '…'` branches are):

```js
      if (rest === 'delivery-classes' && req.method === 'GET') {
        let catalogue = []; try { catalogue = await ecwidSource().catalogBase(); } catch (e) {}
        const st = ecwidStore();
        const cats = new Map(((st && st.allCategories()) || []).map(c => [String(c.id), c.name || c.title || '']));
        const counts = { small: 0, medium: 0, large: 0, xl: 0, craft: 0, null: 0 };
        const unclassified = [], products = [];
        for (const p of catalogue) {
          const cat = cats.get(String(p.categoryId)) || '';
          const r = sizeClassOf(p, cat);
          counts[r.cls || 'null']++;
          products.push({ id: p.id, title: p.title, cls: r.cls });
          if (!r.cls) unclassified.push({ id: p.id, title: p.title, category: cat, why: r.why });
        }
        const card = rateCard((st && st.allShippingMethods()) || []);
        return json(200, { counts, unclassified, problems: card ? card.problems : [{ title: '—', code: 'no-rates' }], products });
      }
```

Add `import { sizeClassOf } from './engine/size-class.mjs';` and add `rateCard` to the existing `ecwid-shipping.mjs` import.

- [ ] **Step 4: The panel.** In `admin.js`, add a section titled «فئات التوصيل» / "Delivery classes" that fetches the route and renders:
  - one chip per class with its count;
  - a table of `unclassified` (title, category, `why` in the page language);
  - `problems`, if any;
  - a search input that filters `products` by title and shows each one's class label.

  Follow the existing sections' markup in admin.js; open the file first and copy the structure of an existing read-only panel.

- [ ] **Step 5: Run the tests, bump admin.js, commit**

```bash
node --test engine/*.test.mjs
V=$(grep -rhoE "admin\.js\?v=[a-z0-9]+" --include=*.html site | head -1 | sed 's/.*v=//'); echo "was $V"
grep -rl "admin.js?v=$V" --include=*.html site | xargs sed -i "s/admin\.js?v=$V/admin.js?v=<NEXT>/g"
git add site/compare-server.mjs site/assets/js/admin.js site/engine/delivery-wiring.test.mjs site/admin.html
git commit -m "feat(admin): review every product's delivery class and what could not be classed"
```

---

### Task 10: Live verification, then deploy

**Files:** none (verification only)

- [ ] **Step 1: Full suite and a local end-to-end run.**
  1. Run `node --test engine/*.test.mjs` and confirm it is fully green.
  2. Restart the local server with Ecwid on.
  3. As a guest, order a >450 L fridge plus a fan to سوهاج.
  4. Read the order back from Ecwid (use the readback style from this session: `api.getOrder(id)`, printing `shippingOption`, `subtotal` and `total`). Expect `shippingRate` 1650 and `total = subtotal + 1650`.
- [ ] **Step 2: Tracking end to end.** In Ecwid, set a tracking number on the order from Step 1.
  - For a signed-in order: the account page shows it within 60 s (the `remoteOrdersCached` TTL).
  - For a guest order: `/orders.html` "Track an order" with the order number and phone shows the status and number; a wrong phone shows "not found".
- [ ] **Step 3: Push, then deploy.** Push to GitHub. The owner pastes the deploy line on the VM:
  `R=/opt/sadko/repo; echo "ROLLBACK POINT: $(sudo -u sadko git -C $R rev-parse --short HEAD)" && sudo -u sadko git -C $R stash push -- site/data/stores.json && sudo bash $R/deploy/update.sh; sudo -u sadko git -C $R stash pop`
- [ ] **Step 4: Verify live** (https://34.18.151.72.sslip.io):
  - `/api/delivery/governorates` lists 28 entries.
  - A quote for سوهاج with a fridge and a fan returns 1650.
  - `/data/accounts.db` is still 404.
  - The shop and checkout load with no failed requests.
