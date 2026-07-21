/* ============================================================================
   scripts/discover-search.mjs
   ----------------------------------------------------------------------------
   Search-endpoint auto-discovery. The reachability matrix found that most
   "unreachable" Egyptian stores are alive (HTTP 200, real content) but the
   engine simply does not know their search URL. This script discovers one,
   VALIDATES it against real extracted products, and persists it.

   Discovery ladder per store — stop at the first template that validates:
     1. static homepage <form> (action + text/search input)
     2. rendered homepage <form> (headless Chrome, for JS-only SPAs)
     3. known platform templates (Magento/Woo/OpenCart/Shopify/Odoo shapes)

   Validation: fetch the candidate for a broad term, extract via
   jsonLdProducts → htmlHarvest → (if both empty) headless render + harvest.
   A template only counts if it yields >=2 items with a price and a title
   longer than 12 characters.

   Politeness: >=1s between requests to the same domain, at most 4 domains
   concurrently, 20s timeout, <=12 candidate templates per store. A
   401/403/429 or bot-wall response is recorded BLOCKED and the store is
   abandoned immediately — no retries.

   Run:
     node scripts/discover-search.mjs [--only domain,...] [--limit N] [--dry-run]

   Writes: site/data/stores.json (unless --dry-run)
   Reads:  scripts/reachability-report.json for the default target list
   ========================================================================== */
process.env.SADKO_NO_SERVE = '1';

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderPage, headlessAvailable } from '../site/headless.mjs';
import { parsePrice, decodeEntities } from '../site/engine/offer-gate.mjs';
// dynamic import: static `import` is hoisted above this file's own body, which
// would set SADKO_NO_SERVE too late and let compare-server.mjs start its HTTP
// server (see the module banner warning) — a plain top-of-file static import
// of compare-server.mjs WILL hang this script.
const { jsonLdProducts, htmlHarvest, loadRegistry } = await import('../site/compare-server.mjs');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG_FILE = path.join(ROOT, 'site', 'data', 'stores.json');
const REPORT_FILE = path.join(ROOT, 'scripts', 'reachability-report.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ---------------- CLI args ---------------- */
const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;
const LIMIT = +(arg('--limit') || 0);
const DRY = process.argv.includes('--dry-run');

/* ---------------- constants ---------------- */
const SEEDS = ['تلفزيون', 'samsung', 'laptop'];
const MAX_CANDIDATES = 12;
const DOMAIN_GAP_MS = 1000;
const CONCURRENCY = 4;
const TIMEOUT_MS = 20000;
const BOT = /cloudflare|challenge-platform|datadome|captcha|just a moment|attention required|checking your browser|incapsula|imperva|access denied/i;

/* Known platform search-URL shapes: the three real-world observed ones from
   the M1 triage first (highest hit probability), then the engine's own
   `auto` sweep list (site/compare-server.mjs ADAPTERS.auto TPLS), deduped. */
const PLATFORM_TPLS = [
  '/ar/catalogsearch/result/?q=',
  '/en/catalogsearch/result/?q=',
  '/ar/search?q=',
  '/en/search?q=',
  '/ar/website/search?search=',
  '/search?q=',
  '/catalogsearch/result/?q=',
  '/?s=',
  '/index.php?route=product/search&search=',
  '/search/?q=',
  '/ar/search?keyword=',
  '/shop/?s=',
  '/products?q=',
];

/* in-page harvester for client-rendered storefronts — verbatim copy of
   RENDER_SCRIPT (mkRenderScript(true)) from site/compare-server.mjs; not
   exported there, so duplicated here rather than modifying that file. */
const RENDER_SCRIPT = `(async()=>{
  for(let i=0;i<6;i++){ window.scrollBy(0, document.documentElement.scrollHeight); await new Promise(r=>setTimeout(r,700)); }
  const out=[],seen=new Set();
  const P=/(EGP|LE|E£|ج\\.?\\s?م|جنيه)/;
  for(const a of document.querySelectorAll('a[href]')){
    const h=a.href||'';
    if(!/\\/(product|products|item)\\/|\\/p\\/|-p-?\\d/i.test(h)) continue;
    const clean=h.split('?')[0];
    if(seen.has(clean)) continue;
    let card=a,hops=0,txt='';
    while(card&&hops<5){ txt=(card.textContent||'').trim(); if(P.test(txt)&&txt.length<700) break; card=card.parentElement; hops++; }
    if(!card||!P.test(txt)) continue;
    const img=card.querySelector&&card.querySelector('img[alt]');
    const name=(img&&img.alt)||a.getAttribute('aria-label')||a.title||((a.textContent||'').replace(/\\s+/g,' ').trim());
    seen.add(clean);
    out.push({h:clean.slice(0,220),name:String(name).slice(0,140),t:txt.replace(/\\s+/g,' ').slice(0,220)});
    if(out.length>=48) break;
  }
  return out;
})()`;

/* ---------------- small toolkit (local copies — engine internals aren't exported) ---------------- */
function normDigits(s) {
  return String(s).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)).replace(/[٬٫]/g, ',');
}
function extractPrices(text) {
  const t = normDigits(String(text || ''));
  const out = [];
  const re = /(?:EGP|LE|E£|ج\.?\s?م|جنيه)\s*[:\s]?([\d][\d.,\s]{1,12})|([\d][\d.,\s]{1,12})\s*(?:EGP|LE|E£|ج\.?\s?م|جنيه)/gi;
  let m; while ((m = re.exec(t))) { const v = parsePrice(m[1] || m[2]); if (v) out.push(v); }
  return out;
}
function mapRenderCards(value) {
  return (value || []).map(v => {
    const price = extractPrices(v.t)[0] || 0;
    let title = decodeEntities(v.name || '').trim();
    if (title.length < 12)
      title = decodeEntities(v.t).replace(/[\d.,]+\s*(EGP|LE|جنيه|ج\.?\s?م)[\s\S]*$/i, '').trim();
    title = title.replace(/\s[\d.,]{3,12}\s*$/, '').replace(/^\d{2,6}\s*/, '');
    return price && title.length > 10 ? { title: title.slice(0, 140), price, url: v.h } : null;
  }).filter(Boolean);
}
function qualifies(items) {
  return (items || []).filter(i => i.price && i.title && i.title.length > 12).length >= 2;
}
function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/* ---------------- politeness gate ---------------- */
const lastReq = new Map();
async function politeWait(domain) {
  const last = lastReq.get(domain) || 0;
  const wait = last + DOMAIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastReq.set(domain, Date.now());
}

async function getPage(domain, url) {
  await politeWait(domain);
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8', 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.7' },
    redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await r.text().catch(() => '');
  if (!r.ok) {
    const err = new Error('HTTP ' + r.status);
    err.status = r.status;
    throw err;
  }
  if (BOT.test(body.slice(0, 6000))) {
    const err = new Error('BOT_WALL'); err.blocked = true;
    throw err;
  }
  return body;
}
const isBlockedErr = e => e && (e.blocked || (e.status && [401, 403, 429].includes(e.status)));

/* ---------------- <form> extraction ---------------- */
function extractSearchForm(html) {
  const forms = [...String(html || '').matchAll(/<form\b[^>]*>[\s\S]{0,2000}?<\/form>/gi)];
  for (const fm of forms) {
    const tag = fm[0];
    const openTag = (tag.match(/<form\b[^>]*>/i) || [''])[0];
    const action = (openTag.match(/action="([^"]*)"/i) || [])[1];
    const cls = (openTag.match(/class="([^"]*)"/i) || [])[1] || '';
    const mentionsSearch = /search/i.test(action || '') || /search/i.test(cls) || /role="search"/i.test(openTag);
    if (!mentionsSearch) continue;
    const inputs = [...tag.matchAll(/<input\b[^>]*>/gi)];
    let inputName = null;
    for (const inp of inputs) {
      const t = inp[0];
      const type = (t.match(/type="([^"]*)"/i) || [])[1] || 'text';
      if (!/^(text|search)$/i.test(type)) continue;
      const name = (t.match(/name="([^"]*)"/i) || [])[1];
      if (name) { inputName = name; break; }
    }
    if (inputName) return { action: action ?? '', input: inputName };
  }
  return null;
}
function absUrl(u, base) {
  try { return new URL(u, base).href; } catch { return base; }
}
function toRelTemplate(absoluteUrl) {
  try { const u = new URL(absoluteUrl); return u.pathname + u.search; }
  catch { return absoluteUrl; }
}
/* build a "?input=" template from a discovered form, resolved against the
   base URL that actually served the page (handles absolute AND relative
   actions, and preserves any existing query string on the action) */
function formCandidate(base, form) {
  const actionAbs = absUrl(form.action || '/', base);
  let u; try { u = new URL(actionAbs); } catch { return null; }
  const sep = u.search ? '&' : '?';
  return u.origin + u.pathname + u.search + sep + form.input + '=';
}

/* ---------------- per-store discovery ---------------- */
async function discoverStore(store) {
  const domain = store.domain;
  const result = { domain, status: 'UNRESOLVED', reason: '', tried: 0 };

  // Step 1: static homepage form
  let staticHtml = null, staticBase = null;
  for (const host of [`https://www.${domain}/`, `https://${domain}/`]) {
    try { staticHtml = await getPage(domain, host); staticBase = host; break; }
    catch (e) {
      if (isBlockedErr(e)) { result.status = 'BLOCKED'; result.reason = 'homepage: ' + e.message; return result; }
    }
  }

  const candidates = [];
  if (staticHtml) {
    const form = extractSearchForm(staticHtml);
    if (form) {
      const tplUrl = formCandidate(staticBase, form);
      if (tplUrl) candidates.push({ source: 'static-form', persistTpl: toRelTemplate(tplUrl), urls: seed => [tplUrl + encodeURIComponent(seed)] });
    }
  }

  // Step 2: rendered homepage form — only if static form-scan found nothing
  if (!candidates.length && headlessAvailable()) {
    try {
      await politeWait(domain);
      const target = staticBase || `https://${domain}/`;
      const { html: renderedHtml } = await withTimeout(renderPage(target, { waitMs: 4000 }), TIMEOUT_MS);
      const form = extractSearchForm(renderedHtml);
      if (form) {
        const tplUrl = formCandidate(target, form);
        if (tplUrl) candidates.push({ source: 'render-form', persistTpl: toRelTemplate(tplUrl), urls: seed => [tplUrl + encodeURIComponent(seed)] });
      }
    } catch {}
  }

  // Step 3: known platform templates
  for (const tpl of PLATFORM_TPLS) {
    candidates.push({
      source: 'platform', persistTpl: tpl,
      urls: seed => [`https://www.${domain}${tpl}${encodeURIComponent(seed)}`, `https://${domain}${tpl}${encodeURIComponent(seed)}`],
    });
  }

  const capped = candidates.slice(0, MAX_CANDIDATES);
  result.tried = capped.length;

  for (const cand of capped) {
    for (const seed of SEEDS) {
      for (const url of cand.urls(seed)) {
        let html;
        try { html = await getPage(domain, url); }
        catch (e) {
          if (isBlockedErr(e)) { result.status = 'BLOCKED'; result.reason = 'search: ' + e.message; return result; }
          continue;
        }
        let items = jsonLdProducts(html, domain);
        let method = 'jsonld';
        if (!qualifies(items)) { items = htmlHarvest(html, domain); method = 'harvest'; }
        if (!qualifies(items) && headlessAvailable()) {
          try {
            await politeWait(domain);
            const { value } = await withTimeout(renderPage(url, { waitMs: 6000, script: RENDER_SCRIPT }), TIMEOUT_MS);
            items = mapRenderCards(value);
            method = 'render';
          } catch {}
        }
        if (qualifies(items)) {
          result.status = 'RESOLVED';
          result.source = cand.source;
          result.url = url;
          result.seed = seed;
          result.method = method;
          result.sample = items.filter(i => i.price && i.title && i.title.length > 12).slice(0, 2)
            .map(i => ({ title: i.title, price: i.price }));
          if (method === 'render') {
            result.platform = 'render';
            result.renderTpl = url.split(encodeURIComponent(seed)).join('{q}');
            result.needsHeadless = true;
          } else {
            result.platform = 'jsonld:' + cand.persistTpl;
          }
          return result;
        }
      }
    }
  }
  result.status = 'UNRESOLVED';
  result.reason = capped.length ? `${capped.length} candidates x ${SEEDS.length} seeds, none validated` : 'no search form found on homepage, no platform template matched';
  return result;
}

/* ---------------- target selection ---------------- */
const reg = await loadRegistry();
let targetDomains;
if (ONLY) {
  targetDomains = [...ONLY];
} else {
  let unreachable = null;
  try {
    const report = JSON.parse(await readFile(REPORT_FILE, 'utf8'));
    unreachable = report.results.filter(r => r.verdict !== 'REACHABLE').map(r => r.domain);
  } catch {}
  targetDomains = unreachable || reg.stores.map(s => s.domain);
}
if (LIMIT) targetDomains = targetDomains.slice(0, LIMIT);

const byDomain = new Map(reg.stores.map(s => [s.domain, s]));
const targets = targetDomains.map(d => byDomain.get(d)).filter(Boolean);
const missing = targetDomains.filter(d => !byDomain.has(d));
if (missing.length) console.log(`(skipping ${missing.length} domain(s) not in registry: ${missing.join(', ')})`);

console.log(`discover-search over ${targets.length} store(s)${DRY ? '  [DRY RUN]' : ''}\n`);

/* ---------------- run ---------------- */
const results = [];
let i = 0;
async function worker() {
  while (i < targets.length) {
    const s = targets[i++];
    const t0 = Date.now();
    const r = await discoverStore(s);
    r.ms = Date.now() - t0;
    results.push(r);
    const label = r.status === 'RESOLVED' ? `${r.platform}${r.renderTpl ? ' -> ' + r.renderTpl : ''}` : (r.reason || '');
    console.log(`${r.status.padEnd(11)} ${s.domain.padEnd(28)} ${label}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

/* ---------------- persist ---------------- */
let persisted = 0;
if (!DRY) {
  for (const r of results) {
    if (r.status !== 'RESOLVED') continue;
    const store = byDomain.get(r.domain);
    if (!store) continue;
    store.platform = r.platform;
    if (r.method === 'render') { store.renderTpl = r.renderTpl; store.needsHeadless = true; }
    store.failN = 0;
    store.lastFail = 0;
    store.lastOk = Date.now();
    persisted++;
  }
  if (persisted) await writeFile(REG_FILE, JSON.stringify(reg, null, 1));
} else {
  persisted = results.filter(r => r.status === 'RESOLVED').length;
}

/* ---------------- summary ---------------- */
const by = {};
for (const r of results) (by[r.status] ||= []).push(r.domain);
console.log('\n================ SUMMARY ================');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
  console.log(`${k.padEnd(12)} ${String(v.length).padStart(3)}   ${v.slice(0, 8).join(', ')}${v.length > 8 ? ' …' : ''}`);
console.log(`\nresolved: ${persisted} of ${results.length}${DRY ? ' (dry-run — nothing written)' : ' — written to ' + REG_FILE}`);
process.exit(0);
