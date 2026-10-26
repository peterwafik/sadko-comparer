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

/* Ecwid descriptions are HTML from its rich-text editor — all 981 in the live
   store carry tags, including img and a. The storefront renders descriptions as
   TEXT (the seed catalogue was plain), so markup is removed rather than
   escaped-and-displayed, which is what produced "<ul><li>…" on every card.

   Block-level boundaries become spaces so words do not run together, and the
   tag strip runs BEFORE entity decoding: decoding first could turn a
   &lt;script&gt; in the copy into a real tag that the stripper then removes,
   silently changing the author's text. Stripping first keeps escaped text
   escaped. */
/* The PDP's rich description. stripHtml flattens; this one KEEPS structure.

   An allow-list of structural tags, with every attribute dropped. No
   attribute allow-list, because none is needed to render a description and
   maintaining one is how sanitisers grow holes: no href, src, style or on*
   handler can survive, so this HTML cannot navigate, execute, or fetch from a
   third party when the page writes it into innerHTML on our own origin.

   Two things are removed WITH their contents rather than unwrapped —
   script and style (plus iframe/object/embed/svg/math, which can carry
   script) — because unwrapping would leave the code sitting in the page as
   text for some later innerHTML to execute.

   Like stripHtml, entities are NOT decoded: "&lt;script&gt;" in the copy is
   text the author typed and must stay text. */
const ALLOWED = new Set(['p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u',
                         'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr',
                         'td', 'th', 'blockquote', 'sup', 'sub', 'span', 'div', 'small']);

/* Void elements must not be given a closing tag. */
const VOID = new Set(['br', 'hr']);

export function safeHtml(html) {
  if (html == null) return '';
  /* Drop the dangerous elements together with everything inside them. An
     unclosed one swallows the rest of the description, which is the safe
     direction to fail. */
  let s = String(html).replace(
    /<\s*(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, '');

  /* Then rewrite every remaining tag: allowed ones keep only their name,
     everything else is unwrapped so the author's words survive. */
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, slash, name) => {
    const tag = name.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    if (VOID.has(tag)) return slash ? '' : '<' + tag + '>';
    return '<' + slash + tag + '>';
  });

  /* Anything left that looks like a tag was not one (a bare "<" in "< 10 لتر")
     or was malformed; comments and doctypes go too. */
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, '');

  return s.replace(/[ \t\r\n]+/g, ' ').replace(/>\s+</g, '><').trim();
}

export function stripHtml(html) {
  if (html == null) return '';
  const withBreaks = String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\s*[^>]*>/gi, ' ')
    .replace(/<\s*li[^>]*>/gi, ' ');
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

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
    description: stripHtml(e.description),
    /* Structure preserved for the product page; flattened above for cards,
       search and skSpecs. Sanitised, never trusted — see safeHtml. */
    descriptionHtml: safeHtml(e.description),
    categoryId: defaultCat,
    categoryIds: catIds,
    brand: brandOf(e),
    sku: e.sku ? String(e.sku) : '',
    /* When staff added it (epoch seconds) — the only honest basis for a "newest" sort. */
    createdAt: num(e.createTimestamp) > 0 ? num(e.createTimestamp) : null,
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

/* ============================ categories ================================= */

/* Arabic script, including the presentation forms. Used to refuse an "English"
   translation that is actually Arabic — see enTranslation(). */
const ARABIC = new RegExp(
  '[\\u0600-\\u06FF' +   // Arabic
  '\\u0750-\\u077F' +    // Arabic Supplement
  '\\u08A0-\\u08FF' +    // Arabic Extended-A
  '\\uFB50-\\uFDFF' +    // Arabic Presentation Forms-A
  '\\uFE70-\\uFEFF]');   // Arabic Presentation Forms-B

/* Ecwid's nameTranslated.en is NOT trustworthy as English. The live SADKO store
   populates it with the ARABIC name, so reading it blindly would print Arabic
   on the English pages — the exact half-translated-title bug that
   mkcategories.mjs asserts against at build time.

   So a translation is accepted only when it contains no Arabic script and
   actually differs from the Arabic name. Anything else returns null, and the
   caller falls back to the site's own curated English names. */
function enTranslation(translated, arabicName) {
  if (!translated || typeof translated !== 'object') return null;
  const raw = translated.en ?? translated.EN ?? translated['en_US'];
  if (raw == null) return null;
  const en = text(raw);
  if (!en) return null;
  if (ARABIC.test(en)) return null;                  // Arabic in the English slot
  if (en === text(arabicName)) return null;          // a copy, not a translation
  return en;
}

export function toSadkoCategory(e) {
  const name = text(e.name);
  return {
    id: String(e.id),
    name,
    /* Only a genuine English translation survives; see enTranslation(). */
    nameEn: enTranslation(e.nameTranslated, e.name),
    /* Ecwid uses 0 for a top-level category; null keeps the taxonomy from
       treating 0 as a real parent id. */
    parentId: e.parentId && String(e.parentId) !== '0' ? String(e.parentId) : null,
    order: num(e.orderBy) ?? 0,
    enabled: e.enabled !== false,
    image: e.imageUrl || e.originalImageUrl || e.thumbnailUrl || '',
    productCount: num(e.productCount) ?? 0,
    url: e.url || '',
    description: stripHtml(e.description),
  };
}


/* ============================================================================
   Orders: SADKO -> Ecwid, and status back again.

   The load-bearing rule: this function never invents a number. When the SERVER
   quoted delivery from Ecwid's own rates (engine/delivery-order.mjs), the order
   carries that fee as its shipping line and the grand total; otherwise it sends
   the items subtotal, leaves shipping UNSET, and says customer care confirms.
   Never add a shippingRate the server did not compute — a number invented in
   this function becomes a promise on a real order.
   ========================================================================== */

export const FEES_NOTE_AR =
  'رسوم التوصيل والتركيب تُؤكَّد من خدمة العملاء قبل التنفيذ.';

/* Once the SERVER has quoted delivery (engine/delivery-order.mjs), only
   installation is left for customer care to confirm. */
export const INSTALL_NOTE_AR = 'رسوم التركيب تُؤكَّد من خدمة العملاء قبل التنفيذ.';

/* The band names staff know from Ecwid's own method titles. Kept here so this
   module stays import-free; engine/size-class.mjs CLASS_LABELS says the same. */
const BAND_AR = { small: 'منتجات صغيرة', medium: 'منتجات متوسطة', large: 'منتجات كبيرة',
                  xl: 'منتجات كبيرة جدا', craft: 'حرف يدوية ومنتجات عضوية' };

/* Every method SADKO offers is an Ecwid MANUAL method: the order records the
   choice and staff follow up. No money is taken online by any of them, so
   nothing is ever pushed as paid. */
export const PAYMENT_STATUS = 'AWAITING_PAYMENT';

/* The three ids the site used before Ecwid. A customer with checkout open from
   before the switch can still post one, and their order must still push. */
const LEGACY_METHODS = {
  cod: 'الدفع عند الاستلام / Cash on delivery',
  bank: 'تحويل بنكى / Bank transfer',
  showroom: 'الدفع فى المعرض / Pay at a showroom',
};

export function toEcwidOrder(order, user = {}, methods = []) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) throw new Error('toEcwidOrder: no items');

  const chosenId = String(order.payment || '');
  const method = (methods || []).find(m => String(m.id) === chosenId) || null;
  const legacy = LEGACY_METHODS[chosenId] || null;
  if (!method && !legacy)
    throw new Error(`toEcwidOrder: unknown payment method "${order.payment}"`);

  const d = order.delivery || {};
  const subtotal = Number(order.subtotal) ||
    items.reduce((n, i) => n + Number(i.price) * Number(i.qty), 0);

  /* Since 2026-09-28 the SERVER can quote delivery from Ecwid's own rates.
     Only a fee it computed is pushed; an unquoted order keeps the old rule —
     shipping absent, never zero. */
  const t = order.totals || {};
  const fee = Number.isFinite(t.deliveryFee) && t.deliveryFee >= 0 && t.methodName ? t.deliveryFee : null;
  const titleOf = id => ((items.find(i => String(i.id) === String(id)) || {}).title || id);
  const feeLines = fee == null ? [] : (t.deliveryLines || []).filter(l => l.fee > 0).map(l =>
    `توصيل ${String(titleOf(l.id)).slice(0, 60)} (${BAND_AR[l.cls] || l.cls}): ${l.fee} جنيه`);

  const lift = d.hasLift ? 'يوجد مصعد' : 'بدون مصعد';
  const comments = [
    `مرجع الطلب: ${order.ref}`,               // also the idempotency key
    fee == null ? FEES_NOTE_AR : INSTALL_NOTE_AR,
    ...(fee == null ? [] : [`رسوم التوصيل: ${fee} جنيه (${t.methodName})`, ...feeLines]),
    d.governorate ? `المحافظة: ${d.governorate}` : null,
    d.floor ? `الطابق: ${d.floor} (${lift})` : lift,
    /* A product-restricted instalment plan. The site cannot verify eligibility
       — the catalogue has no brand field — so it hands staff the fact rather
       than a silent assumption, on the confirmation call they already make. */
    (method && method.restricted)
      ? `تنبيه: طريقة الدفع مقصورة على منتجات ${method.brand || ''}. يُراجع قبل التأكيد.`
      : null,
    order.note ? `ملاحظة العميل: ${order.note}` : null,
  ].filter(Boolean).join('\n');

  return {
    email: user.email || '',
    /* The local ref, for check-then-create idempotency. Also repeated in the
       comments above, so it is findable even if this field is not queryable. */
    externalOrderId: order.ref,
    createdDate: order.createdAt,

    items: items.map(i => ({
      productId: Number(i.id),
      name: i.title,
      price: Number(i.price),
      quantity: Number(i.qty),
      sku: i.sku || undefined,
    })),

    /* Items only. Shipping is deliberately ABSENT, not zero: an explicit 0
       would read as free delivery, which is exactly the claim the customer's
       receipt refuses to make. */
    subtotal,
    total: fee == null ? subtotal : subtotal + fee,
    ...(fee == null ? {} : { shippingOption: { shippingMethodName: t.methodName, shippingRate: fee } }),

    paymentMethod: method ? method.title : legacy,
    paymentStatus: PAYMENT_STATUS,
    fulfillmentStatus: 'AWAITING_PROCESSING',

    shippingPerson: {
      name: d.name || user.name || '',
      phone: d.phone || user.phone || '',
      street: [d.address, d.floor ? `الطابق ${d.floor}` : null].filter(Boolean).join('، '),
      city: d.governorate || '',
      countryCode: 'EG',
    },

    orderComments: comments,
  };
}

/* Ecwid -> the site's own ORDER_STATUSES (engine/accounts.mjs).
   Anything unrecognised returns null and the caller leaves the local status
   alone: inventing a transition would lie to the customer about their order. */
const FULFILMENT = {
  AWAITING_PROCESSING: 'received',
  QUEUED: 'received',
  PROCESSING: 'preparing',
  READY_FOR_PICKUP: 'shipping',
  SHIPPED: 'shipping',
  OUT_FOR_DELIVERY: 'shipping',
  DELIVERED: 'delivered',
  WILL_NOT_DELIVER: 'cancelled',
  RETURNED: 'cancelled',
};
const DEAD_PAYMENT = new Set(['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

export function toLocalStatus(o) {
  if (!o) return null;
  if (DEAD_PAYMENT.has(String(o.paymentStatus || '').toUpperCase())) return 'cancelled';
  return FULFILMENT[String(o.fulfillmentStatus || '').toUpperCase()] || null;
}

/* The site's own ORDER_STATUSES -> Ecwid, for the admin orders desk pushing a
   status UP. Ecwid stays the master for anything staff change THERE; this is
   only so a status changed HERE does not leave the control panel stale.

   WHY THIS IS NOT SIMPLY THE INVERSE OF FULFILMENT. Three Ecwid states collapse
   into `shipping` and two into `cancelled`, so an inverse has to choose one
   canonical name per local status. The choice is not cosmetic: the push makes
   Ecwid fire an order.updated webhook straight back at us, and that echo runs
   through toLocalStatus. Pick a name that maps back to a DIFFERENT status and
   the echo silently overwrites the status the operator just set.

   `confirmed` is therefore ABSENT, not mapped. Its only plausible Ecwid name is
   PROCESSING, which already belongs to `preparing` — so pushing it would come
   back as `preparing` and change the operator's own choice under them. It stays
   a site-only status, and Ecwid simply lags by that one step.

   Returns null for anything not safe to push; the caller pushes nothing. */
const TO_FULFILMENT = {
  received:  'AWAITING_PROCESSING',
  preparing: 'PROCESSING',
  shipping:  'SHIPPED',
  delivered: 'DELIVERED',
  cancelled: 'WILL_NOT_DELIVER',
};

export function toEcwidFulfillment(local) {
  if (typeof local !== 'string') return null;
  return TO_FULFILMENT[local] || null;
}
