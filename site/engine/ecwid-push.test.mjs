// site/engine/ecwid-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';
import { createEcwidSync } from './ecwid-sync.mjs';
import { FEES_NOTE_AR } from './ecwid-map.mjs';

const ORDER = {
  ref: 'SDK-A1B2C3', createdAt: '2026-09-22T10:00:00.000Z',
  items: [{ id: '865565594', title: 'تليفزيون', price: 21499, qty: 1 }],
  subtotal: 21499, payment: 'cod',
  delivery: { name: 'محمد', phone: '+201000000000', governorate: 'القاهرة', address: 'ش ١٠' },
  note: '',
};
const USER = { email: 'buyer@example.com', name: 'محمد', phone: '+201000000000' };
const loaders = { loadOrder: async () => ORDER, loadUser: async () => USER };

function fresh(api) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-push-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  const sync = createEcwidSync({ api, store });
  return { store, sync, cleanup: () => { try { store.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}
const stub = over => ({
  configured: true,
  listProducts: async () => ({ items: [], total: 0, count: 0 }),
  listCategories: async () => [],
  listAllProductIds: async () => new Set(),
  getProduct: async () => null,
  getProfile: async () => ({ paymentOptions: [], shippingOptions: [] }),
  findOrderByRef: async () => null,
  createOrder: async () => ({ id: 'EC-1' }),
  getOrder: async () => null,
  ...over,
});

/* ------------------------------ the happy path -------------------------- */

test('enqueue then push stores the Ecwid order id against the ref', async () => {
  const { store, sync, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.ok, true);
    assert.equal(r.ecwidOrderId, 'EC-1');
    assert.equal(store.pushRow('SDK-A1B2C3').ecwid_order_id, 'EC-1');
    assert.ok(store.pushRow('SDK-A1B2C3').pushed_at, 'the row must be marked pushed');
  } finally { cleanup(); }
});

test('the payload carries the subtotal and the fees note, and no invented shipping', async () => {
  let sent = null;
  const { store, sync, cleanup } = fresh(stub({ createOrder: async p => { sent = p; return { id: 'EC-2' }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(sent.total, 21499);
    assert.ok(sent.orderComments.includes(FEES_NOTE_AR));
    assert.ok(!('shippingRate' in sent), 'no shipping cost may be invented');
  } finally { cleanup(); }
});

/* ------- idempotency: the bug that would ship a customer two fridges ---- */

test('a push whose response was lost ADOPTS the existing order, never duplicates', async () => {
  let created = 0;
  const { store, sync, cleanup } = fresh(stub({
    findOrderByRef: async ref => (ref === 'SDK-A1B2C3' ? { id: 'EC-EXISTING' } : null),
    createOrder: async () => { created++; return { id: 'EC-NEW' }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(created, 0, 'a duplicate order must never be created');
    assert.equal(r.adopted, true);
    assert.equal(r.ecwidOrderId, 'EC-EXISTING');
  } finally { cleanup(); }
});

test('pushing the same ref twice creates exactly ONE Ecwid order', async () => {
  let created = 0;
  const seen = new Map();
  const { store, sync, cleanup } = fresh(stub({
    findOrderByRef: async ref => (seen.has(ref) ? { id: seen.get(ref) } : null),
    createOrder: async p => { created++; const id = 'EC-' + created; seen.set(p.externalOrderId, id); return { id }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    store.resetPush('SDK-A1B2C3');           // force it due again, as a retry would
    await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(created, 1, 'two pushes produced ' + created + ' orders');
  } finally { cleanup(); }
});

test('an already-pushed ref short-circuits without calling Ecwid at all', async () => {
  let calls = 0;
  const { store, sync, cleanup } = fresh(stub({
    createOrder: async () => { calls++; return { id: 'EC-1' }; },
    findOrderByRef: async () => { calls++; return null; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const before = calls;
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.already, true);
    assert.equal(calls, before, 'a pushed order must not be re-sent');
  } finally { cleanup(); }
});

test('the worker skips orders already pushed', async () => {
  let created = 0;
  const { store, sync, cleanup } = fresh(stub({ createOrder: async () => { created++; return { id: 'EC-1' }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const r = await sync.pushPendingOrders(loaders);
    assert.equal(r.pushed, 0);
    assert.equal(created, 1);
  } finally { cleanup(); }
});

/* ---------------------------- failure handling -------------------------- */

test('a failed push is retried later, not lost', async () => {
  const { store, sync, cleanup } = fresh(stub({
    createOrder: async () => { const e = new Error('ecwid-503'); e.status = 503; throw e; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.ok, false);
    const row = store.pushRow('SDK-A1B2C3');
    assert.equal(row.attempts, 1);
    assert.match(row.last_error, /503/);
    assert.ok(row.next_attempt_at, 'a retry must be scheduled');
    assert.equal(row.ecwid_order_id, null);
    assert.equal(row.pushed_at, null);
  } finally { cleanup(); }
});

test('the retry backs off — each attempt is scheduled further out', async () => {
  const { store, sync, cleanup } = fresh(stub({ createOrder: async () => { throw new Error('down'); } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const first = store.pushRow('SDK-A1B2C3').next_attempt_at;
    store.resetPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const second = store.pushRow('SDK-A1B2C3').next_attempt_at;
    assert.ok(Date.parse(second) > Date.parse(first), 'backoff must increase');
  } finally { cleanup(); }
});

test('after the attempt cap the order PARKS as failed and is surfaced, never dropped', async () => {
  const { store, sync, cleanup } = fresh(stub({ createOrder: async () => { throw new Error('down'); } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    for (let i = 0; i < 8; i++) { store.resetPush('SDK-A1B2C3'); await sync.pushOrder('SDK-A1B2C3', loaders); }
    const failed = store.failedPushes();
    assert.equal(failed.length, 1);
    assert.equal(failed[0].ref, 'SDK-A1B2C3');
    assert.ok(failed[0].attempts >= store.MAX_PUSH_ATTEMPTS);
    assert.equal(store.pendingPushes().length, 0, 'a parked order leaves the pending queue');
  } finally { cleanup(); }
});

test('an unknown payment method parks the order rather than pushing a wrong status', async () => {
  const { store, sync, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-BAD');
    const r = await sync.pushOrder('SDK-BAD', {
      loadOrder: async () => ({ ...ORDER, ref: 'SDK-BAD', payment: 'crypto' }),
      loadUser: async () => USER });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown payment method/i);
  } finally { cleanup(); }
});

test('a missing local order parks rather than crashing the worker', async () => {
  const { store, sync, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-GONE');
    const r = await sync.pushOrder('SDK-GONE', { loadOrder: async () => null, loadUser: async () => USER });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/i);
  } finally { cleanup(); }
});

test('Ecwid answering without an order id parks rather than marking success', async () => {
  const { store, sync, cleanup } = fresh(stub({ createOrder: async () => ({}) }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.ok, false);
    assert.equal(store.pushRow('SDK-A1B2C3').pushed_at, null);
  } finally { cleanup(); }
});

/* ------------------------------ the queue ------------------------------- */

test('nextDuePush skips a row whose retry time has not arrived', () => {
  const { store, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    store.markPushFailed('SDK-A1B2C3', 'down', '2099-01-01T00:00:00.000Z');
    assert.equal(store.nextDuePush('2026-09-22T00:00:00.000Z'), null);
    assert.ok(store.nextDuePush('2099-06-01T00:00:00.000Z'));
  } finally { cleanup(); }
});

test('pushPendingOrders drains everything due', async () => {
  const { store, sync, cleanup } = fresh(stub({ createOrder: async p => ({ id: 'EC-' + p.externalOrderId }) }));
  try {
    for (const ref of ['SDK-1', 'SDK-2', 'SDK-3']) store.enqueueOrderPush(ref);
    const r = await sync.pushPendingOrders({
      loadOrder: async ref => ({ ...ORDER, ref }), loadUser: async () => USER });
    assert.equal(r.pushed, 3);
    assert.equal(store.pendingPushes().length, 0);
  } finally { cleanup(); }
});

test('the worker stops on the first failure instead of hammering a dead API', async () => {
  /* The next due order is almost always blocked by the same outage, so retrying
     all of them immediately just multiplies the failures. */
  let calls = 0;
  const { store, sync, cleanup } = fresh(stub({
    createOrder: async () => { calls++; throw new Error('down'); } }));
  try {
    for (const ref of ['SDK-1', 'SDK-2', 'SDK-3']) store.enqueueOrderPush(ref);
    const r = await sync.pushPendingOrders({
      loadOrder: async ref => ({ ...ORDER, ref }), loadUser: async () => USER });
    assert.equal(r.failed, 1);
    assert.equal(calls, 1, 'only one attempt should have been made');
  } finally { cleanup(); }
});

test('enqueueing the same ref twice leaves one queue row', () => {
  const { store, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    store.enqueueOrderPush('SDK-A1B2C3');
    assert.equal(store.pendingPushes().length, 1);
  } finally { cleanup(); }
});

test('an unconfigured api parks the push rather than throwing', async () => {
  const { store, sync, cleanup } = fresh({ configured: false });
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.ok, false);
    assert.equal(store.pushRow('SDK-A1B2C3').pushed_at, null);
  } finally { cleanup(); }
});
