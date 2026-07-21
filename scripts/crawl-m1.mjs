// scripts/crawl-m1.mjs
/* Crawl Milestone-1 stores into site/data/catalog.db.
   Politeness is non-negotiable: robots.txt is honoured inside crawlStore and
   --max caps pages per store. Start small; raise --max only once a store's
   extraction rate looks correct. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCatalog } from '../site/engine/catalog.mjs';
import { crawlStore } from '../site/engine/crawler.mjs';
import { M1_STORES } from '../site/engine/stores-m1.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const only = arg('--only');
const max = +(arg('--max') || 50);

const catalog = openCatalog(path.join(ROOT, 'site', 'data', 'catalog.db'));
const stores = M1_STORES.filter(s => !s.local && (!only || s.domain === only));

console.log(`crawling ${stores.length} store(s), max ${max} pages each\n`);
for (const s of stores) {
  const t0 = Date.now();
  const r = await crawlStore(catalog, s, { maxPages: max });
  console.log(`${r.domain.padEnd(24)} found=${String(r.found).padEnd(6)} shapedUrls=${String(r.shapedUrls).padEnd(6)}` +
    ` usedFallback=${String(r.usedFallback).padEnd(6)} stored=${String(r.stored).padEnd(6)}` +
    ` skipped=${String(r.skipped).padEnd(6)} errors=${r.errors}  ${Math.round((Date.now() - t0) / 1000)}s`);
}
const total = catalog.db.prepare('SELECT COUNT(*) n FROM offers').get().n;
const prods = catalog.db.prepare('SELECT COUNT(*) n FROM products').get().n;
console.log(`\ncatalog: ${total} offers across ${prods} distinct products`);
catalog.close();
