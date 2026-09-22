/* ============================================================================
   SADKO self-owned price-comparer engine — no external search API, no keys.
   ----------------------------------------------------------------------------
   Run:  node compare-server.mjs        → http://localhost:8082
   The engine queries Egyptian stores DIRECTLY from this machine:

   · Store adapters — each store's own public search endpoint:
       magento   /catalogsearch/result/?q=   (B.TECH, 2B, Raneen, ElAraby…)
       woo-json  /wp-json/wc/store/v1/products?search=   (WooCommerce shops)
       shopify   /search/suggest.json?q=                 (Shopify shops)
       jsonld    any search page carrying schema.org Product/ItemList
       amazon / noon — best-effort HTML parsers (bot walls may refuse; the
       engine reports them as unreachable instead of failing the search)
       local     SADKO's own catalog (data/products.json)

   · Registry data/stores.json — seeded with the majors; every entry's
     platform is auto-detected by probing, so adding a store = one domain.

   · Discovery — per query the engine also scrapes DuckDuckGo/Bing public
     HTML results (keyless) for Egyptian shops selling the item, probes any
     unknown domain, and persists working stores into the registry. New
     stores on the Egyptian web become detectable automatically.

   · Tiered registry (~90 seeded Egyptian stores) + circuit breaker: tier 1–2
     and proven stores answer live; unproven tier 3–4 are swept in the
     background and graduate once they respond. Broken stores rest 6h.

   · Offer index (data/price-index.json) — stale-while-revalidate: fresh
     (≤10 min) answers instantly from the index, stale (≤24 h) answers
     instantly AND re-scans in the background (client polls `refreshing`),
     price history kept per product URL.

   · Optional AI layer — set NVIDIA_API_KEY to enable Nemotron
     (https://integrate.api.nvidia.com): structures queries into brand/model/
     size in both languages (sharper store searches + variant hard-filters)
     and audits offers (used/bundle/accessory/mismatch flags). Ranking stays
     DETERMINISTIC — the model never decides what is cheapest. Without a key
     the engine runs fully rule-based, as before.

   API:
     GET  /api/compare?q=&min=&max=&discover=0|1&lang=ar|en
     GET  /api/stores
     POST /api/stores  {domain, name?}     → probe + persist
   ========================================================================== */

import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, headlessAvailable } from './headless.mjs';
import { parsePrice, decodeEntities, isProductOffer, UI_TITLE, BAD_URL } from './engine/offer-gate.mjs';
import { extractUnits } from './engine/units.mjs';
import { openCatalog } from './engine/catalog.mjs';
import { rankOffers, mergeLiveRows } from './engine/serve.mjs';
import { extractProduct } from './engine/extract.mjs';
import { discoverProductUrls, tavilyEnabled } from './engine/tavily.mjs';
import { createVerifyOffer } from './engine/verify.mjs';
import { openAccounts, ORDER_STATUSES } from './engine/accounts.mjs';
import { verifyIdToken, enabledProviders } from './engine/oidc.mjs';
import { openCatalogAdmin, EDITABLE_FIELDS } from './engine/catalog-admin.mjs';
import { openAnalytics, EVENT_TYPES, FUNNEL_STAGES } from './engine/analytics.mjs';
/* Ecwid — design: docs/superpowers/specs/2026-09-15-ecwid-integration-design.md
   plus revision 2 (2026-09-21). Everything is behind SADKO_ECWID; with the flag
   unset every catalogue path behaves exactly as it did before. */
import { openEcwidStore } from './engine/ecwid-store.mjs';
import { openEcwidApi } from './engine/ecwid-api.mjs';
import { createEcwidSync } from './engine/ecwid-sync.mjs';
import { createEcwidSource } from './engine/ecwid-source.mjs';
import { verifyWebhook, parseWebhook } from './engine/ecwid-webhook.mjs';
import { deriveRails, deriveBanners, resolveRailCategories } from './engine/ecwid-rails.mjs';
import { toStorefrontMethods, FALLBACK_METHODS } from './engine/ecwid-payments.mjs';
import { toStorefrontShipping } from './engine/ecwid-shipping.mjs';
import { mergeOrders } from './engine/ecwid-customers.mjs';
import { resolveCategory, repointCategoryPage, retargetCategoryPage } from './engine/category-alias.mjs';
import { adFoldersFromEnv, adCounts, adIssues, mergePromos } from './engine/ecwid-ads.mjs';
import { toLocalStatus } from './engine/ecwid-map.mjs';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const randBytesHex = n => randomBytes(n).toString('hex');

/* JSON data files the owner may edit from the control room. Whitelisted so the
   content endpoint can never be pointed at an arbitrary path on disk. */
/* JSON content files the owner may edit from the control room.
   The CATALOGUE is deliberately absent: Ecwid owns products, and a JSON editor
   for products.json would let someone edit the seed and see nothing change.
   collections.json is absent for the same reason — the rails are derived from
   Ecwid category membership (engine/ecwid-rails.mjs), so editing the static
   file would appear to work and then silently do nothing.
   These three are the site's OWN editorial content, which Ecwid cannot hold. */
const ADMIN_CONTENT = {
  guides: { file: 'guides.json', label: 'أدلة الشراء / Buying guides' },
  finder: { file: 'finder.json', label: 'مساعد الاختيار / Finder questions' },
  /* Banner artwork can come from the dedicated Ecwid category, but derived
     banners carry no English — the store holds no usable translations — so
     this file stays the bilingual source and the fallback when that category
     is empty. See engine/ecwid-rails.mjs deriveBanners(). */
  promos: { file: 'promos.json', label: 'لافتات الإعلانات / Advertisement banners' },
};

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8082);
const REG_FILE = path.join(ROOT, 'data', 'stores.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ================= seed registry ================= */
const SEED_V = 7;
/* Tiered registry (t: 1 = major marketplace/chain, 2 = established retailer or
   official brand store, 3 = local/specialist shop, 4 = low-confidence).
   Tier 1–2 (plus any store that has EVER answered) are scanned live on every
   search; unproven tier 3–4 stores are swept in the background and graduate to
   the live wave the first time they answer. Platform 'auto' self-detects and
   is persisted, so each store's cheapest working endpoint is learned once. */
const SEED = [
  // — tier 1: major marketplaces & nationwide chains —
  { domain: 'sadko-group.com',    name: 'صادكو جروب',   nameEn: 'SADKO Group',   type: 'mega', t: 1, platform: 'local' },
  { domain: '2b.com.eg',          name: '2B مصر',       nameEn: '2B Egypt',      type: 'mega', t: 1, platform: 'gql', gqlHost: '2b.com.eg' },
  { domain: 'raneen.com',         name: 'رنين',         nameEn: 'Raneen',        type: 'mega', t: 1, platform: 'gql' },
  { domain: 'elarabygroup.com',   name: 'العربى جروب',  nameEn: 'ElAraby Group', type: 'mega', t: 1, platform: 'gql' },
  /* NOTE: GraphQL answers empty. Do NOT switch to 'auto' — the sweep learns
     /?s=, a WP blog search that ignores the query and returns the same 10
     unrelated products every time. Needs a real search endpoint. */
  { domain: 'rayashop.com',       name: 'راية شوب',     nameEn: 'Raya Shop',     type: 'mega', t: 1, platform: 'gql' },
  { domain: 'jumia.com.eg',       name: 'جوميا',        nameEn: 'Jumia',         type: 'mega', t: 1, platform: 'jumia' },
  { domain: 'noon.com',           name: 'نون',          nameEn: 'noon',          type: 'mega', t: 1, platform: 'noon' },
  { domain: 'btech.com',          name: 'بى تك',        nameEn: 'B.TECH',        type: 'mega', t: 1, platform: 'btech',     needsHeadless: true },
  { domain: 'amazon.eg',          name: 'أمازون مصر',   nameEn: 'Amazon Egypt',  type: 'mega', t: 1, platform: 'amazon',    needsHeadless: true },
  { domain: 'carrefouregypt.com', name: 'كارفور مصر',   nameEn: 'Carrefour Egypt', type: 'mega', t: 1, platform: 'carrefour', needsHeadless: true },
  /* NOTE: Woo REST is off. Do NOT switch to 'auto' — /?s= yields category
     BANNERS parsed as products (a black-friday landing page at 2599 EGP). */
  { domain: 'egypt.sharafdg.com', name: 'شرف دى جى',    nameEn: 'Sharaf DG',     type: 'mega', t: 1, platform: 'woo' },
  { domain: 'hyperone.com.eg',    name: 'هايبر وان',    nameEn: 'Hyper One',     type: 'mega', t: 1, platform: 'auto' },
  { domain: 'amanstores.com',     name: 'أمان',         nameEn: 'Aman Stores',   type: 'mega', t: 1, platform: 'auto' },
  // — tier 2: established retailers & official Egyptian brand stores —
  { domain: 'kenzz.com',          name: 'كنز',          nameEn: 'Kenzz',         type: 'mega', t: 2, platform: 'auto' },
  { domain: 'elghazawy.com',      name: 'الغزاوى',      nameEn: 'ElGhazawy',     type: 'mega', t: 2, platform: 'render',
    renderTpl: 'https://www.elghazawy.com/en/search?q={q}', needsHeadless: true },
  { domain: 'kaza.com.eg',        name: 'كازا',         nameEn: 'Kaza Stores',   type: 'mega', t: 2, platform: 'auto' },
  { domain: 'homzmart.com',       name: 'هومزمارت',     nameEn: 'Homzmart',      type: 'mega', t: 2, platform: 'render',
    renderTpl: 'https://homzmart.com/en/search?keyword={q}', needsHeadless: true },
  { domain: 'dream2000.com',      name: 'دريم 2000',    nameEn: 'Dream 2000',    type: 'mega', t: 2, platform: 'auto' },
  { domain: 'imediastores.com',   name: 'آى ميديا',     nameEn: 'iMedia Stores', type: 'mega', t: 2, platform: 'auto' },
  { domain: 'mobileshop.com.eg',  name: 'موبايل شوب',   nameEn: 'Mobile Shop',   type: 'mega', t: 2, platform: 'auto' },
  { domain: 'sigma-computer.com', name: 'سيجما كمبيوتر', nameEn: 'Sigma Computer', type: 'local', t: 2, platform: 'auto' },
  { domain: 'compumarts.com',     name: 'كمبيومارتس',   nameEn: 'Compumarts',    type: 'local', t: 2, platform: 'shopify' },
  { domain: 'egyptlaptop.com',    name: 'إيجيبت لابتوب', nameEn: 'Egypt Laptop', type: 'local', t: 2, platform: 'auto' },
  { domain: 'games2egypt.com',    name: 'جيمز 2 إيجيبت', nameEn: 'Games 2 Egypt', type: 'local', t: 2, platform: 'auto' },
  { domain: 'camerashop.com.eg',  name: 'كاميرا شوب',   nameEn: 'Camera Shop',   type: 'local', t: 2, platform: 'auto' },
  { domain: 'fresh.com.eg',       name: 'فريش',         nameEn: 'Fresh',         type: 'official', t: 2, platform: 'auto' },
  { domain: 'unionaire.com',      name: 'يونيون اير',   nameEn: 'Unionaire',     type: 'official', t: 2, platform: 'auto' },
  { domain: 'smeg.com.eg',        name: 'سميج',         nameEn: 'Smeg Egypt',    type: 'official', t: 2, platform: 'auto' },
  { domain: 'zanussi.com.eg',     name: 'زانوسى',       nameEn: 'Zanussi Egypt', type: 'official', t: 2, platform: 'auto' },
  // — tier 3: local appliance / electronics / mobile / computer shops —
  { domain: 'abdulaziz-stores.com', name: 'عبد العزيز', nameEn: 'Abdulaziz Stores', type: 'local', t: 3, platform: 'auto' },
  { domain: 'riz.shop',           name: 'رزق الله',     nameEn: 'Rizkalla',      type: 'local', t: 3, platform: 'auto' },
  { domain: 'ehabcenter.com',     name: 'إيهاب سنتر',   nameEn: 'Ehab Center',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'awadserag.com',      name: 'عوض سراج',     nameEn: 'Awad Serag',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'makka.store',        name: 'مكة ستور',     nameEn: 'Makka Store',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'wazen.eg',           name: 'وازن',         nameEn: 'Wazen',         type: 'local', t: 3, platform: 'auto' },
  { domain: 'aghezty.com',        name: 'أجهزتى',       nameEn: 'Aghezty',       type: 'local', t: 3, platform: 'auto' },
  { domain: 'airo-shop.com',      name: 'أيرو شوب',     nameEn: 'Airo Shop',     type: 'local', t: 3, platform: 'auto' },
  { domain: 'ustoreseg.com',      name: 'يو ستورز',     nameEn: 'U Stores',      type: 'local', t: 3, platform: 'auto' },
  { domain: 'abusolimanstores.com', name: 'أبو سليمان', nameEn: 'Abu Soliman',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'najm.store',         name: 'نجم ستور',     nameEn: 'Najm Store',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'wdestores.com',      name: 'دبليو دى إى',  nameEn: 'WDE Stores',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'hyper-techno.com',   name: 'هايبر تكنو',   nameEn: 'Hyper Techno',  type: 'local', t: 3, platform: 'auto' },
  { domain: 'souqcairo.net',      name: 'سوق القاهرة',  nameEn: 'Souq Cairo',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'dubaiforshopping.com', name: 'دبى للتسوق', nameEn: 'Dubai for Shopping', type: 'local', t: 3, platform: 'auto' },
  { domain: 'azmyco.com',         name: 'عزمى',         nameEn: 'Azmy Co',       type: 'local', t: 3, platform: 'auto' },
  { domain: 'jacoob1.com',        name: 'يعقوب',        nameEn: 'Jacoob',        type: 'local', t: 3, platform: 'auto' },
  { domain: 'miamicenters.com',   name: 'ميامى سنتر',   nameEn: 'Miami Center',  type: 'local', t: 3, platform: 'auto' },
  { domain: 'moreelectronicss.com', name: 'مور إلكترونيكس', nameEn: 'More Electronics', type: 'local', t: 3, platform: 'auto' },
  { domain: 'moreshopping.com',   name: 'مور شوبينج',   nameEn: 'More Shopping', type: 'local', t: 3, platform: 'auto' },
  { domain: 'brico-eg.com',       name: 'بريكو',        nameEn: 'Brico Egypt',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'mahgoub.com',        name: 'محجوب',        nameEn: 'Mahgoub',       type: 'local', t: 3, platform: 'auto' },
  { domain: 'elwaha.com.eg',      name: 'الواحة',       nameEn: 'Waha Appliances', type: 'local', t: 3, platform: 'auto' },
  { domain: 'hans.com.eg',        name: 'هانز',         nameEn: 'HANS Egypt',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'appliance.com.eg',   name: 'أبلاينس',      nameEn: 'Appliance Egypt', type: 'local', t: 3, platform: 'auto' },
  { domain: 'dubaiphone.net',     name: 'دبى فون',      nameEn: 'Dubai Phone',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'smartkoshk.com',     name: 'سمارت كشك',    nameEn: 'Smart Koshk',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'ennap.com',          name: 'إناب',         nameEn: 'Ennap',         type: 'local', t: 3, platform: 'auto' },
  { domain: 'switchpluseg.com',   name: 'سويتش بلس',    nameEn: 'Switch Plus',   type: 'local', t: 3, platform: 'auto' },
  { domain: 'drmobilestore.com',  name: 'دكتور موبايل', nameEn: 'Dr Mobile',     type: 'local', t: 3, platform: 'auto' },
  { domain: 'alsheikhstores.com', name: 'الشيخ ستورز',  nameEn: 'Al Sheikh Stores', type: 'local', t: 3, platform: 'auto' },
  { domain: 'iq-mobiles.com',     name: 'آى كيو موبايل', nameEn: 'IQ Mobile',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'kareemstores.com',   name: 'كريم ستورز',   nameEn: 'Kareem Stores', type: 'local', t: 3, platform: 'auto' },
  { domain: 'shams-stores.com',   name: 'شمس ستورز',    nameEn: 'Shams Stores',  type: 'local', t: 3, platform: 'auto' },
  { domain: 'tal2aa.com',         name: 'طلعة',         nameEn: 'Tal2a',         type: 'local', t: 3, platform: 'auto' },
  { domain: 'eratablet.com',      name: 'إيرا تابلت',   nameEn: 'ERA Tablet',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'maximumhardware.store', name: 'ماكسيمم هاردوير', nameEn: 'Maximum Hardware', type: 'local', t: 3, platform: 'auto' },
  { domain: 'compuscience.com.eg', name: 'كمبيوساينس',  nameEn: 'CompuScience',  type: 'local', t: 3, platform: 'auto' },
  { domain: 'computershopegypt.com', name: 'كمبيوتر شوب', nameEn: 'Computer Shop Egypt', type: 'local', t: 3, platform: 'auto' },
  { domain: 'elbadrgroupeg.store', name: 'البدر جروب',  nameEn: 'El Badr Group', type: 'local', t: 3, platform: 'auto' },
  { domain: 'elnekhelytechnology.com', name: 'النخيلى', nameEn: 'El Nekhely',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'uptodate.store',     name: 'أب تو ديت',    nameEn: 'UpToDate Store', type: 'local', t: 3, platform: 'auto' },
  { domain: 'hankerz.com.eg',     name: 'هانكرز',       nameEn: 'Hankerz',       type: 'local', t: 3, platform: 'auto' },
  { domain: 'smarttechnology-eg.com', name: 'سمارت تكنولوجى', nameEn: 'Smart Technology', type: 'local', t: 3, platform: 'auto' },
  /* Odoo storefront — its search lives at /ar/website/search, not on any of the
     Magento/Woo/OpenCart paths the auto sweep tries */
  { domain: 'ram-e-shop.com',     name: 'رام إلكترونيكس', nameEn: 'RAM Electronics', type: 'local', t: 3,
    platform: 'jsonld:/ar/website/search?search=' },
  { domain: 'store.fut-electronics.com', name: 'فيوتشر إلكترونيكس', nameEn: 'Future Electronics', type: 'local', t: 3, platform: 'shopify' },
  { domain: 'makerselectronics.com', name: 'ميكرز إلكترونيكس', nameEn: 'Makers Electronics', type: 'local', t: 3, platform: 'auto' },
  { domain: 'magicduino.com',     name: 'ماجيك دوينو',  nameEn: 'MagicDuino',    type: 'local', t: 3, platform: 'auto' },
  { domain: 'gamerzlounge.me',    name: 'جيمرز لاونج',  nameEn: 'Gamerz Lounge', type: 'local', t: 3, platform: 'auto' },
  { domain: 'sevencameras.com',   name: 'سفن كاميراز',  nameEn: 'Seven Cameras', type: 'local', t: 3, platform: 'auto' },
  { domain: 'shuttershopegypt.com', name: 'شتر شوب',    nameEn: 'Shutter Shop',  type: 'local', t: 3, platform: 'auto' },
  { domain: 'audiomisr.com',      name: 'أوديو مصر',    nameEn: 'Audio Misr',    type: 'local', t: 3, platform: 'auto' },
];
const storeName = (s, lang) => (lang === 'en' ? (s.nameEn || s.name) : s.name);
/* a query with no Arabic letters is an English/Latin query — stores that offer an
   English storefront get asked in English so titles come back in English too */
const isLatinQuery = q => !/[؀-ۿ]/.test(q);
const BRANDS = {
  kiriazi: ['كريازى','كريازي','kiriazi'], sharp: ['شارب','sharp'], tornado: ['تورنيدو','tornado'],
  fresh: ['فريش','fresh'], olympic: ['اوليمبك','أوليمبك','olympic'], coldair: ['كولدير','coldair'],
  toshiba: ['توشيبا','toshiba'], zanussi: ['زانوسى','زانوسي','zanussi'], beko: ['بيكو','beko'],
  lg: ['ال جى','lg'], samsung: ['سامسونج','samsung'], midea: ['ميديا','midea'],
  carrier: ['كاريير','carrier'], unionaire: ['يونيون اير','unionaire'], passap: ['باساب','passap'],
  philips: ['فيليبس','philips'], kenwood: ['كينوود','kenwood'], braun: ['براون','braun'],
  hisense: ['هايسنس','hisense'], haier: ['هاير','haier'], bosch: ['بوش','bosch'],
};
const SKIP_DOMAINS = /facebook|instagram|youtube|tiktok|twitter|x\.com|wikipedia|olx\.|dubizzle|aqarmap|linkedin|pinterest|google\.|bing\.|duckduckgo|yaoota|pricena|el-?dokan\.com$|blogspot|wordpress\.com$/i;

let REGISTRY = null;
async function loadRegistry() {
  if (REGISTRY) return REGISTRY;
  try { REGISTRY = JSON.parse(await readFile(REG_FILE, 'utf8')); }
  catch { REGISTRY = null; }
  if (!REGISTRY || REGISTRY.v !== SEED_V) {
    // seed upgrade: refresh the built-ins, keep discovered/manual stores
    const kept = (REGISTRY?.stores || []).filter(s => s.addedBy && !SEED.some(x => x.domain === s.domain));
    REGISTRY = { v: SEED_V, stores: [...SEED, ...kept] };
    await saveRegistry();
  }
  return REGISTRY;
}
async function saveRegistry() {
  try { await writeFile(REG_FILE, JSON.stringify(REGISTRY, null, 1)); } catch {}
}
let regSaveT = null;
function saveRegistrySoon() {
  clearTimeout(regSaveT);
  regSaveT = setTimeout(() => { if (REGISTRY) saveRegistry(); }, 2000);
}
/* circuit breaker: a store that failed 3+ times in a row rests for 6 hours —
   fragile shops cost nothing after they prove flaky, and auto-recover later */
const circuitOpen = s => (s.failN || 0) >= 3 && Date.now() - (s.lastFail || 0) < 6 * 3600e3;

/* ================= toolkit ================= */
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
/* headless tier: a small concurrency gate so we never open too many tabs */
const BTECH_SCRIPT = `(async()=>{
  const seen=new Set(), out=[];
  for(const a of document.querySelectorAll('a[href]')){
    const h=a.getAttribute('href')||'';
    if(!h.includes('/ar/p/')) continue;
    const name=a.textContent.replace(/\\s+/g,' ').trim();
    if(name.length<8) continue;
    const key=h.split('?')[0]; if(seen.has(key)) continue; seen.add(key);
    let card=a, hops=0;
    while(card&&hops<5){ if((card.textContent||'').includes('ج.م')) break; card=card.parentElement; hops++; }
    out.push({ name:name.slice(0,90), cardText:(card&&card.textContent||'').replace(/\\s+/g,' ').trim().slice(0,180), h:h.slice(0,120) });
    if(out.length>=12) break;
  }
  return out;
})()`;
/* in-page harvester for client-rendered storefronts: scroll (lazy-load), then
   collect product-link cards that contain a price token. Some SPA routers
   navigate on scroll and destroy the JS context — the no-scroll variant is the
   retry path for those. */
const mkRenderScript = scroll => `(async()=>{
  ${scroll ? `for(let i=0;i<6;i++){ window.scrollBy(0, document.documentElement.scrollHeight); await new Promise(r=>setTimeout(r,700)); }` : ''}
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
const RENDER_SCRIPT = mkRenderScript(true);
const RENDER_SCRIPT_STILL = mkRenderScript(false);
let hlActive = 0; const hlQueue = [];
function hl(url, opts) {
  return new Promise((resolve, reject) => {
    const job = () => {
      hlActive++;
      renderPage(url, opts).then(resolve, reject).finally(() => {
        hlActive--; const n = hlQueue.shift(); if (n) n();
      });
    };
    if (hlActive < 3) job(); else hlQueue.push(job);
  });
}

async function fetchPage(url, accept = 'text/html', timeoutMs = 9000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: accept + ',*/*;q=0.8', 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.7' },
    redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}
function absUrl(u, domain) {
  try { return new URL(u, 'https://' + domain).href; } catch { return 'https://' + domain; }
}

/* JSON-LD: schema.org Product / ItemList on any page */
function jsonLdProducts(html, domain) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    // @type may be a plain string, an array (["Product","Thing"]), or a
    // schema.org URL — match the final path segment of each candidate
    const isProduct = [].concat(node['@type'] || [])
      .some(x => String(x).toLowerCase().replace(/^.*\//, '') === 'product');
    if (isProduct) {
      const offers = [].concat(node.offers || []);
      const price = parsePrice(offers[0]?.price ?? offers[0]?.lowPrice ?? node.price);
      const avail = String(offers[0]?.availability || '');
      // The canonical URL is not always at the Product level — noon, for one,
      // leaves node.url undefined and carries it on the Offer. Without this
      // fallback absUrl() yields the bare domain, isProductOffer correctly
      // rejects it as navigation, and a real product is silently dropped —
      // after which the caller's crude price scrape can return a junk number.
      const href = node.url || node['@id'] || offers[0]?.url || '';
      // Carry the currency the page states. Discovery reaches .com domains, so
      // a page can legitimately price in USD or AED; without this the number
      // reached the response and was printed as جنيه. Left undefined when the
      // page says nothing, which pricedInEgp() reads as "unstated", not "foreign".
      const currency = offers[0]?.priceCurrency ?? node.priceCurrency ?? undefined;
      // skip listings the store itself marks unavailable — dead prices poison the ranking
      if (price && !/OutOfStock|SoldOut|Discontinued/i.test(avail))
        out.push({ title: decodeEntities(node.name), price, url: absUrl(href, domain),
                   currency: currency == null ? undefined : String(currency).trim() });
    }
    if (node.item) walk(node.item);
    if (node.mainEntity) walk(node.mainEntity);          // CollectionPage → ItemList (Jumia)
    if (node.itemListElement) walk(node.itemListElement);
    if (node['@graph']) walk(node['@graph']);
  };
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim())); } catch {} }
  return out.filter(isProductOffer);
}

/* generic harvest: for each price token on the page, backtrack to the nearest
   product link — rescues classic-theme stores with no JSON-LD (e.g. Tradeline) */
function htmlHarvest(html, domain) {
  const out = [];
  const priceRe = /(?:EGP|LE|E£|ج\.?\s?م|جنيه)\s*[:\s]?([\d][\d.,\s]{2,12})|([\d][\d.,\s]{2,12})\s*(?:EGP|LE|E£|ج\.?\s?م|جنيه)/gi;
  let m;
  while ((m = priceRe.exec(html)) && out.length < 12) {
    const price = parsePrice(normDigits(m[1] || m[2]));
    if (!price) continue;
    const back = html.slice(Math.max(0, m.index - 2200), m.index);
    const links = [...back.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (let i = links.length - 1; i >= 0; i--) {
      const title = decodeEntities(links[i][2]);
      const href = links[i][1];
      const external = /^https?:\/\//i.test(href) && !href.includes(domain);
      if (title.length > 12 && !external) {
        out.push({ title: title.slice(0, 140), price, url: absUrl(href, domain) });
        break;
      }
    }
  }
  // second pass — card storefronts (ElGhazawy-style): the whole card is one
  // huge <a> whose SLUG carries the title, price sits ahead inside the card,
  // and the clean title hides in an image alt. The backtrack pass above can't
  // see these, so walk product links forward instead.
  if (!out.length) {
    const cardSeen = new Set();
    for (const m of html.matchAll(/href="([^"]*\/products?\/[^"]{8,220})"/gi)) {
      if (out.length >= 12) break;
      const url = absUrl(decodeEntities(m[1]).trim(), domain);
      if (cardSeen.has(url)) continue; cardSeen.add(url);
      const seg = html.slice(m.index, m.index + 3500);
      const price = extractPrices(seg)[0];
      if (!price) continue;
      const alt = seg.match(/alt="([^"]{12,160})"/);
      const slug = decodeURIComponent((m[1].split('/').pop() || '').split('?')[0])
        .replace(/\+/g, ' ').replace(/-/g, ' ').trim();
      const title = decodeEntities(alt ? alt[1] : slug);
      if (title.length > 12) out.push({ title: title.slice(0, 140), price, url });
    }
  }
  // dedupe by url
  const seen = new Set();
  return out.filter(isProductOffer).filter(o => !seen.has(o.url) && seen.add(o.url));
}

/* ================= store adapters ================= */
/* Amazon renders sponsored cards with the ad label baked into the SAME
   aria-label/alt attribute that carries the product title — "الإعلان المدعوم -
   غسالة تحميل أمامي…" / "Sponsored Ad - Samsung Washing Machine…". Left in, it
   is shown to shoppers as if it were the product's name, and — because it
   becomes the leading, hard-required product-type token — a shopper who pastes
   such a title back into the comparer matches nothing at all. */
function stripSponsoredLabel(title) {
  return String(title)
    .replace(/^\s*(?:ال[أإا]علان\s+المدعوم|[أإا]علان\s+مدعوم|sponsored(?:\s+ad)?)\s*[-–—:]+\s*/iu, '')
    .trim();
}
const ADAPTERS = {
  /* Magento 2 public GraphQL — no HTML parsing at all (2B, Raneen, ElAraby…) */
  async gql(store, q) {
    const safeQ = q.replace(/["\\]/g, ' ');
    const query = `{products(search:"${safeQ}",pageSize:10){items{name url_key url_suffix price_range{minimum_price{final_price{value}}}}}}`;
    const body = JSON.stringify({ query });
    // Latin query → ask the store's English storefront first so titles come back
    // in English; Arabic query → default (Arabic) storefront first.
    const views = isLatinQuery(q)
      ? [{ Store: 'en' }, {}, { Store: 'default' }]
      : [{}, { Store: 'default' }, { Store: 'ar' }];
    for (const headers of views) {
      try {
        const r = await fetch(`https://${store.gqlHost || 'www.' + store.domain}/graphql`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': UA, ...headers },
          body, signal: AbortSignal.timeout(10000),
        });
        const j = await r.json();
        const items = (j?.data?.products?.items || []).map(i => ({
          title: decodeEntities(i.name),
          price: parsePrice(i.price_range?.minimum_price?.final_price?.value),
          url: absUrl('/' + (i.url_key || '') + (i.url_suffix || ''), store.domain),
        })).filter(x => x.price);
        if (items.length) return items;
      } catch {}
    }
    return [];
  },
  async local(store, q) {
    const cat = JSON.parse(await readFile(path.join(ROOT, 'data', 'products.json'), 'utf8'));
    const toks = queryTokens(q);
    return (cat.products || [])
      .filter(p => {
        const t = normAr(p.title + ' ' + (p.description || ''));
        return toks.every(x => /^\d+$/.test(x) ? t.includes(x) : tokenInTitle(t, x));
      })
      .filter(p => typeof p.price === 'number')
      .map(p => ({ title: decodeEntities(p.title), price: p.price, url: p.url }));
  },

  async magento(store, q) {
    const html = await fetchPage(`https://www.${store.domain}/catalogsearch/result/?q=${encodeURIComponent(q)}`)
      .catch(() => fetchPage(`https://${store.domain}/catalogsearch/result/?q=${encodeURIComponent(q)}`));
    let items = jsonLdProducts(html, store.domain);
    if (!items.length) items = htmlHarvest(html, store.domain);
    return items;
  },

  async woo(store, q) {
    for (const ep of ['/wp-json/wc/store/v1/products', '/wp-json/wc/store/products']) {
      try {
        const j = JSON.parse(await fetchPage(`https://${store.domain}${ep}?search=${encodeURIComponent(q)}&per_page=12`, 'application/json'));
        if (Array.isArray(j) && j.length) return j.map(p => {
          const minor = +(p.prices?.currency_minor_unit ?? 2);
          const price = parsePrice((+p.prices?.price || 0) / 10 ** minor);
          return { title: decodeEntities(p.name), price, url: p.permalink };
        }).filter(r => r.price);
      } catch {}
    }
    const html = await fetchPage(`https://${store.domain}/?s=${encodeURIComponent(q)}&post_type=product`);
    return jsonLdProducts(html, store.domain);
  },

  async shopify(store, q) {
    const j = JSON.parse(await fetchPage(
      `https://${store.domain}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`,
      'application/json'));
    return (j.resources?.results?.products || []).map(p => ({
      title: decodeEntities(p.title), price: parsePrice(p.price), url: absUrl(p.url, store.domain),
    })).filter(r => r.price);
  },

  async jumia(store, q) {
    const html = await fetchPage(`https://www.jumia.com.eg/${isLatinQuery(q) ? '' : 'ar/'}catalog/?q=${encodeURIComponent(q)}`);
    let items = jsonLdProducts(html, store.domain);
    if (!items.length) {
      const re = /<a[^>]+href="(\/[^"]+\.html)"[^>]*class="core"[\s\S]{0,900}?<h3[^>]*>([^<]+)<[\s\S]{0,300}?<div[^>]*class="[^"]*prc[^"]*"[^>]*>([^<]+)</gi;
      let m; while ((m = re.exec(html)) && items.length < 12) {
        const price = extractPrices(m[3])[0] || parsePrice(m[3]);
        if (price) items.push({ title: decodeEntities(m[2]), price, url: absUrl(m[1], store.domain) });
      }
    }
    return items;
  },

  /* ---- headless-Chrome adapters (real browser; store's own JS runs) ---- */
  async amazon(store, q) {
    const lng = isLatinQuery(q) ? 'en_AE' : 'ar_AE';
    const { html } = await hl(`https://www.amazon.eg/s?k=${encodeURIComponent(q)}&language=${lng}`, { waitMs: 2600 });
    const items = [];
    // 2026 card layout: brand sits alone in an a-size-mini <h2>, the full title
    // is the NEXT <h2>'s aria-label (or the s-image alt), and the price can be
    // several KB away — so parse per data-asin card, not with one flat regex.
    const seen = new Set();
    for (const c of html.split(/data-asin="/).slice(1)) {
      if (items.length >= 12) break;
      const asin = (c.match(/^([A-Z0-9]{10})"/) || [])[1];
      if (!asin || seen.has(asin)) continue;
      const brand = decodeEntities((c.match(/<h2 class="a-size-mini[^>]*>\s*<span[^>]*>([\s\S]{0,80}?)<\/span>/) || [])[1] || '');
      let title = decodeEntities((c.match(/<h2[^>]*\saria-label="([^"]{10,400})"/) || [])[1] ||
        (c.match(/class="s-image"[^>]*\salt="([^"]{10,400})"/) || [])[1] || '');
      if (!title) { const h2 = c.match(/<h2[^>]*>([\s\S]{0,400}?)<\/h2>/); title = h2 ? decodeEntities(h2[1]) : ''; }
      const price = parsePrice(normDigits((c.match(/a-price-whole"[^>]*>([\d.,٠-٩]+)/) || [])[1] || ''));
      if (!price || title.length < 6) continue;
      title = stripSponsoredLabel(title);
      if (brand && !title.toLowerCase().startsWith(brand.toLowerCase())) title = brand + ' ' + title;
      seen.add(asin);
      items.push({ title: title.slice(0, 140), price, url: `https://www.amazon.eg/dp/${asin}?language=${lng}` });
    }
    return items;
  },

  async btech(store, q) {
    const { value } = await hl(`https://btech.com/ar/s?q=${encodeURIComponent(q)}`, { waitMs: 6000, script: BTECH_SCRIPT });
    return (value || []).map(x => {
      const pm = normDigits(x.cardText).replace(/,/g, '').match(/([\d][\d.]{2,9})\s*ج\.?\s?م/);
      if (!pm) return null;
      const price = Math.round(parseFloat(pm[1]));
      return price >= 500 ? { title: decodeEntities(x.name), price, url: 'https://btech.com' + String(x.h).split('?')[0] } : null;
    }).filter(Boolean);
  },

  /* generic SPA storefront (ElGhazawy, Homzmart, …): the search grid only
     exists after client-side JS runs, so render in headless Chrome, scroll to
     trigger lazy-loading, then walk the DOM for product-link cards that carry
     a price. Works on any client-rendered store via store.renderTpl. */
  async render(store, q) {
    const tpl = store.renderTpl || `https://${store.domain}/search?q={q}`;
    const url = tpl.replace('{q}', encodeURIComponent(q));
    let value;
    try { ({ value } = await hl(url, { waitMs: 6000, script: RENDER_SCRIPT })); }
    catch { ({ value } = await hl(url, { waitMs: 12000, script: RENDER_SCRIPT_STILL })); }
    return (value || []).map(v => {
      const price = extractPrices(v.t)[0] || 0;
      let title = decodeEntities(v.name || '').trim();
      if (title.length < 12)
        title = decodeEntities(v.t).replace(/[\d.,]+\s*(EGP|LE|جنيه|ج\.?\s?م)[\s\S]*$/i, '').trim();
      title = title.replace(/\s[\d.,]{3,12}\s*$/, '').replace(/^\d{2,6}\s*/, '');
      return price && title.length > 10 ? { title: title.slice(0, 140), price, url: v.h } : null;
    }).filter(Boolean);
  },

  async carrefour(store, q) {
    const { html } = await hl(`https://www.carrefouregypt.com/mafegy/ar/v4/search?keyword=${encodeURIComponent(q)}`, { waitMs: 5000 });
    let items = jsonLdProducts(html, store.domain);
    if (!items.length) items = htmlHarvest(html, store.domain);
    return items;
  },

  async noon(store, q) {
    // Noon's search page lists products WITHOUT prices (ItemList of name+url);
    // fetch the top product pages — each carries Product JSON-LD with the price.
    const html = await fetchPage(`https://www.noon.com/egypt-${isLatinQuery(q) ? 'en' : 'ar'}/search/?q=${encodeURIComponent(q)}`);
    let items = jsonLdProducts(html, store.domain);
    if (items.length) return items;
    const list = [];
    const re = /<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
    let m; while ((m = re.exec(html))) {
      try { const j = JSON.parse(m[1]);
        if (j['@type'] === 'ItemList') for (const li of j.itemListElement || [])
          if (li.url && li.name) list.push({ name: li.name, url: li.url });
      } catch {}
    }
    const wanted = list.filter(p => isRelevant(p.name, q));
    const pages = await Promise.allSettled(wanted.slice(0, 3).map(p => fetchPage(p.url)));
    list.length = 0; list.push(...wanted);
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].status !== 'fulfilled') continue;
      const prods = jsonLdProducts(pages[i].value, store.domain);
      if (prods[0]?.price) items.push({ title: decodeEntities(list[i].name), price: prods[0].price, url: list[i].url });
      else { const ps = extractPrices(pages[i].value); if (ps[0]) items.push({ title: decodeEntities(list[i].name), price: ps[0], url: list[i].url }); }
    }
    return items;
  },

  /* unknown platform: platform APIs first (cheap), then JSON-LD/harvest over
     the common search paths of Magento / Woo / OpenCart / Shopify / Salla-style
     storefronts. Probes run in small parallel chunks; the first template that
     answers is LEARNED (persisted on the store) so every later search of this
     store is a single request. */
  async auto(store, q) {
    // cheap structured probes first
    try { const items = await ADAPTERS.shopify(store, q); if (items.length) { store.platform = 'shopify'; saveRegistrySoon(); return items; } } catch {}
    try { const items = await ADAPTERS.woo(store, q); if (items.length) { store.platform = 'woo'; saveRegistrySoon(); return items; } } catch {}
    const TPLS = [`/search?q=`, `/catalogsearch/result/?q=`, `/?s=`, `/index.php?route=product/search&search=`,
      `/en/catalogsearch/result/?q=`, `/search/?q=`, `/ar/search?keyword=`, `/shop/?s=`, `/products?q=`,
      `/ar/website/search?search=`];   // Odoo storefronts (RAM Electronics…)
    const tryTpl = async tpl => {
      const html = await fetchPage(`https://www.${store.domain}${tpl}${encodeURIComponent(q)}`, 'text/html', 5000)
        .catch(() => fetchPage(`https://${store.domain}${tpl}${encodeURIComponent(q)}`, 'text/html', 5000));
      let items = jsonLdProducts(html, store.domain);
      if (!items.length) items = htmlHarvest(html, store.domain);
      // A template is LEARNED and persisted forever, so it must prove it answers
      // the QUERY — not merely that the page contained something parseable.
      // Without this the sweep pins WordPress `/?s=` blog search, which returns
      // the same unrelated grid for every search (a "سامسونج" query answered
      // with a Motorola), and that mistake sticks to the store permanently.
      return items.some(it => isRelevant(it.title, q)) ? { tpl, items } : null;
    };
    for (let i = 0; i < TPLS.length; i += 3) {
      const hits = await Promise.allSettled(TPLS.slice(i, i + 3).map(tryTpl));
      for (const h of hits) if (h.status === 'fulfilled' && h.value) {
        store.platform = 'jsonld:' + h.value.tpl; saveRegistrySoon();
        return h.value.items;
      }
    }
    return [];
  },
};
/* learned-template fast path: one request, sweep only as fallback */
ADAPTERS['jsonld'] = async function (store, q) {
  const tpl = String(store.platform || '').slice('jsonld:'.length);
  if (tpl) {
    try {
      const html = await fetchPage(`https://www.${store.domain}${tpl}${encodeURIComponent(q)}`, 'text/html', 7000)
        .catch(() => fetchPage(`https://${store.domain}${tpl}${encodeURIComponent(q)}`, 'text/html', 7000));
      let items = jsonLdProducts(html, store.domain);
      if (!items.length) items = htmlHarvest(html, store.domain);
      if (items.length) return items;
    } catch {}
  }
  return ADAPTERS.auto(store, q);
};

/* ---- relevance: normalized BILINGUAL token match so a fridge query can't be
   answered with fridge BOXES or AirPods just because they're cheap.
   Queries and titles freely mix Arabic and English (stores title in Arabic,
   shoppers search in either) — equivalence groups bridge the two. ---- */
const STOP = new Set(['سعر', 'اسعار', 'شراء', 'افضل', 'جديد', 'اصلى', 'اصلي',
  'price', 'prices', 'buy', 'best', 'new', 'cheap', 'cheapest', 'offer', 'offers', 'online', 'egypt',
  // marketing filler in long copy-pasted titles — raises the effective signal
  // in the 60% overlap check without weakening size/unit matching
  'with', 'compatible', 'for', 'and', 'plus', 'include', 'included', 'includes',
  'pack', 'set', 'pcs', 'ports', 'port', 'x', 'مع', 'متوافق', 'و']);
// spare parts / accessories — never the "cheapest <appliance>" the user meant
const ACCESSORY = ['طقم', 'عيون', 'عين', 'غطاء', 'غطا', 'رف', 'رفوف', 'حامل', 'حوامل', 'فلتر', 'شمعة',
  'شمعه', 'جلبة', 'جلبه', 'مفصلة', 'مفصله', 'درج ', 'ريموت', 'كفر', 'حساس', 'وصلة', 'وصله', 'خرطوم',
  'سلك', 'كابل', 'مروحة تبريد', 'قطع غيار', 'اكسسوار', 'ستاند', 'رفرف', 'صينية', 'صينيه', 'شبكة', 'شبكه',
  'جهاز تحكم', 'تحكم عن بعد',
  'جراب', 'حافظه', 'واقي', 'واقى',
  'remote', 'cover', 'stand', 'holder', 'bracket', 'filter', 'shelf', 'cable', 'wire', 'hose',
  'spare', 'parts', 'accessory', 'accessories', 'tray', 'knob', 'hinge', 'gasket', 'sensor',
  // protective goods sold FOR a device — a silicone case is not the power bank
  'case', 'cases', 'pouch', 'sleeve', 'protector'];
function normAr(s) {
  return normDigits(String(s).toLowerCase())
    .replace(/[ىي]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/[أإآ]/g, 'ا')
    .replace(/[ً-ْـ]/g, '');
}
function queryTokens(q) {
  // single characters are noise EXCEPT single digits — "7 كيلو" must keep the 7
  return normAr(q).split(/[^\p{L}\p{N}]+/u).filter(t => {
    if (!(t.length >= 2 || /^\d$/.test(t))) return false;
    if (STOP.has(t)) return false;
    // a digit run fused (no separator) to a stop word — "3ports", "1x" — is
    // still marketing filler, not a spec number; drop the whole token
    const bare = t.replace(/^\d+/, '');
    if (bare !== t && STOP.has(bare)) return false;
    return true;
  });
}
/* EN↔AR equivalence groups: product types, units, features. A query token
   matches a title if ANY variant of its group appears — this is what lets
   "SHARP TV 75 Inch" find «شارب تليفزيون ٧٥ بوصة» and vice versa. */
const SYN_RAW = [
  ['تلفزيون', 'تليفزيون', 'تلفاز', 'شاشة', 'tv', 'television', 'screen'],
  ['ثلاجة', 'تلاجة', 'refrigerator', 'fridge'],
  ['فريزر', 'freezer'],
  ['غسالة', 'washing', 'washer'],
  ['غسالة اطباق', 'dishwasher'],
  ['مجفف', 'دراير', 'dryer'],
  ['بوتاجاز', 'بوتجاز', 'cooker', 'stove'],
  ['فرن', 'oven'],
  ['ميكروويف', 'مايكروويف', 'ميكروويڤ', 'microwave'],
  ['تكييف', 'مكيف', 'conditioner', 'ac'],
  ['سخان', 'heater'],
  ['مبرد', 'dispenser'],
  ['مكنسة', 'vacuum', 'hoover'],
  ['قلاية', 'مقلاة', 'fryer', 'airfryer'],
  ['خلاط', 'blender', 'mixer'],
  ['عجان', 'kneader'],
  ['مكواة', 'iron'],
  ['غلاية', 'kettle'],
  ['شفاط', 'hood', 'extractor'],
  ['توستر', 'محمصة', 'toaster'],
  ['شواية', 'grill', 'griller'],
  ['مروحة', 'fan'],
  ['بوصة', 'inch', 'inches'],
  ['سم', 'cm'],
  ['قدم', 'feet', 'foot', 'ft'],
  ['لتر', 'liter', 'litre', 'liters', 'litres'],
  ['كيلو', 'كجم', 'kg', 'kilo'],
  ['حصان', 'hp', 'horsepower'],
  ['سمارت', 'ذكي', 'ذكية', 'smart'],
  ['نوفروست', 'نو فروست', 'defrost', 'nofrost'],
  ['ديجيتال', 'digital'],
  ['انفرتر', 'inverter'],
  ['اسود', 'black'],
  ['ابيض', 'white'],
  ['سيلفر', 'فضي', 'silver'],
  ['ستانلس', 'استانلس', 'stainless'],
  ['ريسيفر', 'رسيفر', 'receiver'],
  ['شاحن', 'charger'],
  ['حائط', 'wall'],
  ['زولو', 'zolo'],
  ['انكر', 'anker'],
];
const SYN = [...SYN_RAW, ...Object.values(BRANDS)].map(g => g.map(normAr));
const SYN_BY_TOKEN = new Map();
for (const g of SYN) for (const v of g) if (!v.includes(' ')) SYN_BY_TOKEN.set(v, g);
const BRAND_TOKENS = new Set(Object.values(BRANDS).flat().map(normAr));
/* Latin variants match on a word start (so "ac" can't hide inside "black",
   while "fridge" still matches "fridges" and "kg" matches "7KG" — a digit
   counts as a boundary); Arabic keeps plain substring because of the ال
   prefix («التلفزيون» must match «تلفزيون»). */
function variantInTitle(t, v) {
  if (/^[a-z0-9]+$/.test(v)) return new RegExp('(^|[^a-z])' + v).test(t);
  return t.includes(v);
}
/* spec-critical units: when the query names one, a listing that lacks it is a
   different product class (a 7-KILO query must never return a dishwasher) */
const UNIT_TOKENS = new Set(['كيلو', 'كجم', 'kg', 'kilo', 'بوصة', 'inch', 'inches', 'قدم', 'feet',
  'foot', 'ft', 'لتر', 'liter', 'litre', 'liters', 'litres', 'حصان', 'hp', 'horsepower', 'سم', 'cm']
  .map(x => normAr(x)));
/* Words that carry no identity and so must not consume one of the two slots in
   the leading-words fallback: structural filler, and the marketing adjectives
   catalog.mjs already treats as generic. Kept deliberately small — a colour or
   a series name CAN be identity-bearing, so nothing is dropped on suspicion. */
const LADDER_NOISE = new Set(['no', 'the', 'and', 'with', 'for', 'of', 'in', 'x',
  'smart', 'full', 'hd', 'fhd', 'uhd', 'led', 'lcd', 'new', 'pro', 'plus', 'max', 'series',
  'من', 'فى', 'مع', 'و']
  .map(x => normAr(x)));

/* a digit-only query token is mandatory (must show up as a standalone number
   in the title) only when it is a SIZE/CAPACITY — i.e. in the original query
   text it is immediately followed by a unit word (spaces/hyphens allowed in
   between). "75 بوصة" gates on 75; "1 x USB-A" is an incidental count inside a
   feature list and must not gate every listing out. */
function numberHasUnit(qn, n) {
  for (const u of UNIT_TOKENS) {
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^0-9])' + n + '[\\s-]*' + esc).test(qn)) return true;
  }
  return false;
}
/* full-word check for the accessory blocklist — "stand" must not fire on
   "standard", while Arabic terms keep substring semantics */
function accessoryIn(text) {
  return a => /^[a-z]+$/.test(a)
    ? new RegExp('(^|[^a-z0-9])' + a + '([^a-z0-9]|$)').test(text)
    : text.includes(normAr(a));
}
/* the accessory blocklist must only inspect the LEADING segment of a title —
   the part that states what the product IS. Real titles put the product
   type first and push feature lists (which routinely mention "filter",
   "cover", "tray", "sensor"...) after the first comma/dash/paren; an actual
   accessory listing ("Water Filter for TOSHIBA Refrigerator...") has the
   accessory word itself in that leading segment, so it's still caught.
   Search for the boundary only within the first ~50 chars — real product-type
   declarations are short, and capping the window stops a delimiter that's
   buried deep in a long title (e.g. inside a model number well past the
   product name) from accidentally widening the segment we inspect; if no
   boundary shows up in that window, the 50-char window itself is the segment. */
/* the query's identity clause — everything before its first comma. Distinct
   from leadingSegment (which caps at 50 chars and also splits on dash/paren,
   tuned for spotting an accessory word in a TITLE): a model number like
   "GR-RT468WE-PMN(49)-PRO" legitimately contains dashes/parens and must stay
   whole here, only an actual comma starts the feature-bullet tail. */
function coreClause(q) {
  const i = q.search(/[,،]/);
  return i < 0 ? q : q.slice(0, i);
}
function leadingSegment(t) {
  const LEAD_WINDOW = 50;
  const head = t.slice(0, LEAD_WINDOW);
  const m = head.match(/[,،\-–—|(]/);
  return m ? head.slice(0, m.index) : head;
}
function tokenInTitle(t, tok) {
  const g = SYN_BY_TOKEN.get(tok);
  return g ? g.some(v => variantInTitle(t, v)) : variantInTitle(t, tok);
}
/* unit-string → engine/units.mjs canonical key, for the optional AI
   size_value/size_unit reinforcement in isRelevant() below (additive only —
   it can only ADD a disqualification, never weaken the extractUnits rule) */
const SIZE_UNIT_ALIAS = {
  w: 'watt', watt: 'watt', watts: 'watt',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  inch: 'inch', inches: 'inch', in: 'inch',
  liter: 'liter', litre: 'liter', liters: 'liter', litres: 'liter', l: 'liter', ltr: 'liter',
  feet: 'feet', foot: 'feet', ft: 'feet',
  hp: 'hp', horsepower: 'hp',
  cm: 'cm', gb: 'gb', tb: 'tb', rpm: 'rpm',
};
/* isRelevant(title, q, attrs?) — attrs is the optional AI-distilled query
   understanding from understandQuery() (undefined/null/malformed whenever the
   AI layer is off, failed, or returned garbage — behaviour is then BYTE-
   IDENTICAL to the rule-based path below, unconditionally). When attrs is a
   usable object it corrects two failure modes raw-string matching cannot:
   (1) a brand named only as a COMPATIBILITY mention ("...for iPhone,
   Samsung and More...") is no longer read as the product's own brand —
   attrs.brand becomes the only authoritative brand; (2) the 60% word-overlap
   check is judged against attrs' short canonical query_en/query_ar instead
   of the raw, marketing-copy-laden pasted title. */
/* Does this title name a model number of its own? Used by isRelevant's
   stated-model gate to tell a CONTRADICTION ("this is the -DMN trim") apart
   from SILENCE ("no code printed"), which must not disqualify. A model-shaped
   token mixes letters and digits and is not simply a measurement — 1400rpm,
   850w and 8.5kg are specs, not identities. */
const MEASURE_RE = /^\d+(?:\.\d+)?(?:gb|tb|mb|kg|g|ml|l|ltr|liter|litre|liters|mm|cm|m|hz|khz|ghz|w|kw|watt|watts|v|volt|hp|rpm|bar|k|inch|inches|in|ft|feet|ah|mah|cc|btu)$/;
function titleStatesModel(title) {
  for (const raw of normAr(title).split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || !/\d/.test(raw) || !/[a-z]/.test(raw)) continue;
    if (MEASURE_RE.test(raw)) continue;
    return true;
  }
  return false;
}
function isRelevant(title, q, attrs) {
  const toks = queryTokens(q);
  if (!toks.length) return true;
  const t = normAr(title);
  // reject spare parts / accessories unless the query itself asked for one —
  // only the leading product-type segment is checked (see leadingSegment)
  const qn = normAr(q);
  if (!ACCESSORY.some(accessoryIn(qn)) && ACCESSORY.some(accessoryIn(leadingSegment(t)))) return false;
  // sizes/capacities are non-negotiable: a 75-inch query must not return a
  // 32-inch TV, a 7-kilo query must not return a 9-kilo washer — every
  // UNIT-BEARING number in the query must appear as a standalone number in
  // the title (digit boundaries, so 75 matches "C75F" and "75-inch" but never
  // "175" or "750"). A bare digit with no unit attached in the query (e.g. the
  // "1" in "1 x USB-A") is incidental and is NOT required — see numberHasUnit.
  for (const n of toks) if (/^\d+$/.test(n) && numberHasUnit(qn, n) && !new RegExp('(^|\\D)' + n + '(\\D|$)').test(t)) return false;
  // a stated unit VALUE must match even when the number and unit are fused
  // with no separator ("140W") — queryTokens turns that into the single WORD
  // token "140w", so it never reaches the digit-token rule above and never
  // hits UNIT_TOKENS (which only knows the bare unit word "watt"). extractUnits
  // (engine/units.mjs) parses "140W", "20 W", "75 بوصة" etc. uniformly, so use
  // it directly on the raw title/query text: for every unit the QUERY states a
  // value for, if the TITLE also states a value for that unit and it differs,
  // this is a different product (a 20W charger is not a 140W charger) — the
  // same contradiction-disqualifies/silence-is-unknown asymmetry
  // engine/matcher.mjs's sameProduct() already uses for the catalog path.
  // This rule is UNCHANGED by attrs — attrs.size_value/size_unit below may
  // only ADD a reinforcing check, never weaken this one.
  const qUnitValues = extractUnits(q);
  const tUnitValues = extractUnits(title);
  for (const [unit, qv] of Object.entries(qUnitValues))
    if (tUnitValues[unit] !== undefined && tUnitValues[unit] !== qv) return false;
  const ai = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : null;
  if (ai && typeof ai.size_value === 'number' && typeof ai.size_unit === 'string') {
    const key = SIZE_UNIT_ALIAS[ai.size_unit.trim().toLowerCase()];
    if (key && tUnitValues[key] !== undefined && tUnitValues[key] !== ai.size_value) return false;
  }
  /* ---- stated-model gate ----
     A pasted marketplace title usually names an exact model (FMW-25KC-SW,
     GR-RT468WE-PMN(49)-PRO, Q6F). Stores answer with the NEIGHBOURING model
     from the same family — FMW-25MC-SW is the mechanical sibling of the
     digital FMW-25KC-SW, -DMN is a different trim of -PMN — and those word
     overlaps sail past every rule below, so a different product at a
     different price was being returned as "the" match. Worse, admitting one
     made searchStore's attempt ladder stop at attempt 1, so the bare
     model-number attempt (which does find the exact unit) never ran.

     Same asymmetry the unit rules above use: a CONTRADICTION disqualifies,
     SILENCE does not. If the title states no model of its own it stays a
     candidate — most Egyptian listings never print one.

     Matching is done on the squashed strings, exactly as offerFlags() does,
     so "AY-XP18UHE" == "AYXP18UHE" and a model embedded in a longer store SKU
     ("QA55Q6F" for "Q6F") still counts as the same unit. */
  const qModel = (ai && ai.model_number ? String(ai.model_number) : null) || modelToken(q);
  const squashModel = s => normAr(s).replace(/[^a-z0-9]/g, '');
  const wantModel = qModel ? squashModel(qModel) : '';
  if (wantModel.length >= 3 && /\d/.test(wantModel) && /[a-z]/.test(wantModel) &&
      !squashModel(title).includes(wantModel) && titleStatesModel(title)) return false;
  /* An exact model hit IS the identity match. The 60% word-overlap below
     cannot bridge scripts — an Arabic pasted title against a store's English
     listing of the very same unit shares almost no tokens — so without this
     the genuine row was dropped whenever the AI layer (which supplies a
     cross-language canonical string) timed out. A printed model number is the
     strongest identity signal available, and it is what offerFlags() already
     trusts to decide what may be crowned.

     Acceptance is deliberately stricter than the rejection above (5 chars, not
     3): acting on a CONTRADICTION is safe, whereas a short code could appear
     inside an unrelated string by chance. The hard disqualifiers — accessory,
     unit contradiction — have already run and still win. */
  if (wantModel.length >= 5 && /\d/.test(wantModel) && /[a-z]/.test(wantModel) &&
      squashModel(title).includes(wantModel) &&
      // "Remote Control FOR <model>" carries the model but is not the product.
      // The accessory rule at the top of this function stands down when the
      // QUERY also names the accessory word — and a pasted marketplace title
      // routinely lists "جهاز تحكم عن بعد" among its features — so this
      // shortcut has to re-check the title's leading segment on its own.
      !ACCESSORY.some(accessoryIn(leadingSegment(t)))) return true;
  const word = [...new Set(toks.filter(x => !/^\d+$/.test(x)))];
  if (!word.length) return true;
  // spec-critical unit words are non-negotiable too (كيلو/بوصة/لتر/قدم/حصان…)
  for (const x of word) if (UNIT_TOKENS.has(x) && !tokenInTitle(t, x)) return false;
  // the first non-brand token is the product type — it is non-negotiable
  // (in any language); known brand tokens are non-negotiable too; then ≥60%.
  const lead = word.find(x => !BRAND_TOKENS.has(x));
  if (lead && !tokenInTitle(t, lead)) return false;
  // brand: WITHOUT a usable attrs.brand, any brand named ANYWHERE in the
  // query (today's rule, unchanged) is required in the title — this is what
  // misreads a COMPATIBILITY mention ("for iPhone, Samsung and More") as the
  // product's own brand. WITH a usable attrs.brand, that is corrected:
  // attrs.brand is the ONLY brand enforced, so a compatibility-only brand
  // elsewhere in the query text is no longer required in the title.
  if (ai && typeof ai.brand === 'string' && ai.brand.trim()) {
    const req = normAr(ai.brand.trim());
    // Absence can only disqualify when absence is KNOWABLE. tokenInTitle
    // bridges EN↔AR only for brands carried in BRANDS/SYN_RAW; for anything
    // outside that hand-maintained table the AI answers "Tefal" while the
    // listing says «تيفال», the literal match fails, and a byte-identical row
    // gets dropped. So an untabulated brand is treated as UNKNOWN rather than
    // absent, and the rules below decide — the same silence-is-not-a-
    // contradiction asymmetry used for units and model numbers. attrs.brand
    // stays the only brand enforced, so the compatibility-mention fix holds.
    const verifiable = SYN_BY_TOKEN.has(req);
    if (req && verifiable && !tokenInTitle(t, req) && !t.includes(req)) return false;
  } else {
    for (const names of Object.values(BRANDS))
      if (names.some(n => qn.includes(normAr(n))) && !names.some(n => t.includes(normAr(n)))) return false;
  }
  // long copy-pasted queries pack many independent comma-separated feature
  // bullets (GaN, 3 Ports, Compatible with iPhone…) that vary wildly between
  // listings of the SAME product — the leading clause (before the first
  // comma) is the product's actual identity declaration and anchors the 60%
  // threshold; a match anywhere in the query, including the feature-list
  // tail, still counts toward the numerator, so a shorter but genuine
  // listing isn't punished for simply not restating every bullet this
  // particular query happened to list. No-op for single-clause queries.
  // WITH a usable attrs.query_en/query_ar, the 60% overlap is judged against
  // THAT short canonical string instead — the raw pasted title's marketing
  // copy (colour prose, warranty text, compatibility lists) never dilutes
  // the ratio. Both languages the AI returned are tried; passing against
  // EITHER is enough, since a listing may be titled in either script
  // regardless of which script the shopper's pasted query happened to use.
  const distilled = [];
  if (ai) {
    if (typeof ai.query_en === 'string' && ai.query_en.trim().length > 3) distilled.push(ai.query_en.trim());
    if (typeof ai.query_ar === 'string' && ai.query_ar.trim().length > 3) distilled.push(ai.query_ar.trim());
  }
  if (distilled.length) {
    return distilled.some(cand => {
      const cw = [...new Set(queryTokens(cand).filter(x => !/^\d+$/.test(x)))];
      if (!cw.length) return false;
      const core = [...new Set(queryTokens(coreClause(cand)).filter(x => !/^\d+$/.test(x)))];
      const denom = core.length || cw.length;
      const hits = cw.filter(x => tokenInTitle(t, x)).length;
      return hits / denom >= 0.6;
    });
  }
  const hits = word.filter(x => tokenInTitle(t, x)).length;
  const coreWords = [...new Set(queryTokens(coreClause(q)).filter(x => !/^\d+$/.test(x)))];
  const denom = coreWords.length || word.length;
  return hits / denom >= 0.6;
}

/* Every price this engine prints is labelled جنيه, so a price the page states
   in another currency must never reach the response.

   Discovery admits any .com/.net/.shop/.store domain, which is how a search for
   an Instant Pot surfaced instantpot.com and instantpotme.com — and their $110
   and AED 499 were rendered as "110 جنيه" and "499 جنيه", i.e. a ~5,400 EGP
   cooker advertised at a tenth of its price. Wrong by a factor of fifty is
   worse than absent.

   Silence stays unknown, the same asymmetry the unit and model rules use:
   extract.mjs already defaults an unstated currency to EGP, and the store
   adapters parse bare numbers off Egyptian pages and carry no currency at all,
   so this only rejects a page that EXPLICITLY names a foreign currency. */
const EGP_CURRENCY = /^(egp|e\.?£|£e|le|ج\.?\s*م|جنيه)$/i;
// Any EGP marker appearing in page text — used to decide whether a DISCOVERED
// domain prices in Egyptian pounds at all. Deliberately not "LE", which is far
// too common a letter pair in English copy to mean anything on its own.
const EGP_MARK = /EGP|ج\.?\s*م\b|جنيه/i;
function pricedInEgp(it) {
  const c = String(it && it.currency || '').trim();
  return !c || EGP_CURRENCY.test(c);
}

// hard per-store deadline so no single slow/hung store can stall the request
function withTimeout(promise, ms, onTimeout) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(onTimeout), ms))]);
}
async function searchStore(store, q, variants, attrs) {
  const key = String(store.platform || 'auto').split(':')[0];
  const fn = ADAPTERS[key] || ADAPTERS.auto;
  // attempt ladder: AI/canonical variants when available, else the raw query,
  // then the leading words — every pass is relevance-filtered against the RAW query
  /* The rescue attempt: the leading words, used when the verbose pasted title
     returns nothing. It took the first two tokens that were not bare digits,
     which on the commonest shape of a marketplace title — brand, then size,
     then the product — spends the attempt on the unit word:

       "Hawkins 3 Litre Contura Black Pressure Cooker…"  -> "hawkins litre"
       "Tefal 5 Litre Clipso Pressure Cooker"            -> "tefal litre"
       "Toshiba 296 Litre No Frost Refrigerator"         -> "toshiba litre"
       "LG 43 inch Smart TV 43LM6370"                    -> "lg inch"

     No store answers those, so the one fallback that exists was wasted exactly
     when it was needed. Unit words and filler are dropped so the attempt keeps
     identity-bearing words instead: "hawkins contura", "tefal clipso", "lg tv". */
  const toks = queryTokens(q).filter(x =>
    !/^\d+$/.test(x) && !UNIT_TOKENS.has(x) && !LADDER_NOISE.has(x));
  // render (SPA) stores get ONE broad attempt — the in-page harvest collects up
  // to 48 cards and isRelevant narrows them, so breadth beats precision there
  const attempts = key === 'render'
    ? [toks.slice(0, 2).join(' ') || q]
    : [...new Set([...(variants || [q]), toks.slice(0, 2).join(' ')]
        .filter(x => x && x.length >= 2))].slice(0, 3);
  const budget = store.needsHeadless ? 32000 : (key === 'auto' ? 15000 : 9000);
  const work = (async () => {
    for (const attempt of attempts) {
      const raw = (await fn(store, attempt)) || [];
      const items = raw.filter(it => it.price && isRelevant(it.title, q, attrs));
      if (process.env.DEBUG_STORES) console.log('[try]', store.domain, JSON.stringify(attempt).slice(0,70), 'raw=' + raw.length, 'kept=' + items.length);
      if (process.env.DEBUG_STORES === '2') for (const rt of raw.slice(0,8)) console.log('        raw:', isRelevant(rt.title, q, attrs) ? 'KEEP' : 'drop', String(rt.price), String(rt.title).slice(0,70));
      if (items.length) {
        store.lastOk = Date.now(); store.failN = 0; saveRegistrySoon();
        return { store, status: 'ok', items: items.slice(0, 12) };
      }
    }
    return { store, status: 'empty', items: [] };
  })().catch(e => ({ store, status: 'unreachable', items: [], err: String(e.message || e).slice(0, 60) }));
  return withTimeout(work, budget, { store, status: 'timeout', items: [] }).then(w => {
    if (process.env.DEBUG_STORES) console.log('[store]', store.domain, w.status, w.items.length, w.err || '');
    if (w.status === 'unreachable' || w.status === 'timeout') {
      store.failN = (store.failN || 0) + 1; store.lastFail = Date.now(); saveRegistrySoon();
    }
    return w;
  });
}

/* ================= keyless web discovery (DuckDuckGo/Bing HTML) =========
   Returns candidate PAGE URLS — most search hits for "<item> سعر مصر" are
   product pages themselves, so we can lift a JSON-LD price straight off
   them even before we learn the store's own search endpoint. */
async function discoverUrls(q) {
  const found = new Map();   // domain → url
  const harvest = (html, re, dec) => {
    let m; while ((m = re.exec(html))) {
      try {
        const u = new URL(dec ? decodeURIComponent(m[1]) : m[1]);
        const d = u.hostname.replace(/^www\./, '');
        if (!SKIP_DOMAINS.test(d) && /\.(eg|com|net|shop|store)$/i.test(d) && !found.has(d)) found.set(d, u.href);
      } catch {}
    }
  };
  const qq = encodeURIComponent(isLatinQuery(q) ? `${q} price Egypt buy online store` : `${q} سعر شراء مصر متجر اونلاين`);
  const qq2 = encodeURIComponent(isLatinQuery(q) ? `${q} Egypt EGP` : `${q} مصر جنيه`);
  await Promise.allSettled([
    fetchPage(`https://html.duckduckgo.com/html/?q=${qq}&kl=eg-ar`).then(h =>
      harvest(h, /uddg=([^&"]+)/g, true)),
    fetchPage(`https://www.bing.com/search?q=${qq}&cc=eg&setlang=ar`).then(h =>
      harvest(h, /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/g, false)),
    // second phrasing: surfaces different product deep-links per engine run
    fetchPage(`https://html.duckduckgo.com/html/?q=${qq2}&kl=eg-ar`).then(h =>
      harvest(h, /uddg=([^&"]+)/g, true)),
  ]);
  return [...found].map(([domain, url]) => ({ domain, url }));
}
async function probeDomain(domain) {
  const store = { domain, name: domain.split('.')[0], type: 'local', platform: 'auto', addedBy: 'discovery' };
  // platform sniff, cheapest first
  try {
    const j = JSON.parse(await fetchPage(`https://${domain}/search/suggest.json?q=test&resources[type]=product`, 'application/json'));
    if (j.resources) { store.platform = 'shopify'; return store; }
  } catch {}
  try {
    const j = JSON.parse(await fetchPage(`https://${domain}/wp-json/wc/store/v1/products?per_page=1`, 'application/json'));
    if (Array.isArray(j)) { store.platform = 'woo'; return store; }
  } catch {}
  try {
    await fetchPage(`https://www.${domain}/catalogsearch/result/?q=test`);
    store.platform = 'magento'; return store;
  } catch {}
  return store; // stays 'auto' — the jsonld sweep will decide at query time
}

/* ================= AI layer (optional — NVIDIA Nemotron) =================
   Set NVIDIA_API_KEY before starting the server to enable it. The model is the
   intelligence ABOVE the retrieval engine, never the retriever: it structures
   the query (brand/model/size in both languages → sharper per-store searches +
   hard variant filters) and audits the collected offers (bundle / used /
   wrong-variant detection). Every AI call is optional — on any failure the
   engine falls back to the rule-based pipeline and keeps working keylessly. */
const NVIDIA_KEY = process.env.NVIDIA_API_KEY || '';
const AI_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
async function aiChat(prompt, maxTok = 800, timeoutMs = 12000) {
  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + NVIDIA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL, temperature: 0, top_p: 1, max_tokens: maxTok,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '';
}
function aiJson(text) {
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}
const AI_Q_CACHE = new Map();   // query → attrs (per-process)
async function understandQuery(q) {
  if (!NVIDIA_KEY) return null;
  if (AI_Q_CACHE.has(q)) return AI_Q_CACHE.get(q);
  const attrs = aiJson(await aiChat(
    'You normalize Egyptian product-search queries (Arabic, English or mixed). Shoppers often paste an ' +
    'entire marketplace listing title, packed with marketing copy, compatibility lists, and warranty text. ' +
    'Query: "' + q.replace(/"/g, ' ') + '"\n' +
    'Reply with ONLY minified JSON, no prose: {"category_en":string,"category_ar":string,"brand":string|null,' +
    '"model_number":string|null,"size_value":number|null,"size_unit":string|null,"resolution":string|null,' +
    '"wants_used":boolean,"query_en":string,"query_ar":string,"compatible_brands":string[]}\n' +
    '"query_en" and "query_ar" MUST each be a SHORT canonical search string — brand + product type + ' +
    'defining specs ONLY, AT MOST 8 WORDS. Strip all marketing copy: compatibility/"works with"/"for ' +
    'iPhone 16" lists, bundle contents, warranty text, and colour prose. Do NOT echo the full pasted title ' +
    'back — collapse it.\n' +
    'Worked example — the pasted title "Anker Laptop Power Bank (25,000 mAh, 165W, Built-In and Retractable ' +
    'Cables), Effortless Multi-Device Fast Charging, for iPhone 16/15, MacBook, Samsung and More, Space ' +
    'Black - 18 Months Warranty" collapses to query_en:"Anker power bank 25000mAh 165W" (brand + product ' +
    'type + capacity + wattage only — 5 words). "brand" is "Anker" (the maker of THIS product), never a ' +
    'name mentioned only as compatibility.\n' +
    '"compatible_brands" lists brands named ONLY as compatibility/"works with" targets, never the product\'s ' +
    'own brand — for the example above that is ["Samsung"] (Samsung is a device this power bank charges, ' +
    'not who makes it).', 450, 9000).catch(() => ''));
  AI_Q_CACHE.set(q, attrs);
  if (AI_Q_CACHE.size > 500) AI_Q_CACHE.delete(AI_Q_CACHE.keys().next().value);
  return attrs;
}
function buildVariants(q, attrs) {
  const v = [q];
  if (attrs) {
    if (attrs.model_number && String(attrs.model_number).length >= 4) v.push(String(attrs.model_number));
    if (attrs.query_en && attrs.query_en.length > 3) v.push(String(attrs.query_en));
    if (attrs.query_ar && attrs.query_ar.length > 3) v.push(String(attrs.query_ar));
  }
  return [...new Set(v.map(x => x.trim()).filter(x => x.length >= 2))];
}
async function auditOffers(job) {
  if (!NVIDIA_KEY || !job.offers.length) return;
  const cand = bestPerDomain(job.offers).slice(0, 15);
  const list = cand.map((o, i) => `${i}: [${o.domain}] ${o.title} — ${o.price} EGP`).join('\n');
  const out = aiJson(await aiChat(
    'Query: "' + job.q.replace(/"/g, ' ') + '"\nOffers collected from Egyptian stores:\n' + list + '\n' +
    'For each offer judge strictly: is it the SAME product the query asks for (same model/size/variant)? ' +
    'Flag bundles, used/refurbished items, accessories. Reply ONLY a minified JSON array: ' +
    '[{"i":number,"match":boolean,"used":boolean,"bundle":boolean,"accessory":boolean}]', 900, 15000).catch(() => ''));
  if (!Array.isArray(out)) return;
  for (const v of out) {
    const o = cand[v.i];
    if (!o) continue;
    const verdict = { match: v.match !== false, used: !!v.used, bundle: !!v.bundle, accessory: !!v.accessory };
    for (const raw of job.offers) if (raw.url === o.url) raw.ai = verdict;
  }
}

/* ================= offer index (stale-while-revalidate) =================
   The engine never makes a customer wait on a scan it already did: fresh
   results (≤10 min) come straight from the index; usable-but-stale results
   (≤24 h) are served instantly while a background job re-scans; only a
   never-seen query waits — and then only for the LIVE wave (tier 1–2 +
   proven stores). Unproven tier 3–4 stores are swept in the background and
   merged in while the client polls. Price history rides along per offer. */
const INDEX_FILE = path.join(ROOT, 'data', 'price-index.json');
/* Catalog path: when site/data/catalog.db exists we answer from the crawled
   catalog and fall back to live fan-out only when it returns nothing. */
const CATALOG_FILE = path.join(ROOT, 'data', 'catalog.db');
let CATALOG = null;
function catalog() {
  if (CATALOG === null) CATALOG = existsSync(CATALOG_FILE) ? openCatalog(CATALOG_FILE) : false;
  return CATALOG;
}
/* live re-check of one offer: refetch its product page, but only through
   engine/verify.mjs's robots-gated, honest-UA, identity-checked fetch — see
   that module for why (M1 final review findings 2 & 4). Never fall back to
   fetchPage()/UA here: that Chrome-spoofed UA is reserved for the existing
   live store-search fan-out, not for this branch's new per-offer traffic. */
const verifyOffer = createVerifyOffer({ extractProducts: jsonLdProducts });
const FRESH_MS = 10 * 60e3, USABLE_MS = 24 * 3600e3, MAX_QUERIES = 400;
let INDEX = null;
async function loadIndex() {
  if (INDEX) return INDEX;
  try { INDEX = JSON.parse(await readFile(INDEX_FILE, 'utf8')); } catch { INDEX = { v: 1, queries: {} }; }
  return INDEX;
}
let idxSaveT = null;
function saveIndexSoon() {
  clearTimeout(idxSaveT);
  idxSaveT = setTimeout(() => { if (INDEX) writeFile(INDEX_FILE, JSON.stringify(INDEX)).catch(() => {}); }, 1500);
}
const qkey = q => queryTokens(q).sort().join(' ') || normAr(q);

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
function classify(store, q) {
  const ql = q.toLowerCase();
  for (const [latin, names] of Object.entries(BRANDS))
    if (names.some(x => ql.includes(x)) && store.domain.includes(latin)) return 'official';
  return store.type || 'local';
}
function bestPerDomain(offers) {
  const best = {};
  for (const o of offers) if (o.price && (!best[o.domain] || o.price < best[o.domain].price)) best[o.domain] = o;
  return Object.values(best).sort((a, b) => a.price - b.price);
}

/* ---- search jobs: wave 1 (live) answers the customer, wave 2 (background)
   sweeps the unproven long tail, discovery hunts new stores — all merge into
   the same job; the client polls while `refreshing` is true ---- */
const JOBS = new Map();   // qkey → job
function startJob(q, qk, discover) {
  if (JOBS.has(qk)) return JOBS.get(qk);
  const job = {
    q, qk, t: Date.now(), offers: [], done: false, ai: null,
    stats: { scanned: 0, responded: 0, unreachable: [], discovered: [] },
  };
  JOBS.set(qk, job);
  job.wave1 = runJob(job, discover).catch(() => { finishJob(job); });
  return job;
}
async function runJob(job, discover) {
  const reg = await loadRegistry();
  job.ai = await understandQuery(job.q).catch(() => null);
  const variants = buildVariants(job.q, job.ai);
  const usable = reg.stores.filter(s => (!s.needsHeadless || headlessAvailable()) && !circuitOpen(s));
  const live = usable.filter(s => (s.t || 3) <= 2 || s.lastOk);
  const rest = usable.filter(s => !live.includes(s));
  job.stats.scanned = usable.length;

  const collect = w => {
    if (!w || w.status !== 'ok') {
      if (w && w.status === 'unreachable') job.stats.unreachable.push(w.store.domain);
      return;
    }
    job.stats.responded++;
    const at = Date.now();
    for (const it of w.items) {
      if (!pricedInEgp(it)) { job.stats.foreignCurrency = (job.stats.foreignCurrency || 0) + 1; continue; }
      job.offers.push({
        title: it.title.slice(0, 140), price: it.price, url: it.url,
        domain: w.store.domain, sname: w.store.name, snameEn: w.store.nameEn || w.store.name,
        stype: w.store.type || 'local', tier: w.store.t || 3, checkedAt: at,
      });
    }
  };

  const discP = discover ? discoveryWave(job, reg, collect) : Promise.resolve();
  await pool(live, 12, s => searchStore(s, job.q, variants, job.ai).then(collect));

  // wave 2 + discovery + AI audit continue after the response goes out
  job.bg = (async () => {
    await pool(rest, 6, s => searchStore(s, job.q, variants, job.ai).then(collect));
    await discP;
    // Tavily fallback fires only when the whole registry sweep came up thin —
    // few relevant offers from few stores. It reaches beyond the registry, so
    // it is the last resort, not a per-query default: a well-answered search
    // never triggers it and never pays its latency or quota.
    const relevantStores = new Set(job.offers.map(o => o.domain)).size;
    if (relevantStores < 3) await tavilyWave(job, reg, collect).catch(() => {});
    await auditOffers(job).catch(() => {});
  })().finally(() => finishJob(job));
}
async function discoveryWave(job, reg, collect) {
  const urls = await discoverUrls(job.q).catch(() => []);
  const known = [], unknown = [];
  for (const c of urls) {
    const s = reg.stores.find(x => c.domain === x.domain || c.domain.endsWith('.' + x.domain));
    if (s) known.push({ ...c, store: s }); else unknown.push(c);
  }
  // KNOWN stores first: a search-engine deep link often reaches a product page
  // the store's own search never surfaces (weak internal search, SPA grids) —
  // lift its JSON-LD directly and credit the store. This is exactly how a
  // human shopper finds the listing the storefront search hides.
  await pool(known.slice(0, 8), 4, k => withTimeout((async () => {
    try {
      const html = await fetchPage(k.url);
      const items = jsonLdProducts(html, k.store.domain).filter(it => it.price && isRelevant(it.title, job.q));
      if (items.length) collect({ store: k.store, status: 'ok', items: items.slice(0, 3) });
    } catch {}
  })(), 10000, null));
  const candidates = unknown.slice(0, 5);
  const waves = await pool(candidates, 3, c => withTimeout((async () => {
    let html;
    try { html = await fetchPage(c.url); } catch { return { status: 'unreachable', items: [] }; }
    /* A discovered domain has to prove it sells in Egyptian pounds before the
       engine will quote it. The TLD cannot decide this — btech.com and
       raneen.com are Egyptian, instantpot.com and walmart.com are not — and
       the currency check on the offer only catches pages that state one in
       JSON-LD, which the HTML-scrape path never does. So the page itself must
       carry an EGP marker somewhere; a genuine Egyptian storefront always
       prints one. Without it we neither quote the domain nor add it to the
       registry, where it would be searched on every future comparison. */
    if (!EGP_MARK.test(html)) {
      job.stats.nonEgyptian = (job.stats.nonEgyptian || 0) + 1;
      return { status: 'foreign', items: [] };
    }
    // 1) the search hit itself is usually a product page — lift its JSON-LD
    const items = jsonLdProducts(html, c.domain).filter(it => it.price && isRelevant(it.title, job.q));
    if (items.length) {
      const store = { domain: c.domain, name: c.domain.split('.')[0], type: 'local', t: 4,
        platform: 'auto', addedBy: 'discovery', lastOk: Date.now() };
      return { store, status: 'ok', items: items.slice(0, 6) };
    }
    // 2) otherwise probe the domain's platform and try its search endpoint
    return searchStore(await probeDomain(c.domain), job.q);
  })(), 10000, { status: 'timeout', items: [] }));
  for (const w of waves) {
    if (w && w.status === 'ok' && !reg.stores.some(s => s.domain === w.store.domain)) {
      reg.stores.push(w.store); job.stats.discovered.push(w.store.domain); collect(w);
    }
  }
  if (job.stats.discovered.length) saveRegistrySoon();
}

/* ---- Tavily discovery wave (URL discovery ONLY) ------------------------------
   Reaches stores the engine cannot: those that block their own search path but
   serve product pages (raneen, sharpegy), and stores absent from the registry.
   Tavily returns product-PAGE URLs; every price and identity below comes from
   OUR extractor and OUR relevance filter — never from Tavily's snippets, which
   are unreliable. Fails soft: no key or any error contributes nothing. Runs
   only when the cheaper paths have already come up short (see runTavilyFallback
   gate), so a normal answered query never pays its cost. */
async function tavilyWave(job, reg, collect) {
  if (!tavilyEnabled()) return;
  const found = await discoverProductUrls(job.q, { maxResults: 8, timeoutMs: 9000 }).catch(() => []);
  if (!found.length) return;
  job.stats.tavily = found.length;
  await pool(found, 4, ({ url, domain }) => withTimeout((async () => {
    let html;
    try { html = await fetchPage(url, 'text/html', 12000); } catch { return; }
    const p = extractProduct(html, url);
    if (!p || !p.price || !isRelevant(p.title, job.q, job.ai)) return;
    const known = reg.stores.find(s => domain === s.domain || domain.endsWith('.' + s.domain));
    const store = known || { domain, name: domain.split('.')[0], type: 'local', t: 4,
      platform: 'auto', addedBy: 'tavily', lastOk: Date.now() };
    if (!known) { reg.stores.push(store); job.stats.discovered.push(domain); saveRegistrySoon(); }
    collect({ store, status: 'ok', items: [{ title: p.title, price: p.price, url }] });
  })(), 14000, null));
}
function finishJob(job) {
  if (job.done) return;
  job.done = true;
  const prev = INDEX && INDEX.queries ? INDEX.queries[job.qk] : null;
  // a scan that came back empty must not clobber a previous good snapshot
  if (!job.offers.length && prev && prev.offers.length) { JOBS.delete(job.qk); return; }
  // merge price history from the previous index entry (same product URL)
  if (prev) {
    const old = new Map(prev.offers.map(o => [o.url, o]));
    for (const o of job.offers) {
      const p = old.get(o.url);
      if (!p) continue;
      o.hist = (p.hist || []).slice(-9);
      if (p.price !== o.price) o.hist.push({ p: p.price, t: p.checkedAt });
      if (!o.ai && p.ai) o.ai = p.ai;
    }
    // ACCUMULATE: deep-link discovery is nondeterministic per run — an offer a
    // previous scan captured must survive a scan that missed it (≤48h; its old
    // checkedAt stays visible so the customer sees exactly how fresh it is)
    const have = new Set(job.offers.map(o => o.url));
    for (const p of prev.offers)
      if (!have.has(p.url) && Date.now() - (p.checkedAt || 0) < 48 * 3600e3) job.offers.push(p);
  }
  if (INDEX) {
    const hits = (INDEX.queries[job.qk] && INDEX.queries[job.qk].hits) || 0;
    INDEX.queries[job.qk] = { q: job.q, t: Date.now(), offers: job.offers, stats: job.stats, ai: job.ai, hits };
    // canonical-product alias: a pinned model number maps every title variation
    // of the same unique product onto ONE index entry ("4T-C75FN6EX" and
    // "sharp 75 smart tv 4T-C75FN6EX" share offers)
    const mk = (job.ai && job.ai.model_number ? String(job.ai.model_number) : null) || modelToken(job.q);
    if (mk && qkey(mk) !== job.qk) { INDEX.alias = INDEX.alias || {}; INDEX.alias[qkey(mk)] = job.qk; }
    const keys = Object.keys(INDEX.queries);
    if (keys.length > MAX_QUERIES) {
      keys.sort((a, b) => INDEX.queries[a].t - INDEX.queries[b].t)
        .slice(0, keys.length - MAX_QUERIES).forEach(k => delete INDEX.queries[k]);
    }
    saveIndexSoon();
  }
  JOBS.delete(job.qk);
}

/* ---- deterministic ranking: the model never decides what is cheapest ---- */
const USED_RE = /مستعمل|مستخدم|كسر\s*زيرو|refurb|used\b|open\s*box|اوبن\s*بوكس/i;
/* rule-based model-number detection (AI-free): a 7+ char letters+digits token
   ("4T-C75FN6EX", "AW-J800AUPEG") pins the exact product — pure spec tokens
   like "128gb"/"75inch" are not models */
function modelToken(q) {
  for (const w of String(q).toLowerCase().split(/\s+/)) {
    const t = w.replace(/[^a-z0-9-]/g, '');
    if (t.length >= 7 && /\d/.test(t) && /[a-z]/.test(t) &&
      !/^\d+(gb|tb|kg|ml|mm|cm|hz|w|k|l|inch|inches)$/.test(t)) return t;
  }
  return null;
}
function offerFlags(o, q, attrs) {
  const f = [];
  const wantsUsed = USED_RE.test(q) || !!(attrs && attrs.wants_used);
  if (!wantsUsed && (USED_RE.test(o.title) || (o.ai && o.ai.used))) f.push('used');
  if (o.ai && o.ai.bundle) f.push('bundle');
  if (o.ai && (o.ai.accessory || o.ai.match === false)) f.push('mismatch');
  // exact-model rule: if the query (or AI) pinned a model number, offers
  // lacking it stay visible but are never crowned
  const model = (attrs && attrs.model_number ? String(attrs.model_number) : null) || modelToken(q);
  if (model && model.length >= 5) {
    const squash = s => normAr(s).replace(/[^a-z0-9؀-ۿ]/g, '');
    if (!squash(o.title).includes(squash(model))) f.push('variant');
  }
  return f;
}
function buildResponse(q, offers, stats, ai, min, max, lang, refreshing, src, age) {
  const filtered = offers.filter(o => o.price && (!min || o.price >= min) && (!max || o.price <= max));
  const results = bestPerDomain(filtered).map(o => {
    const flags = offerFlags(o, q, ai);
    return {
      store: lang === 'en' ? (o.snameEn || o.sname) : o.sname, domain: o.domain,
      type: classify({ domain: o.domain, type: o.stype }, q),
      title: o.title, price: o.price, effectivePrice: o.price, currency: 'EGP', url: o.url,
      checkedAt: o.checkedAt, flags, tier: o.tier || 3,
      prevPrice: o.hist && o.hist.length ? o.hist[o.hist.length - 1].p : null,
    };
  });
  // top-5: exact, new, unflagged offers only — flagged ones stay visible but never crowned
  let rank = 0;
  for (const r of results) if (!r.flags.length && rank < 5) r.rank = ++rank;
  const cheapest = results.find(r => r.rank === 1) || results[0] || null;
  const sadko = results.find(r => r.domain === 'sadko-group.com');
  const concierge = cheapest ? {
    cheapestStore: cheapest.store, cheapestPrice: cheapest.price,
    sadkoHasIt: !!sadko, sadkoPrice: sadko ? sadko.price : null,
    pitch: 'validation+shipping+maintenance', hotline: '19140',
  } : null;
  return {
    mode: 'engine', query: q, results, cheapest, concierge, refreshing: !!refreshing,
    stats: { ...stats, headless: headlessAvailable(), ai: !!NVIDIA_KEY, src: src || 'live', ageMs: age || 0 },
    links: storeLinks(q, lang),
  };
}

/* Reads the interpretation-bar overrides out of the query string:
     cat=<category>          confirms/replaces the detected category
     u_<unit>=<value>        confirms/replaces one parsed unit (e.g. u_kg=7)
     s_<spec>=<value>        confirms/replaces one parsed spec (e.g. s_smart=true)
   An explicitly EMPTY param (u_kg=) means that attribute was removed by the
   shopper — it still marks the whole field (units/specs) as "present" in the
   override so rankOffers treats it as a hard filter, it just omits that one
   key, which is exactly how a removed chip widens the result set. */
function parseOverride(sp) {
  const override = {};
  if (sp.has('cat')) override.category = sp.get('cat') || null;
  let units = null, specs = null;
  for (const [k, v] of sp) {
    if (k.startsWith('u_')) {
      units = units || {};
      if (v !== '') units[k.slice(2)] = /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : v;
    } else if (k.startsWith('s_')) {
      specs = specs || {};
      if (v !== '') specs[k.slice(2)] = v === 'true' ? true : v === 'false' ? false : v;
    }
  }
  if (units) override.units = units;
  if (specs) override.specs = specs;
  return override;
}

/* Rows from the live fan-out, for a query the catalog has already answered.

   Never awaits the sweep: it joins a running job or starts one and returns
   whatever has landed so far (plus anything the saved index still holds), so
   the catalog answer is not delayed by a store that takes 32s. The caller
   reports `refreshing` and the client polls back for the rest.

   Shaped by buildResponse so live rows arrive in exactly the response shape
   the catalog rows already use — bestPerDomain applied, offerFlags computed,
   min/max honoured, store name localised — rather than being mapped a second,
   subtly different way here. */
async function liveSupplement(q, discover, min, max, lang) {
  try {
    await loadIndex(); await loadRegistry();
    const qk = qkey(q);
    const idx = INDEX.queries[qk] || INDEX.queries[(INDEX.alias || {})[qk]];
    let job = JOBS.get(qk);
    if (!job && !(idx && Date.now() - idx.t < FRESH_MS)) job = startJob(q, qk, discover);
    const offers = job && job.offers.length ? job.offers : (idx ? idx.offers : []);
    const rows = buildResponse(q, offers, {}, job ? job.ai : null,
      min, max, lang, false, 'live', 0).results;
    return { rows, refreshing: !!(job && !job.done) };
  } catch {
    return { rows: [], refreshing: false };   // the catalog answer still stands
  }
}

/* The shopper-facing name of a store, in their language.

   The catalog stores a domain and nothing else, so the catalog path used to
   label its rows with the bare domain ("egypt.sharafdg.com"). That was merely
   ugly while those rows sat alone; now that live rows — which buildResponse
   labels properly — are merged into the same list, an unresolved row reads as
   a different, less trustworthy kind of result sitting next to a real one.
   Falls back to the domain for a store the registry has never seen. */
function storeLabel(domain, lang) {
  const s = (REGISTRY?.stores || []).find(x => x.domain === domain);
  if (!s) return domain;
  return (lang === 'en' ? (s.nameEn || s.name) : s.name) || domain;
}

async function compare(q, min, max, discover, lang, override) {
  const cat = catalog();
  if (cat) {
    const r = await rankOffers(cat, q, { verify: verifyOffer, verifyTop: 10, override });
    // Only answer from the catalog when it produced something genuinely
    // useful: a real identity match (r.confident — at least one exact/strong
    // crowned result) or a legitimate category browse (r.browse). ANY other
    // non-empty result set is just weak/noise matches (e.g. "Arion 43-Inch
    // Full HD Smart" matching a screen protector and a printer on shared
    // words like "Full"/"Smart"/"HD") and must fall through to the live
    // fan-out below, exactly as when the catalog is empty (CRITICAL 1,
    // garbage-match review).
    if (r.results.length && (r.browse || r.confident)) {
      const filtered = r.results.filter(x => (!min || x.price >= min) && (!max || x.price <= max));
      await loadRegistry();          // cached; needed for storeLabel below
      const results = filtered.map(x => ({
        store: storeLabel(x.domain, lang), domain: x.domain, type: 'local', title: x.title,
        price: x.price, effectivePrice: x.price, currency: x.currency, url: x.url,
        checkedAt: x.checkedAt, flags: x.confidence === 'weak' ? ['variant'] : [],
        rank: x.rank, verified: x.verified,
      }));
      /* The catalog is a partial mirror — see mergeLiveRows in engine/serve.mjs.
         It can identify the product but it cannot price the whole market, so its
         answer ships immediately (it is the fast path, and that is the point)
         while the live fan-out runs in the background for the stores it cannot
         cover. `refreshing` makes assets/js/compare.js poll every 6s and re-render,
         so Amazon/Carrefour prices appear a few seconds later without the shopper
         waiting on a 32s headless sweep up front.

         Browse listings are deliberately excluded: a bare category browse is not a
         question about one product, and sweeping every store for it would spend a
         full live fan-out per category page for no identity to merge on. Note the
         browse branch of rankOffers reports `confident: true` while crowning
         nothing — there, "confident" means "this browse is a real answer", not
         "this is the product" — so the gate has to exclude `browse` explicitly
         rather than lean on `confident` alone. */
      let merged = results, refreshing = false;
      if (r.confident && !r.browse) {
        const sup = await liveSupplement(q, discover, min, max, lang);
        // r.interpretation is the `want` rankOffers matched the catalog against
        // (parsed identity + any shopper override), so the live rows are held to
        // the same reading of the query the catalog rows were.
        merged = mergeLiveRows(results, sup.rows, q, r.interpretation);
        refreshing = sup.refreshing;
      }
      // derive cheapest from the MERGED and price-FILTERED rows: rankOffers'
      // own `cheapest` carries `domain` but not `store`, predates the min/max
      // filter, and now also predates the live merge — so using it directly
      // would render an undefined store name, could crown a row the shopper's
      // price filter excluded, and would miss a cheaper live store entirely
      const cheapest = merged.find(x => x.rank === 1) || null;
      const sadko = merged.find(x => x.domain === 'sadko-group.com');
      return {
        mode: 'catalog', query: q,
        results: merged,
        cheapest,
        concierge: cheapest ? {
          cheapestStore: cheapest.store, cheapestPrice: cheapest.price,
          sadkoHasIt: !!sadko, sadkoPrice: sadko ? sadko.price : null,
          pitch: 'validation+shipping+maintenance', hotline: '19140',
        } : null,
        refreshing,
        stats: { ...r.stats, src: 'catalog', headless: headlessAvailable(), ai: !!NVIDIA_KEY },
        links: storeLinks(q, lang),
        interpretation: r.interpretation,
      };
    }
  }

  await loadIndex(); await loadRegistry();
  const qk = qkey(q);
  let job = JOBS.get(qk);
  const idx = INDEX.queries[qk] || INDEX.queries[(INDEX.alias || {})[qk]];
  if (idx) idx.hits = (idx.hits || 0) + 1;
  if (job) {      // a scan is already running — return the current snapshot
    const offers = job.offers.length ? job.offers : (idx ? idx.offers : []);
    return buildResponse(q, offers, job.stats, job.ai, min, max, lang, !job.done, 'live', 0);
  }
  if (idx && Date.now() - idx.t < FRESH_MS)
    return buildResponse(q, idx.offers, idx.stats, idx.ai, min, max, lang, false, 'index', Date.now() - idx.t);
  job = startJob(q, qk, discover);
  if (idx && Date.now() - idx.t < USABLE_MS)   // stale-while-revalidate: instant answer
    return buildResponse(q, idx.offers, idx.stats, idx.ai, min, max, lang, true, 'index', Date.now() - idx.t);
  await job.wave1;                              // first-ever query: wait for the live wave only
  return buildResponse(q, job.offers, job.stats, job.ai, min, max, lang, !job.done, 'live', 0);
}

/* ---- periodic refresher: every 15 min, re-scan the most-searched entries
   that have gone stale (>3h), most popular first — the index converges into a
   continuously warm directory of the market's cheapest offers, and customers
   almost always hit the instant path. One query per tick, never stacking on
   top of live customer scans. ---- */
const REFRESH_AFTER = 3 * 3600e3;
setInterval(async () => {
  try {
    await loadIndex();
    if (JOBS.size) return;                      // customer scans have priority
    const due = Object.entries(INDEX.queries)
      .filter(([, e]) => Date.now() - e.t > REFRESH_AFTER)
      .sort((a, b) => (b[1].hits || 0) - (a[1].hits || 0) || a[1].t - b[1].t)[0];
    if (due) {
      console.log('index refresh:', due[1].q);
      startJob(due[1].q, due[0], false);
    }
  } catch {}
}, 15 * 60e3).unref();
function storeLinks(q, lang) {
  const e = encodeURIComponent(q);
  const en = lang === 'en';
  const L = (ar, enName) => en ? enName : ar;
  return [
    { store: L('أمازون مصر', 'Amazon Egypt'), url: `https://www.amazon.eg/s?k=${e}&language=${en ? 'en_AE' : 'ar_AE'}` },
    { store: L('نون', 'noon'), url: `https://www.noon.com/egypt-${en ? 'en' : 'ar'}/search/?q=${e}` },
    { store: L('بى تك', 'B.TECH'), url: `https://btech.com/${en ? 'en' : 'ar'}/catalogsearch/result/?q=${e}` },
    { store: L('2B مصر', '2B Egypt'), url: `https://2b.com.eg/${en ? 'en' : 'ar'}/catalogsearch/result/?q=${e}` },
    { store: L('جوميا', 'Jumia'), url: `https://www.jumia.com.eg/${en ? '' : 'ar/'}catalog/?q=${e}` },
    { store: L('كارفور مصر', 'Carrefour Egypt'), url: `https://www.carrefouregypt.com/mafegy/${en ? 'en' : 'ar'}/v4/search?keyword=${e}` },
    { store: L('جوجل شوبينج', 'Google Shopping'), url: `https://www.google.com/search?tbm=shop&hl=${en ? 'en' : 'ar'}&gl=eg&q=${e}` },
  ];
}

/* ================= accounts, sign-in and orders ================= */
/* Real server-side auth (scrypt + HttpOnly session cookies) lives in
   engine/accounts.mjs. Everything here is transport: cookies, bodies, and
   turning module errors into messages a customer can act on.

   PAYMENT: this site accepts OFFLINE methods only. No card number, CVV or
   expiry is ever requested, transmitted or stored anywhere in this codebase.
   Taking card payments requires a PCI-compliant gateway (in Egypt typically
   Paymob or Fawry) redirecting to the provider's own hosted page — that
   integration does not exist yet, so offering a card form here would be
   collecting payment details under false pretences. */
const PAYMENT_METHODS = ['cod', 'bank', 'showroom'];

/* The methods actually on offer. Ecwid's store carries ten — cash on delivery
   plus nine Egyptian instalment and payment services — all of them "manual"
   methods, so no card data is handled and PCI scope is unaffected. With Ecwid
   off this returns exactly the three the site has always offered.

   Two of the ten are restricted to one manufacturer's products, and Ecwid
   cannot enforce that; engine/ecwid-payments.mjs detects it from the label so
   checkout can say so at the point of choice. */
function activePaymentMethods() {
  const store = ecwidStore();
  if (store && ecwidSource().activeSource() === 'ecwid') {
    try {
      const live = toStorefrontMethods(store.allPaymentMethods());
      if (live.length) return live;
    } catch (e) { /* fall through to the built-in three */ }
  }
  return FALLBACK_METHODS;
}

/* ---- Ecwid ---------------------------------------------------------------
   The flag gates everything. `enabled` additionally requires a token: with the
   flag on but no token the server still boots and serves the seed catalogue,
   and the admin panel says "not connected" — an integration must never take
   the site down. */
/* Product fields Ecwid owns once it is the catalogue source. The owner edits
   these in Ecwid, not here, so there is exactly one writer per field and a
   local override can never silently mask a future Ecwid price change.

   `badge` is deliberately absent. Ecwid does have a ribbon field, but this
   store sets none on any of its 1,453 products, so badge is the one product
   field the local overlay still usefully owns. */
const ECWID_OWNED_FIELDS = ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand'];

const ECWID_ON = process.env.SADKO_ECWID === '1';
const ECWID_STORE_ID = process.env.SADKO_ECWID_STORE_ID || '142682751';
const ECWID_TOKEN = process.env.SADKO_ECWID_TOKEN || '';
/* One Ecwid category per advertisement slot — SADKO_ECWID_ADS_HERO / _WIDE /
   _SQUARE, each a category id. Everything in a folder becomes an ad of that
   slot, so staff drop the artwork in the right folder instead of typing a
   magic SKU. Unset folders fall back to the banner- SKU convention. See
   engine/ecwid-ads.mjs for why the folders are addressed by ID and not by
   name (a disabled Ecwid category has no readable name). */
const ECWID_AD_FOLDERS = adFoldersFromEnv(process.env);

/* How often the mirror asks Ecwid what changed.

   60 seconds by default, because the point of this integration is that staff
   edit Ecwid and the site follows — at the previous 15 minutes an owner who
   uploaded a banner and refreshed saw nothing and reasonably concluded it was
   broken.

   The cost is small: the products call is incremental (updatedFrom), so it
   almost always returns nothing, plus one call per configured ad folder.
   Tunable without a developer; floored at 15s so a typo cannot hammer the
   API, and a value of 0 disables polling for anyone running purely on
   webhooks. */
const ECWID_POLL_MS = (() => {
  const raw = process.env.SADKO_ECWID_POLL_SECONDS;
  if (raw == null || String(raw).trim() === '') return 60_000;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return 60_000;
  return n === 0 ? 0 : Math.max(15, n) * 1000;
})();
const ECWID_BANNER_CATEGORY = process.env.SADKO_ECWID_BANNER_CATEGORY || null;
let ECWID_STORE = null, ECWID_API = null, ECWID_SYNC = null, ECWID_SOURCE = null;

function ecwidStore() {
  if (!ECWID_ON) return null;
  if (ECWID_STORE === null) {
    try { ECWID_STORE = openEcwidStore(path.join(ROOT, 'data', 'ecwid.db')); }
    catch (e) { console.error('[ecwid] store unavailable:', e.message); ECWID_STORE = false; }
  }
  return ECWID_STORE || null;
}
function ecwidApi() {
  if (!ECWID_ON) return null;
  if (ECWID_API === null)
    ECWID_API = openEcwidApi({ storeId: ECWID_STORE_ID, token: ECWID_TOKEN });
  return ECWID_API;
}
function ecwidSync() {
  const store = ecwidStore(), api = ecwidApi();
  if (!store || !api || !api.configured) return null;
  if (ECWID_SYNC === null) ECWID_SYNC = createEcwidSync({ adFolders: ECWID_AD_FOLDERS, api, store });
  return ECWID_SYNC;
}
/* Always returns a source, even with the flag off — it is what decides to
   serve the seed, so every catalogue read can go through one path. */
function ecwidSource() {
  if (ECWID_SOURCE === null) {
    const store = ecwidStore();
    ECWID_SOURCE = createEcwidSource({
      /* A getter, not a value: every sync rebuilds this map, and a value
         captured here would pin the storefront to whatever the ad folders
         held at boot — the same stale-value trap that once made
         activeSource() serve July's catalogue. */
      adSlotMap: () => { try { return ecwidSync().adFolderState().map; } catch (e) { return {}; } },
      store: store || {
        allProducts: () => [],
        stats: () => ({ products: 0, enabled: 0, buyable: 0, categories: 0, outOfStock: 0,
                        discounted: 0, incomplete: 0, paymentMethods: 0, shippingMethods: 0,
                        lastSync: null, lastError: null }),
      },
      seedLoader: seedCatalog,
      enabled: ECWID_ON && !!ECWID_TOKEN,
      bannerCategoryId: ECWID_BANNER_CATEGORY,
    });
  }
  return ECWID_SOURCE;
}

let ACCOUNTS = null;
function accounts() {
  if (ACCOUNTS === null) {
    try { ACCOUNTS = openAccounts(path.join(ROOT, 'data', 'accounts.json')); }
    catch (e) { console.error('[accounts] unavailable:', e.message); ACCOUNTS = false; }
  }
  return ACCOUNTS;
}

const SESSION_COOKIE = 'sadko_session';

/* ---- admin (the owner's control room) ------------------------------------
   Who is an admin is decided ONLY by the ADMIN_EMAILS env var — a comma list
   set on the server, never in the database and never editable from the browser.
   An account gains admin power solely by signing in with a listed email, so a
   compromised web layer cannot mint an admin. */
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);
const isAdminEmail = email => ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
const isAdminUser  = user => !!(user && isAdminEmail(user.email));

let CATALOG_ADMIN = null;
function catalogAdmin() {
  if (CATALOG_ADMIN === null) {
    try { CATALOG_ADMIN = openCatalogAdmin(path.join(ROOT, 'data', 'catalog-admin.db')); }
    catch (e) { console.error('[catalog-admin] unavailable:', e.message); CATALOG_ADMIN = false; }
  }
  return CATALOG_ADMIN;
}

let ANALYTICS = null;
function analytics() {
  if (ANALYTICS === null) {
    try { ANALYTICS = openAnalytics(path.join(ROOT, 'data', 'analytics.db')); }
    catch (e) { console.error('[analytics] unavailable:', e.message); ANALYTICS = false; }
  }
  return ANALYTICS;
}

/* The STATIC seed catalogue: the July scrape, cached in memory and re-read only
   when the file's mtime changes. Once Ecwid is on and mirrored this is only a
   cold-start and outage fallback — see engine/ecwid-source.mjs for the
   precedence rules. */
let _baseCat = { mtime: 0, list: null };
async function seedCatalog() {
  const file = path.join(ROOT, 'data', 'products.json');
  try {
    const m = statSync(file).mtimeMs;
    if (_baseCat.list && _baseCat.mtime === m) return _baseCat.list;
    const doc = JSON.parse(await readFile(file, 'utf8'));
    _baseCat = { mtime: m, list: Array.isArray(doc.products) ? doc.products : [] };
  } catch (e) { if (!_baseCat.list) _baseCat.list = []; }
  return _baseCat.list;
}

/* The catalogue the storefront builds on: the Ecwid mirror when it has rows,
   otherwise the seed. One call site, so nothing can read the wrong source. */
async function baseCatalog() { return ecwidSource().catalogBase(); }
// The storefront catalogue as customers see it = base ⊕ owner's overlay.
async function mergedCatalog() {
  const base = await baseCatalog();
  const adm = catalogAdmin();
  return adm ? adm.merge(base) : base;
}

/* ---- production hardening -------------------------------------------------
   Small, dependency-free versions of the things a public server needs. */

// Sent on every response. CSP is deliberately explicit about the few external
// origins this site really uses (Google Fonts, the CDN the catalogue images sit
// on, and the Google sign-in SDK) so anything else injected into a page cannot
// phone home.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    // inline handlers/styles are used throughout the static pages
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    // the scroll-world home page fetches each scene clip same-origin, wraps it in
    // a blob: URL and scrubs it as <video> — allow self + blob: media, or the
    // camera flight is blocked and every scene falls back to its still.
    "media-src 'self' blob:",
    "connect-src 'self' https://accounts.google.com",
    "frame-src https://accounts.google.com",
  ].join('; '),
};
function applySecurityHeaders(res, secure) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  // Only meaningful over TLS, and harmful if set while still on plain http.
  if (secure) res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains');
}

/* Cross-site request forgery: SameSite=Lax already blocks the classic form
   post, and a JSON content-type forces a CORS preflight. This is the belt to
   that braces — a state-changing request must come from our own origin. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;                       // curl / same-origin fetch without Origin
  try {
    const o = new URL(origin);
    const host = String(req.headers.host || '');
    return o.host === host;
  } catch { return false; }
}

/* A crude per-IP request budget, so one client cannot drown the box. */
const RATE = { windowMs: 60000, max: 240, hits: new Map() };
function rateLimited(ip) {
  const now = Date.now();
  const rec = RATE.hits.get(ip);
  if (!rec || now - rec.at > RATE.windowMs) { RATE.hits.set(ip, { at: now, n: 1 }); return false; }
  rec.n++;
  return rec.n > RATE.max;
}
setInterval(() => {
  const cutoff = Date.now() - RATE.windowMs;
  for (const [k, v] of RATE.hits) if (v.at < cutoff) RATE.hits.delete(k);
}, RATE.windowMs).unref?.();

const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || req.socket.remoteAddress || '';
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function isSecure(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function setSessionCookie(res, req, raw, expires) {
  const bits = [`${SESSION_COOKIE}=${encodeURIComponent(raw)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
                `Expires=${new Date(expires).toUTCString()}`];
  if (isSecure(req)) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}
function clearSessionCookie(res, req) {
  const bits = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(req)) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}
function currentUser(req) {
  const db = accounts();
  if (!db) return null;
  try { return db.userForToken(readCookie(req, SESSION_COOKIE)); } catch { return null; }
}
async function readJson(req, limit = 40000) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > limit) throw new Error('too-large'); }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('bad-json'); }
}
/* Error codes -> bilingual, non-leaky messages. */
const AUTH_MSG = {
  'bad-email':      ['اكتب بريداً إلكترونياً صحيحاً.', 'Enter a valid email address.'],
  'password-short': ['كلمة السر لازم تكون ٨ حروف على الأقل.', 'Password must be at least 8 characters.'],
  'password-weak':  ['كلمة السر لازم تحتوى على حروف وأرقام.', 'Password must contain both letters and numbers.'],
  'bad-name':       ['اكتب اسمك.', 'Please enter your name.'],
  'bad-phone':      ['رقم الهاتف غير صحيح.', 'That mobile number does not look right.'],
  'email-taken':    ['هذا البريد الإلكترونى مسجَّل من قبل — سجّل دخولك.', 'That email is already registered — sign in instead.'],
  'bad-credentials':['البريد الإلكترونى أو كلمة المرور غير صحيحة.', 'Wrong email or password.'],
  'too-many':       ['محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.', 'Too many attempts. Please wait a few minutes and try again.'],
  'empty-cart':     ['السلة فاضية.', 'Your cart is empty.'],
  'too-many-items': ['عدد الأصناف كبير جداً.', 'Too many items in one order.'],
  'no-user':        ['لازم تسجّل دخولك الأول.', 'Please sign in first.'],
  'no-home':        ['هذا المكان غير موجود.', 'That place was not found.'],
  'too-many-homes': ['وصلت للحد الأقصى من الأماكن.', 'You have reached the maximum number of places.'],
  'no-password':    ['هذا الحساب يسجّل الدخول عبر جوجل — ولا توجد كلمة مرور لتغييرها.', 'This account signs in with a provider — there is no password to change.'],
  'bad-identity':   ['بيانات الدخول ناقصة.', 'Incomplete sign-in details.'],
  'bad-json':       ['طلب غير صالح.', 'Malformed request.'],
  'too-large':      ['حجم الطلب كبير جداً.', 'Request too large.'],
  'unavailable':    ['خدمة الحسابات غير متاحة فى هذه النسخة.', 'Accounts are not available on this deployment.'],
};
const authErr = (code, lang) => ({ error: code, message: (AUTH_MSG[code] || AUTH_MSG['bad-json'])[lang === 'en' ? 1 : 0] });

/* ================= http ================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };

/* diagnostics harness hook: importing this module with SADKO_NO_SERVE=1 gives a
   test script the adapters without binding the port */
export { ADAPTERS, searchStore, loadRegistry, isRelevant, fetchPage, jsonLdProducts, htmlHarvest, understandQuery, extractPrices };

/* How the push worker finds an order and its customer. In one place so the
   timer, the immediate push and the admin retry all load identically. */
/* Ecwid's copy of one customer's orders, cached briefly.

   SADKO sells by phone and in showrooms, and staff type those into Ecwid — so
   without this read a customer who rang 19140 opens their account, sees
   nothing, and concludes the order was lost. It is merged into the SAME
   /api/orders response the account and orders pages already use, so no client
   code needed to change.

   60 seconds: long enough that opening the account page and then the orders
   page is one API call, short enough that a status staff just changed shows up
   while the customer is still looking at it. */
/* The live taxonomy, shaped for the category resolver. Ecwid when it owns the
   catalogue, and the seed's own categories otherwise — so the resolver
   behaves the same with the flag off, where the ids already match and every
   resolution is the no-op 'id' tier. */
function liveCategoryList() {
  try {
    const st = ecwidStore();
    const rows = st ? st.allCategories() : [];
    if (rows.length) {
      return rows.filter(c => c && c.id != null && c.name)
                 .map(c => ({ id: String(c.id), name: c.name, nameEn: c.nameEn || null }));
    }
  } catch (e) {}
  return [];
}

/* One hand-built category page, used as the shell for a live category that has
   no file of its own. Read once: it is the same 34 lines every time, and
   rewriting a real page is what keeps the script list and stylesheet order
   identical to the other 30 (storefront.test.mjs asserts them). */
let CATEGORY_TEMPLATE = null;
async function categoryTemplate() {
  if (CATEGORY_TEMPLATE !== null) return CATEGORY_TEMPLATE;
  try {
    const dir = path.join(ROOT, 'category');
    const first = readdirSync(dir).filter(n => n.endsWith('.html')).sort()[0];
    CATEGORY_TEMPLATE = first ? await readFile(path.join(dir, first), 'utf8') : '';
  } catch (e) { CATEGORY_TEMPLATE = ''; }
  return CATEGORY_TEMPLATE;
}

/* One incremental pass: what changed in the catalogue, and what moved
   between ad folders.

   Shared by the timer and by the on-demand revalidator below, so the two can
   never drift into asking Ecwid different questions. Never throws, and never
   runs twice at once — a slow call must not pile up behind itself. */
let ECWID_POLL_INFLIGHT = null;
let ECWID_POLLED_AT = 0;

async function pollEcwid() {
  if (ECWID_POLL_INFLIGHT) return ECWID_POLL_INFLIGHT;
  ECWID_POLL_INFLIGHT = (async () => {
    try {
      const es = ecwidSync();
      const from = es.lastSyncedUnix();
      await es.syncProducts(from ? { updatedFrom: from } : {});
      /* Folder membership needs its own read: moving an advert between
         folders changes no product field, so updatedFrom would never report
         it and the advert would keep its old slot until the daily full sync. */
      await es.syncAdFolders();
      ecwidSource().invalidate();
    } catch (e) { /* recorded as last_error by the sync itself */ }
    ECWID_POLLED_AT = Date.now();
    ECWID_POLL_INFLIGHT = null;
  })();
  return ECWID_POLL_INFLIGHT;
}

/* Revalidate before answering, when the last poll is older than the interval.

   This is what makes "edit in Ecwid, reload the page, see it" true. Without
   it an admin has to wait out the timer, which is exactly the complaint that
   prompted this. Bounded by the same interval, so a busy page cannot turn
   into a request-per-visitor stampede against the API — and awaited, because
   answering with stale data and refreshing afterwards would still show the
   old banner on the reload the admin is actually looking at. */
async function ecwidFresh() {
  if (!ECWID_ON || !ECWID_TOKEN) return;
  if (ECWID_POLL_MS <= 0) return;
  if (Date.now() - ECWID_POLLED_AT < ECWID_POLL_MS) return;
  try { await pollEcwid(); } catch (e) {}
}

const REMOTE_ORDERS_TTL_MS = 60_000;
const REMOTE_ORDERS = new Map();          // email -> { at, orders }

async function remoteOrdersCached(email) {
  if (!email) return [];
  const key = String(email).toLowerCase();
  const hit = REMOTE_ORDERS.get(key);
  if (hit && Date.now() - hit.at < REMOTE_ORDERS_TTL_MS) return hit.orders;
  let orders = [];
  try { orders = await ecwidSync().remoteOrdersFor(key); } catch (e) { orders = []; }
  REMOTE_ORDERS.set(key, { at: Date.now(), orders });
  /* Entries are small and keyed per signed-in customer, but this process is
     long-lived, so expired ones are swept rather than kept forever. */
  if (REMOTE_ORDERS.size > 500) {
    const cutoff = Date.now() - REMOTE_ORDERS_TTL_MS;
    for (const [k, v] of REMOTE_ORDERS) if (v.at < cutoff) REMOTE_ORDERS.delete(k);
  }
  return orders;
}

const ORDER_LOADERS = {
  loadOrder: async ref => { const db = accounts(); return db ? db.orderByRefAny(ref) : null; },
  loadUser: async order => {
    const db = accounts();
    const u = db && order ? db.getUser(order.userId) : null;
    return u || { email: '', name: (order.delivery || {}).name || '', phone: (order.delivery || {}).phone || '' };
  },
};

/* Status flowing back from Ecwid: staff mark an order shipped there, the
   customer sees it here. An unmapped Ecwid status leaves the local status
   ALONE — inventing a transition would lie to the customer about their order. */
async function applyEcwidOrderEvent(ev) {
  const api = ecwidApi(), db = accounts();
  if (!api || !api.configured || !db) return;
  const remote = await api.getOrder(ev.entityId);
  if (!remote) return;
  /* Our own ref, from the dedicated field or from the comments it is also
     written into — see engine/ecwid-map.mjs toEcwidOrder(). */
  const ref = remote.externalOrderId ||
    (/(SDK-[A-Z0-9]{6})/.exec(String(remote.orderComments || '')) || [])[1];
  if (!ref) return;
  const status = toLocalStatus(remote);
  if (!status) return;
  const local = db.orderByRefAny(ref);
  if (!local || local.status === status) return;
  const r = db.setOrderStatus(ref, status);
  if (r && r.error) return console.error('[ecwid] status update rejected:', r.error);
  console.log(`[ecwid] order ${ref} -> ${status} (from Ecwid ${ev.entityId})`);
}

const HTTP_SERVER = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const secure = isSecure(req);
  applySecurityHeaders(res, secure);

  const json = (code, obj) => { res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    // The comparison endpoints are public data and stay open; anything that
    // touches an account must NOT be readable cross-origin, so no ACAO there.
    if (!u.pathname.startsWith('/api/auth') && u.pathname !== '/api/orders')
      res.setHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify(obj)); };

  /* Liveness/readiness for the host's health checks and for uptime pings. */
  if (u.pathname === '/healthz') {
    let acc = null;
    try { const db = accounts(); acc = db ? db.stats() : null; } catch (e) { acc = { error: true }; }
    return json(acc && !acc.error ? 200 : 503, {
      ok: !!(acc && !acc.error), uptimeSec: Math.round(process.uptime()),
      node: process.versions.node, accounts: acc,
      providers: enabledProviders().map(p => p.id),
    });
  }

  if (rateLimited(clientIp(req))) {
    res.statusCode = 429;
    res.setHeader('retry-after', '60');
    return json(429, { error: 'rate-limited', message: 'طلبات كثيرة جداً — انتظر دقيقة. / Too many requests — please wait a minute.' });
  }

  // State-changing requests must originate from this site.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req))
    return json(403, { error: 'bad-origin', message: 'طلب من مصدر غير معروف. / Request from an unrecognised origin.' });

  if (u.pathname === '/api/compare') {
    const q = (u.searchParams.get('q') || '').trim();
    const lang = u.searchParams.get('lang') === 'en' ? 'en' : 'ar';
    if (q.length < 2) return json(200, { error: lang === 'en' ? 'Type a product name first' : 'اكتب اسم الجهاز الأول' });
    try {
      return json(200, await compare(q, +u.searchParams.get('min') || 0,
        +u.searchParams.get('max') || 0, u.searchParams.get('discover') !== '0', lang,
        parseOverride(u.searchParams)));
    } catch (e) {
      return json(500, { error: lang === 'en' ? 'The engine hit a problem — try again' : 'المحرك وقع فى مشكلة — جرّب تانى',
        detail: String(e.message || e) });
    }
  }
  /* ---- funnel analytics (public writes, same-origin gated above) ----
     The storefront beacons a step of the buying journey here: view / save /
     add_to_cart / checkout_start. `purchase` is NOT accepted from the browser —
     it is written server-side when an order actually lands, so it cannot be
     faked. No personal data: an anonymous visitor id the browser generated. */
  if (u.pathname === '/api/track' && req.method === 'POST') {
    const an = analytics();
    if (!an) return json(200, { ok: false });
    try {
      const b = await readJson(req, 4000);
      const type = String(b.type || '');
      if (type === 'purchase' || !EVENT_TYPES.includes(type)) return json(400, { error: 'bad-type' });
      const me = currentUser(req);
      an.record({ vid: b.vid, userId: me ? me.id : null, productId: b.productId, type, meta: b.meta });
      return json(200, { ok: true });
    } catch (e) { return json(400, { error: 'bad-request' }); }
  }
  /* The 20-minute "still thinking about these?" prompt reports back here when a
     shopper says they will not continue, and (optionally) why. */
  if (u.pathname === '/api/abandon' && req.method === 'POST') {
    const an = analytics();
    if (!an) return json(200, { ok: false });
    try {
      const b = await readJson(req, 8000);
      const me = currentUser(req);
      an.recordAbandon({ vid: b.vid, userId: me ? me.id : null,
        reason: b.reason, note: b.note, value: b.value, items: Array.isArray(b.items) ? b.items.slice(0, 40) : [] });
      return json(200, { ok: true });
    } catch (e) { return json(400, { error: 'bad-request' }); }
  }

  if (u.pathname === '/api/stores' && req.method === 'GET')
    return json(200, await loadRegistry());
  if (u.pathname === '/api/stores' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    try {
      const { domain, name } = JSON.parse(body || '{}');
      const d = String(domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (!d.includes('.')) return json(400, { error: 'اكتب دومين صحيح (مثال: store.com.eg)' });
      const reg = await loadRegistry();
      if (reg.stores.some(s => s.domain === d)) return json(200, { ok: true, note: 'موجود بالفعل' });
      const store = await probeDomain(d);
      store.addedBy = 'manual'; if (name) store.name = name;
      reg.stores.push(store); await saveRegistry();
      return json(200, { ok: true, store });
    } catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  /* ---- admin control room ----
     Every route here demands a signed-in user whose email is in ADMIN_EMAILS.
     The check is server-side and identical for reads and writes; there is no
     "admin cookie" a browser could forge. Writes also pass the global same-origin
     gate above. All mutations are recorded in the catalog-admin audit log. */
  /* ---- Ecwid webhooks ----------------------------------------------------
     PUBLIC route. Answer 200 the moment the event is verified, then work
     asynchronously: Ecwid retries anything slow or non-200, and a retry storm
     is worse than a missed event — the 15-minute pull is the safety net.

     See engine/ecwid-webhook.mjs for why the signature does not cover storeId,
     and why this checks it explicitly. */
  if (u.pathname === '/api/ecwid/webhook' && req.method === 'POST') {
    const es = ecwidSync();
    if (!es) { res.statusCode = 503; return res.end('ecwid off'); }

    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000) { res.statusCode = 413; return res.end('too large'); }
      }
    } catch (e) { res.statusCode = 400; return res.end('bad body'); }

    const ev = parseWebhook(raw);
    if (!ev) { res.statusCode = 400; return res.end('bad event'); }

    if (!verifyWebhook({
      event: ev.event,
      signature: req.headers['x-ecwid-webhook-signature'],
      secret: process.env.SADKO_ECWID_WEBHOOK_SECRET || '',
    })) {
      console.warn(`[ecwid] webhook REJECTED (bad or missing signature) ${ev.eventType} ${ev.entityId}`);
      res.statusCode = 401; return res.end('bad signature');
    }

    /* The signature proves Ecwid sent it, not that it concerns our store. */
    if (ev.storeId && ev.storeId !== String(ECWID_STORE_ID)) {
      console.warn(`[ecwid] webhook ignored: store ${ev.storeId} is not ${ECWID_STORE_ID}`);
      res.statusCode = 202; return res.end('not this store');
    }

    res.statusCode = 200; res.end('ok');            // acknowledge, then work

    const done = () => ecwidSource().invalidate();
    if (/^product\./.test(ev.eventType)) {
      es.applyProductEvent(ev).then(done).catch(e => console.error('[ecwid] webhook product:', e.message));
    } else if (/^category\./.test(ev.eventType)) {
      es.syncCategories().then(done).catch(e => console.error('[ecwid] webhook category:', e.message));
    } else if (/^(profile|payment|shipping)\./.test(ev.eventType)) {
      es.syncSettings().then(done).catch(e => console.error('[ecwid] webhook settings:', e.message));
    } else if (/^order\./.test(ev.eventType)) {
      applyEcwidOrderEvent(ev).then(done).catch(e => console.error('[ecwid] webhook order:', e.message));
    } else {
      console.log(`[ecwid] webhook ignored, unhandled type: ${ev.eventType}`);
    }
    return;
  }

  if (u.pathname.startsWith('/api/admin/')) {
    const lang = u.searchParams.get('lang') === 'en' ? 'en' : 'ar';
    const db = accounts();
    const cadm = catalogAdmin();
    if (!db || !cadm) return json(503, { error: 'unavailable' });

    const me = currentUser(req);
    if (!me) return json(401, { error: 'no-user', message: lang === 'en' ? 'Sign in first.' : 'سجّل دخولك الأول.' });
    if (!isAdminUser(me)) return json(403, { error: 'not-admin', message: lang === 'en'
      ? 'This account is not an administrator.' : 'هذا الحساب ليس من المسؤولين.' });
    const actor = me.email;

    try {
      const rest = u.pathname.slice('/api/admin/'.length);   // e.g. "products", "products/adm-x"
      const seg = rest.split('/').filter(Boolean);

      /* who am I / can I */
      if (rest === 'me' && req.method === 'GET')
        return json(200, { admin: true, email: me.email, name: me.name,
          editableFields: EDITABLE_FIELDS, orderStatuses: ORDER_STATUSES });

      /* dashboard overview */
      if (rest === 'overview' && req.method === 'GET') {
        const base = await baseCatalog();
        const cat = cadm.stats();
        const an = analytics();
        return json(200, {
          accounts: db.adminOverview(),
          catalog: { base: base.length, live: (await mergedCatalog()).length,
                     edited: cat.overrides, custom: cat.custom, hidden: cat.hidden },
          funnel: an ? an.funnel() : null,
          abandonments: an ? an.stats().abandonments : 0,
          providers: enabledProviders().map(p => p.id),
          audit: cadm.audit(12),
        });
      }

      /* ------- products ------- */
      if (seg[0] === 'products' && seg.length === 1 && req.method === 'GET') {
        const base = await baseCatalog();
        const ov = cadm.overridesMap();
        const hidden = cadm.hiddenSet();
        const custom = cadm.customList();
        const q = (u.searchParams.get('q') || '').trim().toLowerCase();
        const cat = (u.searchParams.get('cat') || '').trim();
        const view = u.searchParams.get('view') || 'all';   // all | edited | hidden | custom
        const page = Math.max(1, +u.searchParams.get('page') || 1);
        const per = Math.min(100, Math.max(10, +u.searchParams.get('per') || 40));

        // build the admin list: base (with override applied + flags) then custom
        let rows = base.map(p => {
          const id = String(p.id);
          const patch = ov[id];
          const merged = patch ? Object.assign({}, p, patch) : p;
          return { ...merged, id, _edited: !!patch, _hidden: hidden.has(id), _custom: false };
        });
        rows = rows.concat(custom.map(c => ({ ...c, id: String(c.id), _edited: false, _hidden: hidden.has(String(c.id)), _custom: true })));

        if (view === 'edited') rows = rows.filter(r => r._edited);
        else if (view === 'hidden') rows = rows.filter(r => r._hidden);
        else if (view === 'custom') rows = rows.filter(r => r._custom);
        if (cat) rows = rows.filter(r => String(r.categoryId) === cat);
        if (q) rows = rows.filter(r => (String(r.title) + ' ' + String(r.id)).toLowerCase().includes(q));

        const total = rows.length;
        const an = analytics();
        const stat = an ? an.productStatsMap() : {};
        const slice = rows.slice((page - 1) * per, page * per).map(r => {
          const s = stat[String(r.id)] || {};
          return {
            id: r.id, title: r.title, price: r.price, image: r.image, categoryId: r.categoryId,
            _edited: r._edited, _hidden: r._hidden, _custom: r._custom,
            // funnel interest at a glance: unique people per stage
            stats: { views: s.view || 0, saves: s.save || 0, carts: s.add_to_cart || 0, purchases: s.purchase || 0 },
          };
        });
        return json(200, { total, page, per, pages: Math.ceil(total / per), products: slice });
      }

      if (seg[0] === 'products' && seg.length === 1 && req.method === 'POST') {
        /* A product added here would vanish on the next sync, because the
           mirror is what gets served. Refusing beats losing the work. */
        if (ecwidSource().activeSource() === 'ecwid') return json(409, {
          error: 'ecwid-owned',
          message: lang === 'en'
            ? 'Add products in Ecwid. The catalogue syncs from there, so a product added here would disappear on the next sync.'
            : 'أضف المنتجات في إكويد. الكتالوج يُزامن من هناك، وأي منتج يُضاف هنا سيختفي مع المزامنة التالية.',
        });
        const b = await readJson(req, 80000);
        const r = cadm.createProduct(b, actor);
        if (r.error) return json(400, { error: r.error, message: r.error === 'title-required'
          ? (lang === 'en' ? 'A product needs a title.' : 'المنتج لازم يكون له اسم.') : r.error });
        return json(200, r);
      }

      if (seg[0] === 'products' && seg[1] && seg.length === 2) {
        const id = decodeURIComponent(seg[1]);
        if (req.method === 'GET') {
          const base = await baseCatalog();
          const d = cadm.describe(base, id);
          if (!d) return json(404, { error: 'not-found' });
          return json(200, d);
        }
        if (req.method === 'PATCH' || req.method === 'PUT') {
          const b = await readJson(req, 80000);
          /* Ecwid owns these fields while it is the source. Naming the offending
             fields matters: "read-only" with no explanation is how someone ends
             up editing the same price twice and believing the site is broken. */
          if (ecwidSource().activeSource() === 'ecwid') {
            const touched = Object.keys(b || {}).filter(k => ECWID_OWNED_FIELDS.includes(k));
            if (touched.length) return json(409, {
              error: 'ecwid-owned',
              fields: touched,
              message: lang === 'en'
                ? `Edit these in Ecwid, not here: ${touched.join(', ')}. The catalogue syncs from Ecwid, so a local change would be overwritten.`
                : `عدّل هذه الحقول في إكويد لا هنا: ${touched.join('، ')}. الكتالوج يُزامن من إكويد، وأي تعديل محلي سيُستبدل.`,
            });
          }
          const isCustom = id.startsWith('adm-');
          if (isCustom) { const r = cadm.updateCustom(id, b, actor); if (r.error) return json(404, { error: r.error }); return json(200, r); }
          const merged = cadm.setOverride(id, b, actor);
          return json(200, { ok: true, override: merged });
        }
        if (req.method === 'DELETE') {
          const r = cadm.remove(id, actor);
          return json(200, { ok: true, ...r });
        }
      }

      // per-product actions: hide / show / revert
      if (seg[0] === 'products' && seg[2] && req.method === 'POST') {
        const id = decodeURIComponent(seg[1]);
        const action = seg[2];
        if (action === 'hide')   { cadm.hide(id, actor);   return json(200, { ok: true, hidden: true }); }
        if (action === 'show')   { cadm.unhide(id, actor); return json(200, { ok: true, hidden: false }); }
        if (action === 'revert') { cadm.revert(id, actor); return json(200, { ok: true, reverted: true }); }
      }

      /* ------- image upload (base64 data URL -> file under assets/img/uploads) ------- */
      if (rest === 'upload' && req.method === 'POST') {
        const b = await readJson(req, 6_000_000);            // ~6MB JSON => ~4MB image
        const m = /^data:(image\/(png|jpe?g|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
        if (!m) return json(400, { error: 'bad-image', message: lang === 'en' ? 'Send a PNG/JPG/WebP image.' : 'أرسل صورة PNG/JPG/WebP.' });
        const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
        const buf = Buffer.from(m[3], 'base64');
        if (buf.length > 4_500_000) return json(413, { error: 'too-large', message: lang === 'en' ? 'Image must be under 4MB.' : 'الصورة لازم تكون أقل من ٤ ميجا.' });
        const dir = path.join(ROOT, 'data', 'uploads');
        await mkdir(dir, { recursive: true });
        const name = 'p' + Date.now().toString(36) + randBytesHex(4) + '.' + ext;
        await writeFile(path.join(dir, name), buf);
        const url = 'data/uploads/' + name;
        cadm.log(actor, 'image.upload', name, { bytes: buf.length });
        return json(200, { ok: true, url });
      }

      /* ------- orders desk ------- */
      if (rest === 'orders' && req.method === 'GET')
        return json(200, { orders: db.allOrders(), statuses: ORDER_STATUSES });
      if (seg[0] === 'orders' && seg[2] === 'status' && req.method === 'POST') {
        const b = await readJson(req);
        const r = db.setOrderStatus(decodeURIComponent(seg[1]), b.status);
        if (r.error) return json(400, { error: r.error });
        cadm.log(actor, 'order.status', seg[1], { status: b.status });
        return json(200, r);
      }

      /* ------- customers ------- */
      if (rest === 'customers' && req.method === 'GET')
        return json(200, { customers: db.listUsersAdmin() });

      /* ------- content / config JSON files (guides, finder …) ------- */
      if (seg[0] === 'content' && seg[1] && seg.length === 2) {
        const name = seg[1].replace(/[^a-z0-9_-]/gi, '');
        if (!ADMIN_CONTENT[name]) return json(404, { error: 'unknown-content' });
        const file = path.join(ROOT, 'data', ADMIN_CONTENT[name].file);
        if (req.method === 'GET') {
          const txt = existsSync(file) ? await readFile(file, 'utf8') : '{}';
          return json(200, { name, label: ADMIN_CONTENT[name].label, json: txt });
        }
        if (req.method === 'PUT') {
          const b = await readJson(req, 2_000_000);
          let parsed; try { parsed = JSON.parse(b.json); } catch { return json(400, { error: 'bad-json', message: lang === 'en' ? 'That is not valid JSON.' : 'هذا JSON غير صحيح.' }); }
          await writeFile(file, JSON.stringify(parsed, null, 2));
          cadm.log(actor, 'content.save', name, null);
          return json(200, { ok: true });
        }
      }

      /* ------- site settings ------- */
      if (rest === 'settings' && req.method === 'GET')
        return json(200, { settings: cadm.settings() });
      if (rest === 'settings' && req.method === 'PUT') {
        const b = await readJson(req, 200000);
        const patch = (b && typeof b.settings === 'object') ? b.settings : {};
        for (const [k, v] of Object.entries(patch)) cadm.setSetting(k, v, actor);
        return json(200, { ok: true, settings: cadm.settings() });
      }

      /* ------- funnel analytics ------- */
      if (rest === 'analytics' && req.method === 'GET') {
        const an = analytics();
        if (!an) return json(200, { available: false });
        const base = await baseCatalog();
        const titleOf = id => { const p = cadm.describe(base, id); return p && p.product ? p.product.title : null; };
        const decorate = rows => rows.map(r => ({ id: r.id, people: r.people, title: titleOf(r.id) }));
        return json(200, {
          available: true,
          stages: FUNNEL_STAGES,
          funnel: an.funnel(),
          topViewed: decorate(an.topProducts('view', 10)),
          topSaved: decorate(an.topProducts('save', 10)),
          topCarted: decorate(an.topProducts('add_to_cart', 10)),
          topPurchased: decorate(an.topProducts('purchase', 10)),
          abandonReasons: an.abandonReasons(),
          abandons: an.abandonList(40).map(a => Object.assign(a, {
            items: (a.items || []).map(i => ({ id: i.id, title: i.title || titleOf(i.id) || i.id, qty: i.qty, price: i.price })),
          })),
          stats: an.stats(),
        });
      }
      // per-product funnel, used by the product editor / list drill-down
      if (seg[0] === 'analytics' && seg[1] === 'product' && seg[2] && req.method === 'GET') {
        const an = analytics();
        return json(200, { funnel: an ? an.productFunnel(decodeURIComponent(seg[2])) : [] });
      }

      /* ------- Ecwid connection and sync -------
         Reports counts, the last sync and the last error. describe() is the
         only surface that is guaranteed token-free, so everything goes through
         it rather than reading the environment here. */
      if (rest === 'ecwid' && req.method === 'GET') {
        const store = ecwidStore();
        const cats = store ? store.allCategories() : [];
        const rails = resolveRailCategories(cats, {
          offers: process.env.SADKO_ECWID_OFFERS_CATEGORY || null,
          bestSellers: process.env.SADKO_ECWID_BESTSELLERS_CATEGORY || null,
        });
        let banners = 0, bannerList = [];
        try { bannerList = await ecwidSource().banners(); banners = bannerList.length; } catch (e) {}
        /* The advertisement folders, per slot, with anything that cannot
           render NAMED. deriveBanners drops a banner with no artwork or no
           headline, correctly and silently — so the owner drops three images
           in a folder, two appear, and nothing says why. This is where that
           gets answered, alongside "which folder am I even reading". */
        let ads = null;
        try {
          const st = ecwidSync().adFolderState();
          ads = {
            folders: st.folders,
            bySlot: adCounts(bannerList, st.map),
            issues: adIssues(bannerList, st.map),
            conflicts: st.conflicts,
            failed: st.failed,
            lastRead: st.at,
          };
        } catch (e) { ads = null; }
        return json(200, {
          ecwid: ecwidSource().describe(),
          storeId: ECWID_STORE_ID,
          ownedFields: ECWID_OWNED_FIELDS,
          ads,
          /* Which curated categories the rails resolved to, by Arabic name.
             Shown because a rail silently resolving to nothing is otherwise
             invisible until someone notices an empty row on the shop page. */
          rails: {
            offers: rails.offers,
            bestSellers: rails.bestSellers,
            offersName: (cats.find(c => String(c.id) === rails.offers) || {}).name || null,
            bestSellersName: (cats.find(c => String(c.id) === rails.bestSellers) || {}).name || null,
          },
          banners,
          /* Order push is Task 12; until it exists the panel says so rather
             than showing a permanently empty queue. */
          pendingPushes: store ? store.pendingPushes() : [],
          failedPushes: store ? store.failedPushes() : [],
        });
      }

      /* Retry one parked order push. The order itself was never lost — this
         only re-attempts handing it to Ecwid. */
      if (seg[0] === 'ecwid' && seg[1] === 'push' && seg[2] && req.method === 'POST') {
        const esy = ecwidSync(), est = ecwidStore();
        if (!esy || !est) return json(503, { error: 'ecwid-off' });
        const ref = decodeURIComponent(seg[2]);
        est.resetPush(ref);                       // make it due now
        const r = await esy.pushOrder(ref, ORDER_LOADERS);
        cadm.log(actor, 'ecwid.push', ref, r);
        return json(r.ok ? 200 : 400, r);
      }

      if (seg[0] === 'ecwid' && seg[1] === 'sync' && req.method === 'POST') {
        const es = ecwidSync();
        if (!es) return json(503, { error: 'ecwid-off', message: lang === 'en'
          ? 'Ecwid is not connected. Check the token in /etc/sadko.env.'
          : 'إكويد غير متصل. تحقّق من المفتاح في /etc/sadko.env.' });
        const r = await es.syncAll();
        ecwidSource().invalidate();
        cadm.log(actor, 'ecwid.sync', null, r);
        return json(200, { ok: true, ...r, ecwid: ecwidSource().describe() });
      }

      /* ------- audit log ------- */
      if (rest === 'audit' && req.method === 'GET')
        return json(200, { audit: cadm.audit(+u.searchParams.get('limit') || 100) });

      return json(404, { error: 'not-found' });
    } catch (e) {
      const code = (e && e.message === 'too-large') ? 'too-large' : 'bad-request';
      return json(400, { error: code, message: String(e && e.message || e) });
    }
  }

  /* ---- accounts ---- */
  if (u.pathname.startsWith('/api/auth/') || u.pathname === '/api/orders') {
    const lang = u.searchParams.get('lang') === 'en' ? 'en' : 'ar';
    const db = accounts();
    if (!db) return json(503, authErr('unavailable', lang));
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

    try {
      if (u.pathname === '/api/auth/me' && req.method === 'GET') {
        const me = currentUser(req);
        // tell the account page whether to surface the "control room" link
        return json(200, { user: me ? Object.assign({}, me, { isAdmin: isAdminUser(me) }) : null });
      }

      /* Which social buttons this deployment can actually show. With no
         *_CLIENT_ID configured this returns [], and the UI says so rather
         than rendering a button that cannot work. */
      if (u.pathname === '/api/auth/config' && req.method === 'GET')
        return json(200, { providers: enabledProviders(), passwordAuth: true });

      /* Social sign-in. The browser sends the provider's ID token; it is only
         trusted after engine/oidc.mjs checks signature, issuer, audience and
         expiry against the provider's published keys. */
      if (u.pathname === '/api/auth/oauth' && req.method === 'POST') {
        const b = await readJson(req);
        const v = await verifyIdToken(String(b.provider || ''), String(b.credential || ''), { nonce: b.nonce || null });
        if (!v.ok) {
          console.warn('[auth] oauth rejected:', v.error);
          return json(401, { error: v.error, message: lang === 'en'
            ? 'We could not verify that sign-in. Please try again.'
            : 'مقدرناش نتأكد من تسجيل الدخول ده. جرّب تانى.' });
        }
        const r = db.signInWithIdentity(v.identity);
        if (r.error === 'email-unverified') return json(409, { error: r.error, message: lang === 'en'
          ? 'That email already has a SADKO account, and your provider has not verified the address. Sign in with your password instead.'
          : 'لهذا البريد الإلكترونى حساب فى صادكو بالفعل، ولم يؤكد مزوّد الخدمة ملكيتك له. سجّل دخولك بكلمة المرور.' });
        if (r.error) return json(400, authErr(r.error, lang));
        setSessionCookie(res, req, r.session.raw, r.session.expires);
        return json(200, { ok: true, user: r.user, created: r.created });
      }

      if (u.pathname === '/api/auth/register' && req.method === 'POST') {
        const b = await readJson(req);
        const r = db.register(b);
        if (r.error) return json(400, authErr(r.error, lang));
        setSessionCookie(res, req, r.session.raw, r.session.expires);
        /* Give Ecwid the customer record now, not at the first order, so staff
           can find the person the moment they ring in — and so their history
           builds in the one place staff already work.

           Deliberately NOT awaited, and its failure is ignored: signing up
           must not be slowed by an Ecwid round trip, nor fail because Ecwid is
           unreachable or (as on the test store's public_ token) refuses the
           write. The push path links the customer anyway, since Ecwid files an
           order under the email it carries. */
        try { ecwidSync().linkCustomer(r.user).catch(() => {}); } catch (e) {}
        return json(200, { ok: true, user: r.user });
      }

      if (u.pathname === '/api/auth/login' && req.method === 'POST') {
        const b = await readJson(req);
        const r = db.login({ email: b.email, password: b.password, ip });
        if (r.error) return json(r.error === 'too-many' ? 429 : 401, authErr(r.error, lang));
        setSessionCookie(res, req, r.session.raw, r.session.expires);
        return json(200, { ok: true, user: r.user });
      }

      if (u.pathname === '/api/auth/logout' && req.method === 'POST') {
        db.logout(readCookie(req, SESSION_COOKIE));
        clearSessionCookie(res, req);
        return json(200, { ok: true });
      }

      // Everything below needs a signed-in user.
      const me = currentUser(req);
      if (!me) return json(401, authErr('no-user', lang));

      if (u.pathname === '/api/auth/profile' && (req.method === 'POST' || req.method === 'PATCH')) {
        const b = await readJson(req);
        const r = db.updateProfile(me.id, b);
        if (r.error) return json(400, authErr(r.error, lang));
        return json(200, { ok: true, user: r.user });
      }

      if (u.pathname === '/api/auth/password' && req.method === 'POST') {
        const b = await readJson(req);
        const r = db.changePassword(me.id, b.current, b.next);
        if (r.error) return json(400, authErr(r.error, lang));
        clearSessionCookie(res, req);      // every device is signed out, including this one
        return json(200, { ok: true, signedOut: true });
      }

      /* ---- house / room profiles ---- */
      if (u.pathname === '/api/auth/homes' && req.method === 'GET')
        return json(200, { homes: db.listHomes(me.id) });

      if (u.pathname === '/api/auth/homes' && req.method === 'POST') {
        const b = await readJson(req);
        const r = db.addHome(me.id, b);
        if (r.error) return json(400, r.error === 'too-many-homes'
          ? { error: r.error, message: lang === 'en' ? 'You can keep up to 8 places.' : 'يمكنك الاحتفاظ بثمانية أماكن كحد أقصى.' }
          : authErr(r.error, lang));
        return json(200, { ok: true, home: r.home, user: r.user });
      }
      if (u.pathname === '/api/auth/homes' && (req.method === 'PATCH' || req.method === 'PUT')) {
        const b = await readJson(req);
        const r = db.updateHome(me.id, String(b.id || ''), b.patch || b);
        if (r.error) return json(400, authErr(r.error, lang));
        return json(200, { ok: true, home: r.home, user: r.user });
      }
      if (u.pathname === '/api/auth/homes' && req.method === 'DELETE') {
        const b = await readJson(req);
        const r = db.removeHome(me.id, String(b.id || ''));
        if (r.error) return json(400, authErr(r.error, lang));
        return json(200, { ok: true, user: r.user });
      }
      if (u.pathname === '/api/auth/homes/active' && req.method === 'POST') {
        const b = await readJson(req);
        const r = db.setActiveHome(me.id, b.id ? String(b.id) : null);
        if (r.error) return json(400, authErr(r.error, lang));
        return json(200, { ok: true, user: r.user });
      }

      /* ---- the customer's own data ----
         The privacy page promises people can get a copy and can have the
         account erased. These make that self-serve rather than an email
         someone has to action by hand. */
      if (u.pathname === '/api/auth/export' && req.method === 'GET') {
        const data = db.exportUser(me.id);
        res.setHeader('content-disposition', 'attachment; filename="sadko-my-data.json"');
        return json(200, data || {});
      }
      if (u.pathname === '/api/auth/delete' && req.method === 'POST') {
        const b = await readJson(req);
        // Deliberately destructive, so require the account's own email typed back.
        if (String(b.confirmEmail || '').trim().toLowerCase() !== me.email)
          return json(400, { error: 'confirm-mismatch', message: lang === 'en'
            ? 'Type your account email exactly to confirm deletion.'
            : 'اكتب بريد حسابك الإلكترونى بالضبط لتأكيد الحذف.' });
        const r = db.deleteUser(me.id);
        if (r.error) return json(400, authErr(r.error, lang));
        clearSessionCookie(res, req);
        return json(200, { ok: true });
      }

      if (u.pathname === '/api/orders' && req.method === 'GET') {
        /* Merged with what Ecwid holds for this customer, so an order staff
           typed in — a phone sale, a showroom sale — appears in the
           customer's own list rather than seeming to have been lost.

           The local orders are returned regardless: remoteOrdersCached never
           throws and yields [] when Ecwid is off, unreachable, or (as with the
           test store's public_ token) not readable at all. mergeOrders keys on
           our own SDK- reference, so an order placed here and mirrored back
           appears once. */
        const local = db.ordersFor(me.id);
        const remote = await remoteOrdersCached(me.email);
        return json(200, {
          orders: remote.length ? mergeOrders(local, remote) : local,
          ecwidLinked: remote.length > 0,
        });
      }

      if (u.pathname === '/api/orders' && req.method === 'POST') {
        const b = await readJson(req);
        /* Validated against the LIVE list, so an Ecwid instalment plan is a
           valid choice and a method the owner has retired is not. */
        const allowed = activePaymentMethods().map(m => m.id);
        if (b.payment && !allowed.includes(b.payment))
          return json(400, { error: 'bad-payment', message: lang === 'en'
            ? 'Unsupported payment method.' : 'طريقة دفع غير مدعومة.' });
        const r = db.createOrder(me.id, b);
        if (r.error) return json(400, authErr(r.error, lang));
        // Close the funnel: record a purchase event per line item, server-side so
        // it is authoritative (the browser cannot fabricate a purchase).
        try { const an = analytics(); if (an) an.recordPurchase({ vid: b.vid, userId: me.id, items: r.order.items }); } catch (e) {}

        /* Hand the order to Ecwid so staff fulfil it from the desk they know.
           Deliberately NOT awaited: the customer's receipt already exists, and
           an Ecwid outage must never block a sale or delay the response. The
           queue and its timer own delivery from here. */
        try {
          const est = ecwidStore(), esy = ecwidSync();
          if (est && esy) {
            est.enqueueOrderPush(r.order.ref);
            esy.pushOrder(r.order.ref, ORDER_LOADERS)
              .catch(e => console.error('[ecwid] immediate push failed, queued for retry:', e.message));
          }
        } catch (e) { console.error('[ecwid] could not queue order push:', e.message); }
        return json(200, { ok: true, order: r.order });
      }
      return json(404, { error: 'not-found' });
    } catch (e) {
      const code = (e && e.message === 'too-large') ? 'too-large' : 'bad-json';
      return json(400, authErr(code, lang));
    }
  }

  /* The storefront reads the catalogue from this exact URL. Serve the MERGED
     view (scraped base + the owner's overlay) so every edit the owner makes in
     the control room is reflected across shop, category, finder and product
     pages with no change to any of those pages. */
  /* The shop reads its rails from this URL. With Ecwid on, serve DERIVED rails
     so a product removed in Ecwid can never leave a dangling curated id; with
     Ecwid off, fall through to the static file, which is still correct for the
     seed catalogue it was captured against. */
  /* Checkout needs the payment methods before a customer has an account, so
     this is public — it is shop configuration, not customer data. */
  /* ---- one product, in full -------------------------------------------
     The product page used to link OUT to Ecwid's own page. It renders the
     product itself now, and needs the rich description that
     /data/products.json deliberately withholds — see listShape() in
     ecwid-source.mjs for why the list stays lean.

     404 rather than an empty object for anything the storefront does not
     serve (disabled, incomplete, a banner entry, unknown), so the page shows
     its "not found" state instead of a blank PDP. With the Ecwid flag off
     there is no mirror, so this 404s and the page falls back to the list
     entry it already has — which is exactly the pre-Ecwid behaviour. */
  if (u.pathname.startsWith('/api/product/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeURIComponent(u.pathname.slice('/api/product/'.length));
    let p = null;
    try { p = ecwidSource().productDetail(id); } catch (e) { p = null; }
    if (!p) return json(404, { error: 'not_found', id });
    res.setHeader('cache-control', 'no-cache');
    return json(200, { source: 'ecwid', product: p });
  }

  /* ---- delivery, and why it still has no total -------------------------
     Ecwid's calculator DOES return a figure, and it is the wrong one: no
     method in this store has a destination zone, so the Greater Cairo rate of
     250 comes back for Aswan and Marsa Matrouh too. This serves what the
     store genuinely states about delivery, plus quotable:false and the
     reasons — see engine/ecwid-shipping.mjs for the full evidence. */
  if (u.pathname === '/api/shipping-methods' && (req.method === 'GET' || req.method === 'HEAD')) {
    let methods = [], counts = {};
    try {
      const st = ecwidStore();
      methods = st ? st.allShippingMethods() : [];
      const stats = st ? st.stats() : null;
      counts = { productCount: (stats && stats.products) || 0,
                 productsWithWeight: (stats && stats.withWeight) || 0 };
    } catch (e) { methods = []; }
    return json(200, toStorefrontShipping(methods, counts));
  }

  if (u.pathname === '/api/payment-methods' && (req.method === 'GET' || req.method === 'HEAD')) {
    const methods = activePaymentMethods();
    return json(200, {
      source: methods === FALLBACK_METHODS ? 'builtin' : 'ecwid',
      note: 'All methods are offline: nothing here takes a card number. Two of the ' +
            'Ecwid methods are restricted to the products of a single manufacturer, ' +
            'flagged as restricted with the brand named, because Ecwid cannot ' +
            'enforce a product restriction on a manual payment method itself.',
      methods,
    });
  }

  /* Category names, so the client can label a category Ecwid knows about but
     the hardcoded map does not. Arabic only: Ecwid holds no usable English for
     this store, so the curated bilingual names still win where they exist. */
  if (u.pathname === '/data/categories.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    const store = ecwidStore();
    if (store && ecwidSource().activeSource() === 'ecwid') {
      try {
        const cats = store.allCategories()
          .filter(c => c.enabled !== false && c.name)
          .map(c => ({ id: c.id, name: c.name, nameEn: c.nameEn, parentId: c.parentId,
                       order: c.order, count: c.productCount }));
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        return res.end(JSON.stringify({ source: 'ecwid', categories: cats }));
      } catch (e) { /* fall through */ }
    }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ source: 'none', categories: [] }));
  }

  if (u.pathname === '/data/collections.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (ecwidSource().activeSource() === 'ecwid') {
      try {
        const store = ecwidStore();
        const collections = deriveRails(await mergedCatalog(), {
          categories: store ? store.allCategories() : [],
          offersCategoryId: process.env.SADKO_ECWID_OFFERS_CATEGORY || null,
          bestSellersCategoryId: process.env.SADKO_ECWID_BESTSELLERS_CATEGORY || null,
        });
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        return res.end(JSON.stringify({
          note: 'Derived live from the Ecwid store. offers and bestSellers are membership of ' +
                'the curated categories, resolved by Arabic name because the stores use ' +
                'different ids. featured is products with a real compareToPrice above the ' +
                'price that are NOT already in offers, so the two rails cannot duplicate ' +
                'each other. A rail with no qualifying products is omitted, never padded.',
          source: 'ecwid',
          derivedAt: new Date().toISOString(),
          collections,
        }));
      } catch (e) { /* fall through to the static file */ }
    }
  }

  /* Advertisement banners. Ecwid has no banner entity, so an ad is an ordinary
     product in a disabled category: either one of the per-slot AD FOLDERS
     (SADKO_ECWID_ADS_HERO / _WIDE / _SQUARE) or the older single banner
     category (SADKO_ECWID_BANNER_CATEGORY).

     MERGED PER SLOT, not wholesale. This route used to return Ecwid's banners
     and discard promos.json entirely, which meant configuring only the square
     folder emptied the hero strap at the top of the shop page — both local
     hero banners went with it. A slot Ecwid has ads for is Ecwid's; every
     other slot keeps its local entries and their bilingual copy, which matters
     because a derived banner carries no English at all. That is what makes a
     staged rollout possible: take over the squares, leave hero and wide alone,
     come back for them later. */
  if (u.pathname === '/data/promos.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* Pick up an advert the owner changed moments ago, rather than making
       them wait for the next poll. */
    await ecwidFresh();
    /* Either source is enough to run. Gating on the legacy banner category
       alone meant a store using only ad folders never reached this at all. */
    if (ecwidSource().activeSource() === 'ecwid' &&
        (ECWID_BANNER_CATEGORY || Object.keys(ECWID_AD_FOLDERS).length)) {
      try {
        /* The banner category is passed so a banner's own category is never
           offered as its destination. */
        const derived = deriveBanners(await ecwidSource().banners(), {
          bannerCategoryId: ECWID_BANNER_CATEGORY,
          /* The folder wins over the SKU, so moving an ad between folders
             changes its slot even if its SKU still says otherwise. */
          slotOf: p => ecwidSource().adSlotOf(p),
          /* And where it points, which a category alone cannot express: two
             of the three square tiles this replaces go to contact.html and
             delivery.html. */
          destOf: p => ecwidSource().adDestinationOf(p),
          /* The ad folders are containers, never destinations: an advert with
             no destination of its own must not fall back to "the page for the
             disabled folder it lives in". */
          adFolderIds: Object.values(ECWID_AD_FOLDERS),
        });
        if (derived.length) {
          /* The local file is the fallback PER SLOT. A read failure leaves it
             null, which mergePromos treats as "no local entries" rather than
             throwing — so a missing promos.json degrades to Ecwid-only
             instead of to no banners. */
          let local = null;
          try {
            local = JSON.parse(await readFile(path.join(ROOT, 'data', 'promos.json'), 'utf8')).promos;
          } catch (e) { local = null; }
          const merged = mergePromos(derived, local);
          const promos = merged.promos;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-cache');
          return res.end(JSON.stringify({
            note: 'Derived from Ecwid category ' + ECWID_BANNER_CATEGORY + '. Each entry is a ' +
                  'BANNER, not a product: image = artwork, name = headline, description = ' +
                  'subtitle. The SLOT is the ad folder the entry sits in ' +
                  '(SADKO_ECWID_ADS_HERO / _WIDE / _SQUARE), falling back to a banner- SKU. ' +
                  'Slots with no Ecwid ads keep their promos.json entries — see slotsFromLocal. ' +
                  'The CLICK-THROUGH is the ordinary category the ' +
                  'banner entry is also assigned to (its page on THIS site), or the shop when ' +
                  'it has none — never the Ecwid product URL, which would send the shopper to ' +
                  'another storefront. These entries are ' +
                  'excluded from the catalogue, search and rails. No English fields: Ecwid ' +
                  'holds no usable translations, and copying Arabic into an English field ' +
                  'would be worse than omitting it.',
            source: merged.fromLocal.length ? 'ecwid+local' : 'ecwid',
            /* Which slots each source supplied, so "my hero banner is still
               the old one" has an answer in the payload rather than needing a
               guess. */
            slotsFromEcwid: merged.fromEcwid,
            slotsFromLocal: merged.fromLocal,
            adFolders: ECWID_AD_FOLDERS,
            derivedAt: new Date().toISOString(),
            promos,
          }));
        }
      } catch (e) { /* fall through to the static file */ }
    }
  }

  if (u.pathname === '/data/products.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* Same freshness contract as the adverts: a price or stock change staff
       made a moment ago should be on the next page load. */
    await ecwidFresh();
    try {
      const list = await mergedCatalog();
      const src = ecwidSource();
      const from = src.activeSource();
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      /* `scrapedAt` kept for backwards compatibility with anything reading it,
         but it must not claim a scrape date when the data came from Ecwid — so
         it reports the sync time in that case, and `source` says which. */
      const sync = from === 'ecwid' ? src.describe().lastSync : null;
      return res.end(JSON.stringify({
        source: from,
        scrapedAt: sync && sync.at ? sync.at : _baseCat.mtime,
        syncedAt: sync && sync.at ? sync.at : null,
        count: list.length,
        products: list,
      }));
    } catch (e) { /* fall through to static */ }
  }

  /* ---- category pages, against whichever store is actually connected ----

     The 30 pages in site/category/ and the Shop dropdown in nav.js are both
     keyed to PRODUCTION category ids. The test store shares none of them, so
     picking "تليفزيونات" from the menu loaded category/38022381.html, found
     no product in category 38022381, and rendered "no products in this
     section" — the page existed and was empty. Separately, any link built
     from a LIVE id (appshell's catHref does exactly that) asked for
     category/206642016.html and got a plain 404.

     Both are fixed on the way out, using the only thing the two stores share:
     the category NAME, which every static page already carries in
     data-cat-name. See engine/category-alias.mjs for the name-matching tiers
     and why an ambiguous match deliberately resolves to nothing.

     In production, where the ids already agree, resolveCategory returns the
     same id by the 'id' tier and the file is served untouched. */
  if (/^\/category\/[^/]+\.html$/.test(u.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
    const wantedId = decodeURIComponent(u.pathname.slice('/category/'.length, -'.html'.length));
    const file = path.join(ROOT, 'category', wantedId + '.html');
    const inRoot = file.startsWith(path.join(ROOT, 'category'));

    try {
      /* The live taxonomy and the per-category product counts, both from
         whatever source is actually serving the catalogue. */
      let live = [], counts = {};
      try {
        const list = await mergedCatalog();
        for (const pr of list) {
          for (const cid of (Array.isArray(pr.categoryIds) && pr.categoryIds.length
                              ? pr.categoryIds : [pr.categoryId])) {
            if (cid != null) counts[String(cid)] = (counts[String(cid)] || 0) + 1;
          }
        }
        live = liveCategoryList();
      } catch (e) { live = []; }

      if (inRoot && existsSync(file) && statSync(file).isFile()) {
        const html = await readFile(file, 'utf8');
        /* The page's own name is the key. Read from the file rather than from
           a table here, so a page whose name is edited keeps working. */
        const nm = /data-cat-name="([^"]*)"/.exec(html);
        const hit = live.length ? resolveCategory(wantedId, nm ? nm[1] : '', live, counts) : null;
        res.setHeader('content-type', MIME['.html']);
        res.setHeader('cache-control', 'no-cache');
        /* Only rewrite when the resolution actually moves the id — otherwise
           the file goes out exactly as it is on disk. */
        return res.end(hit && hit.id !== wantedId ? repointCategoryPage(html, hit.id) : html);
      }

      /* No file for this id. If it is a real live category, build its page
         from one of the hand-built shells so the asset list stays identical. */
      const cat = live.find(c => String(c.id) === String(wantedId));
      if (cat) {
        const tpl = await categoryTemplate();
        const out = tpl && retargetCategoryPage(tpl, { id: cat.id, name: cat.name, nameEn: cat.nameEn });
        if (out) {
          res.setHeader('content-type', MIME['.html']);
          res.setHeader('cache-control', 'no-cache');
          return res.end(out);
        }
      }
    } catch (e) { /* fall through to the static handler, which will 404 */ }
  }

  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  createReadStream(f).pipe(res);
});

/* Hosts stop a container by sending SIGTERM and then killing it. Close the
   listener, let in-flight requests finish, and check the databases point
   cleanly so a redeploy never leaves a half-written WAL behind. */
let SERVER = null;
function shutdown(signal) {
  console.log(`[server] ${signal} — shutting down`);
  const done = () => {
    try { ACCOUNTS && ACCOUNTS.close && ACCOUNTS.close(); } catch (e) {}
    try { CATALOG_ADMIN && CATALOG_ADMIN.close && CATALOG_ADMIN.close(); } catch (e) {}
    try { ANALYTICS && ANALYTICS.close && ANALYTICS.close(); } catch (e) {}
    try { ECWID_STORE && ECWID_STORE.close && ECWID_STORE.close(); } catch (e) {}
    process.exit(0);
  };
  try { SERVER.close(done); } catch (e) { done(); }
  setTimeout(done, 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => console.error('[server] unhandled rejection:', e && e.message || e));

if (!process.env.SADKO_NO_SERVE)
SERVER = HTTP_SERVER.listen(PORT, () => {
  console.log(`SADKO self-owned comparer engine on http://localhost:${PORT}`);
  console.log(NVIDIA_KEY
    ? `AI layer ON — ${AI_MODEL}`
    : 'AI layer off (set NVIDIA_API_KEY to enable Nemotron query understanding + offer audit)');
  // Pre-warm headless Chrome so the FIRST real search isn't paying cold-start.
  if (headlessAvailable()) {
    renderPage('about:blank', { waitMs: 300 })
      .then(() => console.log('headless Chrome pre-warmed'))
      .catch(() => console.log('headless pre-warm skipped'));
  }

  /* Ecwid: catch up now, then incremental every 15 minutes and a full
     reconcile daily. The reconcile is the only path that finds DELETIONS,
     because updatedFrom cannot report them.

     Every call is invalidate-then-serve: the source caches the built
     catalogue, so it must be told when the mirror changed. */
  const es = ecwidSync();
  if (es) {
    console.log(`Ecwid sync ON — store ${ECWID_STORE_ID}` +
      (ECWID_BANNER_CATEGORY ? `, banners from category ${ECWID_BANNER_CATEGORY}` : ', no banner category set'));
    /* Named at boot so a misconfigured folder is visible in the log rather
       than only as "my adverts did not appear". */
    {
      const fold = Object.entries(ECWID_AD_FOLDERS);
      console.log(fold.length
        ? '[ecwid] ad folders: ' + fold.map(([sl, id]) => sl + '=' + id).join(', ')
        : '[ecwid] no ad folders configured — banners fall back to the banner- SKU convention');
    }
    const after = r => { ecwidSource().invalidate(); return r; };

    es.syncAll().then(async r => {
      after(r);
      console.log(`[ecwid] first sync: ${r.products} products, ${r.categories} categories, ` +
        `${r.payment} payment, ${r.shipping} shipping, ${r.removed} removed` +
        (r.ads != null ? `, ${r.ads} ads` : ''));
      /* Per slot, plus anything that cannot render, because "3 ads" does not
         answer "why is the square row still the old artwork". */
      try {
        const st = es.adFolderState();
        if (Object.keys(st.folders).length) {
          const ads = (await ecwidSource().banners());
          const counts = adCounts(ads, st.map);
          console.log('[ecwid] ads by slot: ' +
            Object.entries(counts).filter(([k]) => k !== 'none').map(([k, v]) => k + '=' + v).join(', '));
          const bad = adIssues(ads, st.map);
          for (const b of bad) console.warn('[ecwid] ad ' + b.id + ' (' + b.slot + ') cannot render: ' + b.reasons.join(', '));
          for (const c of st.conflicts) console.warn('[ecwid] ad ' + c.id + ' is in two folders — using ' + c.kept + ', ignoring ' + c.also);
          for (const x of st.failed) console.warn('[ecwid] ad folder ' + x.slot + ' (' + x.id + ') could not be read: ' + x.error);
        }
      } catch (e) {}
    }).catch(e => console.error('[ecwid] first sync failed:', e.message));

    if (ECWID_POLL_MS > 0) {
      console.log(`[ecwid] polling every ${Math.round(ECWID_POLL_MS / 1000)}s` +
        /* Read from the environment, not a bare constant: no such binding
           exists, and referencing one would throw at startup — the same shape
           as the ORDER_LOADERS crash, which `node --check` cannot see. */
        (process.env.SADKO_ECWID_WEBHOOK_SECRET ? ' (webhooks also enabled)'
                                                : ' — set a webhook secret for instant updates'));
      setInterval(() => {
        pollEcwid().catch(() => {});
      }, ECWID_POLL_MS).unref();
    } else {
      console.log('[ecwid] polling disabled (SADKO_ECWID_POLL_SECONDS=0) — relying on webhooks');
    }

    setInterval(() => {
      es.syncAll().then(after).catch(() => {});
    }, 24 * 60 * 60 * 1000).unref();

    /* Parked and pending order pushes, retried every 2 minutes. */
    setInterval(() => {
      es.pushPendingOrders(ORDER_LOADERS).catch(() => {});
    }, 2 * 60 * 1000).unref();
  } else if (ECWID_ON) {
    console.log('Ecwid flag is on but no token is configured — serving the seed catalogue');
  }
});
