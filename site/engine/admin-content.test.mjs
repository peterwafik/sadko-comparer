// site/engine/admin-content.test.mjs
// compare-server.mjs is a server module that opens databases and binds a port,
// so — exactly like product-ids.test.mjs and shop-wiring.test.mjs — this reads
// the source and asserts on the declaration rather than importing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const block = /const ADMIN_CONTENT = \{([\s\S]*?)\n\};/.exec(src);

test('ADMIN_CONTENT is declared and parseable', () => {
  assert.ok(block, 'ADMIN_CONTENT declaration not found');
});

test('every ADMIN_CONTENT entry points at a data file that exists', () => {
  for (const m of block[1].matchAll(/file:\s*'([^']+)'/g))
    assert.ok(existsSync(path.join(SITE, 'data', m[1])), `missing data/${m[1]}`);
});

test('each entry carries a bilingual label for the admin UI', () => {
  const labels = [...block[1].matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(labels.length >= 3, 'expected at least three editable content files');
  for (const l of labels) assert.match(l, / \/ /, `label "${l}" is not bilingual`);
});

test('promos is owner-editable', () => {
  /* Ecwid has no banner entity. Banner ARTWORK can now come from the dedicated
     Ecwid category, but derived banners carry no English — the store holds no
     usable translations — so data/promos.json remains the bilingual source and
     the fallback when that category is empty. It has to be editable. */
  assert.match(block[1], /promos:\s*\{\s*file:\s*'promos\.json'/);
});

/* ---- what must NOT be editable here ---- */

test('the product catalogue is NOT an editable content file', () => {
  /* Ecwid owns products. Offering a JSON editor for products.json would let
     someone edit the seed file and see nothing change, because the mirror is
     what gets served. */
  assert.ok(!/products\.json/.test(block[1]),
    'products.json must not be editable: Ecwid owns the catalogue');
});

test('collections.json is NOT an editable content file', () => {
  /* The rails are derived from Ecwid category membership when the mirror is
     live (engine/ecwid-rails.mjs). Editing the static file would appear to
     work and then silently do nothing — the worst kind of admin control. */
  assert.ok(!/collections\.json/.test(block[1]),
    'collections.json must not be editable: rails are derived from Ecwid');
});

test('the editable set is exactly what we expect, so an addition is deliberate', () => {
  const keys = [...block[1].matchAll(/^\s*(\w+):\s*\{/gm)].map(m => m[1]).sort();
  assert.deepEqual(keys, ['finder', 'guides', 'promos'],
    'adding a content file here is a decision — update this test with it');
});

/* ---- the server list and the admin UI list must not drift ---- */

const adminJs = readFileSync(path.join(SITE, 'assets', 'js', 'admin.js'), 'utf8');

test('admin.js offers exactly the content files the server registers', () => {
  /* A file registered on the server but missing from CONTENT_FILES is simply
     invisible to the owner — which is how promos was added server-side and
     still could not be edited. */
  const serverKeys = [...block[1].matchAll(/^\s*(\w+):\s*\{/gm)].map(m => m[1]).sort();
  const uiBlock = /const CONTENT_FILES = \[([\s\S]*?)\];/.exec(adminJs);
  assert.ok(uiBlock, 'CONTENT_FILES not found in admin.js');
  const uiKeys = [...uiBlock[1].matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(uiKeys, serverKeys,
    `admin.js offers [${uiKeys}] but the server registers [${serverKeys}]`);
});

test('every content file has a label key in BOTH languages', () => {
  /* A missing key renders as the raw key, or as blank, depending on the
     lookup — either way the owner sees a button with no name. */
  const uiBlock = /const CONTENT_FILES = \[([\s\S]*?)\];/.exec(adminJs);
  const keys = [...uiBlock[1].matchAll(/k:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(keys.length, 'no label keys found');
  for (const k of keys) {
    const uses = adminJs.split(k + ':').length - 1;
    assert.ok(uses >= 2, `${k} is defined ${uses} time(s); it needs an Arabic and an English label`);
  }
});
