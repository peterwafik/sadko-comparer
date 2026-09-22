/* ============================================================================
   Which catalogue does the storefront serve, and what gets filtered out of it.

   PRECEDENCE, and the reasoning behind each step:
     1. flag off               -> the static seed file. Byte-identical to today.
     2. flag on, mirror empty  -> the seed. First boot, or the first sync has
                                  not finished. Never serve nothing.
     3. flag on, mirror has rows -> the mirror, EVEN IF the last sync failed.
                                  Stale real data beats a months-old snapshot,
                                  and the failure is surfaced in admin rather
                                  than silently swapping the catalogue
                                  underneath the customer.

   FILTERING. Three kinds of row never reach the storefront:
     · disabled products — the owner switched them off in Ecwid
     · incomplete shells — 463 rows in the live store have no name, no image
       and no category; publishing them would be blank cards
     · banner entries — they live in a dedicated Ecwid category and are not
       products; a banner must never be purchasable or appear in browse

   Out-of-stock products are NOT filtered. 470 of the 990 visible products
   cannot be bought, and hiding them would understate the range SADKO carries.
   They are ordered last instead.
   ========================================================================== */

/* The slot a banner occupies is carried in its Ecwid SKU, so the owner sets it
   in the same field they already use. Exported so the storefront and the
   banner sync cannot drift on the vocabulary. */
export const BANNER_CATEGORY_SKU = ['hero', 'wide', 'square'];

export function createEcwidSource({ store, seedLoader, enabled, bannerCategoryId = null }) {
  let cache = null;                       // built catalogue, invalidated on write

  /* Which source is live, computed FRESH every time rather than remembered
     from the last catalogue read.

     This was a bug worth keeping a note about: `mode` used to be assigned as a
     side effect inside catalogBase(), so any route that checked it BEFORE the
     first catalogue read saw "seed" and quietly served the static file. The
     rails route did exactly that and shipped July's curated ids while the
     products route was serving Ecwid. A gate must not depend on something else
     having run first. */
  function liveSource() {
    if (!enabled) return 'disabled';
    try { return store.productIds && store.productIds().size ? 'ecwid' : 'seed'; }
    catch (e) { return 'seed'; }
  }

  const banner = bannerCategoryId == null ? null : String(bannerCategoryId);

  function servedCount() {
    if (!enabled) return 0;
    try { return store.allProducts().filter(isServed).length; } catch (e) { return 0; }
  }

  const inBannerCategory = p => banner != null && (
    String(p.categoryId) === banner ||
    (Array.isArray(p.categoryIds) && p.categoryIds.map(String).includes(banner)));

  async function seed() {
    try { return await seedLoader(); } catch (e) { return []; }
  }

  /* One predicate, used by both build() and describe(), so the count the admin
     panel shows can never disagree with what the storefront actually serves. */
  const isServed = p => !!p && p.enabled !== false && !p.incomplete && !inBannerCategory(p);

  function build(rows) {
    const served = rows.filter(isServed);

    /* A stable partition rather than a sort: in-stock rows keep their relative
       order, then out-of-stock rows keep theirs. Array.prototype.sort is stable
       in Node, but partitioning says the intent plainly and cannot be undone by
       a later comparator change.

       NOTE: this is the DEFAULT order only. shop.js offers its own sort
       options (price, name), and those legitimately override it. Guaranteeing
       out-of-stock-last inside every client-side sort is a storefront change,
       not something this layer can impose. */
    const inStock = [], out = [];
    for (const p of served) (p.inStock === false ? out : inStock).push(p);

    return inStock.concat(out);
  }

  return {
    async catalogBase() {
      if (!enabled) return seed();
      if (cache) return cache;

      let rows = [];
      try { rows = store.allProducts(); } catch (e) { rows = []; }

      if (!rows.length) return seed();
      cache = build(rows);
      return cache;
    },

    /* Banner entries, for the promo rail. Deliberately a separate read: they
       are excluded from the catalogue above, so this is the only way to reach
       them, and nothing can accidentally render one as a product. */
    async banners() {
      if (!enabled || banner == null) return [];
      let rows = [];
      try { rows = store.allProducts(); } catch (e) { return []; }
      /* Deliberately does NOT require enabled. Banner entries are kept DISABLED
         in Ecwid so they never appear in Ecwid own storefront — the category
         description tells staff exactly that — so requiring enabled here would
         find nothing, ever. They are still excluded from the catalogue by
         build() above, which filters the banner category outright. */
      return rows.filter(p => p && inBannerCategory(p) && !p.incomplete);
    },

    invalidate() { cache = null; },

    activeSource: () => liveSource(),

    /* Counts and the last error only. There is no code path here that can
       reveal any part of the token. */
    describe() {
      let s = { products: 0, enabled: 0, buyable: 0, categories: 0, outOfStock: 0,
                discounted: 0, incomplete: 0, paymentMethods: 0, shippingMethods: 0,
                lastSync: null, lastError: null };
      try { s = store.stats(); } catch (e) {}
      return {
        enabled: !!enabled,
        source: liveSource(),
        products: s.products,
        categories: s.categories,
        /* Counted fresh. Reading it from a value set during the last
           catalogue build would report 0 to anyone who opened the admin panel
           before the storefront had been hit — the same stale-value trap that
           made the rails route serve July's data. */
        served: servedCount(),
        outOfStock: s.outOfStock,
        buyable: s.buyable,
        incomplete: s.incomplete,
        discounted: s.discounted,
        paymentMethods: s.paymentMethods,
        shippingMethods: s.shippingMethods,
        bannerCategoryId: banner,
        lastSync: s.lastSync,
        lastError: s.lastError,
      };
    },
  };
}
