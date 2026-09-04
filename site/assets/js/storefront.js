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

  return { esc: esc, clean: clean, money: money, card: card };
});
