/* ============================================================================
   Accounts, and the one thing that cannot move to Ecwid.

   THE HONEST LIMIT, STATED FIRST. Ecwid has no API for verifying a customer's
   password. /customers lets an app read, create and update customer records,
   but nothing there authenticates one — Ecwid's own customer sign-in happens
   inside Ecwid's storefront, and its SSO runs the other way round: the
   merchant's site is the identity provider and signs a token FOR Ecwid.

   So "log in with Ecwid" is not something this site can implement, and no
   amount of work here would change that. The site keeps its own server-side
   accounts (engine/accounts.mjs — scrypt, HttpOnly sessions) and the two are
   LINKED BY EMAIL, which is the same key Ecwid itself uses to attach an order
   to a customer.

   WHAT THAT LINK IS ACTUALLY WORTH, and it is not a formality:

   1. Staff see the person. An order pushed from the site carries the
      customer's email, so Ecwid files it against that customer record and the
      existing staff workflow — search the customer, see their history — keeps
      working for site orders too.

   2. The customer sees everything. SADKO sells by phone and in showrooms, and
      those orders are typed into Ecwid by staff. Without this, the site's "my
      orders" page shows only what was ordered on the site, so a customer who
      rang 19140 sees nothing and assumes the order was lost. mergeOrders()
      below puts both in one list, labelled by origin.

   This module is pure. The API calls live in ecwid-api.mjs and the
   orchestration in ecwid-sync.mjs, so the mapping is testable without a
   store.

   UNVERIFIED AGAINST THE LIVE API. The test store's token is a `public_`
   token, so /customers and /orders both answer 403 and none of these shapes
   could be confirmed against a real payload. This project has already been
   bitten four times by guessed Ecwid field names (trackQuantity vs unlimited,
   requiresShipping vs isShippingRequired, a top-level brand that is really an
   attribute, and /orders/calculate vs /order/calculate), so every reader here
   accepts the plausible spellings rather than betting on one, and
   tools/ecwid-preflight.mjs exists to check the real shapes in one command
   once a secret token is in place.
   ========================================================================== */

import { toLocalStatus } from './ecwid-map.mjs';

/* Pick the first present value among several possible field names. This is
   the defensive habit the four earlier mistakes argue for: it costs nothing
   and it turns "wrong guess" into "still works". */
const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = o == null ? undefined : o[k];
    if (v != null && v !== '') return v;
  }
  return null;
};

/* ------------------------------ customers ------------------------------- */

/* A site account, as an Ecwid customer record. Only what SADKO actually
   holds: no invented fields, and no password — Ecwid never sees one, and it
   could not check it if it did. */
export function toEcwidCustomer(user) {
  if (!user || !user.email) return null;
  const name = String(user.name || '').trim();
  const phone = String(user.phone || '').trim();
  const out = {
    email: String(user.email).trim().toLowerCase(),
    /* Ecwid stores the display name on the customer and the contact details
       on the billing person. */
    name: name || undefined,
    billingPerson: (name || phone || user.address) ? {
      name: name || undefined,
      phone: phone || undefined,
      street: user.address ? String(user.address).slice(0, 300) : undefined,
      city: user.profile && user.profile.governorate ? String(user.profile.governorate) : undefined,
      countryCode: 'EG',
    } : undefined,
  };
  /* Drop the undefined keys rather than sending them: an explicit null can
     CLEAR a field staff filled in by hand in Ecwid. */
  return JSON.parse(JSON.stringify(out));
}

/* Does the remote record already say what we would send? Used to skip a
   pointless write — and, more importantly, to avoid overwriting details staff
   corrected in Ecwid with staler ones from the site. */
export function customerNeedsUpdate(remote, desired) {
  if (!remote || !desired) return false;
  const rName = String(pick(remote, 'name') || '').trim();
  const dName = String(desired.name || '').trim();
  /* Only ever ADD what Ecwid is missing. A difference where Ecwid already has
     a value is left alone: staff are closer to the customer than our form is. */
  return !!dName && !rName;
}

/* ------------------------------- orders --------------------------------- */

/* An Ecwid order, in the shape the account page already renders.

   `origin` is the point of it: 'site' for an order this site pushed (it
   carries our SDK- reference), 'ecwid' for one staff created directly —
   a phone order, a showroom sale — which the customer could not see at all
   before. The UI labels them, because "where did this come from" is exactly
   what a customer asks when a list surprises them. */
export function fromEcwidOrder(remote) {
  if (!remote) return null;
  const ref = String(pick(remote, 'externalOrderId', 'externalFulfillmentOrderId') || '').trim();
  const ours = /^SDK-/i.test(ref);
  const items = (Array.isArray(remote.items) ? remote.items : []).map(i => ({
    id: String(pick(i, 'productId', 'id') || ''),
    title: String(pick(i, 'name', 'productName') || '').slice(0, 300),
    price: Number(pick(i, 'price') || 0) || 0,
    qty: Math.max(1, Number(pick(i, 'quantity', 'qty') || 1) || 1),
    image: String(pick(i, 'imageUrl', 'smallThumbnailUrl') || '').slice(0, 500),
  }));

  /* The subtotal Ecwid reports, NOT recomputed from the lines: staff may have
     applied a discount or a manual adjustment, and our arithmetic would then
     contradict the order the customer actually agreed to. */
  const subtotal = Number(pick(remote, 'subtotal')) || items.reduce((n, i) => n + i.price * i.qty, 0);
  const total = Number(pick(remote, 'total'));

  const d = remote.shippingPerson || remote.billingPerson || {};

  return {
    /* An Ecwid-origin order has no SDK- ref, so its own number is used. It is
       prefixed so it can never collide with one of ours, and so staff and
       customer are talking about the same string on the phone. */
    ref: ours ? ref : 'ECWID-' + String(pick(remote, 'id', 'orderNumber', 'vendorOrderNumber') || '?'),
    origin: ours ? 'site' : 'ecwid',
    createdAt: pick(remote, 'createDate', 'createdDate', 'updateDate') || null,
    status: toLocalStatus(remote) || 'received',
    items,
    subtotal,
    /* Only when Ecwid genuinely holds a total ABOVE the goods — that means
       staff entered the delivery charge, which is the one case where a real
       grand total exists. Otherwise absent, never zero. */
    total: Number.isFinite(total) && total > 0 ? total : null,
    delivery: {
      name: String(pick(d, 'name') || '').slice(0, 80),
      phone: String(pick(d, 'phone') || '').slice(0, 30),
      governorate: String(pick(d, 'stateOrProvinceName', 'city') || '').slice(0, 60),
      address: String(pick(d, 'street') || '').slice(0, 300),
    },
    payment: String(pick(remote, 'paymentMethod') || '').slice(0, 120),
    /* Staff notes are for staff. privateAdminNotes is deliberately NOT read:
       it is where staff write things about the customer, not to them. */
    note: String(pick(remote, 'orderComments') || '').slice(0, 500),
  };
}

/* One list, from both places.

   The dedupe key is our own reference, which toEcwidOrder writes into
   externalOrderId on the way out — so an order placed on the site and then
   mirrored back does NOT appear twice.

   Where an order exists in both, the LOCAL record wins on identity and
   contents (it is what the customer was shown and what their receipt says)
   while the remote contributes the status, because Ecwid is where staff move
   an order along. That is the same precedence the order webhook already uses. */
export function mergeOrders(local = [], remote = []) {
  const out = [];
  const byRef = new Map();

  for (const o of local) {
    if (!o || !o.ref) continue;
    const copy = { ...o, origin: 'site' };
    byRef.set(String(o.ref).toUpperCase(), copy);
    out.push(copy);
  }

  for (const r of remote) {
    if (!r) continue;
    const mapped = r.origin ? r : fromEcwidOrder(r);
    if (!mapped) continue;
    const key = String(mapped.ref).toUpperCase();
    const hit = byRef.get(key);
    if (hit) {
      /* Already ours. Take only the status, and only when Ecwid actually has
         one to give. */
      if (mapped.status && mapped.status !== hit.status) hit.status = mapped.status;
      hit.inEcwid = true;
      continue;
    }
    out.push(mapped);
  }

  /* Newest first, and an order with no date sorts last rather than throwing
     the whole list into an arbitrary order. */
  return out.sort((a, b) => {
    const ta = Date.parse(a.createdAt || '') || 0;
    const tb = Date.parse(b.createdAt || '') || 0;
    return tb - ta;
  });
}
