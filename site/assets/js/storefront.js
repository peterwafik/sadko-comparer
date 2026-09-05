/* SADKO storefront — pure HTML-string renderers shared by the shop hub, the
   browse view, the 30 category pages and the product page. Holds no state and
   reads no URL, so every renderer is unit-testable under node --test.
   Dual export: window.skShopUI in the browser, module.exports for tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.skShopUI = api;
})(this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The catalogue is scraped HTML, so 193 of the 471 products carry entities as
  // LITERAL text ("Giza &amp; Alex", "كولدير&nbsp;2 حنفية"). esc() would escape the
  // ampersand a second time and the card would read "Giza &amp;amp; Alex" — which is
  // exactly what shipped. Decode first, then esc() re-escapes the real characters
  // correctly. plan.js:25 and posters.js:33 already do this; storefront.js missed it.
  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    return String(s).replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
      function (m, dec, hex, name) {
        if (dec) return String.fromCodePoint(parseInt(dec, 10));
        if (hex) return String.fromCodePoint(parseInt(hex, 16));
        var k = name.toLowerCase();
        // An unknown entity is left verbatim rather than guessed at — it is catalogue
        // text, not markup we control. Every consumer of clean() escapes its output,
        // so decoding can never introduce live markup.
        return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
      });
  }

  function clean(s) { return decodeEntities(String(s == null ? '' : s)).replace(/\s+/g, ' ').trim(); }

  // Same language convention as appshell.js's EN()/money(): read window.skLang when it
  // exists, default to Arabic otherwise. Guarded so this stays callable from node:test,
  // where `window` is undefined.
  function isEN() {
    return typeof window !== 'undefined' && !!(window.skLang && window.skLang.get() === 'en');
  }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return isEN() ? v.toLocaleString('en-EG') : v.toLocaleString('ar-EG');
  }

  // MUST keep every class nav.js/prefs.js query, and MUST href the catalogue url:
  // enhanceCategoryCards resolves products by URL pathname, so an internal href
  // breaks add-to-cart on every card. See storefront.test.mjs.
  // Same convention as nav.js's translateCategoryPage(): in EN the title runs
  // through the rule-based catalog translator (specs/teasers exist only in
  // Arabic, so the teaser is hidden rather than mistranslated), and the buy
  // label gets an English default. Guarded so this stays callable from
  // node:test, where window/skCatalogI18n do not exist.
  function translateForEN(s) {
    try {
      if (typeof window !== 'undefined' && window.skCatalogI18n && window.skCatalogI18n.translateTitle) {
        return window.skCatalogI18n.translateTitle(s);
      }
    } catch (e) {}
    return s;
  }

  function card(p, opts) {
    opts = opts || {};
    var href = opts.href || p.url || '#';
    var en = isEN();
    var title = en ? translateForEN(clean(p.title)) : clean(p.title);
    var teaser = clean(p.description).slice(0, 120);
    var img = p.image
      ? '<img loading="lazy" decoding="async" src="' + esc(p.image) + '" alt="' + esc(title) + '">'
      : '<span class="card__noimg" aria-hidden="true"></span>';
    var buyLabel = opts.buyLabel || (en ? 'Buy now ↗' : 'اشترى الآن');
    return '<article class="card" data-id="' + esc(p.id) + '" data-cat="' + esc(p.categoryId) + '">' +
      '<a class="card__imgwrap" href="' + esc(href) + '">' + img + '</a>' +
      '<div class="card__body">' +
        '<h3 class="card__title">' + esc(title) + '</h3>' +
        '<p class="card__teaser"' + (en ? ' hidden' : '') + '>' + esc(teaser) + '</p>' +
        // The price sits on its OWN line, above the actions. It used to share
        // .card__row with the buy link — and nav.js's enhanceCategoryCards() then
        // appended "Details" and "Add to cart" into that same flex row, so four
        // controls fought over ~306px: "Details & size" was squeezed to 65px (three
        // wrapped lines) and "Add to cart" to 49px (four). .card__row is now the
        // action block ALONE, which is also the element nav.js appends into.
        '<span class="card__price">' + money(p.price) + ' <small>' + esc(opts.currency || (en ? 'EGP' : 'جنيه')) + '</small></span>' +
        '<div class="card__row">' +
          '<a class="card__buy" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(buyLabel) + '</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function categoryTile(c) {
    return '<a class="ctile" href="' + esc(c.href) + '">' +
      '<span class="ctile__name">' + esc(c.name) + '</span>' +
      '<span class="ctile__count">' + esc(String(c.count)) + '</span></a>';
  }

  // Circular brand tile, the "shop by brand" pattern big retailers use. If a logo
  // file exists at assets/img/brands/<key>.(png|svg) it is shown; if it 404s the
  // <img> removes itself and the wordmark underneath shows through, so the row
  // looks deliberate whether or not the logos have been supplied yet. We ship no
  // third-party logo files — see assets/img/brands/README.md.
  function brandTile(b) {
    var logo = b.logo
      ? '<img class="btile__logo" src="' + esc(b.logo) + '" alt="" loading="lazy"' +
        ' onerror="this.parentNode.classList.add(\'btile__mark--nologo\');this.remove()">'
      : '';
    return '<a class="btile" href="' + esc(b.href) + '" title="' + esc(b.name) + '">' +
      '<span class="btile__mark' + (logo ? '' : ' btile__mark--nologo') + '">' + logo +
        '<span class="btile__word">' + esc(b.name) + '</span></span>' +
      '<span class="btile__name">' + esc(b.name) + '</span>' +
      '<span class="btile__count">' + esc(String(b.count)) + '</span></a>';
  }

  // Contract: `bands` entries must be caller-built {key, label?, href} objects —
  // NOT raw PRICE_BANDS entries. shop-core's PRICE_BANDS is {key,min,max} with no
  // href, so passing it directly is not sufficient input on its own; Tasks 8/9
  // map each PRICE_BANDS entry through a bandHref() helper (adding a live href)
  // before calling this. `labels` is a parallel array of display strings, applied
  // by index — a band's own .label (if present) is not read here. If an entry's
  // .href is absent, esc(undefined) resolves to '' and the anchor renders
  // href="" rather than throwing; see the priceBands tests for that behaviour.
  function priceBands(bands, labels) {
    return '<div class="bands">' + bands.map(function (b, i) {
      return '<a class="band" href="' + esc(b.href) + '">' + esc(labels[i]) + '</a>';
    }).join('') + '</div>';
  }

  function rail(title, products, moreHref, labels) {
    if (!products || !products.length) return '';
    // The default follows the page language (same isEN() convention as card()'s buy
    // label and currency). A caller-supplied labels.more still wins, so the existing
    // overrides in shop.js/product.js behave exactly as before.
    var moreLabel = (labels && labels.more) || (isEN() ? 'See all' : 'شوف الكل');
    return '<section class="rail">' +
      '<div class="rail__head"><h2 class="rail__title">' + esc(title) + '</h2>' +
      (moreHref ? '<a class="rail__more" href="' + esc(moreHref) + '">' + esc(moreLabel) + '</a>' : '') +
      '</div><div class="rail__track">' +
      products.map(function (p) { return card(p, {}); }).join('') +
      '</div></section>';
  }

  function facets(state, data, L) {
    var cats = data.cats.map(function (c) {
      var on = String(state.cat) === String(c.id);
      return '<label class="facet__row"><input type="radio" name="cat" value="' + esc(c.id) + '"' +
        (on ? ' checked' : '') + '><span>' + esc(c.name) + '</span><b>' + esc(String(c.count)) + '</b></label>';
    }).join('');
    var brands = data.brands.map(function (b) {
      var on = state.brands.indexOf(b.key) >= 0;
      return '<label class="facet__row"><input type="checkbox" name="brand" value="' + esc(b.key) + '"' +
        (on ? ' checked' : '') + '><span>' + esc(b.name) + '</span><b>' + esc(String(b.count)) + '</b></label>';
    }).join('');
    var bands = data.bands.map(function (b) {
      return '<a class="facet__band" href="' + esc(b.href) + '">' + esc(b.label) + '</a>';
    }).join('');
    return '<form class="facets" id="facets">' +
      '<fieldset class="facet"><legend>' + esc(L.cats) + '</legend>' + cats + '</fieldset>' +
      '<fieldset class="facet"><legend>' + esc(L.brands) + '</legend>' + brands + '</fieldset>' +
      '<fieldset class="facet"><legend>' + esc(L.price) + '</legend>' + bands +
        '<div class="facet__range"><input type="number" name="min" min="0" value="' + (state.min == null ? '' : esc(state.min)) + '">' +
        '<input type="number" name="max" min="0" value="' + (state.max == null ? '' : esc(state.max)) + '"></div>' +
      '</fieldset>' +
      '<button type="button" class="facet__clear" id="facetClear">' + esc(L.clear) + '</button>' +
    '</form>';
  }

  // Default sort-option labels in BOTH languages, keyed by shop-core's SORTS value
  // (not by array position) so a caller-supplied `labels.sorts` map can override any
  // subset without needing to know option order. The language is picked by isEN(),
  // the same convention card()/rail() use, so a page that supplies no `sorts` map
  // still renders a correct <select> in English.
  var DEFAULT_SORT_LABELS = {
    ar: {
      'default': 'الترتيب الافتراضى',
      'price-asc': 'السعر: من الأقل للأعلى',
      'price-desc': 'السعر: من الأعلى للأقل'
    },
    en: {
      'default': 'Default order',
      'price-asc': 'Price: low to high',
      'price-desc': 'Price: high to low'
    }
  };

  // Search is a first-class browse control (spec S7), not a URL you have to know
  // how to type. Bilingual defaults follow the same isEN() convention as every
  // other default in this module, and a caller may override them through
  // L.search. The input is deliberately id="q"/name="q": that is the parameter
  // shop-core.parseState()/stateToSearch() already round-trip, so the URL stays
  // the single source of truth for the search term exactly as it is for every
  // other facet.
  var DEFAULT_SEARCH_LABELS = {
    ar: { placeholder: 'ابحث فى منتجات صادكو…', label: 'ابحث فى المنتجات', submit: 'بحث' },
    en: { placeholder: 'Search SADKO products…', label: 'Search products', submit: 'Search' }
  };

  function searchBox(value, L) {
    var d = DEFAULT_SEARCH_LABELS[isEN() ? 'en' : 'ar'];
    var lab = (L && L.search) || {};
    return '<form class="ssearch" role="search" id="searchForm">' +
      '<input type="search" class="ssearch__input" id="q" name="q" autocomplete="off"' +
        ' value="' + esc(value == null ? '' : value) + '"' +
        ' placeholder="' + esc(lab.placeholder || d.placeholder) + '"' +
        ' aria-label="' + esc(lab.label || d.label) + '">' +
      '<button type="submit" class="ssearch__btn">' + esc(lab.submit || d.submit) + '</button>' +
    '</form>';
  }

  // ---- advertising ------------------------------------------------------
  // Every ad is REAL SADKO campaign artwork taken from the company's own homepage
  // (see data/promos.json for the source and capture date). The message is baked
  // into each image in Arabic, so the markup deliberately renders the artwork and
  // nothing else — overlaying our own headline on top would print the same words
  // twice. The transcribed text becomes the accessible name instead.
  // The caller passes promos already run through shop-core's localizePromos(), so
  // `alt` and `title` are in the page's language by the time they arrive here.
  function adAlt(x) { return x.alt || x.title || ''; }

  function adFigure(x, cls) {
    if (!x || !x.image) return '';
    return '<a class="' + cls + '" href="' + esc(x.href || '#') + '">' +
      '<img src="' + esc(x.image) + '" alt="' + esc(adAlt(x)) + '" loading="lazy" decoding="async">' +
    '</a>';
  }

  // The hero sits INSIDE the page container (it is not full-bleed): the rest of the
  // shop is capped at the same width, and an ad that breaks that line reads as a
  // takeover rather than as part of the page. shop.js owns the rotation timer.
  function adHero(promos) {
    var items = (promos || []).filter(function (x) { return x && x.image && x.slot === 'hero'; });
    if (!items.length) return '';
    var en = isEN();
    var many = items.length > 1;
    var dots = many ? '<div class="adhero__dots" role="tablist" aria-label="' +
      esc(en ? 'Choose a banner' : 'اختر لافتة') + '">' + items.map(function (x, i) {
        return '<button type="button" class="adhero__dot' + (i === 0 ? ' is-on' : '') + '"' +
          ' role="tab" data-go="' + i + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '"' +
          ' aria-label="' + esc((en ? 'Banner ' : 'لافتة ') + (i + 1)) + '"></button>';
      }).join('') + '</div>' : '';
    var arrows = many
      ? '<button type="button" class="adhero__nav adhero__nav--prev" data-step="-1" aria-label="' +
          esc(en ? 'Previous banner' : 'اللافتة السابقة') + '"><i aria-hidden="true">‹</i></button>' +
        '<button type="button" class="adhero__nav adhero__nav--next" data-step="1" aria-label="' +
          esc(en ? 'Next banner' : 'اللافتة التالية') + '"><i aria-hidden="true">›</i></button>'
      : '';
    return '<section class="adhero" id="adStrap" aria-roledescription="carousel" aria-label="' +
        esc(en ? 'Offers' : 'عروض') + '">' +
      '<div class="adhero__slides">' + items.map(function (x, i) {
        return '<a class="adhero__slide' + (i === 0 ? ' is-on' : '') + '" href="' + esc(x.href || '#') + '"' +
          ' role="group" aria-roledescription="slide" aria-label="' + esc(adAlt(x)) + '"' +
          (i === 0 ? '' : ' aria-hidden="true" tabindex="-1"') + '>' +
          '<img src="' + esc(x.image) + '" alt="' + esc(adAlt(x)) + '"' +
            (i === 0 ? '' : ' loading="lazy"') + ' decoding="async">' +
        '</a>';
      }).join('') + '</div>' + arrows + dots +
    '</section>';
  }

  // One interleaved ad block. `layout` is 'duo' (two side by side) or 'solo' (one
  // wide). Called repeatedly down the page with different slices of the promo list,
  // so a shopper meets a new ad every screen or so instead of one banner up top.
  function adSlot(promos, layout) {
    var items = (promos || []).filter(function (x) { return x && x.image; });
    if (!items.length) return '';
    var cls = 'adslot adslot--' + (layout === 'solo' ? 'solo' : 'duo');
    return '<div class="' + cls + '">' +
      items.map(function (x) { return adFigure(x, 'adslot__ad'); }).join('') +
    '</div>';
  }

  // ---- advanced search panel --------------------------------------------
  // The text box plus the filters a shopper would otherwise have to run a search
  // first to reach. Every option is built from LIVE catalogue data passed in by
  // the caller — no hardcoded category or brand lists.
  function advancedSearch(state, data, L) {
    var en = isEN();
    var s = state || {};
    var d = data || {};
    var opt = function (list, sel, blank) {
      return '<option value="">' + esc(blank) + '</option>' + (list || []).map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (String(sel) === String(o.value) ? ' selected' : '') +
          '>' + esc(o.label) + (o.count != null ? ' (' + o.count + ')' : '') + '</option>';
      }).join('');
    };
    return '<section class="asearch">' +
      searchBox(s.q || '', L) +
      '<details class="asearch__more"' + (s.cat || s.min != null || s.max != null || (s.brands && s.brands.length) ? ' open' : '') + '>' +
        '<summary class="asearch__toggle">' + esc(en ? 'Advanced search' : 'بحث متقدم') + '</summary>' +
        '<div class="asearch__grid">' +
          '<label class="asearch__f"><span>' + esc(en ? 'Category' : 'الفئة') + '</span>' +
            '<select id="asCat">' + opt(d.cats, s.cat, en ? 'All categories' : 'كل الفئات') + '</select></label>' +
          '<label class="asearch__f"><span>' + esc(en ? 'Brand' : 'الماركة') + '</span>' +
            '<select id="asBrand">' + opt(d.brands, (s.brands || [])[0], en ? 'All brands' : 'كل الماركات') + '</select></label>' +
          '<label class="asearch__f"><span>' + esc(en ? 'Price from' : 'السعر من') + '</span>' +
            '<input type="number" id="asMin" inputmode="numeric" min="0" step="100" value="' + (s.min != null ? esc(s.min) : '') + '"></label>' +
          '<label class="asearch__f"><span>' + esc(en ? 'Price to' : 'السعر إلى') + '</span>' +
            '<input type="number" id="asMax" inputmode="numeric" min="0" step="100" value="' + (s.max != null ? esc(s.max) : '') + '"></label>' +
          '<label class="asearch__f"><span>' + esc(en ? 'Sort' : 'الترتيب') + '</span>' +
            '<select id="asSort">' + (d.sorts || []).map(function (o) {
              return '<option value="' + esc(o.value) + '"' + (s.sort === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
            }).join('') + '</select></label>' +
          '<div class="asearch__go">' +
            '<button type="button" class="btn btn--teal btn--sm" id="asApply">' + esc(en ? 'Search' : 'ابحث') + '</button>' +
            '<button type="button" class="btn btn--quiet btn--sm" id="asReset">' + esc(en ? 'Reset' : 'مسح') + '</button>' +
          '</div>' +
        '</div>' +
        '<p class="asearch__hint">' + esc(en
          ? 'Tips: type two words to require both · "in quotes" for an exact phrase · -word to exclude · English and Arabic both work.'
          : 'نصايح: اكتب كلمتين عشان يظهر اللى فيه الاتنين · "بين علامتين" للجملة بالظبط · -كلمة عشان تستبعدها · بيشتغل بالعربى والإنجليزى.') + '</p>' +
      '</details>' +
    '</section>';
  }

  function toolbar(state, total, L) {
    var sortLabels = (L && L.sorts) || {};
    var fallback = DEFAULT_SORT_LABELS[isEN() ? 'en' : 'ar'];
    var keys = ['default', 'price-asc', 'price-desc'];
    return '<div class="stoolbar">' +
      searchBox(state && state.q, L) +
      '<span class="stoolbar__count">' + esc(L.count(total)) + '</span>' +
      '<select class="stoolbar__sort" id="sortSel">' + keys.map(function (k) {
        var label = sortLabels[k] || fallback[k];
        return '<option value="' + k + '"' + (state.sort === k ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('') + '</select></div>';
  }

  // Spec S7: numbered on desktop, but on <=860px "prev / صفحة N من M / next".
  // 20 numbered pills measured 347x130 on a 393px phone — three rows of thumb-sized
  // targets. ONE markup emits both forms and storefront.css shows the right one per
  // breakpoint, so there is still a single pagination mechanism (no infinite scroll,
  // no second code path that can disagree about which page you are on).
  var DEFAULT_PAGER_LABELS = {
    ar: { prev: 'السابق', next: 'التالى', status: function (p, n) { return 'صفحة ' + p + ' من ' + n; } },
    en: { prev: 'Previous', next: 'Next', status: function (p, n) { return 'Page ' + p + ' of ' + n; } }
  };

  function pager(page, pages, hrefFor, L) {
    if (pages <= 1) return '';
    var d = DEFAULT_PAGER_LABELS[isEN() ? 'en' : 'ar'];
    var lab = (L && L.pager) || {};
    function step(kind, target, label, live) {
      var cls = 'pager__step pager__step--' + kind;
      return live
        ? '<a class="' + cls + '" rel="' + kind + '" href="' + esc(hrefFor(target)) + '">' + esc(label) + '</a>'
        : '<span class="' + cls + ' is-off" aria-disabled="true">' + esc(label) + '</span>';
    }
    var out = [];
    for (var i = 1; i <= pages; i++) {
      out.push(i === page
        ? '<span class="pager__pg" aria-current="page">' + i + '</span>'
        : '<a class="pager__pg" href="' + esc(hrefFor(i)) + '">' + i + '</a>');
    }
    return '<nav class="pager">' +
      step('prev', page - 1, lab.prev || d.prev, page > 1) +
      '<span class="pager__status">' + esc((lab.status || d.status)(page, pages)) + '</span>' +
      '<span class="pager__pgs">' + out.join('') + '</span>' +
      step('next', page + 1, lab.next || d.next, page < pages) +
    '</nav>';
  }

  function breadcrumb(trail) {
    return '<nav class="scrumb">' + trail.map(function (x, i) {
      return i === trail.length - 1
        ? '<span>' + esc(x.label) + '</span>'
        : '<a href="' + esc(x.href) + '">' + esc(x.label) + '</a>';
    }).join(' <i>←</i> ') + '</nav>';
  }

  // Browser-only. After any grid renders, re-run the site-wide card hooks so
  // add-to-cart, the details link and filter-by-my-place appear on new cards.
  // Safe to call repeatedly: nav.js guards on card.__skProduct.
  function afterGrid(rootEl) {
    if (typeof document === 'undefined') return;
    // enhanceCategoryCards() fetches products.json, and only once that resolves
    // does it set card.__skProduct and call nav.js's mountPrefsBar(), which is
    // what actually mounts the bar and runs skPrefs.applyToCards(). Calling
    // applyToCards here as well looked like belt-and-braces but never did
    // anything: it runs before that fetch settles, so every card it sees still
    // has no __skProduct and the filter has nothing to reason about. Removed
    // rather than chained — mountPrefsBar() is the single owner of preference
    // filtering, and it deliberately no-ops where there is no `.grid` (the hub
    // and the PDP rail), which is why those surfaces are never filtered down.
    try { if (window.skNav && window.skNav.enhanceCategoryCards) window.skNav.enhanceCategoryCards(); } catch (e) {}
  }

  return { esc: esc, clean: clean, money: money, translateForEN: translateForEN, card: card, categoryTile: categoryTile, brandTile: brandTile, priceBands: priceBands, rail: rail, facets: facets, searchBox: searchBox, adHero: adHero, adSlot: adSlot, advancedSearch: advancedSearch, toolbar: toolbar, pager: pager, breadcrumb: breadcrumb, afterGrid: afterGrid };
});
