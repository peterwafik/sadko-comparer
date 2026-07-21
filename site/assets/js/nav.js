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
      orders: 'الطلبات', showrooms: 'المعارض', experience: 'تجربة البيت', call: 'اتصل 19140', cartAria: 'سلة التسوق',
      pagesAria: 'صفحات الموقع', add: 'أضف للسلة', added: '✓ اتضافت', langBtn: 'EN', langTitle: 'Switch to English' },
    en: { home: 'Home', shop: 'Shop', all: 'All products', allPrefix: 'All ', compare: 'Compare Prices',
      orders: 'Orders', showrooms: 'Showrooms', experience: 'Home Experience', call: 'Call 19140', cartAria: 'Shopping cart',
      pagesAria: 'Site pages', add: 'Add to cart', added: '✓ Added', langBtn: 'ع', langTitle: 'التبديل إلى العربية' },
  }[LANG];
  const CAT_EN = {
    'ثلاجات': 'Refrigerators', 'نو فروست': 'No frost', 'ديفروست': 'Defrost',
    'فريزرات': 'Freezers', 'فريزر أفقى': 'Chest freezers', 'فريزر رأسى': 'Upright freezers',
    'أفران وبوتاجازات': 'Ovens & Cookers', '4 شعلة': '4 burners', '5 شعلة': '5 burners', 'أفران كهربائية': 'Electric ovens',
    'غسالات': 'Washers', 'غسالات ملابس': 'Washing machines', 'غسالات أطباق': 'Dishwashers',
    'سخانات مياه': 'Water heaters', 'سخانات كهرباء': 'Electric heaters', 'سخانات غاز': 'Gas heaters',
    'أجهزة صغيرة': 'Small appliances', 'مكانس': 'Vacuum cleaners', 'مكاوى': 'Irons',
    'خلاطات ومحضرات طعام': 'Blenders & food processors', 'ميكروييف': 'Microwaves',
    'كاتيل وماكينات قهوة': 'Kettles & coffee makers', 'قلايات': 'Air fryers',
    'تكييفات هواء': 'Air conditioners', 'تليفزيونات': 'TVs', 'مبردات هواء ومراوح': 'Air coolers & fans',
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
      const items = readCart();
      const hit = items.find(i => i.id === p.id);
      if (hit) hit.qty += (qty || 1);
      else items.push({ id: p.id, title: p.title, price: p.price, image: p.image, url: p.url, qty: qty || 1 });
      writeCart(items);
    },
    setQty(id, qty) {
      let items = readCart();
      items.forEach(i => { if (i.id === id) i.qty = qty; });
      items = items.filter(i => i.qty > 0);
      writeCart(items);
    },
    remove(id) { writeCart(readCart().filter(i => i.id !== id)); },
    clear() { writeCart([]); },
  };
  window.skCart = skCart;

  /* ================= header ================= */
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
      here === 'experience.html' ? 'experience' :
      here === 'cart.html' ? 'cart' :
      ROOT ? 'shop' : '';

    const header = document.createElement('header');
    header.className = 'sk-nav' + (overlay ? ' sk-nav--overlay' : ' sk-nav--solid') + (LANG === 'en' ? ' sk-nav--en' : '');
    header.innerHTML =
      `<a class="sk-nav__logo" href="${P('index.html')}"><img src="${P('assets/img/sadko-logo-white.png')}" alt="صادكو جروب"></a>` +
      `<nav class="sk-nav__links sk-glass" aria-label="${N.pagesAria}">` +
        `<a class="sk-link${active === 'home' ? ' is-active' : ''}" href="${P('index.html')}">${N.home}</a>` +
        `<div class="sk-shop">` +
          `<button type="button" class="sk-link sk-shop__btn${active === 'shop' ? ' is-active' : ''}" aria-haspopup="true" aria-expanded="false">${N.shop} <i class="sk-caret"></i></button>` +
          `<div class="sk-menu sk-glass" role="menu">` +
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
            ).join('') +
          `</div>` +
        `</div>` +
        `<a class="sk-link${active === 'compare' ? ' is-active' : ''}" href="${P('compare.html')}">${N.compare}</a>` +
        `<a class="sk-link${active === 'orders' ? ' is-active' : ''}" href="${P('orders.html')}">${N.orders}</a>` +
        `<a class="sk-link${active === 'showrooms' ? ' is-active' : ''}" href="${P('showrooms.html')}">${N.showrooms}</a>` +
        `<a class="sk-link${active === 'experience' ? ' is-active' : ''}" href="${P('experience.html')}">${N.experience}</a>` +
      `</nav>` +
      `<span class="sk-nav__side">` +
        `<button type="button" class="sk-lang sk-glass" title="${N.langTitle}" aria-label="${N.langTitle}">${N.langBtn}</button>` +
        `<a class="sk-hotline" href="tel:19140" dir="ltr">${N.call}</a>` +
        `<a class="sk-cart sk-glass${active === 'cart' ? ' is-active' : ''}" href="${P('cart.html')}" aria-label="${N.cartAria}">` +
          `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.5 12h10.2l2.2-8.5H6.2"/></svg>` +
          `<em class="sk-cart__badge" hidden>0</em>` +
        `</a>` +
      `</span>`;

    if (legacy) legacy.replaceWith(header);
    else document.body.prepend(header);

    header.querySelector('.sk-lang').addEventListener('click', () =>
      window.skLang.set(LANG === 'en' ? 'ar' : 'en'));

    /* dropdown open/close */
    const shop = header.querySelector('.sk-shop');
    const btn = header.querySelector('.sk-shop__btn');
    const setOpen = open => {
      shop.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (!open) header.querySelectorAll('.sk-menu__item.is-open').forEach(x => x.classList.remove('is-open'));
    };
    btn.addEventListener('click', e => { e.stopPropagation(); setOpen(!shop.classList.contains('is-open')); });
    document.addEventListener('click', e => { if (!shop.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });

    /* accordion: titles expand on click, one at a time */
    header.querySelectorAll('.sk-menu__item .sk-menu__row').forEach(row => {
      row.addEventListener('click', e => {
        e.stopPropagation();
        const item = row.parentElement;
        const open = !item.classList.contains('is-open');
        header.querySelectorAll('.sk-menu__item.is-open').forEach(x => x.classList.remove('is-open'));
        item.classList.toggle('is-open', open);
        row.setAttribute('aria-expanded', String(open));
      });
    });

    /* cart badge */
    const badge = header.querySelector('.sk-cart__badge');
    const paint = () => {
      const n = skCart.count();
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? '99+' : String(n);
    };
    document.addEventListener('sk-cart-change', paint);
    window.addEventListener('storage', e => { if (e.key === CART_KEY) paint(); });
    paint();

    if (ROOT && document.querySelector('article.card')) enhanceCategoryCards();
    if (ROOT && LANG === 'en') translateCategoryPage();
  }

  /* ---- English mode for the prebuilt (Arabic-authored) category pages ----
     Chrome comes from CAT_EN; product titles go through the rule-based
     catalog translator (assets/js/catalog-i18n.js, loaded before this). */
  function translateCategoryPage() {
    const T = window.skCatalogI18n;
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    const west = s => String(s).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/٬/g, ',');
    document.title = document.title.replace(/^([^—]+)—/, (m, n) => (CAT_EN[n.trim()] || n.trim()) + ' — ')
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
      .replace('© صادكو جروب 2026 — نسخة معاد تصميمها (Rebrand Preview)', '© SADKO Group 2026 — Rebrand Preview')
      .replace('توصيل مجانى داخل القاهرة والجيزة والإسكندرية · الدفع عند الاستلام أو بالبطاقة',
        'Free delivery in Cairo, Giza & Alexandria · Cash on delivery or card');
  }

  /* ---- add-to-cart buttons on the static category pages ---- */
  function enhanceCategoryCards() {
    fetch(P('data/products.json')).then(r => r.json()).then(d => {
      const byPath = {};
      (d.products || []).forEach(p => {
        try { byPath[decodeURIComponent(new URL(p.url).pathname)] = p; } catch (e) {}
      });
      document.querySelectorAll('article.card').forEach(card => {
        const link = card.querySelector('a.card__imgwrap') || card.querySelector('a[href]');
        if (!link) return;
        let prod = null;
        try { prod = byPath[decodeURIComponent(new URL(link.href).pathname)]; } catch (e) {}
        if (!prod) return;
        const row = card.querySelector('.card__row') || card.querySelector('.card__body') || card;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sk-addbtn';
        b.textContent = N.add;
        b.addEventListener('click', () => {
          skCart.add(prod);
          b.textContent = N.added;
          b.classList.add('is-done');
          setTimeout(() => { b.textContent = N.add; b.classList.remove('is-done'); }, 1400);
        });
        row.appendChild(b);
      });
    }).catch(() => {});
  }

  /* ================= CSS — iOS "frosted glass" material ================= */
  function injectCSS() {
    if (document.getElementById('sk-nav-css')) return;
    const css = `
    .sw-topbar{display:none!important;}   /* engine's own bar is fully replaced */
    .sk-glass{background:rgba(252,251,248,.58);
      -webkit-backdrop-filter:blur(22px) saturate(1.9);backdrop-filter:blur(22px) saturate(1.9);
      border:1px solid rgba(255,255,255,.55);
      box-shadow:0 12px 34px rgba(18,42,47,.16), inset 0 1px 0 rgba(255,255,255,.6);}
    .sk-nav{direction:rtl;position:fixed;top:0;left:0;right:0;z-index:70;
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:10px clamp(14px,3.4vw,42px);font-family:'Cairo','Segoe UI',system-ui,sans-serif;
      pointer-events:none;}
    .sk-nav>*{pointer-events:auto;}
    .sk-nav--solid{position:sticky;}
    .sk-nav__logo img{height:36px;width:auto;display:block;background:#2e7e88;
      border-radius:11px;padding:6px 12px;box-shadow:0 6px 16px rgba(46,126,136,.35);}
    /* the links pill sits dead-centre of the viewport, like an iOS nav */
    .sk-nav__links{position:absolute;left:50%;top:10px;transform:translateX(-50%);
      display:flex;align-items:center;gap:2px;padding:5px;border-radius:999px;}
    .sk-link{font:700 .88rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;border:0;
      background:transparent;cursor:pointer;padding:8px 15px;border-radius:999px;
      display:inline-flex;align-items:center;gap:6px;transition:color .2s,background .2s;}
    .sk-link:hover{color:#14343a;background:rgba(46,126,136,.13);}
    .sk-link.is-active{color:#fff;background:#2e7e88;box-shadow:0 4px 14px rgba(46,126,136,.4);}
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
      text-decoration:none;background:#2e7e88;border-radius:13px;padding:10px 14px;margin-bottom:6px;
      box-shadow:0 5px 16px rgba(46,126,136,.35);}
    .sk-menu__all:hover{background:#1f5b63;}
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
    .sk-nav__side{display:flex;align-items:center;gap:10px;}
    .sk-hotline{font:800 .86rem 'Cairo',sans-serif;color:#241a05;text-decoration:none;background:#fe9800;
      padding:9px 17px;border-radius:999px;white-space:nowrap;box-shadow:0 6px 16px rgba(254,152,0,.35);
      transition:transform .15s;}
    .sk-hotline:hover{transform:translateY(-1px);}
    .sk-cart{position:relative;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;
      color:#28464b;transition:color .2s,background .2s;}
    .sk-cart:hover,.sk-cart.is-active{color:#fff;background:#2e7e88;}
    .sk-cart__badge{position:absolute;top:-5px;left:-5px;min-width:19px;height:19px;border-radius:999px;
      background:#fe9800;color:#241a05;font:800 .68rem/19px 'Cairo',sans-serif;text-align:center;
      padding:0 4px;font-style:normal;box-shadow:0 2px 8px rgba(0,0,0,.25);}
    .sk-lang{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;cursor:pointer;
      font:800 .82rem 'Cairo',sans-serif;color:#28464b;transition:color .2s,background .2s;padding:0;}
    .sk-lang:hover{color:#fff;background:#2e7e88;}
    /* English strap: flip to LTR and mirror the accordion indent */
    .sk-nav--en{direction:ltr;}
    .sk-nav--en .sk-menu__row{text-align:left;}
    .sk-nav--en .sk-menu__kids a{margin-right:0;margin-left:14px;border-right:0;
      border-left:2px solid rgba(46,126,136,.22);border-radius:10px 0 0 10px;}
    .sk-addbtn{font:700 .78rem 'Cairo',sans-serif;color:#fff;background:#2e7e88;border:0;cursor:pointer;
      padding:8px 14px;border-radius:999px;transition:background .2s,transform .15s;}
    .sk-addbtn:hover{background:#1f5b63;transform:translateY(-1px);}
    .sk-addbtn.is-done{background:#1d7a3f;}
    /* keep page content clear of the sticky glass bar on sub-pages */
    .sk-nav--solid+*{margin-top:6px;}
    @media (max-width:920px){
      .sk-nav{flex-wrap:wrap;row-gap:8px;position:sticky;}
      .sk-nav--overlay{position:fixed;}
      .sk-nav__links{position:static;transform:none;order:5;flex-basis:100%;justify-content:center;flex-wrap:wrap;margin:0 auto;}
      .sk-menu{position:fixed;inset:auto 7vw auto 7vw;top:112px;right:auto;transform:translateY(-8px);width:auto;}
      .sk-shop.is-open .sk-menu{transform:none;}
      .sk-nav__logo img{height:30px;}
    }
    @media (max-width:560px){ .sk-hotline{padding:8px 12px;font-size:.78rem;} }
    `;
    const style = document.createElement('style');
    style.id = 'sk-nav-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
