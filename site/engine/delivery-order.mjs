/* ============================================================================
   The delivery fee for an order, from the served catalogue — never from the
   browser. Pure apart from LAST_GOOD: the caller hands in the catalogue, the
   category names and the mirrored shipping methods.
   ========================================================================== */
import { sizeClassOf } from './size-class.mjs';
import { rateCard, quoteDelivery } from './ecwid-shipping.mjs';

/* The last card that actually priced something, so an Ecwid outage (or a sync
   that briefly returns nothing) does not stop checkout from quoting. */
let LAST_GOOD = null;

export function cardFrom(methods) {
  const c = rateCard(methods);
  if (c && (Object.keys(c.metro).length || Object.keys(c.delta).length || Object.keys(c.upper).length)) LAST_GOOD = c;
  return LAST_GOOD;
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
