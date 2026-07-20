// scripts/bench-catalog.mjs
/* Milestone-1 success metric: catalog path vs live fan-out, across >=6
   appliance categories. Prints offers-per-query and latency for both. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.SADKO_NO_SERVE = '1';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { openCatalog } = await import('../site/engine/catalog.mjs');
const { rankOffers } = await import('../site/engine/serve.mjs');
const engine = await import('../site/compare-server.mjs');

const QUERIES = [
  'شاشة شارب 75 بوصة 4K سمارت',
  'غسالة توشيبا 8 كيلو اتوماتيك',
  'ثلاجة تورنيدو نوفروست 355 لتر',
  'تكييف شارب 2.25 حصان انفرتر',
  'ميكروويف فريش 36 لتر',
  'بوتاجاز لاجيرمانيا 5 شعلة',
  'قلاية هوائية بيكو',
  'سخان كهربائي',
];

const catalog = openCatalog(path.join(ROOT, 'site', 'data', 'catalog.db'));
const reg = await engine.loadRegistry();
const live = reg.stores.filter(s => (s.t || 3) <= 2);

console.log('query'.padEnd(36), 'catalog', 'ms', '  live', 'ms');
let cSum = 0, lSum = 0;
for (const q of QUERIES) {
  const t0 = Date.now();
  const r = await rankOffers(catalog, q, { verify: async () => null });
  const cMs = Date.now() - t0;

  const t1 = Date.now();
  const results = await Promise.all(live.map(s =>
    engine.searchStore(s, q, [q]).catch(() => ({ items: [] }))));
  const lN = results.reduce((n, w) => n + (w.items?.length || 0), 0);
  const lMs = Date.now() - t1;

  cSum += r.results.length; lSum += lN;
  console.log(q.padEnd(36), String(r.results.length).padStart(6), String(cMs).padStart(5),
    String(lN).padStart(6), String(lMs).padStart(5));
}
console.log(`\nTOTAL offers  catalog=${cSum}  live=${lSum}  ratio=${lSum ? (cSum / lSum).toFixed(2) : 'n/a'}x`);
console.log('Target: ratio >= 3.0 and catalog latency < 3000ms');
catalog.close();
process.exit(0);
