// site/engine/clean-urls.test.mjs: no page address ends in ".html".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SITE = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, SITE), 'utf8');
const NAV = read('assets/js/nav.js');
const fnSrc = NAV.slice(NAV.indexOf('function cleanHref(h) {'), NAV.indexOf('window.skCleanHref = cleanHref;'));
const cleanHref = new Function(fnSrc + '; return cleanHref;')();

test('nav.js turns every page link into its clean address', () => {
  assert.equal(cleanHref('shop.html'), 'shop');
  assert.equal(cleanHref('shop.html?cat=38003882&q=x'), 'shop?cat=38003882&q=x');
  assert.equal(cleanHref('../category/38003882.html'), '../category/38003882');
  assert.equal(cleanHref('product.html?id=1#specs'), 'product?id=1#specs');
  assert.equal(cleanHref('/admin.html'), '/admin');
  assert.equal(cleanHref('index.html'), './');
  assert.equal(cleanHref('../index.html'), '../');
  assert.equal(cleanHref('index.html?x=1'), './?x=1');
});

test('anything that is not a page link is left alone', () => {
  for (const h of ['https://sadko-group.com/a.html', 'tel:19140', '#top', 'assets/img/x.png', 'mailto:a@b.c', 'shop', '', 'data/site.json'])
    assert.equal(cleanHref(h), h);
});

test('nav.js cleans links as they appear and the addresses scripts push', () => {
  assert.match(NAV, /\['pushState', 'replaceState'\]\.forEach/);
  assert.match(NAV, /cleanLinks\(document\);/);
  assert.match(NAV, /attributeFilter: \['href'\]/);
});

test('no static page links to an .html address', () => {
  const pages = readdirSync(SITE).filter(f => f.endsWith('.html'))
    .concat(readdirSync(new URL('category/', SITE)).filter(f => f.endsWith('.html')).map(f => 'category/' + f));
  for (const p of pages) {
    const bad = [...read(p).matchAll(/\shref="([^"]*)"/g)].map(m => m[1]).filter(h => cleanHref(h) !== h);
    assert.deepEqual(bad, [], p + ' still links to .html');
  }
});

test('Vercel serves clean addresses, with no trailing slash', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.cleanUrls, true);
  assert.equal(v.trailingSlash, false);
});

test('the server redirects old .html addresses (category pages come through it) and serves clean ones', () => {
  const SRV = read('compare-server.mjs');
  const h = SRV.slice(SRV.indexOf('export async function handle('));
  assert.ok(h.indexOf("res.statusCode = 308;") < h.indexOf("u.pathname === '/healthz'"), 'the redirect runs first');
  assert.match(h, /\/\^\\\/\(\(\?:category\\\/\)\?\[A-Za-z0-9_-\]\+\)\\\.html\$\//);
  assert.match(h, /if \(\/\^\\\/category\\\/\[\^\/\.\]\+\$\/\.test\(u\.pathname\)/, 'category pages answer on the clean path');
  assert.match(h, /if \(\/\^\\\/\[A-Za-z0-9_-\]\+\$\/\.test\(p\)\) p \+= '\.html';/, 'the static handler maps /shop to shop.html');
});
