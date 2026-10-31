/* SADKO shop-core — pure catalogue + URL-state logic. No DOM, no globals read.
   Loaded as a classic script in the browser (window.skShopCore) and required
   directly by node --test, so it must stay free of browser-only APIs. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.skShopCore = api;
})(this, function () {
  'use strict';

  var SORTS = ['default', 'price-asc', 'price-desc', 'newest', 'best'];

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
      /* Ecwid uses 0 for "no category" and the mapper turns that into null, so
         7 products in the live store (gym equipment) have none at all. They
         used to be counted under String(null) === "null", which produced a
         facet with no name — appshell fell back to the generic "فئة" /
         "Category" — that led to an empty page when clicked, since no product
         matches the id "null".

         They are skipped here rather than bucketed: unlike a missing BRAND,
         which a shopper might deliberately filter on, nobody asks to see the
         uncategorised. The products stay in the unfiltered listing and in
         search; they simply have no category facet to reach them by. */
      if (p.categoryId == null || p.categoryId === "") return;
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
    // The live (Ecwid) catalogue carries a brand and a SKU on every product.
    // Both are things shoppers type ("kiriazi", "KWD A 3.1"), so they are part
    // of a product's identity even when the title spells them differently.
    if (p.brand) id.push(norm(p.brand));
    if (p.sku) id.push(norm(p.sku));
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

  /* ---- typo tolerance ------------------------------------------------------
     Damerau-Levenshtein with an early bail: it stops as soon as the whole row
     exceeds `max`, so comparing a query word against thousands of catalogue words
     costs a few operations each rather than a full matrix. Transpositions count
     as one edit because they are the typo people actually make — "ثلاحة" for
     "ثلاجة", "refrigirator", "wahsing" — and treating those as two edits would
     need a threshold loose enough to also match unrelated words. */
  function editDistance(a, b, max) {
    if (a === b) return 0;
    var al = a.length, bl = b.length;
    if (Math.abs(al - bl) > max) return max + 1;
    var prev2 = [], prev = [], cur = [], i, j;
    for (j = 0; j <= bl; j++) prev[j] = j;
    for (i = 1; i <= al; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= bl; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;          // no cell can improve from here
      prev2 = prev.slice(); prev = cur.slice();
    }
    return prev[bl];
  }

  /* How wrong a word may be before it stops being the same word. Scaled by
     length, because one edit in a 4-letter word is a different claim from one
     edit in a 12-letter one. Words of 3 characters or fewer get NO tolerance at
     all: at that length nearly everything is one edit from everything else
     ("tv"/"to", "فرن"/"فرش"), and the model numbers in this catalogue would
     start matching each other. */
  function fuzzMax(w) { return w.length <= 3 ? 0 : (w.length <= 6 ? 1 : 2); }

  // Does any WORD of the haystack read as a typo of `needle`?
  function fuzzyHit(hay, needle) {
    var max = fuzzMax(needle);
    if (!max) return false;
    var words = hay.split(/[^0-9a-z؀-ۿ]+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || Math.abs(w.length - needle.length) > max) continue;
      if (editDistance(needle, w, max) <= max) return true;
    }
    return false;
  }

  /* The fuzzy pass is a FALLBACK, never a widening of a good result set: a search
     that found something exactly keeps exactly what it found. Only a query that
     returned nothing is retried with typos allowed, which is the moment the
     shopper is staring at "no results" for a word they believe they typed. */
  /* Typos have to reach the SYNONYM table too, not just the catalogue text.
     The catalogue is Arabic, so "fridge" only finds anything because the table
     maps it onto "ثلاجة" — which meant "fridgee" found nothing at all: the word
     was one keystroke from a dictionary key, but the fuzzy pass was only ever
     comparing it against Arabic product titles it could never be close to. Same
     for "تكيف", a common shortening that is one edit from "تكييف".
     Expanded once per query, not once per product: the table is ~60 keys and
     there are 471 products. */
  var SYN_KEYS = Object.keys(SYN_INDEX);
  function fuzzyExpand(parsed) {
    var out = { must: [], typed: parsed.typed, phrases: parsed.phrases, not: parsed.not };
    parsed.must.forEach(function (variants, i) {
      var word = parsed.typed[i];
      var max = fuzzMax(word);
      var extra = [];
      if (max) {
        SYN_KEYS.forEach(function (k) {
          if (variants.indexOf(k) >= 0) return;
          if (Math.abs(k.length - word.length) > max) return;
          if (editDistance(word, k, max) > max) return;
          SYN_INDEX[k].forEach(function (w) {
            if (variants.indexOf(w) < 0 && extra.indexOf(w) < 0) extra.push(w);
          });
        });
      }
      out.must.push(variants.concat(extra));
    });
    return out;
  }

  function matchesFuzzy(p, parsed, trTitle, specOf) {
    if (!parsed.must.length) return false;
    var hay = haystacks(p, trTitle, specOf);
    for (var i = 0; i < parsed.not.length; i++) if (hit(hay.full, parsed.not[i])) return false;
    for (var k = 0; k < parsed.must.length; k++) {
      var variants = parsed.must[k], found = false;
      for (var v = 0; v < variants.length; v++) {
        var where = (variants[v] === parsed.typed[k]) ? hay.full : hay.identity;
        if (hit(where, variants[v]) || fuzzyHit(where, variants[v])) { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  /* Every category id a product belongs to. p.categoryId is only the DEFAULT
     one, and 70 products in the live store sit in more than one category — so
     reading the single field made them invisible in every category but one. */
  function catIdsOf(p) {
    if (p && p.categoryIds && p.categoryIds.length) return p.categoryIds;
    return (p && p.categoryId != null) ? [p.categoryId] : [];
  }

  /* Does this product belong in the category being browsed?

     state.catSet, when present, is the wanted category PLUS all of its
     descendants (built by catFamily below). It is what makes a parent
     category page work: Ecwid files a product under the child only — a fridge
     in "نو فروست" does not list "ثلاجات" — so matching the parent id alone
     found nothing and the fridges page was empty with 217 fridges one level
     down.

     Without catSet the behaviour is the plain id comparison it always was,
     so a caller that has no taxonomy loaded is unaffected. */
  function inCategory(p, state) {
    var ids = catIdsOf(p);
    var set = state.catSet;
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i]);
      if (set ? set[id] === true : id === String(state.cat)) return true;
    }
    return false;
  }

  /* A category and everything under it, as a plain lookup object.

     Walks DOWN from the wanted id rather than up from each category, so the
     cost is the size of the subtree and a cycle in the data (which Ecwid
     should never produce, but this must not hang on) is bounded by the seen
     check. Returns null for a missing id so callers fall back to the plain
     comparison instead of matching nothing. */
  function catFamily(catId, categories) {
    if (catId == null || !categories || !categories.length) return null;
    var want = String(catId);
    var kids = {};
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i];
      if (!c || c.id == null) continue;
      var par = c.parentId == null ? '' : String(c.parentId);
      if (!kids[par]) kids[par] = [];
      kids[par].push(String(c.id));
    }
    var out = {}, queue = [want];
    out[want] = true;
    while (queue.length) {
      var cur = queue.shift();
      var ch = kids[cur] || [];
      for (var j = 0; j < ch.length; j++) {
        if (out[ch[j]] !== true) { out[ch[j]] = true; queue.push(ch[j]); }
      }
    }
    return out;
  }

  function filter(products, state, specOf, trTitle) {
    // Parse once for the whole pass, not once per product: expanding synonyms for
    // every one of 471 products on every keystroke-free re-render is wasted work.
    var q = parseQuery(state.q);
    function facets(p) {
      if (state.cat && !inCategory(p, state)) return false;
      if (state.min != null && !(p.price >= state.min)) return false;
      if (state.max != null && !(p.price < state.max)) return false;
      if (state.brands && state.brands.length) {
        var b = (specOf(p) || {}).brand;
        var key = (b && (b.key || b.en || b.ar)) ? String(b.key || b.en || b.ar).toLowerCase() : '__none__';
        if (state.brands.indexOf(key) < 0) return false;
      }
      return true;
    }
    var out = products.filter(function (p) { return facets(p) && matchesQuery(p, q, trTitle, specOf); });
    if (!q.must.length) return out;
    /* When to spell-correct. Not simply "when nothing matched": "تكيف" (a common
       short spelling of تكييف) and "خلات" (خلاط) each land a handful of incidental
       substring hits — 6 and 1 against the 30 and 31 the correct spelling finds —
       so a zero-results test would leave the shopper on a page that looks answered
       and is not. The rule is instead:

         • the result set is thin (under 3), AND
         • at least one typed word is one this catalogue does not KNOW — not a
           synonym-table key, and not model-like (no digits).

       Both halves matter. The "not a known word" half is what stops a correctly
       spelled query being widened into its neighbours: "cooler" and "cooker" are
       one edit apart, and correcting the first into the second would put ovens in
       a water-cooler search. The "no digits" half protects model numbers, which
       are long enough for two edits of tolerance and would otherwise start
       matching each other. */
    var thin = out.length < 3;
    function correctable(w) { return !SYN_INDEX[w] && !/[0-9]/.test(w) && fuzzMax(w) > 0; }
    var unknown = q.typed.some(correctable);
    /* One case overrides the "thin" test: a word this catalogue does not know that
       sits ONE edit from a word it does. That is a spelling correction against a
       curated vocabulary, not a guess against arbitrary text, so it is trustworthy
       even when the misspelling happened to land some incidental hits — "تكيف"
       collects 6 substring matches while the 30 air conditioners it means sit
       behind "تكييف", and 6 results look answered enough that nobody retypes.
       Distance is capped at 1 here rather than the usual length-scaled tolerance:
       at 2 edits, real words start reaching each other's meanings. */
    var nearKnownWord = q.typed.some(function (w) {
      if (!correctable(w) || w.length < 4) return false;
      return SYN_KEYS.some(function (k) { return editDistance(w, k, 1) <= 1; });
    });
    if (!nearKnownWord && (!thin || !unknown)) return out;
    // matchesFuzzy accepts everything matchesQuery does, so this is a superset:
    // the exact hits stay, the corrections join them.
    var fq = fuzzyExpand(q);
    return products.filter(function (p) { return facets(p) && matchesFuzzy(p, fq, trTitle, specOf); });
  }

  /* ---- as-you-type suggestions --------------------------------------------
     Ranked across three kinds of answer, because "what did you mean" is rarely
     just a product: a shopper typing "ثلاج" almost always wants the CATEGORY, and
     one typing "كريازي" wants the BRAND. Products come last and are capped, so a
     category never gets pushed off the list by seven of its own members.

     Scoring is deliberately coarse and stable — exact, then starts-with, then
     word-starts-with, then contains, then typo — so the order never jitters
     between keystrokes. Ties break on how much of the label the query accounts
     for, which floats "ثلاجات" above "ثلاجات نوفروست ديجيتال" for the query
     "ثلاجات". Everything is matched on normalised text, so Arabic spelling
     variants (ة/ه, ى/ي, أ/ا) and harakat cost the shopper nothing.

     `sources` is prepared by the caller (it owns naming and translation):
       { cats: [{id, name, count}], brands: [{key, name, count}], products: [...] }
     Returns [{ kind, label, sub, count, id|key|product, score }]. */
  function words(s) { return s.split(/[^0-9a-z؀-ۿ]+/).filter(Boolean); }

  /* A suggestion list is judged mid-word, which is why this is not just the
     search matcher again. Someone three letters into "ثلاجة" has typed a PREFIX,
     not a word — and a prefix is far (in edit distance) from the word it will
     become, so plain fuzzy matching finds nothing exactly when help is most
     wanted. Every rung below therefore has a prefix form, and the typo rung
     compares the query against the same LENGTH of each candidate word: "ثلاح"
     against "ثلاج" of "ثلاجات", one edit, a hit. */
  function scoreLabel(label, needle) {
    var l = norm(label);
    if (!l || !needle) return 0;
    if (l === needle) return 100;
    if (l.indexOf(needle) === 0) return 80;
    var ws = words(l);
    for (var i = 0; i < ws.length; i++) if (ws[i].indexOf(needle) === 0) return 60;
    if (l.indexOf(needle) > 0) return 40;
    var max = fuzzMax(needle);
    if (max) {
      for (var j = 0; j < ws.length; j++) {
        var head = ws[j].slice(0, needle.length);
        if (head.length >= needle.length - max && editDistance(needle, head, max) <= max) return 25;
      }
      if (fuzzyHit(l, needle)) return 20;
    }
    return 0;
  }

  /* What else the shopper might mean by what they have typed so far. The
     catalogue is Arabic, so without this an English shopper typing "fridg" gets
     an empty list from a shop that has 75 refrigerators. Keys are matched by
     prefix as well as exactly, because the query is still being typed, and a
     one-edit correction is folded in for the same reason the filter does it. */
  function queryAliases(needle) {
    var out = [];
    if (needle.length < 2) return out;
    SYN_KEYS.forEach(function (k) {
      var near = k.indexOf(needle) === 0 || k === needle ||
                 (needle.length >= 4 && editDistance(needle, k, 1) <= 1);
      if (!near) return;
      SYN_INDEX[k].forEach(function (w) { if (w !== needle && out.indexOf(w) < 0) out.push(w); });
    });
    return out;
  }

  function suggest(query, sources, opts) {
    var o = opts || {};
    var needle = norm(query);
    if (needle.length < 2) return [];
    var limit = o.limit || 8;
    var aliases = queryAliases(needle);
    // The typed text always outranks what it was expanded into, so a direct hit
    // can never be pushed below a synonym's.
    function best(label) {
      var s = scoreLabel(label, needle);
      for (var i = 0; i < aliases.length && s < 80; i++) {
        s = Math.max(s, Math.round(scoreLabel(label, aliases[i]) * 0.75));
      }
      return s;
    }
    var out = [];
    var seen = {};
    function push(kind, label, score, extra) {
      if (!score) return;
      var key = kind + '\u0000' + norm(label);
      if (seen[key]) return;
      seen[key] = 1;
      // Shorter labels win ties: the query accounts for more of them.
      var tie = Math.min(19, Math.round(19 * needle.length / Math.max(needle.length, norm(label).length)));
      /* A category outranks a product that scored the same, and a brand outranks
         a product too. Someone typing "ثلاج" wants the aisle, not the fifth
         refrigerator in it — and the catalogue spells some categories the way
         products are titled ("تكيف هاير"), so on raw text score alone the aisle
         lost to its own members. Small deliberate weights, not a hard grouping:
         a model number still brings its product straight to the top, because no
         category matches it at all. */
      var kindWeight = kind === "cat" ? 12 : (kind === "brand" ? 8 : 0);
      out.push(Object.assign({ kind: kind, label: label, score: score + tie + kindWeight }, extra || {}));
    }
    /* An entry's `alt` is the SAME name in the other language. This is a
       bilingual shop in a bilingual country: people type Arabic into the English
       site and Latin brand names into the Arabic one, all day. Both spellings are
       searched; only `name` — the one matching the page — is ever shown, so the
       list never answers in a language the rest of the page is not speaking. */
    (sources.cats || []).forEach(function (c) {
      push('cat', c.name, Math.max(best(c.name), c.alt ? best(c.alt) : 0), { id: c.id, count: c.count });
    });
    (sources.brands || []).forEach(function (b) {
      push('brand', b.name, Math.max(best(b.name), b.alt ? best(b.alt) : 0), { key: b.key, count: b.count });
    });
    // Products are scored against the same identity text the search itself uses,
    // so a suggestion can never be something the search would not then find.
    var prods = [];
    (sources.products || []).forEach(function (p) {
      var hay = haystacks(p, o.trTitle, o.specOf);
      var s = best(p.title);
      if (!s && o.trTitle) { try { s = best(o.trTitle(p.title)); } catch (e) {} }
      if (!s && hit(hay.identity, needle)) s = 30;
      if (!s && fuzzyHit(hay.identity, needle)) s = 15;
      if (s) prods.push({ p: p, s: s });
    });
    prods.sort(function (a, b) { return b.s - a.s || a.p.title.length - b.p.title.length; });
    /* The row is labelled the way the page labels the same product elsewhere —
       optional labelOf, so an English page suggests the English title its cards
       are showing rather than the Arabic one underneath. Matching still happened
       against both, above. */
    prods.slice(0, o.productLimit || 5).forEach(function (r) {
      var label = r.p.title;
      if (o.labelOf) { try { label = o.labelOf(r.p) || label; } catch (e) {} }
      push('product', label, r.s, { product: r.p });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, limit);
  }

  // ctx.bestIds: set of category ids {id:true} that staff curate as "best sellers".
  // There is no sales data to rank by, so 'best' means exactly that curated
  // category first, and is only offered when it exists.
  function sortList(list, sort, ctx) {
    var out = list.slice();
    if (sort === 'price-asc') out.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price-desc') out.sort(function (a, b) { return b.price - a.price; });
    else if (sort === 'newest') out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    else if (sort === 'best') {
      var set = (ctx && ctx.bestIds) || {};
      var isBest = function (p) { return catIdsOf(p).some(function (id) { return set[String(id)] === true; }); };
      var yes = out.filter(isBest), no = out.filter(function (p) { return !isBest(p); });
      out = yes.concat(no);
    }
    // Whatever the shopper sorted by, what they cannot buy goes last. The data
    // layer already partitions on stock, but a price sort re-orders the WHOLE
    // list and would scatter unavailable products back through the grid — 470
    // of the 990 products Ecwid shows are out of stock. Being out of stock is
    // never a reason to DROP a product, only to rank it last.
    return outOfStockLast(out);
  }

  // Stable: in-stock keep their relative order, then out-of-stock keep theirs.
  function outOfStockLast(list) {
    var yes = [], no = [];
    for (var i = 0; i < list.length; i++) {
      (list[i] && list[i].inStock === false ? no : yes).push(list[i]);
    }
    return yes.concat(no);
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

  return { SORTS: SORTS, catIdsOf: catIdsOf, inCategory: inCategory, catFamily: catFamily, parseState: parseState, stateToSearch: stateToSearch, isBrowse: isBrowse, PRICE_BANDS: PRICE_BANDS, liveCategories: liveCategories, brandsOf: brandsOf, filter: filter, matchesQuery: matchesQuery, parseQuery: parseQuery, norm: norm, localizePromos: localizePromos, bandCounts: bandCounts, sortList: sortList, paginate: paginate, suggest: suggest, queryAliases: queryAliases, editDistance: editDistance, fuzzyHit: fuzzyHit };
});
