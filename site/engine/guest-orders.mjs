/* ============================================================================
   Orders from someone who has no account.

   WHY THIS EXISTS. Requiring an account to buy a refrigerator loses sales,
   and SADKO already takes orders from people with no account every day — by
   phone, on 19140. This is the same transaction through the website.

   WHERE THE DATA GOES, and this is the design point: a guest order is NEVER
   written to accounts.db. It goes into a short outbox in the Ecwid mirror,
   is pushed to Ecwid immediately, and the payload row is DELETED the moment
   Ecwid accepts it. Ecwid then holds the order and — because it files orders
   under the email address — a customer record for the person, which is what
   staff search when they ring back.

   So in the normal case a guest's name, phone and address live on SADKO's
   own server for a few seconds. If Ecwid is unreachable the row survives and
   retries, because losing a real order is worse than holding it briefly; if
   it exhausts its attempts, it stays and the admin orders desk shows it with
   the customer's phone number so somebody can call them.

   EMAIL IS REQUIRED. Ecwid's customer key is the email address. Without one
   the order arrives as an orphan: no customer record, nothing for staff to
   search, no history. Since pushing the customer's details is the entire
   point, an order with no email would not do the job it is for.

   This module is PURE — validation and shaping only. Nothing here reads a
   database, talks to Ecwid, or decides whether a payment method is real
   (the route does that against the live Ecwid list).
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { validateEmail, validatePhone } from './accounts.mjs';

const MAX_ITEMS = 60;
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/* Validate and normalise what the checkout form posted.

   Returns { ok: true, order } or { ok: false, error } with a stable error
   code the route turns into a bilingual message. */
export function validateGuestOrder(input) {
  const b = input || {};

  const name = s(b.name, 80);
  if (name.length < 2) return { ok: false, error: 'bad-name' };

  const email = s(b.email, 160).toLowerCase();
  if (!validateEmail(email)) return { ok: false, error: 'bad-email' };

  /* validatePhone accepts an EMPTY phone, because it is optional on the
     account form. Here it is not: nobody delivers a refrigerator to an
     address with no number to ring. */
  const phone = s(b.phone, 30);
  if (!phone || !validatePhone(phone)) return { ok: false, error: 'bad-phone' };

  const governorate = s(b.governorate, 60);
  if (!governorate) return { ok: false, error: 'bad-governorate' };

  /* Long enough to be an address somebody can actually find. */
  const address = s(b.address, 300);
  if (address.length < 8) return { ok: false, error: 'bad-address' };

  const payment = s(b.payment, 40);
  if (!payment) return { ok: false, error: 'bad-payment' };

  const raw = Array.isArray(b.items) ? b.items : [];
  if (!raw.length) return { ok: false, error: 'empty-cart' };
  /* Refused rather than truncated: pushing an order that is missing items
     the customer believes they bought is worse than not taking it. */
  if (raw.length > MAX_ITEMS) return { ok: false, error: 'too-many-items' };

  const items = raw.map(i => ({
    id: s(i && i.id, 40),
    title: s(i && i.title, 300),
    /* Bounded, not trusted: the browser sends these and the route re-prices
       against the catalogue before anything is pushed. These limits only
       stop an absurd value from being stored or sent at all. */
    price: Math.max(0, Number(i && i.price) || 0),
    qty: Math.max(1, Math.min(20, Number(i && i.qty) || 1)),
    image: s(i && i.image, 500),
  }));

  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0);

  /* Built field by field, never spread from the input: a browser must not be
     able to add userId, status or a grandTotal to a stored order. */
  return {
    ok: true,
    order: {
      ref: 'SDK-' + randomBytes(3).toString('hex').toUpperCase(),
      guest: true,
      userId: null,
      createdAt: new Date().toISOString(),
      status: 'received',
      items,
      subtotal,
      payment,
      email,
      delivery: {
        name,
        phone,
        governorate,
        address,
        floor: s(b.floor, 20),
        hasLift: !!b.hasLift,
      },
      note: s(b.note, 500),
      /* Absent, not zero — the same refusal the account path makes. Delivery
         and installation depend on the product and the address and are
         confirmed by customer care, and a fabricated 0 would read as free
         delivery on a receipt the customer keeps. */
      totals: { subtotal, deliveryFee: null, installFee: null, grandTotal: null, currency: 'EGP' },
    },
  };
}

/* The `user` argument toEcwidOrder expects.

   For an account order that comes from the accounts database. A guest has no
   record, so it comes off the order itself — and returns null rather than an
   invented address when there is no email, because a fabricated one would
   make Ecwid file the order under a customer who does not exist. */
export function guestUserOf(order) {
  const email = order && order.email ? String(order.email) : '';
  if (!email) return null;
  const d = (order && order.delivery) || {};
  return { email, name: d.name || '', phone: d.phone || '' };
}
