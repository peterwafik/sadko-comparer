// Build rebranded category pages from the scraped catalog.
// Inputs : extraction/catalog.json, extraction/site-graph.json, extraction/products-enriched.json
// Output : site/category/<id>.html (one per category) + site/data/products.json
import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync('extraction/catalog.json', 'utf8'));
const graph   = JSON.parse(fs.readFileSync('extraction/site-graph.json', 'utf8'));
const enriched = JSON.parse(fs.readFileSync('extraction/products-enriched.json', 'utf8'));

// ---- taxonomy: id -> {name, en, children[], parent} ----
const nodes = new Map();
for (const c of catalog.categories) nodes.set(c.id, { id: c.id, name: c.name, en: '', children: [], parent: null });
for (const t of graph.catalogTaxonomy.tree) {
  const n = nodes.get(t.id); if (n) { n.en = t.en || ''; }
  for (const ch of (t.children || [])) {
    const c = nodes.get(ch.id);
    if (c) { c.en = ch.en || ''; c.parent = t.id; }
    if (n) n.children.push(ch.id);
  }
}

// room accent per category (mirrors the scroll-world scenes)
const ACCENT = {};
const paint = (ids, color) => ids.forEach(i => ACCENT[i] = color);
paint(['38022381','38032005','102858075'], '#2e7e88');                                        // living
paint(['38003882','38022268','38022269','38005648','38022353','38005649','38003799',
       '50846528','50844229','38022202','38022354','112439376','57646037','68782006',
       '185355010','185364502','38005652'], '#c97b12');                                       // kitchen
paint(['38003963','81170222','81167227','40507239','48149056','48143206'], '#3d7f9e');        // laundry
paint(['50318054'], '#8a6242');                                                               // office
paint(['173607281','195273251','167433056'], '#1f4e57');                                      // finale/merch

// ---- keyword classifier: breadcrumbs only expose top-level categories, so
// subcategory membership is inferred from the (very consistent) product titles.
const RULES = [
  ['38022268', /نو ?فروست|no ?frost/i],                 // نو فروست
  ['38022269', /ديفروست|defrost/i],                     // ديفروست
  ['38022353', /أفق|افق|chest/i],                       // فريزر أفقى
  ['38005649', /رأس|راس|upright/i],                     // فريزر رأسى
  ['38022354', /أطباق|اطباق|dishwash/i],                // غسالات أطباق
  ['38003963', /غسالة|غساله|washing/i, /أطباق|اطباق|dishwash/i], // غسالات ملابس (excl. dishwashers)
  ['81170222', /مكنسة|vacuum/i],                        // مكانس
  ['81167227', /مكواة|مكوى|iron/i],                     // مكاوى
  ['57646037', /ميكروو?يف|ميكروي?يف|microwave/i],       // ميكروييف
  ['185364502', /قلاية|fryer/i],                        // قلايات
  ['68782006', /خلاط|محضر|عصارة|مفرمة|مضرب|قطاعة|كبة|بلندر|blender|mixer/i], // خلاطات ومحضرات
  ['185355010', /كاتيل|غلاية|قهوة|كبسولات|kettle|coffee/i], // كاتيل وقهوة
  ['48143206', /سخان.*غاز|غاز.*سخان/i],                 // سخانات غاز
  ['48149056', /سخان.*(كهرباء|كهربائ)/i],               // سخانات كهرباء
  ['50846528', /4 ?burners?|4 ?شعلة|٤ ?شعلة/i],         // 4 شعلة
  ['50844229', /5 ?burners?|5 ?شعلة|٥ ?شعلة/i],         // 5 شعلة
  ['38022202', /فرن كهرب|electric oven|مسطح طباخ/i],    // أفران كهربائية
  ['167433056', /خوص|خشب|سبت|طقم|طبق|حامل سخن|سرسوع/i], // حرف يدوية
];
function classify(p) {
  const extra = [];
  for (const [id, re, excl] of RULES) {
    if (p.title && re.test(p.title) && !(excl && excl.test(p.title))) extra.push(id);
  }
  return extra;
}

// ---- products by category (breadcrumb + classified subcategories) ----
const byCat = new Map();
const put = (cid, p) => { if (!byCat.has(cid)) byCat.set(cid, []); byCat.get(cid).push(p); };
for (const p of enriched.products) {
  if (!p.categoryId) continue;
  put(p.categoryId, p);
  for (const cid of classify(p)) if (cid !== p.categoryId) put(cid, p);
}

// ---- merchandising categories: curated cross-category showcases ----
const TOP = ['38003882','38005648','38003799','38005652','38032005','40507239','38022381','50318054','102858075','112439376'];
function curate(pickPerCat, sortFn) {
  const out = [];
  for (const cid of TOP) {
    const pool = [...(byCat.get(cid) || [])].filter(p => p.price != null).sort(sortFn);
    out.push(...pool.slice(0, pickPerCat));
  }
  return out;
}
// عروض صادكو: best-value picks (cheapest per category) — preview curation
byCat.set('173607281', curate(3, (a, b) => a.price - b.price));
// الأكثر مبيعاً: flagship picks (highest-priced per category) — preview curation
byCat.set('195273251', curate(2, (a, b) => b.price - a.price));
function descendants(id) {
  const out = [id];
  for (const ch of (nodes.get(id)?.children || [])) out.push(...descendants(ch));
  return out;
}
function productsFor(id) {
  const seen = new Set(), out = [];
  for (const cid of descendants(id)) {
    for (const p of (byCat.get(cid) || [])) {
      if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
  }
  return out;
}

// og meta arrives HTML-encoded; decode before re-escaping for output
const unent = s => String(s ?? '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/\s+/g, ' ').trim();
const esc = s => unent(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtPrice = n => n == null ? '' : Number(n).toLocaleString('ar-EG');

function card(p) {
  const teaser = p.description ? esc(p.description.slice(0, 130)) + (p.description.length > 130 ? '…' : '') : '';
  return `<article class="card">
  <a class="card__imgwrap" href="${esc(p.url)}" target="_blank" rel="noopener">
    ${p.image ? `<img loading="lazy" decoding="async" src="${esc(p.image)}" alt="${esc(p.title || '')}">` : `<span class="card__noimg">صادكو</span>`}
  </a>
  <div class="card__body">
    <h3 class="card__title">${esc(p.title || '')}</h3>
    ${teaser ? `<p class="card__teaser">${teaser}</p>` : ''}
    <div class="card__row">
      ${p.price != null ? `<span class="card__price">${fmtPrice(p.price)} <small>جنيه</small></span>` : '<span></span>'}
      <a class="card__buy" href="${esc(p.url)}" target="_blank" rel="noopener">اشترى الآن</a>
    </div>
  </div>
</article>`;
}

function page(cat) {
  const prods = productsFor(cat.id);
  const accent = ACCENT[cat.id] || '#2e7e88';
  const kids = (nodes.get(cat.id)?.children || []).map(id => nodes.get(id)).filter(Boolean);
  const parent = nodes.get(cat.id)?.parent ? nodes.get(nodes.get(cat.id).parent) : null;
  const chips = kids.length
    ? `<nav class="chips">${kids.map(k => `<a class="chip" href="${k.id}.html">${esc(k.name)}</a>`).join('')}</nav>` : '';
  const crumb = parent
    ? `<a href="../index.html">البيت</a> ← <a href="${parent.id}.html">${esc(parent.name)}</a> ← <span>${esc(cat.name)}</span>`
    : `<a href="../index.html">البيت</a> ← <span>${esc(cat.name)}</span>`;
  const grid = prods.length
    ? `<div class="grid">${prods.map(card).join('\n')}</div>`
    : `<div class="empty"><p>المنتجات دى بتتحدث باستمرار — شوفها مباشرة على الموقع الرسمى.</p>
       <a class="card__buy" href="${esc('https://www.sadko-group.com/shop/')}" target="_blank" rel="noopener">افتح المتجر</a></div>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(cat.name)} — صادكو جروب</title>
<link rel="icon" href="../assets/img/sadko-logo-white.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/category.css">
<style>:root{--accent:${accent};}</style>
</head>
<body>
<header class="top">
  <a class="top__logo" href="../index.html"><img src="../assets/img/sadko-logo-white.png" alt="صادكو جروب"></a>
  <nav class="top__nav">
    <a href="../index.html">ارجع للبيت</a>
  </nav>
  <a class="top__hotline" href="tel:19140">اتصل 19140</a>
</header>

<section class="hero">
  <p class="hero__crumb">${crumb}</p>
  <h1 class="hero__title">${esc(cat.name)}</h1>
  <p class="hero__meta">${prods.length ? `${prods.length} منتج` : ''}${cat.en ? ` · ${esc(cat.en)}` : ''}</p>
  ${chips}
</section>

<main class="wrap">
${grid}
</main>

<footer class="foot">
  <div class="foot__inner">
    <img src="../assets/img/sadko-logo-white.png" alt="صادكو جروب" class="foot__logo">
    <p>الخط الساخن <a href="tel:19140" dir="ltr">19140</a> · <a href="mailto:csupport@sadko-group.com" dir="ltr">csupport@sadko-group.com</a></p>
    <p>توصيل مجانى داخل القاهرة والجيزة والإسكندرية · الدفع عند الاستلام أو بالبطاقة</p>
    <p class="foot__copy">© صادكو جروب ${new Date().getFullYear()} — نسخة معاد تصميمها (Rebrand Preview)</p>
  </div>
</footer>
</body>
</html>`;
}

fs.mkdirSync('site/category', { recursive: true });
let built = 0; const report = [];
for (const cat of catalog.categories) {
  const html = page(cat);
  fs.writeFileSync(`site/category/${cat.id}.html`, html);
  built++;
  report.push(`${cat.id}  ${String(productsFor(cat.id).length).padStart(3)} products  ${cat.name}`);
}
fs.copyFileSync('extraction/products-enriched.json', 'site/data/products.json');
console.log(report.join('\n'));
console.log(`\nBuilt ${built} category pages.`);
