// site/engine/catalog-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { openCatalogAdmin, UPLOAD_MAX_BYTES } from './catalog-admin.mjs';

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

/* The retired product overlay: nothing can write it, the old rows are listed
   for the owner, and discarding them removes exactly that kind. */
async function seedLeftovers(db) {
  await db.raw.prepare("INSERT INTO overrides (id,patch_json,updated_at,updated_by) VALUES ('1','{\"price\":1500}','t','o')").run();
  await db.raw.prepare("INSERT INTO custom (id,data_json,created_at,created_by) VALUES ('adm-x','{\"title\":\"منتج\",\"price\":9}','t','o')").run();
  await db.raw.prepare("INSERT INTO hidden (id,at,by) VALUES ('2','t','o')").run();
  await db.raw.prepare("INSERT INTO content (name,json_text,updated_at,updated_by) VALUES ('promos','{}','t','o')").run();
}

test('the overlay can no longer be written through the store', async () => {
  const { db, cleanup } = await fresh();
  try {
    for (const m of ['setOverride', 'createProduct', 'updateCustom', 'hide', 'unhide', 'remove', 'revert', 'merge', 'describe'])
      assert.equal(typeof db[m], 'undefined', m + ' is gone');
  } finally { cleanup(); }
});

test('leftovers lists every kind the overlay used to hold', async () => {
  const { db, cleanup } = await fresh();
  try {
    await seedLeftovers(db);
    const l = await db.leftovers();
    assert.deepEqual(l.overrides, [{ id: '1', patch: { price: 1500 } }]);
    assert.deepEqual(l.custom, [{ id: 'adm-x', title: 'منتج', price: 9 }]);
    assert.deepEqual(l.hidden, ['2']);
    assert.equal(l.promos, true);
  } finally { cleanup(); }
});

test('discard removes one kind, audits it, and refuses an unknown kind', async () => {
  const { db, cleanup } = await fresh();
  try {
    await seedLeftovers(db);
    await db.discard('hidden', 'owner@x');
    const l = await db.leftovers();
    assert.deepEqual(l.hidden, []);
    assert.equal(l.overrides.length, 1, 'the others are untouched');
    await db.discard('promos', 'owner@x');
    assert.equal((await db.leftovers()).promos, false);
    assert.ok((await db.audit(5)).some(r => r.action === 'leftovers.discard' && r.target === 'hidden'));
    await assert.rejects(db.discard('users', 'x'), /unknown leftover kind/);
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

test('settings and content survive reopening the database (persistence)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-cadm-p-'));
  const file = path.join(dir, 'catalog-admin.db');
  try {
    const a = await openCatalogAdmin(file);
    await a.setSetting('site.hotline', '19141', 'o');
    await a.setContent('guides', '{"a":1}', 'o');
    a.close();
    const b = await openCatalogAdmin(file);           // migrations do not re-run
    assert.equal(await b.getSetting('site.hotline'), '19141');
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
