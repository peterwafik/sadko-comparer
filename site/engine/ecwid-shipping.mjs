/* ============================================================================
   Delivery — and the reason the site still will not quote a total.

   THE EVIDENCE. Ecwid's own calculator does return a figure: POST
   /order/calculate for a 65" television to a Cairo address comes back with
   "القاهرة الكبرى", 250 EGP, and it needs no product weight to do it. That
   looked like the answer — until the same call was run against every
   governorate in Egypt:

     Cairo 250 · Giza 250 · Alexandria 250 · Qalyubia 250 · Dakahlia 250
     Sohag 250 · Aswan 250 · Marsa Matrouh 250 · Red Sea 250

   All nine return the GREATER CAIRO method. They should not: the store
   defines twelve methods precisely because delivery to the Delta and to Upper
   Egypt costs more than delivery inside Cairo. The cause is visible in the
   profile — `destinationZone` is `{}` on all twelve, so no method is bound to
   a region and Ecwid simply matches the first enabled one for every address.

   Quoting that 250 would undercharge every customer outside Cairo and Giza,
   and it would contradict the store's own zone structure.

   There is a second, independent blocker. Eight of the twelve methods are
   size bands — "منتجات صغيرة" through "منتجات كبيرة جدا" — and no product in
   the catalogue carries a weight (0 of 1,453), so nothing can choose between
   them. Configuring the zones alone would not fix this: it would produce a
   confident rate off whichever band happened to sort first.

   SO: this module exposes what the store genuinely STATES about delivery —
   its own policy sentences and delivery times, which staff wrote in Ecwid and
   which the site was showing none of — and reports `quotable: false` with the
   reason. Checkout keeps saying delivery is confirmed by customer care,
   because that is still the only honest thing it can say.

   When the owner binds each method to its governorates AND product weights
   exist, `quotable` flips on its own and the reason list empties.
   ========================================================================== */

import { stripHtml } from './ecwid-map.mjs';
import { regionOf, metroKeyOf } from './shipping-regions.mjs';

/* The size-band vocabulary staff actually used in the method titles. */
const BAND_WORDS = /منتجات\s+(صغيرة|متوسطة|كبيرة)/;

export function isSizeBand(title) {
  return BAND_WORDS.test(String(title == null ? '' : title));
}

/* A method is REGION-BOUND when Ecwid has a destination zone for it. Without
   one, Ecwid will offer it to any address on earth. */
export function isRegionBound(m) {
  return !!(m && m.zoneConfigured);
}

/* Can a delivery total be trusted for this store yet? Both conditions have to
   hold, and they fail independently — so the answer carries its reasons
   rather than a bare false, and the admin panel can show the owner exactly
   what to change. */
export function quoteReadiness(methods = [], { productsWithWeight = 0, productCount = 0 } = {}) {
  const list = methods.filter(m => m && m.enabled !== false);
  const reasons = [];

  const bound = list.filter(isRegionBound).length;
  if (list.length && bound === 0) {
    reasons.push({
      code: 'no_destination_zones',
      ar: 'لا توجد منطقة توصيل محددة لأى طريقة شحن فى إيكويد، فتُطبَّق أول طريقة (القاهرة الكبرى) على كل العناوين.',
      en: 'No shipping method in Ecwid has a destination zone, so the first method (Greater Cairo) is applied to every address.',
      fix: 'Ecwid → Shipping & Pickup → open each method → set the governorates it covers.',
    });
  } else if (list.length && bound < list.length) {
    reasons.push({
      code: 'partial_destination_zones',
      ar: 'بعض طرق الشحن بدون منطقة توصيل محددة.',
      en: 'Some shipping methods have no destination zone set.',
      fix: 'Ecwid → Shipping & Pickup → set a zone on the remaining methods.',
    });
  }

  /* The size bands need a weight to choose between them. Only raised when the
     store actually uses bands — a store with one flat method per region does
     not need weights at all. */
  if (list.some(m => isSizeBand(m.title)) && productsWithWeight === 0) {
    reasons.push({
      code: 'no_product_weights',
      ar: 'طرق الشحن مقسّمة حسب حجم المنتج، ولا يوجد وزن مسجَّل لأى منتج، فلا يمكن اختيار الفئة الصحيحة.',
      en: 'Shipping is banded by product size and no product has a weight, so the correct band cannot be chosen.',
      fix: 'Ecwid → Products → set a weight on each product (or replace the size bands with one rate per region).',
      detail: productCount ? `0 of ${productCount} products have a weight` : null,
    });
  }

  return { quotable: reasons.length === 0, reasons };
}

/* The store's own delivery sentences, deduplicated.

   Staff wrote the real policy into the description and delivery-time fields —
   "الحد الأقصى للشحن لعدد القطع هو 350 جنيه", "يرجى العلم بأن التوصيل يكون
   خلال 7 أيام" — and the site displayed none of it. These are STATEMENTS the
   store makes, shown as such; nothing here is computed. */
export function deliveryNotes(methods = []) {
  const seen = new Set();
  const out = [];
  for (const m of methods) {
    if (!m || m.enabled === false) continue;
    for (const raw of [m.description, m.deliveryTimeDays]) {
      const txt = stripHtml(raw);
      if (!txt) continue;
      const key = txt.replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: key, method: String(m.title || '').trim() });
    }
  }
  return out;
}

/* Zones as the store NAMES them, for the "where we deliver" list. The size
   band is stripped off the title, because a customer choosing a destination
   does not need to see four Delta rows.

   Deliberately NOT a governorate lookup: the store has not told Ecwid which
   governorates these cover, so turning "الصعيد" into a list of governorates
   would be an assumption of ours dressed up as the store's policy. */
export function deliveryZones(methods = []) {
  const seen = new Set();
  const out = [];
  for (const m of methods) {
    if (!m || m.enabled === false) continue;
    const name = String(m.title || '')
      .replace(/منتجات\s+(صغيرة|متوسطة|كبيرة\s*جدا|كبيرة)[^)]*\)?/g, '')
      .replace(/\(\s*\)/g, '')
      /* Staff typed the same zone three ways — "الصعيد - مرسى مطروح",
         "الصعيد -مرسى مطروح", "الصعيد-مرسى مطروح" — so an exact-string
         dedupe listed one region three times. Spacing around the separator is
         normalised BEFORE the dedupe, not for tidiness but because otherwise
         the customer is shown eight delivery areas where the store has six. */
      .replace(/\s*-\s*/g, ' - ')
      .replace(/\s*-\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/* What the storefront gets. `quotable` is the gate checkout reads: while it is
   false, checkout shows the notes and leaves the total to customer care. */
export function toStorefrontShipping(mirrored = [], counts = {}) {
  const list = (mirrored || []).filter(m => m && m.enabled !== false);
  const readiness = quoteReadiness(list, counts);
  return {
    quotable: readiness.quotable,
    reasons: readiness.reasons,
    zones: deliveryZones(list),
    notes: deliveryNotes(list),
    methodCount: list.length,
  };
}

/* ============================================================================
   The delivery quote (spec 2026-09-28). The two blockers named at the top of
   this file are resolved without touching Ecwid's data: the region comes from
   engine/shipping-regions.mjs, and the band from engine/size-class.mjs.
   Weights were never needed — every banded table starts at weightFrom 0.
   ========================================================================== */

const NT = s => String(s == null ? '' : s).replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();

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
    const entry = () => ({ ...r, title: String(m.title).trim(), note });
    const problem = () => card.problems.push({ title: m.title, code: m.calcType === 'table' ? 'tiered' : 'unsupported' });
    let slot = null;
    if (/حرف يدويه/.test(t)) slot = ['craft'];
    else if (/الدلتا/.test(t) && bandOf(t)) slot = ['delta', bandOf(t)];
    else if (/الصعيد/.test(t) && bandOf(t)) slot = ['upper', bandOf(t)];
    else if (/القاهره الكبري/.test(t)) slot = ['metro', 'cairo'];
    else if (t === 'الجيزه') slot = ['metro', 'giza'];
    else if (t === 'الاسكندريه') slot = ['metro', 'alex'];
    if (!slot) { card.problems.push({ title: m.title, code: 'unparsed' }); continue; }
    if (!r) { problem(); continue; }
    if (slot[0] === 'craft') card.craft = entry();
    else card[slot[0]][slot[1]] = entry();
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
