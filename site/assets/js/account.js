/* ============================================================================
   SADKO account — sign in (password or provider), places, orders.
   ----------------------------------------------------------------------------
   Session handling is the server's job; this page never holds a token or a
   password. When the site is served without its Node process, `skAuth.available`
   goes false and we say so rather than faking a signed-in state.

   Social sign-in: the "Sign in with Google" button is rendered ONLY when this
   deployment has a client id configured (GET /api/auth/config). With none set,
   the section explains what is missing instead of showing a button that cannot
   work. A per-attempt nonce is generated here and checked by the server, so a
   captured token cannot be replayed.

   Places (house/room profiles) are managed here through skHomes, and the one
   marked active drives filtering across the whole site.
   ========================================================================== */
(function () {
  'use strict';

  function mountAccount(root) {
    const A = window.skApp, t = A.t, esc = A.esc, Au = window.skAuth, H = window.skHomes;
    let brands = [], cfg = { providers: [] }, editing = null;
    /* ?next=appliances.html: where to go once signed in. Only a bare page name
       of this site is followed, so the parameter cannot become an open redirect. */
    const NEXT = (v => /^[a-z][a-z0-9-]*\.html$/.test(v) ? v : null)(new URLSearchParams(location.search).get('next') || '');

    Promise.all([
      A.products().then(list => { brands = [...new Set(list.map(p => { const s = window.skSpecs.of(p); return s.brand && s.brand.en; }).filter(Boolean))].sort(); }).catch(() => {}),
      Au.config().then(c => { cfg = c || cfg; }).catch(() => {}),
    ]).then(() => Au.me(true)).then(render);

    Au.onChange(u => { if (root.dataset.painted) render(u); });

    function render(user) {
      if (user && NEXT) { location.replace(A.P(NEXT)); return; }
      root.dataset.painted = '1';
      // The login/signup screen takes over the page (its own background + logo,
      // no hero/footer). A signed-in user, the offline state, or a guest who
      // came specifically to manage their places keeps the normal layout.
      const guestHomes = !user && (location.hash === '#homes' || location.hash === '#home');
      const authMode = !user && Au.available && !guestHomes;
      document.body.classList.toggle('sk-auth-mode', authMode);

      if (!Au.available) root.innerHTML = offline();
      else if (user) root.innerHTML = signedIn(user);
      else if (guestHomes) root.innerHTML = guestHomesScreen();
      else root.innerHTML = authScreen();

      wire(user);
      mountProviderButtons();
      if ((location.hash === '#homes' || location.hash === '#home') && user) {
        const el = root.querySelector('#homesBox'); el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function offline() {
      return '<div class="panel"><h2 class="panel__h">' + t('الحسابات غير متاحة حالياً', 'Accounts are unavailable right now') + '</h2>' +
        '<div class="note note--warn">' + esc(Au.offlineMsg()) + '</div>' +
        '<p class="muted small mt16">' + t('وبقية الموقع تعمل: ' + (!(window.skFeature && !window.skFeature.on('compare')) ? 'المقارنة، و' : '') + 'ساعدنى أختار، ' + (!(window.skFeature && !window.skFeature.on('plan')) ? 'والخطط، ' : '') + 'والمحفوظات. ويمكنك أيضاً أن تعرّفنا بمنزلك دون حساب، وسيُحفظ على جهازك.',
          'The rest of the site still works: ' + (!(window.skFeature && !window.skFeature.on('compare')) ? 'comparison, ' : '') + 'the finder, ' + (!(window.skFeature && !window.skFeature.on('plan')) ? 'plans and ' : '') + 'saved products. You can even describe your home without an account. It is kept on your device.') + '</div>' +
        '<div class="chips mt16"><a class="btn btn--teal" href="' + A.P('finder.html') + '">' + t('ساعدنى أختار', 'Help me choose') + '</a>' +
        '<a class="btn btn--ghost" href="tel:19140">' + t('اطلب هاتفياً 19140', 'Order by phone 19140') + '</a></div></div>' +
        homesPanel(null);
    }

    /* ================= login / signup screen =================
       One centred card over a photo of a SADKO room, with the logo above it —
       the pattern people expect from a real store. Login shows first; a link
       flips to signup in place, no reload. Social sign-in sits on top; email +
       password below. */
    /* Passwords are gone only when the server SAYS so. cfg starts as
       { providers: [] } and Au.config() can fail, so an absent flag means
       "passwords on" — a failed config read must not hide the only way in. */
    function passwordsOn() { return cfg.passwordAuth !== false; }

    function authScreen() {
      return passwordsOn() ? authScreenWithPasswords() : authScreenProviderOnly();
    }

    /* Provider-only: one button, and a sentence saying why there is no
       password box — otherwise the card reads as broken rather than as a
       deliberate choice. */
    function authScreenProviderOnly() {
      return '<div class="sk-auth">' +
        '<div class="sk-auth__inner">' +
          '<a class="sk-auth__logo" href="' + A.P('index.html') + '" aria-label="SADKO">' +
            '<img src="' + A.P('assets/img/sadko-logo.png') + '" alt="صادكو جروب"></a>' +
          '<div class="sk-auth__card">' +
            '<h1 id="authTitle">' + t('أهلاً بيك', 'Welcome') + '</h1>' +
            '<p class="sk-auth__sub" id="authSub">' + t('سجّل دخولك لتُتم طلبك وتتابعه، ولتجد ترشيحاتك على مقاس منزلك.',
              'Sign in to complete and track your orders, and get suggestions sized to your home.') + '</p>' +
            socialRow() +
            '<p class="sk-auth__mini">' + t('الدخول بحساب جوجل فقط. لا نحتفظ بكلمة سر لك على أى حال. لو لم يكن لديك حساب جوجل، اتصل بـ',
              'Sign-in is with Google only. We hold no password for you at all. If you do not have a Google account, call ') +
              '<a href="tel:19140" dir="ltr">19140</a>.</p>' +
            '<p class="sk-auth__mini">' + t('بالدخول أنت موافق على ', 'By signing in you agree to our ') +
              '<a href="' + A.P('terms.html') + '">' + t('شروط الاستخدام', 'terms') + '</a>' + t(' و', ' and ') +
              '<a href="' + A.P('privacy.html') + '">' + t('سياسة الخصوصية', 'privacy') + '</a>.</p>' +
          '</div>' +
          '<a class="sk-auth__home" href="' + A.P('index.html') + '">' + t('← العودة إلى الرئيسية', '← Back to home') + '</a>' +
        '</div></div>';
    }

    function authScreenWithPasswords() {
      return '<div class="sk-auth">' +
        '<div class="sk-auth__inner">' +
          '<a class="sk-auth__logo" href="' + A.P('index.html') + '" aria-label="SADKO">' +
            '<img src="' + A.P('assets/img/sadko-logo.png') + '" alt="صادكو جروب"></a>' +
          '<div class="sk-auth__card">' +
            '<h1 id="authTitle">' + t('أهلاً بيك تانى', 'Welcome back') + '</h1>' +
            '<p class="sk-auth__sub" id="authSub">' + t('سجّل دخولك لتُتم طلبك وتتابعه، ولتجد ترشيحاتك على مقاس منزلك.',
              'Sign in to complete and track your orders, and get suggestions sized to your home.') + '</p>' +

            socialRow() +
            '<div class="sk-auth__or"><span>' + t('أو بالبريد الإلكترونى', 'or with email') + '</span></div>' +

            // login form
            '<form id="loginForm" class="sk-authform">' +
              field('email', 'email', t('البريد الإلكترونى', 'Email'), '', 'username') +
              field('password', 'password', t('كلمة السر', 'Password'), '', 'current-password') +
              '<div id="loginErr"></div>' +
              '<button class="btn btn--teal btn--block mt8" type="submit">' + t('دخول', 'Sign in') + '</button>' +
              '<p class="sk-auth__mini">' + t('نسيت كلمة السر؟ كلّم خدمة العملاء على ', 'Forgotten your password? Call customer care on ') +
                '<a href="tel:19140" dir="ltr">19140</a></p>' +
            '</form>' +

            // signup form (hidden until toggled)
            '<form id="regForm" class="sk-authform" hidden>' +
              field('name', 'text', t('الاسم', 'Full name'), '', 'name') +
              field('email', 'email', t('البريد الإلكترونى', 'Email'), '', 'email') +
              field('phone', 'tel', t('الهاتف المحمول (اختيارى)', 'Mobile (optional)'), '', 'tel') +
              field('password', 'password', t('كلمة السر', 'Password'), t('٨ حروف على الأقل، حروف وأرقام', 'At least 8 characters, letters and numbers'), 'new-password') +
              '<div id="regErr"></div>' +
              '<button class="btn btn--primary btn--block mt8" type="submit">' + t('اعمل حساب', 'Create account') + '</button>' +
              '<p class="sk-auth__mini">' + t('بإنشاء الحساب أنت موافق على ', 'By creating an account you agree to our ') +
                '<a href="' + A.P('terms.html') + '">' + t('شروط الاستخدام', 'terms') + '</a>' + t(' و', ' and ') +
                '<a href="' + A.P('privacy.html') + '">' + t('سياسة الخصوصية', 'privacy') + '</a>.</p>' +
            '</form>' +

            '<p class="sk-auth__switch" id="authSwitch">' +
              '<span id="switchText">' + t('ألا تملك حساباً بعد؟', 'Don\'t have an account?') + '</span> ' +
              '<button type="button" id="authToggle">' + t('اعمل حساب', 'Sign up') + '</button></p>' +
          '</div>' +
          '<a class="sk-auth__home" href="' + A.P('index.html') + '">' + t('← العودة إلى الرئيسية', '← Back to home') + '</a>' +
        '</div></div>';
    }

    /* Social sign-in row. Google is a real, verified flow when a client id is
       configured; otherwise the button explains (on click) how to enable it,
       so the design still reads professionally in a demo. Extra providers
       (Facebook/Apple) appear here automatically once the server advertises
       them via /api/auth/config. */
    function socialRow() {
      const usable = (cfg.providers || []).filter(p => p.mode === 'gis');
      let html = '<div class="sk-social">';
      if (usable.length) {
        html += usable.map(p => '<div class="prov-slot" data-prov="' + esc(p.id) + '" data-client="' + esc(p.clientId) + '"></div>').join('');
      } else {
        // styled placeholder so the intended design is visible without config
        html += '<button type="button" class="sk-social__btn" id="googleDemo">' + googleIcon() +
          '<span>' + t('المتابعة بحساب جوجل', 'Continue with Google') + '</span></button>';
      }
      html += '<div id="provErr"></div></div>';
      return html;
    }
    function googleIcon() {
      return '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9h-7.3v5.7C8.1 41.1 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-2.9.7-4.3v-5.7H4.5C3 17 2.1 20.4 2.1 24s.9 7 2.4 10l7.3-5.7z"/><path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"/></svg>';
    }

    /* guest place manager — reached from the "manage places" link, without
       forcing a sign-in first (places live on the device until they register) */
    function guestHomesScreen() {
      return '<div class="between mt0"><div><h2 class="panel__h" style="font-size:1.25rem">' +
          t('أماكنى', 'My places') + '</h2>' +
          '<p class="muted small" style="margin:4px 0 0">' + t('عرّفنا بمنزلك لنصفّى المنتجات على مقاسه، دون إنشاء حساب.',
            'Tell us about your home so we filter products to fit, no account needed.') + '</p></div>' +
          '<a class="btn btn--teal btn--sm" href="' + A.P('account.html') + '">' + t('سجّل دخول', 'Sign in') + '</a></div>' +
        homesPanel(null);
    }

    /* Google Identity Services: load once, render a real button per slot. */
    function mountProviderButtons() {
      const slots = root.querySelectorAll('.prov-slot[data-prov="google"]');
      if (!slots.length) return;
      const start = () => {
        if (!window.google || !google.accounts || !google.accounts.id) return;
        slots.forEach(slot => {
          const nonce = cryptoNonce();
          google.accounts.id.initialize({
            client_id: slot.getAttribute('data-client'),
            nonce,
            callback: async (resp) => {
              const box = root.querySelector('#provErr');
              const r = await Au.oauth('google', resp.credential, nonce);
              if (r.ok) { render(Au.current()); return; }
              if (box) box.innerHTML = '<div class="note note--warn mt8 small">' +
                esc(r.message || t('تعذّر تسجيل الدخول بجوجل.', 'Could not sign in with Google.')) + '</div>';
            },
          });
          google.accounts.id.renderButton(slot, {
            theme: 'outline', size: 'large', shape: 'pill', width: 320,
            text: 'continue_with', locale: A.EN() ? 'en' : 'ar',
          });
        });
      };
      if (window.google && window.google.accounts) return start();
      if (document.getElementById('gis-sdk')) { document.getElementById('gis-sdk').addEventListener('load', start); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true; s.id = 'gis-sdk';
      s.onload = start;
      s.onerror = () => {
        const box = root.querySelector('#provErr');
        if (box) box.innerHTML = '<div class="note note--soft mt8 small">' +
          t('تعذّر تحميل زر جوجل (ربما بسبب الشبكة). استخدم البريد الإلكترونى وكلمة المرور.',
            'We could not load the Google button (possibly the network). Please use email and password.') + '</div>';
      };
      document.head.appendChild(s);
    }
    function cryptoNonce() {
      const a = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }

    /* ================= signed in ================= */
    function signedIn(u) {
      return '<div class="between"><div><h2 class="panel__h" style="font-size:1.25rem">' +
          t('أهلاً ', 'Hello ') + esc(u.name) + '</h2>' +
          '<p class="muted small" style="margin:4px 0 0">' + esc(u.email) + (u.phone ? ' · ' + esc(u.phone) : '') +
          (u.providers && u.providers.length ? ' · ' + t('بتدخل بـ ', 'signs in with ') + esc(u.providers.join(', ')) : '') + '</p></div>' +
          '<button class="btn btn--quiet btn--sm" id="logoutBtn">' + t('تسجيل خروج', 'Sign out') + '</button></div>' +

        /* No control-room link here any more: admins have their own accounts
           and sign in at admin.html, never through a customer account. */
        homesPanel(u) +

        '<div class="grid2 mt16">' +
          '<div class="panel"><h3 class="panel__h">' + t('بياناتك', 'Your details') + '</h3>' +
            '<form id="detForm">' +
              field('name', 'text', t('الاسم', 'Full name'), '', 'name', u.name) +
              field('phone', 'tel', t('الهاتف المحمول', 'Mobile'), '', 'tel', u.phone) +
              '<label class="field"><span class="field__l">' + t('عنوان التوصيل', 'Delivery address') + '</span>' +
                '<textarea class="textarea" name="address" maxlength="300" style="min-height:74px">' + esc(u.address || '') + '</textarea></label>' +
              '<div id="detMsg"></div>' +
              '<button class="btn btn--teal" type="submit">' + t('احفظ', 'Save') + '</button>' +
            '</form></div>' +

          '<div class="panel"><h3 class="panel__h">' + t('كلمة السر', 'Password') + '</h3>' +
            (u.hasPassword
              ? '<form id="pwForm">' +
                  field('current', 'password', t('كلمة السر الحالية', 'Current password'), '', 'current-password') +
                  field('next', 'password', t('كلمة السر الجديدة', 'New password'), t('٨ حروف على الأقل، حروف وأرقام', 'At least 8 characters, letters and numbers'), 'new-password') +
                  '<div id="pwMsg"></div>' +
                  '<button class="btn btn--ghost" type="submit">' + t('غيّر كلمة السر', 'Change password') + '</button>' +
                  '<p class="muted small mt8">' + t('لأمانك، التغيير بيسجّل خروج من كل الأجهزة.', 'For your security, changing it signs you out everywhere.') + '</p>' +
                '</form>'
              : '<div class="note note--soft small">' + t('حسابك بيدخل عن طريق ', 'Your account signs in with ') +
                  esc((u.providers || []).join(', ') || t('مزوّد خارجى', 'a provider')) +
                  (passwordsOn()
                    ? t('، فلا كلمة مرور هنا. وإن أردت كلمة مرور، فاتصل بخدمة العملاء.', ', so there is no password here. If you would like one, contact customer care.')
                    : t('، فلا كلمة مرور هنا، ولا نحتفظ بواحدة لأى عميل.', ', so there is no password here, and we hold none for any customer.')) + '</div>') +
          '</div>' +
        '</div>' +

        '<div class="panel mt16" id="ordersBox"><h3 class="panel__h">' + t('طلباتى', 'My orders') + '</h3>' +
          '<p class="muted small">' + t('جارى التحميل…', 'Loading…') + '</p></div>' +

        '<div class="panel mt16"><h3 class="panel__h">' + t('بياناتك وحقك فيها', 'Your data, and your rights over it') + '</h3>' +
          '<p class="panel__sub">' + t('يمكنك أخذ نسخة من كل ما هو مسجَّل لدينا، أو حذف حسابك نهائياً، دون الحاجة إلى مخاطبة أحد.',
            'You can take a copy of everything we hold, or delete your account permanently, without having to ask anyone.') + '</p>' +
          '<div class="chips">' +
            '<a class="btn btn--ghost btn--sm" href="' + Au.exportUrl() + '" download="sadko-my-data.json">' +
              t('نزّل نسخة من بياناتى', 'Download my data') + '</a>' +
            '<button class="btn btn--quiet btn--sm" id="delAcctBtn">' + t('امسح حسابى', 'Delete my account') + '</button>' +
          '</div>' +
          '<div id="delBox"></div></div>';
    }

    /* ================= places ================= */
    function homesPanel(u) {
      const homes = Au.homes();
      const active = Au.activeHome();
      const guest = !u;
      return '<div class="panel mt16" id="homesBox"><div class="between">' +
        '<div><h3 class="panel__h">' + t('أماكنى', 'My places') + ' <span class="badge">' + A.num(homes.length) + '</span></h3>' +
        '<p class="panel__sub" style="margin:6px 0 0">' + t(
          'قد يكون لديك أكثر من مكان: الشقة، أو شاليه الساحل، أو حتى غرفة بمفردها. اختر المكان المُفعَّل، وستُصفَّى كل صفحات المنتجات على مقاسه.',
          'You can keep more than one place: the flat, a chalet on the coast, or even a single room. Pick the active one and every product page filters to fit it.') + '</p></div>' +
        (homes.length < 8 ? '<button class="btn btn--teal btn--sm" id="addHomeBtn">' + t('+ مكان جديد', '+ Add a place') + '</button>' : '') +
        '</div>' +
        (guest ? '<div class="note note--soft small mt16">' + t(
          'أنت غير مسجَّل الدخول، فهذه الأماكن محفوظة على هذا الجهاز. وبمجرد إنشائك حساباً سننقلها معك تلقائياً.',
          'You are not signed in, so these places live on this device. When you create an account we move them across for you.') + '</div>' : '') +
        '<div id="homesList" class="stack mt16">' +
          (homes.length ? homes.map(h => homeCard(h, active && h.id === active.id)).join('')
                        : presetPicker()) +
        '</div>' +
        '<div id="homeEditor" class="mt16"></div></div>';
    }

    function homeCard(h, isActive) {
      const c = H.completeness(h);
      return '<div class="hm-card' + (isActive ? ' is-active' : '') + '">' +
        '<div style="display:flex;gap:12px;align-items:flex-start;min-width:0">' +
          '<span class="hm-card__i">' + esc(h.icon || '🏠') + '</span>' +
          '<div style="min-width:0"><p class="hm-card__n">' + esc(h.name || t('منزلى', 'My home')) +
            (isActive ? ' <span class="badge">' + t('الشغّال', 'active') + '</span>' : '') + '</p>' +
            '<p class="hm-card__s">' + esc(H.summary(h) || t('لا تفاصيل بعد', 'no details yet')) + '</p>' +
            '<p class="hm-card__s">' + t('مكتمل ', 'Completed ') + c.done + '/' + c.total + '</p></div></div>' +
        '<div class="chips">' +
          (isActive ? '' : '<button class="btn btn--ghost btn--sm" data-use="' + esc(h.id) + '">' + t('استخدمه', 'Use this') + '</button>') +
          '<button class="btn btn--quiet btn--sm" data-edit="' + esc(h.id) + '">' + t('عدّل', 'Edit') + '</button>' +
          '<button class="btn btn--quiet btn--sm" data-del="' + esc(h.id) + '" aria-label="' + t('امسح', 'Delete') + '">✕</button>' +
        '</div></div>';
    }

    function presetPicker() {
      return '<div class="note note--info small">' + t('ابدأ بواحد من هذه، ويمكنك تعديله لاحقاً:', 'Start from one of these (you can edit it afterwards):') + '</div>' +
        '<div class="chips mt8">' + H.PRESETS().map(p =>
          '<button type="button" class="chip" data-preset="' + esc(p.key) + '">' + esc(p.icon + ' ' + p.name) + '</button>').join('') + '</div>';
    }

    function editorFor(h) {
      const isNew = !h.id;
      return '<div class="panel" style="border-color:var(--accent)"><h3 class="panel__h">' +
        (isNew ? t('مكان جديد', 'New place') : t('تعديل: ', 'Editing: ') + esc(h.name || '')) + '</h3>' +
        '<p class="panel__sub">' + t('كل الحقول اختيارية. كل ما تكمّل أكتر، الفلترة والترشيحات تبقى أدق.',
          'Every field is optional. The more you fill in, the sharper the filtering and suggestions become.') + '</p>' +
        '<form id="homeForm">' + H.renderEditor(h, brands) +
          '<div id="homeMsg"></div>' +
          '<div class="chips"><button class="btn btn--primary" type="submit">' + t('احفظ المكان', 'Save this place') + '</button>' +
          '<button class="btn btn--quiet" type="button" id="cancelHome">' + t('إلغاء', 'Cancel') + '</button></div>' +
        '</form></div>';
    }

    /* ---- shared little helpers ---- */
    function field(name, type, label, hint, auto, value) {
      return '<label class="field"><span class="field__l">' + esc(label) + '</span>' +
        '<input class="input" type="' + type + '" name="' + name + '"' +
        (auto ? ' autocomplete="' + auto + '"' : '') +
        (value != null ? ' value="' + esc(value) + '"' : '') + '>' +
        (hint ? '<span class="field__hint">' + esc(hint) + '</span>' : '') + '</label>';
    }
    const msg = (el, kind, text) => { if (el) el.innerHTML = '<div class="note note--' + kind + ' mt8 small">' + esc(text) + '</div>'; };

    /* ================= wiring ================= */
    function wire(user) {
      const $ = s => root.querySelector(s);

      const lf = $('#loginForm');
      lf && lf.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(lf), btn = lf.querySelector('button');
        btn.disabled = true;
        const r = await Au.login(fd.get('email'), fd.get('password'));
        btn.disabled = false;
        if (r.ok) return render(r.user);
        msg($('#loginErr'), 'warn', r.message || t('تعذّر تسجيل الدخول.', 'Could not sign in.'));
      });

      const rf = $('#regForm');
      rf && rf.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(rf), btn = rf.querySelector('button[type=submit]');
        btn.disabled = true;
        const r = await Au.register({ name: fd.get('name'), email: fd.get('email'),
                                      phone: fd.get('phone'), password: fd.get('password') });
        btn.disabled = false;
        if (r.ok) return render(Au.current());
        msg($('#regErr'), 'warn', r.message || t('تعذّر إنشاء الحساب.', 'Could not create the account.'));
      });

      /* flip login <-> signup in place */
      const toggle = $('#authToggle');
      if (toggle) {
        let mode = 'login';
        toggle.addEventListener('click', () => {
          mode = mode === 'login' ? 'signup' : 'login';
          const login = mode === 'login';
          $('#loginForm').hidden = !login;
          $('#regForm').hidden = login;
          $('#authTitle').textContent = login ? t('أهلاً بيك تانى', 'Welcome back') : t('اعمل حساب جديد', 'Create your account');
          $('#authSub').textContent = login
            ? t('سجّل دخولك لتُتم طلبك وتتابعه، ولتجد ترشيحاتك على مقاس منزلك.', 'Sign in to complete and track your orders, and get suggestions sized to your home.')
            : t('دقيقة واحدة، ويمكنك بعدها أن تطلب وتتابع وتحفظ ما يعجبك.', 'A minute, and you can order, track and save what you like.');
          $('#switchText').textContent = login ? t('ألا تملك حساباً بعد؟', 'Don\'t have an account?') : t('عندك حساب بالفعل؟', 'Already have an account?');
          toggle.textContent = login ? t('اعمل حساب', 'Sign up') : t('سجّل دخول', 'Sign in');
          const firstInput = (login ? $('#loginForm') : $('#regForm')).querySelector('input');
          firstInput && firstInput.focus();
        });
      }
      /* demo Google button (no client id configured): explain, don't fake it */
      const gd = $('#googleDemo');
      gd && gd.addEventListener('click', () => {
        msg($('#provErr'), 'soft', t(
          'سيعمل الدخول بجوجل على الخادم بمجرد ضبط GOOGLE_CLIENT_ID، والتفعيل مجانى. وإلى ذلك الحين استخدم البريد الإلكترونى وكلمة المرور أدناه.',
          'Google sign-in activates once GOOGLE_CLIENT_ID is set on the server. It is free to enable. Until then, use email and password below.'));
      });

      const lo = $('#logoutBtn');
      lo && lo.addEventListener('click', async () => { await Au.logout(); render(null); });

      const df = $('#detForm');
      df && df.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(df);
        const r = await Au.saveProfile({ name: fd.get('name'), phone: fd.get('phone'), address: fd.get('address') });
        msg($('#detMsg'), r.ok ? 'info' : 'warn', r.ok ? t('اتحفظت.', 'Saved.') : (r.message || t('تعذّر الحفظ.', 'Could not save.')));
      });

      const pf = $('#pwForm');
      pf && pf.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(pf);
        const r = await Au.changePassword(fd.get('current'), fd.get('next'));
        if (r.ok) { msg($('#pwMsg'), 'info', t('اتغيّرت. سجّل دخولك تانى.', 'Changed. Please sign in again.')); setTimeout(() => render(null), 1200); }
        else msg($('#pwMsg'), 'warn', r.message || t('تعذّر التغيير.', 'Could not change it.'));
      });

      /* ---- places ---- */
      root.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
        const p = H.PRESETS().find(x => x.key === b.getAttribute('data-preset'));
        openEditor(Object.assign({}, p, { key: undefined }));
      }));
      const add = $('#addHomeBtn');
      add && add.addEventListener('click', () => openEditor({ name: '', icon: '🏠', scope: 'home' }));
      root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const h = Au.homes().find(x => x.id === b.getAttribute('data-edit'));
        if (h) openEditor(h);
      }));
      root.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', async () => {
        await Au.setActiveHome(b.getAttribute('data-use'));
        render(Au.current());
      }));
      root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const h = Au.homes().find(x => x.id === b.getAttribute('data-del'));
        if (!h) return;
        if (!confirm(t('تمسح «' + (h.name || '') + '»؟', 'Delete "' + (h.name || '') + '"?'))) return;
        await Au.removeHome(h.id);
        render(Au.current());
      }));

      /* Deleting an account is irreversible, so it asks for the email back
         rather than a single click, and says exactly what goes. */
      const del = $('#delAcctBtn');
      del && del.addEventListener('click', () => {
        const box = $('#delBox');
        box.innerHTML = '<div class="note note--warn mt16">' +
          '<b>' + t('المسح نهائى', 'This cannot be undone') + '</b><br>' +
          t('سيُحذف: حسابك، وأماكنك، وسجل طلباتك لدينا. أما الطلبات التى نُفِّذت فعلاً فقد تبقى فى سجلات صادكو المحاسبية.',
            'This removes your account, your places and your order history here. Orders already fulfilled may remain in SADKO\'s accounting records.') +
          '<label class="field mt16"><span class="field__l">' + t('اكتب بريدك الإلكترونى للتأكيد', 'Type your email to confirm') + '</span>' +
          '<input class="input" id="delEmail" type="email" autocomplete="off" placeholder="' + esc(user.email) + '"></label>' +
          '<div class="chips"><button class="btn btn--quiet btn--sm" id="delGo">' + t('امسح نهائياً', 'Delete permanently') + '</button>' +
          '<button class="btn btn--ghost btn--sm" id="delNo">' + t('إلغاء', 'Cancel') + '</button></div><div id="delMsg"></div></div>';
        box.querySelector('#delNo').addEventListener('click', () => { box.innerHTML = ''; });
        box.querySelector('#delGo').addEventListener('click', async () => {
          const r = await Au.deleteAccount(box.querySelector('#delEmail').value);
          if (r.ok) { alert(t('اتمسح حسابك. مع السلامة 👋', 'Your account has been deleted. Goodbye 👋')); location.href = A.P('index.html'); return; }
          msg(box.querySelector('#delMsg'), 'warn', r.message || t('تعذّر المسح.', 'Could not delete.'));
        });
      });

      if (user) loadOrders();
    }

    function openEditor(h) {
      editing = h;
      const box = root.querySelector('#homeEditor');
      if (!box) return;
      box.innerHTML = editorFor(h);
      const form = box.querySelector('#homeForm');
      // switching between home and room changes which questions apply
      const scope = form.querySelector('[name=scope]');
      scope && scope.addEventListener('change', () => {
        const cur = Object.assign({}, editing, window.skHomes.collect(form));
        cur.scope = scope.value;
        openEditor(cur);
      });
      form.querySelector('#cancelHome').addEventListener('click', () => { editing = null; box.innerHTML = ''; });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = H.collect(form);
        const r = editing && editing.id ? await Au.updateHome(editing.id, data) : await Au.addHome(data);
        if (!r.ok) { msg(box.querySelector('#homeMsg'), 'warn', r.message || t('تعذّر الحفظ.', 'Could not save.')); return; }
        if (!editing || !editing.id) await Au.setActiveHome((r.home && r.home.id) || null);
        editing = null;
        render(Au.current());
      });
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* The live payment methods, so an Ecwid method id on an order can be
       shown as the plan the customer actually chose. Loaded once and cached
       for the page; a failure leaves it null and payName falls back to the
       legacy keys, which is the pre-Ecwid behaviour. */
    let PAYMETHODS = null;
    function loadPayMethods() {
      if (PAYMETHODS) return Promise.resolve(PAYMETHODS);
      return fetch(A.P('api/payment-methods'))
        .then(r => (r.ok ? r.json() : null))
        .then(d => { PAYMETHODS = (d && Array.isArray(d.methods)) ? d.methods : []; return PAYMETHODS; })
        .catch(() => { PAYMETHODS = []; return PAYMETHODS; });
    }

    async function loadOrders() {
      const box = root.querySelector('#ordersBox');
      if (!box) return;
      /* Both in parallel: the method names are needed to render the table, so
         fetching them after it would print ids and then replace them. */
      const [list] = await Promise.all([Au.orders(), loadPayMethods()]);
      const h = '<h3 class="panel__h">' + t('طلباتى', 'My orders') + '</h3>';
      if (!list.length) {
        box.innerHTML = h + '<p class="muted small">' + t('لا طلبات بعد.', 'No orders yet.') + '</p>' +
          '<a class="btn btn--teal btn--sm mt8" href="' + A.P('shop.html') + '">' + t('اتفضل على المتجر', 'Browse the shop') + '</a>';
        return;
      }
      /* An order SADKO staff created — a phone sale on 19140, or a showroom
         sale — reaches this list through Ecwid. Saying so matters: an order
         the customer never placed on this site, appearing in their list
         unlabelled, reads as an error rather than as their own purchase. */
      const anyEcwid = list.some(o => o.origin === 'ecwid');
      box.innerHTML = h + '<div style="overflow-x:auto"><table class="tbl tbl--rows"><thead><tr>' +
        ['#', t('التاريخ', 'Date'), t('الأصناف', 'Items'), t('الإجمالى', 'Subtotal'), t('الدفع', 'Payment'), t('الحالة', 'Status')]
          .map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
        list.map(o => '<tr><td class="ltr"><b>' + esc(o.ref) + '</b>' +
            (o.origin === 'ecwid' ? '<br><em class="badge">' + t('طلب من خدمة العملاء', 'via customer care') + '</em>' : '') +
          '</td><td>' + esc(A.date(o.createdAt)) + '</td>' +
          '<td>' + A.num(o.items.reduce((n, i) => n + i.qty, 0)) + '</td>' +
          /* The grand total when Ecwid genuinely holds one — which means staff
             entered the delivery charge — and otherwise the goods subtotal,
             labelled as such. Never a total this page assembled itself. */
          /* A site order keeps the server's figures in totals: the grand
             total when delivery was quoted, and any coupon taken off. */
          (function () {
            const tt = o.totals || {};
            const total = o.total != null ? o.total : (tt.grandTotal != null ? tt.grandTotal : null);
            const goods = (o.subtotal || 0) - (tt.itemsDiscount || 0);
            return '<td>' + A.money(total != null ? total : goods) +
              (total != null ? '' : ' <small class="muted">' + t('(أجهزة فقط)', '(goods only)') + '</small>') +
              (tt.coupon && tt.discount > 0 ? '<br><small class="muted">' + t('بعد خصم ', 'after coupon ') + '<span class="ltr">' + esc(tt.coupon.code) + '</span></small>' : '') +
              '</td>';
          })() +
          '<td>' + esc(payName(o.payment)) + '</td>' +
          '<td><span class="chip ' + statusChip(o.status) + '">' + esc(statusName(o.status)) + '</span>' +
            /* The tracking number staff entered on the order in Ecwid. Every
               parcel goes by Movex, so the link is Movex's unless staff gave
               a direct one (engine/ecwid-customers.mjs trackingOf). */
            (o.tracking ? '<br><small class="ltr">' + esc(o.tracking.number) + '</small> <a class="small" target="_blank" rel="noopener" href="' +
              esc(o.tracking.url || 'https://movex.com.eg') + '">' + t('تتبع مع موڤكس', 'Track on Movex') + '</a>' : '') +
          '</td></tr>').join('') +
        '</tbody></table></div>' +
        (anyEcwid ? '<p class="muted small mt8">' + t(
          'الطلبات المعلَّمة «طلب من خدمة العملاء» سجّلها فريق صادكو بعد اتصالك أو زيارتك للمعرض.',
          'Orders marked "via customer care" were recorded by the SADKO team after you called or visited a showroom.') + '</p>' : '') +
        '<div class="note note--soft small mt16">' + t(
          'سُجِّل الطلب لدينا وستتواصل معك خدمة العملاء على 19140 لتأكيد التوصيل والتركيب ورسومهما. ولا يوجد دفع إلكترونى بالبطاقة فى هذه النسخة.',
          'Your order is recorded and customer care will contact you on 19140 to confirm delivery, installation and their charges. Online card payment is not available on this version.') + '</div>';
    }
    function payName(k) {
      /* An Ecwid method id first: that is what checkout sends now, and it is
         what made the instalment plans selectable at all. Printing the id
         ("51353-1761549067023") is what this column actually did.

         Then the three legacy keys, for orders placed before Ecwid and for
         when the method list cannot be loaded. Anything left is already a
         human title — the name staff chose on a phone order typed into Ecwid —
         so it is shown as written. */
      const hit = (PAYMETHODS || []).find(m => String(m.id) === String(k));
      if (hit) return hit.title;
      return { cod: t('الدفع عند الاستلام', 'Cash on delivery'), bank: t('تحويل بنكى', 'Bank transfer'),
               showroom: t('الدفع فى المعرض', 'Pay at a showroom') }[k] || k;
    }

    /* The status the order ACTUALLY has.

       This cell used to be the literal string "اتسجّل / Received" on every
       row, so the whole status round-trip — staff move the order in Ecwid, the
       webhook maps it through toLocalStatus, the server stores it — ended at a
       column that ignored the answer, and a delivered order told its customer
       it had merely been received.

       The vocabulary is engine/ecwid-map.mjs's FULFILMENT table: received,
       preparing, shipping, delivered, cancelled. An unrecognised value is
       shown as "being processed" rather than guessed at or left blank. */
    function statusName(k) {
      return {
        received:  t('اتسجّل', 'Received'),
        preparing: t('بيتجهّز', 'Being prepared'),
        shipping:  t('فى الطريق', 'On the way'),
        delivered: t('اتسلّم', 'Delivered'),
        cancelled: t('ملغى', 'Cancelled'),
      }[k] || t('تحت التنفيذ', 'Being processed');
    }
    /* Only the four chip variants app.css actually defines: ok, warn, bad,
       mute. A class that does not exist renders an unstyled chip, which is
       how a status silently loses its colour. */
    function statusChip(k) {
      if (k === 'delivered') return 'chip--ok';
      if (k === 'cancelled') return 'chip--bad';
      if (k === 'shipping' || k === 'preparing') return 'chip--warn';
      return 'chip--mute';
    }
  }

  window.mountAccount = mountAccount;
})();
