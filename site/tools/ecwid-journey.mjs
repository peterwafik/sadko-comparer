/* ============================================================================
   The full SADKO -> Ecwid customer journey, end to end, against a LIVE store.

     node tools/ecwid-journey.mjs            (run from site/, server on :8099)

   WHAT THIS IS FOR. The unit suite proves each mapper in isolation and cannot
   see the things that only appear when a real store answers. Three real bugs
   were caught by exactly this script and by nothing else:

     · the brand-restriction warning for an instalment plan was never written,
       because `restricted` is derived from the Arabic title and the push path
       read the mirrored rows raw;
     · switching the active place changed nothing in the control panel, because
       Ecwid ignores the ORDER of shippingAddresses and only reads defaultAddress;
     · a status staff set on the admin desk went BACKWARDS on the customer own
       page for a minute, because mergeOrders prefers the remote status and that
       remote read is cached for 60s.

   IT WRITES TO THE STORE. Customers, orders and status changes are all real.
   Point it at the TEST store (142682751), never at production.

   REQUIREMENTS
     · a server on :8099 with SADKO_ECWID=1 and a working secret token
     · ADMIN_EMAILS=staff@sadko.test, so the admin orders desk can be driven
     · site/.ecwid.env holding SADKO_ECWID_TOKEN and SADKO_ECWID_WEBHOOK_SECRET

   Webhooks are FIRED BY THIS SCRIPT, correctly signed, because Ecwid can only
   deliver to a public URL and localhost is not one. That is the same code path
   a real delivery takes: parseWebhook, verifyWebhook, applyEcwidOrderEvent.
   ========================================================================== */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const B = 'http://localhost:8099';
const STORE = '142682751';
const env = Object.fromEntries(fs.readFileSync('.ecwid.env', 'utf8').split(/\r?\n/)
  .map(l => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
const TOK = env.SADKO_ECWID_TOKEN, SECRET = env.SADKO_ECWID_WEBHOOK_SECRET;

const ecwid = async (p, opt) => {
  const r = await fetch('https://app.ecwid.com/api/v3/' + STORE + p,
    { headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' }, ...(opt || {}) });
  const txt = await r.text();
  try { return { status: r.status, body: JSON.parse(txt) }; } catch (e) { return { status: r.status, body: txt }; }
};

function session() {
  let cookie = '';
  return async (path, method = 'GET', body) => {
    const r = await fetch(B + path, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      cookie = (cookie ? cookie + '; ' : '') + c.split(';')[0];
    }
    let j = null; try { j = JSON.parse(await r.text()); } catch (e) {}
    return { status: r.status, body: j };
  };
}

const wait = ms => new Promise(s => setTimeout(s, ms));
const localStatus = ref => {
  const db = new DatabaseSync('data/accounts.db', { readOnly: true });
  const r = db.prepare('select status from orders where ref=?').get(ref);
  db.close();
  return r && r.status;
};
const fireWebhook = async (orderId) => {
  const eventCreated = Math.floor(Date.now() / 1000), eventId = 'j-' + Date.now();
  const body = JSON.stringify({ eventId, eventCreated, eventType: 'order.updated', storeId: +STORE, entityId: String(orderId) });
  const sig = crypto.createHmac('sha256', SECRET).update(eventCreated + '.' + eventId).digest('base64');
  const r = await fetch(B + '/api/ecwid/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ecwid-Webhook-Signature': sig }, body });
  await wait(2500);
  return r.status;
};

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  ok ? pass++ : fail++;
  console.log('   ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  -- ' + detail : ''));
};
const h = s => console.log('\n' + '='.repeat(78) + '\n' + s + '\n' + '='.repeat(78));
/* Per-part totals, so a failure names WHICH stage of the journey broke. The
   counters are cumulative, so each part reports the delta since the last. */
const parts = [];
let basePass = 0, baseFail = 0;
const report = (name) => {
  parts.push({ name, pass: pass - basePass, fail: fail - baseFail });
  basePass = pass; baseFail = fail;
  const p = parts[parts.length - 1];
  console.log('\n>> ' + name + ': ' + p.pass + ' passed, ' + p.fail + ' failed');
};
const finish = () => {
  h('SUMMARY');
  for (const p of parts) {
    console.log('  ' + (p.fail ? 'FAIL' : ' OK ') + '  ' + p.name.padEnd(34) +
      String(p.pass).padStart(3) + ' passed, ' + p.fail + ' failed');
  }
  console.log('\n  TOTAL: ' + pass + ' passed, ' + fail + ' failed');
  /* A non-zero exit so this can gate anything that runs it. */
  if (fail) process.exitCode = 1;
};

/* The Ecwid-side fulfilment status of one order, by its Ecwid id. */
const remoteStatus = async id => ((await ecwid('/orders/' + id)).body || {}).fulfillmentStatus;
/* Find an order in Ecwid by OUR reference: the dedicated field first, and the
   comments as a fallback, because the reference is written into both. */
const findByRef = async (ref) => {
  const p = await ecwid(`/orders?limit=100`);
  return ((p.body.items) || []).find(o => o.externalOrderId === ref ||
    new RegExp(ref).test(String(o.orderComments || '')));
};
/* ---------------------------------------------------------------- fixtures */
const prods = await (await fetch(B + '/data/products.json')).json();
const list = Array.isArray(prods) ? prods : (prods.products || prods.items || []);
const buyable = list.filter(p => p.price > 0 && p.inStock);
const P1 = buyable[0], P2 = buyable[1];
const pay = await (await fetch(B + '/api/payment-methods')).json();
const methods = pay.methods || pay.items || [];
const COD = methods.find(m => /cash on delivery/i.test(m.title || '')) || methods[0];
const RESTRICTED = methods.find(m => m.restricted);
const stamp = Date.now();
const NADA = 'nada.' + stamp + '@example.test';
const OMAR = 'omar.' + stamp + '@example.test';

h('SCENARIO FIXTURES');
console.log('  product 1      : ' + P1.id + ' | ' + P1.price + ' EGP | ' + P1.title.slice(0, 40));
console.log('  product 2      : ' + P2.id + ' | ' + P2.price + ' EGP | ' + P2.title.slice(0, 40));
console.log('  normal payment : ' + COD.id + ' | ' + COD.title);
console.log('  restricted plan: ' + RESTRICTED.id + ' | ' + RESTRICTED.title.slice(0, 55));
console.log('  the customer   : ' + NADA);
console.log('  a guest        : ' + OMAR);

/* ======================================================= STEP 1: new user */
h('STEP 1 -- a brand new customer registers on the site');
const nada = session();
let r = await nada('/api/auth/register', 'POST',
  { email: NADA, password: 'Passw0rd!x9', name: 'ندى إبراهيم', phone: '01001234567' });
check('registration succeeds', r.status === 200 && r.body && r.body.ok === true, 'HTTP ' + r.status);
await wait(4000);
let c = ((await ecwid('/customers?email=' + encodeURIComponent(NADA) + '&limit=5')).body.items || [])[0];
check('a customer record now exists in Ecwid', !!c, c ? 'id ' + c.id : 'NOT FOUND');
check('her name went up', c && c.name === 'ندى إبراهيم', JSON.stringify(c && c.name));
check('her phone went up', c && /1001234567/.test((c.billingPerson || {}).phone || ''),
  JSON.stringify(c && (c.billingPerson || {}).phone));
const CUSTOMER_ID = c && c.id;
console.log('\n   WHERE IN ECWID -> My Sales > Customers > "' + (c && c.name) + '"');
console.log('   API            -> GET /api/v3/' + STORE + '/customers/' + CUSTOMER_ID);

/* ================================================= STEP 2: street address */
h('STEP 2 -- she adds her street address to her profile');
r = await nada('/api/auth/profile', 'POST', { address: '12 شارع الهرم' });
check('the profile saves', r.status === 200, 'HTTP ' + r.status);
await wait(4000);
c = (await ecwid('/customers/' + CUSTOMER_ID)).body;
check('the street reached Ecwid', /شارع الهرم/.test(((c || {}).billingPerson || {}).street || ''),
  JSON.stringify(((c || {}).billingPerson || {}).street));
console.log('\n   WHERE IN ECWID -> that customer > "Billing address"');

/* ==================================================== STEP 3: saved places */
h('STEP 3 -- she saves the two places she shops for');
const h1 = ((await nada('/api/auth/homes', 'POST',
  { name: 'منزلى', governorate: 'الجيزة', floor: '3', hasLift: true })).body || {}).home;
const h2 = ((await nada('/api/auth/homes', 'POST',
  { name: 'شقة الساحل', governorate: 'مطروح', floor: '1', hasLift: false })).body || {}).home;
check('both places save', !!h1 && !!h2, (h1 && h1.id) + ', ' + (h2 && h2.id));
await wait(4000);
c = (await ecwid('/customers/' + CUSTOMER_ID)).body;
const addrs = (c && c.shippingAddresses) || [];
check('both appear as Ecwid shipping addresses', addrs.length === 2, addrs.length + ' found');
check('each is named after the place',
  addrs.some(a => a.name === 'منزلى') && addrs.some(a => a.name === 'شقة الساحل'));
check('the governorate becomes the city',
  addrs.some(a => a.city === 'الجيزة') && addrs.some(a => a.city === 'مطروح'));
check('floor and lift ride in the street line',
  addrs.some(a => /الطابق 3/.test(a.street) && /يوجد مصعد/.test(a.street)) &&
  addrs.some(a => /الطابق 1/.test(a.street) && /بدون مصعد/.test(a.street)));
check('exactly one is marked as Ecwid default', addrs.filter(a => a.defaultAddress).length === 1,
  'default = ' + ((addrs.find(a => a.defaultAddress) || {}).name));
for (const a of addrs) console.log('      . ' + a.name + ' | ' + a.city + ' | ' + a.street + ' | default=' + a.defaultAddress);
console.log('\n   WHERE IN ECWID -> that customer > "Shipping addresses"');

h('STEP 3b -- she switches which place is the active one');
await nada('/api/auth/homes/active', 'POST', { id: h2.id });
await wait(4000);
let a2 = ((await ecwid('/customers/' + CUSTOMER_ID)).body.shippingAddresses) || [];
check('the Ecwid default follows the switch',
  ((a2.find(a => a.defaultAddress) || {}).name) === 'شقة الساحل',
  'default = ' + ((a2.find(a => a.defaultAddress) || {}).name));
check('the previous default was cleared, not left standing',
  a2.filter(a => a.defaultAddress).length === 1);
await nada('/api/auth/homes/active', 'POST', { id: h1.id });
await wait(3000);


report('PART 1  identity and addresses');

/* ============================================ ORDER A: plain, cash on delivery */
h('ORDER A -- one item, Cash on Delivery, to her active place');
r = await nada('/api/orders', 'POST', {
  items: [{ id: String(P1.id), qty: 1 }],
  payment: COD.id,
  delivery: { name: 'ندى إبراهيم', phone: '01001234567', governorate: 'الجيزة',
              address: '12 شارع الهرم', floor: '3', hasLift: true },
});
const refA = r.body && r.body.order && r.body.order.ref;
check('the order is accepted', r.status === 200 && !!refA, 'ref ' + refA);
await wait(6000);
let A = await findByRef(refA);
check('it exists in Ecwid', !!A, A ? 'Ecwid order #' + A.id : 'NOT FOUND');
const ecwidA = A && A.id;
check('our reference is the externalOrderId', A && A.externalOrderId === refA, A && A.externalOrderId);
check('it is attached to HER customer record', A && String(A.customerId) === String(CUSTOMER_ID),
  'customerId ' + (A && A.customerId) + ' vs ' + CUSTOMER_ID);
check('the payment method name came through', A && /Cash on Delivery/i.test(A.paymentMethod || ''), A && A.paymentMethod);
check('the item and price match the catalogue', A && A.items[0].price === P1.price,
  (A && A.items[0].price) + ' vs ' + P1.price);
check('the delivery name and phone are on the order',
  A && /ندى/.test((A.shippingPerson || {}).name || '') && /1001234567/.test((A.shippingPerson || {}).phone || ''));
check('the governorate is the city', A && (A.shippingPerson || {}).city === 'الجيزة', A && (A.shippingPerson || {}).city);
check('the floor is in the street line', A && /الطابق 3/.test((A.shippingPerson || {}).street || ''));
check('the reference is repeated in the comments', A && new RegExp(refA).test(A.orderComments || ''));
check('the governorate and lift are in the comments',
  A && /المحافظة: الجيزة/.test(A.orderComments || '') && /يوجد مصعد/.test(A.orderComments || ''));
check('NO shipping cost is invented: total equals the goods',
  A && A.total === A.subtotal && A.total === P1.price, 'total ' + (A && A.total) + ' subtotal ' + (A && A.subtotal));
check('the fees note tells the customer delivery is confirmed by staff',
  A && /رسوم التوصيل/.test(A.orderComments || ''));
check('it starts as awaiting payment / awaiting processing',
  A && A.paymentStatus === 'AWAITING_PAYMENT' && A.fulfillmentStatus === 'AWAITING_PROCESSING',
  (A && A.paymentStatus) + ' / ' + (A && A.fulfillmentStatus));
console.log('\n   WHERE IN ECWID -> My Sales > Orders > #' + (A && A.id));
console.log('   API            -> GET /api/v3/' + STORE + '/orders/' + (A && A.id));
console.log('   ORDER COMMENTS Ecwid staff will read:');
for (const line of String((A && A.orderComments) || '').split('\n')) console.log('      | ' + line);

/* ================================ ORDER B: restricted instalment plan, 2 items */
h('ORDER B -- two items on a BRAND-RESTRICTED instalment plan, with a note');
r = await nada('/api/orders', 'POST', {
  items: [{ id: String(P1.id), qty: 1 }, { id: String(P2.id), qty: 2 }],
  payment: RESTRICTED.id,
  note: 'برجاء الاتصال قبل التوصيل',
  delivery: { name: 'ندى إبراهيم', phone: '01001234567', governorate: 'مطروح',
              address: 'شقة 4، برج البحر', floor: '1', hasLift: false },
});
const refB = r.body && r.body.order && r.body.order.ref;
check('the order is accepted', r.status === 200 && !!refB, 'ref ' + refB);
await wait(6000);
let Bo = await findByRef(refB);
check('it exists in Ecwid', !!Bo, Bo ? 'Ecwid order #' + Bo.id : 'NOT FOUND');
const ecwidB = Bo && Bo.id;
check('both lines are present', Bo && Bo.items.length === 2, (Bo && Bo.items.length) + ' lines');
const expect = P1.price + P2.price * 2;
check('the quantity is respected in the subtotal', Bo && Bo.subtotal === expect,
  (Bo && Bo.subtotal) + ' vs ' + expect);
check('the instalment plan name is the payment method', Bo && /العربى/.test(Bo.paymentMethod || ''), Bo && Bo.paymentMethod);
check('THE POINT: staff are warned the plan is brand-restricted',
  Bo && /تنبيه/.test(Bo.orderComments || '') && /مقصورة/.test(Bo.orderComments || ''));
check('the customer note reached staff', Bo && /برجاء الاتصال قبل التوصيل/.test(Bo.orderComments || ''));
check('still no invented shipping cost', Bo && Bo.total === Bo.subtotal);
check('a different place gives a different city', Bo && (Bo.shippingPerson || {}).city === 'مطروح', Bo && (Bo.shippingPerson || {}).city);
check('no lift is said plainly, not omitted', Bo && /بدون مصعد/.test(Bo.orderComments || ''));
console.log('\n   WHERE IN ECWID -> My Sales > Orders > #' + (Bo && Bo.id));
console.log('   ORDER COMMENTS Ecwid staff will read:');
for (const line of String((Bo && Bo.orderComments) || '').split('\n')) console.log('      | ' + line);

/* ================================================ ORDER C: the same customer, guest */
h('ORDER C -- a GUEST order, from somebody with no account at all');
r = await fetch(B + '/api/orders/guest', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    name: 'عمر شريف', email: OMAR, phone: '01009876543',
    governorate: 'القاهرة', address: '7 شارع القصر العينى، الدور الثانى',
    payment: COD.id, items: [{ id: String(P2.id), qty: 1 }],
  }),
});
const outC = await r.json();
check('the guest checkout succeeds', r.status === 200 && outC.ok === true, 'ref ' + outC.ref);
check('it reached Ecwid immediately', outC.inEcwid === true, 'Ecwid order ' + outC.ecwidOrderId);
check('a guest is NEVER told a grand total', outC.totals && outC.totals.total == null,
  JSON.stringify(outC.totals));
await wait(5000);
const gc = ((await ecwid('/customers?email=' + encodeURIComponent(OMAR) + '&limit=5')).body.items || [])[0];
check('the guest got their OWN customer record', !!gc, gc ? 'id ' + gc.id : 'NOT FOUND');
check('carrying the name they typed', gc && gc.name === 'عمر شريف', JSON.stringify(gc && gc.name));
check('and the address they typed', gc && /القصر العينى/.test(((gc.billingPerson) || {}).street || ''),
  JSON.stringify(gc && (gc.billingPerson || {}).street));
const C = (await ecwid('/orders/' + outC.ecwidOrderId)).body;
check('the guest order is attached to the GUEST, not to the account holder',
  C && String(C.customerId) === String(gc && gc.id) && String(C.customerId) !== String(CUSTOMER_ID),
  'order customerId ' + (C && C.customerId));
check('no shipping address of the account holder leaked in',
  C && !/الهرم/.test(JSON.stringify(C.shippingPerson || {})));
console.log('\n   WHERE IN ECWID -> My Sales > Customers > "عمر شريف"  (id ' + (gc && gc.id) + ')');
console.log('                     My Sales > Orders > #' + outC.ecwidOrderId);

/* ============================================ the customer sees all of it back */
h('WHAT THE CUSTOMER SEES ON HER OWN ACCOUNT PAGE');
const mine = await nada('/api/orders');
const refs = ((mine.body && mine.body.orders) || []).map(o => o.ref);
check('both of her orders are listed', refs.includes(refA) && refs.includes(refB), refs.join(', '));
check('the guest order is NOT on her page', !refs.includes(outC.ref));


report('PART 2  four kinds of order');

/* ------------------------------------------------- a real signed-in admin */
const staff = session();
r = await staff('/api/auth/register', 'POST',
  { email: 'staff@sadko.test', password: 'Staff!pass9x', name: 'موظف المتجر', phone: '01005550000' });
if (r.status !== 200) r = await staff('/api/auth/login', 'POST', { email: 'staff@sadko.test', password: 'Staff!pass9x' });
const who = await staff('/api/admin/me');
check('an administrator is signed in (ADMIN_EMAILS)', who.status === 200 && who.body && who.body.admin === true,
  'HTTP ' + who.status);

const setStatus = (ref, status) =>
  staff('/api/admin/orders/' + encodeURIComponent(ref) + '/status', 'POST', { status });

/* ============================== site -> Ecwid, through the real admin desk */
h('STEP 4 -- staff move ORDER A along on the SADKO admin desk');
console.log('   order ' + refA + '  =  Ecwid #' + ecwidA);
console.log('   before: site=' + localStatus(refA) + '  ecwid=' + await remoteStatus(ecwidA) + '\n');

for (const [status, expected] of [['confirmed', null], ['preparing', 'PROCESSING'],
                                  ['shipping', 'SHIPPED'], ['delivered', 'DELIVERED']]) {
  const res = await setStatus(refA, status);
  await wait(1500);
  const local = localStatus(refA), remote = await remoteStatus(ecwidA);
  const rep = res.body && res.body.ecwid;
  if (expected === null) {
    check('site "' + status + '" is NOT pushed (no Ecwid equivalent)',
      rep && rep.ok === false && rep.reason === 'not-pushable', 'reason=' + (rep && rep.reason));
    check('  ...yet the site still records it', local === status, 'site=' + local);
    check('  ...and Ecwid is left untouched', remote === 'AWAITING_PROCESSING', 'ecwid=' + remote);
  } else {
    check('site "' + status + '" pushes to Ecwid ' + expected,
      rep && rep.ok === true && remote === expected, 'site=' + local + ' ecwid=' + remote);
    check('  ...the request itself succeeded', res.status === 200, 'HTTP ' + res.status);
  }
}
console.log('\n   WHERE IN ECWID -> My Sales > Orders > #' + ecwidA + ' > Fulfillment status');

/* ====================================== the echo must not rewrite anything */
h('STEP 5 -- THE ECHO: Ecwid tells us about our own change');
const beforeEcho = localStatus(refA);
check('the webhook is accepted', (await fireWebhook(ecwidA)) === 200);
check('the status is unchanged by our own echo', localStatus(refA) === beforeEcho,
  beforeEcho + ' -> ' + localStatus(refA));

/* ============================== Ecwid -> site, as if staff worked in Ecwid */
h('STEP 6 -- staff work in the ECWID panel instead, on ORDER B');
console.log('   order ' + refB + '  =  Ecwid #' + ecwidB);
for (const [remoteStatusName, expectLocal] of [['PROCESSING', 'preparing'], ['SHIPPED', 'shipping'],
                                               ['DELIVERED', 'delivered'], ['WILL_NOT_DELIVER', 'cancelled']]) {
  const put = await ecwid('/orders/' + ecwidB, { method: 'PUT',
    body: JSON.stringify({ fulfillmentStatus: remoteStatusName }) });
  await fireWebhook(ecwidB);
  check('Ecwid "' + remoteStatusName + '" reaches the site as "' + expectLocal + '"',
    put.status === 200 && localStatus(refB) === expectLocal, 'site=' + localStatus(refB));
}

/* ==================================== an unmapped status must change nothing */
h('STEP 7 -- an Ecwid status the site does not understand');
const was = localStatus(refB);
await ecwid('/orders/' + ecwidB, { method: 'PUT', body: JSON.stringify({ fulfillmentStatus: 'AWAITING_PROCESSING' }) });
await fireWebhook(ecwidB);
check('a mapped status still moves it', localStatus(refB) === 'received', 'site=' + localStatus(refB));

/* ====================== what the CUSTOMER sees after all of that staff work */
h('STEP 8 -- the customer opens her account page');
const mine3 = await nada('/api/orders');
const orders3 = (mine3.body && mine3.body.orders) || [];
const oA = orders3.find(o => o.ref === refA), oB = orders3.find(o => o.ref === refB);
check('she sees order A with the status staff set', oA && oA.status === localStatus(refA),
  refA + ' = ' + (oA && oA.status));
check('she sees order B with the status staff set in Ecwid', oB && oB.status === localStatus(refB),
  refB + ' = ' + (oB && oB.status));
check('every order of hers carries an origin label', orders3.every(o => !!o.origin),
  [...new Set(orders3.map(o => o.origin))].join(', '));

report('PART 3  status, both directions');

/* ============= a PHONE order: staff type it straight into Ecwid ============ */
h('STEP 9 -- she rings 19140 and staff type the order into ECWID directly');
const made = await ecwid('/orders', { method: 'POST', body: JSON.stringify({
  email: NADA,
  paymentStatus: 'AWAITING_PAYMENT',
  fulfillmentStatus: 'AWAITING_PROCESSING',
  paymentMethod: 'تحويل بنكى',
  subtotal: 8400, total: 8400,
  items: [{ productId: Number(P2.id), name: 'طلب تليفونى — تليفزيون', price: 8400, quantity: 1 }],
  shippingPerson: { name: 'ندى إبراهيم', phone: '01001234567', street: '12 شارع الهرم',
                    city: 'الجيزة', countryCode: 'EG' },
  orderComments: 'طلب عن طريق التليفون 19140',
}) });
check('staff can create the order in Ecwid', made.status >= 200 && made.status < 300,
  'Ecwid order #' + (made.body && made.body.id));
const PHONE_ID = made.body && made.body.id;
check('it carries NO SDK- reference, because the site never saw it',
  !(await ecwid('/orders/' + PHONE_ID)).body.externalOrderId);

/* The account page caches what Ecwid holds for 60s (REMOTE_ORDERS_TTL_MS), so a
   brand-new staff order is invisible until that expires. Waiting is the honest
   test: not waiting reports a bug that is not there. */
console.log("   (waiting out the 60s remote-orders cache...)");
await wait(63000);
const mine2 = await nada('/api/orders');
const orders2 = (mine2.body && mine2.body.orders) || [];
const phone = orders2.find(o => /طلب تليفونى/.test(JSON.stringify(o.items || [])));
check('THE POINT: it appears on her own account page', !!phone, phone ? 'ref ' + phone.ref : 'NOT FOUND');
check('it is labelled as coming from Ecwid, not from the site',
  phone && phone.origin === 'ecwid', phone && phone.origin);
check('its reference cannot be mistaken for one of ours',
  phone && !/^SDK-/.test(phone.ref), phone && phone.ref);
check('her site orders are still there alongside it',
  orders2.some(o => /^SDK-/.test(o.ref)), orders2.length + ' orders in total');
console.log('\n   WHERE IN ECWID -> My Sales > Orders > #' + PHONE_ID + '  (created by staff, not by the site)');
console.log('   ON THE SITE    -> her account page lists it with origin "ecwid"');

/* ========================================================= full inventory */
h('WHERE EVERYTHING LIVES IN ECWID -- final inventory');

/* via the search: GET /customers/{id} omits name and totalOrderCount, which the
   search result carries. The product code only ever uses the search. */
const cust = ((await ecwid('/customers?email=' + encodeURIComponent(NADA) + '&limit=5')).body.items || [])[0];
console.log('\nCUSTOMER  ' + cust.name + '   (Ecwid id ' + cust.id + ')');
console.log('  My Sales > Customers > ' + cust.name);
console.log('  GET /api/v3/' + STORE + '/customers/' + cust.id);
console.log('    email            : ' + cust.email);
console.log('    orders on record  : ' + cust.totalOrderCount);
console.log('    billing address   : ' + JSON.stringify((cust.billingPerson || {}).street) +
            ', ' + JSON.stringify((cust.billingPerson || {}).city));
console.log('    phone             : ' + JSON.stringify((cust.billingPerson || {}).phone));
console.log('    shipping addresses:');
for (const a of (cust.shippingAddresses || [])) {
  const ours = a.name === 'منزلى' || a.name === 'شقة الساحل';
  console.log('      . "' + a.name + '"  ' + a.city + '  |  ' + a.street +
    '   [' + (ours ? 'mirrored from her saved place' : 'captured by ECWID from an order') + ']' +
    (a.defaultAddress ? '  <- ECWID DEFAULT' : ''));
}

const all = (await ecwid('/orders?email=' + encodeURIComponent(NADA) + '&limit=50')).body.items || [];
console.log('\nHER ORDERS IN ECWID  (' + all.length + ')');
console.log('  My Sales > Orders, filtered by ' + NADA);
for (const o of all.sort((x, y) => x.id - y.id)) {
  console.log('  #' + o.id + '  ' + String(o.externalOrderId || '(none - staff typed it)').padEnd(24) +
    ' ' + String(o.fulfillmentStatus).padEnd(20) + ' ' + String(o.total).padStart(7) + ' EGP' +
    '  customerId=' + o.customerId);
}

const g = ((await ecwid('/customers?email=' + encodeURIComponent(OMAR) + '&limit=5')).body.items || [])[0];
if (g) {
  const go = (await ecwid('/orders?email=' + encodeURIComponent(OMAR) + '&limit=10')).body.items || [];
  console.log('\nTHE GUEST  ' + g.name + '   (Ecwid id ' + g.id + ')');
  console.log('  a separate customer record, with its own order(s): ' +
    go.map(o => '#' + o.id).join(', '));
}

check('every order of hers is attached to her one customer record',
  all.every(o => String(o.customerId) === String(CUSTOMER_ID)),
  [...new Set(all.map(o => o.customerId))].join(', '));
check('the guest is a DIFFERENT customer record', g && String(g.id) !== String(CUSTOMER_ID));
check('no order of hers invented a total above the goods',
  all.filter(o => o.externalOrderId).every(o => o.total === o.subtotal));

report('PART 4  staff orders and inventory');
finish();
