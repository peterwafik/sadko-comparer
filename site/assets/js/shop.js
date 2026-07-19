/* SADKO shop — classic e-commerce listing over data/products.json.
   Sidebar category tree (parents + subcategories), search, price sort,
   24-per-page "load more", add-to-cart via window.skCart (nav.js).
   Bilingual: nav.js owns the language (window.skLang); category names come
   from window.skCatEn, product titles from the catalog translator. */

(function () {
  const LANG = (window.skLang && window.skLang.get()) || 'ar';
  const EN = LANG === 'en';
  const CAT = window.skCatEn || {};

  const TREE = [
    { id: '', name: 'كل المنتجات' },
    { id: '38003882', name: 'ثلاجات', kids: [['38022268', 'نو فروست'], ['38022269', 'ديفروست']] },
    { id: '38005648', name: 'فريزرات', kids: [['38022353', 'فريزر أفقى'], ['38005649', 'فريزر رأسى']] },
    { id: '38003799', name: 'أفران وبوتاجازات', kids: [['50846528', '4 شعلة'], ['50844229', '5 شعلة'], ['38022202', 'أفران كهربائية']] },
    { id: '38005652', name: 'غسالات', kids: [['38003963', 'غسالات ملابس'], ['38022354', 'غسالات أطباق']] },
    { id: '40507239', name: 'سخانات مياه', kids: [['48149056', 'سخانات كهرباء'], ['48143206', 'سخانات غاز']] },
    { id: '112439376', name: 'أجهزة صغيرة', kids: [['81170222', 'مكانس'], ['81167227', 'مكاوى'], ['68782006', 'خلاطات ومحضرات'], ['57646037', 'ميكروييف'], ['185355010', 'كاتيل وقهوة'], ['185364502', 'قلايات']] },
    { id: '38032005', name: 'تكييفات هواء' },
    { id: '38022381', name: 'تليفزيونات' },
    { id: '50318054', name: 'مبردات هواء ومراوح' },
    { id: '102858075', name: 'مبردات مياه' },
    { id: '167433056', name: 'حرف يدوية ومنتجات عضوية' },
  ];
  const T = {
    ar: { title: 'المتجر — صادكو جروب', crumbHome: 'البيت', crumbArrow: '←', crumbHere: 'المتجر',
      heroTitle: 'متجر صادكو', metaAll: n => 'كل الأجهزة فى مكان واحد — ' + n + ' منتج',
      metaCat: (c, n) => 'فئة: ' + c + ' — ' + n + ' منتج', cats: 'الفئات', cnt: n => n + ' منتج',
      qPh: 'دوّر على جهاز… (مثلاً: ثلاجة كريازى)', sortDefault: 'الترتيب الافتراضى',
      sortAsc: 'السعر: من الأقل للأعلى', sortDesc: 'السعر: من الأعلى للأقل',
      empty: 'مفيش نتايج للبحث ده — جرّب كلمة تانية.', more: 'حمّل المزيد', egp: 'جنيه',
      add: 'أضف للسلة', added: '✓ اتضافت',
      hotline: 'الخط الساخن', ship: 'توصيل مجانى داخل القاهرة والجيزة والإسكندرية · الدفع عند الاستلام أو بالبطاقة',
      copy: '© صادكو جروب 2026 — نسخة معاد تصميمها (Rebrand Preview)' },
    en: { title: 'Shop — SADKO Group', crumbHome: 'Home', crumbArrow: '→', crumbHere: 'Shop',
      heroTitle: 'SADKO Shop', metaAll: n => 'All appliances in one place — ' + n + ' products',
      metaCat: (c, n) => 'Category: ' + c + ' — ' + n + ' products', cats: 'Categories', cnt: n => n + ' products',
      qPh: 'Search for an appliance… (e.g. Kiriazi refrigerator)', sortDefault: 'Default order',
      sortAsc: 'Price: low to high', sortDesc: 'Price: high to low',
      empty: 'No results for this search — try another word.', more: 'Load more', egp: 'EGP',
      add: 'Add to cart', added: '✓ Added',
      hotline: 'Hotline', ship: 'Free delivery in Cairo, Giza & Alexandria · Cash on delivery or card',
      copy: '© SADKO Group 2026 — Rebrand Preview' },
  }[LANG];
  const catName = n => (EN ? (CAT[n] || n) : n);
  const trTitle = s => (EN && window.skCatalogI18n ? window.skCatalogI18n.translateTitle(s) : clean(s));

  const PAGE = 24;
  let ALL = [], view = [], shown = 0;
  let cat = new URLSearchParams(location.search).get('cat') || '';
  let q = '', sort = 'default';

  const $ = id => document.getElementById(id);
  const fmt = n => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
  const clean = s => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  /* static page chrome */
  if (EN) {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    document.title = T.title;
  }
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (typeof T[k] === 'string') el.textContent = T[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.getAttribute('data-i18n-ph');
    if (typeof T[k] === 'string') el.placeholder = T[k];
  });

  function renderTree() {
    $('sideTree').innerHTML = '<h3>' + T.cats + '</h3>' + TREE.map(t =>
      `<a href="?cat=${t.id}" data-id="${t.id}" class="${cat === t.id ? 'is-on' : ''}">${catName(t.name)}</a>` +
      (t.kids ? t.kids.map(k =>
        `<a href="?cat=${k[0]}" data-id="${k[0]}" class="kid ${cat === k[0] ? 'is-on' : ''}">${catName(k[1])}</a>`).join('') : '')
    ).join('');
    $('sideTree').querySelectorAll('a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      cat = a.dataset.id;
      history.replaceState(null, '', cat ? '?cat=' + cat : 'shop.html');
      renderTree(); apply();
    }));
  }

  function apply() {
    const qq = q.toLowerCase();
    view = ALL.filter(p =>
      (!cat || String(p.categoryId) === cat) &&
      (!qq || clean(p.title).toLowerCase().includes(qq) ||
        String(p.description || '').toLowerCase().includes(qq) ||
        (EN && trTitle(p.title).toLowerCase().includes(qq))));
    if (sort === 'price-asc') view.sort((a, b) => (a.price || 9e9) - (b.price || 9e9));
    else if (sort === 'price-desc') view.sort((a, b) => (b.price || 0) - (a.price || 0));
    shown = 0;
    $('grid').innerHTML = '';
    $('cnt').textContent = T.cnt(view.length);
    const t = TREE.flatMap(x => [[x.id, x.name], ...(x.kids || [])]).find(x => x[0] === cat);
    $('heroMeta').textContent = cat && t ? T.metaCat(catName(t[1]), view.length) : T.metaAll(view.length);
    more();
  }

  function more() {
    const slice = view.slice(shown, shown + PAGE);
    shown += slice.length;
    const frag = document.createDocumentFragment();
    slice.forEach(p => {
      const el = document.createElement('article');
      el.className = 'card';
      el.innerHTML =
        `<a class="card__imgwrap" href="${p.url}" target="_blank" rel="noopener">` +
          (p.image ? `<img loading="lazy" decoding="async" src="${p.image}" alt="">` : `<span class="card__noimg"></span>`) +
        `</a>` +
        `<div class="card__body">` +
          `<h3 class="card__title"></h3>` +
          `<div class="card__row">` +
            `<span class="card__price">${fmt(p.price)} <small>${T.egp}</small></span>` +
            `<button type="button" class="sk-addbtn">${T.add}</button>` +
          `</div>` +
        `</div>`;
      el.querySelector('.card__title').textContent = trTitle(p.title);
      el.querySelector('.sk-addbtn').addEventListener('click', function () {
        window.skCart && window.skCart.add(p);
        this.textContent = T.added; this.classList.add('is-done');
        setTimeout(() => { this.textContent = T.add; this.classList.remove('is-done'); }, 1400);
      });
      frag.appendChild(el);
    });
    $('grid').appendChild(frag);
    $('empty').hidden = view.length > 0;
    $('more').hidden = shown >= view.length;
  }

  fetch('data/products.json').then(r => r.json()).then(d => {
    ALL = (d.products || []).filter(p => p.title);
    renderTree(); apply();
  });

  $('q').addEventListener('input', e => { q = e.target.value; apply(); });
  $('sort').addEventListener('change', e => { sort = e.target.value; apply(); });
  $('more').addEventListener('click', more);
})();
