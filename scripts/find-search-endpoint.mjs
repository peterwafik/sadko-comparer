/* ============================================================================
   Third pass: for stores whose search template is wrong (NO_SEARCH), find the
   REAL one. Reads each store's homepage, extracts its <form> search action and
   input name, and also sweeps a wider template list than the engine's `auto`.
   Prints a ready-to-paste template for the ones that can be rescued.
   ========================================================================== */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.SADKO_NO_SERVE = '1';
const { jsonLdProducts, htmlHarvest } = await import('../site/compare-server.mjs');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const TARGETS = {
  'hyperone.com.eg': 'تلفزيون', 'amanstores.com': 'تلفزيون', 'egyptlaptop.com': 'laptop',
  'fresh.com.eg': 'بوتاجاز', 'airo-shop.com': 'تلفزيون', 'awadserag.com': 'تلفزيون',
  'drmobilestore.com': 'موبايل', 'hans.com.eg': 'تلفزيون', 'najm.store': 'تلفزيون',
  'ram-e-shop.com': 'arduino', 'unionaire.com': 'تكييف', 'smeg.com.eg': 'فرن',
  'shams-stores.com': 'تلفزيون', 'switchpluseg.com': 'تلفزيون', 'wdestores.com': 'تلفزيون',
  'shaarp.net': 'تلفزيون', 'computershopegypt.com': 'laptop', 'souqcairo.net': 'تلفزيون',
  'sevencameras.com': 'كاميرا',
};
const WIDE = [
  '/search?q=', '/search?query=', '/search?keyword=', '/search?s=', '/search?term=',
  '/?s=', '/?s={q}&post_type=product', '/catalogsearch/result/?q=',
  '/index.php?route=product/search&search=', '/shop?q=', '/shop/?s=', '/store/search?q=',
  '/ar/search?q=', '/en/search?q=', '/products/search?q=', '/collections/all?q=',
  '/search/{q}', '/pages/search-results-page?q=', '/catalog/search?q=',
];

async function get(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8', 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.7' },
    redirect: 'follow', signal: AbortSignal.timeout(18000),
  });
  return { code: r.status, final: r.url, html: await r.text() };
}
const build = (host, tpl, q) => tpl.includes('{q}')
  ? host + tpl.replace(/\{q\}/g, encodeURIComponent(q))
  : host + tpl + encodeURIComponent(q);

async function probe(domain, q) {
  const rec = { domain, q, formAction: null, working: [] };
  const hosts = [`https://www.${domain}`, `https://${domain}`];

  // 1) read the store's own search form — the most reliable source of truth
  for (const h of hosts) {
    try {
      const { html } = await get(h + '/');
      const form = html.match(/<form[^>]*(?:role="search"|class="[^"]*search[^"]*"|action="[^"]*search[^"]*")[^>]*>[\s\S]{0,900}?<\/form>/i);
      if (form) {
        const action = (form[0].match(/action="([^"]*)"/i) || [])[1];
        const input = (form[0].match(/<input[^>]*name="([^"]+)"/i) || [])[1];
        if (action !== undefined && input) rec.formAction = { action: action || '/', input };
      }
      break;
    } catch {}
  }

  // 2) candidate templates: the form's own action first, then the wide sweep
  const cands = [];
  if (rec.formAction) cands.push(`${rec.formAction.action || '/'}${rec.formAction.action?.includes('?') ? '&' : '?'}${rec.formAction.input}=`);
  cands.push(...WIDE);

  for (const tpl of cands) {
    for (const h of hosts) {
      let r;
      try { r = await get(build(h, tpl, q)); } catch { continue; }
      if (r.code >= 400) continue;
      const ld = jsonLdProducts(r.html, domain).length;
      const hv = htmlHarvest(r.html, domain).length;
      if (ld + hv > 0) {
        rec.working.push({ tpl, host: h, ld, hv, code: r.code });
        break;
      }
    }
    if (rec.working.length) break;
  }
  const w = rec.working[0];
  console.log(`${(w ? 'FIXABLE' : 'NO_ENDPOINT').padEnd(12)} ${domain.padEnd(28)} ` +
    (w ? `tpl=${w.tpl}  (ld=${w.ld} hv=${w.hv})` : `form=${rec.formAction ? rec.formAction.action + '?' + rec.formAction.input : 'none found'}`));
  return rec;
}

const entries = Object.entries(TARGETS);
const out = []; let i = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (i < entries.length) { const [d, q] = entries[i++]; out.push(await probe(d, q)); }
}));

const file = path.join(ROOT, 'scripts', 'endpoint-report.json');
await writeFile(file, JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
const fixable = out.filter(r => r.working.length);
console.log(`\n=== ${fixable.length}/${out.length} rescuable ===`);
for (const r of fixable) console.log(`  ${r.domain.padEnd(28)} platform: 'jsonld:${r.working[0].tpl}'`);
console.log('\nreport →', file);
process.exit(0);
