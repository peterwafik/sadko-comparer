// site/engine/ecwid-customers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEcwidCustomer, customerNeedsUpdate, fromEcwidOrder, mergeOrders } from './ecwid-customers.mjs';

const USER = { email: 'Nada@Example.com', name: 'ندى', phone: '01000000000',
               address: '12 شارع الهرم', profile: { governorate: 'الجيزة' } };

/* ------------------------------ customers ------------------------------- */

test('a site account maps to an Ecwid customer keyed on the email', () => {
  const c = toEcwidCustomer(USER);
  assert.equal(c.email, 'nada@example.com', 'the email must be normalised — it is the join key');
  assert.equal(c.name, 'ندى');
  assert.equal(c.billingPerson.phone, '01000000000');
  assert.equal(c.billingPerson.countryCode, 'EG');
});

test('no email means no customer — there is nothing to link on', () => {
  assert.equal(toEcwidCustomer({ name: 'ندى' }), null);
  assert.equal(toEcwidCustomer(null), null);
});

test('the password is never sent, and Ecwid could not check one anyway', () => {
  const c = toEcwidCustomer({ ...USER, password: 'hunter2', passwordHash: 'abc', salt: 'xyz' });
  const json = JSON.stringify(c);
  for (const leak of ['hunter2', 'abc', 'xyz', 'password', 'salt', 'hash']) {
    assert.ok(!json.toLowerCase().includes(leak.toLowerCase()), 'the payload leaks ' + leak);
  }
});

test('absent details are OMITTED, not sent as null', () => {
  /* An explicit null would clear a field staff filled in by hand in Ecwid. */
  const c = toEcwidCustomer({ email: 'a@b.co' });
  assert.deepEqual(Object.keys(c), ['email']);
  assert.ok(!('billingPerson' in c));
  assert.ok(!JSON.stringify(c).includes('null'));
});

test('the site only ADDS what Ecwid is missing — it never overwrites staff', () => {
  /* Staff are closer to the customer than our registration form. */
  const desired = toEcwidCustomer(USER);
  assert.equal(customerNeedsUpdate({ name: '' }, desired), true, 'an empty remote name should be filled');
  assert.equal(customerNeedsUpdate({ name: 'ندى محمد' }, desired), false,
    'a name staff corrected in Ecwid must not be replaced by ours');
  assert.equal(customerNeedsUpdate(null, desired), false);
  assert.equal(customerNeedsUpdate({ name: '' }, null), false);
});

/* ---------------------------- reading orders ---------------------------- */

const REMOTE_OURS = {
  id: 987654, orderNumber: 41, externalOrderId: 'SDK-AB12CD',
  createDate: '2026-09-20 10:00:00 +0200',
  paymentStatus: 'AWAITING_PAYMENT', fulfillmentStatus: 'AWAITING_PROCESSING',
  paymentMethod: 'الدفع عند الاستلام', subtotal: 26449, total: 26449,
  items: [{ productId: 865565241, name: 'تليفزيون 65 بوصة', price: 26449, quantity: 1, imageUrl: 'i.jpg' }],
  shippingPerson: { name: 'ندى', phone: '01000000000', street: '12 شارع الهرم', stateOrProvinceName: 'الجيزة' },
  orderComments: 'مرجع الطلب: SDK-AB12CD',
};

const REMOTE_PHONE = {
  id: 987655, orderNumber: 42,
  createDate: '2026-09-21 12:00:00 +0200',
  paymentStatus: 'PAID', fulfillmentStatus: 'SHIPPED',
  paymentMethod: 'تحويل بنكى', subtotal: 15785, total: 16035,
  items: [{ productId: 157676934, name: 'ثلاجة كريازى', price: 15785, quantity: 1 }],
  shippingPerson: { name: 'ندى', phone: '01000000000', street: '12 شارع الهرم', city: 'الجيزة' },
};

test('an order the site pushed is recognised as ours by its SDK- reference', () => {
  const o = fromEcwidOrder(REMOTE_OURS);
  assert.equal(o.ref, 'SDK-AB12CD');
  assert.equal(o.origin, 'site');
});

test('THE POINT: an order staff typed into Ecwid is readable by the customer', () => {
  /* SADKO sells by phone and in showrooms. Before this, a customer who rang
     19140 saw nothing on the site and had to assume the order was lost. */
  const o = fromEcwidOrder(REMOTE_PHONE);
  assert.equal(o.origin, 'ecwid');
  assert.equal(o.ref, 'ECWID-987655', 'an Ecwid-origin order needs a reference of its own');
  assert.equal(o.items[0].title, 'ثلاجة كريازى');
  assert.equal(o.status, 'shipping', 'SHIPPED maps to the site own "shipping" status');
});

test('an Ecwid reference can never collide with one of ours', () => {
  assert.ok(fromEcwidOrder(REMOTE_PHONE).ref.startsWith('ECWID-'));
  assert.ok(!/^SDK-/.test(fromEcwidOrder(REMOTE_PHONE).ref));
});

test('the status comes through the shared mapper, not a second copy of the table', () => {
  assert.equal(fromEcwidOrder({ ...REMOTE_PHONE, fulfillmentStatus: 'DELIVERED' }).status, 'delivered');
  assert.equal(fromEcwidOrder({ ...REMOTE_PHONE, paymentStatus: 'CANCELLED' }).status, 'cancelled');
});

test('an unmappable status falls back to received rather than to nothing', () => {
  const o = fromEcwidOrder({ ...REMOTE_PHONE, fulfillmentStatus: 'SOMETHING_NEW', paymentStatus: 'PAID' });
  assert.equal(o.status, 'received');
});

test('the subtotal Ecwid reports wins over our arithmetic', () => {
  /* Staff may have applied a discount by hand. Recomputing from the lines
     would show the customer a figure that contradicts their own order. */
  const o = fromEcwidOrder({ ...REMOTE_PHONE, subtotal: 14000 });
  assert.equal(o.subtotal, 14000);
});

test('the subtotal is computed from the lines only when Ecwid reports none', () => {
  const { subtotal, ...noSub } = REMOTE_PHONE;
  assert.equal(fromEcwidOrder(noSub).subtotal, 15785);
});

test('a grand total is shown only when it is genuinely above the goods', () => {
  /* total > subtotal means staff entered the delivery charge — the one case
     where a real grand total exists. */
  assert.equal(fromEcwidOrder(REMOTE_PHONE).total, 16035);
});

test('a total that is zero or missing stays ABSENT, never zero', () => {
  /* Zero would read as free delivery, which is the claim every other surface
     on this site refuses to make. */
  assert.equal(fromEcwidOrder({ ...REMOTE_PHONE, total: 0 }).total, null);
  const { total, ...noTotal } = REMOTE_PHONE;
  assert.equal(fromEcwidOrder(noTotal).total, null);
});

test('staff private notes are not shown to the customer', () => {
  /* privateAdminNotes is where staff write about a customer, not to them. */
  const o = fromEcwidOrder({ ...REMOTE_PHONE, privateAdminNotes: 'عميل صعب — لا تعطه خصم' });
  assert.ok(!JSON.stringify(o).includes('صعب'), 'a private staff note reached the customer');
});

test('alternative field spellings are all accepted', () => {
  /* Four Ecwid field names have already been guessed wrong on this project. */
  const o = fromEcwidOrder({ id: 5, createdDate: '2026-01-01', fulfillmentStatus: 'PROCESSING',
    items: [{ id: 9, productName: 'ث', price: 10, qty: 2 }] });
  assert.equal(o.items[0].id, '9');
  assert.equal(o.items[0].title, 'ث');
  assert.equal(o.items[0].qty, 2);
  assert.equal(o.createdAt, '2026-01-01');
});

test('a junk order does not throw', () => {
  assert.equal(fromEcwidOrder(null), null);
  const o = fromEcwidOrder({});
  assert.equal(o.items.length, 0);
  assert.equal(o.subtotal, 0);
  assert.equal(o.total, null);
});

/* ------------------------------- merging -------------------------------- */

const LOCAL = [
  { ref: 'SDK-AB12CD', createdAt: '2026-09-20T08:00:00.000Z', status: 'received',
    items: [{ id: '865565241', title: 'تليفزيون 65 بوصة', price: 26449, qty: 1 }], subtotal: 26449 },
];

test('an order in both places appears ONCE', () => {
  const merged = mergeOrders(LOCAL, [REMOTE_OURS, REMOTE_PHONE]);
  assert.equal(merged.length, 2, 'the pushed order was duplicated');
  assert.equal(merged.filter(o => o.ref === 'SDK-AB12CD').length, 1);
});

test('the phone order joins the list the customer can see', () => {
  const merged = mergeOrders(LOCAL, [REMOTE_OURS, REMOTE_PHONE]);
  assert.ok(merged.some(o => o.ref === 'ECWID-987655' && o.origin === 'ecwid'));
});

test('for an order in both, the LOCAL contents stand and Ecwid supplies the status', () => {
  /* The local record is what the customer was shown and what their receipt
     says; Ecwid is where staff move the order along. */
  const merged = mergeOrders(LOCAL, [{ ...REMOTE_OURS, fulfillmentStatus: 'SHIPPED', subtotal: 999 }]);
  const mine = merged.find(o => o.ref === 'SDK-AB12CD');
  assert.equal(mine.status, 'shipping', 'the Ecwid status did not come through');
  assert.equal(mine.subtotal, 26449, 'the local subtotal was overwritten');
  assert.equal(mine.inEcwid, true, 'the order should be marked as reaching Ecwid');
});

test('an order that never reached Ecwid is not marked as though it had', () => {
  /* This is how a customer, and the admin desk, can tell a parked push. */
  const merged = mergeOrders(LOCAL, []);
  assert.equal(merged[0].inEcwid, undefined);
  assert.equal(merged[0].origin, 'site');
});

test('the list is newest first', () => {
  const merged = mergeOrders(LOCAL, [REMOTE_PHONE]);
  assert.equal(merged[0].ref, 'ECWID-987655', 'the 21st should precede the 20th');
});

test('an order with no date sorts last instead of scrambling the list', () => {
  const merged = mergeOrders(LOCAL, [{ ...REMOTE_PHONE, createDate: null, updateDate: null }]);
  assert.equal(merged[0].ref, 'SDK-AB12CD');
  assert.equal(merged.length, 2);
});

test('the reference match is case-insensitive', () => {
  const merged = mergeOrders([{ ...LOCAL[0], ref: 'sdk-ab12cd' }], [REMOTE_OURS]);
  assert.equal(merged.length, 1, 'a case difference duplicated the order');
});

test('Ecwid being unreachable leaves the local list exactly as it was', () => {
  const merged = mergeOrders(LOCAL, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].subtotal, 26449);
});

test('no local orders and only remote ones still produces a list', () => {
  const merged = mergeOrders([], [REMOTE_PHONE]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin, 'ecwid');
});

test('junk entries on either side are skipped, not rendered', () => {
  const merged = mergeOrders([null, { noRef: true }], [null, undefined]);
  assert.deepEqual(merged, []);
});

test('an already-mapped remote order is not mapped twice', () => {
  /* mergeOrders accepts either raw Ecwid orders or ones fromEcwidOrder has
     already shaped, so a caller that pre-maps does not get a mangled list. */
  const pre = fromEcwidOrder(REMOTE_PHONE);
  const merged = mergeOrders([], [pre]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ref, 'ECWID-987655');
  assert.equal(merged[0].items[0].title, 'ثلاجة كريازى');
});
