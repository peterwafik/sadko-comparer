/* ============================================================================
   Admin portal ⇄ Ecwid: turning what an admin typed into what Ecwid stores.

   The portal keeps no copy of anything here. Every function is pure: it
   validates a form and returns the Ecwid payload, or { error }. The routes in
   compare-server.mjs send the payload and let the mirror catch up.
   ========================================================================== */

import { adDestination, parseAdDescription } from './ecwid-ads.mjs';
export { parseAdDescription };
import { randomBytes } from 'node:crypto';

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const money = v => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : NaN;
};

/* The badge colour is fixed to the site's teal: one less thing to get wrong. */
export const BADGE_COLOR = '#0F766E';

/* A product edit. Keys absent from the form are absent from the payload, so
   a partial edit never blanks a field staff set in Ecwid. */
export function productPatch(f = {}) {
  const out = {};
  if ('title' in f) { const t = str(f.title, 300); if (!t) return { error: 'bad-title' }; out.name = t; }
  if ('price' in f) { const p = money(f.price); if (p == null || Number.isNaN(p)) return { error: 'bad-price' }; out.price = p; }
  if ('compareToPrice' in f) {
    const w = money(f.compareToPrice);
    if (Number.isNaN(w)) return { error: 'bad-price' };
    /* Ecwid clears a was-price with 0, not null. */
    out.compareToPrice = w == null ? 0 : w;
    const price = 'price' in out ? out.price : null;
    if (w && price != null && w <= price) return { error: 'was-below-price' };
  }
  if ('enabled' in f) out.enabled = !!f.enabled;
  if ('badge' in f) {
    const b = str(f.badge, 40);
    out.ribbon = b ? { text: b, color: BADGE_COLOR } : { text: '', color: '' };
  }
  if ('quantity' in f) {
    if (f.quantity === null || f.quantity === '') out.unlimited = true;
    else {
      const q = Number(f.quantity);
      if (!Number.isInteger(q) || q < 0 || q > 1_000_000) return { error: 'bad-quantity' };
      out.quantity = q; out.unlimited = false;
    }
  }
  if ('description' in f) out.description = str(f.description, 20000);
  if ('categoryId' in f) {
    const c = String(f.categoryId || '').trim();
    if (!/^\d{1,20}$/.test(c)) return { error: 'bad-category' };
    out.defaultCategoryId = Number(c);
  }
  return out;
}

/* ---- coupons ---- */
const TYPES = new Set(['PERCENT', 'ABS', 'SHIPPING', 'ABS_AND_SHIPPING', 'PERCENT_AND_SHIPPING']);
const STATUSES = new Set(['ACTIVE', 'PAUSED']);
/* Egypt is UTC+2 all year since 2014 apart from the 2023-2025 summer time; the
   offset only moves a coupon's edge by an hour at worst. */
const day = (d, end) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d} ${end ? '23:59:59' : '00:00:00'} +0200` : null;

export function couponPayload(f = {}) {
  const code = String(f.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return { error: 'bad-code' };
  const type = String(f.type || 'PERCENT').toUpperCase();
  if (!TYPES.has(type)) return { error: 'bad-type' };
  let discount = 0;
  if (type !== 'SHIPPING') {
    discount = Number(f.discount);
    if (!Number.isFinite(discount) || discount <= 0) return { error: 'bad-discount' };
    if (/PERCENT/.test(type) && discount > 100) return { error: 'bad-discount' };
  }
  const status = STATUSES.has(String(f.status || '').toUpperCase()) ? String(f.status).toUpperCase() : 'ACTIVE';
  const out = { name: str(f.name, 120) || code, code, discountType: type, discount, status,
                usesLimit: f.single ? 'SINGLE' : f.once ? 'ONCEPERCUSTOMER' : 'UNLIMITED', applicationLimit: 'UNLIMITED' };
  const min = money(f.minSubtotal);
  if (Number.isNaN(min)) return { error: 'bad-min' };
  if (min) out.totalLimit = min;
  const from = day(f.from, false), to = day(f.to, true);
  if (from) out.launchDate = from;
  if (to) out.expirationDate = to;
  if (from && to && from > to) return { error: 'bad-dates' };
  /* Key order: tests compare whole objects. */
  return Object.fromEntries(['name', 'code', 'discountType', 'discount', 'status', 'totalLimit', 'usesLimit',
    'applicationLimit', 'launchDate', 'expirationDate'].filter(k => k in out).map(k => [k, out[k]]));
}

/* ---- ads ----
   An ad is a product inside a disabled Ecwid ad folder (engine/ecwid-ads.mjs).
   The slot is the folder, the position is the number in the name, the link is
   the SKU, and the message is the description: Arabic, then an "EN:" line. */
export const AD_SLOT_NAMES = { hero: 'إعلان البانر الرئيسى', wide: 'إعلان عريض', square: 'إعلان مربع' };
export const adName = (slot, n) => `${AD_SLOT_NAMES[slot] || 'إعلان'} ${n}`;

export function adDescription(ar, en) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [str(ar, 300) ? `<p>${esc(str(ar, 300))}</p>` : '', str(en, 300) ? `<p>EN: ${esc(str(en, 300))}</p>` : ''].join('');
}

const PAGES = new Set(['index', 'shop', 'finder', 'guides', 'care', 'plan', 'delivery', 'contact', 'about',
                       'showrooms', 'warranty', 'values']);
export function cleanDestination(d = {}) {
  const v = String(d.value || '').trim();
  let sku = null;
  if (d.kind === 'page' && PAGES.has(v)) sku = v;
  else if (d.kind === 'cat' && /^\d{1,20}$/.test(v)) sku = 'cat:' + v;
  else if (d.kind === 'product' && /^\d{1,20}$/.test(v)) sku = 'product:' + v;
  /* The storefront's own reader must agree, or the ad would link nowhere. */
  return sku && adDestination(sku) ? sku : null;
}
/* Ecwid wants unique SKUs; the "~…" tail is ignored by adDestination. Not "#":
   Ecwid's API drops that character from a SKU (see ecwid-ads.mjs). */
export const adSku = dest => `${dest || 'ad'}~${randomBytes(4).toString('hex').slice(0, 6)}`;

/* Width and height from the file header: PNG, JPEG, WebP. null if unknown. */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  }
  return null;
}

/* The frames the storefront draws (storefront.css): wide and hero are
   1600/608, square is 1/1, all object-fit:cover. */
export const AD_SHAPES = {
  hero: { ratio: 1600 / 608, minW: 1200, label: '1600 × 608' },
  wide: { ratio: 1600 / 608, minW: 1200, label: '1600 × 608' },
  square: { ratio: 1, minW: 600, label: '900 × 900' },
};
export function shapeProblem(slot, size) {
  const s = AD_SHAPES[slot];
  if (!s || !size) return null;
  const r = size.w / size.h;
  if (Math.abs(r - s.ratio) / s.ratio > 0.12) return 'wrong-shape';
  if (size.w < s.minW) return 'too-small';
  return null;
}

/* ---- payment methods ---- */
/* Ecwid keeps payment instructions as HTML. Admins edit plain lines; each
   line goes back as a paragraph, escaped. */
export function htmlToText(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}
export function textToHtml(text) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => `<p>${esc(s)}</p>`).join('');
}
export function paymentPatch(f = {}) {
  const out = {};
  if ('enabled' in f) out.enabled = !!f.enabled;
  if ('title' in f && str(f.title, 120)) out.checkoutTitle = str(f.title, 120);
  if ('instructions' in f) out.instructionsForCustomer = {
    instructionsTitle: str(f.title, 120) || undefined, instructions: textToHtml(str(f.instructions, 4000)) };
  return out;
}

/* Which ads a category page will show: shop.js adsFor() for a category. Wide
   artwork only (hero ads are wide), campaigns aimed at this category family
   first, then brand-wide ones, three at most. `productCat` resolves an ad
   pointing at one product to that product's category. */
export function adPagePreview(ads, cat, family, productCat = () => null) {
  const inFam = id => (family ? family[String(id)] === true : String(id) === String(cat));
  const catsOf = a => {
    const href = String(a.href || '');
    let m = href.match(/[?&]cat=(\d+)/); if (m) return [m[1]];
    m = href.match(/product\.html\?id=(\d+)/);
    if (m) { const c = productCat(m[1]); return c ? [String(c)] : []; }
    return [];
  };
  const mine = [], any = [];
  for (const a of ads || []) {
    if (!a || (a.slot !== 'wide' && a.slot !== 'hero')) continue;
    const cs = catsOf(a);
    if (!cs.length) any.push(a); else if (cs.some(inFam)) mine.push(a);
  }
  return mine.concat(any).slice(0, 3);
}
