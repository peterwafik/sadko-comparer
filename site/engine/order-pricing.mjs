/* ============================================================================
   What an order's lines actually cost.

   The browser sends a price for every line, and for a while both order paths
   simply believed it. That is wrong in the same way on both: a customer could
   post an order for a refrigerator at any figure they liked, and it would be
   stored, shown on their own receipt, and pushed into the owner's Ecwid store
   as the agreed price.

   It was caught on the guest path first, because a public endpoint with no
   session makes the problem obvious. The signed-in path had exactly the same
   hole — a session proves who someone is, not that their arithmetic is
   honest.

   So the catalogue is the authority for price, and this is the one place that
   says so. Both routes call it, deliberately: a second copy would drift, and
   the copy that drifted would be the one nobody was testing.

   A line whose product is NOT in the served catalogue is refused rather than
   re-priced. The served catalogue already excludes anything disabled,
   unpriced or deleted — so a missing product is not a pricing question, it is
   something that is not for sale.

   Pure: the caller loads the catalogue.
   ========================================================================== */

/* items: the lines as posted. catalogue: the served product list.
   Returns { ok: true, items, subtotal } with prices and titles taken from the
   catalogue, or { ok: false, error: 'item-unavailable' | 'insufficient-stock', id }. */
export function repriceLines(items, catalogue) {
  const lines = Array.isArray(items) ? items : [];
  if (!lines.length) return { ok: false, error: 'empty-cart', id: null };

  const byId = catalogue instanceof Map
    ? catalogue
    : new Map((Array.isArray(catalogue) ? catalogue : []).map(p => [String(p && p.id), p]));

  const out = [];
  for (const it of lines) {
    const id = String((it && it.id) != null ? it.id : '');
    const p = byId.get(id);
    if (!p) return { ok: false, error: 'item-unavailable', id };

    const price = Number(p.price);
    /* The catalogue is meant to exclude unpriced products, but a zero here
       would silently become a free refrigerator, so it is refused rather
       than trusted. */
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'item-unavailable', id };

    const qty = Math.max(1, Math.min(20, Number(it && it.qty) || 1));
    /* Stock is only a limit when Ecwid is TRACKING it. An untracked product's
       "quantity" is not a stock figure (see ecwid-map.mjs), so it never caps. */
    if (p.stockTracked === true && Number.isFinite(Number(p.quantity)) && qty > Number(p.quantity))
      return { ok: false, error: 'insufficient-stock', id, available: Math.max(0, Number(p.quantity)) };

    out.push({
      id,
      /* Title from the catalogue too: it is what the customer's receipt and
         the Ecwid order line will say, and a browser-supplied title could
         name a different appliance than the one being charged for. */
      title: String(p.title || (it && it.title) || '').slice(0, 300),
      price,
      /* Quantity IS the customer's to choose — bounded, not replaced. */
      qty,
      image: String((p.image || (it && it.image)) || '').slice(0, 500),
    });
  }

  return { ok: true, items: out, subtotal: out.reduce((n, i) => n + i.price * i.qty, 0) };
}
