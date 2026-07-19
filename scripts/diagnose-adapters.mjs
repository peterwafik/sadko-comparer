/* ============================================================================
   SADKO adapter diagnostics — probe EVERY store in data/stores.json and report
   which ones cannot be reached or cannot be parsed, with a diagnosis per store.

   Run:  node scripts/diagnose-adapters.mjs            (full sweep, ~10-15 min)
         node scripts/diagnose-adapters.mjs --only 2b.com.eg,raneen.com

   For each store it records, across several broad probe queries:
     · reach   — does the domain answer plain HTTPS at all (apex + www)?
     · raw     — items the adapter parsed WITH a price, BEFORE relevance filter
     · rel     — items surviving the relevance filter
     · err     — first adapter error

   The raw/rel split is the whole point: raw>0 & rel=0 means the adapter WORKS
   and the store simply doesn't stock the probe item; raw=0 on every probe while
   the site is reachable means the adapter is broken.
   ========================================================================== */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// must be set BEFORE the engine module is evaluated, so the import is dynamic —
// a static import is hoisted above this line and the engine would bind :8082
process.env.SADKO_NO_SERVE = '1';
const { ADAPTERS, loadRegistry, isRelevant } = await import('../site/compare-server.mjs');
const { headlessAvailable } = await import('../site/headless.mjs');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* broad probes: any live Egyptian electronics/appliance store should answer at
   least one of these. Mixed AR/EN because stores index in one or the other. */
const PROBES = (() => {
  const i = process.argv.indexOf('--probes');
  return i > -1 ? process.argv[i + 1].split(',') : ['سامسونج', 'samsung', 'تلفزيون', 'laptop'];
})();

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > -1 ? new Set(process.argv[i + 1].split(',')) : null;
})();

async function reach(domain) {
  for (const host of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const r = await fetch(host, {
        headers: { 'user-agent': UA, 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.7' },
        redirect: 'follow', signal: AbortSignal.timeout(15000),
      });
      return { ok: r.ok, code: r.status, via: host, final: r.url };
    } catch (e) {
      var last = String(e.cause?.code || e.message || e).slice(0, 60);
    }
  }
  return { ok: false, code: 0, err: last };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('deadline')), ms))]);
}

async function probeStore(store) {
  const key = String(store.platform || 'auto').split(':')[0];
  const fn = ADAPTERS[key] || ADAPTERS.auto;
  const rec = {
    domain: store.domain, name: store.nameEn || store.name, tier: store.t || 3,
    platform: store.platform, headless: !!store.needsHeadless,
    raw: 0, rel: 0, errs: [], per: {}, ms: 0,
  };
  const t0 = Date.now();
  rec.reach = await reach(store.domain);
  for (const q of PROBES) {
    try {
      const items = (await withTimeout(fn(store, q), store.needsHeadless ? 60000 : 25000)) || [];
      const priced = items.filter(i => i && i.price);
      const relevant = priced.filter(i => isRelevant(i.title, q));
      rec.per[q] = { raw: priced.length, rel: relevant.length };
      rec.raw += priced.length; rec.rel += relevant.length;
      if (priced[0]) rec.sample = rec.sample || { q, title: priced[0].title, price: priced[0].price, url: priced[0].url };
    } catch (e) {
      const msg = String(e.message || e).slice(0, 70);
      rec.per[q] = { err: msg };
      if (!rec.errs.includes(msg)) rec.errs.push(msg);
    }
  }
  rec.ms = Date.now() - t0;
  rec.verdict = rec.raw > 0 ? 'OK'
    : !rec.reach.ok ? 'UNREACHABLE'
    : rec.errs.length ? 'ADAPTER_ERROR'
    : 'NO_PARSE';
  console.log(`${rec.verdict.padEnd(14)} ${rec.domain.padEnd(32)} raw=${rec.raw} rel=${rec.rel} ` +
    `http=${rec.reach.code || rec.reach.err || '-'} ${Math.round(rec.ms / 1000)}s ${rec.errs[0] || ''}`);
  return rec;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const reg = await loadRegistry();
let stores = reg.stores.filter(s => s.domain !== 'sadko-group.com');
if (only) stores = stores.filter(s => only.has(s.domain));
console.log(`probing ${stores.length} stores · headless=${headlessAvailable()} · probes=${PROBES.join(' | ')}\n`);

// headless stores are gated to 3 concurrent tabs inside the engine; run them in
// their own slower lane so they don't starve the plain-HTTP sweep
const hl = stores.filter(s => s.needsHeadless);
const plain = stores.filter(s => !s.needsHeadless);
const [a, b] = await Promise.all([pool(plain, 8, probeStore), pool(hl, 3, probeStore)]);
const results = [...a, ...b].sort((x, y) => (x.tier - y.tier) || x.domain.localeCompare(y.domain));

const outFile = path.join(ROOT, 'scripts', 'adapter-report.json');
await writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), probes: PROBES, results }, null, 1));

const bad = results.filter(r => r.verdict !== 'OK');
console.log(`\n=== ${results.length - bad.length}/${results.length} answered · ${bad.length} failing ===`);
for (const g of ['UNREACHABLE', 'ADAPTER_ERROR', 'NO_PARSE'])
  for (const r of bad.filter(x => x.verdict === g))
    console.log(`${g.padEnd(14)} t${r.tier} ${r.domain.padEnd(32)} ${r.platform.padEnd(10)} ` +
      `http=${r.reach.code || r.reach.err || '-'} ${r.errs[0] || ''}`);
console.log('\nreport →', outFile);
process.exit(0);
