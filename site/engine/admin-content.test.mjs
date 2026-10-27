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

test('scenes are owner-editable: the home page text and points exist only on the site', () => {
  assert.match(block[1], /scenes:\s*\{\s*file:\s*'scenes\.json'/);
});

/* ---- what must NOT be editable here ---- */

test('adverts are NOT an editable content file: they live in Ecwid ad folders', () => {
  assert.ok(!/promos/.test(block[1]), 'promos.json must not be editable here; the portal edits the ads in Ecwid');
});

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
  assert.deepEqual(keys, ['finder', 'guides', 'scenes'],
    'adding a content file here is a decision — update this test with it');
});

/* ---- the server list and the admin UI list must not drift ---- */

const adminJs = readFileSync(path.join(SITE, 'assets', 'js', 'admin', 'pages-site.js'), 'utf8');

test('every content file the server registers has a page in the portal that edits it', () => {
  /* A file registered on the server with no page is simply invisible to the
     owner, which is how promos was once added server-side and could not be
     edited. guides and finder use the structured editor; scenes has its own. */
  const serverKeys = [...block[1].matchAll(/^\s*(\w+):\s*\{/gm)].map(m => m[1]).sort();
  const edited = new Set([...adminJs.matchAll(/contentPage\('\w+', '(\w+)'/g)].map(m => m[1]));
  if (/A\.api\('PUT', 'content\/scenes'/.test(adminJs)) edited.add('scenes');
  assert.deepEqual([...edited].sort(), serverKeys);
});

test('no content page is a raw JSON textarea', () => {
  assert.match(adminJs, /function editor\(value, onChange\)/, 'the structured form editor exists');
  assert.ok(!/<textarea[^>]*>' \+ esc\(c\.json\)/.test(adminJs));
});
