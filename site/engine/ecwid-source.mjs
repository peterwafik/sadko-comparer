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

   IN MEMORY, PER INSTANCE. The mirror is async now (libSQL, often Turso over
   the network), but the request code that builds pages reads this module
   synchronously. So every read accessor works over a SNAPSHOT of products,
   categories and the ad-folder state, and `await refresh()` keeps it current:
   it reads the store's catalogue version (one row, at most once per
   maxAgeMs) and reloads the snapshot only when that number moved. Before the
   first refresh the snapshot is empty, which reads exactly like an empty
   mirror did: the seed is served. catalogBase() and banners() refresh on
   their own; call refresh() at the top of a request before the sync ones.
   ========================================================================== */
import { adSlotOf, isAd, adDestination, liveDestination } from './ecwid-ads.mjs';

/* The slot a banner occupies is carried in its Ecwid SKU, so the owner sets it
   in the same field they already use. Exported so the storefront and the
   banner sync cannot drift on the vocabulary. */
export const BANNER_CATEGORY_SKU = ['hero', 'wide', 'square'];

/* A banner can also be identified by its SKU alone: "banner-hero",
   "banner-wide", "banner-square". This exists because Ecwid does NOT report a
   DISABLED category in a product's categoryIds — verified against the live
   store — so a banner category that is hidden from shoppers is also hidden
   from us. The SKU needs no category at all, so nothing extra can appear in
   Ecwid's own storefront menu. */
export const BANNER_SKU_PREFIX = 'banner-';

/* The slot a banner occupies: from its SKU when the SKU carries one, else from
   a bare slot word, else square. */
export function bannerSlotOf(product) {
  const sku = String((product && product.sku) || '').trim().toLowerCase();
  const tail = sku.startsWith(BANNER_SKU_PREFIX) ? sku.slice(BANNER_SKU_PREFIX.length) : sku;
  return BANNER_CATEGORY_SKU.includes(tail) ? tail : 'square';
}

export function createEcwidSource({ store, seedLoader, enabled, bannerCategoryId = null,
                                    adSlotMap = null }) {
  /* A GETTER, not a value. The map is rebuilt by every sync, and a value
     captured at construction would pin the storefront to whatever the folders
     held when the process started — the same stale-value trap that made
     activeSource() serve July's catalogue. */
  const slotMap = () => {
    try { return (typeof adSlotMap === 'function' ? adSlotMap() : adSlotMap) || {}; }
    catch (e) { return {}; }
  };
  let cache = null;                       // built catalogue, invalidated on write
  let world = null;                       // advert destinations, ditto

  /* The snapshot. `loaded` is false until the first successful read, and the
     empty arrays make every accessor behave as an empty mirror until then. */
  const EMPTY_META = { lastSync: null, lastError: null, paymentMethods: 0, shippingMethods: 0 };
  let snap = { loaded: false, version: null, products: [], categories: [], ad: null };
  let meta = { ...EMPTY_META };
  let checkedAt = 0;                      // when the version was last read
  let stale = false;                      // invalidate() asked for a reload
  let inflight = null;                    // the one refresh in progress, shared

  /* Re-read the version, and the catalogue only if it changed. Safe to call on
     every request and from many requests at once: concurrent callers share
     one in-flight read, and within maxAgeMs of the last check it costs
     nothing. A failed read keeps the last good snapshot (never an empty
     one) and resolves false; it never rejects. Resolves true when the
     snapshot was reloaded. */
  function refresh({ maxAgeMs = 5000 } = {}) {
    if (!enabled) return Promise.resolve(false);
    /* Join the read in progress. If invalidate() came after it started, it
       may have read the old rows, so run once more when it finishes. */
    if (inflight) return stale ? inflight.then(() => refresh({ maxAgeMs })) : inflight;
    if (!stale && checkedAt && Date.now() - checkedAt < maxAgeMs) return Promise.resolve(false);
    const run = (async () => {
      try {
        const m = typeof store.catalogMeta === 'function'
          ? await store.catalogMeta()
          : { version: await store.catalogVersion() };
        meta = {
          lastSync: m.lastSync ?? null, lastError: m.lastError ?? null,
          paymentMethods: Number(m.paymentMethods) || 0, shippingMethods: Number(m.shippingMethods) || 0,
        };
        if (snap.loaded && !stale && m.version === snap.version) return false;
        stale = false;                    // set again by an invalidate() during the read
        /* The version is read BEFORE the rows, so the rows are at least as new
           as the version recorded; a write landing in between just makes the
           next check reload once more. */
        const [products, categories, ad] = await Promise.all([
          store.allProducts(), store.allCategories(),
          typeof store.getState === 'function' ? store.getState('ad_folders') : null,
        ]);
        snap = { loaded: true, version: m.version, products: products || [], categories: categories || [], ad: ad ?? null };
        cache = null; world = null;
        return true;
      } catch (e) {
        return false;
      } finally {
        checkedAt = Date.now();
      }
    })();
    inflight = run;
    run.finally(() => { if (inflight === run) inflight = null; });
    return run;
  }

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
    return snap.products.length ? 'ecwid' : 'seed';
  }

  const banner = bannerCategoryId == null ? null : String(bannerCategoryId);

  function servedCount() {
    if (!enabled) return 0;
    try { return snap.products.filter(isServed).length; } catch (e) { return 0; }
  }

  const inBannerCategory = p => banner != null && (
    String(p.categoryId) === banner ||
    (Array.isArray(p.categoryIds) && p.categoryIds.map(String).includes(banner)));

  /* The SKU signal. Independent of category visibility, which is the whole
     point — see BANNER_SKU_PREFIX. */
  const hasBannerSku = p =>
    String((p && p.sku) || '').trim().toLowerCase().startsWith(BANNER_SKU_PREFIX);

  /* ANY signal makes something a banner, so the three ways of marking one all
     work and can be mixed during a changeover:
       · membership of an ad FOLDER (the product->slot map from the sync)
       · the banner- SKU convention
       · membership of the legacy single banner category
     None is load-bearing alone. */
  const isBanner = p => !!p && (isAd(p, slotMap(), banner) || inBannerCategory(p) || hasBannerSku(p));

  async function seed() {
    try { return await seedLoader(); } catch (e) { return []; }
  }

  /* A product with no usable price is not an offer.

     This exists because of a near miss. An advert lost its ad-folder
     assignment in the Ecwid panel — the folder is what marks it an advert —
     and instantly stopped being caught by isBanner(). It is an enabled
     product with a name and a price of 0.00, so it would have been served as
     a purchasable appliance costing nothing.

     Excluding an unpriced product is the right guard regardless of adverts,
     and it is consistent with the rule the rest of this site already follows:
     never show a figure that is not a real one. A 0.00 EGP appliance is not a
     real one, and the store cannot take payment for it either way. It changes
     nothing about today's catalogue — all 990 served products carry a real
     price — which is exactly why it is safe to add. */
  const priced = p => {
    const v = Number(p && p.price);
    return Number.isFinite(v) && v > 0;
  };

  /* One predicate, used by both build() and describe(), so the count the admin
     panel shows can never disagree with what the storefront actually serves. */
  const isServed = p => !!p && p.enabled !== false && !p.incomplete && !isBanner(p) && priced(p);

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

    return inStock.concat(out).map(listShape);
  }

  /* The LIST shape. descriptionHtml is dropped here, and only here: it exists
     for the product page, which renders one product, while this list ships to
     every page of the site through /data/products.json — already 1.74 MB for
     990 products. Carrying the rich copy in it would add about another
     megabyte to every page load for something one page reads. productDetail()
     below is how the PDP gets it. */
  function listShape(p) {
    if (!p || p.descriptionHtml == null) return p;
    const { descriptionHtml, ...rest } = p;
    return rest;
  }

  /* What the adverts are allowed to point AT.

     adDestination validates the shape of the SKU the owner typed; this says
     whether the thing it names is really there. Square advert 3 pointed at
     product:837495061, a product that had been removed from the store, so
     the advert linked to a 404 — the same dead end as a `cat:` SKU whose
     category has since been deleted.

     Scoped to what the storefront SERVES, deliberately: a disabled or
     unpriced product 404s on the product page exactly like a missing one,
     so linking to it would be just as broken.

     Built lazily and dropped by invalidate() alongside the catalogue, because
     an advert rail asks this once per advert and must not re-read the mirror
     each time. An empty read yields NO lookups rather than an empty world —
     a failed query must not silently strip every destination on the site. */
  function adWorld() {
    if (world) return world;
    const ids = new Set(), cats = new Set();
    try { for (const p of snap.products) if (isServed(p)) ids.add(String(p.id)); } catch (e) {}
    try { for (const c of snap.categories) cats.add(String(c.id)); } catch (e) {}
    world = {};
    if (ids.size) world.hasProduct = id => ids.has(String(id));
    if (cats.size) world.hasCategory = id => cats.has(String(id));
    return world;
  }

  return {
    async catalogBase() {
      if (!enabled) return seed();
      await refresh();
      if (cache) return cache;

      const rows = snap.products;

      if (!rows.length) return seed();
      cache = build(rows);
      return cache;
    },

    /* ONE product, in full — the shape the product page needs, including the
       rich description the list deliberately omits.

       Scoped to what the storefront actually SERVES. A disabled product, an
       incomplete shell or a banner entry must not become reachable just
       because someone guessed its id: the PDP would render an advert as a
       product, or offer something Ecwid has withdrawn. Returns null instead,
       and the page shows its "not found" state. */
    productDetail(id) {
      if (!enabled || id == null) return null;
      const rows = snap.products;
      const want = String(id);
      const hit = rows.find(p => p && String(p.id) === want);
      return hit && isServed(hit) ? hit : null;
    },

    /* Banner entries, for the promo rail. Deliberately a separate read: they
       are excluded from the catalogue above, so this is the only way to reach
       them, and nothing can accidentally render one as a product. */
    async banners() {
      /* No category needed: the SKU convention works on its own. */
      if (!enabled) return [];
      await refresh();
      const rows = snap.products;
      /* Deliberately does NOT require enabled. Banner entries are kept DISABLED
         in Ecwid so they never appear in Ecwid own storefront — the category
         description tells staff exactly that — so requiring enabled here would
         find nothing, ever. They are still excluded from the catalogue by
         build() above, which filters the banner category outright. */
      return rows.filter(p => isBanner(p) && !p.incomplete);
    },

    /* The slot one product occupies, folder first then SKU. Handed to
       deriveBanners so the folder decides the slot rather than the SKU. */
    adSlotOf: p => adSlotOf(p, slotMap()),

    /* Where the owner pointed this ad, from its SKU — validated against the
       allow-list in ecwid-ads.mjs, so nothing arbitrary reaches an href. Null
       when the SKU is empty or is not a destination, and the category
       fallback then applies. */
    adDestinationOf: p => liveDestination(adDestination(p && p.sku), adWorld()),

    /* Drop what was built AND force the next refresh() to reload, whatever
       the version says. Call it after a sync or webhook in this instance;
       other instances see the version move instead. */
    invalidate() { cache = null; world = null; stale = true; checkedAt = 0; },

    refresh,

    /* The version the snapshot was loaded at (null before the first load). */
    snapshotVersion: () => snap.version,

    /* The stored ad-folder state from the snapshot, for
       ecwidSync().adFolderState(stored). undefined before the first load, so
       the sync falls back to its own copy. */
    storedAdFolders: () => (snap.loaded ? snap.ad : undefined),

    /* Categories from the snapshot. */
    categories: () => snap.categories,

    activeSource: () => liveSource(),

    /* Counts and the last error only. There is no code path here that can
       reveal any part of the token. */
    describe() {
      /* Counted over the snapshot with the same rules stats() uses in SQL,
         so it stays synchronous; the status values come from the last
         version check. */
      const rows = snap.products;
      const on = p => p && p.enabled === true;
      const s = {
        products: rows.length,
        categories: snap.categories.length,
        outOfStock: rows.filter(p => on(p) && p.inStock === false).length,
        buyable: rows.filter(p => on(p) && p.inStock === true).length,
        incomplete: rows.filter(p => p && p.incomplete === true).length,
        discounted: rows.filter(p => p && p.compareToPrice != null).length,
        ...meta,
      };
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
