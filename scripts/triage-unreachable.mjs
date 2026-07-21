/* ============================================================================
   Triage the stores the reachability matrix could not reach.

   Separates "the site is gone / blocking us" (remove or accept) from
   "the site is alive and we simply cannot read it" (fixable engineering).

   Verdicts:
     DEAD        DNS/connection failure — the domain does not resolve or answer
     BLOCKED     answers, but with 401/403/429 or a bot-wall interstitial
     ALIVE_FIX   answers 200 with real content — our adapter is the problem
     SLOW        no answer within the timeout

   Run:  node scripts/triage-unreachable.mjs
   ========================================================================== */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BOT = /cloudflare|challenge-platform|datadome|captcha|just a moment|attention required|checking your browser|incapsula|imperva|access denied/i;

const reach = require('../scripts/reachability-report.json').results;
const { openCatalog } = await import('../site/engine/catalog.mjs');
const c = openCatalog(path.join(ROOT, 'site', 'data', 'catalog.db'));
const inCatalog = new Set(c.db.prepare('SELECT DISTINCT domain FROM offers').all().map(r => r.domain));
c.close();

const targets = reach
  .filter(r => r.verdict !== 'REACHABLE' && !inCatalog.has(r.domain))
  .map(r => ({ domain: r.domain, tier: r.tier, platform: r.platform }));

console.log(`triaging ${targets.length} unreachable stores\n`);

async function probe(t) {
  for (const host of [`https://www.${t.domain}/`, `https://${t.domain}/`]) {
    try {
      const r = await fetch(host, { headers: { 'user-agent': UA }, redirect: 'follow',
        signal: AbortSignal.timeout(20000) });
      const body = await r.text().catch(() => '');
      if (!r.ok) return { verdict: [401, 403, 429].includes(r.status) ? 'BLOCKED' : 'ALIVE_FIX', code: r.status, bytes: body.length };
      if (BOT.test(body.slice(0, 6000))) return { verdict: 'BLOCKED', code: r.status, bytes: body.length, bot: true };
      return { verdict: 'ALIVE_FIX', code: r.status, bytes: body.length };
    } catch (e) {
      var last = String(e.cause?.code || e.message || e).slice(0, 40);
    }
  }
  return { verdict: /ENOTFOUND|EAI_AGAIN|CERT/i.test(last || '') ? 'DEAD' : 'SLOW', err: last };
}

const out = []; let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < targets.length) {
    const t = targets[i++];
    const p = await probe(t);
    const rec = { ...t, ...p };
    out.push(rec);
    console.log(`${p.verdict.padEnd(11)} t${t.tier} ${t.domain.padEnd(28)} ${p.code || p.err || ''}`);
  }
}));

await writeFile(path.join(ROOT, 'scripts', 'triage-report.json'), JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
const by = {};
for (const r of out) (by[r.verdict] ||= []).push(r);
console.log('\n================ TRIAGE ================');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${k}  (${v.length})`);
  v.sort((a, b) => a.tier - b.tier).slice(0, 40).forEach(r => console.log(`   t${r.tier} ${r.domain}`));
}
console.log('\nreport -> scripts/triage-report.json');
process.exit(0);
