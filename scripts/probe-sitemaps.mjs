/* ============================================================================
   Milestone-1 store selection: which stores expose a crawlable product sitemap?
   For each registry store: read robots.txt (honouring what it declares), find
   sitemap URLs, follow one level of sitemap-index, and count product URLs.
   A store with a product sitemap is cheap to index; one without needs category
   pagination and costs far more per product.
   ========================================================================== */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.SADKO_NO_SERVE = '1';
const { loadRegistry } = await import('../site/compare-server.mjs');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (compatible; SADKO-price-comparer/1.0; +https://sadko-group.com/bot)';

async function get(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
  return { code: r.status, text: r.ok ? await r.text() : '' };
}
const PRODUCT_URL = /\/(product|products|item|p|shop)\//i;

async function probe(store) {
  const d = store.domain;
  const rec = { domain: d, tier: store.t || 3, robots: null, crawlDelay: null, sitemaps: [], productUrls: 0, sample: null };
  for (const host of [`https://www.${d}`, `https://${d}`]) {
    try {
      const r = await get(host + '/robots.txt', 10000);
      if (!r.text) continue;
      rec.robots = 'ok';
      const cd = r.text.match(/crawl-delay:\s*([\d.]+)/i);
      if (cd) rec.crawlDelay = +cd[1];
      for (const m of r.text.matchAll(/sitemap:\s*(\S+)/gi)) rec.sitemaps.push(m[1].trim());
      break;
    } catch {}
  }
  // conventional locations when robots.txt names none
  if (!rec.sitemaps.length)
    rec.sitemaps = [`https://www.${d}/sitemap.xml`, `https://${d}/sitemap.xml`,
      `https://${d}/product-sitemap.xml`, `https://${d}/sitemap_products_1.xml`];

  for (const sm of rec.sitemaps.slice(0, 4)) {
    try {
      const r = await get(sm, 20000);
      if (!r.text.includes('<')) continue;
      const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
      if (!locs.length) continue;
      let urls = locs;
      // sitemap index → follow the most product-looking child
      if (/<sitemapindex/i.test(r.text)) {
        const child = locs.find(l => /product|item|shop/i.test(l)) || locs[0];
        try {
          const c = await get(child, 20000);
          urls = [...c.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
        } catch {}
      }
      const prod = urls.filter(u => PRODUCT_URL.test(u));
      const use = prod.length ? prod : urls;
      if (use.length > rec.productUrls) {
        rec.productUrls = use.length; rec.sample = use[0]; rec.usedSitemap = sm;
        rec.looksProduct = prod.length > 0;
      }
      if (rec.productUrls > 50) break;
    } catch {}
  }
  const v = rec.productUrls >= 20 ? 'SITEMAP' : rec.productUrls > 0 ? 'THIN' : 'NONE';
  console.log(`${v.padEnd(8)} t${rec.tier} ${rec.domain.padEnd(30)} urls=${String(rec.productUrls).padEnd(6)}` +
    `${rec.looksProduct ? 'product-shaped ' : ''}${rec.crawlDelay ? 'delay=' + rec.crawlDelay + 's ' : ''}${rec.sample ? rec.sample.slice(0, 55) : ''}`);
  return { ...rec, verdict: v };
}

const reg = await loadRegistry();
const stores = reg.stores.filter(s => s.platform !== 'local');
console.log(`probing ${stores.length} stores for sitemaps\n`);
const out = []; let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (i < stores.length) out.push(await probe(stores[i++])); }));

out.sort((a, b) => (a.tier - b.tier) || b.productUrls - a.productUrls);
await writeFile(path.join(ROOT, 'scripts', 'sitemap-report.json'), JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
const good = out.filter(r => r.verdict === 'SITEMAP');
console.log(`\n=== ${good.length}/${out.length} stores expose a usable sitemap ===`);
good.slice(0, 30).forEach(r => console.log(`  t${r.tier} ${r.domain.padEnd(30)} ${r.productUrls} urls`));
process.exit(0);
