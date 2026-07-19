/* ============================================================================
   Second pass: for every store the sweep marked NO_PARSE / ADAPTER_ERROR, work
   out WHY the adapter came back empty. Fetches the store's own search page and
   classifies the response:

     BOT_WALL   — Cloudflare / DataDome / captcha interstitial
     SPA_SHELL  — 200 with a near-empty body; the grid is client-rendered
     NO_STOCK   — real product markup present, just nothing matching the probe
     NO_SEARCH  — search endpoint 404s / redirects home; template is wrong
     PARSER_GAP — prices ARE in the HTML but jsonLdProducts/htmlHarvest miss them

   Brand-official stores are probed with a category they actually sell, so a
   Unionaire or Kiriazi is not condemned for having no Samsung laptops.
   ========================================================================== */
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.SADKO_NO_SERVE = '1';
const { jsonLdProducts, htmlHarvest } = await import('../site/compare-server.mjs');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* stores that only make one product family — probing them for "laptop" proves
   nothing, so ask for what they actually sell */
const BRAND_QUERY = {
  'unionaire.com': 'تكييف', 'kiriazi.com': 'ثلاجة', 'zanussi.com.eg': 'غسالة',
  'smeg.com.eg': 'فرن', 'fresh.com.eg': 'بوتاجاز', 'sharp-egypt.com': 'تلفزيون',
  'sharpegy.com': 'تلفزيون', 'shaarp.net': 'تلفزيون', 'nikon.com.eg': 'كاميرا',
  'procam.com.eg': 'كاميرا', 'sevencameras.com': 'كاميرا',
  'eshop.vodafone.com.eg': 'موبايل', 'eratablet.com': 'تابلت',
  'store.fut-electronics.com': 'arduino', 'ram-e-shop.com': 'arduino',
};
const TPLS = ['/search?q=', '/catalogsearch/result/?q=', '/?s=', '/search/?q=',
  '/index.php?route=product/search&search=', '/en/catalogsearch/result/?q=', '/products?q='];

const BOT = /cloudflare|cf-browser-verification|challenge-platform|datadome|captcha|Just a moment|Attention Required|Checking your browser|incapsula|imperva|Access denied/i;
const PRICE = /(?:EGP|LE|E£|ج\.?\s?م|جنيه)\s*[:\s]?[\d]|[\d][\d.,\s]{2,12}\s*(?:EGP|LE|E£|ج\.?\s?م|جنيه)/i;

async function get(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8', 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.7' },
    redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  return { code: r.status, final: r.url, html: await r.text() };
}

async function diagnose(domain) {
  const q = BRAND_QUERY[domain] || 'تلفزيون';
  const rec = { domain, q, tried: [] };
  let best = null;
  for (const tpl of TPLS) {
    for (const host of [`https://www.${domain}`, `https://${domain}`]) {
      let r;
      try { r = await get(`${host}${tpl}${encodeURIComponent(q)}`); }
      catch (e) { rec.tried.push({ tpl, err: String(e.cause?.code || e.message).slice(0, 40) }); continue; }
      const body = r.html;
      const ld = jsonLdProducts(body, domain).length;
      const hv = htmlHarvest(body, domain).length;
      const hit = {
        tpl, code: r.code, bytes: body.length, ld, hv,
        bot: BOT.test(body.slice(0, 6000)),
        price: PRICE.test(body),
        prodLinks: (body.match(/href="[^"]*\/(product|products|item|p)\//gi) || []).length,
        redirectedHome: new URL(r.final).pathname.replace(/\/$/, '') === '',
      };
      rec.tried.push(hit);
      if (!best || (hit.ld + hit.hv) > (best.ld + best.hv) || (hit.price && !best.price)) best = hit;
      if (hit.ld + hit.hv > 0) break;
    }
    if (best && best.ld + best.hv > 0) break;
  }
  rec.best = best;
  rec.verdict =
    !best ? 'DEAD'
    : best.bot ? 'BOT_WALL'
    : best.ld + best.hv > 0 ? 'PARSER_OK_NOW'
    : best.redirectedHome || best.code === 404 ? 'NO_SEARCH'
    : best.price && best.prodLinks > 0 ? 'PARSER_GAP'
    : best.bytes < 60000 && best.prodLinks === 0 ? 'SPA_SHELL'
    : 'NO_STOCK';
  console.log(`${rec.verdict.padEnd(14)} ${domain.padEnd(30)} q=${q} ` +
    `${best ? `code=${best.code} bytes=${best.bytes} ld=${best.ld} hv=${best.hv} price=${best.price} links=${best.prodLinks} tpl=${best.tpl}` : 'no response'}`);
  return rec;
}

const report = JSON.parse(await readFile(path.join(ROOT, 'scripts', 'adapter-report.json'), 'utf8'));
const targets = report.results
  .filter(r => r.verdict === 'NO_PARSE' || r.verdict === 'ADAPTER_ERROR')
  .map(r => r.domain);

console.log(`diagnosing ${targets.length} empty-response stores\n`);
const out = [];
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < targets.length) out.push(await diagnose(targets[i++]));
}));

const file = path.join(ROOT, 'scripts', 'noparse-report.json');
await writeFile(file, JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
const by = {};
for (const r of out) (by[r.verdict] ||= []).push(r.domain);
console.log('\n=== diagnosis ===');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
  console.log(`${k.padEnd(14)} ${v.length}\n   ${v.join('\n   ')}`);
console.log('\nreport →', file);
process.exit(0);
