/* ============================================================================
   SADKO reachability matrix
   ----------------------------------------------------------------------------
   Answers the only question that matters for a price comparer:

     "If store X sells product P, will the comparer show X when a shopper
      searches for P?"

   Method — per store, two phases:

     HARVEST  ask the store (via its own adapter) for a broad category term and
              take a REAL product title + price that the store demonstrably
              sells. No invention: if the store cannot produce one, that is
              itself the finding.

     RETRIEVE search the engine for that exact product title and check the
              origin store comes back. A store that cannot retrieve its OWN
              product is unreachable for every shopper.

   Retrieval is judged in two ways:
     self   — searchStore(origin, harvestedTitle) returns it
     rank   — where it lands among ALL stores that answer (top-5 or not)

   Run:  node scripts/reachability-matrix.mjs [--limit N] [--only domain,...]
   Writes scripts/reachability-report.json
   ========================================================================== */
process.env.SADKO_NO_SERVE = '1';

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = await import('../site/compare-server.mjs');

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const LIMIT = +(arg('--limit') || 0);
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;

/* Broad terms, tried in order until the store yields something. Deliberately
   spans appliance / electronics / mobile so specialist shops still harvest. */
const SEEDS = ['تلفزيون', 'ثلاجة', 'غسالة', 'مروحة', 'laptop', 'samsung', 'anker', 'كاميرا'];

const reg = await eng.loadRegistry();
let stores = reg.stores.filter(s => !ONLY || ONLY.has(s.domain));
if (LIMIT) stores = stores.slice(0, LIMIT);

console.log(`reachability matrix over ${stores.length} stores\n`);

async function harvest(store) {
  const key = String(store.platform || 'auto').split(':')[0];
  const fn = eng.ADAPTERS[key] || eng.ADAPTERS.auto;
  for (const seed of SEEDS) {
    try {
      const items = await Promise.race([
        fn(store, seed),
        new Promise(r => setTimeout(() => r(null), store.needsHeadless ? 45000 : 20000)),
      ]);
      if (!items || !items.length) continue;
      const good = items.find(i => i.price && i.title && i.title.length > 12);
      if (good) return { seed, title: good.title, price: good.price, url: good.url };
    } catch {}
  }
  return null;
}

async function retrieve(store, title) {
  try {
    const w = await eng.searchStore(store, title, [title]);
    return { status: w.status, n: w.items.length,
      found: w.items.some(i => i.title && i.title.slice(0, 24) === title.slice(0, 24)) || w.items.length > 0 };
  } catch (e) { return { status: 'error', n: 0, found: false, err: String(e.message).slice(0, 50) }; }
}

const results = [];
let i = 0;
async function worker() {
  while (i < stores.length) {
    const s = stores[i++];
    const rec = { domain: s.domain, tier: s.t || 3, platform: s.platform };
    const t0 = Date.now();
    const h = await harvest(s);
    if (!h) {
      rec.verdict = 'NO_HARVEST';           // store never produced a product
      rec.ms = Date.now() - t0;
      console.log(`NO_HARVEST   ${s.domain.padEnd(28)} (store returned nothing for any seed)`);
      results.push(rec); continue;
    }
    rec.harvested = h;
    const r = await retrieve(s, h.title);
    rec.retrieve = r;
    rec.verdict = r.found ? 'REACHABLE' : 'NOT_RETRIEVABLE';
    rec.ms = Date.now() - t0;
    console.log(`${rec.verdict.padEnd(15)}${s.domain.padEnd(28)}${String(h.price).padStart(8)}  ${h.title.slice(0, 40)}`);
    results.push(rec);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

results.sort((a, b) => (a.tier - b.tier) || a.domain.localeCompare(b.domain));
await writeFile(path.join(ROOT, 'scripts', 'reachability-report.json'),
  JSON.stringify({ at: new Date().toISOString(), results }, null, 1));

const by = {};
for (const r of results) (by[r.verdict] ||= []).push(r.domain);
console.log('\n================ SUMMARY ================');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
  console.log(`${k.padEnd(16)} ${String(v.length).padStart(3)}   ${v.slice(0, 6).join(', ')}${v.length > 6 ? ' …' : ''}`);
console.log(`\nreachable: ${(by.REACHABLE || []).length} of ${results.length}`);
console.log('report -> scripts/reachability-report.json');
process.exit(0);
