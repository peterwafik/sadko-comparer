/* ============================================================================
   SADKO global navigation + cart.
   ----------------------------------------------------------------------------
   One script, included on every page:
     <script src="assets/js/nav.js" defer></script>            (site root)
     <script src="../assets/js/nav.js" defer></script>         (category/*)

   Core-pages top strap (the room dock keeps handling scene navigation):
     [logo · right] | centered iOS-glass pill: الرئيسية · المتجر ▾ · الطلبات ·
     المعارض | [hotline] [🛒 cart · far LEFT in RTL].
   المتجر opens a COMPACT glass dropdown listing just the category titles;
   titles that have subcategories expand in place (accordion) on click.

   Modes: overlay (home, #world present) vs solid (subpages — sticky glass bar,
   replaces any legacy <header class="top">).

   Cart: localStorage 'sadko-cart-v1' via window.skCart; category pages get
   "أضف للسلة" buttons matched to data/products.json by product URL.
   ========================================================================== */

(function () {
  const script = document.currentScript;
  const ROOT = (script && script.getAttribute('data-root')) ||
    (location.pathname.replace(/\\/g, '/').includes('/category/') ? '../' : '');
  const P = p => ROOT + p;
  const C = id => P(`category/${id}.html`);

  /* ---- pages switched off for the launch ----
     The price comparer needs the Node engine, which the Vercel launch does not
     run, and "My appliances" is not part of the first release. Their files stay
     in the repo; listing a page here takes it out of every menu, footer, button
     and sentence that points at it, and sends a direct visit to the home page.
     Empty this list to bring them back. Page scripts ask skFeature.on('compare').
     'plan' (Shopping plans) and 'guides' (Buying guides) were switched off on
     2026-10-31 at the owner's request, everywhere including the admin portal. */
  const HIDDEN_PAGES = ['compare', 'appliances', 'plan', 'guides'];
  // "compare.html?q=x", "../compare.html" and Vercel's clean "/compare" all name the same page
  const pageOf = href => String(href || '').replace(/\\/g, '/').split(/[?#]/)[0].split('/').pop().replace(/\.html?$/, '');
  window.skFeature = {
    hidden: href => HIDDEN_PAGES.includes(pageOf(href)),
    on: name => !HIDDEN_PAGES.includes(name),
  };
  if (window.skFeature.hidden(location.pathname)) { location.replace(P('index.html')); return; }
  /* pages merged into another one: the old address still works and lands on
     the right section (Our values became part of About us on 2026-10-31) */
  const MOVED_PAGES = { values: 'about.html#values' };
  if (MOVED_PAGES[pageOf(location.pathname)]) { location.replace(P(MOVED_PAGES[pageOf(location.pathname)])); return; }
  /* ---- social links (footer, every page) ---- */
  const SOCIAL = [
    ['Instagram', 'https://www.instagram.com/sadkogroup/', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>'],
    ['Facebook', 'https://www.facebook.com/SADKOGROUP', '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.6 21v-7.7h2.6l.4-3h-3V8.4c0-.9.3-1.5 1.5-1.5h1.6V4.2c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.9v3h2.6V21h3.1z"/></svg>'],
    ['YouTube', 'https://www.youtube.com/channel/UC8mVvjTFjOxbpju5vFig-Zg', '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg>'],
  ];
  /* The footer's small print. The old wording explained third-party sellers,
     which only exist while the price comparer is on; with it switched off the
     footer speaks for SADKO alone. The seller sentence returns with the comparer. */
  window.skLegal = () => {
    const ar = LANG !== 'en';
    let txt = ar
      ? 'نحدّث الأسعار والعروض والتوافر باستمرار، وقد تتغير دون إشعار مسبق. صور المنتجات للتوضيح، والمواصفات وفق بيانات الشركة المصنّعة. ولأى استفسار، فريق خدمة العملاء فى انتظارك على 19140.'
      : 'Prices, offers and availability are updated regularly and may change without prior notice. Product images are for illustration, and specifications follow the manufacturer’s data. For any question, our customer care team is ready to help on 19140.';
    if (window.skFeature && window.skFeature.on('compare')) txt += ar
      ? ' وتغطى مقارنة الأسعار متاجر مدعومة محددة، ويقدّم الضمان والتركيب والاسترجاع البائع المذكور فى كل عرض.'
      : ' Price comparison covers a specific list of supported stores; warranty, installation and returns come from the seller named on each offer.';
    return txt;
  };
  window.skSocial = () => '<div class="foot__social">' + SOCIAL.map(s =>
    '<a href="' + s[1] + '" target="_blank" rel="noopener" aria-label="' + s[0] + '" title="' + s[0] + '">' + s[2] + '</a>').join('') + '</div>';

  const shown = href => !window.skFeature.hidden(href);

  /* ---- clean addresses: no page path ends in ".html" ----
     The server and vercel.json (cleanUrls) serve /shop for shop.html and
     redirect old .html addresses. Page scripts still build "shop.html?cat=1"
     links, so every link on the page is rewritten to its clean form, and the
     addresses scripts push into the history are cleaned the same way; that is
     the one place it can be done for every page at once. */
  function cleanHref(h) {
    const s = String(h == null ? '' : h);
    const m = /^(\/?(?:\.\.?\/)*(?:[A-Za-z0-9_-]+\/)*)([A-Za-z0-9_-]+)\.html(?=$|[?#])(.*)$/.exec(s);
    if (!m) return s;                                   // absolute URLs, tel:, #, assets/… stay as they are
    return m[2] === 'index' ? (m[1] || './') + m[3] : m[1] + m[2] + m[3];
  }
  window.skCleanHref = cleanHref;
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k].bind(history);
    history[k] = (state, title, url) => orig(state, title, url == null ? url : cleanHref(url));
  });
  if (/\.html$/.test(location.pathname)) history.replaceState(history.state, '', cleanHref(location.pathname.split('/').pop()) + location.search + location.hash);
  function cleanLinks(root) {
    const links = root.matches && root.matches('a[href]') ? [root] : [...root.querySelectorAll('a[href]')];
    links.forEach(a => { const h = a.getAttribute('href'), c = cleanHref(h); if (c !== h) a.setAttribute('href', c); });
  }

  /* ---- site language: 'ar' (default) | 'en' — persisted, toggle in the strap.
     Pages read window.skLang.get() to localize their own content. ---- */
  const LANG_KEY = 'sadko-lang';
  let LANG; try { LANG = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar'; } catch (e) { LANG = 'ar'; }
  window.skLang = {
    get: () => LANG,
    set(l) { try { localStorage.setItem(LANG_KEY, l === 'en' ? 'en' : 'ar'); } catch (e) {} location.reload(); },
  };
  const N = {
    ar: { home: 'الرئيسية', shop: 'المتجر', all: 'كل المنتجات', allPrefix: 'كل ', compare: 'قارن الأسعار',
      orders: 'الطلبات', showrooms: 'المعارض', call: 'اتصل 19140', cartAria: 'سلة التسوق',
      finder: 'ساعدنى أختار', plan: 'خطط التجهيز', guides: 'دليلك للاختيار', care: 'خدمة العملاء',
      savedAria: 'المنتجات المحفوظة', acctAria: 'حسابى', details: 'التفاصيل والمقاس',
      more: 'المزيد', appliances: 'أجهزتى', account: 'حسابى', saved: 'المحفوظات', cart: 'السلة',
      grpBefore: 'قبل الشراء', grpAfter: 'بعد الشراء', menu: 'القائمة', close: 'إغلاق',
      contact: 'تواصل معنا', search: 'بحث', searchPh: 'ابحث عن منتج، ماركة، قسم أو موديل…', searchAll: 'كل النتائج فى المتجر', searchNone: 'لا توجد نتائج مطابقة، جرّب كلمة أخرى.', searchCats: 'أقسام', searchBrands: 'ماركات', searchItems: 'منتجات', searchLoading: 'جارٍ التحميل…', searchHint: 'اكتب حرفين على الأقل', outStock: 'غير متوفر',
      pagesAria: 'صفحات الموقع', add: 'أضف للسلة', added: '✓ أُضيف', maxQty: 'وصلت للحد المتاح', soldOut: 'غير متوفر حالياً', langBtn: 'EN', langTitle: 'Switch to English' },
    en: { home: 'Home', shop: 'Shop', all: 'All products', allPrefix: 'All ', compare: 'Compare Prices',
      orders: 'Orders', showrooms: 'Showrooms', call: 'Call 19140', cartAria: 'Shopping cart',
      finder: 'Help me choose', plan: 'Shopping plans', guides: 'Buying guides', care: 'Customer care',
      savedAria: 'Saved products', acctAria: 'My account', details: 'Details & size',
      more: 'More', appliances: 'My appliances', account: 'My account', saved: 'Saved', cart: 'Cart',
      grpBefore: 'Plan your purchase', grpAfter: 'After buying', menu: 'Menu', close: 'Close',
      contact: 'Contact us', search: 'Search', searchPh: 'Search products, brands, categories or models…', searchAll: 'All results in the shop', searchNone: 'No matching items. Try another word.', searchCats: 'Categories', searchBrands: 'Brands', searchItems: 'Products', searchLoading: 'Loading…', searchHint: 'Type at least two letters', outStock: 'Out of stock',
      pagesAria: 'Site pages', add: 'Add to cart', added: '✓ Added', maxQty: 'Max available in cart', soldOut: 'Out of stock', langBtn: 'ع', langTitle: 'التبديل إلى العربية' },
  }[LANG];
  const CAT_EN = {
    'ثلاجات': 'Refrigerators', 'نو فروست': 'No frost', 'ديفروست': 'Defrost',
    'فريزرات': 'Freezers', 'فريزر أفقى': 'Chest freezers', 'فريزر رأسى': 'Upright freezers',
    'أفران وبوتاجازات': 'Cookers & ovens', '4 شعلة': '4 burners', '5 شعلة': '5 burners', 'أفران كهربائية': 'Electric ovens',
    'غسالات': 'Washing machines', 'غسالات ملابس': 'Clothes washing machines', 'غسالات أطباق': 'Dishwashers',
    'سخانات مياه': 'Water heaters', 'سخانات كهرباء': 'Electric water heaters', 'سخانات غاز': 'Gas water heaters',
    'أجهزة صغيرة': 'Small appliances', 'مكانس': 'Vacuum cleaners', 'مكاوى': 'Irons',
    'خلاطات ومحضرات طعام': 'Blenders & mixers', 'ميكروييف': 'Microwaves',
    'كاتيل وماكينات قهوة': 'Kettles & coffee machines', 'قلايات': 'Air fryers',
    'تكييفات هواء': 'Air conditioners', 'تليفزيونات': 'Televisions', 'مبردات هواء ومراوح': 'Air coolers & fans',
    'مبردات مياه': 'Water dispensers', 'حرف يدوية ومنتجات عضوية': 'Handicrafts & organic',
    'عروض صادكو': 'SADKO Offers', 'الأكثر مبيعاً': 'Best sellers',
    'كل المنتجات': 'All products', 'خلاطات ومحضرات': 'Blenders & processors', 'كاتيل وقهوة': 'Kettles & coffee',
  };
  const catName = n => (LANG === 'en' ? (CAT_EN[n.trim()] || n) : n);
  window.skCatEn = CAT_EN;

  /* ---- catalog taxonomy (from extraction/site-graph.json) ---- */
  const SHOP_TREE = [
    { id: '38003882', name: 'ثلاجات', kids: [['38022268', 'نو فروست'], ['38022269', 'ديفروست']] },
    { id: '38005648', name: 'فريزرات', kids: [['38022353', 'فريزر أفقى'], ['38005649', 'فريزر رأسى']] },
    { id: '38003799', name: 'أفران وبوتاجازات', kids: [['50846528', '4 شعلة'], ['50844229', '5 شعلة'], ['38022202', 'أفران كهربائية']] },
    { id: '38005652', name: 'غسالات', kids: [['38003963', 'غسالات ملابس'], ['38022354', 'غسالات أطباق']] },
    { id: '40507239', name: 'سخانات مياه', kids: [['48149056', 'سخانات كهرباء'], ['48143206', 'سخانات غاز']] },
    { id: '112439376', name: 'أجهزة صغيرة', kids: [['81170222', 'مكانس'], ['81167227', 'مكاوى'], ['68782006', 'خلاطات ومحضرات طعام'], ['57646037', 'ميكروييف'], ['185355010', 'كاتيل وماكينات قهوة'], ['185364502', 'قلايات']] },
    { id: '38032005', name: 'تكييفات هواء' },
    { id: '38022381', name: 'تليفزيونات' },
    { id: '50318054', name: 'مبردات هواء ومراوح' },
    { id: '102858075', name: 'مبردات مياه' },
    { id: '167433056', name: 'حرف يدوية ومنتجات عضوية' },
    { id: '173607281', name: 'عروض صادكو' },
    { id: '195273251', name: 'الأكثر مبيعاً' },
  ];

  /* ================= cart ================= */
  const CART_KEY = 'sadko-cart-v1';
  function readCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { return []; } }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('sk-cart-change'));
  }
  const skCart = {
    items: readCart,
    count: () => readCart().reduce((n, i) => n + i.qty, 0),
    total: () => readCart().reduce((n, i) => n + (i.price || 0) * i.qty, 0),
    add(p, qty) {
      /* Defence in depth. The button is disabled and the buy link is gone, but
         a page left open before a sync, or a second tab, could still reach
         here. Taking money for something SADKO cannot ship is the one outcome
         worth guarding twice. A product with NO inStock field — the seed
         catalogue — is still perfectly addable, so behaviour with the Ecwid
         flag off is unchanged. */
      if (p && p.inStock === false) return false;
      const items = readCart();
      const hit = items.find(i => i.id === p.id);
      /* Remaining stock, only when Ecwid is tracking it (an untracked
         product's quantity is not a stock figure). null = no limit. The
         server re-checks at order time; this keeps the cart honest. */
      const max = (p.stockTracked === true && isFinite(Number(p.quantity))) ? Math.max(0, Number(p.quantity)) : null;
      if (hit) { if (max !== null) hit.max = max; }
      const want = (hit ? hit.qty : 0) + (qty || 1);
      const cap = hit ? (hit.max != null ? hit.max : null) : max;
      if (cap !== null && want > cap) {
        if (hit) hit.qty = Math.min(hit.qty, cap);
        else if (cap > 0) items.push({ id: p.id, title: p.title, price: p.price, image: p.image, url: p.url, qty: cap, max });
        writeCart(items);
        return 'max';
      }
      if (hit) hit.qty = want;
      else items.push({ id: p.id, title: p.title, price: p.price, image: p.image, url: p.url, qty: want, max });
      writeCart(items);
    },
    setQty(id, qty) {
      let items = readCart();
      items.forEach(i => { if (i.id === id) i.qty = (i.max != null) ? Math.min(qty, i.max) : qty; });
      items = items.filter(i => i.qty > 0);
      writeCart(items);
    },
    remove(id) { writeCart(readCart().filter(i => i.id !== id)); },
    clear() { writeCart([]); },
  };
  window.skCart = skCart;
  // The storefront re-renders its grid on every facet change, so it needs to
  // re-run these over the new cards. Additive only; existing pages are unaffected.
  window.skNav = { enhanceCategoryCards };

  /* ---- offline notice ----
     A shopper who loses signal mid-browse otherwise sees grids that silently
     stop loading. Says so plainly and clears itself when the connection returns. */
  (function offlineNotice() {
    let bar = null;
    function show(off) {
      if (off && !bar) {
        bar = document.createElement('div');
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'position:fixed;inset-inline:0;bottom:0;z-index:99999;background:#7a2e1c;color:#fff;' +
          'font:700 .9rem Cairo,sans-serif;text-align:center;padding:10px 16px';
        bar.textContent = LANG === 'en'
          ? 'You are offline. Some pages and prices may not load until your connection returns.'
          : 'أنت غير متصل بالإنترنت. قد لا تظهر بعض الصفحات والأسعار حتى يعود الاتصال.';
        document.body.appendChild(bar);
      } else if (!off && bar) { bar.remove(); bar = null; }
    }
    window.addEventListener('offline', () => show(true));
    window.addEventListener('online', () => show(false));
    document.addEventListener('DOMContentLoaded', () => show(navigator.onLine === false));
  })();

  /* ================= header ================= */
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }


  /* ---- site-wide search (the lens in the strap) ----
     A popup over a blurred page: type, and every product whose words START with
     what you typed is listed as you type ("ثلا" finds every ثلاجة, "kw" finds the
     KWD water coolers), with matching categories and brands above them. Clicking
     the backdrop, the × or pressing Esc closes it.

     It searches the WHOLE catalogue the shop sells (data/products.json, the live
     Ecwid mirror on the server), not a sample, and uses shop-core's Arabic
     normaliser, so "ثلاجه"/"ثلاجة", "اسود"/"أسود" and "١٠"/"10" are the same.
     Model numbers, SKUs and brands count as words too. Anything the prefix pass
     misses but the shop's own search would find (synonyms such as "fridge" for
     ثلاجة, words in the description) is added below the prefix hits, so the
     popup never shows less than the shop search would. Nothing is fetched until
     the popup is first opened. */
  const SEARCH = { el: null, data: null, loading: null, timer: 0, items: [], active: -1 };
  function searchData() {
    if (SEARCH.loading) return SEARCH.loading;
    const deps = [loadOnce('assets/js/shop-core.js')];
    if (LANG === 'en' && !window.skCatalogI18n) deps.push(loadOnce('assets/js/catalog-i18n.js'));
    const prods = (window.skApp && window.skApp.products)
      ? window.skApp.products()
      : fetch(P('data/products.json')).then(r => r.json()).then(d => d.products || []).catch(() => []);
    const cats = (window.skApp && window.skApp.categories) ? window.skApp.categories()
      : fetch(P('data/categories.json')).then(r => (r.ok ? r.json() : null))
        .then(d => (d && d.categories) || []).catch(() => []);
    SEARCH.loading = Promise.all([prods, cats].concat(deps)).then(([products, categories]) => {
      const C = window.skShopCore;
      const T = LANG === 'en' && window.skCatalogI18n ? window.skCatalogI18n : null;
      const tr = T ? (s => { try { return T.translateTitle(s); } catch (e) { return s; } }) : null;
      const wordsOf = s => C.norm(s).split(/[^0-9a-z؀-ۿ]+/).filter(Boolean);
      // One index entry per product, built once: every word that can be typed.
      const index = products.filter(p => p && p.title && p.enabled !== false).map(p => {
        const shown = tr ? tr(p.title) : p.title;
        const parts = [p.title, shown, p.brand, p.sku];
        const words = [];
        parts.forEach(x => { if (x) wordsOf(x).forEach(w => { if (words.indexOf(w) < 0) words.push(w); }); });
        // "kwd-a3.1" should be reachable as "kwda3" too, so codes are also kept glued
        if (p.sku) { const glued = C.norm(p.sku).replace(/[^0-9a-z]/g, ''); if (glued && words.indexOf(glued) < 0) words.push(glued); }
        // A title's FIRST word is usually what the product is ("ثلاجة …", "مروحة …"),
        // so a query matching it outranks one that only matches a later word
        // ("ثلا" → ثلاجة before a fan described as "ثلاثة فى واحد").
        return { p, shown, words, firsts: [wordsOf(p.title)[0] || '', wordsOf(shown)[0] || ''], hay: words.join(' ') };
      });
      const brandMap = {};
      products.forEach(p => { if (p && p.brand) { const k = C.norm(p.brand); (brandMap[k] = brandMap[k] || { name: p.brand, count: 0 }).count++; } });
      const catList = categories.filter(c => c && c.name && (c.count == null || c.count > 0)).map(c => {
        const en = c.nameEn || (window.skCatEn && window.skCatEn[c.name]) || '';
        return { id: c.id, name: LANG === 'en' && en ? en : c.name, alt: LANG === 'en' ? c.name : en, count: c.count };
      });
      SEARCH.data = { C, tr, index, catList, brands: Object.keys(brandMap).map(k => ({ key: brandMap[k].name, name: brandMap[k].name, count: brandMap[k].count })) };
      return SEARCH.data;
    });
    return SEARCH.loading;
  }

  function searchRank(q) {
    const D = SEARCH.data, C = D.C;
    const tokens = C.norm(q).split(/[^0-9a-z؀-ۿ]+/).filter(Boolean);
    if (!tokens.length) return [];
    // The shop's own synonym table, prefix-aware: "شاش" also means تليفزيون (the
    // catalogue titles TVs that way), "fridg" means ثلاجة. A synonym counts a
    // little less than what was literally typed, never more.
    const aliases = tokens.map(t => (C.queryAliases ? C.queryAliases(t) : []));
    const starts = (w, t) => w.indexOf(t) === 0;
    const out = [];
    D.index.forEach(e => {
      let score = 0, firstBonus = 0;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        let s = 0;
        for (let j = 0; j < e.words.length; j++) {
          if (e.words[j] === t) { s = 4; break; }
          if (starts(e.words[j], t)) s = Math.max(s, 3);
        }
        if (!s && t.length >= 3 && e.hay.indexOf(t) >= 0) s = 1;     // inside a word ("فروست" in "نوفروست")
        let viaAlias = false;
        if (s < 3 && aliases[i].length && e.words.some(w => aliases[i].some(a => starts(w, a)))) { s = Math.max(s, 2.5); viaAlias = true; }
        if (!s) { score = 0; break; }
        score += s;
        if (i === 0) {
          // the title itself starts with what was typed (or its synonym)
          if (e.firsts.some(f => f && starts(f, t))) firstBonus = 3;
          else if (viaAlias && e.firsts.some(f => f && aliases[0].some(a => starts(f, a)))) firstBonus = 2.5;
        }
      }
      if (score) out.push({ e, score: score + firstBonus });
    });
    // What the shop search finds that the prefix pass did not (synonyms,
    // descriptions, one-letter typos) follows, ranked below every prefix hit.
    if (C.matchesQuery) {
      const seen = new Set(out.map(r => r.e));
      D.index.forEach(e => {
        if (seen.has(e)) return;
        try { if (C.matchesQuery(e.p, q, D.tr, null)) out.push({ e, score: 0.5 }); } catch (err) {}
      });
    }
    out.sort((a, b) => (b.score - a.score) ||
      ((a.e.p.inStock === false) - (b.e.p.inStock === false)) ||
      (a.e.shown.length - b.e.shown.length));
    return out.map(r => r.e);
  }

  function searchPaint(q) {
    const box = SEARCH.el.querySelector('.sk-search__res');
    const raw = q.trim();
    SEARCH.items = []; SEARCH.active = -1;
    if (raw.length < 2) { box.innerHTML = raw ? '<p class="sk-search__msg">' + esc(N.searchHint) + '</p>' : ''; return; }
    if (!SEARCH.data) { box.innerHTML = '<p class="sk-search__msg">' + esc(N.searchLoading) + '</p>'; return; }
    const D = SEARCH.data;
    const places = D.C.suggest(raw, { cats: D.catList, brands: D.brands, products: [] }, { limit: 6 });
    const hits = searchRank(raw);
    const money = n => (n == null || isNaN(n)) ? '' : (LANG === 'en'
      ? Math.round(n).toLocaleString('en-EG') + ' EGP' : Math.round(n).toLocaleString('ar-EG') + ' جنيه');
    const shopQ = P('shop.html?q=') + encodeURIComponent(raw);
    let html = '';
    if (places.length) {
      html += '<div class="sk-search__chips">' + places.map(it => {
        const href = it.kind === 'cat' ? P('shop.html?cat=') + encodeURIComponent(it.id) : P('shop.html?brand=') + encodeURIComponent(it.key);
        SEARCH.items.push(href);
        return '<a class="sk-search__chip sk-search__opt" href="' + href + '"><em>' + esc(it.kind === 'cat' ? N.searchCats : N.searchBrands) + '</em>' + esc(it.label) +
          (it.count ? ' <b>' + (LANG === 'en' ? it.count : Number(it.count).toLocaleString('ar-EG')) + '</b>' : '') + '</a>';
      }).join('') + '</div>';
    }
    if (hits.length) {
      const LIMIT = 40;
      html += '<h5 class="sk-search__h">' + esc(N.searchItems) + ' (' + (LANG === 'en' ? hits.length : hits.length.toLocaleString('ar-EG')) + ')</h5><ul class="sk-search__list">' +
        hits.slice(0, LIMIT).map(e => {
          const p = e.p, href = P('product.html?id=') + encodeURIComponent(p.id);
          SEARCH.items.push(href);
          return '<li><a class="sk-search__item sk-search__opt" href="' + href + '">' +
            (p.image ? '<img src="' + esc(p.thumb || p.image) + '" alt="" loading="lazy" width="52" height="52">' : '<span class="sk-search__noimg"></span>') +
            '<span class="sk-search__txt"><span class="sk-search__name">' + esc(String(e.shown).replace(/&nbsp;/g, ' ')) + '</span>' +
            '<span class="sk-search__meta">' + esc(money(p.price)) + (p.inStock === false ? ' · <i>' + esc(N.outStock) + '</i>' : '') + '</span></span></a></li>';
        }).join('') + '</ul>';
      SEARCH.items.push(shopQ);
      html += '<a class="sk-search__all sk-search__opt" href="' + shopQ + '">' + esc(N.searchAll) + ' →</a>';
    } else if (!places.length) {
      html += '<p class="sk-search__msg">' + esc(N.searchNone) + '</p>';
    }
    box.innerHTML = html;
    box.scrollTop = 0;
  }

  function searchMove(d) {
    const opts = SEARCH.el.querySelectorAll('.sk-search__opt');
    if (!opts.length) return;
    SEARCH.active = (SEARCH.active + d + opts.length + 1) % (opts.length + 1) - 1;   // -1 = back in the box
    opts.forEach((o, i) => o.classList.toggle('is-active', i === SEARCH.active));
    if (SEARCH.active >= 0) opts[SEARCH.active].scrollIntoView({ block: 'nearest' });
  }

  function openSearch() {
    if (!SEARCH.el) {
      const el = document.createElement('div');
      el.className = 'sk-search' + (LANG === 'en' ? ' sk-nav--en' : '');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', N.search);
      el.innerHTML =
        '<button type="button" class="sk-search__x" aria-label="' + esc(N.close) + '">&times;</button>' +
        '<div class="sk-search__box">' +
          '<form class="sk-search__form" role="search" action="' + P('shop.html') + '">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="6.6"/><path d="m20.5 20.5-4.8-4.8"/></svg>' +
            '<input type="search" name="q" autocomplete="off" spellcheck="false" placeholder="' + esc(N.searchPh) + '" aria-label="' + esc(N.search) + '">' +
          '</form>' +
          '<div class="sk-search__res" aria-live="polite"></div>' +
        '</div>';
      document.body.appendChild(el);
      SEARCH.el = el;
      const input = el.querySelector('input');
      // clicking anywhere outside the panel (the blurred page) closes it
      el.addEventListener('mousedown', e => { if (!e.target.closest('.sk-search__box') || e.target.closest('.sk-search__x')) e.preventDefault(); });
      el.addEventListener('click', e => { if (!e.target.closest('.sk-search__box') || e.target.closest('.sk-search__x')) closeSearch(); });
      input.addEventListener('input', () => {
        clearTimeout(SEARCH.timer);
        SEARCH.timer = setTimeout(() => searchPaint(input.value), 80);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); searchMove(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); searchMove(-1); }
      });
      el.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const opts = el.querySelectorAll('.sk-search__opt');
        if (SEARCH.active >= 0 && opts[SEARCH.active]) { location.href = opts[SEARCH.active].href; return; }
        const v = input.value.trim();
        if (v) location.href = P('shop.html?q=') + encodeURIComponent(v);
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('is-open')) closeSearch(); });
    }
    const el = SEARCH.el, input = el.querySelector('input');
    el.classList.add('is-open');
    document.documentElement.classList.add('sk-lock');
    setTimeout(() => input.focus(), 30);
    searchData().then(() => { if (el.classList.contains('is-open')) searchPaint(input.value); });
  }
  function closeSearch() {
    if (!SEARCH.el) return;
    SEARCH.el.classList.remove('is-open');
    document.documentElement.classList.remove('sk-lock');
  }

  function mount() {
    injectCSS();
    const overlay = !!document.getElementById('world');
    const legacy = document.querySelector('header.top');

    const here = location.pathname.replace(/\\/g, '/').split('/').pop() || 'index.html';
    const active =
      /index\.html?$/.test(here) && !ROOT ? 'home' :
      here === 'shop.html' ? 'shop' :
      here === 'compare.html' ? 'compare' :
      here === 'orders.html' ? 'orders' :
      here === 'showrooms.html' ? 'showrooms' :
      here === 'cart.html' ? 'cart' :
      here === 'finder.html' ? 'finder' :
      here === 'plan.html' ? 'plan' :
      here === 'guides.html' ? 'guides' :
      here === 'care.html' ? 'care' :
      here === 'saved.html' ? 'saved' :
      here === 'account.html' || here === 'checkout.html' ? 'account' :
      here === 'appliances.html' ? 'care' :
      ROOT ? 'shop' : '';

    // The strap (2026-10-31): Home · Shop▾ · Help me choose · Contact us▾ · search.
    // "Contact us" opens Orders, Showrooms and Customer care. The same order
    // drives the mobile drawer.
    const A = (k, label, href, cls) =>
      `<a class="sk-link${cls ? ' ' + cls : ''}${active === k ? ' is-active' : ''}" href="${P(href)}">${esc(label)}</a>`;
    const CONTACT = [['orders', N.orders, 'orders.html'], ['showrooms', N.showrooms, 'showrooms.html'], ['care', N.care, 'care.html']]
      .filter(it => shown(it[2]));
    const contactActive = CONTACT.some(it => it[0] === active);
    const shopMenuInner =
      `<a class="sk-menu__all" href="${P('shop.html')}">${N.all}</a>` +
      SHOP_TREE.map((t, i) =>
        t.kids
        ? `<div class="sk-menu__item" data-i="${i}">` +
            `<button type="button" class="sk-menu__row" aria-expanded="false">` +
              `<span>${esc(catName(t.name))}</span><i class="sk-caret"></i>` +
            `</button>` +
            `<div class="sk-menu__kids">` +
              `<a href="${C(t.id)}">${N.allPrefix}${esc(catName(t.name))}</a>` +
              t.kids.map(k => `<a href="${C(k[0])}">${esc(catName(k[1]))}</a>`).join('') +
            `</div>` +
          `</div>`
        : `<a class="sk-menu__row sk-menu__row--leaf" href="${C(t.id)}">${esc(catName(t.name))}</a>`
      ).join('');

    const iconAcct = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.2a7.8 7.8 0 0 1 15 0"/></svg>`;
    const iconSaved = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`;
    const iconCart = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.5 12h10.2l2.2-8.5H6.2"/></svg>`;

    const iconSearch = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.6"/><path d="m20.5 20.5-4.8-4.8"/></svg>`;
    const header = document.createElement('header');
    header.className = 'sk-nav' + (overlay ? ' sk-nav--overlay' : ' sk-nav--solid') + (LANG === 'en' ? ' sk-nav--en' : '');
    header.innerHTML =
      // mobile-only hamburger (visual start = top-left in RTL)
      `<button type="button" class="sk-burger sk-glass" aria-label="${N.menu}" aria-expanded="false" aria-controls="sk-drawer">` +
        `<span></span><span></span><span></span>` +
      `</button>` +
      /* The brand mark opens the full catalogue, not the home page. Home is the
         scroll-through house — something you walk once, not a place to land back
         on mid-shop — and "الرئيسية" is already the first link in the strap right
         beside it for anyone who does want it. aria-label/title say where it
         goes, since a brand mark otherwise reads as "back to home" by convention. */
      `<a class="sk-nav__logo" href="${P('shop.html')}" aria-label="${N.all}" title="${N.all}"><img src="${P('assets/img/sadko-logo-256.webp')}" alt="صادكو جروب"></a>` +
      `<nav class="sk-nav__links sk-glass" aria-label="${N.pagesAria}">` +
        A('home', N.home, 'index.html') +
        `<div class="sk-shop">` +
          `<button type="button" class="sk-link sk-shop__btn${active === 'shop' ? ' is-active' : ''}" aria-haspopup="true" aria-expanded="false">${N.shop} <i class="sk-caret"></i></button>` +
          `<div class="sk-menu sk-glass" role="menu">${shopMenuInner}</div>` +
        `</div>` +
        // The amber pill marks the ONE thing the strap is arguing for, so it goes
        // on the price comparer — the feature no other Egyptian appliance site
        // offers — rather than on the guided finder, which every storefront has a
        // version of. Only one link may carry it; two amber pills is no emphasis.
        // It also takes the middle slot, where the eye lands first in a five-item
        // strap, so position and colour say the same thing.
        // While the comparer is switched off the pill moves to the finder.
        (shown('compare.html')
          ? A('compare', N.compare, 'compare.html', 'sk-link--cta') + A('finder', N.finder, 'finder.html')
          : A('finder', N.finder, 'finder.html', 'sk-link--cta')) +
        `<div class="sk-more">` +
          `<button type="button" class="sk-link sk-more__btn${contactActive ? ' is-active' : ''}" aria-haspopup="true" aria-expanded="false">${N.contact} <i class="sk-caret"></i></button>` +
          `<div class="sk-morepanel sk-glass" role="menu">` +
            `<div class="sk-morecol">` +
              CONTACT.map(it => `<a class="sk-morelink${active === it[0] ? ' is-active' : ''}" href="${P(it[2])}">${esc(it[1])}</a>`).join('') +
            `</div>` +
          `</div>` +
        `</div>` +
        `<button type="button" class="sk-link sk-searchbtn" data-sk-search aria-label="${N.search}" title="${N.search}">${iconSearch}</button>` +
      `</nav>` +
      // phones: the strap is hidden behind the burger, so the lens sits in the bar itself
      `<button type="button" class="sk-msearch sk-glass" data-sk-search aria-label="${N.search}" title="${N.search}">${iconSearch}</button>` +
      `<span class="sk-nav__side">` +
        `<button type="button" class="sk-lang sk-glass" title="${N.langTitle}" aria-label="${N.langTitle}">${N.langBtn}</button>` +
        `<a class="sk-hotline" href="tel:19140" dir="ltr">${N.call}</a>` +
        `<a class="sk-cart sk-glass sk-acct${active === 'account' ? ' is-active' : ''}" href="${P('account.html')}" aria-label="${N.acctAria}" title="${N.acctAria}">${iconAcct}<em class="sk-acct__dot" hidden></em></a>` +
        `<a class="sk-cart sk-glass${active === 'saved' ? ' is-active' : ''}" href="${P('saved.html')}" aria-label="${N.savedAria}" title="${N.savedAria}">${iconSaved}<em class="sk-saved__badge" hidden>0</em></a>` +
        `<a class="sk-cart sk-glass${active === 'cart' ? ' is-active' : ''}" href="${P('cart.html')}" aria-label="${N.cartAria}">${iconCart}<em class="sk-cart__badge" hidden>0</em></a>` +
      `</span>`;

    if (legacy) legacy.replaceWith(header);
    else document.body.prepend(header);

    /* Publish the strap's real height so the first content block can clear the
       now-overlaid (fixed) strap exactly, at any viewport width. */
    if (!overlay) {
      const measure = () => document.documentElement.style.setProperty('--sk-nav-h', header.offsetHeight + 'px');
      requestAnimationFrame(measure);
      window.addEventListener('resize', measure);
    }

    // ---- mobile drawer: the whole strap as a glass side panel -------------
    const scrim = document.createElement('div');
    scrim.className = 'sk-scrim';
    const drawer = document.createElement('aside');
    drawer.id = 'sk-drawer';
    drawer.className = 'sk-drawer sk-glass' + (LANG === 'en' ? ' sk-nav--en' : '');
    drawer.setAttribute('aria-hidden', 'true');
    const dLink = (k, label, href, cls) =>
      `<a class="sk-dlink${cls ? ' ' + cls : ''}${active === k ? ' is-active' : ''}" href="${P(href)}">${esc(label)}</a>`;
    drawer.innerHTML =
      `<div class="sk-drawer__top">` +
        `<a class="sk-drawer__logo" href="${P('shop.html')}" aria-label="${N.all}" title="${N.all}"><img src="${P('assets/img/sadko-logo-256.webp')}" alt="صادكو جروب"></a>` +
        `<button type="button" class="sk-drawer__x" aria-label="${N.close}">&times;</button>` +
      `</div>` +
      `<div class="sk-drawer__icons">` +
        `<a class="sk-diconbtn${active === 'account' ? ' is-active' : ''}" href="${P('account.html')}">${iconAcct}<span>${N.account}</span></a>` +
        `<a class="sk-diconbtn${active === 'saved' ? ' is-active' : ''}" href="${P('saved.html')}">${iconSaved}<span>${N.saved}</span><em class="sk-saved__badge" hidden>0</em></a>` +
        `<a class="sk-diconbtn${active === 'cart' ? ' is-active' : ''}" href="${P('cart.html')}">${iconCart}<span>${N.cart}</span><em class="sk-cart__badge" hidden>0</em></a>` +
      `</div>` +
      `<nav class="sk-drawer__nav" aria-label="${N.pagesAria}">` +
        dLink('home', N.home, 'index.html') +
        `<div class="sk-dacc">` +
          `<button type="button" class="sk-dlink sk-dacc__btn" aria-expanded="false"><span>${N.shop}</span><i class="sk-caret"></i></button>` +
          `<div class="sk-dacc__body"><div class="sk-dmenu">${shopMenuInner}</div></div>` +
        `</div>` +
        // Same order and same pill as the desktop strap above — the drawer must not
        // disagree with it about which feature the site is leading with.
        (shown('compare.html')
          ? dLink('compare', N.compare, 'compare.html', 'sk-dlink--cta') + dLink('finder', N.finder, 'finder.html')
          : dLink('finder', N.finder, 'finder.html', 'sk-dlink--cta')) +
        `<div class="sk-dgroup"><h4>${esc(N.contact)}</h4>` +
          CONTACT.map(it => dLink(it[0], it[1], it[2])).join('') + `</div>` +
      `</nav>` +
      `<div class="sk-drawer__foot">` +
        `<button type="button" class="sk-dlang">${LANG === 'en' ? 'العربية' : 'English'} · ${N.langBtn}</button>` +
        `<a class="sk-dcall" href="tel:19140" dir="ltr">${N.call}</a>` +
      `</div>`;
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);

    header.querySelector('.sk-lang').addEventListener('click', () => window.skLang.set(LANG === 'en' ? 'ar' : 'en'));
    drawer.querySelector('.sk-dlang').addEventListener('click', () => window.skLang.set(LANG === 'en' ? 'ar' : 'en'));

    /* drawer open/close */
    const burger = header.querySelector('.sk-burger');
    let drawerOpen = false;
    const setDrawer = open => {
      drawerOpen = open;
      drawer.classList.toggle('is-open', open);
      scrim.classList.toggle('is-open', open);
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
      document.documentElement.classList.toggle('sk-lock', open);
    };
    burger.addEventListener('click', () => setDrawer(!drawerOpen));
    scrim.addEventListener('click', () => setDrawer(false));
    drawer.querySelector('.sk-drawer__x').addEventListener('click', () => setDrawer(false));
    drawer.querySelectorAll('a[href]').forEach(a => a.addEventListener('click', () => setDrawer(false)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerOpen) setDrawer(false); });

    /* generic "one popover at a time" for the desktop shop + more dropdowns */
    const pops = [];
    function makePop(container, btn) {
      const set = open => {
        container.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
        if (!open) container.querySelectorAll('.sk-menu__item.is-open').forEach(x => x.classList.remove('is-open'));
      };
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const willOpen = !container.classList.contains('is-open');
        pops.forEach(p => p.set(false));
        set(willOpen);
      });
      pops.push({ set, container });
    }
    const shopBox = header.querySelector('.sk-shop');
    makePop(shopBox, shopBox.querySelector('.sk-shop__btn'));
    const moreBox = header.querySelector('.sk-more');
    makePop(moreBox, moreBox.querySelector('.sk-more__btn'));
    document.addEventListener('click', e => { if (!pops.some(p => p.container.contains(e.target))) pops.forEach(p => p.set(false)); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') pops.forEach(p => p.set(false)); });
    document.querySelectorAll('[data-sk-search]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); pops.forEach(p => p.set(false)); if (drawerOpen) setDrawer(false); openSearch();
    }));

    /* category accordion — used inside both the desktop shop menu and the drawer */
    function wireAccordion(scope) {
      scope.querySelectorAll('.sk-menu__item .sk-menu__row').forEach(row => {
        row.addEventListener('click', e => {
          e.stopPropagation();
          const item = row.parentElement;
          const open = !item.classList.contains('is-open');
          scope.querySelectorAll('.sk-menu__item.is-open').forEach(x => x.classList.remove('is-open'));
          item.classList.toggle('is-open', open);
          row.setAttribute('aria-expanded', String(open));
        });
      });
    }
    wireAccordion(header);
    wireAccordion(drawer);

    /* drawer "Shop" accordion */
    const dacc = drawer.querySelector('.sk-dacc');
    dacc.querySelector('.sk-dacc__btn').addEventListener('click', () => {
      const open = !dacc.classList.contains('is-open');
      dacc.classList.toggle('is-open', open);
      dacc.querySelector('.sk-dacc__btn').setAttribute('aria-expanded', String(open));
    });

    /* cart + saved badges live in BOTH the strap and the drawer, so paint all */
    const setBadges = (sel, n) => document.querySelectorAll(sel).forEach(b => {
      b.hidden = n === 0; b.textContent = n > 99 ? '99+' : String(n);
    });
    const paint = () => setBadges('.sk-cart__badge', skCart.count());
    document.addEventListener('sk-cart-change', paint);
    window.addEventListener('storage', e => { if (e.key === CART_KEY) paint(); });
    paint();

    const paintSaved = () => {
      let n = 0;
      try { n = (JSON.parse(localStorage.getItem('sadko-saved-v1')) || []).length; } catch (e) {}
      setBadges('.sk-saved__badge', n);
    };
    /* a quiet dot on the account icon once a real session is confirmed */
    const paintAcct = u => document.querySelectorAll('.sk-acct__dot').forEach(d => { d.hidden = !u; });
    if (window.skAuth) { window.skAuth.onChange(paintAcct); paintAcct(window.skAuth.current()); }

    document.addEventListener('sk-store-change', paintSaved);
    window.addEventListener('storage', e => { if (e.key === 'sadko-saved-v1') paintSaved(); });
    paintSaved();

    if (ROOT && document.querySelector('article.card')) enhanceCategoryCards();
    if (ROOT && LANG === 'en') translateCategoryPage();
    ensureFooter();
    applySiteSettings();
    dropHiddenLinks(document.body);
    cleanLinks(document);
    new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'attributes') { if (m.target.tagName === 'A') cleanLinks(m.target); return; }
      m.addedNodes.forEach(n => { if (n.nodeType === 1) { dropHiddenLinks(n); cleanLinks(n); } });
    })).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }

  /* Site-wide settings the owner edits in the admin portal (Site bar &
     hotline): the hotline number, an announcement, a maintenance notice.
     Served at /data/site.json; a failed load changes nothing, so every page
     still shows 19140 and no bar. The bar sits at the BOTTOM of the screen:
     the strap is fixed at the top over the home page's scenes. */
  function applySiteSettings() {
    fetch((ROOT || '') + 'data/site.json', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(cfg => {
        if (!cfg) return;
        const hot = String(cfg.hotline || '').replace(/[^0-9+]/g, '');
        if (hot && hot !== '19140') {
          document.querySelectorAll('a[href="tel:19140"]').forEach(a => {
            a.setAttribute('href', 'tel:' + hot);
            a.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = n.textContent.replace('19140', hot); });
          });
        }
        const pick = o => (o && String(LANG === 'en' ? (o.en || '') : (o.ar || '')).trim()) || '';
        const notes = [];
        if (cfg.maintenance) notes.push({ kind: 'warn', text: pick(cfg.maintenance) });
        if (cfg.announcement) notes.push({ kind: 'info', text: pick(cfg.announcement) });
        notes.filter(n => n.text).forEach(n => {
          const key = 'sk-bar:' + n.text;
          try { if (sessionStorage.getItem(key)) return; } catch (e) {}
          const bar = document.createElement('div');
          bar.className = 'sk-announce sk-announce--' + n.kind;
          bar.setAttribute('role', 'status');
          bar.innerHTML = '<span>' + esc(n.text) + '</span><button type="button" aria-label="' +
            (LANG === 'en' ? 'Close' : 'إغلاق') + '">×</button>';
          bar.querySelector('button').onclick = () => { bar.remove(); try { sessionStorage.setItem(key, '1'); } catch (e) {} };
          document.body.appendChild(bar);
        });
      })
      .catch(() => {});
  }

  /* Last line of defence for HIDDEN_PAGES: any stand-alone button or link a
     page script renders to a switched-off page is removed. Sentences that
     mention those pages are reworded where they are written. */
  function dropHiddenLinks(root) {
    const links = root.matches('a[href]') ? [root] : [...root.querySelectorAll('a[href]')];
    links.forEach(a => {
      if (!window.skFeature.hidden(a.getAttribute('href'))) return;
      const li = a.parentElement && a.parentElement.tagName === 'LI' && a.parentElement.children.length === 1 ? a.parentElement : null;
      (li || a).remove();
    });
  }

  /* ---- English mode for the prebuilt (Arabic-authored) category pages ----
     Chrome comes from CAT_EN; product titles go through the rule-based
     catalog translator (assets/js/catalog-i18n.js, loaded before this). */
  function translateCategoryPage() {
    const T = window.skCatalogI18n;
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    const west = s => String(s).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/٬/g, ',');
    document.title = document.title.replace(/^([^|]+)\|/, (m, n) => (CAT_EN[n.trim()] || n.trim()) + ' | ')
      .replace('صادكو جروب', 'SADKO Group');
    const h1 = document.querySelector('.hero__title');
    if (h1 && CAT_EN[h1.textContent.trim()]) h1.textContent = CAT_EN[h1.textContent.trim()];
    const meta = document.querySelector('.hero__meta');
    if (meta) meta.textContent = west(meta.textContent).replace(/منتج(ات)?/, 'products');
    const crumb = document.querySelector('.hero__crumb');
    if (crumb) {
      crumb.querySelectorAll('a, span').forEach(el => {
        const t = el.textContent.trim();
        el.textContent = t === 'البيت' ? 'Home' : (CAT_EN[t] || el.textContent);
      });
      crumb.innerHTML = crumb.innerHTML.replace(/←/g, '→');
    }
    document.querySelectorAll('.chips a').forEach(a => {
      const t = a.textContent.trim();
      if (CAT_EN[t]) a.textContent = CAT_EN[t];
    });
    document.querySelectorAll('article.card').forEach(card => {
      const h = card.querySelector('.card__title');
      if (h && T) h.textContent = T.translateTitle(h.textContent);
      const teaser = card.querySelector('.card__teaser');
      if (teaser) teaser.hidden = true;      // specs exist only in Arabic
      const price = card.querySelector('.card__price');
      if (price) price.innerHTML = west(price.innerHTML).replace(/جنيه/, 'EGP');
      const buy = card.querySelector('.card__buy');
      if (buy) buy.textContent = 'Buy now ↗';
    });
    const foot = document.querySelector('.foot__inner');
    if (foot) foot.innerHTML = foot.innerHTML
      .replace('الخط الساخن', 'Hotline')
      .replace(/© صادكو جروب 2026[^ن]*نسخة معاد تصميمها \(Rebrand Preview\)/, '© SADKO Group 2026, Rebrand Preview')
      .replace('توصيل مجانى داخل القاهرة والجيزة والإسكندرية · الدفع عند الاستلام أو بالبطاقة',
        'Free delivery in Cairo, Giza & Alexandria · Cash on delivery or card');
  }

  /* ---- shared company footer on EVERY page ----
     App pages render their own via skApp.footer() into [data-footer]; this
     covers the rest: the legacy pages (shop/cart/orders/showrooms/compare) and
     the 3D home, which had no footer at all. Same content and look everywhere. */
  function ensureFooter() {
    if (document.querySelector('[data-footer]')) return;        // app pages own theirs
    const tt = (ar, en) => (LANG === 'en' ? en : ar);
    const groups = [
      { h: tt('صادكو', 'SADKO'), items: [
        [tt('من نحن', 'About us'), 'about.html'],
        [tt('تواصل معنا', 'Contact us'), 'contact.html'],
        [tt('المعارض', 'Showrooms'), 'showrooms.html'], [tt('حسابى', 'My account'), 'account.html'] ] },
      { h: tt('قبل الشراء', 'Before you buy'), items: [
        [tt('ساعدنى أختار', 'Help me choose'), 'finder.html'], [tt('دليلك للاختيار', 'Buying guides'), 'guides.html'],
        [tt('قارن الأسعار', 'Compare prices'), 'compare.html'], [tt('خطط التجهيز', 'Shopping plans'), 'plan.html'] ] },
      { h: tt('بعد الشراء', 'After you buy'), items: [
        [tt('أجهزتى والضمان', 'My appliances & warranty'), 'appliances.html'], [tt('مركز خدمة العملاء', 'Customer care'), 'care.html'],
        [tt('طلباتى', 'My orders'), 'orders.html'], [tt('التوصيل والتركيب', 'Delivery & installation'), 'delivery.html'] ] },
      { h: tt('معلومات', 'Information'), items: [
        [tt('الضمان والاسترجاع', 'Warranty & returns'), 'warranty.html'], [tt('الخصوصية', 'Privacy'), 'privacy.html'],
        [tt('شروط الاستخدام', 'Terms of use'), 'terms.html'] ] },
    ].map(g => ({ h: g.h, items: g.items.filter(it => shown(it[1])) }));
    let el = document.querySelector('footer.foot');
    const home = !!document.getElementById('world');
    /* No footer on the 3D home (2026-11-12): the tour ends on the laundry
       room's resting view and the page ends with it, so nothing scrolls up
       over the last room. Every other page keeps the footer. */
    if (home) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('footer'); (home ? document.body : document.body).appendChild(el); }
    el.className = 'foot sk-foot' + (home ? ' sk-foot--home' : '');
    el.innerHTML =
      '<div class="foot__inner"><div class="foot__cols">' +
      groups.map(c => '<div><h4>' + esc(c.h) + '</h4><ul>' +
        c.items.map(i => '<li><a href="' + P(i[1]) + '">' + esc(i[0]) + '</a></li>').join('') + '</ul></div>').join('') +
      '<div class="foot__contact"><h4>' + tt('اتصل بنا', 'Talk to us') + '</h4><ul>' +
        '<li><a href="tel:19140" dir="ltr">19140</a></li>' +
        '<li><a href="mailto:csupport@sadko-group.com" dir="ltr">csupport@sadko-group.com</a></li></ul>' +
        window.skSocial() +
        '<p class="foot__tag">' + tt('مجموعة صادكو، من 1986، والموزّع الوحيد لكريازى.', 'SADKO Group, since 1986, sole distributor of Kiriazi.') + '</p></div>' +
      '</div><p class="foot__legal">' +
        esc(window.skLegal()) +
        '<br>© ' + tt('صادكو جروب', 'SADKO Group') + ' 2026</p></div>';
  }

  /* ---- add-to-cart buttons on the static category pages ---- */
  /* The guided-finder call-out used to be injected from here, into `.wrap` and
     therefore ABOVE the breadcrumb — outside `#shop-root` so that shop.js's
     re-render on every facet click could not wipe it. Now that the category
     pages ARE the storefront, that placement is what made it read as a stray
     banner: the page announced a promotion before it said which category the
     visitor was even on, and the box carried the page's own gutter a second time
     so it sat inset from every block around it. It lives in shop.js's own markup
     now (renderBrowse), which puts it in the results column, in reading order,
     re-rendered with everything else, and identical on `shop.html?cat=` — where
     this injection never fired at all. */

  /* data/products.json is ~500 KB and compare-server.mjs serves it with
     cache-control: no-cache, so the browser re-downloads it in full every time.
     The storefront re-renders its grid on every facet change and calls
     enhanceCategoryCards() again through skShopUI.afterGrid(), which used to mean
     half a megabyte per filter click on a mobile-first Egyptian storefront.
     Memoised at module scope: fetched once per page load, shared by every re-run.
     The promise is CLEARED on failure so a transient error (offline, a dropped
     connection mid-scroll) cannot latch permanently and leave add-to-cart broken
     for the rest of the session — the next render retries. */
  /* Indexed BOTH ways. By id is what cards are matched on now that they link
     to product.html (see storefront.js card()); by path is kept because a card
     rendered before that change — or any anchor that still points at the
     catalogue url — must keep resolving. */
  let CATALOG_INDEX = null;
  function catalogIndex() {
    if (!CATALOG_INDEX) {
      /* The page's shared catalogue (appshell.js) when there is one: on the shop
         page this used to be a SECOND full download of products.json. */
      const list = (window.skApp && window.skApp.products) ? window.skApp.products()
        : fetch(P('data/products.json')).then(r => r.json()).then(d => d.products || []);
      CATALOG_INDEX = list.then(products => {
        const byPath = {}, byId = {};
        (products || []).forEach(p => {
          if (p.id != null) byId[String(p.id)] = p;
          try { byPath[decodeURIComponent(new URL(p.url).pathname)] = p; } catch (e) {}
        });
        return { byPath, byId };
      }).catch(err => { CATALOG_INDEX = null; throw err; });
    }
    return CATALOG_INDEX;
  }

  function enhanceCategoryCards() {
    catalogIndex().then(({ byPath, byId }) => {
      document.querySelectorAll('article.card').forEach(card => {
        if (card.__skProduct) return;   // already enhanced; re-runs must not double the buttons
        /* data-id first: it is on every card storefront.js renders and needs no
           URL parsing. The pathname fallback covers anything still hrefing the
           catalogue url. */
        let prod = byId[String(card.getAttribute('data-id') || '')] || null;
        const link = card.querySelector('a.card__imgwrap') || card.querySelector('a[href]');
        if (!prod) {
          if (!link) return;
          try { prod = byPath[decodeURIComponent(new URL(link.href).pathname)]; } catch (e) {}
        }
        if (!prod) return;
        card.__skProduct = prod;      // lets the preference filter reason about this card
        const row = card.querySelector('.card__row') || card.querySelector('.card__body') || card;
        /* No separate "details" button: the card image and "View product"
           already open the product page. */
        const b = document.createElement('button');
        b.type = 'button';
        /* An out-of-stock product keeps its card and its details link — it is
           still worth discovering, and hiding it would understate the range
           SADKO carries — but it cannot be added to a cart. */
        if (prod.inStock === false) {
          b.className = 'sk-addbtn is-soldout';
          b.disabled = true;
          b.textContent = N.soldOut;
          card.setAttribute('data-stock', 'out');
        } else {
          b.className = 'sk-addbtn';
          b.textContent = N.add;
          b.addEventListener('click', () => {
            const r = skCart.add(prod);
            b.textContent = r === 'max' ? N.maxQty : N.added;
            b.classList.add('is-done');
            setTimeout(() => { b.textContent = N.add; b.classList.remove('is-done'); }, 1400);
          });
        }
        row.appendChild(b);
      });
      mountPrefsBar();
    }).catch(() => {});
  }

  /* ---- preference filtering on any page that has a product grid ----
     The 30 prebuilt category pages only load nav.js, so the modules the filter
     needs are pulled in here on demand rather than by editing every page. */
  function loadOnce(src) {
    return new Promise(resolve => {
      const url = P(src);
      if (document.querySelector('script[data-sk="' + src + '"]')) return resolve();
      /* The data-sk marker only recognises tags THIS function injected. Pages that
         already carry the module as a plain <script src="assets/js/prefs.js"> tag
         (shop.html, product.html and all 30 generated category pages do) carry no
         such marker, so the module was being fetched and EXECUTED a second time —
         re-running auth.js reassigns window.skAuth to a fresh instance with a fresh
         listener list underneath code that had already captured the old one. Match
         on the file name as well so an existing plain tag counts. Every such tag is
         defer-loaded and nav.js only reaches here from its own DOMContentLoaded
         mount, by which point all deferred scripts have already executed. */
      const file = src.split('/').pop();
      const already = [].slice.call(document.querySelectorAll('script[src]')).some(tag => {
        const path = (tag.getAttribute('src') || '').split('?')[0].split('#')[0];
        return path === src || path.endsWith('/' + file);
      });
      if (already) return resolve();
      const s = document.createElement('script');
      /* One cache-bust for all five modules: it only has to CHANGE when any of
         them does, and it reaches only pages that carry no tag of their own (the
         `already` check above strips the query, so a page's own ?v= wins). */
      s.src = url + '?v=a5'; s.defer = false; s.setAttribute('data-sk', src);
      s.onload = resolve; s.onerror = resolve;
      document.head.appendChild(s);
    });
  }
  async function mountPrefsBar() {
    if (!document.querySelector('article.card')) return;
    /* The .grid test used to sit BELOW the five loads, so a page with cards but no
       grid — the product page, whose related rail supplies eight article.card
       elements — pulled in and re-executed all five modules before bailing out one
       line later. Nothing below here runs without a grid, so test for it first and
       load nothing at all on those surfaces. */
    const grid = document.querySelector('.grid');
    if (!grid) return;
    await loadOnce('assets/js/specs.js');
    await loadOnce('assets/js/store.js');
    await loadOnce('assets/js/auth.js');
    await loadOnce('assets/js/homes.js');
    await loadOnce('assets/js/prefs.js');
    if (!window.skPrefs) return;
    const bar = document.createElement('div');
    grid.parentElement.insertBefore(bar, grid);
    const api = window.skPrefs.mountBar(bar, { onChange: () => { window.skPrefs.applyToCards(document); api && api.redraw(); window.skPrefs.applyToCards(document); } });
    window.skPrefs.applyToCards(document);
    // the profile may arrive after the session resolves
    window.skAuth && window.skAuth.onChange(() => { api && api.redraw(); window.skPrefs.applyToCards(document); });
  }

  /* ================= CSS — iOS "frosted glass" material ================= */
  function injectCSS() {
    if (document.getElementById('sk-nav-css')) return;
    const css = `
    .sw-topbar{display:none!important;}   /* engine's own bar is fully replaced */
    .sk-announce{position:fixed;left:12px;right:12px;bottom:12px;z-index:80;display:flex;gap:12px;align-items:center;justify-content:space-between;
      padding:10px 14px;border-radius:12px;font:700 .86rem Cairo,sans-serif;color:#fff;background:#2E7E88;box-shadow:0 10px 30px rgba(0,0,0,.25);}
    .sk-announce--warn{background:#9a3412;}
    .sk-announce + .sk-announce{bottom:64px;}
    .sk-announce button{background:none;border:0;color:inherit;font-size:1.3rem;cursor:pointer;line-height:1;padding:0 4px;}
    .sk-glass{background:rgba(252,251,248,.58);
      -webkit-backdrop-filter:blur(22px) saturate(1.9);backdrop-filter:blur(22px) saturate(1.9);
      border:1px solid rgba(255,255,255,.55);
      box-shadow:0 12px 34px rgba(18,42,47,.16), inset 0 1px 0 rgba(255,255,255,.6);}
    .sk-nav{direction:rtl;position:fixed;top:0;left:0;right:0;z-index:70;
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:10px clamp(14px,3.4vw,42px);font-family:'Cairo','Segoe UI',system-ui,sans-serif;
      pointer-events:none;}
    .sk-nav>*{pointer-events:auto;}
    /* Overlay on subpages too (not sticky), so the strap no longer occupies a
       band of white body background above the hero — the page's own coloured
       background now runs to the very top boundary, behind the glass strap. The
       first content block after the strap is padded down to clear it. */
    .sk-nav--solid{position:fixed;}
    .sk-nav--solid+*{padding-top:calc(var(--sk-nav-h,86px) + 20px)!important;}
    .sk-nav__logo img{height:52px;width:auto;display:block;}
    /* the links pill sits dead-centre of the viewport, like an iOS nav */
    .sk-nav__links{position:absolute;left:50%;top:10px;transform:translateX(-50%);
      display:flex;align-items:center;gap:2px;padding:5px;border-radius:999px;}
    .sk-link{font:700 .88rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;border:0;
      background:transparent;cursor:pointer;padding:8px 15px;border-radius:999px;
      display:inline-flex;align-items:center;gap:6px;transition:color .2s,background .2s;}
    .sk-link:hover{color:#14343a;background:rgba(46,126,136,.13);}
    .sk-link.is-active{color:#fff;background:#2E7E88;box-shadow:0 4px 14px rgba(46,126,136,.4);}
    .sk-caret{width:7px;height:7px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;
      transform:rotate(-45deg) translateY(-2px);transition:transform .22s;flex:0 0 auto;}
    .sk-shop{position:relative;}
    .sk-shop.is-open>.sk-shop__btn .sk-caret{transform:rotate(135deg) translateY(-1px);}
    /* compact dropdown: just the titles; kids expand in place */
    .sk-menu{position:absolute;top:calc(100% + 12px);right:50%;transform:translate(50%,-8px);
      width:min(86vw,280px);max-height:min(66vh,520px);overflow:auto;border-radius:20px;padding:8px;
      opacity:0;visibility:hidden;transition:opacity .22s,transform .22s,visibility .22s;z-index:80;
      overscroll-behavior:contain;}
    .sk-shop.is-open .sk-menu{opacity:1;visibility:visible;transform:translate(50%,0);}
    .sk-menu__all{display:block;text-align:center;font:800 .88rem 'Cairo',sans-serif;color:#fff;
      text-decoration:none;background:#2E7E88;border-radius:13px;padding:10px 14px;margin-bottom:6px;
      box-shadow:0 5px 16px rgba(46,126,136,.35);}
    .sk-menu__all:hover{background:#256A73;}
    .sk-menu__row{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;
      font:700 .85rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;text-align:right;
      background:transparent;border:0;cursor:pointer;padding:10px 12px;border-radius:12px;
      transition:background .18s,color .18s;}
    .sk-menu__row:hover{background:rgba(46,126,136,.12);color:#14343a;}
    .sk-menu__row .sk-caret{transform:rotate(45deg);}                 /* points down (rtl) */
    .sk-menu__item.is-open .sk-menu__row{background:rgba(46,126,136,.1);color:#14343a;}
    .sk-menu__item.is-open .sk-menu__row .sk-caret{transform:rotate(135deg);}
    .sk-menu__kids{max-height:0;overflow:hidden;transition:max-height .28s ease;}
    .sk-menu__item.is-open .sk-menu__kids{max-height:340px;}
    .sk-menu__kids a{display:block;font:600 .8rem 'Cairo',sans-serif;color:#4c6468;text-decoration:none;
      padding:7px 12px;margin-right:14px;border-right:2px solid rgba(46,126,136,.22);border-radius:0 10px 10px 0;}
    .sk-menu__kids a:hover{background:rgba(46,126,136,.1);color:#14343a;}
    /* ---- desktop "More" split dropdown (two columns side by side) ---- */
    .sk-more{position:relative;}
    .sk-morepanel{position:absolute;top:calc(100% + 12px);right:50%;transform:translate(50%,-8px);
      display:flex;gap:8px;padding:14px;border-radius:20px;
      opacity:0;visibility:hidden;transition:opacity .22s,transform .22s,visibility .22s;z-index:80;}
    .sk-more.is-open .sk-morepanel{opacity:1;visibility:visible;transform:translate(50%,0);}
    /* opaque enough to read over the shop's busy banners */
    .sk-morepanel{background:rgba(249,247,243,.96);}
    .sk-morecol{min-width:158px;display:flex;flex-direction:column;gap:2px;}
    .sk-morecol+.sk-morecol{border-inline-start:1px solid rgba(46,126,136,.16);padding-inline-start:8px;}
    .sk-morecol h4{margin:2px 10px 6px;font:800 .68rem 'Cairo',sans-serif;letter-spacing:.05em;
      text-transform:uppercase;color:#8a9aa0;}
    .sk-morelink{display:block;font:700 .85rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;
      padding:9px 12px;border-radius:12px;white-space:nowrap;transition:background .16s,color .16s;}
    .sk-morelink:hover{background:rgba(46,126,136,.12);color:#14343a;}
    .sk-morelink.is-active{background:#2E7E88;color:#fff;}
    .sk-nav__side{display:flex;align-items:center;gap:10px;}
    .sk-hotline{font:800 .86rem 'Cairo',sans-serif;color:#241a05;text-decoration:none;background:#fe9800;
      padding:9px 17px;border-radius:999px;white-space:nowrap;box-shadow:0 6px 16px rgba(254,152,0,.35);
      transition:transform .15s;}
    .sk-hotline:hover{transform:translateY(-1px);}
    /* ---- hamburger + off-canvas drawer (mobile only; hidden on desktop) ---- */
    .sk-burger{display:none;flex-direction:column;justify-content:center;gap:5px;width:46px;height:46px;
      border-radius:14px;cursor:pointer;padding:0 13px;border:1px solid rgba(255,255,255,.55);}
    .sk-burger span{display:block;height:2.5px;border-radius:2px;background:#28464b;transition:transform .28s,opacity .2s;}
    .sk-burger.is-open span:nth-child(1){transform:translateY(7.5px) rotate(45deg);}
    .sk-burger.is-open span:nth-child(2){opacity:0;}
    .sk-burger.is-open span:nth-child(3){transform:translateY(-7.5px) rotate(-45deg);}
    .sk-scrim{position:fixed;inset:0;z-index:90;background:rgba(16,40,45,.44);
      opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s;}
    .sk-scrim.is-open{opacity:1;visibility:visible;}
    .sk-drawer{position:fixed;top:0;bottom:0;left:0;z-index:95;width:min(85vw,340px);
      display:flex;flex-direction:column;direction:rtl;border-radius:0 24px 24px 0;
      /* glassy, but opaque enough that text stays legible over a busy page */
      background:rgba(249,247,243,.9);
      transform:translateX(-104%);transition:transform .34s cubic-bezier(.4,0,.2,1);}
    .sk-drawer.sk-nav--en{direction:ltr;}
    .sk-drawer.is-open{transform:translateX(0);}
    .sk-drawer__top{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 8px;flex:0 0 auto;}
    .sk-drawer__logo img{height:46px;width:auto;display:block;}
    .sk-drawer__x{font-size:1.9rem;line-height:1;background:none;border:0;color:#28464b;cursor:pointer;
      width:42px;height:42px;border-radius:50%;display:grid;place-items:center;}
    .sk-drawer__x:hover{background:rgba(46,126,136,.12);}
    .sk-drawer__icons{display:flex;gap:8px;padding:4px 16px 12px;flex:0 0 auto;}
    .sk-diconbtn{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;
      padding:11px 4px;border-radius:15px;text-decoration:none;color:#28464b;font:700 .72rem 'Cairo',sans-serif;
      background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.5);}
    .sk-diconbtn.is-active{background:#2E7E88;color:#fff;border-color:#2E7E88;}
    .sk-diconbtn svg{width:22px;height:22px;}
    .sk-diconbtn .sk-saved__badge,.sk-diconbtn .sk-cart__badge{top:6px;left:10px;}
    .sk-drawer__nav{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:6px 12px;
      display:flex;flex-direction:column;gap:2px;-webkit-overflow-scrolling:touch;}
    .sk-dlink{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;
      font:700 .96rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;text-align:start;
      padding:13px 14px;border-radius:13px;background:none;border:0;cursor:pointer;}
    .sk-dlink:hover{background:rgba(46,126,136,.1);}
    .sk-dlink.is-active{background:#2E7E88;color:#fff;}
    .sk-dlink--cta{background:#fdecd0;color:#8a5b12;}
    .sk-dgroup h4{margin:12px 14px 4px;font:800 .72rem 'Cairo',sans-serif;letter-spacing:.04em;
      text-transform:uppercase;color:#8a9aa0;}
    .sk-dacc__btn .sk-caret{transform:rotate(45deg);}
    .sk-dacc.is-open .sk-dacc__btn .sk-caret{transform:rotate(135deg);}
    .sk-dacc__body{max-height:0;overflow:hidden;transition:max-height .32s ease;}
    .sk-dacc.is-open .sk-dacc__body{max-height:62vh;overflow-y:auto;}
    .sk-dmenu{padding:2px 4px 6px;}
    .sk-drawer__foot{flex:0 0 auto;display:flex;gap:10px;padding:14px 16px calc(14px + env(safe-area-inset-bottom));
      border-top:1px solid rgba(46,126,136,.18);}
    .sk-dlang{flex:0 0 auto;font:800 .82rem 'Cairo',sans-serif;color:#28464b;cursor:pointer;
      background:rgba(255,255,255,.55);border:1px solid rgba(46,126,136,.28);border-radius:999px;padding:11px 16px;}
    .sk-dcall{flex:1;text-align:center;font:800 .92rem 'Cairo',sans-serif;color:#241a05;text-decoration:none;
      background:#fe9800;border-radius:999px;padding:12px;box-shadow:0 6px 16px rgba(254,152,0,.35);}
    html.sk-lock{overflow:hidden;}
    /* ---- shared company footer (legacy + home pages) ---- */
    .sk-foot{background:#2E7E88;color:#fff;direction:rtl;font-family:'Cairo','Segoe UI',system-ui,sans-serif;}
    .sk-nav--en~.sk-foot,html[dir=ltr] .sk-foot{direction:ltr;}
    .sk-foot .foot__inner{max-width:1240px;margin:0 auto;padding:40px clamp(16px,4vw,48px);}
    .sk-foot .foot__cols{display:grid;gap:26px;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));text-align:start;}
    .sk-foot h4{margin:0 0 10px;font-size:.95rem;color:#fff;}
    .sk-foot ul{list-style:none;margin:0;padding:0;display:grid;gap:8px;}
    .sk-foot a{color:#fff;text-decoration:none;font-weight:700;font-size:.86rem;}
    .sk-foot a:hover{color:#E6F0F1;text-decoration:underline;}
    .sk-foot .foot__tag{margin:14px 0 0;font-size:.82rem;opacity:.8;line-height:1.8;}
    .foot__contact{text-align:center;}
    .foot__contact ul{justify-items:center;}
    .foot__social{display:flex;justify-content:center;gap:10px;margin-top:14px;flex-wrap:wrap;}
    .foot__social a{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;
      background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.3);transition:background .18s,color .18s,transform .15s;}
    .foot__social a:hover{background:#fff;color:#2E7E88;transform:translateY(-1px);}
    .sk-foot .foot__legal{max-width:1240px;margin:22px auto 0;padding:18px clamp(16px,4vw,48px) 6px;
      border-top:1px solid rgba(255,255,255,.22);font-size:.78rem;opacity:.8;line-height:1.9;}
    /* on the 3D home the footer sits at the very bottom of the scroll, above the fixed scene */
    .sk-foot--home{position:relative;z-index:32;}
    @media (max-width:560px){ .sk-foot .foot__cols{grid-template-columns:repeat(2,1fr);gap:20px;} }
    .sk-cart{position:relative;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;
      color:#28464b;transition:color .2s,background .2s;}
    .sk-cart:hover,.sk-cart.is-active{color:#fff;background:#2E7E88;}
    .sk-cart__badge{position:absolute;top:-5px;left:-5px;min-width:19px;height:19px;border-radius:999px;
      background:#fe9800;color:#241a05;font:800 .68rem/19px 'Cairo',sans-serif;text-align:center;
      padding:0 4px;font-style:normal;box-shadow:0 2px 8px rgba(0,0,0,.25);}
    .sk-saved__badge{position:absolute;top:-5px;left:-5px;min-width:19px;height:19px;border-radius:999px;
      background:#2E7E88;color:#fff;font:800 .68rem/19px 'Cairo',sans-serif;text-align:center;
      padding:0 4px;font-style:normal;box-shadow:0 2px 8px rgba(0,0,0,.25);}
    html[dir=ltr] .sk-saved__badge{left:auto;right:-5px;}
    .sk-acct__dot{position:absolute;top:-2px;left:-2px;width:11px;height:11px;border-radius:50%;
      background:#17795a;border:2px solid #fff;font-style:normal;}
    html[dir=ltr] .sk-acct__dot{left:auto;right:-2px;}
    /* the finder is the entry point to the whole buying journey — give it weight */
    .sk-link--cta{background:#fdecd0;color:#8a5b12;}
    .sk-link--cta:hover,.sk-link--cta.is-active{background:#fe9800;color:#241a05;}
    .sk-lang{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;cursor:pointer;
      font:800 .82rem 'Cairo',sans-serif;color:#28464b;transition:color .2s,background .2s;padding:0;}
    .sk-lang:hover{color:#fff;background:#2E7E88;}
    /* English strap: flip to LTR and mirror the accordion indent */
    .sk-nav--en{direction:ltr;}
    .sk-nav--en .sk-menu__row{text-align:left;}
    .sk-nav--en .sk-menu__kids a{margin-right:0;margin-left:14px;border-right:0;
      border-left:2px solid rgba(46,126,136,.22);border-radius:10px 0 0 10px;}
    .sk-addbtn{font:700 .78rem 'Cairo',sans-serif;color:#fff;background:#2E7E88;border:0;cursor:pointer;
      padding:8px 14px;border-radius:999px;transition:background .2s,transform .15s;}
    .sk-addbtn:hover{background:#256A73;transform:translateY(-1px);}
    .sk-addbtn.is-done{background:#1d7a3f;}
    .sk-detbtn{font:700 .78rem 'Cairo',sans-serif;color:#2A7779;background:#EFF6F6;text-decoration:none;
      border:1px solid rgba(46,126,136,.28);padding:7px 13px;border-radius:999px;transition:.18s;}
    .sk-detbtn:hover{background:#2E7E88;color:#fff;}
    /* .sk-fcta (the guided-finder call-out) now lives with the rest of the shop's
       visual layer, in assets/css/storefront.css — the file that owns every other
       block in that column and the spacing tokens they all step through. */
    /* keep page content clear of the sticky glass bar on sub-pages */
    .sk-nav--solid+*{margin-top:6px;}
    /* ---- search: lens in the strap + full-screen popup over a blurred page ---- */
    .sk-searchbtn{padding:8px 12px;}
    .sk-searchbtn svg{display:block;}
    .sk-msearch{display:none;}
    .sk-search{position:fixed;inset:0;z-index:200;display:flex;justify-content:center;align-items:flex-start;
      padding:clamp(64px,11vh,120px) 14px 24px;background:rgba(16,40,45,.38);
      -webkit-backdrop-filter:blur(12px) saturate(1.1);backdrop-filter:blur(12px) saturate(1.1);
      opacity:0;visibility:hidden;transition:opacity .22s,visibility .22s;direction:rtl;}
    .sk-search.sk-nav--en{direction:ltr;}
    .sk-search.is-open{opacity:1;visibility:visible;}
    .sk-search__x{position:absolute;top:18px;inset-inline-end:20px;width:46px;height:46px;border-radius:50%;
      border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.85);color:#14343a;font:400 30px/1 sans-serif;
      cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.18);}
    .sk-search__x:hover{background:#fff;}
    .sk-search__box{width:min(720px,100%);max-height:100%;display:flex;flex-direction:column;
      background:rgba(249,247,243,.97);border-radius:24px;box-shadow:0 24px 70px rgba(10,30,34,.35);overflow:hidden;
      transform:translateY(-10px);transition:transform .22s;}
    .sk-search.is-open .sk-search__box{transform:none;}
    .sk-search__form{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(46,126,136,.15);color:#2A7779;}
    .sk-search__form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:700 1.05rem 'Cairo',sans-serif;color:#14343a;padding:6px 0;}
    .sk-search__form input::-webkit-search-cancel-button{display:none;}
    .sk-search__res{overflow:auto;overscroll-behavior:contain;padding:6px 10px 12px;}
    .sk-search__res:empty{display:none;}
    .sk-search__msg{margin:14px 10px;font:600 .9rem 'Cairo',sans-serif;color:#6a7d81;}
    .sk-search__chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 6px 4px;}
    .sk-search__chip{display:inline-flex;align-items:center;gap:6px;font:700 .82rem 'Cairo',sans-serif;color:#36584B;
      text-decoration:none;background:rgba(46,126,136,.1);border-radius:999px;padding:6px 12px;}
    .sk-search__chip em{font-style:normal;font-weight:600;font-size:.7rem;color:#6a7d81;}
    .sk-search__chip b{font-weight:600;color:#6a7d81;font-size:.72rem;}
    .sk-search__h{margin:12px 8px 4px;font:800 .7rem 'Cairo',sans-serif;letter-spacing:.04em;color:#8a9aa0;}
    .sk-search__list{list-style:none;margin:0;padding:0;}
    .sk-search__item{display:flex;align-items:center;gap:12px;padding:8px;border-radius:14px;text-decoration:none;color:#14343a;}
    .sk-search__item img,.sk-search__noimg{width:52px;height:52px;flex:0 0 52px;border-radius:10px;object-fit:contain;background:#fff;}
    .sk-search__txt{display:flex;flex-direction:column;min-width:0;}
    .sk-search__name{font:700 .88rem/1.45 'Cairo',sans-serif;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
    .sk-search__meta{font:700 .8rem 'Cairo',sans-serif;color:#2A7779;}
    .sk-search__meta i{font-style:normal;color:#b0563c;}
    .sk-search__all{display:block;text-align:center;margin:8px 6px 2px;padding:11px;border-radius:14px;
      font:800 .88rem 'Cairo',sans-serif;color:#fff;background:#2E7E88;text-decoration:none;}
    .sk-search__item:hover,.sk-search__item.is-active{background:rgba(46,126,136,.12);}
    .sk-search__chip:hover,.sk-search__chip.is-active{background:rgba(46,126,136,.22);}
    .sk-search__all:hover,.sk-search__all.is-active{background:#256A73;}
    /* Mid width: the desktop pill still fits (only 5 items now), but its own
       menus need to escape the pill's overflow, so pin them to the viewport. */
    @media (max-width:1180px){
      .sk-menu,.sk-morepanel{position:fixed;top:76px;right:auto;left:50%;transform:translate(-50%,-8px);}
      .sk-shop.is-open .sk-menu,.sk-more.is-open .sk-morepanel{transform:translate(-50%,0);}
    }
    /* ---- mobile: hamburger + centred logo, everything else in the drawer ---- */
    @media (max-width:1080px){
      .sk-nav{position:fixed;justify-content:center;min-height:60px;padding:8px clamp(10px,3vw,18px);}
      .sk-nav--solid{position:fixed;}
      /* ONE clearance, not two. The desktop rule further up also pads this block by
         (--sk-nav-h + 20px), and --sk-nav-h is only measured on the overlay nav, so
         subpages fell back to 86px — 64 + 106 = 170px of clearance above a strap
         that is 62px tall on a phone. The margin alone clears the strap; the
         padding then sets the gap, matched to the section rhythm below the first
         block so the space above the shop's top ad reads the same as the space
         under it. */
      .sk-nav--solid+*{margin-top:64px;padding-top:26px!important;}
      .sk-burger{display:flex;position:absolute;left:clamp(10px,3vw,18px);top:50%;transform:translateY(-50%);}
      .sk-nav__logo{margin:0;}
      .sk-nav__logo img{height:46px;}
      .sk-nav__links,.sk-nav__side{display:none;}
      .sk-msearch{display:flex;align-items:center;justify-content:center;position:absolute;right:clamp(10px,3vw,18px);
        top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:14px;cursor:pointer;color:#28464b;
        border:1px solid rgba(255,255,255,.55);padding:0;}
      .sk-search{padding-top:72px;}
      .sk-search__x{top:12px;width:42px;height:42px;}
    }
    /* the home page has no sticky spacer (fixed overlay), so no top margin there */
    @media (max-width:1080px){ .sk-nav--overlay+*{margin-top:0;} }
    `;
    const style = document.createElement('style');
    style.id = 'sk-nav-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* No bottom bar on the shop pages (owner, 2026-11-17: "distracting"). The
     Home/Shop bar (modebar.js) lives only on the home page now (guide.js);
     from the shop, "Home" in the top strap goes back to the house. */
})();
