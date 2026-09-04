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

  return { SORTS: SORTS, parseState: parseState, stateToSearch: stateToSearch, isBrowse: isBrowse, PRICE_BANDS: PRICE_BANDS, liveCategories: liveCategories, brandsOf: brandsOf };
});
