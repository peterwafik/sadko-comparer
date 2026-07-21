/* ============================================================================
   Correction to triage-unreachable.mjs.

   That script judged a store "alive and fixable" from its HOMEPAGE. That is
   the wrong probe: several stores serve an open homepage but block automated
   clients on the SEARCH path specifically (raneen.com returns a Varnish
   "Error 403 Blocked" for /catalogsearch/ while its homepage returns 200).

   This probes the path we actually need — a search URL — and classifies:

     BLOCKED_SEARCH  homepage OK but search path 401/403/429 or bot-wall
     NO_PRODUCTS     search path returns 200 but no extractable products
                     (client-rendered, or markup we cannot read) -> fixable
     HAS_PRODUCTS    search path yields products -> our config is simply wrong
     UNREACHABLE     neither path answers

   Run:  node scripts/triage-searchpath.mjs [--limit N]
   ========================================================================== */
process.env.SADKO_NO_SERVE = '1';

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = await import('../site/compare-server.mjs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BOT = /cloudflare|challenge-platform|datadome|captcha|just a moment|attention required|checking your browser|incapsula|imperva|access denied|error 403|blocked/i;

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const LIMIT = +(arg('--limit') || 0);

let targets = require('../scripts/triage-report.json').results.filter(r => r.verdict === 'ALIVE_FIX');
if (LIMIT) targets = targets.slice(0, LIMIT);

/* the search paths worth trying — the same set the auto sweep knows, plus the
   locale-prefixed Magento forms observed on real Egyptian stores */
const TPLS = ['/search?q=', '/catalogsearch/result/?q=', '/ar/catalogsearch/result/?q=',
  '/en/catalogsearch/result/?q=', '/ar/search?q=', '/en/search?q=', '/?s=',
  '/index.php?route=product/search&search='];

const SEED = encodeURIComponent('تلفزيون');

async function probe(t) {
  const rec = { domain: t.domain, tier: t.tier, tried: 0 };
  for (const tpl of TPLS) {
    for (const host of [`https://www.${t.domain}`, `https://${t.domain}`]) {
      rec.tried++;
      let r, body;
      try {
        r = await fetch(host + tpl + SEED, { headers: { 'user-agent': UA }, redirect: 'follow',
          signal: AbortSignal.timeout(18000) });
        body = await r.text().catch(() => '');
      } catch { continue; }

      if ([401, 403, 429].includes(r.status) || BOT.test(body.slice(0, 4000)))
        return { ...rec, verdict: 'BLOCKED_SEARCH', code: r.status, tpl };
      if (!r.ok) continue;

      const n = eng.jsonLdProducts(body, t.domain).length + eng.htmlHarvest(body, t.domain).length;
      if (n >= 2) return { ...rec, verdict: 'HAS_PRODUCTS', code: r.status, tpl, items: n };
      rec.lastOk = { tpl, code: r.status, bytes: body.length };
      await new Promise(s => setTimeout(s, 900));   // politeness between attempts
    }
  }
  return { ...rec, verdict: rec.lastOk ? 'NO_PRODUCTS' : 'UNREACHABLE' };
}

console.log(`probing the SEARCH path of ${targets.length} stores\n`);
const out = []; let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < targets.length) {
    const t = targets[i++];
    const p = await probe(t);
    out.push(p);
    console.log(`${p.verdict.padEnd(16)} t${p.tier} ${p.domain.padEnd(28)} ${p.tpl || ''} ${p.items ? p.items + ' items' : ''}`);
  }
}));

await writeFile(path.join(ROOT, 'scripts', 'triage-searchpath.json'), JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
const by = {};
for (const r of out) (by[r.verdict] ||= []).push(r);
console.log('\n============== SEARCH-PATH TRIAGE ==============');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${k}  (${v.length})`);
  v.sort((a, b) => a.tier - b.tier).forEach(r => console.log(`   t${r.tier} ${r.domain.padEnd(28)} ${r.tpl || ''}`));
}
console.log('\nreport -> scripts/triage-searchpath.json');
process.exit(0);
