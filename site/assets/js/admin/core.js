/* ============================================================================
   SADKO admin portal: the shell every page plugs into.

   window.ADM holds the shared pieces: language, the API client, small UI
   helpers (toast, dialog, fields, pager), the sidebar and a hash router.
   Pages register themselves with ADM.page(key, {...}) from pages-*.js; the
   sign-in screens live in login.js.

   The portal stores nothing in the browser beyond the chosen language. Every
   figure on screen comes from the server, which reads Ecwid (store pages) or
   the site's own database (website pages).
   ========================================================================== */
(function () {
  'use strict';

  /* ---- language ---- */
  const LKEY = 'sadko-admin-lang';
  let LANG = 'ar';
  try { LANG = localStorage.getItem(LKEY) === 'en' ? 'en' : 'ar'; } catch (e) {}
  const EN = () => LANG === 'en';
  const t = (ar, en) => (EN() ? en : ar);
  function applyLang() {
    document.documentElement.lang = LANG;
    document.documentElement.dir = EN() ? 'ltr' : 'rtl';
    document.title = t('بوابة الإدارة | صادكو', 'Admin portal | SADKO');
  }
  function setLang(l) { LANG = l === 'en' ? 'en' : 'ar'; try { localStorage.setItem(LKEY, LANG); } catch (e) {} applyLang(); }

  /* ---- formatting ---- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => (n == null || n === '' ? '-' : Number(n).toLocaleString(EN() ? 'en-US' : 'ar-EG'));
  const money = n => (n == null || n === '' ? '-' : num(Math.round(Number(n) * 100) / 100) + (EN() ? ' EGP' : ' جنيه'));
  function date(v, withTime) {
    if (!v) return '-';
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v).replace(' +0000', 'Z').replace(' ', 'T'));
    if (isNaN(d)) return String(v);
    return d.toLocaleString(EN() ? 'en-GB' : 'ar-EG', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
  }

  /* ---- API ---- */
  async function call(base, method, path, body) {
    const sep = path.includes('?') ? '&' : '?';
    let r;
    try {
      r = await fetch(base + path + sep + 'lang=' + LANG, {
        method, credentials: 'same-origin',
        headers: Object.assign({ 'x-sadko-admin': '1' }, body !== undefined ? { 'content-type': 'application/json' } : {}),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, error: 'offline', message: t('تعذّر الاتصال بالخادم.', 'Could not reach the server.') };
    }
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (r.status === 401 && base === '/api/admin/') { ADM.signedOut(); }
    return Object.assign({ ok: r.ok, status: r.status }, d || {});
  }
  const api = (method, path, body) => call('/api/admin/', method, path, body);
  const auth = (method, path, body) => call('/api/admin-auth/', method, path, body);

  /* ---- toast ---- */
  let toastTimer = null;
  function toast(msg, bad) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast on' + (bad ? ' toast--bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, bad ? 6000 : 2600);
  }
  /* Report a server answer: the success text, or the server's own message. */
  function report(r, okMsg) {
    if (r && r.ok) { if (okMsg) toast(okMsg); return true; }
    toast((r && r.message) || t('حدث خطأ. حاول مرة أخرى.', 'Something went wrong. Please try again.'), true);
    return false;
  }

  /* ---- dialog ----
     A real element, never window.confirm/alert: those block the page. */
  function modal({ title, body, actions, wide, onClose }) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal' + (wide ? ' modal--wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal__h"><h3>' + esc(title) + '</h3><button class="icon-btn" data-x aria-label="' + t('إغلاق', 'Close') + '">' + ICON.x + '</button></div>' +
      '<div class="modal__b"></div>' + (actions === false ? '' : '<div class="modal__f"></div>') + '</div>';
    const b = bg.querySelector('.modal__b');
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    const f = bg.querySelector('.modal__f');
    (actions || []).forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.kind || '');
      btn.textContent = a.label;
      btn.onclick = async () => {
        if (!a.run) return close();
        btn.disabled = true;
        const old = btn.textContent;
        btn.innerHTML = '<span class="spin spin--sm"></span>';
        let keep = false;
        try { keep = (await a.run(b, close)) === false; } finally { btn.disabled = false; btn.textContent = old; }
        if (!keep && document.body.contains(bg)) close();
      };
      f.appendChild(btn);
    });
    document.body.appendChild(bg);
    const first = b.querySelector('input:not([type=hidden]):not([type=file]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: b, close };
  }
  function confirmBox(text, yesLabel, danger) {
    return new Promise(res => {
      modal({ title: t('تأكيد', 'Please confirm'), body: '<p style="margin:4px 0 8px">' + esc(text) + '</p>', onClose: () => res(false),
        actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' },
                  { label: yesLabel || t('نعم', 'Yes'), kind: danger ? 'btn--bad' : '', run: () => { res(true); } }] });
    });
  }

  /* ---- form helpers ---- */
  function field(label, inner, hint) {
    return '<label class="field"><span>' + esc(label) + '</span>' + inner + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }
  const input = (name, value, attrs) => '<input class="input" name="' + name + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
  const textarea = (name, value, attrs) => '<textarea class="textarea" name="' + name + '" ' + (attrs || '') + '>' + esc(value == null ? '' : value) + '</textarea>';
  function select(name, options, value, attrs) {
    return '<select class="select" name="' + name + '" ' + (attrs || '') + '>' + options.map(o => {
      const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }
  const sw = (name, on, attrs) => '<span class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + ' ' + (attrs || '') + '><i></i></span>';
  /* Every named control under el, as a plain object. */
  function formData(el) {
    const o = {};
    el.querySelectorAll('[name]').forEach(x => {
      if (x.type === 'checkbox') o[x.name] = x.checked;
      else if (x.type === 'file') return;
      else o[x.name] = x.value;
    });
    return o;
  }
  function pager(page, pages, go) {
    const w = document.createElement('div');
    w.className = 'pager';
    if (pages <= 1) return w;
    w.innerHTML = '<button class="btn btn--ghost btn--sm" data-p="-1"' + (page <= 1 ? ' disabled' : '') + '>' + t('السابق', 'Previous') + '</button>' +
      '<span class="small muted">' + t('صفحة ' + num(page) + ' من ' + num(pages), 'Page ' + page + ' of ' + pages) + '</span>' +
      '<button class="btn btn--ghost btn--sm" data-p="1"' + (page >= pages ? ' disabled' : '') + '>' + t('التالى', 'Next') + '</button>';
    w.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => go(page + Number(b.dataset.p)); });
    return w;
  }
  /* A picked image file → { dataUrl, w, h }, or an error message. */
  function readImage(file, maxBytes) {
    return new Promise(res => {
      if (!file) return res(null);
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return res({ error: t('اختر صورة PNG أو JPG أو WebP.', 'Choose a PNG, JPG or WebP picture.') });
      if (file.size > (maxBytes || 3_000_000)) return res({ error: t('الصورة أكبر من ٣ ميجا.', 'The picture is larger than 3 MB.') });
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => res({ dataUrl: fr.result, w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res({ error: t('تعذّر قراءة الصورة.', 'Could not read that picture.') });
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
  const loading = () => '<div class="loading" style="min-height:30vh"><span class="spin"></span></div>';
  const srcTag = kind => kind === 'ecwid'
    ? '<span class="src src--e" title="' + t('يُقرأ ويُكتب مباشرة فى إكويد', 'Read and written straight to Ecwid') + '">Ecwid</span>'
    : '<span class="src src--s" title="' + t('موجود على الموقع فقط', 'Exists only on the website') + '">' + t('الموقع', 'Site') + '</span>';

  /* ---- icons (inline, stroke) ---- */
  const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const ICON = {
    home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    dash: svg('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
    scene: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M22 17l-6-6-9 9"/>'),
    ad: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 21h10"/><path d="M8 11h3M8 8h6"/>'),
    book: svg('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/>'),
    quiz: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>'),
    bar: svg('<path d="M3 11v3a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a3 3 0 0 1 0 6"/>'),
    order: svg('<path d="M6 2l1.5 4h9L18 2"/><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 11h8M8 15h5"/>'),
    box: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
    store: svg('<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>'),
    tag: svg('<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    truck: svg('<path d="M1 4h13v12H1z"/><path d="M14 9h4l4 4v3h-8"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>'),
    card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 4a3.5 3.5 0 0 1 0 7M22 21a6 6 0 0 0-4-5.6"/>'),
    shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    log: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    x: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    down: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
  };

  /* ---- pages + router ---- */
  const PAGES = [];
  const GROUPS = [
    { key: 'top', ar: '', en: '' },
    { key: 'site', ar: 'الموقع', en: 'Website' },
    { key: 'store', ar: 'المتجر', en: 'Store', tag: 'Ecwid' },
    { key: 'people', ar: 'الأشخاص', en: 'People' },
  ];
  function page(key, def) { PAGES.push(Object.assign({ key }, def)); }

  let ME = null, BADGES = {};
  /* Access, as the server decides it (engine/admin-perms.mjs): a page's
     section is its `perm` ('any' for everyone, 'master' for the master
     alone) or its own key. The server refuses anything this would hide. */
  const sectionOfPage = p => p.perm || p.key;
  function can(section, write) {
    if (!ME) return false;
    if (ME.role === 'master' || section === 'any') return true;
    if (section === 'master') return false;
    const lv = (ME.perms || {})[section];
    return write ? lv === 'edit' : lv === 'view' || lv === 'edit';
  }
  const visible = () => PAGES.filter(p => can(sectionOfPage(p), false));
  function current() {
    const h = location.hash.replace(/^#\/?/, '');
    const key = h.split('?')[0] || 'dashboard';
    return visible().find(p => p.key === key) ? key : 'dashboard';
  }
  async function shell() {
    /* Role and access come with "me"; a fresh sign-in has only the email. */
    if (ME && !ME.role) {
      const m = await api('GET', 'me');
      if (m.ok) ME = { email: m.email, role: m.role, perms: m.perms || {} };
    }
    const root = document.getElementById('root');
    root.innerHTML = '<div class="shell" id="shell"><aside class="side" id="side"></aside><main class="main" id="main"></main></div>';
    paintSide();
    window.onhashchange = route;
    route();
  }
  function paintSide() {
    const side = document.getElementById('side');
    if (!side) return;
    const on = current();
    const pages = visible();
    side.innerHTML = '<a class="side__brand" href="#/dashboard"><img src="assets/img/sadko-logo-256.webp" alt=""><div><b>' + t('إدارة صادكو', 'SADKO Admin') +
      '</b><span>' + t('بوابة الإدارة', 'Admin portal') + '</span></div></a>' +
      GROUPS.map(g => {
        const items = pages.filter(p => p.group === g.key);
        if (!items.length) return '';
        return (g.ar ? '<div class="side__grp">' + esc(t(g.ar, g.en)) + (g.tag ? '<em>' + g.tag + '</em>' : '') + '</div>' : '') +
          items.map(p => '<a class="nav' + (p.key === on ? ' on' : '') + '" href="#/' + p.key + '">' + (ICON[p.icon] || '') +
            '<span>' + esc(t(p.label[0], p.label[1])) + '</span>' + (BADGES[p.key] ? '<span class="count">' + BADGES[p.key] + '</span>' : '') + '</a>').join('');
      }).join('') +
      '<div class="side__foot"><div class="muted tiny">' + t('مسجّل الدخول باسم', 'Signed in as') + '</div><div class="who">' + esc(ME ? ME.email : '') + '</div>' +
      (ME && ME.role === 'master' ? '<div class="role-badge">' + t('المسؤول الرئيسى', 'Master admin') + '</div>' : '') +
      '<button id="langBtn">' + (EN() ? 'العربية' : 'English') + '</button> <button id="outBtn">' + t('تسجيل الخروج', 'Sign out') + '</button></div>';
    side.querySelector('#outBtn').onclick = async () => { await auth('POST', 'logout', {}); location.hash = ''; location.reload(); };
    side.querySelector('#langBtn').onclick = () => { setLang(EN() ? 'ar' : 'en'); paintSide(); route(); };
  }
  function setBadge(key, n) { BADGES[key] = n || 0; paintSide(); }

  /* View-only pages: every control that changes something is disabled, and
     stays disabled as the page redraws or opens a dialog. What lets an admin
     LOOK (search, filters, tabs, paging, opening a row, closing a dialog) is
     kept. The server refuses the change regardless; this just says so first. */
  const KEEP = '#q, #status, #cat, #catSel, [data-search], #views button, .tabs button, [data-view], [data-scene], [data-pick], ' +
               '[data-x], .pager button, #menuBtn, #langBtn, #outBtn, .modal__f .btn--ghost, [data-tab]';
  let lockObserver = null;
  function lockdown(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('button, input, select, textarea').forEach(el => {
      if (el.disabled || el.matches(KEEP) || el.closest('.side')) return;
      el.disabled = true;
      el.title = t('عرض فقط', 'View only');
    });
  }
  function setReadOnly(on) {
    if (lockObserver) { lockObserver.disconnect(); lockObserver = null; }
    if (!on) return;
    lockdown(document.getElementById('main'));
    lockObserver = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1) lockdown(n.closest('.modal-bg') || n.parentElement || n);
    })));
    lockObserver.observe(document.body, { childList: true, subtree: true });
  }

  let routeSeq = 0;
  async function route() {
    const key = current();
    const p = PAGES.find(x => x.key === key);
    const main = document.getElementById('main');
    if (!main || !p) return;
    document.getElementById('shell').classList.remove('menu-open');
    paintSide();
    setReadOnly(false);
    const seq = ++routeSeq;
    const readOnly = !can(sectionOfPage(p), true);
    main.innerHTML = '<div class="top"><div><h1><button class="icon-btn menu-btn" id="menuBtn">' + ICON.menu + '</button>' +
      esc(t(p.label[0], p.label[1])) + (p.source ? ' ' + srcTag(p.source) : '') +
      (readOnly ? ' <span class="chip chip--warn">' + t('عرض فقط', 'View only') + '</span>' : '') + '</h1>' +
      (p.sub ? '<p class="sub">' + esc(t(p.sub[0], p.sub[1])) + '</p>' : '') + '</div><div class="top__actions" id="topActions"></div></div><div id="pageBody">' + loading() + '</div>';
    main.querySelector('#menuBtn').onclick = () => document.getElementById('shell').classList.toggle('menu-open');
    const body = main.querySelector('#pageBody');
    try {
      await p.render(body, { actions: main.querySelector('#topActions'), stale: () => seq !== routeSeq, query: new URLSearchParams(location.hash.split('?')[1] || ''), readOnly });
      if (readOnly && seq === routeSeq) setReadOnly(true);
    } catch (e) {
      if (seq === routeSeq) body.innerHTML = '<div class="note note--bad">' + esc(t('تعذّر تحميل هذه الصفحة: ', 'This page could not load: ') + (e && e.message || e)) + '</div>';
      console.error(e);
    }
  }

  /* ---- boot ---- */
  async function boot() {
    applyLang();
    const s = await auth('GET', 'me');
    if (s.stage === 'full') {
      ME = { email: s.email };
      shell();
    } else {
      window.ADM.login.start(s);
    }
  }
  function signedOut() {
    if (!ME) return;
    ME = null;
    toast(t('انتهت الجلسة. سجّل الدخول من جديد.', 'Your session ended. Please sign in again.'), true);
    window.ADM.login.start({ stage: null });
  }

  window.ADM = { t, EN, setLang, applyLang, esc, num, money, date, api, auth, toast, report, modal, confirm: confirmBox,
    field, input, textarea, select, sw, formData, pager, readImage, debounce, loading, srcTag, ICON, page, setBadge,
    boot, signedOut, shell: () => shell(), me: () => ME, can, setMe: m => { ME = m; }, rerender: () => route() };
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
})();
