// Scrape server-rendered og meta + price + category from sadko-group.com product pages.
// Polite: concurrency 3, 150ms stagger, 1 retry on failure.
import fs from 'node:fs';

const URLS = fs.readFileSync('extraction/raw/ecstore-urls.txt', 'utf8')
  .split(/\r?\n/).filter(Boolean);
const products = URLS.filter(u => /p\d+\/?$/.test(u));
const OUT = 'extraction/products-enriched.json';
const FAIL = 'extraction/raw/scrape-failures.txt';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };

function extract(html, url) {
  const first = re => { const m = html.match(re); return m ? m[1].trim() : null; };
  const title = first(/<meta property="og:title" content="([^"]*)"/);
  const image = first(/<meta property="og:image" content="([^"]*cloudfront[^"]*)"/);
  const desc  = first(/<meta property="og:description" content="([^"]*)"/);
  const price = first(/itemprop="price" content="([0-9.]+)"/);
  const cat   = first(/href="[^"]*\/shop\/[^"]*-c(\d+)[^"]*"/);
  const id    = (url.match(/p(\d+)\/?$/) || [])[1];
  return {
    id,
    url: encodeURI(dec(url)),
    title: title ? title.replace(/\s*\|\s*SADKO Group\s*$/, '') : null,
    image, price: price ? Number(price) : null,
    description: desc,
    categoryId: cat,
  };
}

async function fetchOne(url, attempt = 0) {
  try {
    const res = await fetch(encodeURI(dec(url)), {
      headers: { 'User-Agent': 'Mozilla/5.0 (rebrand-preview builder; contact csupport@sadko-group.com)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return extract(await res.text(), url);
  } catch (e) {
    if (attempt < 1) { await sleep(1500); return fetchOne(url, attempt + 1); }
    fs.appendFileSync(FAIL, url + '\t' + e.message + '\n');
    return null;
  }
}

const results = [];
let done = 0;
const queue = [...products];
async function worker() {
  while (queue.length) {
    const url = queue.shift();
    const r = await fetchOne(url);
    if (r) results.push(r);
    done++;
    if (done % 25 === 0) console.log(`${done}/${products.length}`);
    await sleep(150);
  }
}
await Promise.all([worker(), worker(), worker()]);
results.sort((a, b) => (a.categoryId || '').localeCompare(b.categoryId || '') || (a.id || '').localeCompare(b.id || ''));
fs.writeFileSync(OUT, JSON.stringify({ scrapedAt: '2026-07-18', count: results.length, products: results }, null, 1));
console.log(`DONE ${results.length}/${products.length} -> ${OUT}`);
