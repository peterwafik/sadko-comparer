/* ============================================================================
   Advertisement folders — one Ecwid category per banner slot.

   WHY THIS EXISTS, given banners already worked by SKU.

   The SKU convention ("banner-square") asks a staff member to remember a
   magic string and type it into a field called SKU, which is a product code.
   The owner asked for the obvious thing instead: a folder per ad type — put
   the artwork in the "square" folder and it becomes a square ad. Nothing to
   remember and nothing to type.

   THE OBSTACLE, AND WHY THIS WORKS ANYWAY. An ad folder has to be DISABLED,
   or Ecwid shows it to its own shoppers and it turns up in this site's
   category rail. But a disabled Ecwid category is close to invisible over the
   API:

     · GET /categories omits it entirely
     · GET /categories?hidden_categories=true returns {id, enabled:false} —
       an id-only stub with NO NAME
     · a product inside it does not list it in categoryIds

   So a folder cannot be found by name, and membership cannot be read from the
   product. What DOES work, measured against the live store: asking for the
   products of a disabled category by id.

     GET /products?category=206629525   →  32 products   (a disabled category)
     GET /products?category=206811031   →  0 products    (disabled, empty)

   That single fact is what this module is built on: each slot's folder is
   configured BY ID, its contents are enumerated by id at sync time, and the
   resulting id→slot map is what the storefront reads. The folder can stay
   disabled, so it never reaches an Ecwid shopper and never pollutes this
   site's taxonomy — and we can still see inside it.

   The SKU convention keeps working, and is the fallback for anything not in a
   folder, so nothing that exists today breaks.
   ========================================================================== */

/* The slots the storefront actually renders. Kept here, not duplicated in the
   env parsing or the sync, so a fourth slot is one edit. */
export const AD_SLOTS = ['hero', 'wide', 'square'];

/* Read the folder configuration from the environment.

   One variable per slot, each holding a category id:

     SADKO_ECWID_ADS_HERO    the big rotating strap
     SADKO_ECWID_ADS_WIDE    the wide strap
     SADKO_ECWID_ADS_SQUARE  the square tiles dealt down the shop page

   An unset or non-numeric value is simply absent — that slot then falls back
   to the SKU convention. A blank string is NOT treated as an id, which is
   what makes "unset it to turn the folder off" work in a systemd
   EnvironmentFile, where a bare `KEY=` is a real empty value. */
export function adFoldersFromEnv(env = {}) {
  const out = {};
  for (const slot of AD_SLOTS) {
    const raw = env['SADKO_ECWID_ADS_' + slot.toUpperCase()];
    const id = String(raw == null ? '' : raw).trim();
    /* Ecwid ids are numeric. Refusing anything else means a typo like a
       pasted URL fails visibly at configuration time rather than silently
       matching no products. */
    if (id && /^\d+$/.test(id)) out[slot] = id;
  }
  return out;
}

/* Invert {slot: folderId} + {folderId: [productIds]} into {productId: slot}.

   The product→slot direction is what every read needs, and building it once
   per sync beats scanning three arrays per product on every page render.

   Where a product somehow sits in two ad folders, the EARLIER slot in
   AD_SLOTS wins (hero over wide over square) and the duplicate is reported
   rather than silently resolved — a banner in two folders is a staff mistake,
   and picking one quietly would make it look intentional. */
export function buildSlotMap(folders = {}, contents = {}) {
  const map = {};
  const conflicts = [];
  for (const slot of AD_SLOTS) {
    const folderId = folders[slot];
    if (!folderId) continue;
    const ids = contents[String(folderId)] || contents[slot] || [];
    for (const raw of ids) {
      const id = String(raw == null ? '' : raw).trim();
      if (!id) continue;
      if (map[id] && map[id] !== slot) { conflicts.push({ id, kept: map[id], also: slot }); continue; }
      if (!map[id]) map[id] = slot;
    }
  }
  return { map, conflicts };
}

/* The slot for one product, folder first.

   `sku` is the pre-existing convention and stays the fallback, so a store
   using SKUs today keeps working and the two can be mixed during a
   changeover. A product in neither is not an ad at all — this returns null,
   and the caller decides; it deliberately does NOT default to 'square',
   because "everything is a square ad" is how an ordinary product would end up
   rendered as one. */
export function adSlotOf(product, slotMap = {}) {
  if (!product || product.id == null) return null;
  const byFolder = slotMap[String(product.id)];
  if (byFolder) return byFolder;

  const sku = String((product.sku || '')).trim().toLowerCase();
  if (!sku) return null;
  const tail = sku.startsWith('banner-') ? sku.slice('banner-'.length) : sku;
  /* A bare slot word is accepted only from a SKU that carried the prefix, or
     that is exactly a slot name. "square-door-handle" must not become an ad. */
  if (sku.startsWith('banner-') && AD_SLOTS.includes(tail)) return tail;
  if (AD_SLOTS.includes(sku)) return sku;
  /* A banner- prefix with an unrecognised tail is still clearly meant as a
     banner; square is the safe shape for unknown artwork. */
  if (sku.startsWith('banner-')) return 'square';
  return null;
}

/* Is this product an advertisement rather than something for sale?

   The question the catalogue asks. Anything with a slot is an ad, plus
   membership of the legacy single banner category, which predates the
   per-slot folders and may still be in use. */
export function isAd(product, slotMap = {}, legacyBannerCategoryId = null) {
  if (!product) return false;
  if (adSlotOf(product, slotMap)) return true;
  const legacy = legacyBannerCategoryId == null ? null : String(legacyBannerCategoryId);
  if (legacy == null) return false;
  if (String(product.categoryId) === legacy) return true;
  return Array.isArray(product.categoryIds) && product.categoryIds.map(String).includes(legacy);
}

/* How many ads each slot holds, for the admin panel.

   Reported per slot rather than as one total, because "3 square, 0 hero" is
   the answer to "why is the top of my page still the old banner" and a single
   count is not. */
export function adCounts(products = [], slotMap = {}) {
  const out = { hero: 0, wide: 0, square: 0, none: 0 };
  for (const p of products) {
    const slot = adSlotOf(p, slotMap);
    if (slot && out[slot] != null) out[slot]++;
  }
  return out;
}

/* What an ad folder needs before it can render, and what is wrong with it.

   A banner with no artwork or no headline is dropped by deriveBanners, which
   is correct but silent — the owner drops three images in a folder, two
   appear, and nothing says why. This names the reason per entry so the admin
   panel can. */
export function adIssues(products = [], slotMap = {}) {
  const out = [];
  for (const p of products) {
    const slot = adSlotOf(p, slotMap);
    if (!slot) continue;
    const reasons = [];
    if (!String(p.title || '').trim()) reasons.push('no-name');
    const img = p.image || (Array.isArray(p.images) ? p.images[0] : '');
    if (!img) reasons.push('no-image');
    if (reasons.length) out.push({ id: String(p.id), slot, reasons });
  }
  return out;
}

/* ============================================================================
   Merging Ecwid's ads with the local promos.json, ONE SLOT AT A TIME.

   Until now an Ecwid banner replaced promos.json wholesale: the route did
   `if (promos.length) return ecwidPromos`. Measured consequence — configuring
   only the square folder emptied the hero strap at the top of the shop page,
   because the two local hero banners were discarded along with everything
   else. That makes a staged rollout impossible, and a staged rollout is
   exactly what the owner asked for: square first, then the rest.

   So the merge is per slot group. A group where Ecwid has at least one usable
   entry is Ecwid's; every other group keeps its local entries, with their
   bilingual copy intact — which matters, because a derived banner carries no
   English at all.

   The two sources do not share a vocabulary, which is why groupOf() exists:

     promos.json   slot: 'hero' | 'slot'      art: 'wide' | 'square'
     derived       slot: 'hero' | 'wide' | 'square'

   Both collapse to hero / wide / square, and that is the unit of replacement.
   ========================================================================== */

/* Which slot group a promo belongs to, from EITHER vocabulary.

   The hero strap is identified by slot, because that is the only thing the
   local file says about it; everything else is grouped by the ARTWORK shape,
   because that is what decides whether a tile can be rendered in a frame. */
export function groupOf(promo) {
  if (!promo) return null;
  if (String(promo.slot) === 'hero') return 'hero';
  if (String(promo.slot) === 'square' || String(promo.art) === 'square') return 'square';
  if (String(promo.slot) === 'wide' || String(promo.art) === 'wide') return 'wide';
  return null;
}

export function mergePromos(ecwidPromos = [], localPromos = []) {
  /* A default parameter only fires for `undefined`, and a promos.json read
     that failed resolves to NULL — which is exactly what this is handed when
     the static file is missing. Normalised rather than defaulted. */
  const ecwid = Array.isArray(ecwidPromos) ? ecwidPromos : [];
  const local = Array.isArray(localPromos) ? localPromos : [];

  const ecwidByGroup = {};
  for (const p of ecwid) {
    const g = groupOf(p);
    if (!g) continue;
    (ecwidByGroup[g] = ecwidByGroup[g] || []).push(p);
  }

  const out = [];
  const replaced = [];
  const kept = [];
  for (const g of AD_SLOTS) {
    if (ecwidByGroup[g] && ecwidByGroup[g].length) {
      out.push(...ecwidByGroup[g]);
      replaced.push(g);
    } else {
      const mine = local.filter(p => groupOf(p) === g);
      if (mine.length) { out.push(...mine); kept.push(g); }
    }
  }

  /* Anything the grouping could not place is kept rather than dropped: a
     promos.json the owner hand-edited must not lose entries to a vocabulary
     this function does not recognise. */
  for (const p of local) if (p && !groupOf(p)) out.push(p);

  return { promos: out, fromEcwid: replaced, fromLocal: kept };
}

/* ============================================================================
   Where an ad points, set from the panel.

   The folder decides the SLOT, which frees the SKU field: for a product inside
   an ad folder, "SKU" has no other meaning. So that is where the owner writes
   the destination.

   THE REASON THIS IS NEEDED. Deriving the destination from the ad's assigned
   category covers "this banner advertises air conditioners" and nothing else.
   Two of the three square tiles this replaces point at contact.html and
   delivery.html, and the third at one specific product — none of which a
   category can express. Without this, moving them into Ecwid would silently
   drop all three destinations and send every tile to the shop.

   A STRICT ALLOW-LIST, not a URL. This value is staff-typed text that ends up
   in an href on our own pages, so an arbitrary string would be an open
   redirect at best and a javascript: URL at worst. Only three shapes are
   accepted, and anything else is ignored in favour of the category fallback:

     contact          → contact.html          (any site page in SITE_PAGES)
     product:837495061→ product.html?id=837495061
     cat:206629766    → shop.html?cat=206629766

   Nothing here can produce an absolute URL, a protocol, or a path that climbs
   out of the site.
   ========================================================================== */

/* The pages an ad may point at. Named explicitly rather than derived from the
   filesystem: this is a list of things it makes sense to advertise, and a
   glob would happily offer admin.html. */
const SITE_PAGES = new Set([
  'index', 'shop', 'finder', 'compare', 'guides', 'care', 'plan', 'delivery',
  'contact', 'about', 'showrooms', 'warranty', 'values', 'appliances', 'saved',
]);

export function adDestination(sku) {
  /* Everything after a "#" is a UNIQUIFIER and is discarded.

     Ecwid enforces unique SKUs across the whole catalogue, so two adverts
     cannot both carry "contact" — the second is rejected at save time with
     "This SKU is already in use". That is fatal for a scheme that puts the
     destination in the SKU, because two banners pointing at the same page is
     the normal case, not the exception. A "#" suffix makes the value unique
     to Ecwid while meaning nothing here:

       contact              -> contact.html
       contact#2            -> contact.html
       product:837495061#b  -> product.html?id=837495061

     "#" is safe to claim: it cannot appear in any destination this
     allow-list accepts, and it is the one character a URL would treat as a
     fragment anyway. */
  const raw = String(sku == null ? '' : sku).split('#')[0].trim().toLowerCase();
  if (!raw) return null;

  /* A slot marker is not a destination — it is the legacy way of saying which
     slot this is, and it must not be read as a page name. */
  if (raw.startsWith('banner-') || AD_SLOTS.includes(raw)) return null;

  let m = /^product:(\d{1,20})$/.exec(raw);
  if (m) return 'product.html?id=' + m[1];

  m = /^cat:(\d{1,20})$/.exec(raw);
  if (m) return 'shop.html?cat=' + m[1];

  /* A bare page name, with or without the .html a staff member may add, and
     with an optional trailing digit run as a second uniquifier:

       contact    ->  contact.html
       contact2   ->  contact.html
       contact#2  ->  contact.html   (the "#" split above)

     Both forms exist because Ecwid rejects a duplicate SKU and two adverts
     pointing at the same page is the normal case. "#" is the clearer of the
     two, but it is awkward on some keyboard layouts — this automation itself
     typed it as "0" — so a plain trailing number works as well.

     The digit form applies ONLY to a bare page name. "product:837495061"
     keeps every digit, because there they are the payload and not a counter. */
  const page = raw.replace(/\.html$/, '');
  if (SITE_PAGES.has(page)) return page + '.html';
  const trimmed = page.replace(/\d+$/, '');
  if (trimmed !== page && SITE_PAGES.has(trimmed)) return trimmed + '.html';

  /* Anything else — a real product code, a pasted URL, a typo — is not a
     destination. The category fallback takes over. */
  return null;
}

/* ============================================================================
   The advert's POSITION, read from its name.

   The names are deliberately generic — "إعلان مربع ٢ — شبكة صفحة المتجر" —
   because the artwork changes every couple of weeks while the slot it fills
   does not. A name that described the picture would be a lie within a
   fortnight; a name that describes the position stays true.

   For that to be honest the order has to be controllable, and the leading
   number in the name is what controls it. Renaming 2 to 3 moves the advert.
   Without a number an advert keeps its existing position, after the numbered
   ones — so a store that never adopts the convention is unaffected.

   Arabic-Indic digits are accepted because that is what staff type in an
   Arabic-language panel, and the two sets are folded to the same value.
   ========================================================================== */

/* ٠١٢٣٤٥٦٧٨٩ -> 0123456789 */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const foldDigits = s => String(s == null ? '' : s)
  .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));

export function adPositionOf(title) {
  const m = /(\d{1,3})/.exec(foldDigits(title));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* Sort comparator for adverts sharing one slot. An advert with a position
   comes first, in numeric order; the rest keep the order they arrived in,
   which Array.prototype.sort preserves for equal keys in Node. */
export function byAdPosition(a, b) {
  const pa = adPositionOf(a && a.title);
  const pb = adPositionOf(b && b.title);
  if (pa != null && pb != null) return pa - pb;
  if (pa != null) return -1;
  if (pb != null) return 1;
  return 0;
}
