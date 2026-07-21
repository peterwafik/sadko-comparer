/* ============================================================================
   Headless-render discovery for client-rendered stores.
   ----------------------------------------------------------------------------
   37 registry stores answer their search URL with HTTP 200 but nothing
   extractable — their product grid is built by JavaScript after load. This
   script, per store:

     1. FIND the search URL. Read the homepage's own <form action> + input
        name. If the static HTML has no form (Next/Nuxt SPAs frequently do
        not), render the homepage in headless Chrome and read the form from
        the live DOM.
     2. RENDER the search URL for a seed term and harvest product cards with
        the engine's existing in-page harvester.
     3. VALIDATE against TWO different seed terms. A template only passes if
        it returns DIFFERENT results for different queries — 10 of 11 endpoints
        found in the previous audit returned a fixed grid regardless of the
        search term, which is worse than no coverage because it injects wrong
        products into the customer's top-5.
     4. PERSIST the survivors as platform:'render' + renderTpl + needsHeadless.

   Politeness: >=1s between requests to a domain, at most 2 domains at once
   (headless itself is gated to 3 tabs internally), 45s cap per render, and a
   hard cap on candidate templates. A 401/403/429 or bot-wall is recorded and
   the store is abandoned immediately — never retried around.

   Run:  node scripts/render-discovery.mjs [--only d1,d2] [--limit N] [--dry-run]
   ========================================================================== */
process.env.SADKO_NO_SERVE = '1';

import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = await import('../site/compare-server.mjs');
const { renderPage, headlessAvailable } = await import('../site/headless.mjs');

const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;
const LIMIT = +(arg('--limit') || 0);
const DRY = process.argv.includes('--dry-run');

if (!headlessAvailable()) { console.error('headless Chrome not available — cannot run'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BOT = /cloudflare|challenge-platform|datadome|captcha|just a moment|attention required|checking your browser|incapsula|imperva|access denied|error 403|blocked/i;

/* two seeds that must produce DIFFERENT results — this is what exposes an
   endpoint that ignores the query and serves a fixed grid */
const SEED_A = 'تلفزيون', SEED_B = 'غسالة';

/* read a search form out of an HTML string */
function formTemplate(html, domain) {
  const forms = html.match(/<form[^>]*>[\s\S]{0,1200}?<\/form>/gi) || [];
  for (const f of forms) {
    if (!/search|catalogsearch|بحث/i.test(f)) continue;
    const action = (f.match(/action=["']([^"']*)["']/i) || [])[1];
    if (action === undefined) continue;
    const input = (f.match(/<input[^>]*(?:type=["'](?:text|search)["'][^>]*)?name=["']([^"']+)["']/i) || [])[1];
    if (!input) continue;
    let base = action || '/';
    try { base = new URL(action || '/', 'https://' + domain).pathname + (new URL(action || '/', 'https://' + domain).search || ''); } catch {}
    return base + (base.includes('?') ? '&' : '?') + input + '=';
  }
  return null;
}

/* the in-page harvester the engine already uses for SPA storefronts */
const HARVEST = `(async()=>{
  for(let i=0;i<5;i++){ window.scrollBy(0, document.documentElement.scrollHeight); await new Promise(r=>setTimeout(r,600)); }
  const out=[],seen=new Set();
  const P=/(EGP|LE|E£|ج\\.?\\s?م|جنيه)/;
  for(const a of document.querySelectorAll('a[href]')){
    const h=a.href||''; if(!/\\/(product|products|item)\\/|\\/p\\/|-p-?\\d/i.test(h)) continue;
    const clean=h.split('?')[0]; if(seen.has(clean)) continue;
    let card=a,hops=0,txt='';
    while(card&&hops<5){ txt=(card.textContent||'').trim(); if(P.test(txt)&&txt.length<700) break; card=card.parentElement; hops++; }
    if(!card||!P.test(txt)) continue;
    const img=card.querySelector&&card.querySelector('img[alt]');
    const name=(img&&img.alt)||a.getAttribute('aria-label')||a.title||((a.textContent||'').replace(/\\s+/g,' ').trim());
    seen.add(clean);
    out.push({h:clean.slice(0,220),name:String(name).slice(0,140),t:txt.replace(/\\s+/g,' ').slice(0,220)});
    if(out.length>=40) break;
  }
  return out;
})()`;

function toItems(value) {
  return (value || []).map(v => {
    const price = eng.extractPrices ? (eng.extractPrices(v.t)[0] || 0) : 0;
    let title = String(v.name || '').trim();
    if (title.length < 12) title = String(v.t || '').replace(/[\d.,]+\s*(EGP|LE|جنيه|ج\.?\s?م)[\s\S]*$/i, '').trim();
    return price && title.length > 10 ? { title: title.slice(0, 140), price, url: v.h } : null;
  }).filter(Boolean);
}

async function renderSearch(tplUrl, q) {
  const url = tplUrl.replace('{q}', encodeURIComponent(q));
  const { html, value } = await renderPage(url, { waitMs: 7000, script: HARVEST });
  if (BOT.test(String(html).slice(0, 5000))) return { blocked: true, items: [] };
  return { blocked: false, items: toItems(value) };
}

const FALLBACK_TPLS = ['/search?q=', '/ar/search?q=', '/en/search?q=', '/catalogsearch/result/?q=',
  '/ar/catalogsearch/result/?q=', '/en/catalogsearch/result/?q=', '/?s=', '/search?query=', '/search?keyword='];

async function discover(store) {
  const d = store.domain;
  const rec = { domain: d, tier: store.tier || store.t || 3, candidates: [] };

  // --- 1. find candidate templates -----------------------------------------
  const cands = [];
  for (const host of [`https://www.${d}`, `https://${d}`]) {
    try {
      const r = await fetch(host + '/', { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      if (BOT.test(body.slice(0, 5000)) || [401, 403, 429].includes(r.status)) { rec.verdict = 'BLOCKED'; return rec; }
      const t = formTemplate(body, d);
      if (t) cands.push(host + t + '{q}');
      rec.origin = host;
      break;
    } catch {}
  }
  // SPA homepages often have no form in static HTML — read it from the live DOM
  if (!cands.length && rec.origin) {
    try {
      const { html } = await renderPage(rec.origin + '/', { waitMs: 6000 });
      if (BOT.test(String(html).slice(0, 5000))) { rec.verdict = 'BLOCKED'; return rec; }
      const t = formTemplate(html, d);
      if (t) { cands.push(rec.origin + t + '{q}'); rec.viaRenderedForm = true; }
    } catch {}
  }
  const base = rec.origin || `https://${d}`;
  for (const t of FALLBACK_TPLS) cands.push(base + t + '{q}');
  rec.candidates = [...new Set(cands)].slice(0, 6);

  // --- 2/3. render + validate against TWO seeds ----------------------------
  for (const tpl of rec.candidates) {
    let a, b;
    try { a = await renderSearch(tpl, SEED_A); } catch { continue; }
    if (a.blocked) { rec.verdict = 'BLOCKED'; return rec; }
    if (a.items.length < 2) { await sleep(1000); continue; }
    await sleep(1200);
    try { b = await renderSearch(tpl, SEED_B); } catch { b = { items: [] }; }

    const sameGrid = b.items.length && a.items.slice(0, 3).map(x => x.url).join() === b.items.slice(0, 3).map(x => x.url).join();
    const relevant = a.items.filter(x => eng.isRelevant(x.title, SEED_A)).length;
    if (sameGrid) { rec.verdict = 'IGNORES_QUERY'; rec.tpl = tpl; return rec; }
    if (!relevant) { await sleep(1000); continue; }

    rec.verdict = 'RESOLVED';
    rec.tpl = tpl;
    rec.sample = a.items.slice(0, 3);
    rec.counts = { a: a.items.length, b: b.items.length, relevant };
    return rec;
  }
  rec.verdict = 'UNRESOLVED';
  return rec;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------- run ---------------------------------- */
let targets;
try {
  targets = require('../scripts/triage-searchpath.json').results
    .filter(r => r.verdict === 'NO_PRODUCTS')
    .map(r => ({ domain: r.domain, tier: r.tier }));
} catch { targets = []; }
if (ONLY) targets = targets.filter(t => ONLY.has(t.domain));
if (LIMIT) targets = targets.slice(0, LIMIT);

console.log(`render-discovery over ${targets.length} client-rendered store(s)${DRY ? '  [DRY RUN]' : ''}\n`);

const out = []; let i = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (i < targets.length) {
    const t = targets[i++];
    const t0 = Date.now();
    let rec;
    try { rec = await discover(t); } catch (e) { rec = { domain: t.domain, tier: t.tier, verdict: 'ERROR', err: String(e.message).slice(0, 60) }; }
    rec.ms = Date.now() - t0;
    out.push(rec);
    console.log(`${rec.verdict.padEnd(14)} t${rec.tier} ${rec.domain.padEnd(26)} ${Math.round(rec.ms / 1000)}s  ${rec.tpl ? rec.tpl.replace('{q}', '…').slice(0, 58) : ''}`);
    if (rec.verdict === 'RESOLVED') rec.sample.forEach(s => console.log(`      ${String(s.price).padStart(8)}  ${s.title.slice(0, 44)}`));
  }
}));

// --- 4. persist -----------------------------------------------------------
const resolved = out.filter(r => r.verdict === 'RESOLVED');
if (!DRY && resolved.length) {
  const f = path.join(ROOT, 'site', 'data', 'stores.json');
  const reg = JSON.parse(await readFile(f, 'utf8'));
  let n = 0;
  for (const r of resolved) {
    const s = reg.stores.find(x => x.domain === r.domain);
    if (!s) continue;
    s.platform = 'render'; s.renderTpl = r.tpl; s.needsHeadless = true;
    delete s.failN; delete s.lastFail; s.lastOk = Date.now();
    n++;
  }
  await writeFile(f, JSON.stringify(reg, null, 1));
  console.log(`\npersisted ${n} store(s) as platform:'render'`);
}

await writeFile(path.join(ROOT, 'scripts', 'render-discovery-report.json'),
  JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));

const by = {};
for (const r of out) (by[r.verdict] ||= []).push(r.domain);
console.log('\n================ SUMMARY ================');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
  console.log(`${k.padEnd(15)} ${String(v.length).padStart(3)}  ${v.slice(0, 8).join(', ')}${v.length > 8 ? ' …' : ''}`);
console.log(`\nRESOLVED: ${resolved.length} of ${out.length}`);
console.log('report -> scripts/render-discovery-report.json');
process.exit(0);
