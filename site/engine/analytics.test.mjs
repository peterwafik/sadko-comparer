// site/engine/analytics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAnalytics, EVENT_TYPES, FUNNEL_STAGES } from './analytics.mjs';

/* :memory: per test: fast, and nothing left on disk. The reopen tests below use
   a real file, which libSQL on Windows may still hold for a moment after close. */
async function fresh() {
  const db = await openAnalytics(':memory:');
  return { db, cleanup: () => { try { db.close(); } catch (e) {} } };
}
const rmQuiet = (dir) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (e) {} };

test('rejects an event type that is not in the whitelist', async () => {
  const { db, cleanup } = await fresh();
  try {
    assert.equal((await db.record({ vid: 'v1', type: 'hack', productId: '1' })).error, 'bad-type');
    assert.equal((await db.stats()).events, 0);
  }
  finally { cleanup(); }
});

test('funnel counts DISTINCT visitors per stage', async () => {
  const { db, cleanup } = await fresh();
  try {
    // two visitors view; one saves; one adds to cart; that same one purchases
    await db.record({ vid: 'a', type: 'view', productId: '1' });
    await db.record({ vid: 'a', type: 'view', productId: '1' });   // repeat view, same person
    await db.record({ vid: 'b', type: 'view', productId: '1' });
    await db.record({ vid: 'a', type: 'save', productId: '1' });
    await db.record({ vid: 'a', type: 'add_to_cart', productId: '1' });
    await db.record({ vid: 'a', type: 'checkout_start', productId: '1' });
    await db.recordPurchase({ vid: 'a', items: [{ id: '1', qty: 1, price: 100 }] });
    const f = await db.funnel();
    assert.deepEqual(f.map(s => s.stage), FUNNEL_STAGES);   // stages stay in journey order
    const by = Object.fromEntries(f.map(s => [s.stage, s]));
    assert.equal(by.view.people, 2);          // a and b (a's two views counted once)
    assert.equal(by.view.hits, 3);            // three raw view rows
    assert.equal(by.save.people, 1);
    assert.equal(by.add_to_cart.people, 1);
    assert.equal(by.purchase.people, 1);
    assert.equal(by.view.ofViews, 100);
    assert.equal(by.purchase.ofViews, 50);    // 1 of 2 viewers bought
  } finally { cleanup(); }
});

test('purchase events are written one per line item', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.recordPurchase({ vid: 'a', userId: 'u1', items: [{ id: '1', qty: 2, price: 50 }, { id: '2', qty: 1, price: 90 }] });
    const p1 = Object.fromEntries((await db.productFunnel('1')).map(s => [s.stage, s.people]));
    const p2 = Object.fromEntries((await db.productFunnel('2')).map(s => [s.stage, s.people]));
    assert.equal(p1.purchase, 1);
    assert.equal(p2.purchase, 1);
    // an order with no usable items writes nothing and does not throw
    await db.recordPurchase({ vid: 'a', items: [] });
    await db.recordPurchase({ vid: 'a', items: [null, {}] });
    assert.equal((await db.stats()).events, 2);
  } finally { cleanup(); }
});

test('productStatsMap folds per-product people counts by type', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.record({ vid: 'a', type: 'view', productId: '1' });
    await db.record({ vid: 'b', type: 'view', productId: '1' });
    await db.record({ vid: 'a', type: 'save', productId: '1' });
    await db.record({ vid: 'a', type: 'view', productId: '2' });
    const m = await db.productStatsMap();
    assert.equal(m['1'].view, 2);
    assert.equal(m['1'].save, 1);
    assert.equal(m['2'].view, 1);
    assert.equal(m['2'].save, undefined);
  } finally { cleanup(); }
});

test('topProducts ranks by distinct viewers', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.record({ vid: 'a', type: 'view', productId: 'popular' });
    await db.record({ vid: 'b', type: 'view', productId: 'popular' });
    await db.record({ vid: 'a', type: 'view', productId: 'quiet' });
    const top = await db.topProducts('view', 5);
    assert.equal(top[0].id, 'popular');
    assert.equal(top[0].people, 2);
  } finally { cleanup(); }
});

test('abandonment feedback stores the reason, note and cart snapshot', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.recordAbandon({ vid: 'a', reason: 'price', note: 'too expensive', value: 5000, items: [{ id: '1', title: 'ثلاجة' }] });
    await db.recordAbandon({ vid: 'b', reason: 'price' });
    await db.recordAbandon({ vid: 'c', reason: 'shipping' });
    const list = await db.abandonList(10);
    assert.equal(list.length, 3);
    assert.equal(list[0].reason, 'shipping');   // newest first
    assert.equal(list[2].note, 'too expensive');
    assert.deepEqual(list[2].items, [{ id: '1', title: 'ثلاجة' }]);
    const reasons = Object.fromEntries((await db.abandonReasons()).map(r => [r.reason, r.n]));
    assert.equal(reasons.price, 2);
    assert.equal(reasons.shipping, 1);
    assert.equal((await db.stats()).abandonments, 3);
  } finally { cleanup(); }
});

test('funnel(since) windows by time', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.record({ vid: 'old', type: 'view', productId: '1' });
    const future = new Date(Date.now() + 60000).toISOString();
    const f = Object.fromEntries((await db.funnel(future)).map(s => [s.stage, s.people]));
    assert.equal(f.view, 0);   // nothing after a future cutoff
  } finally { cleanup(); }
});

test('events older than a year are pruned; data survives reopening', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-an-p-'));
  const file = path.join(dir, 'analytics.db');
  try {
    const a = await openAnalytics(file);
    await a.record({ vid: 'a', type: 'view', productId: '1' });
    await a.raw.prepare("INSERT INTO events (at, vid, product_id, type) VALUES ('2000-01-01T00:00:00.000Z', 'z', '1', 'view')").run();
    assert.equal((await a.stats()).events, 2);
    a.close();
    const b = await openAnalytics(file);              // prune runs on open
    assert.equal((await b.stats()).events, 1);
    assert.equal(await b.prune(), 0);                 // nothing left to prune
    b.close();
  } finally { rmQuiet(dir); }
});

test('FUNNEL_STAGES is the canonical ordered journey', () => {
  assert.deepEqual(FUNNEL_STAGES, ['view', 'save', 'add_to_cart', 'checkout_start', 'purchase']);
  for (const s of FUNNEL_STAGES) assert.ok(EVENT_TYPES.includes(s));
});
