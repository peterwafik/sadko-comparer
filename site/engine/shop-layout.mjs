/* ============================================================================
   How the shop page (shop.html, the hub) is laid out, as the admin portal's
   "Shop page" screen sets it. Stored as one site setting, `shop.layout`.

   Only PRESENTATION lives here: which sections show and in what order, their
   titles, how many products a rail shows, which brands and categories get a
   tile, brand logos, and the order of pinned products. What a rail CONTAINS
   is membership of an Ecwid category (offers, best sellers), and a
   category's picture is its Ecwid image: those are written to Ecwid.

   Pure: validation and ordering only.
   ========================================================================== */

export const SECTION_KEYS = ['brands', 'offers', 'adWide', 'categories', 'featured', 'bestSellers'];
/* Sections with a heading the admin may rename. The ad block has none.
   The square ad tiles (adGrid) were removed at the owner's request; a saved
   layout that still names them is cleaned of the key by cleanLayout(). */
const TITLED = ['brands', 'offers', 'categories', 'featured', 'bestSellers'];
const RAILS = ['offers', 'featured', 'bestSellers'];
const PINNABLE = ['offers', 'bestSellers'];

export function defaultLayout() {
  return {
    sections: SECTION_KEYS.map(key => ({ key, on: true })),
    titles: {},
    limits: { offers: 8, featured: 8, bestSellers: 8 },
    brands: { mode: 'auto', max: 12, pick: [], logos: {}, names: {} },
    categories: { mode: 'auto', pick: [] },
    order: { offers: [], bestSellers: [] },
  };
}

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const uniq = (arr, ok, max) => {
  const out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const v = str(x, 80);
    if (v && ok(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
};
const ID = v => /^\d{1,20}$/.test(v);
/* A logo is a picture this site serves: an uploaded one, or a shipped file. */
const LOGO = /^(data\/uploads\/p[a-z0-9]+\.(png|jpg|webp|gif|avif)|assets\/img\/brands\/[a-z0-9_-]+\.(png|svg|jpg|webp))$/;

export function cleanLayout(input) {
  const d = defaultLayout();
  const i = obj(input);
  if (!i) return d;

  if (Array.isArray(i.sections)) {
    const seen = new Set(), out = [];
    for (const s of i.sections) {
      const k = obj(s) && s.key;
      if (!SECTION_KEYS.includes(k) || seen.has(k)) continue;
      seen.add(k); out.push({ key: k, on: s.on !== false });
    }
    for (const k of SECTION_KEYS) if (!seen.has(k)) out.push({ key: k, on: true });
    d.sections = out;
  }
  const titles = obj(i.titles) || {};
  for (const k of TITLED) {
    const t = obj(titles[k]);
    if (!t) continue;
    const ar = str(t.ar, 80), en = str(t.en, 80);
    if (ar || en) d.titles[k] = { ar, en };
  }
  const limits = obj(i.limits) || {};
  for (const k of RAILS) if (k in limits) d.limits[k] = int(limits[k], 1, 24, d.limits[k]);

  const b = obj(i.brands);
  if (b) {
    d.brands.mode = b.mode === 'manual' ? 'manual' : 'auto';
    d.brands.max = int(b.max, 1, 30, 12);
    d.brands.pick = uniq(b.pick, () => true, 40);
    for (const [k, v] of Object.entries(obj(b.logos) || {})) {
      const key = str(k, 80), url = str(v, 200);
      if (key && LOGO.test(url)) d.brands.logos[key] = url;
    }
    for (const [k, v] of Object.entries(obj(b.names) || {})) {
      const n = obj(v), key = str(k, 80);
      if (key && n && (str(n.ar, 60) || str(n.en, 60))) d.brands.names[key] = { ar: str(n.ar, 60), en: str(n.en, 60) };
    }
  }
  const c = obj(i.categories);
  if (c) d.categories = { mode: c.mode === 'manual' ? 'manual' : 'auto', pick: uniq(c.pick, ID, 60) };
  const o = obj(i.order) || {};
  for (const k of PINNABLE) d.order[k] = uniq(o[k], ID, 48);
  return d;
}

/* Pinned ids first, in the pinned order; everything else keeps its place. */
export function pinOrder(ids, pinned) {
  const list = (ids || []).map(String);
  const set = new Set(list);
  const head = (pinned || []).map(String).filter(id => set.has(id));
  const pin = new Set(head);
  return head.concat(list.filter(id => !pin.has(id)));
}

/* What shop.js reads from /data/shop.json. */
export function publicLayout(l) {
  return { sections: l.sections, titles: l.titles, limits: l.limits, brands: l.brands, categories: l.categories };
}
