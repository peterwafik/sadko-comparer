/* ============================================================================
   The shop's product rails and advertisement banners, DERIVED from Ecwid so
   they cannot rot.

   data/collections.json held three hand-curated id lists captured in July.
   offers and bestSellers now come from the real Ecwid categories staff already
   curate; featured comes from products carrying a genuine was-price.

   WHY RAILS RESOLVE BY NAME, NOT BY ID. Production (store 18028328) and the
   test store (142682751) use completely different category ids for the same
   business concepts — عروض صادكو is 173607281 in one and 206629522 in the
   other. Hard-coding either would silently produce an empty rail on the other
   store. So the resolver matches Arabic names (normalised for orthography) and
   accepts an explicit id override for the case where a name changes.

   THE RULE THAT MATTERS: a rail with nothing to show is OMITTED, never padded.
   Filling one with arbitrary products would be inventing a commercial claim,
   which the honesty guards in shop-core.test.mjs forbid.
   ========================================================================== */

/* Arabic orthography varies between the two stores: "الأكثر مبيعاً" versus
   "المنتجات الاكثر مبيعاً", أ versus ا, ى versus ي. Normalise before matching
   so a rail does not vanish over a hamza. */
export function normAr(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ٰٟ]/g, '')       // diacritics
    .replace(/[آأإا]/g, 'ا')   // آ أ إ ا -> ا
    .replace(/ى/g, 'ي')                // ى -> ي
    .replace(/ة/g, 'ه')                // ة -> ه
    .replace(/ـ/g, '')                      // tatweel
    .replace(/\s+/g, ' ')
    .trim();
}

/* Matched on a distinctive Arabic fragment rather than the whole name, because
   the two stores word these differently. "عروض" and "مبيع" each occur in
   exactly one category across both stores' 30-category taxonomies. */
const RAIL_MATCH = {
  offers: /عروض/,
  bestSellers: /مبيع/,
};

const TITLES = {
  offers: { titleAr: 'عروض صادكو', titleEn: 'SADKO offers' },
  bestSellers: { titleAr: 'الأكثر مبيعاً', titleEn: 'Best sellers' },
  featured: { titleAr: 'مختارات صادكو', titleEn: "SADKO's picks" },
};

/* Find the curated categories in whatever store we are pointed at. Returns
   null for a rail whose category is absent, which makes the rail omit itself
   rather than silently render everything or nothing. */
export function resolveRailCategories(categories = [], overrides = {}) {
  const out = { offers: null, bestSellers: null };
  for (const key of Object.keys(out)) {
    if (overrides[key]) { out[key] = String(overrides[key]); continue; }
    const hit = (categories || []).find(c => c && RAIL_MATCH[key].test(normAr(c.name)));
    out[key] = hit ? String(hit.id) : null;
  }
  return out;
}

const inCat = (p, cat) => cat != null && (
  String(p.categoryId) === cat ||
  (Array.isArray(p.categoryIds) && p.categoryIds.map(String).includes(cat)));

export function deriveRails(products, {
  categories = [], offersCategoryId = null, bestSellersCategoryId = null, limit = 24,
} = {}) {
  const ids = resolveRailCategories(categories, {
    offers: offersCategoryId, bestSellers: bestSellersCategoryId,
  });

  /* A rail promotes something to buy, so it skips what cannot be bought. The
     product itself stays in the catalogue, marked unavailable — 470 of the 990
     visible products are out of stock, and a rail full of them would be a
     shop window of things you cannot have. */
  const buyable = (products || []).filter(p => p && p.inStock !== false && !p.incomplete);

  const out = {};
  const put = (key, list) => {
    if (!list.length) return;                    // omitted, never padded
    out[key] = { ...TITLES[key], ids: list.slice(0, limit).map(p => String(p.id)) };
  };

  const offers = buyable.filter(p => inCat(p, ids.offers));
  put('offers', offers);
  put('bestSellers', buyable.filter(p => inCat(p, ids.bestSellers)));

  /* featured = a REAL discount that is NOT already in the offers category.
     The mapper has already nulled every stale, equal, zero and absent
     was-price, so trusting compareToPrice here is safe.

     The exclusion is not fussiness. In the live store 65 of the 69 products in
     عروض صادكو also carry a was-price, so without it the two rails would show
     almost the same items — two shop windows onto one shelf. Excluding them
     makes مختارات صادكو mean "a real discount staff have not already put in
     the offers row", which is complementary and worth a customer's attention.
     If nothing qualifies, the rail omits itself like any other. */
  const inOffers = new Set(offers.map(p => String(p.id)));
  put('featured', buyable
    .filter(p => !inOffers.has(String(p.id)))
    .filter(p => p.compareToPrice != null && p.price != null && p.compareToPrice > p.price)
    .sort((a, b) => (b.compareToPrice - b.price) - (a.compareToPrice - a.price)));

  return out;
}

/* ============================ banners =================================== */

/* Ecwid has no banner entity, so a banner is an entry in a dedicated, disabled
   category: image = artwork, name = headline, description = subtitle,
   SKU = slot, product URL = click-through target.

   Output matches data/promos.json so shop.js and storefront.js need no change.

   ENGLISH IS DELIBERATELY ABSENT. Ecwid carries no usable translations for
   this store — every nameTranslated.en holds Arabic — so a derived banner has
   no honest titleEn. Rather than copy Arabic into an English field (the exact
   bug the category mapper refuses), English fields are left off and `alt` is
   set from the Arabic headline, which is what the artwork actually says. The
   static promos.json remains the bilingual source when English matters. */
const SLOTS = new Set(['hero', 'wide', 'square']);
const ART_FOR_SLOT = { hero: 'wide', wide: 'wide', square: 'square' };

/* Where a banner sends the shopper.

   NEVER p.url. That is the banner entry's own page on Ecwid's storefront, and
   pointing the homepage's largest click target at another shop is the bug this
   replaces — shop.js passes an absolute URL straight through, so nothing
   downstream would have caught it.

   The owner controls it from the panel instead, with a field that is already
   on the product form: assign the banner entry to the ordinary category it is
   advertising, and that category's page becomes the destination. The banner
   category itself is skipped (it is not a place to send anyone), and so is
   Ecwid's 0 for "no category". A banner assigned to nothing lands on the shop,
   which is a weak destination but a safe one.

   For a banner that must point somewhere a category cannot express — the
   contact page, the delivery page, one specific product — the local
   promos.json route in the SADKO admin still takes an arbitrary href, and an
   Ecwid banner overrides it wholesale (see the /data/promos.json route), so
   the two are an either/or choice, not a merge. */
function bannerHref(p, bannerCategoryId) {
  const banner = bannerCategoryId == null ? null : String(bannerCategoryId);
  const usable = id => {
    const v = String(id == null ? '' : id).trim();
    return v && v !== '0' && v !== banner ? v : null;
  };
  /* "shop.html?cat=NNN", NOT "category/NNN.html", and that is load-bearing
     twice over:

       · shop.js promoCats() decides WHICH PAGE a banner appears on by reading
         ?cat=NNN out of its own href. A banner assigned to air conditioners
         therefore becomes the banner on the air-conditioners page, and is kept
         off the washing-machine page — "advertising fridges on the washing
         machine page is the one thing worse than no banner at all". The
         category/NNN.html form does not match that pattern, so every banner
         would have been treated as brand-wide and shown everywhere.

       · it is the same form the local promos.json already uses
         ("shop.html?cat=38032005"), so both sources behave identically. */
  const list = Array.isArray(p.categoryIds) ? p.categoryIds : [];
  for (const id of list) {
    const ok = usable(id);
    if (ok) return 'shop.html?cat=' + encodeURIComponent(ok);
  }
  const dflt = usable(p.categoryId);
  if (dflt) return 'shop.html?cat=' + encodeURIComponent(dflt);
  return 'shop.html';
}

export function deriveBanners(bannerProducts = [], { bannerCategoryId = null } = {}) {
  const out = [];
  for (const p of bannerProducts) {
    if (!p) continue;
    const title = String(p.title || '').trim();
    const image = p.image || (Array.isArray(p.images) ? p.images[0] : '') || '';
    /* A banner with no artwork or no headline is not a banner. Skipping it
       beats rendering an empty strip on the homepage. */
    if (!title || !image) continue;

    /* The SKU may be a bare slot ("hero") or the prefixed form
       ("banner-hero"). The prefixed form is what identifies a banner when no
       category is used at all — see BANNER_SKU_PREFIX in ecwid-source.mjs,
       and the reason it exists: Ecwid does not report a DISABLED category in a
       product's categoryIds, so a hidden banner category is hidden from us too. */
    let slotRaw = String(p.sku || '').trim().toLowerCase();
    if (slotRaw.startsWith('banner-')) slotRaw = slotRaw.slice('banner-'.length);
    const slot = SLOTS.has(slotRaw) ? slotRaw : 'square';

    out.push({
      id: 'ecwid-' + p.id,
      slot,
      art: ART_FOR_SLOT[slot],
      title,
      sub: String(p.description || '').trim() || undefined,
      href: bannerHref(p, bannerCategoryId),
      image,
      alt: title,
      source: 'ecwid',
    });
  }
  /* hero first, then wide, then square — shop.js deals the first wide banner
     into the single-banner block and the rest into the square row. */
  const rank = { hero: 0, wide: 1, square: 2 };
  return out.sort((a, b) => rank[a.slot] - rank[b.slot]);
}
