// site/engine/catalog-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { openCatalogAdmin, EDITABLE_FIELDS, UPLOAD_MAX_BYTES } from './catalog-admin.mjs';

/* :memory: per test: fast, and nothing left on disk. The reopen tests below use
   a real file, which libSQL on Windows may still hold for a moment after close. */
async function fresh() {
  const db = await openCatalogAdmin(':memory:');
  return { db, cleanup: () => { try { db.close(); } catch (e) {} } };
}
const rmQuiet = (dir) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (e) {} };
const BASE = [
  { id: '1', title: 'ثلاجة', price: 1000, image: 'a.webp', description: 'd', categoryId: 'c1' },
  { id: '2', title: 'غسالة', price: 2000, image: 'b.webp', description: 'e', categoryId: 'c2' },
  { id: '3', title: 'بوتاجاز', price: 3000, image: 'c.webp', description: 'f', categoryId: 'c1' },
];

test('override applies only whitelisted fields and merges onto base', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setOverride('1', { price: 1500, title: 'ثلاجة مخفّضة', evil: 'x', id: 'hack' }, 'owner@x');
    const merged = await db.merge(BASE);
    const p1 = merged.find(p => p.id === '1');
    assert.equal(p1.price, 1500);
    assert.equal(p1.title, 'ثلاجة مخفّضة');
    assert.equal(p1.image, 'a.webp');           // untouched
    assert.equal(p1.id, '1');                    // id can never be overridden
    assert.ok(!('evil' in p1));                  // non-editable key dropped
    assert.equal(merged.length, 3);
  } finally { cleanup(); }
});

test('price is coerced to a sane integer; garbage is ignored', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setOverride('1', { price: '1750.9' }, 'o');
    assert.equal((await db.merge(BASE)).find(p => p.id === '1').price, 1751);
    await db.setOverride('2', { price: -5 }, 'o');            // negative rejected
    assert.equal((await db.merge(BASE)).find(p => p.id === '2').price, 2000);
    await db.setOverride('2', { price: 'abc' }, 'o');         // NaN rejected
    assert.equal((await db.merge(BASE)).find(p => p.id === '2').price, 2000);
  } finally { cleanup(); }
});

test('setting a field to null reverts it to the scraped value', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setOverride('1', { price: 1500 }, 'o');
    await db.setOverride('1', { price: null }, 'o');
    assert.equal((await db.merge(BASE)).find(p => p.id === '1').price, 1000);
    // with no keys left, the override row is gone
    assert.equal((await db.stats()).overrides, 0);
  } finally { cleanup(); }
});

test('revert drops the whole override', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setOverride('1', { price: 1500, title: 'x' }, 'o');
    await db.revert('1', 'o');
    const p1 = (await db.merge(BASE)).find(p => p.id === '1');
    assert.equal(p1.price, 1000);
    assert.equal(p1.title, 'ثلاجة');
    assert.ok((await db.audit(5)).some(r => r.action === 'product.revert'));
  } finally { cleanup(); }
});

test('hide removes from storefront; unhide brings it back', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.hide('2', 'o');
    assert.deepEqual((await db.merge(BASE)).map(p => p.id), ['1', '3']);
    await db.unhide('2', 'o');
    assert.equal((await db.merge(BASE)).length, 3);
  } finally { cleanup(); }
});

test('custom products get an adm- id, appear in the merge, and delete fully', async () => {
  const { db, cleanup } = await fresh();
  try {
    const r = await db.createProduct({ title: 'منتج جديد', price: 999 }, 'o');
    assert.ok(r.ok);
    assert.match(r.product.id, /^adm-/);
    assert.ok(r.product._custom);
    const merged = await db.merge(BASE);
    assert.equal(merged.length, 4);
    assert.ok(merged.some(p => p.id === r.product.id && p.title === 'منتج جديد'));
    // update it
    await db.updateCustom(r.product.id, { price: 888 }, 'o');
    assert.equal((await db.merge(BASE)).find(p => p.id === r.product.id).price, 888);
    // delete it (custom => gone entirely, including any hidden/override rows)
    await db.hide(r.product.id, 'o');
    const del = await db.remove(r.product.id, 'o');
    assert.equal(del.deleted, 'custom');
    assert.equal((await db.merge(BASE)).length, 3);
    assert.deepEqual(await db.stats(), { overrides: 0, custom: 0, hidden: 0 });
    assert.equal((await db.updateCustom(r.product.id, { price: 1 }, 'o')).error, 'not-found');
  } finally { cleanup(); }
});

test('creating a product without a title is rejected', async () => {
  const { db, cleanup } = await fresh();
  try { assert.equal((await db.createProduct({ price: 10 }, 'o')).error, 'title-required'); }
  finally { cleanup(); }
});

test('remove() on a base product hides it (a re-crawl must not resurrect a deletion as an edit)', async () => {
  const { db, cleanup } = await fresh();
  try {
    const r = await db.remove('1', 'o');
    assert.equal(r.deleted, 'hidden');
    assert.ok(!(await db.merge(BASE)).some(p => p.id === '1'));
  } finally { cleanup(); }
});

test('describe returns base, override and the merged product for the editor', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setOverride('3', { price: 2500 }, 'o');
    const d = await db.describe(BASE, '3');
    assert.equal(d.base.price, 3000);
    assert.equal(d.override.price, 2500);
    assert.equal(d.product.price, 2500);
    assert.equal(d.hidden, false);
    assert.equal(await db.describe(BASE, 'nope'), null);
  } finally { cleanup(); }
});

test('settings round-trip and persist typed values', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setSetting('hotline', '19140', 'o');
    await db.setSetting('freeShipping', true, 'o');
    assert.equal(await db.getSetting('hotline'), '19140');
    assert.equal((await db.settings()).freeShipping, true);
    assert.equal(await db.getSetting('missing', 'fb'), 'fb');
  } finally { cleanup(); }
});

test('every mutation is written to the audit log', async () => {
  const { db, cleanup } = await fresh();
  try {
    await db.setOverride('1', { price: 1 }, 'owner@x');
    await db.hide('2', 'owner@x');
    const log = await db.audit(10);
    assert.ok(log.length >= 2);
    assert.ok(log.some(r => r.action === 'product.edit' && r.actor === 'owner@x'));
    assert.ok(log.some(r => r.action === 'product.hide'));
  } finally { cleanup(); }
});

test('EDITABLE_FIELDS never includes id', () => {
  assert.ok(!EDITABLE_FIELDS.includes('id'));
});

test('edits survive reopening the database (persistence)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-cadm-p-'));
  const file = path.join(dir, 'catalog-admin.db');
  try {
    const a = await openCatalogAdmin(file);
    await a.setOverride('1', { price: 1234 }, 'o');
    const cust = (await a.createProduct({ title: 'x' }, 'o')).product.id;
    await a.setContent('guides', '{"a":1}', 'o');
    a.close();
    const b = await openCatalogAdmin(file);           // migrations do not re-run
    assert.equal((await b.merge(BASE)).find(p => p.id === '1').price, 1234);
    assert.ok((await b.merge(BASE)).some(p => p.id === cust));
    assert.equal(await b.getContent('guides'), '{"a":1}');
    b.close();
  } finally { rmQuiet(dir); }
});

/* ---- editorial content (replaces overwriting data/<name>.json on disk) ---- */

test('content: null until saved, then the exact text, upserted and audited', async () => {
  const { db, cleanup } = await fresh();
  try {
    assert.equal(await db.getContent('guides'), null);
    const v1 = JSON.stringify({ guides: [{ id: 'g1', title: 'دليل' }] }, null, 2);
    assert.deepEqual(await db.setContent('guides', v1, 'owner@x'), { ok: true });
    assert.equal(await db.getContent('guides'), v1);
    const v2 = '{"guides":[]}';
    await db.setContent('guides', v2, 'owner@x');            // upsert, not a second row
    assert.equal(await db.getContent('guides'), v2);
    assert.equal(await db.getContent('finder'), null);       // names are independent
    const log = await db.audit(10);
    assert.equal(log.filter(r => r.action === 'content.save' && r.target === 'guides' && r.actor === 'owner@x').length, 2);
  } finally { cleanup(); }
});

test('content: invalid JSON and bad names are refused and nothing is stored', async () => {
  const { db, cleanup } = await fresh();
  try {
    await assert.rejects(db.setContent('guides', '{not json', 'o'), { code: 'bad-json' });
    assert.equal(await db.getContent('guides'), null);
    await assert.rejects(db.setContent('../etc/passwd', '{}', 'o'), { code: 'bad-name' });
    await assert.rejects(db.setContent('', '{}', 'o'), { code: 'bad-name' });
    assert.equal(await db.getContent('../etc/passwd'), null);
  } finally { cleanup(); }
});

/* ---- uploads (replaces data/uploads/ on disk) ---- */

test('uploads: bytes round-trip exactly with mime and created_at', async () => {
  const { db, cleanup } = await fresh();
  try {
    const bytes = randomBytes(200_000);
    bytes[0] = 0; bytes[1] = 0xff;                          // NULs and high bytes survive
    const name = await db.putUpload({ name: 'pabc123.webp', mime: 'image/webp', bytes, actor: 'owner@x' });
    assert.equal(name, 'pabc123.webp');
    const got = await db.getUpload('pabc123.webp');
    assert.ok(Buffer.isBuffer(got.bytes));
    assert.equal(got.bytes.length, bytes.length);
    assert.ok(got.bytes.equals(bytes));
    assert.equal(got.mime, 'image/webp');
    assert.ok(!Number.isNaN(Date.parse(got.created_at)));
    assert.equal(await db.getUpload('pnothere.png'), null);
    assert.ok((await db.audit(5)).some(r => r.action === 'image.upload' && r.target === 'pabc123.webp'));
    // mime defaults from the extension
    await db.putUpload({ name: 'pz9.jpg', bytes: Buffer.from([1, 2, 3]) });
    const jpg = await db.getUpload('pz9.jpg');
    assert.equal(jpg.mime, 'image/jpeg');
    assert.deepEqual([...jpg.bytes], [1, 2, 3]);
  } finally { cleanup(); }
});

test('uploads: bad names, oversize, empty and non-image types are refused', async () => {
  const { db, cleanup } = await fresh();
  try {
    const small = Buffer.from([1, 2, 3]);
    for (const name of ['../x.png', 'x.png', 'pABC.png', 'p1.svg', 'p1.png.html', 'p.png', 'p1.jpeg', '', undefined]) {
      await assert.rejects(db.putUpload({ name, mime: 'image/png', bytes: small }), { code: 'bad-name' }, String(name));
    }
    assert.equal(await db.getUpload('../x.png'), null);
    await assert.rejects(db.putUpload({ name: 'pbig.png', bytes: Buffer.alloc(UPLOAD_MAX_BYTES + 1) }), { code: 'too-large' });
    assert.equal(await db.getUpload('pbig.png'), null);
    await assert.rejects(db.putUpload({ name: 'pempty.png', bytes: Buffer.alloc(0) }), { code: 'bad-bytes' });
    await assert.rejects(db.putUpload({ name: 'phtml.png', mime: 'text/html', bytes: small }), { code: 'bad-mime' });
    // exactly at the cap is fine
    assert.equal(UPLOAD_MAX_BYTES, 4_500_000);
    await db.putUpload({ name: 'pcap.png', bytes: Buffer.alloc(UPLOAD_MAX_BYTES, 7) });
    assert.equal((await db.getUpload('pcap.png')).bytes.length, UPLOAD_MAX_BYTES);
  } finally { cleanup(); }
});
