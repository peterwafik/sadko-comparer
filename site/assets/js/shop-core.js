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

  return { SORTS: SORTS, parseState: parseState, stateToSearch: stateToSearch, isBrowse: isBrowse };
});
