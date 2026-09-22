/* ============================================================================
   Payment methods, and the one thing Ecwid cannot express about them.

   SADKO's store offers ten methods, all of them Ecwid "manual" methods — no
   gateway, no card data, so nothing here touches PCI scope. The site used to
   hard-code three (cod / bank / showroom) and therefore offered none of the
   instalment plans that actually sell appliances: ValU, Souhoola, Forsa, Fawry,
   Mogo, SEVEN and two National Bank plans.

   THE PROBLEM THIS MODULE EXISTS FOR. Two of the ten are restricted to one
   manufacturer's products, and that restriction is written ONLY in the method's
   Arabic name:

     "تقسيط البنك الاهلي ( ١٨ شهر بدون فوائد ) على جميع منتجات كريازى"
     "مبادرة العربى تقسيط ( منتجات العربى فقط )"

   Ecwid cannot enforce a product restriction on a manual method, so a frontend
   that lists all ten on every basket would let someone choose 18-month Kiriazi
   instalments for a Samsung television. This module detects the restriction from
   the name and names the brand, so checkout can SAY SO at the point of choice.

   It deliberately does not BLOCK the choice. The brand it extracts is read out
   of a human-written label, and the catalogue carries no brand field to check it
   against (this store sets no Ecwid attributes) — so the honest thing is to
   state the restriction and let customer care confirm on the call they already
   make, not to silently drop a method the customer may well be entitled to.
   ========================================================================== */

/* Arabic normalisation, matching engine/ecwid-rails.mjs: the same brand is
   written كريازى and كريازي, العربى and العربي. */
import { stripHtml as _stripHtml } from './ecwid-map.mjs';

export function normAr(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[آأإا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* A restriction phrase, followed by the brand it restricts to. Both live forms
   are covered: "على جميع منتجات X" and "منتجات X فقط". */
const RESTRICTION = [
  /منتجات\s+([^\s()]+)\s*فقط/,
  /على\s+جميع\s+منتجات\s+([^\s()]+)/,
  /منتجات\s+([^\s()]+)\s*$/,
];

/* Brands SADKO's instalment plans are actually tied to, with their spelling
   variants folded by normAr. Used to recognise a brand we extracted, so a
   mis-parse produces "restricted, brand unknown" rather than a nonsense brand. */
const KNOWN_BRANDS = {
  'كريازي': { ar: 'كريازى', en: 'Kiriazi' },
  'العربي': { ar: 'العربى', en: 'El Araby' },
  'توشيبا': { ar: 'توشيبا', en: 'Toshiba' },
  'زانوسي': { ar: 'زانوسى', en: 'Zanussi' },
};

/* Does this method's label restrict it to one manufacturer's products? */
export function restrictionOf(title) {
  const n = normAr(title);
  for (const re of RESTRICTION) {
    const m = re.exec(n);
    if (!m) continue;
    const brand = normAr(m[1]);
    const known = KNOWN_BRANDS[brand];
    return {
      restricted: true,
      brand: known ? known.ar : m[1],
      brandEn: known ? known.en : null,
      brandKey: brand,
    };
  }
  return { restricted: false, brand: null, brandEn: null, brandKey: null };
}

/* Guidance, not enforcement. Given the titles of what is in the basket, does a
   restricted method look applicable? The catalogue has no brand field, so this
   reads the product titles — which is a heuristic, and is why the answer is
   "unlikely" rather than "no". */
export function basketFit(method, basketTitles = []) {
  if (!method || !method.restricted) return 'ok';
  if (!method.brandKey) return 'unknown';
  const hay = basketTitles.map(normAr).join(' ');
  if (!hay) return 'unknown';
  return hay.includes(method.brandKey) ? 'ok' : 'unlikely';
}

/* The three the site offered before Ecwid. Served when Ecwid is off, so
   checkout behaves exactly as it always did. */
export const FALLBACK_METHODS = [
  { id: 'cod', title: 'الدفع عند الاستلام', titleEn: 'Cash on delivery', restricted: false },
  { id: 'bank', title: 'تحويل بنكى', titleEn: 'Bank transfer', restricted: false },
  { id: 'showroom', title: 'الدفع فى المعرض', titleEn: 'Pay at a showroom', restricted: false },
];

/* Shape the mirrored methods for the storefront. `instructions` is real Arabic
   copy staff wrote in Ecwid — every instalment plan says some form of
   "سيتم التواصل لارسال الرابط الخاص بالدفع" — and the customer should see it,
   because it tells them what happens after they order. No money is taken
   online by any of these. */
export function toStorefrontMethods(mirrored = []) {
  return mirrored
    .filter(m => m && m.enabled !== false && String(m.title || '').trim())
    .map(m => {
      const r = restrictionOf(m.title);
      return {
        id: String(m.id),
        title: String(m.title).trim(),
        /* No titleEn: Ecwid holds no usable translations for this store, and
           copying Arabic into an English field is the bug the category mapper
           refuses. The English side shows the Arabic method name, which is what
           the customer will be told on the phone anyway. */
        instructions: _stripHtml(m.instructions),
        restricted: r.restricted,
        brand: r.brand,
        brandEn: r.brandEn,
        brandKey: r.brandKey,
        order: Number(m.order) || 0,
      };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/* Shared with the product mapper so the two cannot diverge — Ecwid writes
   the same rich-text HTML in both places. */
export { stripHtml } from './ecwid-map.mjs';
