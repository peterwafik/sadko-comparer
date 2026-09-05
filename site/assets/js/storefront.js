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

  function clean(s) { return String(s == null ? '' : s).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

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
        '<div class="card__row">' +
          '<span class="card__price">' + money(p.price) + ' <small>' + esc(opts.currency || (en ? 'EGP' : 'جنيه')) + '</small></span>' +
          '<a class="card__buy" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(buyLabel) + '</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  var ACCENTS = { teal: 'promo--teal', amber: 'promo--amber', ink: 'promo--ink' };

  // A promo with no title is unusable; a missing/!Array input renders nothing at
  // all rather than an empty frame. `sample:true` is always marked.
  function promoHero(promos) {
    if (!promos || !Array.isArray(promos)) return '';
    var items = promos.filter(function (x) { return x && x.title; });
    if (!items.length) return '';
    return '<div class="promos">' + items.map(function (x) {
      var accent = ACCENTS[x.accent] || ACCENTS.teal;
      var noimg = x.image ? '' : ' promo--noimg';
      return '<a class="promo ' + accent + noimg + '" href="' + esc(x.href || '#') + '">' +
        (x.image ? '<img class="promo__bg" src="' + esc(x.image) + '" alt="" aria-hidden="true" onerror="this.remove()">' : '') +
        '<span class="promo__body">' +
          // Deliberately NOT a labels.* lookup: this marker is an honesty guarantee
          // (seeded sample content must never read as a live campaign, regardless of
          // caller-supplied labels). Do not "fix" this into a labels parameter — but
          // it is still a user-visible string, so it follows the page language the
          // same way every other default here does. An English shopper must be able
          // to read the warning, or the guarantee is worthless to them.
          (x.sample ? '<span class="promo__sample">' + (isEN() ? 'Sample content' : 'محتوى تجريبي') + '</span>' : '') +
          '<span class="promo__title">' + esc(x.title) + '</span>' +
          (x.sub ? '<span class="promo__sub">' + esc(x.sub) + '</span>' : '') +
          (x.cta ? '<span class="promo__cta">' + esc(x.cta) + '</span>' : '') +
        '</span></a>';
    }).join('') + '</div>';
  }

  function categoryTile(c) {
    return '<a class="ctile" href="' + esc(c.href) + '">' +
      '<span class="ctile__name">' + esc(c.name) + '</span>' +
      '<span class="ctile__count">' + esc(String(c.count)) + '</span></a>';
  }

  function brandTile(b) {
    return '<a class="btile" href="' + esc(b.href) + '">' +
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

  function toolbar(state, total, L) {
    var sortLabels = (L && L.sorts) || {};
    var fallback = DEFAULT_SORT_LABELS[isEN() ? 'en' : 'ar'];
    var keys = ['default', 'price-asc', 'price-desc'];
    return '<div class="stoolbar">' +
      '<span class="stoolbar__count">' + esc(L.count(total)) + '</span>' +
      '<select class="stoolbar__sort" id="sortSel">' + keys.map(function (k) {
        var label = sortLabels[k] || fallback[k];
        return '<option value="' + k + '"' + (state.sort === k ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('') + '</select></div>';
  }

  function pager(page, pages, hrefFor) {
    if (pages <= 1) return '';
    var out = [];
    for (var i = 1; i <= pages; i++) {
      out.push(i === page
        ? '<span class="pager__pg" aria-current="page">' + i + '</span>'
        : '<a class="pager__pg" href="' + esc(hrefFor(i)) + '">' + i + '</a>');
    }
    return '<nav class="pager">' + out.join('') + '</nav>';
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
    try { if (window.skNav && window.skNav.enhanceCategoryCards) window.skNav.enhanceCategoryCards(); } catch (e) {}
    try { if (window.skPrefs && window.skPrefs.applyToCards) window.skPrefs.applyToCards(rootEl); } catch (e) {}
  }

  return { esc: esc, clean: clean, money: money, card: card, promoHero: promoHero, categoryTile: categoryTile, brandTile: brandTile, priceBands: priceBands, rail: rail, facets: facets, toolbar: toolbar, pager: pager, breadcrumb: breadcrumb, afterGrid: afterGrid };
});
