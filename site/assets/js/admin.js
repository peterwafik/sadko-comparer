/* ============================================================================
   SADKO control room — the owner's console (single-page app).
   Talks only to /api/admin/*, which is gated server-side: an account becomes an
   admin solely by having its email listed in the ADMIN_EMAILS env var. Nothing
   here grants power; it only surfaces what the server already allows.
   Bilingual (Arabic-first), RTL/LTR aware, no framework, no build step.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- language ---------- */
  const LS_LANG = 'sadko_admin_lang';
  let LANG = localStorage.getItem(LS_LANG) === 'en' ? 'en' : 'ar';
  const EN = () => LANG === 'en';
  const D = {
    ar: {
      gateK: 'غرفة التحكم', gateSub: 'سجّل دخولك بحساب المالك', gEmail: 'البريد الإلكترونى', gPass: 'كلمة السر',
      gIn: 'دخول', gNote: 'الدخول هنا مقصور على حساب المالك المُعرّف على الخادم.',
      notAdmin: 'هذا الحساب مسجَّل الدخول لكنه ليس من المسؤولين. راجع مسؤول النظام لإضافة بريدك الإلكترونى.',
      backSite: '← رجوع للموقع', signOut: 'إنهاء الجلسة', switchAcc: 'تسجيل بحساب تانى',
      brandSub: 'غرفة التحكم',
      nav_dashboard: 'اللوحة', nav_products: 'المنتجات', nav_orders: 'الطلبات',
      nav_customers: 'العملاء', nav_content: 'المحتوى', nav_settings: 'الإعدادات', nav_audit: 'السجل',
      sub_dashboard: 'نظرة سريعة على المتجر', sub_products: 'تعديل كل منتج: الصور والتفاصيل والأسعار',
      sub_orders: 'متابعة الطلبات وتحديث حالتها', sub_customers: 'كل من سجّل حساب',
      sub_content: 'أدلة الشراء وأسئلة مساعد الاختيار واللافتات',
      ecwidTitle: 'إكويد', ecwidSyncNow: 'زامن الآن', ecwidOpen: 'افتح لوحة إكويد',
      ecwidConnected: 'متصل بإكويد', ecwidWaiting: 'في انتظار أول مزامنة', ecwidOff: 'غير متصل',
      ecwidProducts: 'منتجات مُزامنة', ecwidBuyable: 'متاح للشراء', ecwidOos: 'غير متوفر',
      ecwidCats: 'أقسام', ecwidPay: 'طرق دفع', ecwidShip: 'طرق شحن', ecwidBanners: 'لافتات',
      ecwidLastSync: 'آخر مزامنة', ecwidLastErr: 'آخر خطأ', ecwidNone: 'لا يوجد',
      ecwidRails: 'صفوف المنتجات', ecwidUnresolved: 'لم يتم العثور على القسم',
      ecwidCustomers: 'العملاء فى إيكويد', ecwidLinkNow: 'سجّلهم الآن',
      th_ecwid: 'فى إيكويد', ecwidInStore: 'مُسجَّل', ecwidWaitingPush: 'فى الانتظار',
      ecwidParked: 'متوقّف', ecwidNotPushed: 'لم يُرسل', ecwidRetry: 'أعد المحاولة',
      ecwidRetried: 'تمت إعادة الإرسال', ecwidNoOrderAccess: 'هذا المفتاح لا يقرأ الطلبات من إيكويد (‏403). الطلبات محفوظة هنا وستُرسل فور تفعيل مفتاح secret_.',
      ecwidLookup: 'ابحث فى إيكويد', ecwidNotLinked: 'غير مُسجَّل فى إيكويد',
      ecwidCustOrders: 'طلبات إيكويد', ecwidOrdersReadable: 'قراءة الطلبات',
      ecwidOwned: 'الاسم والسعر والصورة والوصف والقسم تُدار في إكويد. عدّلها هناك وتظهر هنا خلال دقائق.',
      ecwidSynced: 'تمت المزامنة ✓', ecwidOpenProduct: 'افتح في إكويد', sub_settings: 'إعدادات الموقع', sub_audit: 'كل تعديل اتعمل من هنا',
      v_users: 'عملاء', v_orders: 'طلبات', v_ordersToday: 'طلبات النهاردة', v_liveCat: 'منتجات معروضة',
      v_edited: 'منتجات معدّلة', v_custom: 'منتجات مضافة', v_hidden: 'منتجات مخفية', v_base: 'الكتالوج الأصلى',
      recent: 'آخر النشاط', noActivity: 'لا نشاط بعد.',
      search: 'دوّر باسم المنتج أو الكود…', allCats: 'كل الفئات', addProduct: '+ منتج جديد',
      view_all: 'الكل', view_edited: 'المعدّلة', view_custom: 'المضافة', view_hidden: 'المخفية',
      th_product: 'المنتج', th_cat: 'الفئة', th_price: 'السعر', th_state: 'الحالة', th_act: '',
      edit: 'تعديل', hide: 'إخفاء', show: 'إظهار', del: 'حذف', revert: 'رجّع الأصلى',
      noProducts: 'لا منتجات بهذا الفلتر.', prev: 'السابق', next: 'التالى', pageOf: (a, b) => `صفحة ${a} من ${b}`,
      editP: 'تعديل منتج', addP: 'إضافة منتج', f_title: 'اسم المنتج', f_price: 'السعر (ج.م)', f_cat: 'الفئة',
      f_img: 'الصورة', f_desc: 'الوصف', f_url: 'رابط المنتج (اختيارى)', f_brand: 'الماركة (اختيارى)', f_badge: 'شارة (مثلاً: عرض)',
      f_imgUrl: 'رابط صورة أو ارفع من جهازك', upload: '⬆ رفع صورة', uploading: 'جارى الرفع…',
      save: 'حفظ', cancel: 'إلغاء', delConfirm: 'تأكيد حذف المنتج ده؟', revertBase: 'رجوع للقيمة الأصلية',
      saved: 'اتحفظ ✓', created: 'اتضاف ✓', deleted: 'اتحذف ✓', hidden_ok: 'اتخفى', shown_ok: 'رجع للعرض',
      th_ref: 'رقم الطلب', th_cust: 'العميل', th_items: 'الأصناف', th_total: 'الإجمالى', th_status: 'الحالة', th_when: 'التاريخ',
      noOrders: 'لا طلبات بعد.', statusUpdated: 'الحالة اتحدّثت ✓',
      st_received: 'اتستلم', st_confirmed: 'اتأكّد', st_preparing: 'بيتجهّز', st_shipping: 'فى الطريق', st_delivered: 'اتسلّم', st_cancelled: 'ملغى',
      th_name: 'الاسم', th_email: 'البريد الإلكترونى', th_phone: 'الهاتف المحمول', th_homes: 'أماكن', th_orders: 'طلبات', th_joined: 'انضم', th_via: 'دخول عبر',
      noCustomers: 'لا عملاء بعد.', viaPass: 'كلمة سر',
      c_guides: 'أدلة الشراء', c_finder: 'أسئلة مساعد الاختيار', c_promos: 'لافتات الإعلانات', validate: 'تحقّق', saveContent: 'حفظ المحتوى',
      validJson: 'JSON سليم ✓', invalidJson: 'JSON غير صحيح: ', contentSaved: 'المحتوى اتحفظ ✓',
      set_hotline: 'الخط الساخن', set_hotlineK: 'رقم الخط الساخن المعروض فى الموقع',
      set_banner: 'شريط إعلان أعلى الصفحات', set_bannerK: 'نص يظهر أعلى الموقع (سيبه فاضى لإخفائه)',
      set_freeship: 'إظهار وسم "توصيل مجانى"', set_freeshipK: 'يظهر على صفحات المنتجات',
      set_maint: 'وضع الصيانة (تنبيه فقط)', set_maintK: 'يعرض تنبيه أن الموقع تحت الصيانة',
      saveSettings: 'حفظ الإعدادات', settingsSaved: 'الإعدادات اتحفظت ✓',
      noAudit: 'السجل فاضى.', a_actor: 'المستخدم', a_action: 'الإجراء', a_target: 'الهدف', a_when: 'الوقت',
      loadFail: 'حصل خطأ فى التحميل', pcs: n => `${n} منتج`,
    },
    en: {
      gateK: 'Control room', gateSub: 'Sign in with the owner account', gEmail: 'Email', gPass: 'Password',
      gIn: 'Sign in', gNote: 'Access here is limited to the owner account configured on the server.',
      notAdmin: 'You are signed in, but this account is not an administrator. Ask the system owner to add your email.',
      backSite: '← Back to site', signOut: 'Sign out', switchAcc: 'Use another account',
      brandSub: 'Control room',
      nav_dashboard: 'Dashboard', nav_products: 'Products', nav_orders: 'Orders',
      nav_customers: 'Customers', nav_content: 'Content', nav_settings: 'Settings', nav_audit: 'Audit log',
      sub_dashboard: 'A quick read on the store', sub_products: 'Edit every product: images, details, prices',
      sub_orders: 'Track orders and update their status', sub_customers: 'Everyone who registered',
      sub_content: 'Buying guides, finder questions and banners',
      ecwidTitle: 'Ecwid', ecwidSyncNow: 'Sync now', ecwidOpen: 'Open the Ecwid admin',
      ecwidConnected: 'Connected to Ecwid', ecwidWaiting: 'Awaiting first sync', ecwidOff: 'Not connected',
      ecwidProducts: 'Products synced', ecwidBuyable: 'Buyable', ecwidOos: 'Out of stock',
      ecwidCats: 'Categories', ecwidPay: 'Payment methods', ecwidShip: 'Shipping methods', ecwidBanners: 'Banners',
      ecwidLastSync: 'Last sync', ecwidLastErr: 'Last error', ecwidNone: 'none',
      ecwidRails: 'Product rails', ecwidUnresolved: 'category not found',
      ecwidCustomers: 'Customers in Ecwid', ecwidLinkNow: 'Link them now',
      th_ecwid: 'In Ecwid', ecwidInStore: 'Filed', ecwidWaitingPush: 'Waiting',
      ecwidParked: 'Stopped', ecwidNotPushed: 'Not sent', ecwidRetry: 'Retry',
      ecwidRetried: 'Sent again', ecwidNoOrderAccess: 'This token cannot read orders from Ecwid (403). Orders are safe here and will be sent the moment a secret_ token is in place.',
      ecwidLookup: 'Look up in Ecwid', ecwidNotLinked: 'Not in Ecwid',
      ecwidCustOrders: 'Ecwid orders', ecwidOrdersReadable: 'Order access',
      ecwidOwned: 'Name, price, image, description and category are managed in Ecwid. Edit them there and they appear here within minutes.',
      ecwidSynced: 'Synced ✓', ecwidOpenProduct: 'Open in Ecwid', sub_settings: 'Site settings', sub_audit: 'Every change made here',
      v_users: 'Customers', v_orders: 'Orders', v_ordersToday: 'Orders today', v_liveCat: 'Products live',
      v_edited: 'Edited', v_custom: 'Added', v_hidden: 'Hidden', v_base: 'Base catalogue',
      recent: 'Recent activity', noActivity: 'No activity yet.',
      search: 'Search by product name or id…', allCats: 'All categories', addProduct: '+ New product',
      view_all: 'All', view_edited: 'Edited', view_custom: 'Added', view_hidden: 'Hidden',
      th_product: 'Product', th_cat: 'Category', th_price: 'Price', th_state: 'State', th_act: '',
      edit: 'Edit', hide: 'Hide', show: 'Show', del: 'Delete', revert: 'Revert',
      noProducts: 'No products match this filter.', prev: 'Prev', next: 'Next', pageOf: (a, b) => `Page ${a} of ${b}`,
      editP: 'Edit product', addP: 'Add product', f_title: 'Product name', f_price: 'Price (EGP)', f_cat: 'Category',
      f_img: 'Image', f_desc: 'Description', f_url: 'Product link (optional)', f_brand: 'Brand (optional)', f_badge: 'Badge (e.g. Offer)',
      f_imgUrl: 'Image URL, or upload from your device', upload: '⬆ Upload', uploading: 'Uploading…',
      save: 'Save', cancel: 'Cancel', delConfirm: 'Delete this product?', revertBase: 'Back to original value',
      saved: 'Saved ✓', created: 'Added ✓', deleted: 'Deleted ✓', hidden_ok: 'Hidden', shown_ok: 'Back on the store',
      th_ref: 'Order', th_cust: 'Customer', th_items: 'Items', th_total: 'Total', th_status: 'Status', th_when: 'Date',
      noOrders: 'No orders yet.', statusUpdated: 'Status updated ✓',
      st_received: 'Received', st_confirmed: 'Confirmed', st_preparing: 'Preparing', st_shipping: 'Shipping', st_delivered: 'Delivered', st_cancelled: 'Cancelled',
      th_name: 'Name', th_email: 'Email', th_phone: 'Mobile', th_homes: 'Places', th_orders: 'Orders', th_joined: 'Joined', th_via: 'Sign-in',
      noCustomers: 'No customers yet.', viaPass: 'password',
      c_guides: 'Buying guides', c_finder: 'Finder questions', c_promos: 'Advertisement banners', validate: 'Validate', saveContent: 'Save content',
      validJson: 'Valid JSON ✓', invalidJson: 'Invalid JSON: ', contentSaved: 'Content saved ✓',
      set_hotline: 'Hotline', set_hotlineK: 'Hotline number shown across the site',
      set_banner: 'Announcement bar', set_bannerK: 'Text shown at the top of the site (leave blank to hide)',
      set_freeship: 'Show "free delivery" badge', set_freeshipK: 'Appears on product pages',
      set_maint: 'Maintenance notice', set_maintK: 'Shows a banner that the site is under maintenance',
      saveSettings: 'Save settings', settingsSaved: 'Settings saved ✓',
      noAudit: 'The log is empty.', a_actor: 'User', a_action: 'Action', a_target: 'Target', a_when: 'When',
      loadFail: 'Something went wrong loading this', pcs: n => `${n} products`,
    },
  };
  const t = k => { const v = D[LANG][k]; return v == null ? (D.ar[k] ?? k) : v; };

  /* ---------- category names (mirrors the storefront tree in shop.js) ---------- */
  const CAT_TREE = [
    ['38003882', 'ثلاجات', [['38022268', 'نو فروست'], ['38022269', 'ديفروست']]],
    ['38005648', 'فريزرات', [['38022353', 'فريزر أفقى'], ['38005649', 'فريزر رأسى']]],
    ['38003799', 'أفران وبوتاجازات', [['50846528', '4 شعلة'], ['50844229', '5 شعلة'], ['38022202', 'أفران كهربائية']]],
    ['38005652', 'غسالات', [['38003963', 'غسالات ملابس'], ['38022354', 'غسالات أطباق']]],
    ['40507239', 'سخانات مياه', [['48149056', 'سخانات كهرباء'], ['48143206', 'سخانات غاز']]],
    ['112439376', 'أجهزة صغيرة', [['81170222', 'مكانس'], ['81167227', 'مكاوى'], ['68782006', 'خلاطات ومحضرات'], ['57646037', 'ميكروييف'], ['185355010', 'كاتيل وقهوة'], ['185364502', 'قلايات']]],
    ['38032005', 'تكييفات هواء'], ['38022381', 'تليفزيونات'], ['50318054', 'مبردات هواء ومراوح'],
    ['102858075', 'مبردات مياه'], ['167433056', 'حرف يدوية ومنتجات عضوية'],
  ];
  const CAT_NAME = {};
  const CAT_FLAT = [];
  for (const [id, name, kids] of CAT_TREE) {
    CAT_NAME[id] = name; CAT_FLAT.push({ id, name });
    for (const [kid, kname] of (kids || [])) { CAT_NAME[kid] = name + ' › ' + kname; CAT_FLAT.push({ id: kid, name: '› ' + kname }); }
  }
  const catName = id => CAT_NAME[id] || (id ? '#' + id : '-');

  /* ---------- tiny helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (Number(n) || 0).toLocaleString('en-US') + (EN() ? ' EGP' : ' ج.م');
  const when = iso => { try { return new Date(iso).toLocaleString(EN() ? 'en-GB' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso || ''; } };
  const root = () => $('root');

  let TOAST_N = 0;
  function toast(msg, kind) {
    const box = $('toast'); const el = document.createElement('div');
    el.className = 'toast__i' + (kind ? ' ' + kind : ''); el.textContent = msg;
    box.appendChild(el); const id = ++TOAST_N;
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2600);
    return id;
  }

  /* ---------- API ---------- */
  async function api(pathname, { method = 'GET', body } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const url = pathname + (pathname.includes('?') ? '&' : '?') + 'lang=' + LANG;
    const res = await fetch(url, opts);
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status)); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  /* ---------- app state ---------- */
  const S = {
    me: null, overview: null, section: 'dashboard',
    prod: { q: '', cat: '', view: 'all', page: 1, per: 40, data: null, cats: [] },
    editableFields: [], orderStatuses: [],
  };
  const SECTIONS = ['dashboard', 'products', 'orders', 'customers', 'content', 'settings', 'audit'];

  /* ---------- boot & gate ---------- */
  async function boot() {
    try {
      const me = await api('/api/admin/me');
      S.me = me; S.editableFields = me.editableFields || []; S.orderStatuses = me.orderStatuses || [];
      renderConsole();
    } catch (e) {
      if (e.status === 403) renderGate('notAdmin');
      else renderGate(null);
    }
  }

  function renderGate(reason) {
    document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
    root().innerHTML = `
      <div class="gate">
        <form class="gate__card" id="gateForm" autocomplete="on">
          <img class="gate__logo" src="assets/img/sadko-logo.png" alt="SADKO">
          <div class="gate__k">${t('gateK')}</div>
          <div class="gate__sub">${t('gateSub')}</div>
          <div class="gate__err ${reason === 'notAdmin' ? 'on' : ''}" id="gateErr">${reason === 'notAdmin' ? t('notAdmin') : ''}</div>
          <label for="gEmail">${t('gEmail')}</label>
          <input id="gEmail" type="email" name="email" required autocomplete="username" dir="ltr">
          <label for="gPass">${t('gPass')}</label>
          <input id="gPass" type="password" name="password" required autocomplete="current-password">
          <button class="gate__btn" type="submit" id="gBtn">${t('gIn')}</button>
          <div class="gate__note">${t('gNote')}<br><a href="index.html" style="color:var(--teal);font-weight:800">${t('backSite')}</a></div>
        </form>
      </div>`;
    $('gateForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('gBtn'), err = $('gateErr');
      btn.disabled = true; btn.textContent = '…'; err.classList.remove('on');
      try {
        await api('/api/auth/login', { method: 'POST', body: { email: $('gEmail').value, password: $('gPass').value } });
        await boot();
      } catch (ex) {
        err.textContent = ex.message; err.classList.add('on');
        btn.disabled = false; btn.textContent = t('gIn');
      }
    });
    if (reason === 'notAdmin') {
      const note = document.querySelector('.gate__note');
      note.innerHTML += `<br><a href="#" id="gout" style="color:var(--muted);font-weight:800">${t('switchAcc')}</a>`;
      $('gout').addEventListener('click', async e => { e.preventDefault(); try { await api('/api/auth/logout', { method: 'POST' }); } catch (x) {} renderGate(null); });
    }
  }

  /* ---------- console shell ---------- */
  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 11h8V3h-8z"/>',
    products: '<path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10"/>',
    orders: '<path d="M6 2h9l3 3v17H6zM9 7h6M9 11h6M9 15h4"/>',
    customers: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/>',
    content: '<path d="M4 3h11l5 5v13H4zM14 3v6h6M8 13h8M8 17h5"/>',
    settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L3 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z"/>',
    audit: '<path d="M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/>',
  };
  const icon = k => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  function navCount(sec) {
    const o = S.overview; if (!o) return '';
    if (sec === 'products') return o.catalog ? o.catalog.live : '';
    if (sec === 'orders') return o.accounts ? o.accounts.orders : '';
    if (sec === 'customers') return o.accounts ? o.accounts.users : '';
    return '';
  }

  function renderConsole() {
    document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = LANG;
    if (!SECTIONS.includes(location.hash.slice(1))) location.hash = '#dashboard';
    S.section = location.hash.slice(1) || 'dashboard';
    root().innerHTML = `
      <div class="app">
        <aside class="rail" id="rail">
          <div class="rail__brand"><img src="assets/img/sadko-logo.png" alt="SADKO"><div><b>SADKO</b><span>${t('brandSub')}</span></div></div>
          <nav id="nav">${SECTIONS.map(s => {
            const c = navCount(s);
            return `<a class="nav__item ${s === S.section ? 'on' : ''}" href="#${s}" data-sec="${s}">${icon(s)}<span>${t('nav_' + s)}</span>${c !== '' ? `<span class="pill">${c}</span>` : ''}</a>`;
          }).join('')}</nav>
          <div class="rail__spacer"></div>
          <div class="rail__foot">
            <div class="rail__who">${esc(S.me.email)}</div>
            <a class="rail__view" href="index.html" target="_blank">${t('backSite').replace('← ', '↗ ')}</a><br>
            <a class="rail__out" href="#" id="signout">${t('signOut')}</a>
          </div>
        </aside>
        <div class="main">
          <div class="topbar">
            <button class="burger" id="burger" aria-label="menu">☰</button>
            <div><h1 id="secTitle">${t('nav_' + S.section)}</h1><div class="sub" id="secSub">${t('sub_' + S.section)}</div></div>
            <div class="topbar__sp"></div>
            <button class="langbtn" id="langBtn">${EN() ? 'العربية' : 'EN'}</button>
          </div>
          <div class="content" id="view"><div class="loading"><span class="spin"></span></div></div>
        </div>
      </div>
      <div class="scrim" id="scrim"></div>
      <div class="drawer" id="drawer"></div>`;

    $('signout').addEventListener('click', async e => { e.preventDefault(); try { await api('/api/auth/logout', { method: 'POST' }); } catch (x) {} location.hash = ''; renderGate(null); });
    $('langBtn').addEventListener('click', () => { LANG = EN() ? 'ar' : 'en'; localStorage.setItem(LS_LANG, LANG); renderConsole(); });
    $('burger').addEventListener('click', () => $('rail').classList.toggle('on'));
    $('nav').addEventListener('click', () => $('rail').classList.remove('on'));
    $('scrim').addEventListener('click', closeDrawer);
    route();
    if (!S.overview) refreshOverview();
  }

  async function refreshOverview() {
    try { S.overview = await api('/api/admin/overview'); updatePills(); } catch (e) {}
  }
  function updatePills() {
    document.querySelectorAll('.nav__item').forEach(a => {
      const c = navCount(a.dataset.sec); let pill = a.querySelector('.pill');
      if (c === '') { if (pill) pill.remove(); return; }
      if (!pill) { pill = document.createElement('span'); pill.className = 'pill'; a.appendChild(pill); }
      pill.textContent = c;
    });
  }

  function setSection(sec) {
    S.section = sec;
    document.querySelectorAll('.nav__item').forEach(a => a.classList.toggle('on', a.dataset.sec === sec));
    if ($('secTitle')) { $('secTitle').textContent = t('nav_' + sec); $('secSub').textContent = t('sub_' + sec); }
  }

  function route() {
    const sec = location.hash.slice(1) || 'dashboard';
    if (!SECTIONS.includes(sec)) { location.hash = '#dashboard'; return; }
    setSection(sec);
    const view = $('view'); if (!view) return;
    view.innerHTML = `<div class="loading"><span class="spin"></span></div>`;
    ({ dashboard: viewDashboard, products: viewProducts, orders: viewOrders, customers: viewCustomers,
       content: viewContent, settings: viewSettings, audit: viewAudit }[sec] || viewDashboard)();
  }

  function fail(view, e) {
    view.innerHTML = `<div class="empty">${t('loadFail')}<br><span class="muted" style="font-size:.8rem">${esc(e.message || '')}</span></div>`;
  }

  /* ================= ECWID =================
     A window onto Ecwid, not a second editor. Shows what is synced, whether
     the rails resolved, and the last error — a rail that quietly resolved to
     nothing is otherwise invisible until someone spots an empty row on the
     shop page. Never displays any part of the token. */
  let ECWID = null;

  function ecwidAdminUrl(storeId, kind, id) {
    const base = 'https://my.ecwid.com/store/' + encodeURIComponent(storeId || '');
    if (kind === 'product') return base + '#product:id=' + encodeURIComponent(id);
    if (kind === 'category') return base + '#category:id=' + encodeURIComponent(id) + '&mode=edit';
    return base;
  }

  async function loadEcwid() {
    try { ECWID = await api('/api/admin/ecwid'); } catch (e) { ECWID = null; }
    return ECWID;
  }

  /* True while Ecwid is the live catalogue source. The product editor uses it
     to disable the fields Ecwid owns. */
  function ecwidOwnsCatalogue() {
    return !!(ECWID && ECWID.ecwid && ECWID.ecwid.source === 'ecwid');
  }

  function renderEcwidPanel(d) {
    if (!d || !d.ecwid) return '';
    const e = d.ecwid;
    const state = e.source === 'ecwid' ? t('ecwidConnected')
      : (e.enabled ? t('ecwidWaiting') : t('ecwidOff'));
    const num = n => (n == null ? '-' : String(n));
    const row = (l, v, cls) => '<tr><th>' + esc(l) + '</th><td class="' + (cls || '') + '">' + esc(v) + '</td></tr>';
    const rail = (name, id) => id
      ? esc((name || id) + ' (' + id + ')')
      : '<span class="err">' + esc(t('ecwidUnresolved')) + '</span>';
    return '<div class="panel">'
      + '<div class="panel__h"><h2>' + esc(t('ecwidTitle')) + ': ' + esc(state) + '</h2>'
      + '<div class="toolbar__sp"></div>'
      + '<a class="btn btn--ghost" href="' + ecwidAdminUrl(d.storeId) + '" target="_blank" rel="noopener">' + esc(t('ecwidOpen')) + '</a>'
      + '<button class="btn btn--gold" id="adm-ecwid-sync">' + esc(t('ecwidSyncNow')) + '</button>'
      + '</div><div class="tablewrap"><table class="tbl"><tbody>'
      + row(t('ecwidProducts'), num(e.products))
      + row(t('ecwidBuyable'), num(e.buyable))
      + row(t('ecwidOos'), num(e.outOfStock))
      + row(t('ecwidCats'), num(e.categories))
      + row(t('ecwidPay'), num(e.paymentMethods))
      + row(t('ecwidShip'), num(e.shippingMethods))
      + row(t('ecwidBanners'), num(d.banners))
      + (d.customers ? '<tr><th>' + esc(t('ecwidCustomers')) + '</th><td>'
          + esc(t('مُسجَّل', 'linked')) + ': ' + num(d.customers.linked)
          + (d.customers.pending ? ' · <span class="err">' + esc(t('فى الانتظار', 'waiting')) + ': ' + num(d.customers.pending) + '</span>' : '')
          + (d.customers.parked ? ' · <span class="err">' + esc(t('متوقّف', 'stopped')) + ': ' + num(d.customers.parked) + '</span>' : '')
          + ((d.customers.pending || d.customers.parked)
              ? ' <button class="btn btn--ghost btn--sm" id="adm-ecwid-link">' + esc(t('ecwidLinkNow')) + '</button>' : '')
          + '</td></tr>' : '')
      + row(t('ecwidLastSync'), (e.lastSync && e.lastSync.at) ? when(e.lastSync.at) : t('ecwidNone'))
      + row(t('ecwidLastErr'), e.lastError || t('ecwidNone'), e.lastError ? 'err' : '')
      + '<tr><th>' + esc(t('ecwidRails')) + '</th><td>'
      + esc('عروض صادكو') + ': ' + rail(d.rails && d.rails.offersName, d.rails && d.rails.offers) + '<br>'
      + esc('الأكثر مبيعاً') + ': ' + rail(d.rails && d.rails.bestSellersName, d.rails && d.rails.bestSellers)
      + '</td></tr>'
      + '</tbody></table></div></div>';
  }

  function bindEcwidPanel() {
    const lk = $('adm-ecwid-link');
    if (lk) lk.addEventListener('click', async () => {
      lk.disabled = true;
      try {
        const r = await api('/api/admin/ecwid/customers/link', { method: 'POST' });
        toast(r.blocked ? t('ecwidNoOrderAccess') : t('ecwidSynced'), r.blocked ? 'err' : 'ok');
        route();
      } catch (e) { toast(e.message, 'err'); lk.disabled = false; }
    });
    const b = $('adm-ecwid-sync');
    if (!b) return;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await api('/api/admin/ecwid/sync', { method: 'POST' }); toast(t('ecwidSynced'), 'ok'); route(); }
      catch (err) { toast(err.message, 'err'); }
      finally { b.disabled = false; }
    });
  }

  /* ================= DELIVERY CLASSES =================
     Every product's delivery size band, derived automatically on the server
     (engine/size-class.mjs). Read-only: a wrong band is fixed by correcting the
     product's title or category in Ecwid; the site re-derives within a minute.
     Loaded on its own so a slow catalogue never holds up the dashboard. */
  async function loadDeliveryPanel() {
    const box = $('adm-delivery'); if (!box) return;
    const L = (ar, en) => (EN() ? en : ar);
    const BANDS = [['small', 'صغيرة', 'Small'], ['medium', 'متوسطة', 'Medium'], ['large', 'كبيرة', 'Large'],
                   ['xl', 'كبيرة جدا', 'Extra-large'], ['craft', 'حرف يدوية', 'Handicrafts'], ['none', 'بدون فئة', 'Unclassified']];
    const name = c => { const b = BANDS.find(x => x[0] === (c || 'none')); return b ? L(b[1], b[2]) : c; };
    let d;
    try { d = await api('/api/admin/delivery-classes'); } catch (e) { box.innerHTML = ''; return; }
    const chips = BANDS.map(b => '<span class="pill' + (b[0] === 'none' && d.counts.none ? ' err' : '') + '">' +
      esc(L(b[1], b[2])) + ': <b>' + (d.counts[b[0]] || 0) + '</b></span>').join(' ');
    const why = w => esc(w ? L(w.ar, w.en) : '');
    const rows = list => list.map(p => '<tr><td>' + esc(p.title) + '</td><td>' + esc(p.category != null ? p.category : name(p.cls)) +
      '</td><td class="muted" style="font-size:.8rem">' + why(p.why) + '</td></tr>').join('');
    box.innerHTML = '<div class="panel"><div class="panel__h"><h2>' + esc(L('فئات التوصيل', 'Delivery classes')) + '</h2></div>' +
      '<p class="muted" style="font-size:.85rem">' + esc(L('تُحدَّد فئة الشحن لكل منتج تلقائياً من القسم والمقاس. المنتجات بدون فئة تُحسب رسوم توصيلها بواسطة خدمة العملاء؛ لتصحيحها عدّل عنوان المنتج أو قسمه فى إيكويد.',
        'Each product\'s delivery band is derived from its category and size. Unclassified products fall back to customer care for the fee; to fix one, correct its title or category in Ecwid.')) + '</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">' + chips + '</div>' +
      ((d.problems || []).length ? '<p class="err" style="font-size:.85rem">' + esc(L('طرق شحن لم تُقرأ: ', 'Shipping methods not read: ')) +
        esc(d.problems.map(p => p.title + ' (' + p.code + ')').join(' · ')) + '</p>' : '') +
      (d.unclassified.length ? '<h3 style="margin:14px 0 6px">' + esc(L('بدون فئة', 'Unclassified')) + ' (' + d.unclassified.length + ')</h3>' +
        '<div class="tablewrap"><table class="tbl"><tbody>' + rows(d.unclassified) + '</tbody></table></div>' : '') +
      '<input id="adm-dc-q" class="input" style="margin-top:12px;width:100%" placeholder="' + esc(L('ابحث عن منتج لمعرفة فئته…', 'Search a product to see its band…')) + '">' +
      '<div id="adm-dc-res" class="tablewrap"></div></div>';
    $('adm-dc-q').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const hits = q.length < 2 ? [] : d.products.filter(p => String(p.title).toLowerCase().includes(q)).slice(0, 20);
      $('adm-dc-res').innerHTML = hits.length ? '<table class="tbl"><tbody>' + rows(hits) + '</tbody></table>' : '';
    });
  }

  /* ================= DASHBOARD ================= */
  async function viewDashboard() {
    const view = $('view');
    try {
      const o = S.overview = await api('/api/admin/overview'); updatePills();
      const a = o.accounts || {}, c = o.catalog || {};
      const vital = (n, l, d, gold) => `<div class="vital ${gold ? 'g' : ''}"><div class="n">${n}</div><div class="l">${l}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
      const ecwidPanel = renderEcwidPanel(await loadEcwid());
      view.innerHTML = `
        ${ecwidPanel}
        <div id="adm-delivery"></div>
        <div class="vitals">
          ${vital(c.live ?? '-', t('v_liveCat'), t('v_base') + ': ' + (c.base ?? '-'))}
          ${vital(a.orders ?? '-', t('v_orders'), (a.ordersToday ? a.ordersToday.n : 0) + ' ' + t('v_ordersToday'))}
          ${vital(a.users ?? '-', t('v_users'))}
          ${vital(c.edited ?? 0, t('v_edited'), '', true)}
          ${vital(c.custom ?? 0, t('v_custom'), '', true)}
          ${vital(c.hidden ?? 0, t('v_hidden'), '', true)}
        </div>
        <div class="panel">
          <div class="panel__h"><h2>${t('recent')}</h2></div>
          ${(o.audit && o.audit.length) ? `<div class="tablewrap"><table class="tbl"><tbody>${
            o.audit.map(r => `<tr><td class="audit-act">${esc(r.action)}</td><td>${esc(r.target || '')}</td><td class="muted" style="font-size:.8rem">${esc(r.actor || '')}</td><td class="audit-when">${when(r.at)}</td></tr>`).join('')
          }</tbody></table></div>` : `<div class="empty">${t('noActivity')}</div>`}
        </div>`;
      bindEcwidPanel();
      loadDeliveryPanel();
    } catch (e) { fail(view, e); }
  }

  /* ================= PRODUCTS ================= */
  async function viewProducts() {
    const view = $('view');
    view.innerHTML = `
      <div class="toolbar">
        <input type="search" id="pq" placeholder="${t('search')}" value="${esc(S.prod.q)}">
        <select id="pcat"><option value="">${t('allCats')}</option>${CAT_FLAT.map(c => `<option value="${c.id}" ${S.prod.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <div class="segn" id="pview">${['all', 'edited', 'custom', 'hidden'].map(v => `<button data-v="${v}" class="${S.prod.view === v ? 'on' : ''}">${t('view_' + v)}</button>`).join('')}</div>
        <div class="toolbar__sp"></div>
        <button class="btn btn--gold" id="paddBtn">${t('addProduct')}</button>
      </div>
      <div id="ptable"><div class="loading"><span class="spin"></span></div></div>`;

    let qTimer;
    $('pq').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.prod.q = e.target.value.trim(); S.prod.page = 1; loadProducts(); }, 300); });
    $('pcat').addEventListener('change', e => { S.prod.cat = e.target.value; S.prod.page = 1; loadProducts(); });
    $('pview').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.prod.view = b.dataset.v; S.prod.page = 1; document.querySelectorAll('#pview button').forEach(x => x.classList.toggle('on', x === b)); loadProducts(); });
    $('paddBtn').addEventListener('click', () => openEditor(null));
    loadProducts();
  }

  async function loadProducts() {
    const box = $('ptable'); if (!box) return;
    const p = S.prod;
    try {
      const qs = `q=${encodeURIComponent(p.q)}&cat=${encodeURIComponent(p.cat)}&view=${p.view}&page=${p.page}&per=${p.per}`;
      const data = p.data = await api('/api/admin/products?' + qs);
      if (!data.products.length) { box.innerHTML = `<div class="empty">${t('noProducts')}</div>`; return; }
      box.innerHTML = `
        <div class="tablewrap"><table class="tbl">
          <thead><tr><th>${t('th_product')}</th><th>${t('th_cat')}</th><th>${t('th_price')}</th><th>${t('th_state')}</th><th></th></tr></thead>
          <tbody>${data.products.map(rowProduct).join('')}</tbody>
        </table></div>
        <div class="pager">
          <button id="pprev" ${p.page <= 1 ? 'disabled' : ''}>${t('prev')}</button>
          <span>${t('pageOf')(data.page, data.pages || 1)} · ${t('pcs')(data.total)}</span>
          <button id="pnext" ${p.page >= (data.pages || 1) ? 'disabled' : ''}>${t('next')}</button>
        </div>`;
      box.querySelector('#pprev')?.addEventListener('click', () => { if (p.page > 1) { p.page--; loadProducts(); } });
      box.querySelector('#pnext')?.addEventListener('click', () => { if (p.page < data.pages) { p.page++; loadProducts(); } });
      box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => productAction(b.dataset.act, b.dataset.id)));
    } catch (e) { fail(box, e); }
  }

  function rowProduct(p) {
    const tags = [
      p._custom ? `<span class="tag tag--custom">${t('view_custom')}</span>` : '',
      p._edited ? `<span class="tag tag--edited">${t('view_edited')}</span>` : '',
      p._hidden ? `<span class="tag tag--hidden">${t('view_hidden')}</span>` : '',
    ].join(' ');
    const img = p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="thumb"></span>`;
    return `<tr>
      <td><div class="pname">${img}<span style="min-width:0"><b title="${esc(p.title)}">${esc(p.title || '-')}</b><span class="id mono">${esc(p.id)}</span></span></div></td>
      <td class="muted" style="font-size:.82rem">${esc(catName(p.categoryId))}</td>
      <td class="price">${money(p.price)}</td>
      <td class="tags">${tags || '<span class="muted">-</span>'}</td>
      <td><div class="rowact">
        <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(p.id)}">${t('edit')}</button>
        <button class="btn btn--ghost btn--sm" data-act="${p._hidden ? 'show' : 'hide'}" data-id="${esc(p.id)}">${p._hidden ? t('show') : t('hide')}</button>
        ${p._custom ? `<button class="btn btn--danger btn--sm" data-act="del" data-id="${esc(p.id)}">${t('del')}</button>` : ''}
      </div></td>
    </tr>`;
  }

  async function productAction(act, id) {
    try {
      if (act === 'edit') return openEditor(id);
      if (act === 'hide') { await api(`/api/admin/products/${encodeURIComponent(id)}/hide`, { method: 'POST' }); toast(t('hidden_ok'), 'ok'); }
      if (act === 'show') { await api(`/api/admin/products/${encodeURIComponent(id)}/show`, { method: 'POST' }); toast(t('shown_ok'), 'ok'); }
      if (act === 'del') { if (!confirm(t('delConfirm'))) return; await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast(t('deleted'), 'ok'); }
      loadProducts(); refreshOverview();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- product editor drawer ---------- */
  let EDIT = null;   // { id, orig, base, isCustom }
  function closeDrawer() { $('drawer').classList.remove('on'); $('scrim').classList.remove('on'); EDIT = null; }

  async function openEditor(id) {
    const drawer = $('drawer'); $('scrim').classList.add('on'); drawer.classList.add('on');
    drawer.innerHTML = `<div class="loading"><span class="spin"></span></div>`;
    let product = { id: '', title: '', price: 0, image: '', description: '', categoryId: '', url: '', brand: '', badge: '' };
    let base = null, isCustom = false;
    if (id) {
      try {
        const d = await api('/api/admin/products/' + encodeURIComponent(id));
        product = Object.assign(product, d.product); base = d.base || null; isCustom = !!(d.product && d.product._custom);
      } catch (e) { toast(e.message, 'err'); closeDrawer(); return; }
    } else { isCustom = true; }
    /* The editor can be opened without visiting the dashboard first, so make
       sure we know whether Ecwid owns the catalogue before rendering fields. */
    if (ECWID === null) await loadEcwid();
    EDIT = { id, orig: Object.assign({}, product), base, isCustom };

    const overridden = f => base && EDIT.orig[f] != null && base[f] != null && String(EDIT.orig[f]) !== String(base[f]);
    /* Fields Ecwid owns are disabled rather than left editable to fail with a
       409 on save. The server still refuses them — this is the courtesy layer,
       not the guard. */
    const OWNED = (ECWID && ECWID.ownedFields) || ['title','price','image','description','categoryId','url','brand'];
    const locked = f => ecwidOwnsCatalogue() && OWNED.indexOf(f) !== -1;
    const field = (f, label, opts = {}) => {
      const dis = locked(f) ? ' disabled' : '';
      const rev = (overridden(f) && !locked(f)) ? `<span class="rev on" data-rev="${f}">↩ ${t('revert')}</span>` : '';
      const val = esc(product[f] == null ? '' : product[f]);
      const input = opts.textarea ? `<textarea id="ed_${f}"${dis}>${val}</textarea>`
        : opts.select ? `<select id="ed_${f}"${dis}>${opts.select}</select>`
        : `<input id="ed_${f}" type="${opts.type || 'text'}" value="${val}" ${opts.mono ? 'class="mono"' : ''} dir="${opts.dir || 'auto'}"${dis}>`;
      return `<div class="f"><label for="ed_${f}">${label}${rev}</label>${input}${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}</div>`;
    };
    const catOptions = `<option value="">-</option>` + CAT_FLAT.map(c => `<option value="${c.id}" ${String(product.categoryId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') +
      (product.categoryId && !CAT_NAME[product.categoryId] ? `<option value="${esc(product.categoryId)}" selected>#${esc(product.categoryId)}</option>` : '');

    drawer.innerHTML = `
      <div class="drawer__h"><h2>${id ? t('editP') : t('addP')}</h2><button class="drawer__x" id="edX">✕</button></div>
      <div class="drawer__body">
        ${ecwidOwnsCatalogue() ? `<div class="hint" style="margin-bottom:14px">${esc(t('ecwidOwned'))}${id && !isCustom ? ' <a href="' + ecwidAdminUrl(ECWID && ECWID.storeId, 'product', id) + '" target="_blank" rel="noopener">' + esc(t('ecwidOpenProduct')) + '</a>' : ''}</div>` : ''}
        ${field('title', t('f_title'), { textarea: false })}
        <div class="f"><label>${t('f_img')}</label>
          <div class="imgedit">
            <img class="imgedit__prev" id="edPrev" src="${esc(product.image)}" alt="" onerror="this.style.visibility='hidden'">
            <div class="imgedit__c">
              <input id="ed_image" type="text" value="${esc(product.image)}" dir="ltr" placeholder="${t('f_imgUrl')}">
              <div class="uprow"><button type="button" class="upbtn" id="edUp">${t('upload')}</button><input type="file" id="edFile" accept="image/*" hidden></div>
            </div>
          </div>
        </div>
        <div class="f" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:0">
          ${field('price', t('f_price'), { type: 'number', mono: true, dir: 'ltr' })}
          ${field('badge', t('f_badge'))}
        </div>
        ${field('categoryId', t('f_cat'), { select: catOptions })}
        ${field('description', t('f_desc'), { textarea: true })}
        ${field('brand', t('f_brand'))}
        ${field('url', t('f_url'), { dir: 'ltr', hint: '' })}
      </div>
      <div class="drawer__foot">
        <button class="btn btn--ghost" id="edCancel">${t('cancel')}</button>
        <button class="btn btn--gold" id="edSave">${t('save')}</button>
      </div>`;

    $('edX').addEventListener('click', closeDrawer);
    $('edCancel').addEventListener('click', closeDrawer);
    $('ed_image').addEventListener('input', e => { const im = $('edPrev'); im.src = e.target.value; im.style.visibility = 'visible'; });
    $('edUp').addEventListener('click', () => $('edFile').click());
    $('edFile').addEventListener('change', onUpload);
    drawer.querySelectorAll('[data-rev]').forEach(el => el.addEventListener('click', () => {
      const f = el.dataset.rev; const inp = $('ed_' + f);
      if (inp) inp.value = EDIT.base[f] == null ? '' : EDIT.base[f];
      if (f === 'image') { const im = $('edPrev'); im.src = inp.value; im.style.visibility = 'visible'; }
      el.dataset.reverted = '1'; el.classList.remove('on');
    }));
    $('edSave').addEventListener('click', saveEditor);
  }

  async function onUpload(e) {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const btn = $('edUp'); const old = btn.textContent; btn.textContent = t('uploading'); btn.disabled = true;
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api('/api/admin/upload', { method: 'POST', body: { data: dataUrl } });
      $('ed_image').value = r.url; const im = $('edPrev'); im.src = r.url; im.style.visibility = 'visible';
      toast(t('saved'), 'ok');
    } catch (ex) { toast(ex.message, 'err'); }
    finally { btn.textContent = old; btn.disabled = false; e.target.value = ''; }
  }

  async function saveEditor() {
    const btn = $('edSave'); btn.disabled = true;
    try {
      const fields = ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand', 'badge'];
      const patch = {};
      for (const f of fields) {
        const inp = $('ed_' + f); if (!inp) continue;
        const revEl = document.querySelector(`[data-rev="${f}"]`);
        if (revEl && revEl.dataset.reverted === '1') { patch[f] = null; continue; }   // revert to scraped
        let val = inp.value;
        if (f === 'price') val = val === '' ? 0 : Number(val);
        if (EDIT.isCustom) { patch[f] = val; }
        else if (String(val) !== String(EDIT.orig[f] == null ? '' : EDIT.orig[f])) { patch[f] = val; }  // only changed fields become overrides
      }
      if (EDIT.id) {
        if (!EDIT.isCustom && !Object.keys(patch).length) { closeDrawer(); return; }
        await api('/api/admin/products/' + encodeURIComponent(EDIT.id), { method: 'PATCH', body: patch });
        toast(t('saved'), 'ok');
      } else {
        if (!patch.title || !String(patch.title).trim()) { toast(t('f_title'), 'err'); btn.disabled = false; return; }
        await api('/api/admin/products', { method: 'POST', body: patch });
        toast(t('created'), 'ok');
      }
      closeDrawer(); loadProducts(); refreshOverview();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  }

  /* ================= ORDERS ================= */
  /* Where each order stands between here and Ecwid, by ref. Fetched
     alongside the orders rather than folded into /api/admin/orders, because
     the orders desk has to keep working with Ecwid switched off entirely. */
  let ECWID_ORDERS = null;
  async function loadEcwidOrders() {
    try { ECWID_ORDERS = await api('/api/admin/ecwid/orders'); }
    catch (e) { ECWID_ORDERS = null; }
    return ECWID_ORDERS;
  }

  function ecwidOrderMap(d) {
    const m = new Map();
    if (!d) return m;
    for (const o of d.pushed || []) m.set(o.ref, { ...o, state: 'pushed' });
    for (const o of d.pending || []) m.set(o.ref, { ...o, state: 'pending' });
    for (const o of d.parked || []) m.set(o.ref, { ...o, state: 'parked' });
    return m;
  }

  /* One cell, saying the one thing a human needs: it is filed (here is the
     link), it is waiting (nothing to do), or it has STOPPED and needs a
     person. The last is the only one with a button. */
  function ecwidOrderCell(row, storeId) {
    if (!row) return '<span class="muted">' + esc(t('ecwidNotPushed')) + '</span>';
    if (row.state === 'pushed') {
      const href = 'https://my.ecwid.com/store/' + encodeURIComponent(storeId || '') +
        '#order:id=' + encodeURIComponent(row.ecwidOrderId);
      return '<a href="' + href + '" target="_blank" rel="noopener" class="mono" style="font-size:.78rem">'
        + esc(t('ecwidInStore')) + ' #' + esc(row.ecwidOrderId) + '</a>';
    }
    if (row.state === 'parked') {
      return '<span class="err">' + esc(t('ecwidParked')) + '</span> '
        + '<button class="btn btn--ghost btn--sm ecwid-retry" data-ref="' + esc(row.ref) + '">'
        + esc(t('ecwidRetry')) + '</button>'
        + (row.lastError ? '<br><span class="muted" style="font-size:.72rem">' + esc(String(row.lastError).slice(0, 90)) + '</span>' : '');
    }
    return '<span class="muted">' + esc(t('ecwidWaitingPush'))
      + (row.attempts ? ' (' + row.attempts + ')' : '') + '</span>';
  }

  async function viewOrders() {
    const view = $('view');
    try {
      const [data, eo] = await Promise.all([api('/api/admin/orders'), loadEcwidOrders()]);
      if (!data.orders.length) { view.innerHTML = `<div class="empty">${t('noOrders')}</div>`; return; }
      const emap = ecwidOrderMap(eo);
      const storeId = eo && eo.storeId;
      /* Said once, at the top, rather than leaving every row reading as
         "not sent" with no explanation of why. */
      const notice = (eo && eo.ordersReadable === false)
        ? `<div class="notice notice--warn">${esc(t('ecwidNoOrderAccess'))}</div>` : '';
      view.innerHTML = notice + `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>${t('th_ref')}</th><th>${t('th_cust')}</th><th>${t('th_items')}</th><th>${t('th_total')}</th><th>${t('th_status')}</th><th>${t('th_ecwid')}</th><th>${t('th_when')}</th></tr></thead>
        <tbody>${data.orders.map(o => rowOrder(o, emap.get(o.ref), storeId)).join('')}</tbody></table></div>`;
      view.querySelectorAll('.ecwid-retry').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await api('/api/admin/ecwid/orders/' + encodeURIComponent(b.dataset.ref) + '/retry', { method: 'POST' });
          toast(r.ok ? t('ecwidRetried') : (r.error || t('loadFail')), r.ok ? 'ok' : 'err');
          route();
        } catch (ex) { toast(ex.message, 'err'); b.disabled = false; }
      }));
      view.querySelectorAll('.statussel').forEach(sel => sel.addEventListener('change', async e => {
        try { await api(`/api/admin/orders/${encodeURIComponent(sel.dataset.ref)}/status`, { method: 'POST', body: { status: e.target.value } }); toast(t('statusUpdated'), 'ok'); refreshOverview(); }
        catch (ex) { toast(ex.message, 'err'); }
      }));
    } catch (e) { fail(view, e); }
  }
  function rowOrder(o, ecwidRow, storeId) {
    const cust = o.customer || {};
    // Separator follows the admin's language, like every other string here.
    const items = (o.items || []).map(i => `${esc(i.title)}${i.qty > 1 ? ' ×' + i.qty : ''}`)
      .join(LANG === 'en' ? ', ' : '، ');
    const total = o.subtotal != null ? o.subtotal : (o.totals && o.totals.subtotal) || 0;
    return `<tr>
      <td class="mono" style="font-weight:800">${esc(o.ref)}</td>
      <td><b style="font-weight:700">${esc(cust.name || o.delivery && o.delivery.name || '-')}</b><br><span class="muted mono" style="font-size:.76rem">${esc(cust.phone || (o.delivery && o.delivery.phone) || '')}</span></td>
      <td><div class="ord-items" title="${esc(items)}">${esc(items).slice(0, 120)}</div></td>
      <td class="price">${money(total)}</td>
      <td><select class="statussel" data-ref="${esc(o.ref)}">${S.orderStatuses.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${t('st_' + s)}</option>`).join('')}</select></td>
      <td>${ecwidOrderCell(ecwidRow, storeId)}</td>
      <td class="audit-when">${when(o.createdAt)}</td>
    </tr>`;
  }

  /* ================= CUSTOMERS ================= */
  async function viewCustomers() {
    const view = $('view');
    try {
      const data = await api('/api/admin/customers');
      if (!data.customers.length) { view.innerHTML = `<div class="empty">${t('noCustomers')}</div>`; return; }
      view.innerHTML = `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>${t('th_name')}</th><th>${t('th_email')}</th><th>${t('th_phone')}</th><th>${t('th_homes')}</th><th>${t('th_orders')}</th><th>${t('th_via')}</th><th>${t('th_joined')}</th><th>${t('th_ecwid')}</th></tr></thead>
        <tbody>${data.customers.map(c => `<tr>
          <td><b style="font-weight:700">${esc(c.name || '-')}</b></td>
          <td class="mono" style="font-size:.8rem">${esc(c.email)}</td>
          <td class="mono" style="font-size:.8rem;direction:ltr">${esc(c.phone || '-')}</td>
          <td>${c.homes || 0}</td>
          <td>${c.orders || 0}</td>
          <td class="muted" style="font-size:.8rem">${(c.providers && c.providers.length) ? esc(c.providers.join(', ')) : t('viaPass')}</td>
          <td class="audit-when">${when(c.createdAt)}</td>
          <td class="ecwid-cust" data-email="${esc(c.email)}"><button class="btn btn--ghost btn--sm ecwid-look" data-email="${esc(c.email)}">${esc(t('ecwidLookup'))}</button></td>
        </tr>`).join('')}</tbody></table></div>`;
      view.querySelectorAll('.ecwid-look').forEach(b => b.addEventListener('click', async () => {
        const cell = b.parentNode;
        b.disabled = true;
        cell.innerHTML = '<span class="muted">…</span>';
        try {
          const r = await api('/api/admin/ecwid/customer?email=' + encodeURIComponent(b.dataset.email));
          cell.innerHTML = ecwidCustomerCell(r);
        } catch (ex) { cell.innerHTML = '<span class="err">' + esc(ex.message || '') + '</span>'; }
      }));
    } catch (e) { fail(view, e); }
  }

  /* What came back, in one cell. 'no-access' is reported as its own thing:
     on a public_ token an unreachable customer and a non-existent one both
     look like nothing, and that ambiguity costs an afternoon. */
  function ecwidCustomerCell(r) {
    if (!r) return '<span class="err">-</span>';
    if (r.reason === 'no-access')
      return '<span class="muted" style="font-size:.74rem">403</span>';
    if (!r.linked) return '<span class="muted" style="font-size:.76rem">' + esc(t('ecwidNotLinked')) + '</span>';
    const n = (r.orders || []).length;
    return '<b style="font-weight:700">#' + esc(r.customer.id) + '</b>'
      + '<br><span class="muted" style="font-size:.74rem">' + esc(t('ecwidCustOrders')) + ': ' + n + '</span>';
  }

  /* ================= CONTENT ================= */
  /* MUST stay in step with ADMIN_CONTENT in compare-server.mjs — a file
     registered on the server but missing here is simply invisible to the
     owner. engine/admin-content.test.mjs asserts the two lists match. */
  const CONTENT_FILES = [{ name: 'guides', k: 'c_guides' }, { name: 'finder', k: 'c_finder' },
                         { name: 'promos', k: 'c_promos' }];
  let CONTENT_CUR = 'guides';
  async function viewContent() {
    const view = $('view');
    view.innerHTML = `
      <div class="toolbar">
        <div class="segn" id="cseg">${CONTENT_FILES.map(f => `<button data-n="${f.name}" class="${CONTENT_CUR === f.name ? 'on' : ''}">${t(f.k)}</button>`).join('')}</div>
      </div>
      <div id="cbox"><div class="loading"><span class="spin"></span></div></div>`;
    $('cseg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; CONTENT_CUR = b.dataset.n; document.querySelectorAll('#cseg button').forEach(x => x.classList.toggle('on', x === b)); loadContent(); });
    loadContent();
  }
  async function loadContent() {
    const box = $('cbox');
    try {
      const d = await api('/api/admin/content/' + CONTENT_CUR);
      let pretty = d.json; try { pretty = JSON.stringify(JSON.parse(d.json), null, 2); } catch (e) {}
      box.innerHTML = `
        <textarea class="jsoned" id="cjson" spellcheck="false" dir="ltr">${esc(pretty)}</textarea>
        <div class="jsonbar">
          <button class="btn btn--ghost" id="cval">${t('validate')}</button>
          <button class="btn btn--gold" id="csave">${t('saveContent')}</button>
          <span class="msg" id="cmsg"></span>
        </div>`;
      const msg = $('cmsg');
      const check = () => { try { JSON.parse($('cjson').value); msg.className = 'msg ok'; msg.textContent = t('validJson'); return true; } catch (e) { msg.className = 'msg err'; msg.textContent = t('invalidJson') + e.message; return false; } };
      $('cval').addEventListener('click', check);
      $('csave').addEventListener('click', async () => {
        if (!check()) return;
        try { await api('/api/admin/content/' + CONTENT_CUR, { method: 'PUT', body: { json: $('cjson').value } }); toast(t('contentSaved'), 'ok'); refreshOverview(); }
        catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) { fail(box, e); }
  }

  /* ================= SETTINGS ================= */
  async function viewSettings() {
    const view = $('view');
    try {
      const { settings } = await api('/api/admin/settings'); const s = settings || {};
      const txt = (key, label, hint, val, dir) => `<div class="setrow"><label>${label}</label><div class="k mono">${key}</div><input type="text" data-set="${key}" value="${esc(val == null ? '' : val)}" dir="${dir || 'auto'}"><div class="hint" style="margin-top:6px">${hint}</div></div>`;
      const tog = (key, label, hint, on) => `<div class="setrow"><label class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}>${label}</label><div class="k mono" style="margin-top:8px">${key}</div><div class="hint" style="margin-top:4px">${hint}</div></div>`;
      view.innerHTML = `
        <div class="setgrid">
          ${txt('hotline', t('set_hotline'), t('set_hotlineK'), s.hotline, 'ltr')}
          ${txt('announcement', t('set_banner'), t('set_bannerK'), s.announcement)}
          ${tog('freeShipping', t('set_freeship'), t('set_freeshipK'), !!s.freeShipping)}
          ${tog('maintenance', t('set_maint'), t('set_maintK'), !!s.maintenance)}
          <div><button class="btn btn--gold" id="setSave">${t('saveSettings')}</button></div>
        </div>`;
      $('setSave').addEventListener('click', async () => {
        const patch = {};
        view.querySelectorAll('[data-set]').forEach(inp => { patch[inp.dataset.set] = inp.type === 'checkbox' ? inp.checked : inp.value; });
        try { await api('/api/admin/settings', { method: 'PUT', body: { settings: patch } }); toast(t('settingsSaved'), 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) { fail(view, e); }
  }

  /* ================= AUDIT ================= */
  async function viewAudit() {
    const view = $('view');
    try {
      const { audit } = await api('/api/admin/audit?limit=200');
      if (!audit || !audit.length) { view.innerHTML = `<div class="empty">${t('noAudit')}</div>`; return; }
      view.innerHTML = `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>${t('a_action')}</th><th>${t('a_target')}</th><th>${t('a_actor')}</th><th>${t('a_when')}</th></tr></thead>
        <tbody>${audit.map(r => `<tr><td class="audit-act">${esc(r.action)}</td><td class="mono" style="font-size:.8rem">${esc(r.target || '')}</td><td class="muted" style="font-size:.82rem">${esc(r.actor || '')}</td><td class="audit-when">${when(r.at)}</td></tr>`).join('')}</tbody>
      </table></div>`;
    } catch (e) { fail(view, e); }
  }

  /* ---------- go ---------- */
  window.addEventListener('hashchange', () => { if (S.me) { closeDrawer(); route(); } });
  boot();
})();
