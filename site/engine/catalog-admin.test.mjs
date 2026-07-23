// site/engine/catalog-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openCatalogAdmin, EDITABLE_FIELDS } from './catalog-admin.mjs';

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-cadm-'));
  const db = openCatalogAdmin(path.join(dir, 'catalog-admin.db'));
  return { db, cleanup: () => { try { db.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}
const BASE = [
  { id: '1', title: 'ثلاجة', price: 1000, image: 'a.webp', description: 'd', categoryId: 'c1' },
  { id: '2', title: 'غسالة', price: 2000, image: 'b.webp', description: 'e', categoryId: 'c2' },
  { id: '3', title: 'بوتاجاز', price: 3000, image: 'c.webp', description: 'f', categoryId: 'c1' },
];

test('override applies only whitelisted fields and merges onto base', () => {
  const { db, cleanup } = fresh();
  try {
    db.setOverride('1', { price: 1500, title: 'ثلاجة مخفّضة', evil: 'x', id: 'hack' }, 'owner@x');
    const merged = db.merge(BASE);
    const p1 = merged.find(p => p.id === '1');
    assert.equal(p1.price, 1500);
    assert.equal(p1.title, 'ثلاجة مخفّضة');
    assert.equal(p1.image, 'a.webp');           // untouched
    assert.equal(p1.id, '1');                    // id can never be overridden
    assert.ok(!('evil' in p1));                  // non-editable key dropped
    assert.equal(merged.length, 3);
  } finally { cleanup(); }
});

test('price is coerced to a sane integer; garbage is ignored', () => {
  const { db, cleanup } = fresh();
  try {
    db.setOverride('1', { price: '1750.9' }, 'o');
    assert.equal(db.merge(BASE).find(p => p.id === '1').price, 1751);
    db.setOverride('2', { price: -5 }, 'o');            // negative rejected
    assert.equal(db.merge(BASE).find(p => p.id === '2').price, 2000);
    db.setOverride('2', { price: 'abc' }, 'o');         // NaN rejected
    assert.equal(db.merge(BASE).find(p => p.id === '2').price, 2000);
  } finally { cleanup(); }
});

test('setting a field to null reverts it to the scraped value', () => {
  const { db, cleanup } = fresh();
  try {
    db.setOverride('1', { price: 1500 }, 'o');
    db.setOverride('1', { price: null }, 'o');
    assert.equal(db.merge(BASE).find(p => p.id === '1').price, 1000);
    // with no keys left, the override row is gone
    assert.equal(db.stats().overrides, 0);
  } finally { cleanup(); }
});

test('hide removes from storefront; unhide brings it back', () => {
  const { db, cleanup } = fresh();
  try {
    db.hide('2', 'o');
    assert.deepEqual(db.merge(BASE).map(p => p.id), ['1', '3']);
    db.unhide('2', 'o');
    assert.equal(db.merge(BASE).length, 3);
  } finally { cleanup(); }
});

test('custom products get an adm- id, appear in the merge, and delete fully', () => {
  const { db, cleanup } = fresh();
  try {
    const r = db.createProduct({ title: 'منتج جديد', price: 999 }, 'o');
    assert.ok(r.ok);
    assert.match(r.product.id, /^adm-/);
    assert.ok(r.product._custom);
    const merged = db.merge(BASE);
    assert.equal(merged.length, 4);
    assert.ok(merged.some(p => p.id === r.product.id && p.title === 'منتج جديد'));
    // update it
    db.updateCustom(r.product.id, { price: 888 }, 'o');
    assert.equal(db.merge(BASE).find(p => p.id === r.product.id).price, 888);
    // delete it (custom => gone entirely)
    const del = db.remove(r.product.id, 'o');
    assert.equal(del.deleted, 'custom');
    assert.equal(db.merge(BASE).length, 3);
  } finally { cleanup(); }
});

test('creating a product without a title is rejected', () => {
  const { db, cleanup } = fresh();
  try { assert.equal(db.createProduct({ price: 10 }, 'o').error, 'title-required'); }
  finally { cleanup(); }
});

test('remove() on a base product hides it (a re-crawl must not resurrect a deletion as an edit)', () => {
  const { db, cleanup } = fresh();
  try {
    const r = db.remove('1', 'o');
    assert.equal(r.deleted, 'hidden');
    assert.ok(!db.merge(BASE).some(p => p.id === '1'));
  } finally { cleanup(); }
});

test('describe returns base, override and the merged product for the editor', () => {
  const { db, cleanup } = fresh();
  try {
    db.setOverride('3', { price: 2500 }, 'o');
    const d = db.describe(BASE, '3');
    assert.equal(d.base.price, 3000);
    assert.equal(d.override.price, 2500);
    assert.equal(d.product.price, 2500);
    assert.equal(d.hidden, false);
    assert.equal(db.describe(BASE, 'nope'), null);
  } finally { cleanup(); }
});

test('settings round-trip and persist typed values', () => {
  const { db, cleanup } = fresh();
  try {
    db.setSetting('hotline', '19140', 'o');
    db.setSetting('freeShipping', true, 'o');
    assert.equal(db.getSetting('hotline'), '19140');
    assert.equal(db.settings().freeShipping, true);
  } finally { cleanup(); }
});

test('every mutation is written to the audit log', () => {
  const { db, cleanup } = fresh();
  try {
    db.setOverride('1', { price: 1 }, 'owner@x');
    db.hide('2', 'owner@x');
    const log = db.audit(10);
    assert.ok(log.length >= 2);
    assert.ok(log.some(r => r.action === 'product.edit' && r.actor === 'owner@x'));
    assert.ok(log.some(r => r.action === 'product.hide'));
  } finally { cleanup(); }
});

test('EDITABLE_FIELDS never includes id', () => {
  assert.ok(!EDITABLE_FIELDS.includes('id'));
});

test('edits survive reopening the database (persistence)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-cadm-p-'));
  const file = path.join(dir, 'catalog-admin.db');
  try {
    const a = openCatalogAdmin(file);
    a.setOverride('1', { price: 1234 }, 'o');
    const cust = a.createProduct({ title: 'x' }, 'o').product.id;
    a.close();
    const b = openCatalogAdmin(file);
    assert.equal(b.merge(BASE).find(p => p.id === '1').price, 1234);
    assert.ok(b.merge(BASE).some(p => p.id === cust));
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
