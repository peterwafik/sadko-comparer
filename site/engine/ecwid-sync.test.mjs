// site/engine/ecwid-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';
import { createEcwidSync } from './ecwid-sync.mjs';

function fresh(api) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-sync-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  const sync = createEcwidSync({ api, store });
  return { store, sync, cleanup: () => { try { store.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}

/* Raw Ecwid product shape, using the real field names. */
const E = (id, over = {}) => ({
  id, name: 'ثلاجة ' + id, price: 1000 + id, url: 'u' + id, description: 'd',
  sku: 'S' + id, imageUrl: 'i.webp', galleryImages: [], inStock: true,
  quantity: 5, unlimited: false, isShippingRequired: true, weight: 0,
  attributes: [], defaultCategoryId: 206629517, categoryIds: [206629517],
  enabled: true, ...over,
});

const stubApi = over => ({
  configured: true,
  listProducts: async () => ({ items: [], total: 0, count: 0 }),
  listCategories: async () => [],
  listAllProductIds: async () => new Set(),
  getProduct: async () => null,
  getProfile: async () => ({ paymentOptions: [], shippingOptions: [] }),
  ...over,
});

/* ------------------------------- products ------------------------------- */

test('syncProducts writes mapped products into the mirror', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1), E(2)], total: 2, count: 2 }) }));
  try {
    const r = await sync.syncProducts({});
    assert.equal(r.written, 2);
    const rows = store.allProducts();
    assert.equal(rows.length, 2);
    assert.ok(rows[0].title.startsWith('ثلاجة'), 'rows must be MAPPED, not raw Ecwid');
    assert.equal(rows[0].weight, null, 'the mapper ran: weight 0 became null');
  } finally { cleanup(); }
});

test('syncProducts pages until every product is written', async () => {
  let call = 0;
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => {
      call++;
      return call === 1
        ? { items: [E(1), E(2)], total: 3, count: 2 }
        : { items: [E(3)], total: 3, count: 1 };
    } }));
  try {
    const r = await sync.syncProducts({});
    assert.equal(r.written, 3);
    assert.equal(r.pages, 2);
    assert.equal(store.allProducts().length, 3);
  } finally { cleanup(); }
});

test('a successful sync records last_sync and clears last_error', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1)], total: 1, count: 1 }) }));
  try {
    store.setState('last_error', 'stale failure');
    await sync.syncProducts({});
    assert.ok(store.getState('last_sync'));
    assert.equal(store.getState('last_error'), null);
  } finally { cleanup(); }
});

test('a failing sync records last_error and does NOT throw', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => { const e = new Error('ecwid-503: boom'); e.status = 503; throw e; } }));
  try {
    const r = await sync.syncProducts({});
    assert.equal(r.written, 0);
    assert.match(String(store.getState('last_error')), /503/);
  } finally { cleanup(); }
});

test('a failing sync leaves the previously mirrored data in place', async () => {
  let fail = false;
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => { if (fail) throw new Error('down'); return { items: [E(1)], total: 1, count: 1 }; } }));
  try {
    await sync.syncProducts({});
    fail = true;
    await sync.syncProducts({});
    assert.equal(store.allProducts().length, 1, 'last good data must survive an outage');
  } finally { cleanup(); }
});

test('incremental sync passes updatedFrom through', async () => {
  let seen = null;
  const { sync, cleanup } = fresh(stubApi({
    listProducts: async o => { seen = o.updatedFrom; return { items: [], total: 0 }; } }));
  try {
    await sync.syncProducts({ updatedFrom: 1758400000 });
    assert.equal(seen, 1758400000);
  } finally { cleanup(); }
});

/* ------------------------------ categories ------------------------------ */

test('syncCategories writes mapped categories', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listCategories: async () => [{ id: 206629517, name: 'نو فروست', parentId: 0, enabled: true,
      nameTranslated: { en: 'نو فروست' }, orderBy: 10 }] }));
  try {
    await sync.syncCategories();
    const [c] = store.allCategories();
    assert.equal(c.name, 'نو فروست');
    assert.equal(c.parentId, null);
    assert.equal(c.nameEn, null, 'the Arabic-in-en-slot guard must still apply through the sync');
  } finally { cleanup(); }
});

/* ------------------- payment and shipping (revision 2) ------------------ */

test('syncSettings mirrors the payment methods Ecwid offers', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    getProfile: async () => ({
      paymentOptions: [
        { id: 'cod', checkoutTitle: 'Cash on Delivery', enabled: true, orderBy: 1,
          instructionsForCustomer: { instructions: '<p>ادفع عند الاستلام</p>' } },
        { id: 'valu', checkoutTitle: 'Valu', enabled: true, orderBy: 2,
          instructionsForCustomer: { instructions: '<p>سيتم التواصل</p>' } },
      ],
      shippingOptions: [{ id: 's1', title: 'القاهرة الكبرى', enabled: true, orderby: 1, ratesCalculationType: 'table' }],
    }) }));
  try {
    const r = await sync.syncSettings();
    assert.equal(r.payment, 2);
    assert.equal(r.shipping, 1);
    const pay = store.allPaymentMethods();
    assert.equal(pay[0].id, 'cod');
    assert.equal(pay[0].title, 'Cash on Delivery');
    assert.match(pay[1].instructions, /سيتم التواصل/);
    assert.equal(store.allShippingMethods()[0].calcType, 'table');
  } finally { cleanup(); }
});

test('a payment method disabled in Ecwid is not mirrored as available', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    getProfile: async () => ({
      paymentOptions: [{ id: 'cod', checkoutTitle: 'COD', enabled: true },
                       { id: 'old', checkoutTitle: 'Retired', enabled: false }],
      shippingOptions: [],
    }) }));
  try {
    await sync.syncSettings();
    assert.deepEqual(store.allPaymentMethods().map(m => m.id), ['cod'],
      'offering a method the owner switched off would take an order we cannot honour');
  } finally { cleanup(); }
});

test('syncSettings failing does not throw and records the error', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    getProfile: async () => { throw new Error('ecwid-403'); } }));
  try {
    const r = await sync.syncSettings();
    assert.equal(r.payment, 0);
    assert.match(String(store.getState('last_error')), /403/);
  } finally { cleanup(); }
});

/* ------------------------------- reconcile ------------------------------ */

test('fullReconcile removes products Ecwid no longer has', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1), E(3)], total: 2, count: 2 }),
    listAllProductIds: async () => new Set(['1', '3']) }));
  try {
    store.upsertProducts([{ id: '2', title: 'phantom', price: 1, images: [], categoryIds: [] }]);
    const r = await sync.fullReconcile();
    assert.equal(r.removed, 1);
    assert.deepEqual(store.allProducts().map(p => p.id).sort(), ['1', '3']);
  } finally { cleanup(); }
});

test('fullReconcile does not empty the mirror when the id listing fails', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1)], total: 1, count: 1 }),
    listAllProductIds: async () => { throw new Error('down'); } }));
  try {
    await sync.syncProducts({});
    const r = await sync.fullReconcile();
    assert.equal(r.removed, 0);
    assert.equal(store.allProducts().length, 1);
  } finally { cleanup(); }
});

test('fullReconcile does not empty the mirror when Ecwid returns no ids', async () => {
  /* The store-wiping scenario: a successful call that returns nothing. */
  const { store, sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1)], total: 1, count: 1 }),
    listAllProductIds: async () => new Set() }));
  try {
    await sync.syncProducts({});
    const r = await sync.fullReconcile();
    assert.equal(r.removed, 0);
    assert.equal(store.allProducts().length, 1, 'an empty id set must never wipe the catalogue');
  } finally { cleanup(); }
});

/* ---------------- webhook application: re-fetch, never trust ------------ */

test('a product event re-fetches the entity and upserts it', async () => {
  let asked = null;
  const { store, sync, cleanup } = fresh(stubApi({
    getProduct: async id => { asked = id; return E(5, { name: 'اسم جديد' }); } }));
  try {
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(asked, '5');
    assert.equal(r.action, 'upserted');
    assert.equal(store.allProducts()[0].title, 'اسم جديد');
  } finally { cleanup(); }
});

test('the event PAYLOAD is ignored — only the re-fetched entity is trusted', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    getProduct: async () => E(5, { name: 'من الAPI' }) }));
  try {
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated',
      data: { name: 'من الحمولة — لا يجب استخدامه', price: 1 } });
    assert.equal(store.allProducts()[0].title, 'من الAPI');
  } finally { cleanup(); }
});

test('applying the same event twice converges to one row', async () => {
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => E(5) }));
  try {
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(store.allProducts().length, 1, 'replays must be harmless');
  } finally { cleanup(); }
});

test('events arriving out of order still converge on current state', async () => {
  /* Both deliveries re-fetch, so whichever arrives last still writes the
     CURRENT product — no diff is ever applied. */
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => E(5, { price: 999 }) }));
  try {
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.created' });
    assert.equal(store.allProducts()[0].price, 999);
  } finally { cleanup(); }
});

test('a delete event removes the row', async () => {
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => E(5) }));
  try {
    await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.deleted' });
    assert.equal(r.action, 'deleted');
    assert.equal(store.allProducts().length, 0);
  } finally { cleanup(); }
});

test('an update event for a product Ecwid 404s deletes it rather than keeping a ghost', async () => {
  const { store, sync, cleanup } = fresh(stubApi({ getProduct: async () => null }));
  try {
    store.upsertProducts([{ id: '5', title: 'ghost', price: 1, images: [], categoryIds: [] }]);
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(r.action, 'deleted');
    assert.equal(store.allProducts().length, 0);
  } finally { cleanup(); }
});

test('a webhook whose re-fetch fails records the error and does not throw', async () => {
  const { store, sync, cleanup } = fresh(stubApi({
    getProduct: async () => { throw new Error('ecwid-500'); } }));
  try {
    const r = await sync.applyProductEvent({ entityId: '5', eventType: 'product.updated' });
    assert.equal(r.action, 'error');
    assert.match(String(store.getState('last_error')), /500/);
  } finally { cleanup(); }
});

/* -------------------------------- timing -------------------------------- */

test('lastSyncedUnix returns a unix seconds value after a sync, null before', async () => {
  const { sync, cleanup } = fresh(stubApi({
    listProducts: async () => ({ items: [E(1)], total: 1, count: 1 }) }));
  try {
    assert.equal(sync.lastSyncedUnix(), null);
    await sync.syncProducts({});
    const t = sync.lastSyncedUnix();
    assert.ok(Number.isInteger(t) && t > 1_700_000_000, 'expected unix seconds, got ' + t);
  } finally { cleanup(); }
});

test('an unconfigured api makes syncAll a recorded no-op rather than a crash', async () => {
  const { store, sync, cleanup } = fresh({ configured: false });
  try {
    const r = await sync.syncAll();
    assert.equal(r.products, 0);
    assert.match(String(store.getState('last_error')), /not configured/i);
  } finally { cleanup(); }
});

/* ======================================================================
   Order status, flowing back WITHOUT a webhook.

   Staff mark an order shipped in Ecwid; the customer has to see it here.
   Until now the only path was the order.updated webhook, which Ecwid can
   only deliver to a public URL — so in development, and in production
   before the webhook is registered, a status change never arrived at all.
   The poll now asks about the orders it actually pushed.
   ================================================================== */

/* A local order, in the shape accounts.mjs returns. */
const LOCAL = (ref, status = 'received') => ({ ref, status, items: [], userId: 'u1' });

function orderHarness(remoteById, localByRef) {
  const seen = [];
  const api = stubApi({
    getOrder: async id => remoteById[String(id)] || null,
  });
  const loaders = {
    loadOrder: async ref => localByRef[ref] || null,
    setStatus: async (ref, status) => { seen.push([ref, status]); localByRef[ref].status = status; },
  };
  return { api, loaders, seen };
}

test('a status changed in Ecwid reaches the local order on the poll', async () => {
  const local = { 'SDK-AAA111': LOCAL('SDK-AAA111') };
  const { api, loaders, seen } = orderHarness(
    { '900': { id: 900, fulfillmentStatus: 'SHIPPED', paymentStatus: 'AWAITING_PAYMENT' } }, local);
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueOrderPush('SDK-AAA111');
    store.markPushed('SDK-AAA111', '900');
    const r = await sync.syncOrderStatuses(loaders);
    assert.equal(r.changed, 1);
    assert.deepEqual(seen, [['SDK-AAA111', 'shipping']]);
  } finally { cleanup(); }
});

test('an unchanged status writes nothing', async () => {
  /* Every write is an audit row and a customer-visible event. */
  const local = { 'SDK-AAA111': LOCAL('SDK-AAA111', 'shipping') };
  const { api, loaders, seen } = orderHarness(
    { '900': { id: 900, fulfillmentStatus: 'SHIPPED' } }, local);
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueOrderPush('SDK-AAA111');
    store.markPushed('SDK-AAA111', '900');
    const r = await sync.syncOrderStatuses(loaders);
    assert.equal(r.changed, 0);
    assert.deepEqual(seen, []);
  } finally { cleanup(); }
});

test('an Ecwid status we do not map leaves the local one ALONE', async () => {
  /* Inventing a transition would lie to the customer about their order. */
  const local = { 'SDK-AAA111': LOCAL('SDK-AAA111') };
  const { api, loaders, seen } = orderHarness(
    { '900': { id: 900, fulfillmentStatus: 'SOMETHING_NEW' } }, local);
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueOrderPush('SDK-AAA111');
    store.markPushed('SDK-AAA111', '900');
    await sync.syncOrderStatuses(loaders);
    assert.deepEqual(seen, []);
    assert.equal(local['SDK-AAA111'].status, 'received');
  } finally { cleanup(); }
});

test('a cancelled or refunded PAYMENT cancels the order whatever fulfilment says', async () => {
  const local = { 'SDK-AAA111': LOCAL('SDK-AAA111') };
  const { api, loaders, seen } = orderHarness(
    { '900': { id: 900, fulfillmentStatus: 'PROCESSING', paymentStatus: 'REFUNDED' } }, local);
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueOrderPush('SDK-AAA111');
    store.markPushed('SDK-AAA111', '900');
    await sync.syncOrderStatuses(loaders);
    assert.deepEqual(seen, [['SDK-AAA111', 'cancelled']]);
  } finally { cleanup(); }
});

test('an order that was never pushed is never asked about', async () => {
  /* It has no Ecwid id, so there is nothing to ask. */
  const local = { 'SDK-AAA111': LOCAL('SDK-AAA111') };
  let asked = 0;
  const api = stubApi({ getOrder: async () => { asked++; return null; } });
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueOrderPush('SDK-AAA111');            // queued, never pushed
    await sync.syncOrderStatuses({ loadOrder: async r => local[r], setStatus: async () => {} });
    assert.equal(asked, 0);
  } finally { cleanup(); }
});

test('a DELIVERED or CANCELLED local order stops being polled', async () => {
  /* The list of pushed orders only grows. Asking Ecwid about every order the
     store has ever taken, every five minutes, forever, is the thing that
     makes this expensive — and a finished order cannot change again. */
  let asked = 0;
  const local = { a: LOCAL('a', 'delivered'), b: LOCAL('b', 'cancelled'), c: LOCAL('c', 'preparing') };
  const api = stubApi({ getOrder: async () => { asked++; return { id: 1, fulfillmentStatus: 'SHIPPED' }; } });
  const { store, sync, cleanup } = fresh(api);
  try {
    for (const ref of ['a', 'b', 'c']) { store.enqueueOrderPush(ref); store.markPushed(ref, '90' + ref); }
    await sync.syncOrderStatuses({ loadOrder: async r => local[r], setStatus: async () => {} });
    assert.equal(asked, 1, 'only the unfinished order should be asked about');
  } finally { cleanup(); }
});

test('one tick is bounded, so a long order history cannot stall the poll', async () => {
  let asked = 0;
  const local = {};
  const api = stubApi({ getOrder: async () => { asked++; return { id: 1, fulfillmentStatus: 'QUEUED' }; } });
  const { store, sync, cleanup } = fresh(api);
  try {
    for (let i = 0; i < 60; i++) {
      const ref = 'SDK-' + i;
      local[ref] = LOCAL(ref);
      store.enqueueOrderPush(ref); store.markPushed(ref, String(1000 + i));
    }
    await sync.syncOrderStatuses({ loadOrder: async r => local[r], setStatus: async () => {} });
    assert.ok(asked <= 25, 'asked about ' + asked + ' orders in one tick');
  } finally { cleanup(); }
});

test('a 403 answers quietly rather than failing the whole poll', async () => {
  /* The public_ token answers 403 on /orders. That is a configuration state,
     not a fault, and the rest of the sync must carry on. */
  const local = { 'SDK-AAA111': LOCAL('SDK-AAA111') };
  const api = stubApi({ getOrder: async () => { const e = new Error('ecwid-403: no'); e.status = 403; throw e; } });
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueOrderPush('SDK-AAA111');
    store.markPushed('SDK-AAA111', '900');
    const r = await sync.syncOrderStatuses({ loadOrder: async x => local[x], setStatus: async () => {} });
    assert.equal(r.changed, 0);
    assert.equal(r.blocked, true, 'the caller should be able to tell access is missing');
  } finally { cleanup(); }
});

/* ======================================================================
   A guest order leaves this server as soon as Ecwid has it.

   The whole reason guest orders are held in the Ecwid mirror rather than in
   accounts.db is that they are temporary. If the payload survived a
   successful push, guest PII would accumulate here exactly like account PII
   — which is the thing the design exists to avoid.
   ================================================================== */

const GUEST = ref => ({
  ref, guest: true, userId: null, status: 'received',
  email: 'nour@example.com',
  items: [{ id: '1', title: 'ثلاجة', price: 38999, qty: 1 }],
  subtotal: 38999, payment: 'cod',
  delivery: { name: 'نور حسن', phone: '01012345678', governorate: 'القاهرة', address: '12 شارع' },
  totals: { subtotal: 38999, deliveryFee: null, installFee: null, grandTotal: null },
});

function guestLoaders(store) {
  /* What the server wires: the accounts lookup misses for a guest, so it
     falls through to the outbox. */
  return {
    loadOrder: async ref => store.getGuestOrder(ref),
    loadUser: async o => ({ email: o.email, name: o.delivery.name, phone: o.delivery.phone }),
  };
}

test('a successful guest push DELETES the name, phone and address', () => {
  return (async () => {
    const api = stubApi({
      findOrderByRef: async () => null,
      createOrder: async () => ({ id: 777 }),
      allPaymentMethods: async () => [],
    });
    const { store, sync, cleanup } = fresh(api);
    try {
      store.putGuestOrder(GUEST('SDK-G00001'));
      store.enqueueOrderPush('SDK-G00001');
      const r = await sync.pushOrder('SDK-G00001', guestLoaders(store));
      assert.equal(r.ok, true, r.error);
      assert.equal(store.getGuestOrder('SDK-G00001'), null,
        'the guest payload must not survive a successful push');
      /* The push row stays: it carries the Ecwid id, which is what stops a
         retry creating the order twice. */
      assert.equal(store.pushRow('SDK-G00001').ecwid_order_id, '777');
    } finally { cleanup(); }
  })();
});

test('a FAILED guest push keeps the payload, so the order is not lost', () => {
  return (async () => {
    const api = stubApi({
      findOrderByRef: async () => { const e = new Error('ecwid-403: no'); e.status = 403; throw e; },
      allPaymentMethods: async () => [],
    });
    const { store, sync, cleanup } = fresh(api);
    try {
      store.putGuestOrder(GUEST('SDK-G00002'));
      store.enqueueOrderPush('SDK-G00002');
      const r = await sync.pushOrder('SDK-G00002', guestLoaders(store));
      assert.equal(r.ok, false);
      assert.ok(store.getGuestOrder('SDK-G00002'), 'a lost order is worse than a retained one');
      assert.equal(store.getGuestOrder('SDK-G00002').delivery.phone, '01012345678',
        'the phone has to survive, or nobody can ring the customer');
    } finally { cleanup(); }
  })();
});

test('an ADOPTED guest order drops its payload too', () => {
  /* findOrderByRef found it already in Ecwid — a previous attempt succeeded
     and we lost the response. Ecwid has the details, so we should not. */
  return (async () => {
    const api = stubApi({
      findOrderByRef: async () => ({ id: '888' }),
      allPaymentMethods: async () => [],
    });
    const { store, sync, cleanup } = fresh(api);
    try {
      store.putGuestOrder(GUEST('SDK-G00003'));
      store.enqueueOrderPush('SDK-G00003');
      const r = await sync.pushOrder('SDK-G00003', guestLoaders(store));
      assert.equal(r.adopted, true);
      assert.equal(store.getGuestOrder('SDK-G00003'), null);
    } finally { cleanup(); }
  })();
});

test('dropping the payload of an ACCOUNT order is harmless', () => {
  /* The same code path runs for both; an account order simply has no outbox
     row, and the delete must not throw. */
  return (async () => {
    const api = stubApi({
      findOrderByRef: async () => null,
      createOrder: async () => ({ id: 999 }),
      allPaymentMethods: async () => [],
    });
    const { store, sync, cleanup } = fresh(api);
    try {
      store.enqueueOrderPush('SDK-ACC001');
      const r = await sync.pushOrder('SDK-ACC001', {
        loadOrder: async () => ({ ref: 'SDK-ACC001', status: 'received', payment: 'cod',
          items: [{ id: '1', title: 'x', price: 10, qty: 1 }], subtotal: 10,
          delivery: { name: 'n', phone: 'p' }, totals: {} }),
        loadUser: async () => ({ email: 'a@b.co', name: 'n', phone: 'p' }),
      });
      assert.equal(r.ok, true, r.error);
    } finally { cleanup(); }
  })();
});

/* ======================================================================
   Linking customers into Ecwid, reliably.

   The complaint this answers: an account was created on the site and did
   not appear in Ecwid's customers tab. The cause was the public_ token
   answering 403 — but the real faults were that the failure was silent
   and that nothing ever tried again, so every account created before the
   secret token arrives would have stayed missing forever.
   ================================================================== */

function linkHarness(over = {}) {
  const created = [], updated = [];
  const api = stubApi({
    customerByEmail: async e => over.existing ? over.existing(e) : null,
    createCustomer: async p => { created.push(p); return { id: 501 }; },
    updateCustomer: async (id, p) => { updated.push([id, p]); return { id }; },
    ...over.api,
  });
  return { api, created, updated };
}

/* The accounts lookup the server injects. The queue holds only an email, so
   the details are read from accounts.db at attempt time. */
const USERS = {
  'nour@example.com': { email: 'nour@example.com', name: 'نور حسن', phone: '01012345678' },
  'peter@example.com': { email: 'peter@example.com', name: 'Peter', phone: '' },
};
const loadByEmail = async e => USERS[e] || null;

test('a queued customer is created in Ecwid and marked linked', async () => {
  const { api, created } = linkHarness();
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('nour@example.com');
    const r = await sync.linkPendingCustomers(loadByEmail);
    assert.equal(r.linked, 1, JSON.stringify(r));
    assert.equal(created.length, 1);
    assert.equal(created[0].email, 'nour@example.com');
    const row = store.customerLinkRow('nour@example.com');
    assert.equal(row.ecwid_customer_id, '501');
    assert.ok(row.linked_at);
  } finally { cleanup(); }
});

test('an already-linked customer is not asked about again', async () => {
  const { api, created } = linkHarness();
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('nour@example.com');
    await sync.linkPendingCustomers(loadByEmail);
    const r = await sync.linkPendingCustomers(loadByEmail);
    assert.equal(r.linked, 0);
    assert.equal(created.length, 1, 'the customer must not be created twice');
  } finally { cleanup(); }
});

test('a customer Ecwid ALREADY has is adopted, not duplicated', async () => {
  /* Staff may have typed them in from a phone order first. */
  const { api, created } = linkHarness({ existing: () => ({ id: 909, name: 'نور حسن' }) });
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('nour@example.com');
    const r = await sync.linkPendingCustomers(loadByEmail);
    assert.equal(r.linked, 1);
    assert.equal(created.length, 0, 'Ecwid already had them');
    assert.equal(store.customerLinkRow('nour@example.com').ecwid_customer_id, '909');
  } finally { cleanup(); }
});

test('a 403 records the reason and STOPS, rather than burning every attempt', async () => {
  /* The live state today. Spending all six attempts on a token that cannot
     write would leave every customer permanently parked the moment a real
     token arrived. */
  const { api } = linkHarness({ api: {
    customerByEmail: async () => { const e = new Error('ecwid-403: '); e.status = 403; throw e; } } });
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('nour@example.com');
    store.enqueueCustomerLink('peter@example.com');
    const r = await sync.linkPendingCustomers(loadByEmail);
    assert.equal(r.blocked, true);
    assert.equal(r.linked, 0);
    /* Neither is burned: attempts stay at 0 so they are retried in full once
       the token can write. */
    assert.equal(store.customerLinkRow('nour@example.com').attempts, 0);
    assert.equal(store.customerLinkRow('peter@example.com').attempts, 0);
    assert.equal(store.pendingCustomerLinks().length, 2);
  } finally { cleanup(); }
});

test('an ordinary failure DOES count an attempt and backs off', async () => {
  const { api } = linkHarness({ api: {
    customerByEmail: async () => { throw new Error('ecwid-500: boom'); } } });
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('nour@example.com');
    await sync.linkPendingCustomers(loadByEmail);
    const row = store.customerLinkRow('nour@example.com');
    assert.equal(row.attempts, 1);
    assert.match(row.last_error, /500/);
    assert.ok(row.next_attempt_at, 'a retry has to be scheduled');
  } finally { cleanup(); }
});

test('an email with no account row is dropped, not retried forever', async () => {
  /* The account was deleted between enqueue and attempt. There is nothing
     to link, and retrying would park it for good. */
  const { api } = linkHarness();
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('gone@example.com');
    const r = await sync.linkPendingCustomers(loadByEmail);
    assert.equal(r.linked, 0);
    assert.equal(r.dropped, 1);
    assert.equal(store.pendingCustomerLinks().length, 0, 'it should leave the queue');
  } finally { cleanup(); }
});

test('one tick is bounded', async () => {
  const { api, created } = linkHarness();
  const { store, sync, cleanup } = fresh(api);
  try {
    for (let i = 0; i < 60; i++) {
      const em = 'u' + i + '@example.com';
      USERS[em] = { email: em, name: 'u' + i, phone: '' };
      store.enqueueCustomerLink(em);
    }
    await sync.linkPendingCustomers(loadByEmail, 25);
    assert.ok(created.length <= 25, 'created ' + created.length + ' in one tick');
    for (let i = 0; i < 60; i++) delete USERS['u' + i + '@example.com'];
  } finally { cleanup(); }
});

test('linkPendingCustomers never throws, whatever the loader does', async () => {
  const { api } = linkHarness();
  const { store, sync, cleanup } = fresh(api);
  try {
    store.enqueueCustomerLink('nour@example.com');
    const r = await sync.linkPendingCustomers(async () => { throw new Error('db gone'); });
    assert.ok(r, 'it must return a result rather than throw out of the poll');
  } finally { cleanup(); }
});
