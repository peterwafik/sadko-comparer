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

  // Normalising BOTH the query and the searched text is what makes Arabic search
  // work at all. A shopper types "ثلاجه" and the catalogue says "ثلاجة"; types
  // "اسود" where the catalogue has "أسود". Unify the alef forms, teh marbuta and
  // alef maksura, drop harakat and tatweel, and fold Arabic-Indic digits to ASCII
  // so "١٠ قدم" and "10 قدم" are the same search.
  function norm(s) {
    return String(s || '')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/[٠-٩]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48); })
      .replace(/[۰-۹]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48); })
      .replace(/[ً-ْـٰ]/g, '')   // harakat, sukun, tatweel, dagger alef
      .replace(/[آأإٱ]/g, 'ا')  // آ أ إ ٱ -> ا
      .replace(/ة/g, 'ه')                      // ة -> ه
      .replace(/ى/g, 'ي')                      // ى -> ي
      .replace(/ؤ/g, 'و')                      // ؤ -> و
      .replace(/ئ/g, 'ي')                      // ئ -> ي
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Cross-language synonyms, written in ALREADY-NORMALISED form (ة->ه, ى->ي).
  // The catalogue is Arabic; the rule-based translator turns "ثلاجة" into
  // "Refrigerator", so an English shopper typing the everyday word "fridge" — or
  // "tv", which the translator never produces — matched nothing. These are search
  // aliases only: no product data is altered and nothing new is displayed.
  var SYNONYMS = [
    ['fridge', 'fridges', 'refrigerator', 'refrigerators', 'ثلاجه', 'ثلاجات'],
    ['tv', 'tvs', 'television', 'televisions', 'شاشه', 'شاشات', 'تلفزيون', 'تليفزيون', 'تليفزيونات'],
    ['washer', 'washers', 'washing', 'غساله', 'غسالات'],
    ['dishwasher', 'dishwashers', 'اطباق'],
    ['ac', 'aircon', 'airconditioner', 'conditioner', 'تكييف', 'تكييفات'],
    ['oven', 'ovens', 'cooker', 'cookers', 'فرن', 'افران', 'بوتاجاز', 'بوتجاز'],
    ['freezer', 'freezers', 'فريزر', 'فريزرات', 'ديب فريزر'],
    ['heater', 'heaters', 'سخان', 'سخانات'],
    ['microwave', 'microwaves', 'ميكروويف', 'ميكرويف', 'مايكروويف'],
    ['blender', 'blenders', 'mixer', 'خلاط', 'خلاطات'],
    ['vacuum', 'hoover', 'مكنسه', 'مكانس'],
    ['iron', 'irons', 'مكواه', 'مكاوي'],
    ['kettle', 'kettles', 'كاتيل', 'غلايه'],
    ['fryer', 'airfryer', 'قلايه', 'قلايات'],
    ['cooler', 'coolers', 'dispenser', 'مبرد', 'مبردات'],
    ['fan', 'fans', 'مروحه', 'مراوح'],
    ['small', 'اجهزه صغيره', 'صغيره']
  ];

  var SYN_INDEX = (function () {
    var ix = {};
    SYNONYMS.forEach(function (group) {
      group.forEach(function (w) { (ix[w] = ix[w] || []).push.apply(ix[w], group); });
    });
    return ix;
  })();

  // Query grammar (all optional — a plain phrase still behaves as before):
  //   two words   -> BOTH must appear, in any order and any field
  //   "in quotes" -> that exact run of characters must appear
  //   -word       -> products containing it are excluded
  // Returns { must: [[variant, …], …], phrases: [str, …], not: [str, …] }.
  function parseQuery(q) {
    var out = { must: [], typed: [], phrases: [], not: [] };
    var raw = String(q || '');
    // pull quoted phrases out first so their spaces are not split on
    raw = raw.replace(/"([^"]+)"/g, function (m, phrase) {
      var p = norm(phrase);
      if (p) out.phrases.push(p);
      return ' ';
    });
    norm(raw).split(' ').forEach(function (word) {
      if (!word) return;
      if (word.charAt(0) === '-' && word.length > 1) { out.not.push(word.slice(1)); return; }
      out.typed.push(word);
      // the typed word first, so matchesQuery can tell it from its expansions
      out.must.push(SYN_INDEX[word] ? [word].concat(SYN_INDEX[word].filter(function (w) { return w !== word; })) : [word]);
    });
    return out;
  }

  // `trTitle` is the OPTIONAL catalogue translator (window.skCatalogI18n.translateTitle,
  // injected by the caller so this module stays DOM-free). The catalogue is authored
  // entirely in Arabic, so without it an English shopper typing "fridge" matches nothing
  // at all — master shop.js had this branch and the storefront rewrite lost it.
  // A query matches when it hits the Arabic title, the Arabic description, OR the
  // translated (English) title. The translator is only consulted when the Arabic sides
  // miss, and a throwing translator degrades to "no English match" rather than emptying
  // the whole result set.
  // One normalised haystack per product, covering everything a shopper might
  // reasonably type: the Arabic title and description, the English title the
  // translator produces, and the brand. Built once per product per filter pass
  // rather than per token.
  // TWO haystacks, deliberately:
  //   identity — what the product IS: its title, the translated title, its brand.
  //   full     — identity plus the marketing description.
  // A word the shopper actually TYPED is looked for in `full`, so searching a spec
  // phrase like "انفرتر" still works. An expanded SYNONYM is looked for only in
  // `identity`, because a synonym asserts a product category while descriptions
  // mention other categories in passing: with "tv" expanded against descriptions,
  // "شاشة" (display) dragged in blenders and water coolers — 128 hits of which only
  // 32 were televisions.
  function haystacks(p, trTitle, specOf) {
    var id = [norm(p.title)];
    if (trTitle) {
      try { id.push(norm(trTitle(p.title))); } catch (e) {}
    }
    if (specOf) {
      try {
        var b = (specOf(p) || {}).brand;
        if (b) id.push(norm(b.ar), norm(b.en), norm(b.key));
      } catch (e) {}
    }
    var identity = id.join('  ');
    return { identity: identity, full: identity + '  ' + norm(p.description) };
  }

  // Short Latin tokens ("tv", "ac", "lg") must match as whole words: a bare
  // indexOf('tv') also lands inside any model code containing those two letters.
  // Arabic keeps substring matching, where prefixes and clitics ("الثلاجة") make
  // word boundaries the wrong tool.
  function hit(hay, needle) {
    if (/^[a-z0-9]{1,3}$/.test(needle)) {
      return new RegExp('(^|[^a-z0-9])' + needle + '([^a-z0-9]|$)').test(hay);
    }
    return hay.indexOf(needle) >= 0;
  }

  // `q` accepts either a raw query string or an already-parsed query (so filter()
  // can parse once for the whole catalogue instead of once per product).
  function matchesQuery(p, q, trTitle, specOf) {
    var parsed = (q && typeof q === 'object' && q.must) ? q : parseQuery(q);
    if (!parsed.must.length && !parsed.phrases.length && !parsed.not.length) return true;
    var hay = haystacks(p, trTitle, specOf);
    for (var i = 0; i < parsed.not.length; i++) {
      if (hit(hay.full, parsed.not[i])) return false;
    }
    for (var j = 0; j < parsed.phrases.length; j++) {
      if (hay.full.indexOf(parsed.phrases[j]) < 0) return false;
    }
    // Every term must land, but any one of its synonyms counts. The typed word
    // (always first in the variant list) searches the description too; the
    // synonyms it expanded to are held to the identity fields.
    for (var k = 0; k < parsed.must.length; k++) {
      var variants = parsed.must[k], found = false;
      for (var v = 0; v < variants.length; v++) {
        var where = (variants[v] === parsed.typed[k]) ? hay.full : hay.identity;
        if (hit(where, variants[v])) { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  function filter(products, state, specOf, trTitle) {
    // Parse once for the whole pass, not once per product: expanding synonyms for
    // every one of 471 products on every keystroke-free re-render is wasted work.
    var q = parseQuery(state.q);
    return products.filter(function (p) {
      if (state.cat && String(p.categoryId) !== String(state.cat)) return false;
      if (state.min != null && !(p.price >= state.min)) return false;
      if (state.max != null && !(p.price < state.max)) return false;
      if (!matchesQuery(p, q, trTitle, specOf)) return false;
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
      // The ad artwork carries its message inside the image, so `alt` is the only
      // thing an English screen-reader user gets. Swap it here with the rest rather
      // than leaving each renderer to re-implement the language check.
      if (x.altEn) c.alt = x.altEn; else delete c.alt;
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

  return { SORTS: SORTS, parseState: parseState, stateToSearch: stateToSearch, isBrowse: isBrowse, PRICE_BANDS: PRICE_BANDS, liveCategories: liveCategories, brandsOf: brandsOf, filter: filter, matchesQuery: matchesQuery, parseQuery: parseQuery, norm: norm, localizePromos: localizePromos, bandCounts: bandCounts, sortList: sortList, paginate: paginate };
});
