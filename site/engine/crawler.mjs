/* Crawl one store: robots -> sitemap -> product pages -> catalog.
   fetchImpl is injectable so tests run with no network. */
import { parseRobots, CRAWLER_UA } from './robots.mjs';
import { parseSitemap, isProductUrl } from './sitemap.mjs';
import { extractProduct } from './extract.mjs';

const DEFAULT_DELAY = 1000;   // polite floor when robots declares none

export async function crawlStore(catalog, store, opts = {}) {
  const {
    maxPages = 500,        // product pages FETCHED this run
    sitemapMax = 20000,    // product URLs COLLECTED from sitemaps (independent —
                           // the full list must be known for the cursor to mean
                           // anything across runs)
    fetchImpl = fetch,
    delayMs = null,
    onProgress = () => {},
  } = opts;

  const domain = store.domain;
  const res = { domain, found: 0, stored: 0, skipped: 0, errors: 0 };
  const get = async url => {
    const r = await fetchImpl(url, { headers: { 'user-agent': CRAWLER_UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  };

  // 1. robots
  let robots;
  try { robots = parseRobots(await get(`https://${domain}/robots.txt`)); }
  catch { robots = parseRobots(''); }
  const wait = delayMs !== null ? delayMs
    : Math.max((robots.crawlDelay || 0) * 1000, DEFAULT_DELAY);

  // 2. sitemaps
  //
  // URL SHAPE IS A HINT, NOT A GATE. Measured against the real Milestone-1
  // stores, several publish product URLs with no conventional marker:
  //   elarabygroup  /ar/tornado-electric-water-heater-30-l-...-teee-30d1w
  //   egyptlaptop   /point-of-sale/barcode-scanners/datalogic-qw2100-...
  // Filtering on `isProductUrl` alone would discard those stores entirely.
  // So: prefer product-shaped URLs when a sitemap has them, but when a sitemap
  // yields NONE, fall back to its plain URLs and let extractProduct decide —
  // JSON-LD presence is a far better product signal than URL shape.
  //
  // A store may override discovery via `store.sitemapHint` (a substring that
  // selects the right child of a sitemap index, e.g. 'products') and
  // `store.productUrl` (a RegExp replacing the generic heuristic).
  const smUrls = robots.sitemaps.length ? robots.sitemaps
    : [`https://${domain}/sitemap.xml`, `https://www.${domain}/sitemap.xml`];
  const isProduct = store.productUrl ? (u => store.productUrl.test(u)) : isProductUrl;
  const shaped = [], plain = [];
  const queue = [...smUrls];
  const seenSm = new Set();
  while (queue.length && shaped.length < sitemapMax) {
    const sm = queue.shift();
    if (seenSm.has(sm)) continue;
    seenSm.add(sm);
    let parsed;
    try { parsed = parseSitemap(await get(sm)); } catch { res.errors++; continue; }
    if (parsed.isIndex) {
      // follow product-looking children first; store.sitemapHint wins if set
      const hint = store.sitemapHint;
      const children = parsed.urls.slice().sort((a, b) => {
        const score = u => (hint && u.includes(hint) ? 2 : /product|item|shop/i.test(u) ? 1 : 0);
        return score(b) - score(a);
      });
      queue.push(...children.slice(0, 20));
    } else {
      for (const u of parsed.urls) {
        if (shaped.length >= sitemapMax) break;
        if (isProduct(u)) shaped.push(u);
        else if (plain.length < sitemapMax) plain.push(u);
      }
    }
  }
  // fall back to unshaped URLs rather than crawling nothing
  const productUrls = shaped.length ? shaped : plain;
  res.found = productUrls.length;
  res.shapedUrls = shaped.length;
  res.usedFallback = !shaped.length && plain.length > 0;
  if (res.usedFallback)
    onProgress({ ...res, note: `${domain}: no product-shaped URLs; falling back to ${plain.length} plain URLs` });

  // 3. product pages — resume from the stored cursor so an interrupted run
  //    continues instead of refetching everything. Sitemap order is stable.
  const start = catalog.getCursor(domain);
  let i = start;
  const end = Math.min(productUrls.length, start + maxPages);
  for (; i < end; i++) {
    const url = productUrls[i];
    let path;
    try { path = new URL(url).pathname; } catch { res.skipped++; continue; }
    if (!robots.allowed(path)) { res.skipped++; continue; }
    try {
      const html = await get(url);
      const p = extractProduct(html, url);
      if (!p) { res.skipped++; }
      else {
        catalog.upsertOffer({ domain, url, title: p.title, price: p.price,
          currency: p.currency, inStock: p.inStock });
        res.stored++;
      }
    } catch { res.errors++; }
    onProgress(res);
    if (wait) await new Promise(r => setTimeout(r, wait));
  }
  // a completed pass resets to 0 so the next run re-checks prices from the top
  catalog.setCursor(domain, i >= productUrls.length ? 0 : i);
  return res;
}
