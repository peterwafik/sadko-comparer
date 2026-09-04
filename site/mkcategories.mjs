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
// CAT_EN map, so a placeholder like "منتجات" would leave 20 of the 30 pages
// with a half-Arabic <title> in EN mode — precisely the hardcoded-Arabic class
// of bug this plan has already caught three times. Keep this map in sync with
// nav.js's SHOP_TREE if that ever changes.
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

const page = (id, name) => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${name} — صادكو جروب</title>
<meta name="description" content="تصفّح ${name} من صادكو جروب — بالسعر والصورة والمواصفات.">
<link rel="icon" href="../assets/img/sadko-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/css/category.css?v=c2">
<link rel="stylesheet" href="../assets/css/app.css?v=a6">
<link rel="stylesheet" href="../assets/css/storefront.css?v=s1">
</head>
<body>
<main class="wrap wrap--wide" id="shop-root" data-cat="${id}">
  <div class="empty" data-i18n="loading">جارى التحميل…</div>
</main>
<footer data-footer></footer>
<script src="../assets/js/catalog-i18n.js?v=g2" defer></script>
<script src="../assets/js/nav.js?v=g17" defer></script>
<script src="../assets/js/appshell.js?v=a4" defer></script>
<script src="../assets/js/specs.js?v=a4" defer></script>
<script src="../assets/js/store.js?v=a4" defer></script>
<script src="../assets/js/homes.js?v=a4" defer></script>
<script src="../assets/js/prefs.js?v=a4" defer></script>
<script src="../assets/js/shop-core.js?v=s1" defer></script>
<script src="../assets/js/storefront.js?v=s1" defer></script>
<script src="../assets/js/shop.js?v=s1" defer></script>
</body>
</html>
`;

const counts = {};
cat.products.forEach(p => { counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });

let written = 0;
const empties = [];
for (const file of readdirSync(CATDIR).filter(f => f.endsWith('.html'))) {
  const id = file.replace('.html', '');
  const name = NAMES[id] || 'منتجات';
  writeFileSync(join(CATDIR, file), page(id, name));
  written++;
  if (!counts[id]) empties.push(file);
}
empties.forEach(f => console.warn('  (no products) ' + f));
console.log('wrote ' + written + ' category pages');
