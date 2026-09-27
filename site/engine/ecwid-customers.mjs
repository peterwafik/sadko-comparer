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
/* A saved home, as one Ecwid shipping address.

   A home is NOT a postal address. PROFILE_KEYS holds governorate, area, floor
   and hasLift plus appliance-fitting data (slot widths, cooker fuel) and has no
   street line at all — the only street the site holds is user.address, which
   checkout itself falls back to. So homes cannot become distinct addresses;
   they become entries that SHARE a street and differ by governorate and access.
   Each is named after the home so staff can tell them apart, and the floor
   rides in the street line exactly as toEcwidOrder already writes it, because
   that is the line a delivery driver reads.

   Returns null when there is nothing to deliver to: an address with neither a
   street nor a governorate helps nobody and would only clutter the record. */
function homeToAddress(home, user, isActive) {
  if (!home) return null;
  const street = String(user.address || "").trim();
  const gov = String(home.governorate || "").trim();
  if (!street && !gov) return null;
  const floor = String(home.floor || "").trim();
  const lift = home.hasLift ? "يوجد مصعد" : "بدون مصعد";
  const out = {
    name: String(home.name || user.name || "").trim() || undefined,
    phone: String(user.phone || "").trim() || undefined,
    street: [street, floor ? `الطابق ${floor}` : null, floor ? lift : null]
      .filter(Boolean).join(" — ") || undefined,
    city: gov || undefined,
    countryCode: "EG",
    /* Ecwid keeps its own address ids and orderBy and IGNORES the order of the
       array we send, so position is not a signal to it — found the hard way in
       live testing, where switching the active home changed nothing in the
       control panel and staff kept seeing the old default. Always explicit, so
       switching back actually CLEARS the previous default rather than leaving
       two addresses both claiming it. */
    defaultAddress: !!isActive,
  };
  return JSON.parse(JSON.stringify(out));
}

/* The homes, active first. Checkout uses the active one, so a human scanning
   the customer in Ecwid should see that address at the top rather than hunting
   for which of three it will be. */
function homesToAddresses(user) {
  const homes = Array.isArray(user.homes) ? user.homes : [];
  if (!homes.length) return undefined;
  const ordered = user.activeHomeId
    ? [...homes].sort((a, b) => (b.id === user.activeHomeId) - (a.id === user.activeHomeId))
    : homes;
  /* Only a home the site genuinely holds as active is the default. With none
     set, the first still leads — that is what checkout falls back to — but we
     do not assert a default the site does not actually have. */
  const out = ordered.map(h => homeToAddress(h, user, !!user.activeHomeId && h.id === user.activeHomeId))
    .filter(Boolean);
  return out.length ? out : undefined;
}

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
    /* Absent, never [] — an explicit empty array would CLEAR addresses Ecwid
       captured from a real order. */
    shippingAddresses: homesToAddresses(user),
  };
  /* Drop the undefined keys rather than sending them: an explicit null can
     CLEAR a field staff filled in by hand in Ecwid. */
  return JSON.parse(JSON.stringify(out));
}

/* Should we write to Ecwid at all, and is it safe to?

   THE PROBLEM THIS SOLVES. The first rule here only ever filled a field Ecwid
   was MISSING, on the reasoning that staff are closer to the customer than our
   registration form. That is right about staff and wrong about the customer: a
   user who corrected their own phone in their account never reached Ecwid,
   because Ecwid already had the old one and "already has a value" meant "leave
   it".

   THE DISCRIMINATOR IS OUR OWN LAST PUSH. `pushed` is the payload we last sent
   for this customer:

     · a desired value that differs from `pushed`  -> the USER changed it here,
       so it must propagate;
     · a remote value that differs from `pushed`   -> STAFF changed it there,
       and we leave it alone;
     · Ecwid missing a value we hold               -> fill it, as before.

   With no snapshot (the first push, or a customer linked before this existed)
   it degrades exactly to the old conservative rule: fill what is missing, touch
   nothing else. That is deliberate — without a snapshot we genuinely cannot
   tell a staff edit from a stale one, and guessing wrong overwrites a human. */

const FIELDS = ["name", "billingPerson", "shippingAddresses"];

const valueOf = (o, field) => {
  if (!o) return undefined;
  if (field === "name") {
    const v = pick(o, "name");
    return v == null ? undefined : String(v).trim() || undefined;
  }
  const v = o[field];
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.length ? v : undefined;
  return Object.keys(v).length ? v : undefined;
};

/* Compared as JSON so a nested address list is one value, not a tree walk.
   Key order is stable because every payload is built by the same mapper. */
const same = (x, y) => JSON.stringify(x === undefined ? null : x) ===
                       JSON.stringify(y === undefined ? null : y);

/* The fields to actually WRITE, and only those.

   A boolean was the wrong answer here. It made the caller send one hardcoded
   field (`{ name: desired.name }`) because sending the whole payload would
   clobber every OTHER field staff had corrected. A patch removes that bind: the
   caller writes exactly what changed, so filling a missing phone can never
   overwrite a corrected name in the same request.

   Returns {} when there is nothing to do. */
export function customerUpdatePatch(remote, desired, pushed = null) {
  const patch = {};
  if (!remote || !desired) return patch;
  for (const field of FIELDS) {
    const want = valueOf(desired, field);
    if (want === undefined) continue;                 // we hold nothing to send
    const have = valueOf(remote, field);
    if (have === undefined) { patch[field] = want; continue; }   // missing: fill
    if (!pushed) continue;                            // no snapshot: leave it
    /* The user changed it here since our last push. A staff edit shows up as
       remote != pushed while want == last, and falls through untouched. */
    if (!same(want, valueOf(pushed, field))) patch[field] = want;
  }
  return patch;
}

export function customerNeedsUpdate(remote, desired, pushed = null) {
  return Object.keys(customerUpdatePatch(remote, desired, pushed)).length > 0;
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
