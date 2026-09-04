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
  function card(p, opts) {
    opts = opts || {};
    var href = opts.href || p.url || '#';
    var title = clean(p.title);
    var teaser = clean(p.description).slice(0, 120);
    var img = p.image
      ? '<img loading="lazy" decoding="async" src="' + esc(p.image) + '" alt="' + esc(title) + '">'
      : '<span class="card__noimg" aria-hidden="true"></span>';
    return '<article class="card" data-id="' + esc(p.id) + '" data-cat="' + esc(p.categoryId) + '">' +
      '<a class="card__imgwrap" href="' + esc(href) + '">' + img + '</a>' +
      '<div class="card__body">' +
        '<h3 class="card__title">' + esc(title) + '</h3>' +
        '<p class="card__teaser">' + esc(teaser) + '</p>' +
        '<div class="card__row">' +
          '<span class="card__price">' + money(p.price) + ' <small>' + esc(opts.currency || (isEN() ? 'EGP' : 'جنيه')) + '</small></span>' +
          '<a class="card__buy" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(opts.buyLabel || 'اشترى الآن') + '</a>' +
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
      return '<a class="promo ' + accent + '" href="' + esc(x.href || '#') + '">' +
        (x.image ? '<img class="promo__bg" src="' + esc(x.image) + '" alt="" aria-hidden="true" onerror="this.remove()">' : '') +
        '<span class="promo__body">' +
          (x.sample ? '<span class="promo__sample">محتوى تجريبي</span>' : '') +
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

  function priceBands(bands, labels) {
    return '<div class="bands">' + bands.map(function (b, i) {
      return '<a class="band" href="' + esc(b.href) + '">' + esc(labels[i]) + '</a>';
    }).join('') + '</div>';
  }

  function rail(title, products, moreHref) {
    if (!products || !products.length) return '';
    return '<section class="rail">' +
      '<div class="rail__head"><h2 class="rail__title">' + esc(title) + '</h2>' +
      (moreHref ? '<a class="rail__more" href="' + esc(moreHref) + '">' + esc('شوف الكل') + '</a>' : '') +
      '</div><div class="rail__track">' +
      products.map(function (p) { return card(p, {}); }).join('') +
      '</div></section>';
  }

  return { esc: esc, clean: clean, money: money, card: card, promoHero: promoHero, categoryTile: categoryTile, brandTile: brandTile, priceBands: priceBands, rail: rail };
});
