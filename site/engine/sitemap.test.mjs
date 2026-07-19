// site/engine/sitemap.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSitemap, isProductUrl } from './sitemap.mjs';

test('parses a urlset', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://s.com/product/a</loc></url>
    <url><loc>  https://s.com/product/b  </loc></url>
  </urlset>`;
  const r = parseSitemap(xml);
  assert.equal(r.isIndex, false);
  assert.deepEqual(r.urls, ['https://s.com/product/a', 'https://s.com/product/b']);
});

test('detects a sitemap index', () => {
  const xml = `<sitemapindex><sitemap><loc>https://s.com/product-sitemap.xml</loc></sitemap></sitemapindex>`;
  const r = parseSitemap(xml);
  assert.equal(r.isIndex, true);
  assert.equal(r.urls[0], 'https://s.com/product-sitemap.xml');
});

test('isProductUrl recognises common product paths', () => {
  assert.equal(isProductUrl('https://s.com/product/x'), true);
  assert.equal(isProductUrl('https://s.com/products/x'), true);
  assert.equal(isProductUrl('https://s.com/shop/thing-p12345'), true);
  assert.equal(isProductUrl('https://s.com/blog/post'), false);
  assert.equal(isProductUrl('https://s.com/about'), false);
});

test('tolerates malformed xml without throwing', () => {
  assert.doesNotThrow(() => parseSitemap('<urlset><url><loc>broken'));
  assert.deepEqual(parseSitemap('not xml at all').urls, []);
});
