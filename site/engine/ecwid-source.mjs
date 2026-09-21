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
  let mode = enabled ? 'seed' : 'disabled';
  let cache = null;                       // built catalogue, invalidated on write
  let lastCounts = { served: 0, outOfStock: 0 };

  const banner = bannerCategoryId == null ? null : String(bannerCategoryId);

  const inBannerCategory = p => banner != null && (
    String(p.categoryId) === banner ||
    (Array.isArray(p.categoryIds) && p.categoryIds.map(String).includes(banner)));

  async function seed() {
    try { return await seedLoader(); } catch (e) { return []; }
  }

  function build(rows) {
    const served = rows.filter(p =>
      p && p.enabled !== false && !p.incomplete && !inBannerCategory(p));

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

    lastCounts = { served: served.length, outOfStock: out.length };
    return inStock.concat(out);
  }

  return {
    async catalogBase() {
      if (!enabled) { mode = 'disabled'; return seed(); }
      if (cache) return cache;

      let rows = [];
      try { rows = store.allProducts(); } catch (e) { rows = []; }

      if (!rows.length) { mode = 'seed'; return seed(); }
      mode = 'ecwid';
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
      return rows.filter(p => p && inBannerCategory(p) && p.enabled !== false && !p.incomplete);
    },

    invalidate() { cache = null; },

    activeSource: () => mode,

    /* Counts and the last error only. There is no code path here that can
       reveal any part of the token. */
    describe() {
      let s = { products: 0, enabled: 0, buyable: 0, categories: 0, outOfStock: 0,
                discounted: 0, incomplete: 0, paymentMethods: 0, shippingMethods: 0,
                lastSync: null, lastError: null };
      try { s = store.stats(); } catch (e) {}
      return {
        enabled: !!enabled,
        source: mode,
        products: s.products,
        categories: s.categories,
        served: lastCounts.served,
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
