// site/engine/category-alias.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normCat, resolveCategory, retargetCategoryPage, repointCategoryPage } from './category-alias.mjs';

/* The live test store's real categories, as /data/categories.json serves
   them. Spellings are verbatim — the spacing and alif differences below are
   what staff actually typed. */
const LIVE = [
  { id: '206629761', name: 'ثلاجات' },
  { id: '206629517', name: 'نو فروست' },
  { id: '206629519', name: 'ديفروست' },
  { id: '206629763', name: 'فريزرات' },
  { id: '206642013', name: 'فريزر أفقى' },
  { id: '206642504', name: 'فريزر رأسى' },
  { id: '206642506', name: 'أفران' },
  { id: '206629523', name: 'أفران كهربائية' },
  { id: '206642507', name: '4 شعلة' },
  { id: '206642015', name: '5 شعلة' },
  { id: '206642509', name: 'غسالات' },
  { id: '206629518', name: 'غسالات ملابس' },
  { id: '206642503', name: 'غسالات أطباق' },
  { id: '206629767', name: 'سخانات مياه' },
  { id: '206642014', name: 'سخانات كهرباء' },
  { id: '206642505', name: 'سخانات غاز' },
  { id: '206629770', name: 'اجهزة صغيرة' },
  { id: '206629762', name: 'مكانس' },
  { id: '206629521', name: 'مكاوى' },
  { id: '206629520', name: 'خلاطات و محضرات طعام' },
  { id: '206629764', name: 'ميكروييف' },
  { id: '206629524', name: 'كاتيل و ماكينات قهوة' },
  { id: '206642510', name: 'قلايات' },
  { id: '206629766', name: 'تكييفات هواء' },
  { id: '206642016', name: 'تليفزيونات' },
  { id: '206629768', name: 'مبردات هواء ومراوح' },
  { id: '206629769', name: 'مبردات مياه' },
  { id: '206642508', name: 'حرف يدوية ومنتجات عضوية' },
  { id: '206629522', name: 'عروض صادكو' },
  { id: '206629765', name: 'المنتجات الاكثر مبيعاً' },
];

/* Every entry in nav.js's Shop dropdown, with the PRODUCTION id it links to
   and the name the static page carries. This is the actual failing path the
   visitor takes. */
const DROPDOWN = [
  ['38003882', 'ثلاجات'],
  ['38022268', 'نو فروست'],
  ['38022269', 'ديفروست'],
  ['38005648', 'فريزرات'],
  ['38022353', 'فريزر أفقى'],
  ['38005649', 'فريزر رأسى'],
  ['38003799', 'أفران وبوتاجازات'],
  ['50846528', '4 شعلة'],
  ['50844229', '5 شعلة'],
  ['38022202', 'أفران كهربائية'],
  ['38005652', 'غسالات'],
  ['38003963', 'غسالات ملابس'],
  ['38022354', 'غسالات أطباق'],
  ['40507239', 'سخانات مياه'],
  ['48149056', 'سخانات كهرباء'],
  ['48143206', 'سخانات غاز'],
  ['112439376', 'أجهزة صغيرة'],
  ['81170222', 'مكانس'],
  ['81167227', 'مكاوى'],
  ['68782006', 'خلاطات ومحضرات طعام'],
  ['57646037', 'ميكروييف'],
  ['185355010', 'كاتيل وماكينات قهوة'],
  ['185364502', 'قلايات'],
  ['38032005', 'تكييفات هواء'],
  ['38022381', 'تليفزيونات'],
  ['50318054', 'مبردات هواء ومراوح'],
  ['102858075', 'مبردات مياه'],
  ['167433056', 'حرف يدوية ومنتجات عضوية'],
  ['173607281', 'عروض صادكو'],
  ['195273251', 'الأكثر مبيعاً'],
];

/* ----------------------------- normalisation ---------------------------- */

test('the alif, ya and ta-marbuta variants fold together', () => {
  assert.equal(normCat('أجهزة صغيرة'), normCat('اجهزة صغيره'));
  assert.equal(normCat('فريزر أفقى'), normCat('فريزر افقي'));
});

test('diacritics and tatweel are ignored', () => {
  assert.equal(normCat('مبيعاً'), normCat('مبيعا'));
  assert.equal(normCat('غـسـالات'), normCat('غسالات'));
});

test('whitespace is collapsed but not removed', () => {
  /* The word itself comes back folded (ة → ه), which is the point of
     normalising; only the SPACING is asserted here. */
  assert.equal(normCat('  ثلاجات   كبيرة '), normCat('ثلاجات كبيرة'));
  assert.equal(normCat('  ثلاجات   كبيرة ').split(' ').length, 2);
  assert.ok(!/^\s|\s$|\s\s/.test(normCat('  ثلاجات   كبيرة ')));
});

test('nothing in, empty string out', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(normCat(v), '');
});

/* -------------------- THE BUG: every dropdown entry -------------------- */

test('EVERY category in the Shop dropdown resolves to a live category', () => {
  /* This is the reported bug, asserted exhaustively rather than by sample:
     all 30 menu entries used to land on a page with no products, because
     every id in the menu belongs to the other store. */
  const failures = [];
  for (const [id, name] of DROPDOWN) {
    const r = resolveCategory(id, name, LIVE);
    if (!r) failures.push(name + ' (' + id + ')');
  }
  assert.deepEqual(failures, [], 'these dropdown entries still resolve to nothing');
});

test('each dropdown entry resolves to the RIGHT live category, not just to something', () => {
  /* Resolving is worthless if it resolves wrongly — a shopper asking for
     washing machines must not reach dishwashers. Checked one by one. */
  const expected = {
    'ثلاجات': '206629761', 'نو فروست': '206629517', 'ديفروست': '206629519',
    'فريزرات': '206629763', 'فريزر أفقى': '206642013', 'فريزر رأسى': '206642504',
    'أفران وبوتاجازات': '206642506', '4 شعلة': '206642507', '5 شعلة': '206642015',
    'أفران كهربائية': '206629523', 'غسالات': '206642509', 'غسالات ملابس': '206629518',
    'غسالات أطباق': '206642503', 'سخانات مياه': '206629767', 'سخانات كهرباء': '206642014',
    'سخانات غاز': '206642505', 'أجهزة صغيرة': '206629770', 'مكانس': '206629762',
    'مكاوى': '206629521', 'خلاطات ومحضرات طعام': '206629520', 'ميكروييف': '206629764',
    'كاتيل وماكينات قهوة': '206629524', 'قلايات': '206642510', 'تكييفات هواء': '206629766',
    'تليفزيونات': '206642016', 'مبردات هواء ومراوح': '206629768', 'مبردات مياه': '206629769',
    'حرف يدوية ومنتجات عضوية': '206642508', 'عروض صادكو': '206629522',
    'الأكثر مبيعاً': '206629765',
  };
  for (const [id, name] of DROPDOWN) {
    const r = resolveCategory(id, name, LIVE);
    assert.equal(r && r.id, expected[name], 'wrong live category for ' + name);
  }
});

test('the spacing difference around و is bridged', () => {
  /* static "خلاطات ومحضرات طعام" vs live "خلاطات و محضرات طعام" */
  assert.equal(resolveCategory('68782006', 'خلاطات ومحضرات طعام', LIVE).id, '206629520');
  assert.equal(resolveCategory('185355010', 'كاتيل وماكينات قهوة', LIVE).id, '206629524');
});

test('a shorter live name is matched by containment', () => {
  /* static "أفران وبوتاجازات" vs live "أفران" — and it must NOT pick
     "أفران كهربائية", which is a different category that also exists. */
  const r = resolveCategory('38003799', 'أفران وبوتاجازات', LIVE);
  assert.equal(r.id, '206642506');
});

test('a longer live name is matched by containment too', () => {
  /* static "الأكثر مبيعاً" vs live "المنتجات الاكثر مبيعاً" */
  assert.equal(resolveCategory('195273251', 'الأكثر مبيعاً', LIVE).id, '206629765');
});

test('"غسالات" resolves to the parent, not to one of its children', () => {
  /* Three live categories contain the word. An exact name match has to win
     before containment is ever tried, or the parent category would be
     ambiguous and resolve to nothing. */
  const r = resolveCategory('38005652', 'غسالات', LIVE);
  assert.equal(r.id, '206642509');
  assert.equal(r.matchedBy, 'name');
});

/* --------------------------- production path --------------------------- */

test('an id that is already live and stocked is used as-is', () => {
  /* Production, where the ids match. This must stay the fast path and must
     not be re-resolved by name. */
  const r = resolveCategory('206642016', 'تليفزيونات', LIVE, { '206642016': 12 });
  assert.equal(r.id, '206642016');
  assert.equal(r.matchedBy, 'id');
});

test('a live id with NO products still falls through to the name', () => {
  /* An empty category whose name matches a stocked one elsewhere should send
     the visitor to the stocked one. */
  const live = [{ id: 'A', name: 'تليفزيونات' }, { id: 'B', name: 'تليفزيونات' }];
  const r = resolveCategory('A', 'تليفزيونات', live, { A: 0, B: 7 });
  assert.equal(r.id, 'B', 'the stocked category should win');
});

test('with no counts supplied, the id match is trusted', () => {
  const r = resolveCategory('206642016', 'تليفزيونات', LIVE);
  assert.equal(r.matchedBy, 'id');
});

/* ------------------------------ safety --------------------------------- */

test('an AMBIGUOUS name resolves to nothing rather than to a guess', () => {
  /* Two live categories with the same name and both stocked: there is no
     right answer, and picking one would send some shoppers to the wrong
     list. The empty page is the lesser harm. */
  const live = [{ id: 'A', name: 'ثلاجات' }, { id: 'B', name: 'ثلاجات' }];
  assert.equal(resolveCategory('38003882', 'ثلاجات', live, { A: 3, B: 4 }), null);
});

test('an ambiguity at one tier does not fall through to a looser tier', () => {
  /* A looser tier can only be more ambiguous. */
  const live = [{ id: 'A', name: 'غسالات ملابس' }, { id: 'B', name: 'غسالات اطباق' }];
  assert.equal(resolveCategory('x', 'غسالات', live), null);
});

test('a name that matches nothing resolves to nothing', () => {
  assert.equal(resolveCategory('999', 'دراجات نارية', LIVE), null);
});

test('a missing or empty name cannot resolve', () => {
  /* Without a name there is nothing to match on, and returning any category
     would be arbitrary. */
  assert.equal(resolveCategory('999', '', LIVE), null);
  assert.equal(resolveCategory('999', null, LIVE), null);
});

test('a very short name never containment-matches', () => {
  /* A two-letter fragment would otherwise match half the taxonomy. */
  const live = [{ id: 'A', name: 'ثلاجات نو فروست' }, { id: 'B', name: 'غسالات' }];
  assert.equal(resolveCategory('x', 'ثل', live), null);
});

test('an empty live list resolves to nothing and does not throw', () => {
  assert.equal(resolveCategory('38022381', 'تليفزيونات', []), null);
  assert.equal(resolveCategory('38022381', 'تليفزيونات', null), null);
});

test('junk live entries are skipped', () => {
  const live = [null, { id: null, name: 'x' }, { id: 'A' }, { id: 'B', name: 'تليفزيونات' }];
  assert.equal(resolveCategory('38022381', 'تليفزيونات', live).id, 'B');
});

/* --------------------------- rewriting a page -------------------------- */

const SHELL = readFileSync(
  path.join(import.meta.dirname, '..', 'category', '38022381.html'), 'utf8');

test('repointCategoryPage changes ONLY the pinned id', () => {
  const out = repointCategoryPage(SHELL, '206642016');
  assert.match(out, /data-cat="206642016"/);
  assert.ok(!out.includes('data-cat="38022381"'));
  /* the name attributes, title and description are already right */
  assert.match(out, /data-cat-name="تليفزيونات"/);
  assert.match(out, /data-cat-name-en="Televisions"/);
  assert.match(out, /<title>تليفزيونات \| صادكو جروب<\/title>/);
});

test('repointCategoryPage leaves the rest of the document byte-identical', () => {
  const out = repointCategoryPage(SHELL, '206642016');
  assert.equal(out.replace('data-cat="206642016"', 'data-cat="38022381"'), SHELL);
});

test('repointCategoryPage with nothing to do returns the page unharmed', () => {
  assert.equal(repointCategoryPage(SHELL, null), SHELL);
});

test('retargetCategoryPage builds a working page for a live category with no file', () => {
  /* The second failure: appshell's catHref asks for category/<liveId>.html,
     which no file matches, and the visitor gets a 404. */
  const out = retargetCategoryPage(SHELL, { id: '206629520', name: 'خلاطات و محضرات طعام', nameEn: 'Blenders' });
  assert.match(out, /data-cat="206629520"/);
  assert.match(out, /data-cat-name="خلاطات و محضرات طعام"/);
  assert.match(out, /data-cat-name-en="Blenders"/);
  assert.match(out, /<title>خلاطات و محضرات طعام \| صادكو جروب<\/title>/);
  assert.match(out, /name="description" content="تصفّح خلاطات و محضرات طعام/);
});

test('a retargeted page keeps the exact asset list of the hand-built pages', () => {
  /* Assembling the HTML instead of rewriting a real shell would let the
     script list and stylesheet order drift from the 30 pages that
     storefront.test.mjs asserts. */
  const out = retargetCategoryPage(SHELL, { id: '1', name: 'ت', nameEn: 'T' });
  const scripts = s => [...s.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const sheets = s => [...s.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts(out), scripts(SHELL));
  assert.deepEqual(sheets(out), sheets(SHELL));
});

test('retargetCategoryPage leaves no trace of the template category', () => {
  const out = retargetCategoryPage(SHELL, { id: '206629520', name: 'خلاطات', nameEn: 'Blenders' });
  assert.ok(!out.includes('38022381'), 'the template id survived');
  assert.ok(!out.includes('تليفزيونات'), 'the template name survived');
  assert.ok(!out.includes('Televisions'), 'the template English name survived');
});

test('retargetCategoryPage escapes a name containing markup', () => {
  /* Category names come from Ecwid, so they are staff-authored text arriving
     over HTTP and being written into an attribute and a title. */
  const out = retargetCategoryPage(SHELL, { id: '1', name: '<script>alert(1)</script>', nameEn: 'x" onload="y' });
  assert.ok(!out.includes('<script>alert(1)'), 'a tag was written into the page');
  assert.ok(!/data-cat-name-en="x" onload="y"/.test(out), 'an attribute was broken out of');
  assert.match(out, /&lt;script&gt;/);
});

test('retargetCategoryPage falls back to the Arabic name when there is no English one', () => {
  const out = retargetCategoryPage(SHELL, { id: '1', name: 'قلايات' });
  assert.match(out, /data-cat-name-en="قلايات"/);
});

test('retargetCategoryPage refuses to build a page with no id', () => {
  assert.equal(retargetCategoryPage(SHELL, { name: 'x' }), null);
  assert.equal(retargetCategoryPage(null, { id: '1', name: 'x' }), null);
});

/* ======================================================================
   Parent categories, in the filter.

   After the id resolution above, six of the thirty menu entries were STILL
   empty — and they were exactly the parents: ثلاجات, فريزرات, أفران, غسالات,
   سخانات مياه, أجهزة صغيرة. Ecwid files a product under the CHILD only:
   checked against the live store, 0 of the 144 products in "نو فروست"
   mention its parent "ثلاجات". So the fridges page matched nothing while
   217 fridges sat one level down.

   shop-core.js is a browser IIFE, loaded here the same way
   storefront.test.mjs loads its own.
   ================================================================== */
import { createRequire } from 'node:module';
const core = createRequire(import.meta.url)('../assets/js/shop-core.js');

/* The live tree, parents and children as Ecwid reports them. */
const TREE = [
  { id: '206629761', name: 'ثلاجات', parentId: null },
  { id: '206629517', name: 'نو فروست', parentId: '206629761' },
  { id: '206629519', name: 'ديفروست', parentId: '206629761' },
  { id: '206629770', name: 'اجهزة صغيرة', parentId: null },
  { id: '206629762', name: 'مكانس', parentId: '206629770' },
  { id: '206629521', name: 'مكاوى', parentId: '206629770' },
  { id: '206642016', name: 'تليفزيونات', parentId: null },
];

const P = (id, ids) => ({ id, categoryId: ids[0], categoryIds: ids, price: 100, title: 'x' });

test('catFamily returns the category and every descendant', () => {
  const fam = core.catFamily('206629761', TREE);
  assert.deepEqual(Object.keys(fam).sort(), ['206629517', '206629519', '206629761'].sort());
});

test('catFamily on a leaf is just the leaf', () => {
  assert.deepEqual(Object.keys(core.catFamily('206629517', TREE)), ['206629517']);
});

test('catFamily reaches grandchildren, not only direct children', () => {
  const deep = TREE.concat([{ id: 'GC', name: 'g', parentId: '206629517' }]);
  assert.equal(core.catFamily('206629761', deep).GC, true);
});

test('catFamily survives a cycle in the data rather than hanging', () => {
  /* Ecwid should never produce one; a hung page would be unrecoverable. */
  const bad = [{ id: 'A', name: 'a', parentId: 'B' }, { id: 'B', name: 'b', parentId: 'A' }];
  const fam = core.catFamily('A', bad);
  assert.equal(fam.A, true);
  assert.equal(fam.B, true);
});

test('catFamily with no taxonomy returns null, so the filter compares ids directly', () => {
  assert.equal(core.catFamily('206629761', []), null);
  assert.equal(core.catFamily('206629761', null), null);
  assert.equal(core.catFamily(null, TREE), null);
});

test('THE BUG: a parent category now matches its children products', () => {
  const fridge = P('p1', ['206629517']);            // in نو فروست only
  const state = { cat: '206629761', catSet: core.catFamily('206629761', TREE) };
  assert.equal(core.inCategory(fridge, state), true,
    'a fridge filed under نو فروست is still invisible on the ثلاجات page');
});

test('and the child page still shows only its own', () => {
  const fridge = P('p1', ['206629517']);
  const other = P('p2', ['206629519']);
  const state = { cat: '206629517', catSet: core.catFamily('206629517', TREE) };
  assert.equal(core.inCategory(fridge, state), true);
  assert.equal(core.inCategory(other, state), false, 'ديفروست products leaked into نو فروست');
});

test('an unrelated category does not match', () => {
  const tv = P('p3', ['206642016']);
  const state = { cat: '206629761', catSet: core.catFamily('206629761', TREE) };
  assert.equal(core.inCategory(tv, state), false);
});

test('a product in SEVERAL categories is found in each of them', () => {
  /* 70 products in the live store sit in more than one category, and the
     filter read only p.categoryId — the single default — so they were
     invisible in every category but one. */
  const both = P('p4', ['206629517', '206642016']);
  for (const cat of ['206629517', '206642016']) {
    assert.equal(core.inCategory(both, { cat, catSet: core.catFamily(cat, TREE) }), true,
      'not found in ' + cat);
  }
});

test('with no catSet the behaviour is the plain id comparison it always was', () => {
  const fridge = P('p1', ['206629517']);
  assert.equal(core.inCategory(fridge, { cat: '206629517' }), true);
  assert.equal(core.inCategory(fridge, { cat: '206629761' }), false);
});

test('a product with only categoryId and no array still matches', () => {
  /* The July seed catalogue has no categoryIds at all. */
  const seed = { id: 's1', categoryId: '206629517', price: 10, title: 'x' };
  assert.equal(core.inCategory(seed, { cat: '206629517' }), true);
  assert.equal(core.inCategory(seed, { cat: '206629761', catSet: core.catFamily('206629761', TREE) }), true);
});

test('a product with no category at all matches nothing', () => {
  const orphan = { id: 'o', categoryId: null, categoryIds: [], price: 10, title: 'x' };
  assert.equal(core.inCategory(orphan, { cat: '206629761', catSet: core.catFamily('206629761', TREE) }), false);
});

test('filter() as a whole honours the subtree', () => {
  /* End to end through the real filter, not just the predicate. */
  const products = [P('a', ['206629517']), P('b', ['206629519']), P('c', ['206642016'])];
  const state = { cat: '206629761', catSet: core.catFamily('206629761', TREE), q: '' };
  const out = core.filter(products, state, () => ({}), x => x);
  assert.deepEqual(out.map(p => p.id).sort(), ['a', 'b']);
});

/* ======================================================================
   The server wiring.

   Source-level, like the other wiring suites: compare-server.mjs opens
   databases and binds a port, and shop.js is a browser IIFE.
   ================================================================== */

const SERVER = readFileSync(path.join(import.meta.dirname, '..', 'compare-server.mjs'), 'utf8');
const SHOP = readFileSync(path.join(import.meta.dirname, '..', 'assets', 'js', 'shop.js'), 'utf8');
const NAV = readFileSync(path.join(import.meta.dirname, '..', 'assets', 'js', 'nav.js'), 'utf8');

test('the server resolves a category page against the live store', () => {
  assert.ok(SERVER.includes('resolveCategory'), 'the resolver is not wired in');
  assert.ok(SERVER.includes('repointCategoryPage'), 'the id rewrite is not wired in');
  assert.ok(SERVER.includes('retargetCategoryPage'), 'the generated page is not wired in');
});

test('a page whose id already resolves is served byte-for-byte from disk', () => {
  /* Production, where the ids match: the file must not be rewritten at all. */
  assert.match(SERVER, /hit && hit\.id !== wantedId \? repointCategoryPage\(html, hit\.id\) : html/);
});

test('a category the store does not have still 404s', () => {
  /* The route must not invent a page for an arbitrary id. */
  assert.match(SERVER, /live\.find\(c => String\(c\.id\) === String\(wantedId\)\)/);
});

test('the category route cannot escape the category directory', () => {
  assert.match(SERVER, /file\.startsWith\(path\.join\(ROOT, 'category'\)\)/);
});

test('a failure in the route falls through to the static handler', () => {
  /* A broken mirror must not turn every category page into a 500. */
  assert.match(SERVER, /catch \(e\) \{ \/\* fall through to the static handler/);
});

test('the helpers the route needs are declared before the server is created', () => {
  /* Same class of bug as ORDER_LOADERS, which crashed the server once. */
  const server = SERVER.indexOf('http.createServer');
  for (const name of ['function liveCategoryList', 'async function categoryTemplate']) {
    const at = SERVER.indexOf(name);
    assert.ok(at > -1, name + ' not found');
    assert.ok(at < server, name + ' is declared after createServer');
  }
});

test('the generated page is built from a REAL shell, not assembled HTML', () => {
  /* Assembling it would let the script list drift from the 30 hand-built
     pages that storefront.test.mjs asserts. */
  assert.match(SERVER, /readdirSync\(dir\)\.filter\(n => n\.endsWith\('\.html'\)\)/);
});

test('readdirSync is actually imported — node --check cannot catch that', () => {
  assert.match(SERVER, /import \{[^}]*readdirSync[^}]*\} from 'node:fs'/);
});

/* --------------------------- the client wiring ------------------------- */

test('shop.js loads the category tree', () => {
  assert.match(SHOP, /data\/categories\.json/);
  assert.match(SHOP, /catFamily/);
});

test('the subtree is attached to the state the grid AND the counts share', () => {
  /* One computation per render, so the grid and the facet counts cannot
     disagree about what the category contains. */
  assert.match(SHOP, /withFamily\(state\)/);
  const fn = /function withFamily\(state\)[\s\S]{0,400}?\n  \}/.exec(SHOP)[0];
  assert.match(fn, /state\.catSet = state\.cat \? C\.catFamily/);
});

test('the "all categories" facet count clears the subtree with the category', () => {
  /* Otherwise those counts stay narrowed to the current subtree and the rail
     shows a smaller number than selecting the category would give. */
  assert.match(SHOP, /\{ cat: '', catSet: null \}/);
});

test('a failed taxonomy load degrades to the plain id comparison', () => {
  assert.match(SHOP, /\.catch\(function \(\) \{ return \[\]; \}\)/);
});

test('the Shop dropdown still points at the category pages', () => {
  /* The fix is in the serving, not the menu — the menu keeps its stable
     production URLs, which is what makes the static pages worth having. */
  assert.match(NAV, /const C = id => P\(`category\/\$\{id\}\.html`\)/);
});

/* ---------------------- the nameless facet ----------------------------- */

test('a product with NO category produces no category facet', () => {
  /* Ecwid uses 0 for "no category" and the mapper nulls it, so 7 products in
     the live store have none. They were counted under String(null) ===
     "null", which rendered a facet with no name (appshell fell back to the
     generic "فئة" / "Category") and led to an EMPTY page when clicked,
     because no product matches the id "null". */
  const products = [
    { id: 'a', categoryId: '206642016', price: 10, title: 'x' },
    { id: 'b', categoryId: null, price: 10, title: 'y' },
    { id: 'c', categoryId: '', price: 10, title: 'z' },
  ];
  const cats = core.liveCategories(products);
  assert.deepEqual(cats.map(c => c.id), ['206642016']);
  assert.ok(!cats.some(c => c.id === 'null' || c.id === 'undefined' || c.id === ''),
    'a nameless category facet is back: ' + JSON.stringify(cats));
});

test('the uncategorised products are not DROPPED, only unfacetted', () => {
  /* They must still appear in the unfiltered listing. */
  const products = [
    { id: 'a', categoryId: '206642016', price: 10, title: 'x' },
    { id: 'b', categoryId: null, price: 10, title: 'y' },
  ];
  const out = core.filter(products, { q: '' }, () => ({}), x => x);
  assert.equal(out.length, 2, 'an uncategorised product vanished from the listing');
});

test('appshell skips them too, so the shop hub has no nameless tile', () => {
  const appshell = readFileSync(
    path.join(import.meta.dirname, '..', 'assets', 'js', 'appshell.js'), 'utf8');
  const fn = /function liveCats\(\)[\s\S]{0,900}?\n  \}/.exec(appshell)[0];
  assert.match(fn, /p\.categoryId == null \|\| p\.categoryId === ""/);
});
