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

test('isProductUrl rejects pagination and bare category roots (Finding 6)', () => {
  assert.equal(isProductUrl('https://x.com/blog/p/2'), false);
  assert.equal(isProductUrl('https://x.com/category/laptops/p/10/'), false);
  assert.equal(isProductUrl('https://x.com/products/'), false);
  assert.equal(isProductUrl('https://x.com/p/some-product-name'), true);
});

test('parseSitemap extracts CDATA and namespaced <loc> tags', () => {
  const cdata = parseSitemap('<urlset><url><loc><![CDATA[https://x.com/product/a]]></loc></url></urlset>');
  assert.deepEqual(cdata.urls, ['https://x.com/product/a']);
  const ns = parseSitemap('<urlset><url><xhtml:loc>https://x.com/product/a</xhtml:loc></url></urlset>');
  assert.deepEqual(ns.urls, ['https://x.com/product/a']);
});

test('parseSitemap decodes XML entities in URLs', () => {
  const r = parseSitemap('<urlset><url><loc>https://x.com/p?a=1&amp;b=2</loc></url></urlset>');
  assert.equal(r.urls[0], 'https://x.com/p?a=1&b=2');
});

test('isProductUrl rejects static-asset extensions even under a /product/ path', () => {
  assert.equal(isProductUrl('https://2b.com.eg/media/catalog/product/cache/8f3b1e/x/y/prod_image.jpg'), false);
  assert.equal(isProductUrl('https://elarabygroup.com/pub/media/catalog/product/t/o/tornado.webp'), false);
  assert.equal(isProductUrl('https://2b.com.eg/static/version123/frontend/x/product/logo.svg'), false);
  assert.equal(isProductUrl('https://x.com/product/a.css'), false);
  assert.equal(isProductUrl('https://x.com/product/a.js'), false);
  assert.equal(isProductUrl('https://x.com/product/a.json'), false);
  assert.equal(isProductUrl('https://x.com/product/a.pdf'), false);
});

test('isProductUrl rejects asset/static-resource directory segments (Magento image cache)', () => {
  assert.equal(isProductUrl('https://2b.com.eg/media/catalog/product/foo/bar'), false);
  assert.equal(isProductUrl('https://elarabygroup.com/pub/media/catalog/product/x'), false);
  assert.equal(isProductUrl('https://2b.com.eg/static/frontend/x/product/y'), false);
  assert.equal(isProductUrl('https://x.com/wp-content/uploads/2024/product/a'), false);
});

test('isProductUrl still recognises real product URLs from live crawl targets', () => {
  assert.equal(isProductUrl('https://2b.com.eg/product/samsung-tv-55'), true);
  assert.equal(isProductUrl('https://x.com/ar/product/147807/mrohh-haet'), true);
  assert.equal(isProductUrl('https://egypt.sharafdg.com/product/kenwood-vacuum-cleaner-vc7050/'), true);
  assert.equal(isProductUrl('https://btech.com/ar/p/speedlink-kappa-usb-mouse-black-sl-6113-bk'), true);
  assert.equal(isProductUrl('https://x.com/p/tornado-fridge-355l'), true);
  assert.equal(isProductUrl('https://jumia.com.eg/toshiba-washer-8kg-p-12345'), true);
});
