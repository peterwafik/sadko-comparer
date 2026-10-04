/* ============================================================================
   Category pages, and the two ways they came up empty.

   The site ships 30 hand-built pages at site/category/<id>.html, and the Shop
   dropdown in nav.js links straight to them by id. Both the ids in those
   filenames and the ids in the dropdown are PRODUCTION ids (38022381 and
   friends). The test store uses an entirely different set (206642016 and
   friends) — the two stores share no ids at all.

   So there were two separate failures, and a visitor met both:

     1. Pick "تليفزيونات" from the Shop menu → category/38022381.html loads,
        finds no product whose categoryId is 38022381, and renders
        "لا يوجد منتجات فى هذا القسم حاليًا." The page exists; it is empty.

     2. Any link built from a LIVE category id — appshell's catHref does
        exactly this — asks for category/206642016.html, which no file
        matches. A plain 404.

   This module fixes both by the only thing the two stores DO share: the
   category NAME, which the static pages already carry in data-cat-name.

   Matching names is not string equality, because staff wrote them by hand in
   Ecwid and the static pages were generated from the other store:

     static "خلاطات ومحضرات طعام"   live "خلاطات و محضرات طعام"   (spacing)
     static "أجهزة صغيرة"           live "اجهزة صغيرة"             (أ vs ا)
     static "كاتيل وماكينات قهوة"   live "كاتيل و ماكينات قهوة"    (spacing)
     static "أفران وبوتاجازات"      live "أفران"                   (shorter)
     static "الأكثر مبيعاً"          live "المنتجات الاكثر مبيعاً"   (longer)

   Hence the tiers below, tried in order and stopping at the first that gives
   exactly ONE candidate. An ambiguous match resolves to nothing rather than
   to a guess: sending a shopper who asked for washing machines to the
   dishwashers page is worse than the empty page they get today.
   ========================================================================== */

/* Same normalisation as engine/ecwid-rails.mjs and ecwid-payments.mjs: the
   same word is written أ/ا/إ/آ, ى/ي, ة/ه, with and without diacritics. */
export function normCat(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ْٰ]/g, '')   // diacritics
    .replace(/[آأإا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')                  // tatweel
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Spacing-insensitive form, for "ومحضرات" vs "و محضرات". */
const tight = s => normCat(s).replace(/\s+/g, '');

/* The live categories, as {id, name} — the shape /data/categories.json
   serves. `counts` maps a category id to how many products it has, so a
   category that exists but is empty does not win over one that has stock. */
export function resolveCategory(wantedId, wantedName, live = [], counts = null) {
  const cats = (live || []).filter(c => c && c.id != null && c.name);
  const want = String(wantedId == null ? '' : wantedId);
  const has = id => !counts || (counts[String(id)] || 0) > 0;

  /* Tier 0: the id is already right AND has products. This is production,
     where nothing needs aliasing, and it must stay the fast path. */
  if (want && cats.some(c => String(c.id) === want) && has(want)) {
    return { id: want, matchedBy: 'id' };
  }

  const nName = normCat(wantedName);
  const tName = tight(wantedName);
  if (!nName) return null;

  /* Each tier returns its candidates; the first tier with exactly one wins.
     Candidates are restricted to categories that actually have products
     wherever counts were supplied — an empty live category is no better an
     answer than the empty page we are replacing. */
  const tiers = [
    /* 1. the same name */
    () => cats.filter(c => normCat(c.name) === nName),
    /* 2. the same name ignoring spaces */
    () => cats.filter(c => tight(c.name) === tName),
    /* 3. one name contains the other — "أفران" inside "أفران وبوتاجازات",
          "الأكثر مبيعاً" inside "المنتجات الاكثر مبيعاً". Guarded by a length
          floor so a two-letter fragment cannot match half the taxonomy. */
    () => cats.filter(c => {
      const t = tight(c.name);
      if (t.length < 4 || tName.length < 4) return false;
      return t.includes(tName) || tName.includes(t);
    }),
  ];

  for (const tier of tiers) {
    const all = tier();
    /* Prefer the ones with stock, but fall back to the full set: a genuinely
       empty category is still the right destination if it is the only match,
       and the page can say so honestly. */
    const stocked = all.filter(c => has(c.id));
    const pick = stocked.length ? stocked : all;
    if (pick.length === 1) {
      return { id: String(pick[0].id), matchedBy: 'name', name: pick[0].name };
    }
    /* More than one: ambiguous at this tier. Do NOT fall through to a looser
       tier, which would only be more ambiguous — stop and report nothing. */
    if (pick.length > 1) return null;
  }

  return null;
}

/* Turn one static category page into the same page for another category.

   Used for a LIVE category id that has no file of its own (failure 2 above).
   Rewriting an existing shell rather than assembling HTML keeps the asset
   versions, the stylesheet order and the script list identical to the 30
   hand-built pages — those are asserted by storefront.test.mjs, and a
   hand-rolled second copy would drift from them silently. */
export function retargetCategoryPage(html, { id, name, nameEn }) {
  if (!html || id == null) return null;
  const ar = String(name || '').trim();
  const en = String(nameEn || ar).trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let out = html.replace(
    /(<main id="shop-root")[^>]*(>)/,
    `$1 data-cat="${esc(id)}" data-cat-name="${esc(ar)}" data-cat-name-en="${esc(en)}"$2`);

  if (ar) {
    out = out
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(ar)} | صادكو جروب</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/,
        `$1${esc('تصفّح ' + ar + ' من صادكو جروب، بالسعر والصورة والمواصفات.')}$2`);
  }
  return out;
}

/* Rewrite only the pinned id on a page that already has the right name.

   This is failure 1: the file exists and its name is correct, but its id
   belongs to the other store. Only data-cat changes — the title, description
   and both name attributes are already right and must not be touched. */
export function repointCategoryPage(html, liveId) {
  if (!html || liveId == null) return html;
  return html.replace(/(<main id="shop-root"[^>]*\sdata-cat=")[^"]*(")/, `$1${String(liveId)}$2`);
}
