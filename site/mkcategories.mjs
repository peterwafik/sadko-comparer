// Regenerates site/category/*.html as thin storefront shells. Run from repo root:
//   node site/mkcategories.mjs
// Every page shares one template and defers all rendering to shop.js
// (renderBrowse, pinned to one category via data-cat) — the browse experience
// can never drift between the shop and the category URLs.
//
// The id -> Arabic name map below is copied from assets/js/nav.js's own
// SHOP_TREE (the site's single source of truth for the 30-node category
// taxonomy), NOT abbreviated to a handful of top-level names with a generic
// fallback: nav.js's translateCategoryPage() (mounted on every category page)
// rewrites <title> in English by looking up the *exact* Arabic name in its
// CAT_EN map, so a placeholder like "منتجات" would leave pages with a
// half-Arabic <title> in EN mode — precisely the hardcoded-Arabic class of
// bug this plan has already caught repeatedly. Keep NAMES and CAT_EN in sync
// with nav.js's SHOP_TREE / CAT_EN if either ever changes — the asserts below
// (missing id, missing NAMES entry, missing CAT_EN entry, orphaned NAMES id)
// turn a drift into a build failure instead of a silent bad page.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATDIR = join(HERE, 'category');
const cat = JSON.parse(readFileSync(join(HERE, 'data/products.json'), 'utf8'));

const NAMES = {
  '38003882': 'ثلاجات',
  '38022268': 'نو فروست',
  '38022269': 'ديفروست',
  '38005648': 'فريزرات',
  '38022353': 'فريزر أفقى',
  '38005649': 'فريزر رأسى',
  '38003799': 'أفران وبوتاجازات',
  '50846528': '4 شعلة',
  '50844229': '5 شعلة',
  '38022202': 'أفران كهربائية',
  '38005652': 'غسالات',
  '38003963': 'غسالات ملابس',
  '38022354': 'غسالات أطباق',
  '40507239': 'سخانات مياه',
  '48149056': 'سخانات كهرباء',
  '48143206': 'سخانات غاز',
  '112439376': 'أجهزة صغيرة',
  '81170222': 'مكانس',
  '81167227': 'مكاوى',
  '68782006': 'خلاطات ومحضرات طعام',
  '57646037': 'ميكروييف',
  '185355010': 'كاتيل وماكينات قهوة',
  '185364502': 'قلايات',
  '38032005': 'تكييفات هواء',
  '38022381': 'تليفزيونات',
  '50318054': 'مبردات هواء ومراوح',
  '102858075': 'مبردات مياه',
  '167433056': 'حرف يدوية ومنتجات عضوية',
  '173607281': 'عروض صادكو',
  '195273251': 'الأكثر مبيعاً'
};

// Copied verbatim from assets/js/nav.js's CAT_EN (Arabic name -> English
// name). Used only to derive each page's English name for data-cat-name-en —
// shop.js prefers that attribute over appshell.js's A.catName(), which is
// missing 11 of the 30 ids.
const CAT_EN = {
  'ثلاجات': 'Refrigerators', 'نو فروست': 'No frost', 'ديفروست': 'Defrost',
  'فريزرات': 'Freezers', 'فريزر أفقى': 'Chest freezers', 'فريزر رأسى': 'Upright freezers',
  'أفران وبوتاجازات': 'Cookers & ovens', '4 شعلة': '4 burners', '5 شعلة': '5 burners', 'أفران كهربائية': 'Electric ovens',
  'غسالات': 'Washing machines', 'غسالات ملابس': 'Clothes washing machines', 'غسالات أطباق': 'Dishwashers',
  'سخانات مياه': 'Water heaters', 'سخانات كهرباء': 'Electric water heaters', 'سخانات غاز': 'Gas water heaters',
  'أجهزة صغيرة': 'Small appliances', 'مكانس': 'Vacuum cleaners', 'مكاوى': 'Irons',
  'خلاطات ومحضرات طعام': 'Blenders & mixers', 'ميكروييف': 'Microwaves',
  'كاتيل وماكينات قهوة': 'Kettles & coffee machines', 'قلايات': 'Air fryers',
  'تكييفات هواء': 'Air conditioners', 'تليفزيونات': 'Televisions', 'مبردات هواء ومراوح': 'Air coolers & fans',
  'مبردات مياه': 'Water dispensers', 'حرف يدوية ومنتجات عضوية': 'Handicrafts & organic',
  'عروض صادكو': 'SADKO Offers', 'الأكثر مبيعاً': 'Best sellers',
  'كل المنتجات': 'All products', 'خلاطات ومحضرات': 'Blenders & processors', 'كاتيل وقهوة': 'Kettles & coffee',
};

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const page = (id, nameAr, nameEn) => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>
/* A phone turned sideways gets the DESKTOP layout: the viewport is set to a
   laptop width (1200px, above the 1080px strap breakpoint) and scaled to fit,
   so the scenes, appliance markers, copy and bars use their desktop placement
   instead of a stretched phone layout. Upright again: back to the phone layout. */
(function () {
  var m = document.querySelector('meta[name=viewport]'); if (!m) return;
  var base = m.getAttribute('content'), DESK = 'width=1200';
  function landscape() {
    if (screen.orientation && screen.orientation.type) return screen.orientation.type.indexOf('landscape') === 0;
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
    return window.innerWidth > window.innerHeight;
  }
  function apply() {
    var touch = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
    var phone = touch && Math.min(screen.width, screen.height) <= 500;
    var want = phone && landscape() ? DESK : base;
    if (m.getAttribute('content') !== want) m.setAttribute('content', want);
  }
  apply();
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', apply);
  window.addEventListener('orientationchange', function () { setTimeout(apply, 60); });
})();
</script>
<title>${escHtml(nameAr)} | صادكو جروب</title>
<meta name="description" content="تصفّح ${escHtml(nameAr)} من صادكو جروب، بالسعر والصورة والمواصفات.">
<link rel="icon" href="../assets/img/sadko-logo-256.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/category.css?v=c6">
<link rel="stylesheet" href="../assets/css/app.css?v=a12">
<link rel="stylesheet" href="../assets/css/storefront.css?v=s10">
</head>
<body>
<div class="wrap wrap--wide">
<main id="shop-root" data-cat="${escHtml(id)}" data-cat-name="${escHtml(nameAr)}" data-cat-name-en="${escHtml(nameEn)}">
  <div class="empty" data-i18n="loading">جارى التحميل…</div>
</main>
</div>
<footer data-footer></footer>
<script src="../assets/js/catalog-i18n.js?v=g2" defer></script>
<script src="../assets/js/nav.js?v=g49" defer></script>
<script src="../assets/js/appshell.js?v=a7" defer></script>
<script src="../assets/js/specs.js?v=a6" defer></script>
<script src="../assets/js/store.js?v=a6" defer></script>
<script src="../assets/js/homes.js?v=a8" defer></script>
<script src="../assets/js/prefs.js?v=a9" defer></script>
<script src="../assets/js/shop-core.js?v=s5" defer></script>
<script src="../assets/js/storefront.js?v=s10" defer></script>
<script src="../assets/js/shop.js?v=s12" defer></script>
</body>
</html>
`;

const counts = {};
cat.products.forEach(p => { counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });

// Note (A): the outer <div class="wrap wrap--wide"> — with <main id="shop-root">
// nested INSIDE it, not carrying those classes itself — is required, not
// cosmetic: nav.js's injectFinderCta() finds no .hero on these pages and
// falls back to `document.querySelector('.wrap')`, prepending the guided-
// finder CTA as that element's first child. If #shop-root WERE the .wrap
// element (as in an earlier revision of this generator), shop.js's very
// first `root.innerHTML = …` would wipe the CTA out again on every render.
// With .wrap as a parent that shop.js never touches, the CTA (inserted once,
// at nav.js's mount) survives every subsequent facet-driven re-render.

const files = readdirSync(CATDIR).filter(f => f.endsWith('.html'));
const fileIds = new Set(files.map(f => f.replace('.html', '')));
const nameIds = new Set(Object.keys(NAMES));

// Note (B): fail loudly on drift instead of silently shipping a bad page —
// a NAMES id with no file (dead entry), a file with no NAMES id (would have
// silently fallen back to a generic, un-translatable name), or a name with
// no CAT_EN entry (would ship a half-Arabic EN <title>).
const namesWithNoFile = [...nameIds].filter(id => !fileIds.has(id));
if (namesWithNoFile.length) {
  throw new Error('mkcategories: NAMES has ids with no site/category/*.html file: ' + namesWithNoFile.join(', '));
}
const filesWithNoName = [...fileIds].filter(id => !nameIds.has(id));
if (filesWithNoName.length) {
  throw new Error('mkcategories: missing NAMES entry for category id(s): ' + filesWithNoName.join(', ') +
    ' — add them to NAMES (and CAT_EN if not already covered by nav.js).');
}
for (const id of fileIds) {
  if (!Object.prototype.hasOwnProperty.call(CAT_EN, NAMES[id])) {
    throw new Error('mkcategories: missing CAT_EN entry for "' + NAMES[id] + '" (id ' + id +
      ') — add it to nav.js CAT_EN and mirror it in this file\'s CAT_EN copy.');
  }
}

let written = 0;
const empties = [];
for (const file of files) {
  const id = file.replace('.html', '');
  const nameAr = NAMES[id];
  const nameEn = CAT_EN[nameAr];
  writeFileSync(join(CATDIR, file), page(id, nameAr, nameEn));
  written++;
  if (!counts[id]) empties.push(file);
}
empties.forEach(f => console.warn('  (no products) ' + f));
console.log('wrote ' + written + ' category pages');
