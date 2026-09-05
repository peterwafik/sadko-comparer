/* SADKO shop-core — pure catalogue + URL-state logic. No DOM, no globals read.
   Loaded as a classic script in the browser (window.skShopCore) and required
   directly by node --test, so it must stay free of browser-only APIs. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.skShopCore = api;
})(this, function () {
  'use strict';

  var SORTS = ['default', 'price-asc', 'price-desc'];

  function num(v) {
    var n = parseInt(v, 10);
    return (isFinite(n) && n >= 0) ? n : null;
  }

  function parseState(search) {
    var p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    var page = parseInt(p.get('page'), 10);
    var sort = p.get('sort') || 'default';
    return {
      cat: p.get('cat') || '',
      q: p.get('q') || '',
      brands: (p.get('brand') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      min: num(p.get('min')),
      max: num(p.get('max')),
      sort: SORTS.indexOf(sort) >= 0 ? sort : 'default',
      page: (isFinite(page) && page >= 1) ? page : 1,
      all: p.get('all') === '1'
    };
  }

  function stateToSearch(s) {
    var p = new URLSearchParams();
    if (s.all) p.set('all', '1');
    if (s.cat) p.set('cat', s.cat);
    if (s.q) p.set('q', s.q);
    if (s.brands && s.brands.length) p.set('brand', s.brands.join(','));
    if (s.min != null) p.set('min', String(s.min));
    if (s.max != null) p.set('max', String(s.max));
    if (s.sort && s.sort !== 'default') p.set('sort', s.sort);
    if (s.page && s.page > 1) p.set('page', String(s.page));
    var q = p.toString();
    return q ? '?' + q : '';
  }

  function isBrowse(s) {
    return !!(s.all || s.cat || s.q || (s.brands && s.brands.length) ||
              s.min != null || s.max != null || s.sort !== 'default' || s.page > 1);
  }

  var PRICE_BANDS = [
    { key: '0-5000',      min: 0,     max: 5000 },
    { key: '5000-15000',  min: 5000,  max: 15000 },
    { key: '15000-30000', min: 15000, max: 30000 },
    { key: '30000+',      min: 30000, max: null }
  ];

  function liveCategories(products) {
    var by = {};
    products.forEach(function (p) {
      var id = String(p.categoryId);
      by[id] = (by[id] || 0) + 1;
    });
    return Object.keys(by)
      .map(function (id) { return { id: id, count: by[id] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // `specOf` is injected so this function has no dependency on window.skSpecs.
  // Products whose brand cannot be derived are counted under '__none__', which is
  // always sorted last — they must remain visible, never silently dropped.
  function brandsOf(products, specOf) {
    var by = {};
    products.forEach(function (p) {
      var b = (specOf(p) || {}).brand;
      var key = (b && (b.key || b.en || b.ar)) ? String(b.key || b.en || b.ar).toLowerCase() : '__none__';
      if (!by[key]) by[key] = { key: key, ar: b ? b.ar : 'غير محدد', en: b ? b.en : 'Unspecified', count: 0 };
      by[key].count++;
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return b.count - a.count;
      });
  }

  function norm(s) {
    return String(s || '').replace(/&nbsp;/g, ' ').toLowerCase();
  }

  // `trTitle` is the OPTIONAL catalogue translator (window.skCatalogI18n.translateTitle,
  // injected by the caller so this module stays DOM-free). The catalogue is authored
  // entirely in Arabic, so without it an English shopper typing "fridge" matches nothing
  // at all — master shop.js had this branch and the storefront rewrite lost it.
  // A query matches when it hits the Arabic title, the Arabic description, OR the
  // translated (English) title. The translator is only consulted when the Arabic sides
  // miss, and a throwing translator degrades to "no English match" rather than emptying
  // the whole result set.
  function matchesQuery(p, q, trTitle) {
    if (!q) return true;
    if (norm(p.title).indexOf(q) >= 0) return true;
    if (norm(p.description).indexOf(q) >= 0) return true;
    if (trTitle) {
      try { if (norm(trTitle(p.title)).indexOf(q) >= 0) return true; } catch (e) {}
    }
    return false;
  }

  function filter(products, state, specOf, trTitle) {
    var q = norm(state.q);
    return products.filter(function (p) {
      if (state.cat && String(p.categoryId) !== String(state.cat)) return false;
      if (state.min != null && !(p.price >= state.min)) return false;
      if (state.max != null && !(p.price < state.max)) return false;
      if (!matchesQuery(p, q, trTitle)) return false;
      if (state.brands && state.brands.length) {
        var b = (specOf(p) || {}).brand;
        var key = (b && (b.key || b.en || b.ar)) ? String(b.key || b.en || b.ar).toLowerCase() : '__none__';
        if (state.brands.indexOf(key) < 0) return false;
      }
      return true;
    });
  }

  function sortList(list, sort) {
    var out = list.slice();
    if (sort === 'price-asc') out.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price-desc') out.sort(function (a, b) { return b.price - a.price; });
    return out;
  }

  function paginate(list, page, per) {
    per = per || 24;
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / per));
    var pg = Math.min(Math.max(1, page || 1), pages);
    return { items: list.slice((pg - 1) * per, pg * per), page: pg, pages: pages, total: total };
  }

  // Bilingual promo copy (data/promos.json). Extracted out of shop.js so it is
  // testable, and made HONEST: in English mode a field is taken ONLY from its *En
  // key. The old `x.titleEn || x.title` silently rendered Arabic to an English
  // shopper for any promo the owner had not fully translated. Now:
  //   - a promo with no `titleEn` is dropped from the EN hero entirely (it cannot
  //     be presented in English, and promoHero already treats a title-less promo
  //     as unusable), and it is reported through `onDrop` so the owner can see it;
  //   - a missing `subEn`/`ctaEn` drops just that line, exactly as promoHero
  //     already does for an absent `sub`/`cta`.
  // Nothing here mutates the input. In Arabic mode the list is returned untouched.
  function localizePromos(promos, en, onDrop) {
    if (!promos || !Array.isArray(promos)) return promos;
    if (!en) return promos;
    var out = [];
    promos.forEach(function (x) {
      if (!x) return;
      if (!x.titleEn) { if (onDrop) onDrop(x); return; }
      var c = Object.assign({}, x);
      c.title = x.titleEn;
      if (x.subEn) c.sub = x.subEn; else delete c.sub;
      if (x.ctaEn) c.cta = x.ctaEn; else delete c.cta;
      out.push(c);
    });
    return out;
  }

  // How many products fall in each PRICE_BANDS bucket, using exactly filter()'s
  // semantics (min inclusive, max exclusive) so a band's count always equals what
  // clicking it filters to. Pure half of shop.js's liveBands(); the href half stays
  // in shop.js because it reads the DOM.
  function bandCounts(products) {
    return PRICE_BANDS.map(function (b) {
      return {
        key: b.key, min: b.min, max: b.max,
        count: products.filter(function (p) {
          return p.price >= b.min && (b.max == null || p.price < b.max);
        }).length
      };
    });
  }

  return { SORTS: SORTS, parseState: parseState, stateToSearch: stateToSearch, isBrowse: isBrowse, PRICE_BANDS: PRICE_BANDS, liveCategories: liveCategories, brandsOf: brandsOf, filter: filter, matchesQuery: matchesQuery, localizePromos: localizePromos, bandCounts: bandCounts, sortList: sortList, paginate: paginate };
});
