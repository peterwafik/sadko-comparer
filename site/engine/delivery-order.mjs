/* ============================================================================
   The delivery fee for an order, from the served catalogue — never from the
   browser. Pure apart from LAST_GOOD: the caller hands in the catalogue, the
   category names and the mirrored shipping methods.
   ========================================================================== */
import { sizeClassOf } from './size-class.mjs';
import { rateCard, quoteDelivery } from './ecwid-shipping.mjs';

/* The methods come from the local Ecwid MIRROR, which keeps the last sync
   through an Ecwid outage — so no extra "last good" cache is needed. An empty
   or all-disabled mirror is a real change staff made, and it stops quoting
   (spec §5). A module-level cache here once kept charging old rates after
   staff disabled every method. */
export function cardFrom(methods) {
  return rateCard(methods);
}

export function quoteFor({ items, governorate, catalogue, categoryName, methods }) {
  const byId = new Map((catalogue || []).map(p => [String(p.id), p]));
  const lines = (items || []).map(i => {
    const p = byId.get(String(i.id));
    return { id: String(i.id), qty: Math.max(1, Math.min(20, Number(i.qty) || 1)),
             cls: p ? sizeClassOf(p, categoryName(p.categoryId)).cls : null };
  });
  return quoteDelivery({ lines, governorate, card: cardFrom(methods) });
}

/* The browser shows a fee; the server recomputes it. Any difference — including
   an old tab that never showed one — is a mismatch the customer must confirm. */
export function feeMismatch(quote, quotedFee) {
  const server = quote && quote.quotable ? quote.fee : null;
  const client = quotedFee == null ? null : Number(quotedFee);
  if (server == null) return client != null;
  return client !== server;
}

export function totalsWith(subtotal, quote) {
  const q = quote && quote.quotable ? quote : null;
  return { subtotal, deliveryFee: q ? q.fee : null, installFee: null,
           grandTotal: q ? subtotal + q.fee : null, currency: 'EGP',
           ...(q ? { methodName: q.methodName, deliveryLines: q.lines } : {}) };
}
