/* SADKO shop — routes between the storefront hub and the faceted browse view.
   All rendering lives in skShopUI; all catalogue/URL logic in skShopCore. This
   file owns state and the DOM only. */
(function () {
  'use strict';
  var C = window.skShopCore, U = window.skShopUI;
  var EN = (window.skLang && window.skLang.get()) === 'en';
  function t(ar, en) { return EN ? en : ar; }

  var BAND_LABELS = [t('تحت ٥٬٠٠٠', 'Under 5,000'), t('٥٬٠٠٠ – ١٥٬٠٠٠', '5,000 – 15,000'),
                     t('١٥٬٠٠٠ – ٣٠٬٠٠٠', '15,000 – 30,000'), t('فوق ٣٠٬٠٠٠', 'Over 30,000')];
  var RAIL_LABELS = { more: t('شوف الكل', 'See all') };

  function bandHref(b) {
    var s = { brands: [], sort: 'default', page: 1 };
    s.min = b.min; s.max = b.max;
    return 'shop.html' + C.stateToSearch(Object.assign({ cat: '', q: '', all: false }, s));
  }

  function specOf(p) { return window.skSpecs ? window.skSpecs.of(p) : {}; }

  // promos.json seeds bilingual pairs (title/titleEn, sub/subEn, cta/ctaEn);
  // skShopUI.promoHero only ever reads the bare (Arabic) keys, so the EN swap
  // happens here rather than inside that shared renderer.
  function localizePromos(promos) {
    if (!promos || !Array.isArray(promos)) return promos;
    if (!EN) return promos;
    return promos.map(function (x) {
      return Object.assign({}, x, {
        title: x.titleEn || x.title,
        sub: x.subEn || x.sub,
        cta: x.ctaEn || x.cta
      });
    });
  }

  function renderHub(root, products, promos) {
    var A = window.skApp;
    var cats = C.liveCategories(products).map(function (c) {
      return { id: c.id, count: c.count, name: A.catName(c.id), href: 'shop.html?cat=' + c.id };
    });
    var brands = C.brandsOf(products, specOf).filter(function (b) { return b.key !== '__none__'; }).slice(0, 12)
      .map(function (b) { return { key: b.key, count: b.count, name: t(b.ar, b.en), href: 'shop.html?brand=' + encodeURIComponent(b.key) }; });
    var bands = C.PRICE_BANDS.map(function (b) { return { key: b.key, href: bandHref(b) }; });

    var rails = cats.slice(0, 4).map(function (c) {
      var items = C.sortList(products.filter(function (p) { return String(p.categoryId) === c.id; }), 'price-asc').slice(0, 8);
      return U.rail(t('الأوفر فى ', 'Best value in ') + c.name, items, c.href, RAIL_LABELS);
    }).join('');

    root.innerHTML =
      U.breadcrumb([{ label: t('البيت', 'Home'), href: 'index.html' }, { label: t('المتجر', 'Shop') }]) +
      U.promoHero(localizePromos(promos)) +
      '<h2 class="shop-h2">' + t('تسوّق حسب الفئة', 'Shop by category') + '</h2>' +
      '<div class="ctiles">' + cats.map(U.categoryTile).join('') + '</div>' +
      '<h2 class="shop-h2">' + t('تسوّق حسب الماركة', 'Shop by brand') + '</h2>' +
      '<div class="btiles">' + brands.map(U.brandTile).join('') + '</div>' +
      '<h2 class="shop-h2">' + t('تسوّق حسب السعر', 'Shop by price') + '</h2>' +
      U.priceBands(bands, BAND_LABELS) +
      rails;
    U.afterGrid(root);
  }

  // TEMPORARY — Task 9 replaces this wholesale with the real faceted browse
  // view (facets sidebar, toolbar, pager, filtered grid). Task 8 only ships
  // the hub, but shop-core's isBrowse() already recognises `?cat=`/`?q=`/etc.
  // URLs, and boot() below must call *something* by that name or loading
  // shop.html with any of those params throws a ReferenceError. Falling back
  // to the hub keeps the page working (if not yet filtering) until Task 9 lands.
  function renderBrowse(root, state, products, promos) {
    renderHub(root, products, promos);
  }

  function boot() {
    var root = document.getElementById('shop-root');
    var state = C.parseState(location.search);
    Promise.all([
      window.skApp.products(),
      fetch('data/promos.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var products = res[0], promos = (res[1] && res[1].promos) || null;
      if (C.isBrowse(state)) renderBrowse(root, state, products, promos);
      else renderHub(root, products, promos);
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    if (EN) {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      document.title = 'Shop — SADKO Group';
      var l = document.querySelector('[data-i18n="loading"]');
      if (l) l.textContent = 'Loading…';
    }
    window.skApp.footer();
    boot();
  });
})();
