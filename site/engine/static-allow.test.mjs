// site/engine/static-allow.test.mjs
//
// The static handler used to serve EVERY file under site/. On the live VM that
// meant https://…/data/accounts.db downloaded the customer database — emails,
// names, phones, addresses, password hashes and orders — along with the other
// databases, the server source, the tools and any log. The fix is an allow-list:
// the browser needs pages, assets and six JSON files, and nothing else is served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isPublicPath } from './static-allow.mjs';

const SITE = path.join(import.meta.dirname, '..');

test('the databases are never served', () => {
  for (const p of ['/data/accounts.db', '/data/accounts.db-wal', '/data/accounts.db-shm',
    '/data/analytics.db', '/data/catalog.db', '/data/catalog-admin.db', '/data/ecwid.db']) {
    assert.equal(isPublicPath(p), false, p + ' must not be served');
  }
});

test('secrets, logs and backups are never served', () => {
  for (const p of ['/.env', '/.ecwid.env', '/.ecwid.env.bak', '/.env.example', '/.git/config',
    '/preview.log', '/server.err.log', '/server.out.log', '/assets/.hidden', '/start-comparer.bat']) {
    assert.equal(isPublicPath(p), false, p + ' must not be served');
  }
});

test('server code, tools, tests and fixtures are never served', () => {
  for (const p of ['/compare-server.mjs', '/headless.mjs', '/mkcategories.mjs',
    '/engine/ecwid-api.mjs', '/engine/fixtures/ecwid-profile.json', '/engine/accounts.test.mjs',
    '/tools/set-ecwid-token.mjs', '/data/stores.json', '/data/price-index.json']) {
    assert.equal(isPublicPath(p), false, p + ' must not be served');
  }
});

test('traversal and encoding tricks cannot reach a private file', () => {
  for (const p of ['/assets/../data/accounts.db', '/assets/..%2Fdata/accounts.db', '/category/../engine/x.mjs',
    '/assets\\..\\data\\accounts.db', '/data/products.json/../accounts.db', '//data/accounts.db', '/DATA/ACCOUNTS.DB',
    '/data/accounts.db%00.json', '/data/accounts.db\u0000.json']) {
    assert.equal(isPublicPath(p), false, JSON.stringify(p) + ' must not be served');
  }
});

test('the pages, assets and public data the browser loads are served', () => {
  for (const p of ['/index.html', '/shop.html', '/_preview.html', '/category/38003882.html',
    '/assets/css/category.css', '/assets/js/storefront.js', '/assets/img/brands/lg.png',
    '/assets/img/brands/logos.json', '/assets/vid/x.mp4',
    '/data/products.json', '/data/categories.json', '/data/collections.json',
    '/data/finder.json', '/data/guides.json', '/data/promos.json']) {
    assert.equal(isPublicPath(p), true, p + ' must be served');
  }
});

// The allow-list is only safe if it is also complete: every page and every file
// the site's own HTML and JS refer to must still be served, or a page breaks.
test('every page in site/ and every data file the browser fetches is allowed', () => {
  const pages = readdirSync(SITE).filter(f => f.endsWith('.html')).map(f => '/' + f)
    .concat(readdirSync(path.join(SITE, 'category')).filter(f => f.endsWith('.html')).map(f => '/category/' + f));
  for (const p of pages) assert.equal(isPublicPath(p), true, p + ' is a page but would not be served');

  const walk = d => readdirSync(d).flatMap(f => {
    const full = path.join(d, f);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const sources = [...pages.map(p => path.join(SITE, p)), ...walk(path.join(SITE, 'assets', 'js'))];
  const fetched = new Set();
  for (const s of sources) {
    for (const m of readFileSync(s, 'utf8').matchAll(/data\/([a-z0-9_-]+\.json)/gi)) fetched.add('/data/' + m[1]);
  }
  assert.ok(fetched.size >= 6, 'expected the browser to fetch at least six data files, found ' + fetched.size);
  for (const p of fetched) assert.equal(isPublicPath(p), true, p + ' is fetched by the browser but would not be served');
});

// The rule is worthless unless the server's static handler actually asks it.
test('the static handler refuses anything isPublicPath does not allow', () => {
  const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
  assert.match(src, /import \{ isPublicPath \} from '\.\/engine\/static-allow\.mjs'/);
  const handler = src.slice(src.lastIndexOf("if (p === '/') p = '/index.html'"));
  assert.match(handler.slice(0, 400), /!isPublicPath\(p\)/, 'the static handler must check isPublicPath before reading a file');
});
