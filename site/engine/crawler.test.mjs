import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';
import { crawlStore } from './crawler.mjs';
import { M1_STORES } from './stores-m1.mjs';

const LD = (name, price) => `<html><script type="application/ld+json">${
  JSON.stringify({ '@type': 'Product', name, offers: { price } })}</script></html>`;

/* fake fetch: robots -> sitemap -> two product pages */
function fakeFetch(map) {
  return async url => {
    const key = Object.keys(map).find(k => url.includes(k));
    if (!key) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => map[key] };
  };
}

test('crawls robots -> sitemap -> product pages into the catalog', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset><url><loc>https://t.com/product/a</loc></url><url><loc>https://t.com/product/b</loc></url></urlset>',
    '/product/a': LD('شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', 39699),
    '/product/b': LD('غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', 12079),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.stored, 2);
  assert.equal(c.search('شارب').length, 1);
  assert.equal(c.search('توشيبا').length, 1);
  c.close();
});

test('respects robots Disallow', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow: /product/\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset><url><loc>https://t.com/product/a</loc></url></urlset>',
    '/product/a': LD('شاشة شارب 75 بوصة', 39699),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.stored, 0);
  assert.ok(r.skipped >= 1);
  c.close();
});

test('a page that fails to parse does not abort the crawl', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset><url><loc>https://t.com/product/a</loc></url><url><loc>https://t.com/product/b</loc></url></urlset>',
    '/product/a': '<html>no json-ld here</html>',
    '/product/b': LD('غسالة توشيبا 8 كيلو AEW-8460SUP', 12079),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.stored, 1);
  c.close();
});

test('M1_STORES holds the 13 planned stores including SADKO', () => {
  assert.equal(M1_STORES.length, 13);
  assert.ok(M1_STORES.some(s => s.domain === 'sadko-group.com'));
  assert.ok(M1_STORES.some(s => s.domain === 'rayashop.com'));
});

/* Several real stores publish product URLs with no /product/ marker
   (elarabygroup uses a bare slug, egyptlaptop a category path). Filtering on
   URL shape alone would silently crawl NOTHING from them, so the crawler must
   fall back to plain sitemap URLs and let extractProduct arbitrate. */
test('a sitemap with no product-shaped URLs falls back instead of crawling nothing', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    // bare-slug product URLs, exactly like elarabygroup's real sitemap
    'sitemap.xml': '<urlset>' +
      '<url><loc>https://t.com/ar/tornado-electric-water-heater-30-l-teee-30d1w</loc></url>' +
      '<url><loc>https://t.com/ar/tornado-electric-water-heater-40-l-teee-40d1w</loc></url></urlset>',
    '/ar/tornado-electric-water-heater-30-l': LD('سخان تورنيدو 30 لتر ديجيتال TEEE-30D1W', 4999),
    '/ar/tornado-electric-water-heater-40-l': LD('سخان تورنيدو 40 لتر ديجيتال TEEE-40D1W', 5499),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.usedFallback, true, 'must report that it fell back');
  assert.equal(r.stored, 2, 'both bare-slug products must be stored');
  c.close();
});

test('store.productUrl overrides the generic URL heuristic', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset>' +
      '<url><loc>https://t.com/catalog/sku-123</loc></url>' +
      '<url><loc>https://t.com/about</loc></url></urlset>',
    '/catalog/sku-123': LD('شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', 39699),
    '/about': '<html>no product</html>',
  });
  const store = { domain: 't.com', name: 'T', productUrl: /\/catalog\/sku-/ };
  const r = await crawlStore(c, store, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.shapedUrls, 1, 'only the catalog URL matches the override');
  assert.equal(r.stored, 1);
  c.close();
});

test('an interrupted crawl resumes from its cursor instead of restarting', async () => {
  const c = openCatalog();
  const pages = {
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset>' +
      '<url><loc>https://t.com/product/a</loc></url>' +
      '<url><loc>https://t.com/product/b</loc></url>' +
      '<url><loc>https://t.com/product/c</loc></url></urlset>',
    '/product/a': LD('شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', 39699),
    '/product/b': LD('غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', 12079),
    '/product/c': LD('ثلاجة تورنيدو 355 لتر RF-40FTV-BK', 22269),
  };
  const store = { domain: 't.com', name: 'T' };
  // first run stops after 2 product pages
  const r1 = await crawlStore(c, store, { maxPages: 2, fetchImpl: fakeFetch(pages), delayMs: 0 });
  assert.equal(r1.stored, 2);
  assert.equal(c.getCursor('t.com'), 2);

  // second run picks up at index 2 and fetches only the remaining page
  const fetched = [];
  const spy = async (url, o) => { fetched.push(url); return fakeFetch(pages)(url, o); };
  const r2 = await crawlStore(c, store, { maxPages: 10, fetchImpl: spy, delayMs: 0 });
  assert.equal(r2.stored, 1, 'only the unvisited page should be stored');
  assert.ok(!fetched.some(u => u.includes('/product/a')), 'must not refetch page a');
  c.close();
});
