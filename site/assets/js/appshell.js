/* ============================================================================
   SADKO app shell — the handful of things every buying-journey page needs:
   the catalogue, the category map, money/date formatting in the active
   language, and the shared footer (which is where the honest disclosures about
   warranty, delivery and seller coverage live).
   ========================================================================== */
(function () {
  'use strict';

  const EN = () => !!(window.skLang && window.skLang.get() === 'en');
  const t = (ar, en) => (EN() ? en : ar);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Paths differ between /page.html and /category/page.html
  const ROOT = /\/category\//.test(location.pathname);
  const P = p => (ROOT ? '../' : '') + p;

  const qs = (k, d) => { const v = new URLSearchParams(location.search).get(k); return v == null ? d : v; };

  function money(n) {
    if (n == null || isNaN(n)) return t('غير متاح', 'n/a');
    const v = Math.round(Number(n));
    return EN() ? v.toLocaleString('en-EG') + ' EGP' : v.toLocaleString('ar-EG') + ' جنيه';
  }
  function num(n) { return EN() ? Number(n).toLocaleString('en-EG') : Number(n).toLocaleString('ar-EG'); }
  function date(d) {
    const x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x)) return '-';
    return x.toLocaleDateString(EN() ? 'en-GB' : 'ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* ---------- catalogue ---------- */
  let _cache = null;
  function products() {
    if (_cache) return _cache;
    _cache = fetch(P('data/products.json')).then(r => r.json()).then(d => d.products || []).catch(() => []);
    return _cache;
  }
  function byId(id) { return products().then(list => list.find(p => String(p.id) === String(id)) || null); }
  function inCategory(cid) { return products().then(list => list.filter(p => String(p.categoryId) === String(cid))); }

  /* ---------- categories that actually have products ---------- */
  // Names come from nav.js's CAT_EN map where available; the Arabic label is the
  // source of truth since the catalogue is Arabic-authored.
  const CATS = {
    '38003882':  { ar: 'ثلاجات', en: 'Refrigerators' },
    '38005652':  { ar: 'غسالات', en: 'Washing machines' },
    '38005648':  { ar: 'فريزرات', en: 'Freezers' },
    '38003799':  { ar: 'أفران وبوتاجازات', en: 'Cookers & ovens' },
    '38032005':  { ar: 'تكييفات هواء', en: 'Air conditioners' },
    '38022381':  { ar: 'تليفزيونات', en: 'Televisions' },
    '50318054':  { ar: 'مبردات هواء ومراوح', en: 'Air coolers & fans' },
    '40507239':  { ar: 'سخانات مياه', en: 'Water heaters' },
    '102858075': { ar: 'مبردات مياه', en: 'Water dispensers' },
    '112439376': { ar: 'أجهزة صغيرة', en: 'Small appliances' },
    '57646037':  { ar: 'ميكروويف', en: 'Microwaves' },
    '68782006':  { ar: 'خلاطات وعجانات', en: 'Blenders & mixers' },
    '185355010': { ar: 'كاتيل وماكينات قهوة', en: 'Kettles & coffee machines' },
    '185364502': { ar: 'قلايات', en: 'Air fryers' },
    '81167227':  { ar: 'مكاوى', en: 'Irons' },
    '81170222':  { ar: 'مكانس', en: 'Vacuum cleaners' },
    '38022354':  { ar: 'غسالات أطباق', en: 'Dishwashers' },
    '48143206':  { ar: 'سخانات غاز', en: 'Gas water heaters' },
    '48149056':  { ar: 'سخانات كهرباء', en: 'Electric water heaters' },
  };
  /* Names Ecwid knows about, merged in as a FALLBACK for ids the curated map
     lacks. Never overrides a curated entry: those have a real English name and
     Ecwid holds none for this store. Arabic-only names are used for both
     languages, which is honest — the alternative is a numeric id. */
  let ECWID_CATS = {};
  /* The store's Arabic names differ from nav.js's curated keys only in spelling
     (hamza on/off, a space after و), so compare on a normalised form. Names the
     curated table has no entry for at all are listed here. */
  const EXTRA_EN = { 'المنتجات الاكثر مبيعا': 'Best sellers', 'افران': 'Ovens' };
  const norm = x => String(x).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ً/g, '').replace(/وs+/g, 'و').replace(/s+/g, ' ').trim();
  function enByArabic(name) {
    const want = norm(name);
    if (EXTRA_EN[want]) return EXTRA_EN[want];
    const cur = window.skCatEn || {};
    for (const k of Object.keys(cur)) if (norm(k) === want) return cur[k];
    return null;
  }
  let ecwidCatsLoaded = null;
  function loadEcwidCats() {
    if (ecwidCatsLoaded) return ecwidCatsLoaded;
    ecwidCatsLoaded = fetch(P('data/categories.json'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        for (const c of (d && d.categories) || []) {
          if (!c || !c.id || !c.name) continue;
          /* Ecwid holds no English name for this store, so fall back to nav.js's
             curated name table (keyed by the Arabic name) before the Arabic one. */
          ECWID_CATS[String(c.id)] = { ar: c.name, en: c.nameEn || enByArabic(c.name) || c.name };
        }
        return ECWID_CATS;
      })
      .catch(() => ECWID_CATS);
    return ecwidCatsLoaded;
  }
  loadEcwidCats();

  const catName = cid => {
    const k = String(cid);
    const c = CATS[k] || ECWID_CATS[k];
    return c ? t(c.ar, c.en) : t('فئة', 'Category');
  };
  const catHref = cid => P('category/' + cid + '.html');

  /* Categories with at least one product, for pickers. */
  function liveCats() {
    return Promise.all([products(), loadEcwidCats()]).then(([list]) => {
      const n = {};
      /* Skips the products with no category at all — see the same guard in
         shop-core.js liveCategories(). Counting them under String(null)
         produced a nameless "فئة" tile that led nowhere. */
      list.forEach(p => { if (p.categoryId == null || p.categoryId === "") return;
                          n[String(p.categoryId)] = (n[String(p.categoryId)] || 0) + 1; });
      /* Previously filtered to CATS, which silently returned NOTHING for a
         store whose ids the curated map does not cover. A category with
         products in it is real whether or not we have a curated name. */
      return Object.keys(n).map(k => ({ id: k, count: n[k], name: catName(k) }))
        .sort((a, b) => b.count - a.count);
    });
  }

  /* ---------- shared footer ---------- */
  function footer(host) {
    const el = host || document.querySelector('[data-footer]');
    if (!el) return;
    const L = [
      { h: t('صادكو', 'SADKO'), items: [
        [t('من نحن', 'About us'), P('about.html')],
        [t('تواصل معنا', 'Contact us'), P('contact.html')],
        [t('المعارض', 'Showrooms'), P('showrooms.html')],
        [t('حسابى', 'My account'), P('account.html')],
      ] },
      { h: t('قبل الشراء', 'Before you buy'), items: [
        [t('ساعدنى أختار', 'Help me choose'), P('finder.html')],
        [t('دليلك للاختيار', 'Buying guides'), P('guides.html')],
        [t('قارن الأسعار', 'Compare prices'), P('compare.html')],
        [t('خطط التجهيز', 'Shopping plans'), P('plan.html')],
      ] },
      { h: t('بعد الشراء', 'After you buy'), items: [
        [t('أجهزتى والضمان', 'My appliances & warranty'), P('appliances.html')],
        [t('مركز خدمة العملاء', 'Customer care'), P('care.html')],
        [t('طلباتى', 'My orders'), P('orders.html')],
        [t('التوصيل والتركيب', 'Delivery & installation'), P('delivery.html')],
      ] },
      { h: t('معلومات', 'Information'), items: [
        [t('الضمان والاسترجاع', 'Warranty & returns'), P('warranty.html')],
        [t('الخصوصية', 'Privacy'), P('privacy.html')],
        [t('شروط الاستخدام', 'Terms of use'), P('terms.html')],
      ] },
    ].map(c => ({ h: c.h, items: c.items.filter(i => !(window.skFeature && window.skFeature.hidden(i[1]))) }));
    el.className = 'foot';
    el.innerHTML =
      '<div class="foot__inner"><div class="foot__cols">' +
      L.map(c => '<div><h4>' + esc(c.h) + '</h4><ul>' +
        c.items.map(i => '<li><a href="' + i[1] + '">' + esc(i[0]) + '</a></li>').join('') +
        '</ul></div>').join('') +
      '<div class="foot__contact"><h4>' + t('اتصل بنا', 'Talk to us') + '</h4><ul>' +
        '<li><a href="tel:19140" dir="ltr">19140</a></li>' +
        '<li><a href="mailto:csupport@sadko-group.com" dir="ltr">csupport@sadko-group.com</a></li>' +
      '</ul>' + (window.skSocial ? window.skSocial() : '') +
      '<p style="margin:14px 0 0;font-size:.82rem;opacity:.8;line-height:1.8">' +
        t('مجموعة صادكو، من 1986، والموزّع الوحيد لكريازى.', 'SADKO Group, since 1986, sole distributor of Kiriazi.') + '</p></div>' +
      '</div><p class="foot__legal">' +
      (window.skLegal ? esc(window.skLegal()) : '') +
      '<br>© ' + t('صادكو جروب', 'SADKO Group') + ' 2026</p></div>';
  }

  /* Small helper: render an "empty state" block. */
  function empty(msg, ctaLabel, ctaHref) {
    return '<div class="empty"><p>' + esc(msg) + '</p>' +
      (ctaLabel ? '<a class="btn btn--teal" href="' + ctaHref + '">' + esc(ctaLabel) + '</a>' : '') + '</div>';
  }

  window.skApp = { EN, t, esc, P, qs, money, num, date, products, byId, inCategory,
                   CATS, catName, catHref, liveCats, footer, empty };
})();
