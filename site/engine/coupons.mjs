/* ============================================================================
   Discount coupons: Ecwid decides, the site applies.

   The coupons live in Ecwid, where the owner manages them, and Ecwid's own
   POST /order/calculate applies one exactly as its checkout would: status,
   launch and expiry dates, once-per-customer, minimum order, product and
   category limits. So the site never re-implements those rules. It asks
   Ecwid with the re-priced lines and the customer's email, and reads the
   answer. A copy of the rules here would drift, and the copy that drifted
   would hand out a discount the owner had switched off.

   Measured against the test store (2026-10-27): an applied code comes back
   with `discountCoupon` and a positive `couponDiscount` (per line in
   items[].couponAmount); a paused or unknown code comes back with neither.
   Codes match in any letter case.

   Delivery is the site's own fee (engine/delivery-order.mjs), not Ecwid's
   rate, so Ecwid's figure for the shipping part of a coupon is ignored: a
   free-shipping coupon waives exactly the fee the server quoted, and nothing
   when no fee was quoted.

   Pure: the caller does the Ecwid calls.
   ========================================================================== */

/* Ecwid codes are letters and digits (it generates 12), staff may type their
   own with - or _. Anything else is not a code worth sending to Ecwid. */
export function normalizeCode(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase();
  return /^[A-Z0-9_-]{1,40}$/.test(s) ? s : '';
}

/* The body for POST /order/calculate. Prices are the catalogue's (the lines
   are already re-priced); the email is what lets Ecwid enforce
   once-per-customer. */
export function toEcwidCalcOrder(items, code, email) {
  return {
    email: String(email || '').trim().toLowerCase(),
    items: (items || []).map(i => ({ productId: Number(i.id), price: Number(i.price), quantity: Number(i.qty) })),
    discountCoupon: { code },
  };
}

const money = n => Math.round(Number(n) * 100) / 100;

/* Ecwid's calculate answer → { ok, code, name, type, freeShipping,
   itemsDiscount, lines, raw } or { ok: false, reason: 'not-applied' }. */
export function couponFromCalc(calc) {
  const c = calc && calc.discountCoupon;
  if (!c || !c.code) return { ok: false, reason: 'not-applied' };
  const type = String(c.discountType || '');
  const freeShipping = /SHIPPING/.test(type);

  const lines = {};
  let fromLines = 0;
  for (const i of (calc.items || [])) {
    const amt = Number(i && i.couponAmount);
    if (i && i.couponApplied !== false && Number.isFinite(amt) && amt > 0) {
      lines[String(i.productId)] = money(amt);
      fromLines += amt;
    }
  }
  /* The order-level figure includes Ecwid's shipping part for a shipping
     coupon, so it is only a fallback for a goods-only one. */
  const total = Number(calc.couponDiscount) || 0;
  const itemsDiscount = money(fromLines > 0 ? fromLines : (freeShipping ? 0 : Math.max(0, total)));

  if (itemsDiscount <= 0 && !freeShipping) return { ok: false, reason: 'not-applied' };
  return {
    ok: true,
    code: String(c.code).toUpperCase(),
    name: String(c.name || ''),
    type,
    freeShipping,
    itemsDiscount,
    lines,
    /* What Ecwid needs back on the order to show the coupon in the admin the
       way one used at its own checkout does. Only these fields: the order
       is stored and shown to its customer, and the record also carries the
       coupon's limits and usage counts. */
    raw: { name: c.name, code: c.code, discountType: c.discountType, discount: c.discount },
  };
}

/* Why Ecwid did not apply a code, from its coupon record (GET
   /discount_coupons?code=). The calculator gives no reason, and "invalid" for
   a code that just needs a bigger basket would lose the sale. */
export function whyNotApplied(record, subtotal) {
  if (!record) return 'unknown';
  const st = String(record.status || '').toUpperCase();
  if (st === 'EXPIRED') return 'expired';
  if (st === 'USEDUP') return 'used-up';
  if (st && st !== 'ACTIVE') return 'inactive';
  if (Number(record.totalLimit) > 0 && Number(subtotal) < Number(record.totalLimit)) return 'min-subtotal';
  const cl = record.catalogLimit;
  if (cl && ((cl.products || []).length || (cl.categories || []).length)) return 'not-these-items';
  return 'not-applicable';
}

/* Totals from engine/delivery-order.mjs totalsWith, with the coupon taken
   off. The delivery fee stays as quoted and the coupon is its own line, which
   is also how Ecwid records a free-shipping coupon. */
export function applyCoupon(totals, coupon) {
  if (!coupon || !coupon.ok) return totals;
  const t = { ...totals };
  const goods = Math.min(Number(coupon.itemsDiscount) || 0, Number(t.subtotal) || 0);
  const shipping = coupon.freeShipping && Number.isFinite(t.deliveryFee) ? t.deliveryFee : 0;
  t.discount = money(goods + shipping);
  t.itemsDiscount = money(goods);
  t.shippingDiscount = money(shipping);
  t.coupon = { code: coupon.code, name: coupon.name, type: coupon.type, freeShipping: !!coupon.freeShipping };
  if (t.grandTotal != null) t.grandTotal = money(t.subtotal + t.deliveryFee - t.discount);
  return t;
}

/* The browser sends the discount it showed; any difference goes back to the
   customer, as a changed delivery fee does. */
export function couponMismatch(serverDiscount, quotedDiscount) {
  const s = Number(serverDiscount) || 0;
  if (quotedDiscount === undefined || quotedDiscount === null) return s !== 0;
  return Number(quotedDiscount) !== s;
}
