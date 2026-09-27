// site/engine/ecwid-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openEcwidStore } from './ecwid-store.mjs';

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-ecwid-'));
  const db = openEcwidStore(path.join(dir, 'ecwid.db'));
  return { db, dir, cleanup: () => { try { db.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
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

test('upsert then read back returns the product with every field intact', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1)]);
    const [r] = db.allProducts();
    assert.equal(r.id, '1');
    assert.equal(r.title, 'ثلاجة 1');
    assert.equal(r.price, 1001);
    assert.equal(r.inStock, true);
    assert.equal(r.compareToPrice, null);
    assert.deepEqual(r.categoryIds, ['206629517']);
    assert.deepEqual(r.images, ['i1.webp']);
  } finally { cleanup(); }
});

test('upsert is idempotent — the same id twice leaves one row, updated', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1)]);
    db.upsertProducts([P(1, { price: 2222, title: 'ثلاجة معدلة' })]);
    const rows = db.allProducts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, 2222);
    assert.equal(rows[0].title, 'ثلاجة معدلة');
  } finally { cleanup(); }
});

test('a real was-price and its percentage survive the round trip', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1, { price: 18500, compareToPrice: 23900, discountPercent: 23 })]);
    const [r] = db.allProducts();
    assert.equal(r.compareToPrice, 23900);
    assert.equal(r.discountPercent, 23);
  } finally { cleanup(); }
});

test('out of stock survives as false, not as a missing row', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1, { inStock: false, quantity: 0 })]);
    const rows = db.allProducts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].inStock, false);
  } finally { cleanup(); }
});

test('a null weight stays null rather than becoming zero', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1, { weight: null })]);
    assert.equal(db.allProducts()[0].weight, null);
  } finally { cleanup(); }
});

test('a 1000-product batch writes in one transaction', () => {
  const { db, cleanup } = fresh();
  try {
    const many = Array.from({ length: 1000 }, (_, i) => P(i + 1));
    const r = db.upsertProducts(many);
    assert.equal(r.written, 1000);
    assert.equal(db.allProducts().length, 1000);
  } finally { cleanup(); }
});

/* ---- deletion and the guard that matters ---- */

test('deleteMissingProducts removes exactly what Ecwid no longer has', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2), P(3)]);
    const r = db.deleteMissingProducts(new Set(['1', '3']));
    assert.equal(r.removed, 1);
    assert.deepEqual(db.allProducts().map(p => p.id).sort(), ['1', '3']);
  } finally { cleanup(); }
});

test('deleteMissingProducts with an empty keep-set is REFUSED', () => {
  /* An API call that failed or returned nothing would otherwise wipe the whole
     catalogue. The mirror must survive a bad reconcile. */
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    assert.throws(() => db.deleteMissingProducts(new Set()), /refusing/i);
    assert.equal(db.allProducts().length, 2, 'a failed reconcile must not empty the mirror');
  } finally { cleanup(); }
});

test('deleteMissingProducts with a null keep-set is refused too', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1)]);
    assert.throws(() => db.deleteMissingProducts(null), /refusing/i);
    assert.equal(db.allProducts().length, 1);
  } finally { cleanup(); }
});

test('deleteProduct removes one row', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    db.deleteProduct('1');
    assert.deepEqual(db.allProducts().map(p => p.id), ['2']);
  } finally { cleanup(); }
});

test('productIds returns a set for the reconcile to diff against', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2)]);
    assert.deepEqual([...db.productIds()].sort(), ['1', '2']);
  } finally { cleanup(); }
});

/* ---- categories ---- */

test('categories upsert and read back, ordered by their Ecwid order', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertCategories([C(20, { order: 20, name: 'ديفروست' }), C(10, { order: 10 })]);
    const got = db.allCategories();
    assert.equal(got.length, 2);
    assert.equal(got[0].order, 10);
    assert.equal(got[1].name, 'ديفروست');
  } finally { cleanup(); }
});

test('a null nameEn round-trips as null, not as the string "null"', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertCategories([C(10, { nameEn: null })]);
    assert.equal(db.allCategories()[0].nameEn, null);
  } finally { cleanup(); }
});

/* ---- payment and shipping methods (revision 2) ---- */

test('payment methods upsert and read back in order', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertPaymentMethods([
      { id: 'cod', title: 'Cash on Delivery', enabled: true, order: 1, instructions: '' },
      { id: 'valu', title: 'Valu', enabled: true, order: 2, instructions: '<p>سيتم التواصل</p>' },
    ]);
    const got = db.allPaymentMethods();
    assert.equal(got.length, 2);
    assert.equal(got[0].id, 'cod');
    assert.match(got[1].instructions, /سيتم التواصل/);
  } finally { cleanup(); }
});

test('replacing the payment list removes methods Ecwid no longer offers', () => {
  /* A method disabled in Ecwid must stop being offered at checkout, so this
     is a full replace rather than a merge. */
  const { db, cleanup } = fresh();
  try {
    db.upsertPaymentMethods([{ id: 'cod', title: 'COD', enabled: true, order: 1 },
                             { id: 'gone', title: 'Old', enabled: true, order: 2 }]);
    db.upsertPaymentMethods([{ id: 'cod', title: 'COD', enabled: true, order: 1 }]);
    assert.deepEqual(db.allPaymentMethods().map(m => m.id), ['cod']);
  } finally { cleanup(); }
});

test('shipping methods upsert and read back', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertShippingMethods([{ id: 's1', title: 'القاهرة الكبرى', enabled: true, order: 1, calcType: 'table' }]);
    const [m] = db.allShippingMethods();
    assert.equal(m.title, 'القاهرة الكبرى');
    assert.equal(m.calcType, 'table');
  } finally { cleanup(); }
});

/* ---- sync state ---- */

test('state round-trips JSON values', () => {
  const { db, cleanup } = fresh();
  try {
    db.setState('last_sync', { at: '2026-09-21T00:00:00Z', count: 1453 });
    assert.deepEqual(db.getState('last_sync'), { at: '2026-09-21T00:00:00Z', count: 1453 });
    assert.equal(db.getState('never_set'), null);
  } finally { cleanup(); }
});

test('setting state to null clears it without throwing', () => {
  const { db, cleanup } = fresh();
  try {
    db.setState('last_error', 'boom');
    db.setState('last_error', null);
    assert.equal(db.getState('last_error'), null);
  } finally { cleanup(); }
});

test('stats reports what the admin panel needs', () => {
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([P(1), P(2, { inStock: false }), P(3, { compareToPrice: 99999, discountPercent: 50 })]);
    db.upsertCategories([C(10)]);
    db.setState('last_error', 'ecwid-503');
    const s = db.stats();
    assert.equal(s.products, 3);
    assert.equal(s.categories, 1);
    assert.equal(s.outOfStock, 1);
    assert.equal(s.discounted, 1);
    assert.equal(s.lastError, 'ecwid-503');
  } finally { cleanup(); }
});

test('reopening the same file keeps the data — migrations are idempotent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-ecwid-re-'));
  const file = path.join(dir, 'ecwid.db');
  try {
    const a = openEcwidStore(file); a.upsertProducts([P(9)]); a.close();
    const b = openEcwidStore(file);
    assert.equal(b.allProducts().length, 1);
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an empty batch is a no-op rather than an error', () => {
  const { db, cleanup } = fresh();
  try {
    assert.equal(db.upsertProducts([]).written, 0);
    assert.equal(db.upsertCategories([]).written, 0);
    assert.equal(db.allProducts().length, 0);
  } finally { cleanup(); }
});

test('stats scopes out-of-stock to ENABLED products only', () => {
  /* The live store has 463 DISABLED shells with no stock tracking, so they map
     to inStock: true. Counting them would make the out-of-stock figure
     meaningless. What matters is: of the products a customer could see, how
     many cannot be bought. */
  const { db, cleanup } = fresh();
  try {
    db.upsertProducts([
      P(1, { enabled: true, inStock: true }),
      P(2, { enabled: true, inStock: false }),
      P(3, { enabled: false, inStock: true, incomplete: true }),   // a shell
    ]);
    const s = db.stats();
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

test('a customer with no snapshot yet reads back null, not undefined', () => {
  const { db, cleanup } = fresh();
  try {
    db.enqueueCustomerLink('Nada@Example.com');
    assert.equal(db.customerPushSnapshot('nada@example.com'), null);
  } finally { cleanup(); }
});

test('the snapshot round-trips as an object, keyed on the normalised email', () => {
  const { db, cleanup } = fresh();
  try {
    db.enqueueCustomerLink('nada@example.com');
    const sent = { email: 'nada@example.com', name: 'ندى', shippingAddresses: [{ city: 'الجيزة' }] };
    db.markCustomerLinked('Nada@Example.com', '366742801', sent);
    assert.deepEqual(db.customerPushSnapshot('NADA@example.com'), sent,
      'the email is the join key and must be normalised on both sides');
    assert.equal(db.customerLinkRow('nada@example.com').ecwid_customer_id, '366742801');
  } finally { cleanup(); }
});

test('linking without a snapshot does not erase one already stored', () => {
  /* A later link that cannot build a payload must not destroy the discriminator
     — losing it silently reverts the customer to the conservative rule. */
  const { db, cleanup } = fresh();
  try {
    db.enqueueCustomerLink('nada@example.com');
    db.markCustomerLinked('nada@example.com', '1', { name: 'ندى' });
    db.markCustomerLinked('nada@example.com', '1');
    assert.deepEqual(db.customerPushSnapshot('nada@example.com'), { name: 'ندى' });
  } finally { cleanup(); }
});

test('a corrupt snapshot reads as null rather than throwing', () => {
  /* Written through a second connection rather than adding a raw() escape hatch
     to the production API purely so a test can corrupt a row. */
  const { db, dir, cleanup } = fresh();
  try {
    db.enqueueCustomerLink('nada@example.com');
    const side = new DatabaseSync(path.join(dir, 'ecwid.db'));
    side.prepare('UPDATE customer_link SET pushed_json = ? WHERE email = ?').run('{not json', 'nada@example.com');
    side.close();
    assert.equal(db.customerPushSnapshot('nada@example.com'), null);
  } finally { cleanup(); }
});

/* ===================== orders that never reached Ecwid =====================
   The boot backfill's work list. An order counts as unsent when it has no
   Ecwid id — whether it was never queued at all (it predates the queue) or
   queued and exhausted its retries, which is where SDK-DED885 sat. */

test('an order with no Ecwid id is unsent, however it got that way', () => {
  const { db, cleanup } = fresh();
  try {
    db.enqueueOrderPush('SDK-AAA111');                       // queued, never sent
    db.enqueueOrderPush('SDK-BBB222');
    db.markPushed('SDK-BBB222', '7483');                     // sent
    db.enqueueOrderPush('SDK-CCC333');
    for (let i = 0; i < 9; i++) db.markPushFailed('SDK-CCC333', 'ecwid-403', null);  // exhausted
    const unsent = db.unsentOrderRefs().sort();
    assert.deepEqual(unsent, ['SDK-AAA111', 'SDK-CCC333'],
      'a pushed order must never be resent; an exhausted one must be reachable');
  } finally { cleanup(); }
});

test('resetting an exhausted order makes it due again', () => {
  const { db, cleanup } = fresh();
  try {
    db.enqueueOrderPush('SDK-CCC333');
    for (let i = 0; i < 9; i++) db.markPushFailed('SDK-CCC333', 'ecwid-403', '2099-01-01T00:00:00.000Z');
    assert.equal(db.nextDuePush(), null, 'exhausted and not yet due');
    db.resetPush('SDK-CCC333');
    const due = db.nextDuePush();
    assert.equal(due && due.ref, 'SDK-CCC333');
    assert.equal(due.attempts, 0, 'the retry budget is restored, not merely delayed');
  } finally { cleanup(); }
});
