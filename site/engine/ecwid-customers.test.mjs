// site/engine/ecwid-customers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEcwidCustomer, customerNeedsUpdate, customerUpdatePatch, fromEcwidOrder, mergeOrders } from './ecwid-customers.mjs';

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
  /* Staff are closer to the customer than our registration form. The claim is
     now per FIELD, which is stronger than the boolean it replaced: filling a
     missing detail must not carry a corrected name up with it. */
  const desired = toEcwidCustomer(USER);
  assert.equal(customerNeedsUpdate({ name: '' }, desired), true, 'an empty remote name should be filled');
  assert.ok('name' in customerUpdatePatch({ name: '' }, desired));

  const staffFixed = customerUpdatePatch({ name: 'ندى محمد' }, desired);
  assert.ok(!('name' in staffFixed),
    'a name staff corrected in Ecwid must not be replaced by ours');

  assert.equal(customerNeedsUpdate(null, desired), false);
  assert.equal(customerNeedsUpdate({ name: '' }, null), false);
  assert.deepEqual(customerUpdatePatch(null, desired), {});
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

/* ======================= addresses mirrored from homes =====================
   A SADKO "home" is NOT a postal address: PROFILE_KEYS carries governorate,
   area, floor and hasLift plus appliance-fitting data, and there is no street
   line on it — the only street the site holds is user.address, which checkout
   itself falls back to. So the homes cannot become three distinct addresses;
   they become three entries that share a street and differ by governorate and
   access. Each is NAMED after the home so staff can tell them apart, and the
   floor rides in the street line exactly as toEcwidOrder already writes it. */

const HOMES_USER = {
  email: 'nada@example.com', name: 'ندى', phone: '01000000000',
  address: '12 شارع الهرم',
  activeHomeId: 'h2',
  homes: [
    { id: 'h1', name: 'منزلى', governorate: 'الجيزة', floor: '3', hasLift: true },
    { id: 'h2', name: 'شقة الساحل', governorate: 'مطروح', floor: '1', hasLift: false },
  ],
};

test('every saved home becomes a shipping address on the Ecwid customer', () => {
  const c = toEcwidCustomer(HOMES_USER);
  assert.equal(c.shippingAddresses.length, 2);
  for (const a of c.shippingAddresses) {
    assert.equal(a.countryCode, 'EG');
    assert.equal(a.phone, '01000000000');
  }
});

test('the ACTIVE home is first — it is the one checkout will use', () => {
  const c = toEcwidCustomer(HOMES_USER);
  assert.equal(c.shippingAddresses[0].name, 'شقة الساحل', 'activeHomeId h2 must lead');
  assert.equal(c.shippingAddresses[1].name, 'منزلى');
});

test('a home carries its governorate as the city and its floor in the street', () => {
  const c = toEcwidCustomer(HOMES_USER);
  const gz = c.shippingAddresses.find(a => a.name === 'منزلى');
  assert.equal(gz.city, 'الجيزة');
  assert.match(gz.street, /12 شارع الهرم/, 'the street the site actually holds');
  assert.match(gz.street, /الطابق 3/, 'the floor belongs in the street line, as in toEcwidOrder');
  assert.match(gz.street, /يوجد مصعد/);
  const ma = c.shippingAddresses.find(a => a.name === 'شقة الساحل');
  assert.match(ma.street, /بدون مصعد/);
});

test('no homes means no shippingAddresses key at all, not an empty array', () => {
  /* An explicit [] would CLEAR addresses Ecwid captured from a real order. */
  const c = toEcwidCustomer({ email: 'a@b.co', address: 'x' });
  assert.ok(!('shippingAddresses' in c));
});

test('a home with nothing useful on it is not pushed as a blank address', () => {
  const c = toEcwidCustomer({ email: 'a@b.co', homes: [{ id: 'h9' }] });
  assert.ok(!('shippingAddresses' in c), 'no street, no governorate — nothing to deliver to');
});

/* ================= the staff-edit versus user-edit rule ==================
   The old rule only ever filled a field Ecwid was MISSING, so a customer who
   corrected their own phone on the site never reached Ecwid. The new rule uses
   what WE last pushed as the discriminator: a value that differs from our own
   last push was changed by the user and must propagate; a value Ecwid holds
   that we never pushed was put there by staff and must be left alone. */

test('with no snapshot the old conservative rule still holds, per field', () => {
  const desired = toEcwidCustomer(USER);
  assert.ok('name' in customerUpdatePatch({ name: '' }, desired));
  assert.ok(!('name' in customerUpdatePatch({ name: 'ندى محمد' }, desired)),
    'a staff correction must survive when we have no snapshot to compare');
});

test('a field the USER changed since our last push propagates', () => {
  const before = toEcwidCustomer(USER);
  const after = toEcwidCustomer({ ...USER, phone: '01111111111' });
  assert.equal(customerNeedsUpdate({ name: 'ندى', billingPerson: { phone: '01000000000' } }, after, before),
    true, 'the user edited their phone — Ecwid must learn it');
});

test('a field STAFF changed is still not overwritten, snapshot or not', () => {
  const pushed = toEcwidCustomer(USER);
  /* Same site data as we last pushed; Ecwid differs because staff edited it.
     The name must be absent from the patch even though other fields may fill. */
  const patch = customerUpdatePatch({ name: 'ندى محمد' }, pushed, pushed);
  assert.ok(!('name' in patch), 'nothing changed on our side, so their edit stands');
});

test('deleting a home removes the address in Ecwid', () => {
  const before = toEcwidCustomer(HOMES_USER);
  const after = toEcwidCustomer({ ...HOMES_USER, homes: [HOMES_USER.homes[0]], activeHomeId: 'h1' });
  assert.equal(after.shippingAddresses.length, 1);
  assert.equal(customerNeedsUpdate({ shippingAddresses: before.shippingAddresses }, after, before),
    true, 'the mirror must shrink, not just grow');
});

test('addresses Ecwid captured itself are not clobbered on a first push', () => {
  const desired = toEcwidCustomer(HOMES_USER);
  const remote = { name: 'ندى', shippingAddresses: [{ street: 'ما سجله الموظف', city: 'القاهرة' }] };
  assert.ok(!('shippingAddresses' in customerUpdatePatch(remote, desired)),
    'no snapshot means we cannot tell ours from theirs — leave it');
});

test('an identical re-push is not a write', () => {
  const c = toEcwidCustomer(HOMES_USER);
  assert.equal(customerNeedsUpdate({ name: 'ندى', billingPerson: { phone: '01000000000' },
    shippingAddresses: c.shippingAddresses }, c, c), false);
});

test('the active home is marked as Ecwid\'s DEFAULT address, not merely first', () => {
  /* Found in live testing: Ecwid keeps its own address ids and orderBy, and
     ignores the order of the array we send. Switching the active home on the
     site therefore changed nothing in the control panel — staff still saw the
     old address flagged as the default, which is the one their UI offers first.
     Position is not a signal to Ecwid; defaultAddress is. */
  const c = toEcwidCustomer(HOMES_USER);          // activeHomeId: 'h2'
  const active = c.shippingAddresses.find(a => a.name === 'شقة الساحل');
  const other = c.shippingAddresses.find(a => a.name === 'منزلى');
  assert.equal(active.defaultAddress, true);
  assert.equal(other.defaultAddress, false,
    'explicitly false, so switching back actually clears the old default');
});

test('with no active home nothing is claimed to be the default', () => {
  const c = toEcwidCustomer({ ...HOMES_USER, activeHomeId: null });
  /* The first is still the one checkout would fall back to, so it leads — but
     we must not assert a default the site does not actually have. */
  assert.equal(c.shippingAddresses.length, 2);
  for (const a of c.shippingAddresses) assert.equal(a.defaultAddress, false);
});

test('switching the active home changes the payload, so a push is triggered', () => {
  const before = toEcwidCustomer(HOMES_USER);                        // h2 active
  const after = toEcwidCustomer({ ...HOMES_USER, activeHomeId: 'h1' });
  assert.notDeepEqual(before.shippingAddresses, after.shippingAddresses);
  assert.equal(customerNeedsUpdate({ shippingAddresses: before.shippingAddresses }, after, before),
    true, 'the switch must reach Ecwid, not be swallowed as "no change"');
});
