/* ============================================================================
   Ecwid <-> SADKO translation. PURE: no network, no database, no clock.

   Every risky decision in this integration lives here, which is why it is the
   one module with no I/O — it is tested exhaustively against a REAL payload
   captured from the store (engine/fixtures/ecwid-product.json).

   Field names below were read off that payload, not inferred. Ecwid has:
     • `isShippingRequired`, not requiresShipping
     • `unlimited` (inverted) for stock tracking, not trackQuantity
     • NO top-level brand — brand is an attribute of type BRAND
     • `defaultCategoryId: 0` to mean "in no category", which must not be
       mistaken for a category whose id is 0
   An earlier pass guessed three of these wrong and produced false zeroes.
   ========================================================================== */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  if (s == null) return '';
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const k = g.toLowerCase();
    return k in NAMED ? NAMED[k] : m;
  });
}

/* Number(null) and Number('') are both 0, which would turn "no price" and
   "no weight" into a real zero. Reject the empty cases before coercing. */
const num = v => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* Titles arrive with entities (&nbsp; is common in the live catalogue) and with
   the non-breaking space that decoding produces. Collapse whitespace so a name
   never renders with a stray gap, but keep the text otherwise untouched. */
const text = v => decodeEntities(v).replace(/\s+/g, ' ').trim();

/* Ecwid's stock model: `unlimited: true` means stock is not tracked at all.
   When it IS tracked, `quantity` is authoritative and `inStock` is Ecwid's own
   derived flag — prefer the flag, fall back to the quantity. */
function stockOf(e) {
  const tracked = e.unlimited === false;
  const qty = tracked ? num(e.quantity) : null;
  let inStock;
  if (typeof e.inStock === 'boolean') inStock = e.inStock;
  else if (!tracked) inStock = true;                 // untracked means always available
  else inStock = (qty ?? 0) > 0;
  return { tracked, quantity: qty, inStock };
}

/* Brand is an attribute. Match Ecwid's built-in BRAND type first, then a name
   that reads as a brand in either language, so a store that used a custom
   attribute still works. */
function brandOf(e) {
  const attrs = Array.isArray(e.attributes) ? e.attributes : [];
  for (const a of attrs) {
    const isBrand = String(a.type || '').toUpperCase() === 'BRAND'
      || /^(brand|manufacturer|ماركة|العلامة التجارية|العلامه التجاريه)$/i.test(String(a.name || '').trim());
    if (isBrand && a.value != null && String(a.value).trim()) return text(a.value);
  }
  return '';
}

/* Main image first, then the gallery, de-duplicated — the live catalogue has
   products carrying the same URL in both places, and up to 7 images. */
function imagesOf(e) {
  const out = [];
  const push = u => {
    const s = u == null ? '' : String(u).trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(e.imageUrl || e.originalImageUrl || e.hdThumbnailUrl || e.thumbnailUrl);
  for (const g of Array.isArray(e.galleryImages) ? e.galleryImages : [])
    push(g.url || g.originalImageUrl || g.hdThumbnailUrl || g.thumbnail);
  return out;
}

export function toSadkoProduct(e) {
  const price = num(e.price);

  /* Discount provenance: a was-price survives ONLY when a staff member
     genuinely set one above the current price. Stale, equal, zero and absent
     values are dropped, so no discount can ever be implied from them. */
  const rawWas = num(e.compareToPrice);
  const compareToPrice = (rawWas != null && price != null && rawWas > price && rawWas > 0) ? rawWas : null;
  const discountPercent = compareToPrice != null
    ? Math.round((compareToPrice - price) / compareToPrice * 100)
    : null;

  /* Ecwid uses 0 for "no category". Treated as null so the taxonomy never
     looks up a category called "0" — 7 enabled products are in this state. */
  const catIds = (Array.isArray(e.categoryIds) ? e.categoryIds : [])
    .filter(id => id != null && String(id) !== '0').map(String);
  const defaultCat = e.defaultCategoryId && String(e.defaultCategoryId) !== '0'
    ? String(e.defaultCategoryId)
    : (catIds[0] ?? null);

  const stock = stockOf(e);
  const images = imagesOf(e);
  const title = text(e.name);

  /* A weight of 0 is Ecwid's "unset", not a product weighing nothing. Keeping
     it as null is what stops the shipping-band logic from treating 1,453
     weightless products as featherweight. */
  const w = num(e.weight);

  return {
    id: String(e.id),
    url: e.url || '',
    title,
    image: images[0] || '',
    images,
    price,
    description: text(e.description),
    categoryId: defaultCat,
    categoryIds: catIds,
    brand: brandOf(e),
    sku: e.sku ? String(e.sku) : '',
    inStock: stock.inStock,
    stockTracked: stock.tracked,
    quantity: stock.quantity,
    compareToPrice,
    discountPercent,
    shippingRequired: e.isShippingRequired !== false,
    weight: w != null && w > 0 ? w : null,
    enabled: e.enabled !== false,

    /* 463 products in the live store are empty shells — no name, no image, no
       category. Flagged here so the sync can keep them out of the storefront
       rather than publishing blank cards. */
    incomplete: !title,
  };
}
