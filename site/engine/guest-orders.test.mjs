// site/engine/guest-orders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGuestOrder, guestUserOf, guestCustomerOf } from './guest-orders.mjs';

const GOOD = {
  name: 'نور حسن',
  email: 'Nour@Example.com',
  phone: '01012345678',
  governorate: 'القاهرة',
  address: '12 شارع مصر والسودان، روكسى',
  floor: '4',
  hasLift: true,
  note: 'اتصل قبل الوصول',
  payment: '6798-1567006926352',
  items: [{ id: '865565594', title: 'ثلاجة توشيبا 470 لتر', price: 38999, qty: 1, image: 'i.webp' }],
};

/* ------------------------------ acceptance ------------------------------ */

test('a complete guest order is accepted and normalised', () => {
  const r = validateGuestOrder(GOOD);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.order.email, 'nour@example.com', 'email is lowercased, as Ecwid files it');
  assert.equal(r.order.delivery.name, 'نور حسن');
  assert.equal(r.order.subtotal, 38999);
  assert.match(r.order.ref, /^SDK-[0-9A-F]{6}$/, 'a guest needs a reference to quote on the phone');
});

test('the reference is unique per order', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(validateGuestOrder(GOOD).order.ref);
  assert.equal(seen.size, 200);
});

/* --------------------------- required fields ---------------------------- */

test('EMAIL is required, because it is the only thing Ecwid files a customer under', () => {
  /* Without it the order reaches Ecwid as an orphan: no customer record, so
     staff cannot find the person and their history never accumulates. That
     is the whole point of pushing guest details, so it is not optional. */
  for (const bad of ['', '   ', 'nope', 'a@b', undefined])
    assert.equal(validateGuestOrder({ ...GOOD, email: bad }).error, 'bad-email', String(bad));
});

test('a PHONE is required, because delivery is arranged by calling', () => {
  /* Unlike the account form, where it is optional: nobody can deliver a
     refrigerator to an address with no number to ring. */
  assert.equal(validateGuestOrder({ ...GOOD, phone: '' }).error, 'bad-phone');
  assert.equal(validateGuestOrder({ ...GOOD, phone: '12345' }).error, 'bad-phone');
  assert.equal(validateGuestOrder({ ...GOOD, phone: '+201012345678' }).ok, true);
  assert.equal(validateGuestOrder({ ...GOOD, phone: '010 1234 5678' }).ok, true, 'spaces are how people type it');
});

test('a name, a governorate and an address are all required', () => {
  assert.equal(validateGuestOrder({ ...GOOD, name: '' }).error, 'bad-name');
  assert.equal(validateGuestOrder({ ...GOOD, name: 'ن' }).error, 'bad-name');
  assert.equal(validateGuestOrder({ ...GOOD, governorate: '' }).error, 'bad-governorate');
  assert.equal(validateGuestOrder({ ...GOOD, address: 'قصير' }).error, 'bad-address');
});

test('a payment method must be named; the ROUTE checks it is a real one', () => {
  /* Validated against the live Ecwid list at the route, not here — this
     module is pure and has no idea which methods the owner has switched on. */
  assert.equal(validateGuestOrder({ ...GOOD, payment: '' }).error, 'bad-payment');
});

/* ------------------------------- the cart ------------------------------- */

test('an empty cart is refused', () => {
  assert.equal(validateGuestOrder({ ...GOOD, items: [] }).error, 'empty-cart');
  assert.equal(validateGuestOrder({ ...GOOD, items: null }).error, 'empty-cart');
});

test('prices and quantities come from the payload but are BOUNDED', () => {
  /* The browser sends them, so they are not trusted as authority — the route
     re-prices against the catalogue. These bounds only stop absurd values
     from being stored or pushed at all. */
  const r = validateGuestOrder({ ...GOOD, items: [{ ...GOOD.items[0], qty: 9999 }] });
  assert.equal(r.order.items[0].qty, 20);
  const neg = validateGuestOrder({ ...GOOD, items: [{ ...GOOD.items[0], qty: -3, price: -5 }] });
  assert.equal(neg.order.items[0].qty, 1);
  assert.equal(neg.order.items[0].price, 0);
});

test('a cart of sixty-one lines is refused rather than silently truncated', () => {
  /* Truncating would push an order missing items the customer thinks they
     bought — worse than refusing it. */
  const many = Array.from({ length: 61 }, (_, i) => ({ ...GOOD.items[0], id: String(i) }));
  assert.equal(validateGuestOrder({ ...GOOD, items: many }).error, 'too-many-items');
});

test('long free text is clipped, not rejected', () => {
  const r = validateGuestOrder({ ...GOOD, note: 'ا'.repeat(4000), address: 'ش'.repeat(900) });
  assert.equal(r.ok, true);
  assert.ok(r.order.note.length <= 500);
  assert.ok(r.order.delivery.address.length <= 300);
});

/* ---------------------- no total is ever invented ----------------------- */

test('no delivery fee or grand total is fabricated for a guest either', () => {
  /* Same rule as an account order: a guest keeps the same receipt, and a
     zero would read as free delivery. */
  const r = validateGuestOrder(GOOD);
  assert.equal(r.order.totals.deliveryFee, null);
  assert.equal(r.order.totals.installFee, null);
  assert.equal(r.order.totals.grandTotal, null);
  assert.equal(r.order.totals.subtotal, 38999);
});

test('a guest order is marked as one, so nothing mistakes it for an account order', () => {
  assert.equal(validateGuestOrder(GOOD).order.guest, true);
  assert.equal(validateGuestOrder(GOOD).order.userId, null);
});

/* ------------------------- the user for the push ------------------------ */

test('guestUserOf hands toEcwidOrder the shape it expects', () => {
  /* toEcwidOrder reads user.email / name / phone. For an account order those
     come from the accounts database; for a guest they are on the order. */
  const { order } = validateGuestOrder(GOOD);
  const u = guestUserOf(order);
  assert.equal(u.email, 'nour@example.com');
  assert.equal(u.name, 'نور حسن');
  assert.equal(u.phone, '01012345678');
});

test('guestUserOf never invents an email', () => {
  /* If it did, Ecwid would file the order under a fake customer. */
  assert.equal(guestUserOf(null), null);
  assert.equal(guestUserOf({}), null);
});

/* ----------------------------- injection -------------------------------- */

test('nothing the browser sends can add fields to the stored order', () => {
  const r = validateGuestOrder({ ...GOOD, userId: 'u-admin', status: 'delivered', guest: false,
                                 totals: { grandTotal: 1 }, isAdmin: true });
  assert.equal(r.order.userId, null);
  assert.equal(r.order.status, 'received');
  assert.equal(r.order.guest, true);
  assert.equal(r.order.totals.grandTotal, null);
  assert.equal(r.order.isAdmin, undefined);
});

/* ===================== a guest, as an Ecwid customer ======================
   guestUserOf deliberately carries only what toEcwidOrder needs, because the
   ORDER already holds the address in its shippingPerson. A customer RECORD
   does not, so it needs its own mapper rather than a widened one — widening
   guestUserOf would quietly change what every pushed order sends. */

const GUEST = {
  ref: 'SDK-GUEST1', email: 'Omar@Example.com',
  delivery: { name: 'عمر', phone: '01000000000', address: '5 شارع النيل',
              governorate: 'القاهرة', floor: '2', hasLift: true },
};

test('a guest becomes a customer carrying the address they typed', () => {
  const c = guestCustomerOf(GUEST);
  assert.equal(c.email, 'Omar@Example.com', 'toEcwidCustomer normalises it; this is raw');
  assert.equal(c.name, 'عمر');
  assert.equal(c.phone, '01000000000');
  assert.equal(c.address, '5 شارع النيل');
  assert.equal(c.profile.governorate, 'القاهرة');
});

test('no email means no customer — the same rule as guestUserOf', () => {
  assert.equal(guestCustomerOf({ delivery: { name: 'عمر' } }), null);
  assert.equal(guestCustomerOf(null), null);
});

test('a guest customer invents no homes, so it can never clear real addresses', () => {
  /* Ecwid captures the address from the order itself. Sending a shippingAddresses
     list built from nothing would be a fabricated mirror. */
  const c = guestCustomerOf(GUEST);
  assert.ok(!('homes' in c));
  assert.ok(!('activeHomeId' in c));
});

test('a guest order with no delivery block does not throw', () => {
  const c = guestCustomerOf({ email: 'a@b.co' });
  assert.equal(c.email, 'a@b.co');
  assert.equal(c.name, '');
});
