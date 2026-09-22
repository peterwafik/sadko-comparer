// site/engine/ecwid-admin.test.mjs
// The admin routes need an authenticated admin session, so — like
// admin-content.test.mjs and shop-wiring.test.mjs — this asserts on the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const adminJs = readFileSync(path.join(SITE, 'assets', 'js', 'admin.js'), 'utf8');
const adminBlock = /if \(u\.pathname\.startsWith\('\/api\/admin\/'\)\)[\s\S]*?\n  \}/.exec(src);

test('the admin block is locatable', () => {
  assert.ok(adminBlock, '/api/admin/ block not found');
});

/* ------------------------------- routes --------------------------------- */

test('there is an Ecwid status route', () => {
  assert.match(adminBlock[0], /rest === 'ecwid' && req\.method === 'GET'/);
});

test('there is a manual sync route', () => {
  assert.match(adminBlock[0], /seg\[1\] === 'sync' && req\.method === 'POST'/);
});

test('the status route reports through describe(), not by reading env directly', () => {
  /* describe() is the only surface that is guaranteed token-free. */
  const route = /rest === 'ecwid' && req\.method === 'GET'[\s\S]{0,900}/.exec(adminBlock[0])[0];
  assert.match(route, /ecwidSource\(\)\.describe\(\)/);
});

/* ---------------------------- token safety ------------------------------ */

test('no admin response can carry the token', () => {
  assert.ok(!/SADKO_ECWID_TOKEN/.test(adminBlock[0]),
    'the admin block must never touch the token env var');
  assert.ok(!/ECWID_TOKEN\b/.test(adminBlock[0]),
    'the admin block must not reference the token constant either');
});

test('the webhook secret is not exposed through admin either', () => {
  assert.ok(!/SADKO_ECWID_WEBHOOK_SECRET/.test(adminBlock[0]));
});

test('admin.js never asks for or renders a token', () => {
  assert.ok(!/token/i.test(/renderEcwidPanel[\s\S]{0,2500}/.exec(adminJs)?.[0] || ''),
    'the Ecwid panel must not mention a token');
});

/* --------------------- Ecwid-owned field protection --------------------- */

test('ECWID_OWNED_FIELDS is declared and covers what Ecwid owns', () => {
  assert.match(src, /const ECWID_OWNED_FIELDS = \[/);
  const owned = /const ECWID_OWNED_FIELDS = \[([^\]]*)\]/.exec(src)[1];
  for (const f of ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand'])
    assert.match(owned, new RegExp("'" + f + "'"), `${f} should be Ecwid-owned`);
});

test('badge stays site-editable', () => {
  /* Ecwid has a ribbon field, but this store sets none, so badge is the one
     product field the local overlay still usefully owns. */
  const owned = /const ECWID_OWNED_FIELDS = \[([^\]]*)\]/.exec(src)[1];
  assert.ok(!/'badge'/.test(owned), 'badge must remain editable locally');
});

test('a PATCH touching an Ecwid-owned field is refused with a reason', () => {
  assert.match(adminBlock[0], /ecwid-owned/);
});

test('creating a product is refused while Ecwid is the source', () => {
  /* A product added locally would vanish on the next sync, so the editor must
     say so rather than accept it and lose the work. */
  const post = /seg\[0\] === 'products' && seg\.length === 1 && req\.method === 'POST'[\s\S]{0,700}/.exec(adminBlock[0])[0];
  assert.match(post, /ecwid-owned|activeSource\(\) === 'ecwid'/);
});

test('the field guard only applies while Ecwid is actually the source', () => {
  /* With the flag off, the overlay is the only way to edit anything and must
     keep working exactly as before. */
  assert.match(adminBlock[0], /activeSource\(\) === 'ecwid'/);
});

/* ------------------------------- the panel ------------------------------ */

test('admin.js renders an Ecwid panel and links out to the Ecwid admin', () => {
  assert.match(adminJs, /renderEcwidPanel/);
  assert.match(adminJs, /my\.ecwid\.com|shopsettings\.com/, 'no deep link to the Ecwid admin');
});

test('the panel has a sync-now control wired to the route', () => {
  assert.match(adminJs, /adm-ecwid-sync/);
  assert.match(adminJs, /ecwid\/sync/);
});

test('the panel labels exist in both languages', () => {
  for (const k of ['ecwidTitle', 'ecwidSyncNow'])
    assert.ok(adminJs.split(k + ':').length - 1 >= 2,
      `${k} needs an Arabic and an English label`);
});

/* --------------- what Task 14 deliberately does NOT do ----------------- */

test('the order status control is still writable, because Ecwid does not own it yet', () => {
  /* The plan had the orders desk go read-only here. That is only safe once
     order status flows back FROM Ecwid (Task 13). setOrderStatus is currently
     the ONLY way any order status gets written, so removing it now would leave
     staff unable to update a single order. Deferred on purpose. */
  assert.match(src, /db\.setOrderStatus\(/,
    'the local order status write must remain until Task 13 replaces it');
});
