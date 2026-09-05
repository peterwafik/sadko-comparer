/* SADKO shop — routes between the storefront hub and the faceted browse view.
   All rendering lives in skShopUI; all catalogue/URL logic in skShopCore. This
   file owns state and the DOM only. */
(function () {
  'use strict';
  var C = window.skShopCore, U = window.skShopUI;
  var EN = (window.skLang && window.skLang.get()) === 'en';
  function t(ar, en) { return EN ? en : ar; }

  // Root-relative path helper, derived the exact same way nav.js:23 derives
  // its own ROOT: a `data-root` attribute on this <script>, else '../' when
  // the page lives under /category/. shop.js is loaded on both site-root
  // pages (shop.html) and the 30 /category/*.html shells, and every literal
  // 'shop.html'/'index.html'/'data/…' path below MUST go through P() or it
  // 404s from a category page (site-root-relative, not page-relative).
  var SCRIPT = document.currentScript;
  var ROOT = (SCRIPT && SCRIPT.getAttribute('data-root')) ||
    (location.pathname.replace(/\\/g, '/').includes('/category/') ? '../' : '');
  function P(p) { return ROOT + p; }

  // Prefer the category page's own bilingual name — data-cat-name /
  // data-cat-name-en on #shop-root, emitted by mkcategories.mjs straight from
  // nav.js's SHOP_TREE/CAT_EN — over appshell.js's A.catName(), which is
  // missing 11 of the 30 category ids and falls back to a generic
  // "فئة"/"Category" for them. Only applies to the page's OWN fixed id; every
  // other id (e.g. the rest of the facet rail) still comes from A.catName().
  function catNameOf(root, id) {
    var fixed = root.getAttribute('data-cat');
    if (fixed && String(id) === String(fixed)) {
      var name = root.getAttribute(EN ? 'data-cat-name-en' : 'data-cat-name');
      if (name) return name;
    }
    return window.skApp.catName(id);
  }

  var BAND_LABELS = [t('تحت ٥٬٠٠٠', 'Under 5,000'), t('٥٬٠٠٠ – ١٥٬٠٠٠', '5,000 – 15,000'),
                     t('١٥٬٠٠٠ – ٣٠٬٠٠٠', '15,000 – 30,000'), t('فوق ٣٠٬٠٠٠', 'Over 30,000')];
  var RAIL_LABELS = { more: t('شوف الكل', 'See all') };
  // toolbar()'s own DEFAULT_SORT_LABELS are bilingual and already pick the right
  // language from window.skLang, so this map is no longer load-bearing — it pins
  // the exact shop wording (identical strings to storefront.js's EN defaults) and
  // keeps the sort labels editable from the page that owns the browse view. Left
  // undefined in Arabic so toolbar() falls back to its own Arabic defaults.
  var SORT_LABELS = EN ? {
    'default': 'Default order',
    'price-asc': 'Price: low to high',
    'price-desc': 'Price: high to low'
  } : undefined;

  // Builds a price-band link that PRESERVES every other active facet (cat, q,
  // brands, sort, all) and changes only the price dimension plus resetting
  // page to 1 — the same "narrow, don't replace" contract the rest of the
  // facet rail follows. `state` is the caller's current browse state; the
  // hub calls this with no active state at all (nothing to preserve yet), so
  // `base` falls back to a clean, filter-free state and hub band links stay
  // bare price-only URLs.
  //
  // Pinned exactly like go()'s fixed branch and pager()'s hrefFor: on a prebuilt
  // category page the link keeps location.pathname and drops `cat` (render()
  // reasserts it from data-cat), so narrowing by price is not the one facet that
  // silently relocates the user off the category page onto shop.html.
  function bandHref(b, state) {
    var base = state || { cat: '', q: '', brands: [], sort: 'default', all: false };
    var root = document.getElementById('shop-root');
    var fixed = root && root.getAttribute('data-cat');
    var path = fixed ? location.pathname : P('shop.html');
    return path + C.stateToSearch(Object.assign({}, base,
      { cat: fixed ? '' : base.cat, min: b.min, max: b.max, page: 1 }));
  }

  function specOf(p) { return window.skSpecs ? window.skSpecs.of(p) : {}; }

  // The catalogue is Arabic-only, so an English shopper typing "fridge" would match
  // nothing without the rule-based translator. skShopUI.translateForEN wraps
  // window.skCatalogI18n.translateTitle and is already loaded on every shop surface
  // (catalog-i18n.js is the first script tag on shop.html and on all 30 category
  // pages). Null in Arabic mode: an Arabic query already matches the raw titles, and
  // translating 471 titles on every keystroke-free re-render would be wasted work.
  var TR = EN ? U.translateForEN : null;

  // Live price bands: bucket `products` into C.PRICE_BANDS and drop any band
  // with zero matches, exactly like liveCategories()/brandsOf() already do —
  // "do not render a facet that would return zero results" applies to price
  // bands too, not just cats/brands. Matches shop-core's filter() semantics
  // (min inclusive, max exclusive) so counts agree with what clicking the
  // band would actually filter to. Used by both the hub and the browse
  // facets so the two never disagree about which bands are live. `state` is
  // forwarded to bandHref() so a band link narrows the CURRENT view instead
  // of replacing it (see bandHref's comment); the hub omits it.
  function liveBands(products, state) {
    return C.bandCounts(products).map(function (b, i) {
      return { key: b.key, label: BAND_LABELS[i], href: bandHref(b, state), count: b.count };
    }).filter(function (b) { return b.count > 0; });
  }

  // promos.json carries bilingual pairs (title/titleEn, sub/subEn, cta/ctaEn and
  // alt/altEn); the renderers read only the bare keys, so the EN swap happens
  // before them. The swap itself lives in shop-core (pure, unit-tested):
  // the old `x.titleEn || x.title` fallback here rendered Arabic to an English
  // shopper for any promo the owner had not translated. promos.json is
  // owner-editable and unvalidated, so that fallback was a live Arabic-in-EN
  // path waiting for the first untranslated campaign. A dropped promo is
  // reported to the console so the omission is diagnosable rather than silent.
  function localizePromos(promos) {
    return C.localizePromos(promos, EN, function (x) {
      try { console.warn('[sadko] promo "' + (x && x.id) + '" has no titleEn — hidden in English.'); } catch (e) {}
    });
  }

  // Option lists for the advanced-search panel, built from the LIVE catalogue so a
  // category or brand can never be offered that no product actually has.
  function advData(root, products) {
    var sortNames = SORT_LABELS || { 'default': 'الأحدث أولاً', 'price-asc': 'الأرخص أولاً', 'price-desc': 'الأغلى أولاً' };
    return {
      cats: C.liveCategories(products).map(function (c) {
        return { value: c.id, label: catNameOf(root, c.id), count: c.count };
      }),
      brands: C.brandsOf(products, specOf).filter(function (b) { return b.key !== '__none__'; })
        .map(function (b) { return { value: b.key, label: t(b.ar, b.en), count: b.count }; }),
      sorts: ['default', 'price-asc', 'price-desc'].map(function (k) {
        return { value: k, label: sortNames[k] };
      })
    };
  }

  // Splits the promo list into the rotating hero at the top and the ads dealt out
  // between the sections below. The pinned category pages open straight onto one
  // category's listing, so the advertising belongs to shop.html only.
  function adsFor(root, promos) {
    if (root.getAttribute('data-cat')) return { hero: [], slots: [] };
    var all = localizePromos(promos) || [];
    return {
      hero: all.filter(function (x) { return x && x.slot === 'hero'; }),
      slots: all.filter(function (x) { return x && x.slot !== 'hero'; })
    };
  }

  // Deal the interleaved ads out down the page, a couple at a time, so a shopper
  // meets a new one every screen or so instead of one banner at the top. Returns
  // '' once the list is used up, which is what keeps this safe for an owner who
  // edits promos.json down to a single ad.
  function adDealer(slots) {
    var at = 0;
    return function (n, layout) {
      var take = slots.slice(at, at + n);
      at += take.length;
      return take.length ? U.adSlot(take, layout) : '';
    };
  }

  function renderHub(root, products, promos) {
    var cats = C.liveCategories(products).map(function (c) {
      return { id: c.id, count: c.count, name: catNameOf(root, c.id), href: P('shop.html?cat=') + c.id };
    });
    var brands = C.brandsOf(products, specOf).filter(function (b) { return b.key !== '__none__'; }).slice(0, 12)
      .map(function (b) {
        return {
          key: b.key, count: b.count, name: t(b.ar, b.en),
          href: P('shop.html?brand=') + encodeURIComponent(b.key),
          // Only brands listed in assets/img/brands/logos.json get a logo request;
          // everyone else renders the wordmark disc. See brandTile() and the folder's
          // README for how to add one.
          logo: (CACHE && CACHE.logos || []).indexOf(b.key) >= 0
            ? P('assets/img/brands/') + b.key + '.png' : ''
        };
      });
    var liveB = liveBands(products);
    var bands = liveB.map(function (b) { return { key: b.key, href: b.href }; });
    var bandLabels = liveB.map(function (b) { return b.label; });

    // Rails are emitted one at a time so an ad can be dropped BETWEEN them.
    var railList = cats.slice(0, 4).map(function (c) {
      var items = C.sortList(products.filter(function (p) { return String(p.categoryId) === c.id; }), 'price-asc').slice(0, 8);
      return U.rail(t('الأوفر فى ', 'Best value in ') + c.name, items, c.href, RAIL_LABELS);
    });
    var ads = adsFor(root, promos);
    var deal = adDealer(ads.slots);

    root.innerHTML =
      U.breadcrumb([{ label: t('البيت', 'Home'), href: P('index.html') }, { label: t('المتجر', 'Shop') }]) +
      U.advancedSearch({ q: '', sort: 'default' }, advData(root, products)) +
      U.adHero(ads.hero) +
      '<h2 class="shop-h2">' + t('تسوّق حسب الفئة', 'Shop by category') + '</h2>' +
      '<div class="ctiles">' + cats.map(U.categoryTile).join('') + '</div>' +
      '<h2 class="shop-h2">' + t('تسوّق حسب الماركة', 'Shop by brand') + '</h2>' +
      '<div class="btiles">' + brands.map(U.brandTile).join('') + '</div>' +
      (railList[0] || '') +
      deal(2, 'duo') +
      (railList[1] || '') +
      deal(1, 'solo') +
      (railList[2] || '') +
      deal(2, 'duo') +
      (railList[3] || '') +
      '<h2 class="shop-h2">' + t('تسوّق حسب السعر', 'Shop by price') + '</h2>' +
      U.priceBands(bands, bandLabels);
    U.afterGrid(root);
    wireAdStrap(root);
    wireAdvanced(root, null);
    // The hub holds no filter state, so a search from here starts a clean browse.
    wireSearch(root, function (q) {
      if (!q) return;
      go({ cat: '', q: q, brands: [], min: null, max: null, sort: 'default', page: 1, all: false });
    });
  }

  // Prebuilt category pages (site/category/*.html) set data-cat on #shop-root
  // to pin one category id — see render()'s own read of the same attribute.
  // go() must never let a facet change on such a page navigate it away to
  // shop.html: it keeps location.pathname (the category page itself) and
  // strips `cat` from the querystring (render() reasserts it from data-cat
  // on every render, so the URL never needs to carry it).
  function go(state) {
    var root = document.getElementById('shop-root');
    var fixed = root && root.getAttribute('data-cat');
    var path = fixed ? location.pathname : P('shop.html');
    history.pushState(null, '', path + C.stateToSearch(fixed ? Object.assign({}, state, { cat: '' }) : state));
    render();
  }

  function renderBrowse(root, state, products) {
    var fixed = root.getAttribute('data-cat');
    var matched = C.filter(products, state, specOf, TR);
    var sorted = C.sortList(matched, state.sort);
    var pg = C.paginate(sorted, state.page, 24);

    // Facet counts are computed against everything EXCEPT the facet being shown,
    // so a user can always see what selecting another value would give them.
    var forCats = C.filter(products, Object.assign({}, state, { cat: '' }), specOf, TR);
    var forBrands = C.filter(products, Object.assign({}, state, { brands: [] }), specOf, TR);
    var forPrice = C.filter(products, Object.assign({}, state, { min: null, max: null }), specOf, TR);

    var data = {
      cats: C.liveCategories(forCats).map(function (c) {
        return { id: c.id, count: c.count, name: catNameOf(root, c.id), href: P('shop.html?cat=') + c.id };
      }),
      brands: C.brandsOf(forBrands, specOf).map(function (b) {
        return { key: b.key, count: b.count, name: t(b.ar, b.en) };
      }),
      bands: liveBands(forPrice, state)
    };

    var title = state.cat ? catNameOf(root, state.cat) : (state.q ? t('نتائج البحث', 'Search results') : t('كل المنتجات', 'All products'));

    var facetsHtml = U.facets(state, data, { cats: t('الفئة', 'Category'), brands: t('الماركة', 'Brand'),
                                              price: t('السعر', 'Price'), clear: t('امسح الفلاتر', 'Clear filters') });
    // (A) facets() (storefront.js — not modifiable from here) renders no way to
    // dismiss the mobile full-screen sheet it becomes at <=860px
    // (`.facets.is-open`, see storefront.css). Splice an Apply/Done control
    // into the top of its own <form> so it scrolls with the sheet and needs no
    // CSS changes — wireBrowse() below makes it apply the pending fields
    // (min/max only fire `change` on blur) and, because that always triggers a
    // full re-render with no `.is-open` on the fresh markup, also closes the
    // sheet. Escape (wired below) closes it without applying.
    facetsHtml = facetsHtml.replace('<form class="facets" id="facets">',
      '<form class="facets" id="facets">' +
      '<button type="button" class="facet__clear facets__done" id="facetDone">' +
        U.esc(t('تم — اعرض النتائج', 'Done — show results')) + '</button>');

    // A search that matched nothing ("try another search") is a different
    // situation, honestly, from a category that has no products listed yet —
    // conflating them (as before) mislabels the 20 legitimately-empty
    // category pages, which never had a search to retry.
    var emptyMsg = state.q
      ? t('مفيش نتايج للبحث ده — جرّب كلمة تانية.', 'No results — try another search.')
      : t('لا يوجد منتجات فى هذا القسم حاليًا.', 'No products in this category yet.');

    root.innerHTML =
      // The site header (nav.js's `.sk-nav--solid`, z-index 70) sits fixed above
      // `.facets`' own z-index (60), so once the mobile sheet goes full-screen
      // (`.facets.is-open`, storefront.css) its first child — our Done control —
      // would otherwise render right underneath that header, unreachable. This
      // scoped rule (not a storefront.css edit — it's part of shop.js's own
      // markup) reserves the header's real measured height (nav.js's
      // `--sk-nav-h`, with the same fallback nav.js itself uses) only while the
      // sheet is open, on the breakpoint where it goes full-screen.
      '<style>@media (max-width:860px){#facets.is-open{padding-top:calc(var(--sk-nav-h,86px) + 16px)}}</style>' +
      U.adHero(adsFor(root, CACHE && CACHE.promos).hero) +
      U.breadcrumb([{ label: t('البيت', 'Home'), href: P('index.html') },
                    { label: t('المتجر', 'Shop'), href: P('shop.html') }, { label: title }]) +
      '<div class="shopgrid">' +
        '<aside class="shopgrid__side">' +
          '<button type="button" class="facets__toggle" id="facetToggle">' + t('الفلاتر', 'Filters') + '</button>' +
          facetsHtml +
        '</aside>' +
        '<div class="shopgrid__main">' +
          U.toolbar(state, pg.total, { count: function (n) { return t(n + ' منتج', n + ' products'); }, sorts: SORT_LABELS }) +
          (pg.total ? '<div class="grid">' + pg.items.map(function (p) { return U.card(p, {}); }).join('') + '</div>'
                    : '<p class="empty">' + emptyMsg + '</p>') +
          U.pager(pg.page, pg.pages, function (n) {
            // Pinned exactly like go()'s fixed branch: stay on this category's
            // own path, not shop.html — the pager must not be the one control
            // that silently relocates the user off a category page.
            var path = fixed ? location.pathname : P('shop.html');
            return path + C.stateToSearch(Object.assign({}, state, { cat: fixed ? '' : state.cat, page: n }));
          }) +
        '</div>' +
      '</div>';
    U.afterGrid(root);
    wireAdStrap(root);
    wireBrowse(root, state);
  }

  // Module-scoped so wireBrowse() can remove the *previous* render's Escape
  // listener before adding the new one (see the note beside its use below).
  var ESC_HANDLER = null;

  // ---- advertising strap ------------------------------------------------
  // Module-scoped for the same reason ESC_HANDLER is: render() replaces the whole
  // of #shop-root on every facet change, so a timer started by a previous render
  // would keep firing against detached nodes and a new one would be started beside
  // it. Every render tears the old timer down first, so exactly one is ever live.
  var AD_TIMER = null;
  // The visibility listener lives on `document`, so it outlives the strap it was
  // bound for. Held module-scoped and swapped (not merely added) on every render,
  // exactly like ESC_HANDLER below: otherwise each facet change leaves another
  // listener behind holding a DETACHED strap, and the next tab switch has them all
  // call stopAdStrap() while only the live one can call start() again — the strap
  // silently stops rotating until the shopper clicks it. Observed and fixed here.
  var AD_VIS = null;

  function stopAdStrap() {
    if (AD_TIMER) { clearInterval(AD_TIMER); AD_TIMER = null; }
  }

  // The page content is capped at 1440px, so negating the wrap's padding alone left
  // the strap 36px short of each edge on a wider screen. Publish the EXACT distance
  // from the wrap's content box to each viewport edge so the strap can cancel it.
  // Deliberately measured rather than done in pure CSS: `100vw` and `50vw` include
  // the vertical scrollbar, so the usual full-bleed trick pushes the whole page
  // sideways by its width. documentElement.clientWidth excludes it.
  function syncBleed() {
    var root = document.getElementById('shop-root');
    if (!root) return;
    var r = root.getBoundingClientRect();
    var cs = window.getComputedStyle(root);
    var vw = document.documentElement.clientWidth;
    var l = r.left + parseFloat(cs.paddingLeft || 0);
    var rt = vw - (r.right - parseFloat(cs.paddingRight || 0));
    var el = document.documentElement.style;
    el.setProperty('--sk-bleed-l', Math.max(0, l) + 'px');
    el.setProperty('--sk-bleed-r', Math.max(0, rt) + 'px');
  }
  // Bound once, not per render: render() runs on every facet change and would
  // otherwise stack a new resize listener each time.
  window.addEventListener('resize', syncBleed);

  function wireAdStrap(root) {
    stopAdStrap();
    var strap = root.querySelector('#adStrap');
    var slides = strap ? [].slice.call(strap.querySelectorAll('.adhero__slide')) : [];
    // No strap on this render (a category page), or a single ad that never
    // rotates: drop the document-level listener too, or it keeps a detached strap
    // alive and goes on stopping a timer it can never restart.
    if (!strap || slides.length < 2) {
      if (AD_VIS) { document.removeEventListener('visibilitychange', AD_VIS); AD_VIS = null; }
      if (strap) syncBleed();
      return;
    }
    syncBleed();
    var dots = [].slice.call(strap.querySelectorAll('.adhero__dot'));
    var at = 0;

    function show(next) {
      at = (next + slides.length) % slides.length;
      slides.forEach(function (s, i) {
        var on = i === at;
        s.classList.toggle('is-on', on);
        // Keep the off-screen slides out of the tab order and off the a11y tree,
        // or a keyboard user tabs into links they cannot see.
        if (on) { s.removeAttribute('aria-hidden'); s.removeAttribute('tabindex'); }
        else { s.setAttribute('aria-hidden', 'true'); s.setAttribute('tabindex', '-1'); }
      });
      dots.forEach(function (d, i) {
        d.classList.toggle('is-on', i === at);
        d.setAttribute('aria-selected', i === at ? 'true' : 'false');
      });
    }

    // Someone who has asked for less motion gets the controls but no auto-advance.
    var still = false;
    try { still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    function start() {
      if (still) return;
      stopAdStrap();
      AD_TIMER = setInterval(function () { show(at + 1); }, 5000);
    }

    strap.addEventListener('click', function (ev) {
      var nav = ev.target.closest('[data-step]');
      var dot = ev.target.closest('[data-go]');
      if (!nav && !dot) return;
      ev.preventDefault();                   // the slide itself is a link
      show(nav ? at + parseInt(nav.getAttribute('data-step'), 10) : parseInt(dot.getAttribute('data-go'), 10));
      start();                               // restart the dwell after a manual move
    });
    // Pause while the shopper is reading or tabbing through it.
    strap.addEventListener('mouseenter', stopAdStrap);
    strap.addEventListener('mouseleave', start);
    strap.addEventListener('focusin', stopAdStrap);
    strap.addEventListener('focusout', start);
    // A backgrounded tab should not keep cycling. Swapped, never stacked.
    if (AD_VIS) document.removeEventListener('visibilitychange', AD_VIS);
    AD_VIS = function () {
      if (document.hidden) stopAdStrap();
      else if (document.body.contains(strap)) start();
    };
    document.addEventListener('visibilitychange', AD_VIS);

    show(0);
    start();
  }

  // Reads the advanced panel and turns it into one navigation. Kept beside
  // wireSearch so both entry points into a search live together.
  function wireAdvanced(root, state) {
    var pick = function (id) { var el = root.querySelector(id); return el ? el.value.trim() : ''; };
    var apply = root.querySelector('#asApply');
    if (apply) apply.addEventListener('click', function () {
      var brand = pick('#asBrand');
      var min = pick('#asMin'), max = pick('#asMax');
      var cat = pick('#asCat');
      var qEl = root.querySelector('#q');
      var q = qEl ? qEl.value.trim() : '';
      go({
        cat: cat,
        q: q,
        brands: brand ? [brand] : [],
        min: min === '' ? null : parseInt(min, 10),
        max: max === '' ? null : parseInt(max, 10),
        sort: pick('#asSort') || 'default',
        page: 1,
        // `all` only means "browse everything with no criteria". Setting it
        // alongside cat/q/price would render identically but leave a URL that
        // contradicts itself — the same wart the Clear handler avoids.
        all: !root.getAttribute('data-cat') && !cat && !q && !brand && min === '' && max === ''
      });
    });
    var reset = root.querySelector('#asReset');
    if (reset) reset.addEventListener('click', function () {
      go({ cat: '', q: '', brands: [], min: null, max: null, sort: 'default', page: 1,
           all: !root.getAttribute('data-cat') });
    });
  }

  // Every search submit re-renders the whole surface (innerHTML), which destroys
  // the input the shopper is typing in. Remember that the last navigation came
  // from the search box so the fresh one can take focus back with the caret at
  // the end — otherwise refining a search means re-clicking the field each time.
  var FOCUS_SEARCH = false;

  // One search-form binding shared by the hub and the browse toolbar. The form is
  // rendered by skShopUI.searchBox() on both, so the id is the same on both; only
  // what to do with the term differs. Submitting with an unchanged term is a
  // deliberate no-op — it must not push a duplicate history entry.
  function wireSearch(root, onSubmit, current) {
    var form = root.querySelector('#searchForm');
    var input = form && form.querySelector('#q');
    if (form) form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = input ? input.value.trim() : '';
      if (q === String(current == null ? '' : current)) return;
      FOCUS_SEARCH = true;
      onSubmit(q);
    });
    if (FOCUS_SEARCH && input) {
      FOCUS_SEARCH = false;
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    }
  }

  function wireBrowse(root, state) {
    // Search composes with every other facet: the term is carried through
    // unchanged in `state`, so cat/brand/price/sort/pagination all keep
    // narrowing the search results rather than replacing them.
    wireSearch(root, function (q) {
      // Emptying the box on shop.html means "show me everything", not "throw me
      // back to the hub" — `all` keeps the browse view alive with no filters.
      // A pinned category page needs none of that (render() forces all:false
      // there), so don't set the flag: it would render identically but leave a
      // meaningless `?all=1` in the URL, exactly the wart the Clear handler
      // below avoids with `all: !fixed`.
      go(Object.assign({}, state, { q: q, page: 1, all: !root.getAttribute('data-cat') && (state.all || !q) }));
    }, state.q);

    var form = root.querySelector('#facets');

    var fixed = root.getAttribute('data-cat');

    function applyForm() {
      var fd = new FormData(form);
      var newCat = fd.get('cat') || '';
      // On a category page the Category facet must not be a dead control: a
      // page cannot render two categories at once, so picking a DIFFERENT
      // one is a real navigation to that category's own page (catHref
      // already resolves correctly from /category/) rather than a value
      // go()/render() would just pin back to `fixed` anyway. Every other
      // facet (brand/price/sort) keeps the existing pinned-in-place behaviour.
      if (fixed && newCat && newCat !== fixed) {
        location.href = window.skApp.catHref(newCat);
        return;
      }
      go({
        cat: newCat, q: state.q,   // the search term survives every facet change
        brands: fd.getAll('brand'),
        min: fd.get('min') ? parseInt(fd.get('min'), 10) : null,
        max: fd.get('max') ? parseInt(fd.get('max'), 10) : null,
        sort: state.sort, page: 1, all: state.all
      });
    }

    if (form) {
      form.addEventListener('change', applyForm);
      // Never let the browser attempt a real form submission (Enter in a
      // number field can trigger one even with no submit button) — go()
      // through applyForm() is the only navigation this form should cause.
      form.addEventListener('submit', function (ev) { ev.preventDefault(); applyForm(); });
    }
    var clear = root.querySelector('#facetClear');
    if (clear) clear.addEventListener('click', function () {
      // `all: true` tells a non-fixed browse ("shop.html") to stay in browse
      // mode with every filter cleared. On a fixed category page render()
      // ignores `all` outright (it's always forced back to false), so
      // setting it here would only leave a meaningless `?all=1` in the URL.
      // "Clear filters" clears the search term too — it is a filter like any
      // other, it is rendered inside the same results toolbar, and leaving it
      // set would make the button visibly not clear the thing most likely to
      // be narrowing the results.
      go({ cat: '', q: '', brands: [], min: null, max: null, sort: 'default', page: 1, all: !fixed });
    });
    var sortSel = root.querySelector('#sortSel');
    if (sortSel) sortSel.addEventListener('change', function () {
      go(Object.assign({}, state, { sort: sortSel.value, page: 1 }));
    });
    var toggle = root.querySelector('#facetToggle');
    if (toggle && form) toggle.addEventListener('click', function () { form.classList.toggle('is-open'); });
    // (A) Mobile dismiss, continued: the Done control applies+closes (see
    // applyForm's re-render note above); Escape closes without applying, for
    // someone who opened the sheet and changed their mind. Escape must be
    // caught on `document` — right after opening, focus is still on the
    // #facetToggle button *outside* the form (it becomes visually hidden
    // underneath the fixed sheet, but keeps focus), so a keydown listener
    // scoped to the form itself would never see that keypress. ESC_HANDLER
    // is swapped out (not merely added) on every render so re-renders never
    // accumulate a second, third, ... stale document-level listener.
    var done = root.querySelector('#facetDone');
    if (done && form) done.addEventListener('click', applyForm);
    if (ESC_HANDLER) document.removeEventListener('keydown', ESC_HANDLER);
    ESC_HANDLER = form ? function (ev) {
      if (ev.key === 'Escape' && form.classList.contains('is-open')) {
        ev.preventDefault();
        form.classList.remove('is-open');
      }
    } : null;
    if (ESC_HANDLER) document.addEventListener('keydown', ESC_HANDLER);
  }

  var CACHE = null;
  function render() {
    var root = document.getElementById('shop-root');
    // A category page (data-cat on #shop-root — see site/mkcategories.mjs)
    // pins its category regardless of the URL: state.cat is forced to it and
    // `all` (which would otherwise show every category) is cleared so the
    // page always renders that one category's browse view, never the hub.
    var fixed = root.getAttribute('data-cat');
    var state = C.parseState(location.search);
    if (fixed) { state.cat = fixed; state.all = false; }
    if (C.isBrowse(state)) {
      renderBrowse(root, state, CACHE.products);
    } else {
      // Leaving browse for the hub: `go()` reaches here through render()
      // itself (not only via popstate) whenever a facet change makes
      // isBrowse() false again (e.g. clearing the last min/max), which can
      // happen with the mobile sheet still `.is-open`. wireBrowse()'s
      // ESC_HANDLER is otherwise only swapped out on the *next* browse
      // render, so tear it down here too or it stays attached to `document`
      // referencing a now-detached (but still `.is-open`) form.
      if (ESC_HANDLER) { document.removeEventListener('keydown', ESC_HANDLER); ESC_HANDLER = null; }
      renderHub(root, CACHE.products, CACHE.promos);
    }
  }
  window.addEventListener('popstate', render);

  function boot() {
    // A category page (data-cat) always renders renderBrowse, never renderHub
    // — the only consumer of promos — so fetching promos.json there is pure
    // wasted work; skip the request entirely instead of fetching and discarding.
    var fixedPage = document.getElementById('shop-root').getAttribute('data-cat');
    var promos = fixedPage ? Promise.resolve(null)
      : fetch(P('data/promos.json')).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    // Which brands actually have a logo file. Asking for every brand's logo and
    // letting the missing ones 404 into the wordmark fallback worked, but cost one
    // failed request per brand on every load — 12 of them with nothing shipped yet.
    // The manifest keeps that at zero and makes "drop a file in" an explicit,
    // reviewable edit. A missing or broken manifest simply means no logos.
    var logos = fetch(P('assets/img/brands/logos.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && Array.isArray(d.logos)) ? d.logos : []; })
      .catch(function () { return []; });
    Promise.all([
      window.skApp.products(),
      promos,
      logos
    ]).then(function (res) {
      CACHE = { products: res[0], promos: (res[1] && res[1].promos) || null, logos: res[2] || [] };
      render();
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    if (EN) {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      // On a category page nav.js's translateCategoryPage() already rewrote
      // <title> to "<Category> — SADKO Group" earlier in this same
      // DOMContentLoaded phase (nav.js's listener runs first — it's added
      // first, since nav.js is the earlier <script> tag). Only shop.html
      // itself (no data-cat) needs the generic title here; overwriting it
      // unconditionally would blank out the category name on every one of
      // the 30 category pages in EN mode.
      var root0 = document.getElementById('shop-root');
      if (!(root0 && root0.getAttribute('data-cat'))) document.title = 'Shop — SADKO Group';
      var l = document.querySelector('[data-i18n="loading"]');
      if (l) l.textContent = 'Loading…';
    }
    window.skApp.footer();
    boot();
  });
})();
