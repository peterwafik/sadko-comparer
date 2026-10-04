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
      orders: 'الطلبات', showrooms: 'المعارض', call: 'اتصل 19140', cartAria: 'سلة التسوق',
      finder: 'ساعدنى أختار', plan: 'خطط التجهيز', guides: 'أدلة الشراء', care: 'خدمة العملاء',
      savedAria: 'المنتجات المحفوظة', acctAria: 'حسابى', details: 'التفاصيل والمقاس',
      more: 'المزيد', appliances: 'أجهزتى', account: 'حسابى', saved: 'المحفوظات', cart: 'السلة',
      grpBefore: 'قبل الشراء', grpAfter: 'بعد الشراء', menu: 'القائمة', close: 'إغلاق',
      pagesAria: 'صفحات الموقع', add: 'أضف للسلة', added: '✓ أُضيف', soldOut: 'غير متوفر حالياً', langBtn: 'EN', langTitle: 'Switch to English' },
    en: { home: 'Home', shop: 'Shop', all: 'All products', allPrefix: 'All ', compare: 'Compare Prices',
      orders: 'Orders', showrooms: 'Showrooms', call: 'Call 19140', cartAria: 'Shopping cart',
      finder: 'Help me choose', plan: 'Shopping plans', guides: 'Buying guides', care: 'Customer care',
      savedAria: 'Saved products', acctAria: 'My account', details: 'Details & size',
      more: 'More', appliances: 'My appliances', account: 'My account', saved: 'Saved', cart: 'Cart',
      grpBefore: 'Plan your purchase', grpAfter: 'After buying', menu: 'Menu', close: 'Close',
      pagesAria: 'Site pages', add: 'Add to cart', added: '✓ Added', soldOut: 'Out of stock', langBtn: 'ع', langTitle: 'التبديل إلى العربية' },
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
  // The storefront re-renders its grid on every facet change, so it needs to
  // re-run these over the new cards. Additive only; existing pages are unaffected.
  window.skNav = { enhanceCategoryCards };

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
      here === 'cart.html' ? 'cart' :
      here === 'finder.html' ? 'finder' :
      here === 'plan.html' ? 'plan' :
      here === 'guides.html' ? 'guides' :
      here === 'care.html' ? 'care' :
      here === 'saved.html' ? 'saved' :
      here === 'account.html' || here === 'checkout.html' ? 'account' :
      here === 'appliances.html' ? 'care' :
      ROOT ? 'shop' : '';

    // The links that used to crowd the strap are split: a short primary row on
    // desktop (home · shop · finder · compare · More▾), with everything else in
    // a two-column "More" panel. The same groups drive the mobile drawer.
    const A = (k, label, href, cls) =>
      `<a class="sk-link${cls ? ' ' + cls : ''}${active === k ? ' is-active' : ''}" href="${P(href)}">${esc(label)}</a>`;
    const MORE = [
      { t: N.grpBefore, items: [['plan', N.plan, 'plan.html'], ['guides', N.guides, 'guides.html']] },
      { t: N.grpAfter,  items: [['orders', N.orders, 'orders.html'], ['appliances', N.appliances, 'appliances.html'],
                                ['showrooms', N.showrooms, 'showrooms.html'], ['care', N.care, 'care.html']] },
    ];
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
      `<a class="sk-nav__logo" href="${P('shop.html')}" aria-label="${N.all}" title="${N.all}"><img src="${P('assets/img/sadko-logo.png')}" alt="صادكو جروب"></a>` +
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
        A('compare', N.compare, 'compare.html', 'sk-link--cta') +
        A('finder', N.finder, 'finder.html') +
        `<div class="sk-more">` +
          `<button type="button" class="sk-link sk-more__btn" aria-haspopup="true" aria-expanded="false">${N.more} <i class="sk-caret"></i></button>` +
          `<div class="sk-morepanel sk-glass" role="menu">` +
            MORE.map(g => `<div class="sk-morecol"><h4>${esc(g.t)}</h4>` +
              g.items.map(it => `<a class="sk-morelink${active === it[0] ? ' is-active' : ''}" href="${P(it[2])}">${esc(it[1])}</a>`).join('') +
              `</div>`).join('') +
          `</div>` +
        `</div>` +
      `</nav>` +
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
        `<a class="sk-drawer__logo" href="${P('shop.html')}" aria-label="${N.all}" title="${N.all}"><img src="${P('assets/img/sadko-logo.png')}" alt="صادكو جروب"></a>` +
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
        dLink('compare', N.compare, 'compare.html', 'sk-dlink--cta') +
        dLink('finder', N.finder, 'finder.html') +
        MORE.map(g => `<div class="sk-dgroup"><h4>${esc(g.t)}</h4>` +
          g.items.map(it => dLink(it[0], it[1], it[2])).join('') + `</div>`).join('') +
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

  /* ---- shared company footer on EVERY page ----
     App pages render their own via skApp.footer() into [data-footer]; this
     covers the rest: the legacy pages (shop/cart/orders/showrooms/compare) and
     the 3D home, which had no footer at all. Same content and look everywhere. */
  function ensureFooter() {
    if (document.querySelector('[data-footer]')) return;        // app pages own theirs
    const tt = (ar, en) => (LANG === 'en' ? en : ar);
    const groups = [
      { h: tt('صادكو', 'SADKO'), items: [
        [tt('عن صادكو', 'About SADKO'), 'about.html'], [tt('قيمنا', 'Our Values'), 'values.html'],
        [tt('تواصل معنا', 'Contact us'), 'contact.html'],
        [tt('المعارض', 'Showrooms'), 'showrooms.html'], [tt('حسابى', 'My account'), 'account.html'] ] },
      { h: tt('قبل الشراء', 'Before you buy'), items: [
        [tt('ساعدنى أختار', 'Help me choose'), 'finder.html'], [tt('أدلة الشراء', 'Buying guides'), 'guides.html'],
        [tt('قارن الأسعار', 'Compare prices'), 'compare.html'], [tt('خطط التجهيز', 'Shopping plans'), 'plan.html'] ] },
      { h: tt('بعد الشراء', 'After you buy'), items: [
        [tt('أجهزتى والضمان', 'My appliances & warranty'), 'appliances.html'], [tt('مركز خدمة العملاء', 'Customer care'), 'care.html'],
        [tt('طلباتى', 'My orders'), 'orders.html'], [tt('التوصيل والتركيب', 'Delivery & installation'), 'delivery.html'] ] },
      { h: tt('معلومات', 'Information'), items: [
        [tt('الضمان والاسترجاع', 'Warranty & returns'), 'warranty.html'], [tt('الخصوصية', 'Privacy'), 'privacy.html'],
        [tt('شروط الاستخدام', 'Terms of use'), 'terms.html'] ] },
    ];
    let el = document.querySelector('footer.foot');
    const home = !!document.getElementById('world');
    if (!el) { el = document.createElement('footer'); (home ? document.body : document.body).appendChild(el); }
    el.className = 'foot sk-foot' + (home ? ' sk-foot--home' : '');
    el.innerHTML =
      '<div class="foot__inner"><div class="foot__cols">' +
      groups.map(c => '<div><h4>' + esc(c.h) + '</h4><ul>' +
        c.items.map(i => '<li><a href="' + P(i[1]) + '">' + esc(i[0]) + '</a></li>').join('') + '</ul></div>').join('') +
      '<div><h4>' + tt('اتصل بنا', 'Talk to us') + '</h4><ul>' +
        '<li><a href="tel:19140" dir="ltr">19140</a></li>' +
        '<li><a href="mailto:csupport@sadko-group.com" dir="ltr">csupport@sadko-group.com</a></li></ul>' +
        '<p class="foot__tag">' + tt('مجموعة صادكو، من 1986، والموزّع الوحيد لكريازى.', 'SADKO Group, since 1986, sole distributor of Kiriazi.') + '</p></div>' +
      '</div><p class="foot__legal">' +
        tt('الأسعار والمواصفات مأخوذة من صفحات المنتجات وقت آخر تحديث وقد تتغير، يُرجى التأكد قبل الشراء. وتغطى مقارنة الأسعار متاجر مدعومة محددة. أما الضمان والتركيب والاسترجاع فيقدمها البائع المذكور فى العرض.',
           'Prices and specifications are taken from product pages at the last update and may change, so please confirm before buying. Price comparison covers a specific list of supported stores. Warranty, installation and returns are provided by the seller named on each offer.') +
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
      CATALOG_INDEX = fetch(P('data/products.json')).then(r => r.json()).then(d => {
        const byPath = {}, byId = {};
        (d.products || []).forEach(p => {
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
        /* The "details" button existed because the card linked OUT to Ecwid's
           storefront, so the site's own product page needed its own way in.
           The card image and the buy link both go there now, so a third
           control to the same place is noise — it is appended only when the
           card still points somewhere else. */
        const internal = !!(link && /product\.html/.test(link.getAttribute('href') || ''));
        if (!internal) {
          const det = document.createElement('a');
          det.className = 'sk-detbtn';
          det.href = P('product.html') + '?id=' + encodeURIComponent(prod.id);
          det.textContent = N.details;
          row.appendChild(det);
        }
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
            skCart.add(prod);
            b.textContent = N.added;
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
    /* ---- desktop "More" split dropdown (two columns side by side) ---- */
    .sk-more{position:relative;}
    .sk-morepanel{position:absolute;top:calc(100% + 12px);right:50%;transform:translate(50%,-8px);
      display:flex;gap:8px;padding:14px;border-radius:20px;
      opacity:0;visibility:hidden;transition:opacity .22s,transform .22s,visibility .22s;z-index:80;}
    .sk-more.is-open .sk-morepanel{opacity:1;visibility:visible;transform:translate(50%,0);}
    .sk-morecol{min-width:158px;display:flex;flex-direction:column;gap:2px;}
    .sk-morecol+.sk-morecol{border-inline-start:1px solid rgba(46,126,136,.16);padding-inline-start:8px;}
    .sk-morecol h4{margin:2px 10px 6px;font:800 .68rem 'Cairo',sans-serif;letter-spacing:.05em;
      text-transform:uppercase;color:#8a9aa0;}
    .sk-morelink{display:block;font:700 .85rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;
      padding:9px 12px;border-radius:12px;white-space:nowrap;transition:background .16s,color .16s;}
    .sk-morelink:hover{background:rgba(46,126,136,.12);color:#14343a;}
    .sk-morelink.is-active{background:#2e7e88;color:#fff;}
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
    .sk-diconbtn.is-active{background:#2e7e88;color:#fff;border-color:#2e7e88;}
    .sk-diconbtn svg{width:22px;height:22px;}
    .sk-diconbtn .sk-saved__badge,.sk-diconbtn .sk-cart__badge{top:6px;left:10px;}
    .sk-drawer__nav{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:6px 12px;
      display:flex;flex-direction:column;gap:2px;-webkit-overflow-scrolling:touch;}
    .sk-dlink{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;
      font:700 .96rem 'Cairo',sans-serif;color:#28464b;text-decoration:none;text-align:start;
      padding:13px 14px;border-radius:13px;background:none;border:0;cursor:pointer;}
    .sk-dlink:hover{background:rgba(46,126,136,.1);}
    .sk-dlink.is-active{background:#2e7e88;color:#fff;}
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
    .sk-foot{background:#14343a;color:#cfe3e6;direction:rtl;font-family:'Cairo','Segoe UI',system-ui,sans-serif;}
    .sk-nav--en~.sk-foot,html[dir=ltr] .sk-foot{direction:ltr;}
    .sk-foot .foot__inner{max-width:1240px;margin:0 auto;padding:40px clamp(16px,4vw,48px);}
    .sk-foot .foot__cols{display:grid;gap:26px;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));text-align:start;}
    .sk-foot h4{margin:0 0 10px;font-size:.95rem;color:#fff;}
    .sk-foot ul{list-style:none;margin:0;padding:0;display:grid;gap:8px;}
    .sk-foot a{color:#7ebec5;text-decoration:none;font-weight:700;font-size:.86rem;}
    .sk-foot a:hover{color:#a9d6db;text-decoration:underline;}
    .sk-foot .foot__tag{margin:14px 0 0;font-size:.82rem;opacity:.8;line-height:1.8;}
    .sk-foot .foot__legal{max-width:1240px;margin:22px auto 0;padding:18px clamp(16px,4vw,48px) 6px;
      border-top:1px solid rgba(255,255,255,.14);font-size:.78rem;opacity:.72;line-height:1.9;}
    /* on the 3D home the footer sits at the very bottom of the scroll, above the fixed scene */
    .sk-foot--home{position:relative;z-index:32;}
    @media (max-width:560px){ .sk-foot .foot__cols{grid-template-columns:repeat(2,1fr);gap:20px;} }
    .sk-cart{position:relative;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;
      color:#28464b;transition:color .2s,background .2s;}
    .sk-cart:hover,.sk-cart.is-active{color:#fff;background:#2e7e88;}
    .sk-cart__badge{position:absolute;top:-5px;left:-5px;min-width:19px;height:19px;border-radius:999px;
      background:#fe9800;color:#241a05;font:800 .68rem/19px 'Cairo',sans-serif;text-align:center;
      padding:0 4px;font-style:normal;box-shadow:0 2px 8px rgba(0,0,0,.25);}
    .sk-saved__badge{position:absolute;top:-5px;left:-5px;min-width:19px;height:19px;border-radius:999px;
      background:#2e7e88;color:#fff;font:800 .68rem/19px 'Cairo',sans-serif;text-align:center;
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
    .sk-detbtn{font:700 .78rem 'Cairo',sans-serif;color:#2e7e88;background:#eaf3f4;text-decoration:none;
      border:1px solid rgba(46,126,136,.28);padding:7px 13px;border-radius:999px;transition:.18s;}
    .sk-detbtn:hover{background:#2e7e88;color:#fff;}
    /* .sk-fcta (the guided-finder call-out) now lives with the rest of the shop's
       visual layer, in assets/css/storefront.css — the file that owns every other
       block in that column and the spacing tokens they all step through. */
    /* keep page content clear of the sticky glass bar on sub-pages */
    .sk-nav--solid+*{margin-top:6px;}
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
})();
