/* ============================================================================
   Re-test the stores previously written off as unreachable — by PRODUCT PAGE.
   ----------------------------------------------------------------------------
   The earlier audit judged reachability from a store's SEARCH path. That was
   the wrong probe. raneen.com blocks /catalogsearch/ with a Varnish 403 but
   serves its product pages to us with HTTP 200, and our own extractor reads
   them perfectly. Any store failing the same way was misclassified.

   Per store:
     1. DISCOVER a real product URL. Tavily search is used ONLY to find URLs —
        never for prices, which are unreliable in search snippets.
     2. FETCH it with our own fetcher.
     3. EXTRACT with our own pipeline (JSON-LD -> microdata -> Open Graph).

   A store is RECOVERABLE if we can fetch and extract a real product from it,
   regardless of whether its search endpoint works — because URL discovery can
   come from Tavily or a sitemap instead.

   Requires TAVILY_API_KEY in the environment (site/.env).
   Run:  node --env-file-if-exists=site/.env scripts/retest-blocked.mjs
   ========================================================================== */
process.env.SADKO_NO_SERVE = '1';

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = await import('../site/compare-server.mjs');
const { extractProduct } = await import('../site/engine/extract.mjs');

const TK = process.env.TAVILY_API_KEY;
if (!TK) { console.error('TAVILY_API_KEY not set — add it to site/.env'); process.exit(1); }

/* the stores the previous audit recommended removing outright */
const SUSPECT = [
  'carrefouregypt.com', 'raneen.com', 'hyperone.com.eg', 'games2egypt.com',
  'aghezty.com', 'audiomisr.com', 'compuscience.com.eg', 'elwaha.com.eg',
  'hans.com.eg', 'iq-mobiles.com', 'mahgoub.com', 'najm.store',
  'sharpegy.com', 'store.fut-electronics.com', 'tal2aa.com',
];

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;
const targets = SUSPECT.filter(d => !ONLY || ONLY.has(d));

/* Tavily is a URL-discovery layer only. Prices in snippets are demonstrably
   wrong (it reported EGP 1,863 for a refrigerator), so nothing but the URL is
   taken from it. */
async function findProductUrls(domain) {
  const out = [];
  for (const q of [`site:${domain} ثلاجة OR تلفزيون OR غسالة سعر`, `${domain} product price EGP`]) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + TK, 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, max_results: 8 }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json();
      for (const x of j.results || []) {
        try {
          const u = new URL(x.url);
          if (u.hostname.replace(/^www\./, '').endsWith(domain) && !out.includes(x.url)) out.push(x.url);
        } catch {}
      }
    } catch {}
    if (out.length >= 3) break;
    await new Promise(s => setTimeout(s, 800));
  }
  return out.slice(0, 4);
}

async function testStore(domain) {
  const rec = { domain, urls: 0, fetched: 0, extracted: null, verdict: 'UNRECOVERABLE' };
  const urls = await findProductUrls(domain);
  rec.urls = urls.length;
  if (!urls.length) { rec.verdict = 'NO_URLS_FOUND'; return rec; }

  for (const u of urls) {
    let html;
    try { html = await eng.fetchPage(u, 'text/html', 25000); }
    catch (e) { rec.lastErr = String(e.message).slice(0, 40); continue; }
    rec.fetched++;
    const p = extractProduct(html, u);
    if (p && p.price) {
      rec.verdict = 'RECOVERABLE';
      rec.extracted = { title: p.title.slice(0, 60), price: p.price, url: u };
      return rec;
    }
    rec.noExtract = (rec.noExtract || 0) + 1;
    await new Promise(s => setTimeout(s, 1000));
  }
  if (rec.fetched === 0) rec.verdict = 'BLOCKED_TO_US';
  else rec.verdict = 'FETCHABLE_NO_DATA';   // we get the page but cannot read a product from it
  return rec;
}

console.log(`re-testing ${targets.length} stores by PRODUCT PAGE (previous verdict: remove)\n`);
const out = []; let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (i < targets.length) {
    const d = targets[i++];
    let rec;
    try { rec = await testStore(d); } catch (e) { rec = { domain: d, verdict: 'ERROR', err: String(e.message).slice(0, 50) }; }
    out.push(rec);
    const detail = rec.extracted ? `${String(rec.extracted.price).padStart(8)}  ${rec.extracted.title.slice(0, 40)}`
      : `urls=${rec.urls} fetched=${rec.fetched || 0} ${rec.lastErr || ''}`;
    console.log(`${rec.verdict.padEnd(19)} ${d.padEnd(26)} ${detail}`);
  }
}));

await writeFile(path.join(ROOT, 'scripts', 'retest-blocked-report.json'),
  JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));

const by = {};
for (const r of out) (by[r.verdict] ||= []).push(r.domain);
console.log('\n================ RESULT ================');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
  console.log(`${k.padEnd(20)} ${String(v.length).padStart(2)}   ${v.join(', ')}`);
const rec = (by.RECOVERABLE || []).length;
console.log(`\n${rec} of ${out.length} previously written off are actually RECOVERABLE`);
console.log('report -> scripts/retest-blocked-report.json');
process.exit(0);
