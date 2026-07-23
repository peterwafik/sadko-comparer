// site/engine/analytics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAnalytics, EVENT_TYPES, FUNNEL_STAGES } from './analytics.mjs';

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-an-'));
  const db = openAnalytics(path.join(dir, 'analytics.db'));
  return { db, cleanup: () => { try { db.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}

test('rejects an event type that is not in the whitelist', () => {
  const { db, cleanup } = fresh();
  try { assert.equal(db.record({ vid: 'v1', type: 'hack', productId: '1' }).error, 'bad-type'); }
  finally { cleanup(); }
});

test('funnel counts DISTINCT visitors per stage', () => {
  const { db, cleanup } = fresh();
  try {
    // two visitors view; one saves; one adds to cart; that same one purchases
    db.record({ vid: 'a', type: 'view', productId: '1' });
    db.record({ vid: 'a', type: 'view', productId: '1' });   // repeat view, same person
    db.record({ vid: 'b', type: 'view', productId: '1' });
    db.record({ vid: 'a', type: 'save', productId: '1' });
    db.record({ vid: 'a', type: 'add_to_cart', productId: '1' });
    db.record({ vid: 'a', type: 'checkout_start', productId: '1' });
    db.recordPurchase({ vid: 'a', items: [{ id: '1', qty: 1, price: 100 }] });
    const f = db.funnel();
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

test('purchase events are written one per line item', () => {
  const { db, cleanup } = fresh();
  try {
    db.recordPurchase({ vid: 'a', userId: 'u1', items: [{ id: '1', qty: 2, price: 50 }, { id: '2', qty: 1, price: 90 }] });
    const p1 = Object.fromEntries(db.productFunnel('1').map(s => [s.stage, s.people]));
    const p2 = Object.fromEntries(db.productFunnel('2').map(s => [s.stage, s.people]));
    assert.equal(p1.purchase, 1);
    assert.equal(p2.purchase, 1);
  } finally { cleanup(); }
});

test('productStatsMap folds per-product people counts by type', () => {
  const { db, cleanup } = fresh();
  try {
    db.record({ vid: 'a', type: 'view', productId: '1' });
    db.record({ vid: 'b', type: 'view', productId: '1' });
    db.record({ vid: 'a', type: 'save', productId: '1' });
    db.record({ vid: 'a', type: 'view', productId: '2' });
    const m = db.productStatsMap();
    assert.equal(m['1'].view, 2);
    assert.equal(m['1'].save, 1);
    assert.equal(m['2'].view, 1);
    assert.equal(m['2'].save, undefined);
  } finally { cleanup(); }
});

test('topProducts ranks by distinct viewers', () => {
  const { db, cleanup } = fresh();
  try {
    db.record({ vid: 'a', type: 'view', productId: 'popular' });
    db.record({ vid: 'b', type: 'view', productId: 'popular' });
    db.record({ vid: 'a', type: 'view', productId: 'quiet' });
    const top = db.topProducts('view', 5);
    assert.equal(top[0].id, 'popular');
    assert.equal(top[0].people, 2);
  } finally { cleanup(); }
});

test('abandonment feedback stores the reason, note and cart snapshot', () => {
  const { db, cleanup } = fresh();
  try {
    db.recordAbandon({ vid: 'a', reason: 'price', note: 'too expensive', value: 5000, items: [{ id: '1', title: 'ثلاجة' }] });
    db.recordAbandon({ vid: 'b', reason: 'price' });
    db.recordAbandon({ vid: 'c', reason: 'shipping' });
    const list = db.abandonList(10);
    assert.equal(list.length, 3);
    assert.equal(list[0].reason, 'shipping');   // newest first
    assert.equal(list[2].note, 'too expensive');
    assert.deepEqual(list[2].items, [{ id: '1', title: 'ثلاجة' }]);
    const reasons = Object.fromEntries(db.abandonReasons().map(r => [r.reason, r.n]));
    assert.equal(reasons.price, 2);
    assert.equal(reasons.shipping, 1);
  } finally { cleanup(); }
});

test('funnel(since) windows by time', () => {
  const { db, cleanup } = fresh();
  try {
    db.record({ vid: 'old', type: 'view', productId: '1' });
    const future = new Date(Date.now() + 60000).toISOString();
    const f = Object.fromEntries(db.funnel(future).map(s => [s.stage, s.people]));
    assert.equal(f.view, 0);   // nothing after a future cutoff
  } finally { cleanup(); }
});

test('FUNNEL_STAGES is the canonical ordered journey', () => {
  assert.deepEqual(FUNNEL_STAGES, ['view', 'save', 'add_to_cart', 'checkout_start', 'purchase']);
  for (const s of FUNNEL_STAGES) assert.ok(EVENT_TYPES.includes(s));
});
