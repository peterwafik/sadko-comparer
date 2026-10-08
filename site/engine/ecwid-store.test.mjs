// site/engine/ecwid-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from './db.mjs';
import { openEcwidStore } from './ecwid-store.mjs';

/* :memory: per test: fast, and nothing left on disk. libSQL on Windows keeps
   a file handle for a moment after close(), so the few tests that need a real
   file (reopening it, or a second connection) clean up with rmQuiet. */
const rmQuiet = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (e) {} };

async function fresh({ onDisk = false } = {}) {
  if (!onDisk) {
    const db = await openEcwidStore(':memory:');
    return { db, cleanup: () => { try { db.close(); } catch (e) {} } };
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-ecwid-'));
  const db = await openEcwidStore(path.join(dir, 'ecwid.db'));
  return { db, dir, cleanup: () => { try { db.close(); } catch (e) {} rmQuiet(dir); } };
}

/* Rows are whatever ecwid-map.mjs produces. */
const P = (id, over = {}) => ({
  id: String(id), url: 'u' + id, title: 'ثلاجة ' + id, image: 'i' + id + '.webp',
  images: ['i' + id + '.webp'], price: 1000 + Number(id), description: 'وصف',
  categoryId: '206629517', categoryIds: ['206629517'], brand: '', sku: 'S' + id,
  inStock: true, stockTracked: true, quantity: 5, compareToPrice: null,
  discountPercent: null, shippingRequired: true, weight: null,
  enabled: true, incomplete: false, ...over,
});
const C = (id, over = {}) => ({
  id: String(id), name: 'نو فروست', nameEn: null, parentId: null, order: 10,
  enabled: true, image: 'c.jpg', productCount: 197, url: '', description: '', ...over,
});

test('upsert then read back returns the product with every field intact', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1)]);
    const [r] = await db.allProducts();
    assert.equal(r.id, '1');
    assert.equal(r.title, 'ثلاجة 1');
    assert.equal(r.price, 1001);
    assert.equal(r.inStock, true);
    assert.equal(r.compareToPrice, null);
    assert.deepEqual(r.categoryIds, ['206629517']);
    assert.deepEqual(r.images, ['i1.webp']);
  } finally { cleanup(); }
});

test('upsert is idempotent — the same id twice leaves one row, updated', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1)]);
    await db.upsertProducts([P(1, { price: 2222, title: 'ثلاجة معدلة' })]);
    const rows = await db.allProducts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, 2222);
    assert.equal(rows[0].title, 'ثلاجة معدلة');
  } finally { cleanup(); }
});

test('a real was-price and its percentage survive the round trip', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1, { price: 18500, compareToPrice: 23900, discountPercent: 23 })]);
    const [r] = await db.allProducts();
    assert.equal(r.compareToPrice, 23900);
    assert.equal(r.discountPercent, 23);
  } finally { cleanup(); }
});

test('out of stock survives as false, not as a missing row', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1, { inStock: false, quantity: 0 })]);
    const rows = await db.allProducts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].inStock, false);
  } finally { cleanup(); }
});

test('a null weight stays null rather than becoming zero', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1, { weight: null })]);
    assert.equal((await db.allProducts())[0].weight, null);
  } finally { cleanup(); }
});

test('a 1000-product batch writes in one transaction', async () => {
  const { db, cleanup } = await fresh();
  try {
    const many = Array.from({ length: 1000 }, (_, i) => P(i + 1));
    const r = await db.upsertProducts(many);
    assert.equal(r.written, 1000);
    assert.equal((await db.allProducts()).length, 1000);
  } finally { cleanup(); }
});

/* ---- deletion and the guard that matters ---- */

test('deleteMissingProducts removes exactly what Ecwid no longer has', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1), P(2), P(3)]);
    const r = await db.deleteMissingProducts(new Set(['1', '3']));
    assert.equal(r.removed, 1);
    assert.deepEqual((await db.allProducts()).map(p => p.id).sort(), ['1', '3']);
  } finally { cleanup(); }
});

test('deleteMissingProducts with an empty keep-set is REFUSED', async () => {
  /* An API call that failed or returned nothing would otherwise wipe the whole
     catalogue. The mirror must survive a bad reconcile. */
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1), P(2)]);
    await assert.rejects(db.deleteMissingProducts(new Set()), /refusing/i);
    assert.equal((await db.allProducts()).length, 2, 'a failed reconcile must not empty the mirror');
  } finally { cleanup(); }
});

test('deleteMissingProducts with a null keep-set is refused too', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1)]);
    await assert.rejects(db.deleteMissingProducts(null), /refusing/i);
    assert.equal((await db.allProducts()).length, 1);
  } finally { cleanup(); }
});

test('deleteProduct removes one row', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1), P(2)]);
    await db.deleteProduct('1');
    assert.deepEqual((await db.allProducts()).map(p => p.id), ['2']);
  } finally { cleanup(); }
});

test('productIds returns a set for the reconcile to diff against', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1), P(2)]);
    assert.deepEqual([...(await db.productIds())].sort(), ['1', '2']);
  } finally { cleanup(); }
});

/* ---- categories ---- */

test('categories upsert and read back, ordered by their Ecwid order', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertCategories([C(20, { order: 20, name: 'ديفروست' }), C(10, { order: 10 })]);
    const got = await db.allCategories();
    assert.equal(got.length, 2);
    assert.equal(got[0].order, 10);
    assert.equal(got[1].name, 'ديفروست');
  } finally { cleanup(); }
});

test('a null nameEn round-trips as null, not as the string "null"', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertCategories([C(10, { nameEn: null })]);
    assert.equal((await db.allCategories())[0].nameEn, null);
  } finally { cleanup(); }
});

/* ---- payment and shipping methods (revision 2) ---- */

test('payment methods upsert and read back in order', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertPaymentMethods([
      { id: 'cod', title: 'Cash on Delivery', enabled: true, order: 1, instructions: '' },
      { id: 'valu', title: 'Valu', enabled: true, order: 2, instructions: '<p>سيتم التواصل</p>' },
    ]);
    const got = await db.allPaymentMethods();
    assert.equal(got.length, 2);
    assert.equal(got[0].id, 'cod');
    assert.match(got[1].instructions, /سيتم التواصل/);
  } finally { cleanup(); }
});

test('replacing the payment list removes methods Ecwid no longer offers', async () => {
  /* A method disabled in Ecwid must stop being offered at checkout, so this
     is a full replace rather than a merge. */
  const { db, cleanup } = await fresh();
  try {
    await db.upsertPaymentMethods([{ id: 'cod', title: 'COD', enabled: true, order: 1 },
                             { id: 'gone', title: 'Old', enabled: true, order: 2 }]);
    await db.upsertPaymentMethods([{ id: 'cod', title: 'COD', enabled: true, order: 1 }]);
    assert.deepEqual((await db.allPaymentMethods()).map(m => m.id), ['cod']);
  } finally { cleanup(); }
});

test('shipping methods upsert and read back', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertShippingMethods([{ id: 's1', title: 'القاهرة الكبرى', enabled: true, order: 1, calcType: 'table' }]);
    const [m] = await db.allShippingMethods();
    assert.equal(m.title, 'القاهرة الكبرى');
    assert.equal(m.calcType, 'table');
  } finally { cleanup(); }
});

/* ---- sync state ---- */

test('state round-trips JSON values', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setState('last_sync', { at: '2026-09-21T00:00:00Z', count: 1453 });
    assert.deepEqual(await db.getState('last_sync'), { at: '2026-09-21T00:00:00Z', count: 1453 });
    assert.equal(await db.getState('never_set'), null);
  } finally { cleanup(); }
});

test('setting state to null clears it without throwing', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setState('last_error', 'boom');
    await db.setState('last_error', null);
    assert.equal(await db.getState('last_error'), null);
  } finally { cleanup(); }
});

test('stats reports what the admin panel needs', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1), P(2, { inStock: false }), P(3, { compareToPrice: 99999, discountPercent: 50 })]);
    await db.upsertCategories([C(10)]);
    await db.setState('last_error', 'ecwid-503');
    const s = await db.stats();
    assert.equal(s.products, 3);
    assert.equal(s.categories, 1);
    assert.equal(s.outOfStock, 1);
    assert.equal(s.discounted, 1);
    assert.equal(s.lastError, 'ecwid-503');
  } finally { cleanup(); }
});

test('reopening the same file keeps the data — migrations are idempotent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-ecwid-re-'));
  const file = path.join(dir, 'ecwid.db');
  try {
    const a = await openEcwidStore(file); await a.upsertProducts([P(9)]); a.close();
    const b = await openEcwidStore(file);
    assert.equal((await b.allProducts()).length, 1);
    b.close();
  } finally { rmQuiet(dir); }
});

test('an empty batch is a no-op rather than an error', async () => {
  const { db, cleanup } = await fresh();
  try {
    assert.equal((await db.upsertProducts([])).written, 0);
    assert.equal((await db.upsertCategories([])).written, 0);
    assert.equal((await db.allProducts()).length, 0);
  } finally { cleanup(); }
});

test('stats scopes out-of-stock to ENABLED products only', async () => {
  /* The live store has 463 DISABLED shells with no stock tracking, so they map
     to inStock: true. Counting them would make the out-of-stock figure
     meaningless. What matters is: of the products a customer could see, how
     many cannot be bought. */
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([
      P(1, { enabled: true, inStock: true }),
      P(2, { enabled: true, inStock: false }),
      P(3, { enabled: false, inStock: true, incomplete: true }),   // a shell
    ]);
    const s = await db.stats();
    assert.equal(s.products, 3);
    assert.equal(s.enabled, 2);
    assert.equal(s.buyable, 1);
    assert.equal(s.outOfStock, 1, 'the disabled shell must not be counted');
    assert.equal(s.incomplete, 1);
  } finally { cleanup(); }
});

/* ==================== the customer push snapshot (id 6) ====================
   What we last SENT, so a later push can tell a user edit from a staff edit.
   Held here rather than in accounts.db because it is Ecwid bookkeeping, not
   customer data — and a NULL must keep meaning "be conservative". */

test('a customer with no snapshot yet reads back null, not undefined', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueCustomerLink('Nada@Example.com');
    assert.equal(await db.customerPushSnapshot('nada@example.com'), null);
  } finally { cleanup(); }
});

test('the snapshot round-trips as an object, keyed on the normalised email', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueCustomerLink('nada@example.com');
    const sent = { email: 'nada@example.com', name: 'ندى', shippingAddresses: [{ city: 'الجيزة' }] };
    await db.markCustomerLinked('Nada@Example.com', '366742801', sent);
    assert.deepEqual(await db.customerPushSnapshot('NADA@example.com'), sent,
      'the email is the join key and must be normalised on both sides');
    assert.equal((await db.customerLinkRow('nada@example.com')).ecwid_customer_id, '366742801');
  } finally { cleanup(); }
});

test('linking without a snapshot does not erase one already stored', async () => {
  /* A later link that cannot build a payload must not destroy the discriminator
     — losing it silently reverts the customer to the conservative rule. */
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueCustomerLink('nada@example.com');
    await db.markCustomerLinked('nada@example.com', '1', { name: 'ندى' });
    await db.markCustomerLinked('nada@example.com', '1');
    assert.deepEqual(await db.customerPushSnapshot('nada@example.com'), { name: 'ندى' });
  } finally { cleanup(); }
});

test('a corrupt snapshot reads as null rather than throwing', async () => {
  /* Written through a second connection rather than adding a raw() escape hatch
     to the production API purely so a test can corrupt a row. */
  const { db, dir, cleanup } = await fresh({ onDisk: true });
  try {
    await db.enqueueCustomerLink('nada@example.com');
    const side = await openDb(path.join(dir, 'ecwid.db'));
    await side.prepare('UPDATE customer_link SET pushed_json = ? WHERE email = ?').run('{not json', 'nada@example.com');
    side.close();
    assert.equal(await db.customerPushSnapshot('nada@example.com'), null);
  } finally { cleanup(); }
});

/* ===================== orders that never reached Ecwid =====================
   The boot backfill's work list. An order counts as unsent when it has no
   Ecwid id — whether it was never queued at all (it predates the queue) or
   queued and exhausted its retries, which is where SDK-DED885 sat. */

test('an order with no Ecwid id is unsent, however it got that way', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueOrderPush('SDK-AAA111');                       // queued, never sent
    await db.enqueueOrderPush('SDK-BBB222');
    await db.markPushed('SDK-BBB222', '7483');                     // sent
    await db.enqueueOrderPush('SDK-CCC333');
    for (let i = 0; i < 9; i++) await db.markPushFailed('SDK-CCC333', 'ecwid-403', null);  // exhausted
    const unsent = (await db.unsentOrderRefs()).sort();
    assert.deepEqual(unsent, ['SDK-AAA111', 'SDK-CCC333'],
      'a pushed order must never be resent; an exhausted one must be reachable');
  } finally { cleanup(); }
});

test('resetting an exhausted order makes it due again', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueOrderPush('SDK-CCC333');
    for (let i = 0; i < 9; i++) await db.markPushFailed('SDK-CCC333', 'ecwid-403', '2099-01-01T00:00:00.000Z');
    assert.equal(await db.nextDuePush(), null, 'exhausted and not yet due');
    await db.resetPush('SDK-CCC333');
    const due = await db.nextDuePush();
    assert.equal(due && due.ref, 'SDK-CCC333');
    assert.equal(due.attempts, 0, 'the retry budget is restored, not merely delayed');
  } finally { cleanup(); }
});

/* ======================= the catalogue version =============================
   Each serverless instance holds the catalogue in memory and reloads it only
   when this number moves, so EVERY write that changes what is served has to
   move it, in the same batch as the write, and nothing else should. */

test('a fresh mirror is at catalogue version 0', async () => {
  const { db, cleanup } = await fresh();
  try { assert.equal(await db.catalogVersion(), 0); } finally { cleanup(); }
});

test('every product and category write bumps the version', async () => {
  const { db, cleanup } = await fresh();
  try {
    let v = await db.catalogVersion();
    const moved = async what => {
      const now = await db.catalogVersion();
      assert.ok(now > v, what + ' must bump the catalogue version (' + v + ' -> ' + now + ')');
      v = now;
    };
    await db.upsertProducts([P(1), P(2), P(3)]);          await moved('upsertProducts');
    await db.upsertCategories([C(10)]);                   await moved('upsertCategories');
    await db.deleteProduct('3');                          await moved('deleteProduct');
    await db.deleteMissingProducts(new Set(['1']));       await moved('deleteMissingProducts');
    await db.setState('ad_folders', { contents: {} });    await moved('the ad-folder map');
  } finally { cleanup(); }
});

test('writes that do not change the catalogue leave the version alone', async () => {
  /* A bump makes every instance reload 1,500 products, so a status write or a
     no-op must not cause one. */
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1)]);
    const v = await db.catalogVersion();
    await db.upsertProducts([]);
    await db.deleteMissingProducts(new Set(['1']));     // nothing to remove
    await db.setState('last_sync', { at: 'now' });
    await db.setState('last_error', 'boom');
    await db.upsertPaymentMethods([{ id: 'cod', title: 'COD', enabled: true, order: 1 }]);
    await db.enqueueOrderPush('SDK-1');
    assert.equal(await db.catalogVersion(), v);
  } finally { cleanup(); }
});

test('a refused reconcile does not bump the version either', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1)]);
    const v = await db.catalogVersion();
    await assert.rejects(db.deleteMissingProducts(new Set()), /refusing/i);
    assert.equal(await db.catalogVersion(), v);
  } finally { cleanup(); }
});

test('a 1,500-product upsert is ONE batch: the version moves by exactly one', async () => {
  /* The bump rides in the same batch as the rows, so a per-row write would
     move it 1,500 times. One batch is also one round trip on Turso. */
  const { db, cleanup } = await fresh();
  try {
    const v = await db.catalogVersion();
    const r = await db.upsertProducts(Array.from({ length: 1500 }, (_, i) => P(i + 1)));
    assert.equal(r.written, 1500);
    assert.equal(await db.catalogVersion(), v + 1);
    assert.equal((await db.allProducts()).length, 1500);
  } finally { cleanup(); }
});

test('catalogMeta reads the version and the admin status in one call', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.upsertProducts([P(1)]);
    await db.setState('last_error', 'ecwid-503');
    await db.upsertShippingMethods([{ id: 's1', title: 'x', enabled: true, order: 1 }]);
    const m = await db.catalogMeta();
    assert.equal(m.version, await db.catalogVersion());
    assert.equal(m.lastError, 'ecwid-503');
    assert.equal(m.shippingMethods, 1);
    assert.equal(m.paymentMethods, 0);
  } finally { cleanup(); }
});

/* ============================ claims and leases ============================
   Two instances working the same queue must never both push one order. */

test('an order can be claimed by exactly one worker at a time', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueOrderPush('SDK-1');
    const [a, b] = await Promise.all([db.claimPush('SDK-1'), db.claimPush('SDK-1')]);
    assert.equal([a, b].filter(Boolean).length, 1, 'both workers got the order');
    assert.equal(await db.nextDuePush(), null, 'a claimed order is not due for anyone else');
  } finally { cleanup(); }
});

test('marking the order pushed or failed releases the claim', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueOrderPush('SDK-1');
    assert.ok(await db.claimPush('SDK-1'));
    await db.markPushFailed('SDK-1', 'down', null);
    assert.equal((await db.nextDuePush()).ref, 'SDK-1', 'a failed push is due again');
    assert.ok(await db.claimPush('SDK-1'));
    await db.markPushed('SDK-1', 'EC-1');
    assert.equal(await db.claimPush('SDK-1'), false, 'a pushed order can never be claimed again');
  } finally { cleanup(); }
});

test('an expired claim can be taken over, so a crashed worker cannot hold an order', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueOrderPush('SDK-1');
    assert.ok(await db.claimPush('SDK-1', -1000));        // already expired
    assert.ok(await db.claimPush('SDK-1'));
  } finally { cleanup(); }
});

test('a customer link is claimed by one worker at a time', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.enqueueCustomerLink('a@b.co');
    assert.ok(await db.claimCustomerLink('A@B.co'));
    assert.equal(await db.claimCustomerLink('a@b.co'), false);
    assert.deepEqual(await db.dueCustomerLinks(), [], 'a claimed link is not due');
    await db.markCustomerLinkFailed('a@b.co', 'x', null);
    assert.equal((await db.dueCustomerLinks()).length, 1);
  } finally { cleanup(); }
});

test('a lease is held by one owner until released or expired', async () => {
  const { db, cleanup } = await fresh();
  try {
    const a = await db.acquireLease('sync_all', 60_000);
    assert.ok(a);
    assert.equal(await db.acquireLease('sync_all', 60_000), null);
    await db.releaseLease('sync_all', 'not-the-owner');
    assert.equal(await db.acquireLease('sync_all', 60_000), null, 'only the owner may release');
    await db.releaseLease('sync_all', a);
    const b = await db.acquireLease('sync_all', -1);       // taken, already expired
    assert.ok(b);
    assert.ok(await db.acquireLease('sync_all', 60_000), 'an expired lease is free');
  } finally { cleanup(); }
});
