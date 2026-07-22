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

    Promise.all([
      A.products().then(list => { brands = [...new Set(list.map(p => { const s = window.skSpecs.of(p); return s.brand && s.brand.en; }).filter(Boolean))].sort(); }).catch(() => {}),
      Au.config().then(c => { cfg = c || cfg; }).catch(() => {}),
    ]).then(() => Au.me(true)).then(render);

    Au.onChange(u => { if (root.dataset.painted) render(u); });

    function render(user) {
      root.dataset.painted = '1';
      if (!Au.available) { root.innerHTML = offline(); return; }
      root.innerHTML = user ? signedIn(user) : signedOut();
      wire(user);
      mountProviderButtons();
      if (location.hash === '#homes' || location.hash === '#home') {
        const el = root.querySelector('#homesBox'); el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function offline() {
      return '<div class="panel"><h2 class="panel__h">' + t('الحسابات مش متاحة دلوقتى', 'Accounts are unavailable right now') + '</h2>' +
        '<div class="note note--warn">' + esc(Au.offlineMsg()) + '</div>' +
        '<p class="muted small mt16">' + t('باقى الموقع شغّال: المقارنة، ساعدنى أختار، الخطط، والمحفوظات. وتقدر كمان تعرّفنا على بيتك من غير حساب — هيتحفظ على جهازك.',
          'The rest of the site still works: comparison, the finder, plans and saved products. You can even describe your home without an account — it is kept on your device.') + '</div>' +
        '<div class="chips mt16"><a class="btn btn--teal" href="' + A.P('finder.html') + '">' + t('ساعدنى أختار', 'Help me choose') + '</a>' +
        '<a class="btn btn--ghost" href="tel:19140">' + t('اطلب بالتليفون 19140', 'Order by phone 19140') + '</a></div></div>' +
        homesPanel(null);
    }

    /* ================= signed out ================= */
    function signedOut() {
      return '<div class="grid2">' +
        '<div class="panel"><h2 class="panel__h">' + t('تسجيل الدخول', 'Sign in') + '</h2>' +
          providerBox() +
          '<form id="loginForm" class="mt16">' +
            field('email', 'email', t('الإيميل', 'Email'), '', 'username') +
            field('password', 'password', t('كلمة السر', 'Password'), '', 'current-password') +
            '<div id="loginErr"></div>' +
            '<button class="btn btn--teal btn--block mt8" type="submit">' + t('دخول', 'Sign in') + '</button>' +
          '</form>' +
          '<p class="muted small mt16">' + t('نسيت كلمة السر؟ كلّم خدمة العملاء على 19140 — لسه مفيش استرجاع أوتوماتيك بالإيميل.',
            'Forgotten your password? Call customer care on 19140 — automatic email reset is not available yet.') + '</p>' +
        '</div>' +
        '<div class="panel"><h2 class="panel__h">' + t('حساب جديد', 'Create an account') + '</h2>' +
          '<p class="panel__sub">' + t('الحساب مطلوب عشان تكمّل الشراء وتتابع طلبك. المطلوب قليل — والباقى اختيارى.',
            'An account is needed to complete a purchase and follow your order. Only a little is required — the rest is optional.') + '</p>' +
          '<form id="regForm">' +
            field('name', 'text', t('الاسم', 'Full name'), '', 'name') +
            field('email', 'email', t('الإيميل', 'Email'), '', 'email') +
            field('phone', 'tel', t('الموبايل', 'Mobile'), t('اختيارى — للتواصل عن الطلب', 'Optional — to contact you about an order'), 'tel') +
            field('password', 'password', t('كلمة السر', 'Password'), t('٨ حروف على الأقل، حروف وأرقام', 'At least 8 characters, letters and numbers'), 'new-password') +
            '<div id="regErr"></div>' +
            '<button class="btn btn--primary btn--block mt16" type="submit">' + t('اعمل حساب', 'Create account') + '</button>' +
            '<p class="muted small mt8">' + t('بإنشاء الحساب أنت موافق على ', 'By creating an account you agree to our ') +
              '<a href="' + A.P('terms.html') + '">' + t('شروط الاستخدام', 'terms') + '</a>' + t(' و', ' and ') +
              '<a href="' + A.P('privacy.html') + '">' + t('سياسة الخصوصية', 'privacy policy') + '</a>.</p>' +
          '</form>' +
        '</div></div>' +
        '<div class="note note--soft mt16 small">' + t(
          'بنحفظ اسمك وإيميلك وموبايلك وعنوان التوصيل وبيانات أماكنك على سيرفر صادكو عشان تقدر تدخل وتطلب. كلمة السر بتتخزّن مشفّرة ومش بنقدر نشوفها. مفيش أى بيانات بطاقة بتتجمع على الموقع ده.',
          'We store your name, email, mobile, delivery address and your places on SADKO\'s server so you can sign in and order. Your password is stored hashed and cannot be read by us. No card details are collected anywhere on this site.') + '</div>' +
        homesPanel(null);
    }

    /* ---- provider buttons, or an honest explanation ---- */
    function providerBox() {
      const usable = (cfg.providers || []).filter(p => p.mode === 'gis');
      if (usable.length) {
        return '<div id="provBox" class="stack">' +
          usable.map(p => '<div class="prov-slot" data-prov="' + esc(p.id) + '" data-client="' + esc(p.clientId) + '"></div>').join('') +
          '<div id="provErr"></div>' +
          '<p class="muted small" style="margin:2px 0 0">' + t('بندخل باسمك وإيميلك بس — مش بنشوف كلمة سر جوجل ولا بنقدر نوصل لأى حاجة تانية فى حسابك.',
            'We receive only your name and email — we never see your Google password and cannot reach anything else in your account.') + '</p>' +
          '<div class="prov-or"><span>' + t('أو', 'or') + '</span></div></div>';
      }
      return '<div class="note note--soft small">' + t(
        'الدخول بحساب جوجل مش مفعّل على النسخة دى. التفعيل مجانى: محتاج Client ID من Google Cloud يتحط فى متغير البيئة GOOGLE_CLIENT_ID وقت التشغيل — الكود جاهز ومتحقق من التوكن على السيرفر.',
        'Google sign-in is not enabled on this deployment. Turning it on is free: it needs a Client ID from Google Cloud set as the GOOGLE_CLIENT_ID environment variable — the code is already here and verifies the token server-side.') + '</div>';
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
          t('مقدرناش نحمّل زرار جوجل (يمكن الشبكة). استخدم الإيميل وكلمة السر.',
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

        homesPanel(u) +

        '<div class="grid2 mt16">' +
          '<div class="panel"><h3 class="panel__h">' + t('بياناتك', 'Your details') + '</h3>' +
            '<form id="detForm">' +
              field('name', 'text', t('الاسم', 'Full name'), '', 'name', u.name) +
              field('phone', 'tel', t('الموبايل', 'Mobile'), '', 'tel', u.phone) +
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
                  t('، فمفيش كلمة سر هنا. لو حبيت كلمة سر، كلّم خدمة العملاء.', ', so there is no password here. If you would like one, contact customer care.') + '</div>') +
          '</div>' +
        '</div>' +

        '<div class="panel mt16" id="ordersBox"><h3 class="panel__h">' + t('طلباتى', 'My orders') + '</h3>' +
          '<p class="muted small">' + t('جارى التحميل…', 'Loading…') + '</p></div>' +

        '<div class="panel mt16"><h3 class="panel__h">' + t('بياناتك وحقك فيها', 'Your data, and your rights over it') + '</h3>' +
          '<p class="panel__sub">' + t('تقدر تاخد نسخة من كل حاجة مسجّلة عندنا، أو تمسح حسابك نهائياً — من غير ما تكلّم حد.',
            'You can take a copy of everything we hold, or delete your account permanently — without having to ask anyone.') + '</p>' +
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
          'ممكن يكون عندك أكتر من مكان — الشقة، شاليه الساحل، أو حتى أوضة لوحدها. اختار المكان الشغّال، وكل صفحات المنتجات هتفلتر على مقاسه.',
          'You can keep more than one place — the flat, a chalet on the coast, or even a single room. Pick the active one and every product page filters to fit it.') + '</p></div>' +
        (homes.length < 8 ? '<button class="btn btn--teal btn--sm" id="addHomeBtn">' + t('+ مكان جديد', '+ Add a place') + '</button>' : '') +
        '</div>' +
        (guest ? '<div class="note note--soft small mt16">' + t(
          'إنت مش مسجّل دخول، فالأماكن دى محفوظة على الجهاز ده. أول ما تعمل حساب هننقلها معاك تلقائياً.',
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
          '<div style="min-width:0"><p class="hm-card__n">' + esc(h.name || t('بيتى', 'My home')) +
            (isActive ? ' <span class="badge">' + t('الشغّال', 'active') + '</span>' : '') + '</p>' +
            '<p class="hm-card__s">' + esc(H.summary(h) || t('لسه مفيش تفاصيل', 'no details yet')) + '</p>' +
            '<p class="hm-card__s">' + t('مكتمل ', 'Completed ') + c.done + '/' + c.total + '</p></div></div>' +
        '<div class="chips">' +
          (isActive ? '' : '<button class="btn btn--ghost btn--sm" data-use="' + esc(h.id) + '">' + t('استخدمه', 'Use this') + '</button>') +
          '<button class="btn btn--quiet btn--sm" data-edit="' + esc(h.id) + '">' + t('عدّل', 'Edit') + '</button>' +
          '<button class="btn btn--quiet btn--sm" data-del="' + esc(h.id) + '" aria-label="' + t('امسح', 'Delete') + '">✕</button>' +
        '</div></div>';
    }

    function presetPicker() {
      return '<div class="note note--info small">' + t('ابدأ بواحد من دول، وتقدر تعدّله بعدين:', 'Start from one of these — you can edit it afterwards:') + '</div>' +
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
        if (r.ok) { msg($('#pwMsg'), 'info', t('اتغيّرت — سجّل دخولك تانى.', 'Changed — please sign in again.')); setTimeout(() => render(null), 1200); }
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
          t('هيتمسح: حسابك، أماكنك، وسجل طلباتك عندنا. الطلبات اللى اتنفذت فعلاً ممكن تفضل فى سجلات صادكو المحاسبية.',
            'This removes your account, your places and your order history here. Orders already fulfilled may remain in SADKO\'s accounting records.') +
          '<label class="field mt16"><span class="field__l">' + t('اكتب إيميلك للتأكيد', 'Type your email to confirm') + '</span>' +
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

    async function loadOrders() {
      const box = root.querySelector('#ordersBox');
      if (!box) return;
      const list = await Au.orders();
      const h = '<h3 class="panel__h">' + t('طلباتى', 'My orders') + '</h3>';
      if (!list.length) {
        box.innerHTML = h + '<p class="muted small">' + t('لسه مفيش طلبات.', 'No orders yet.') + '</p>' +
          '<a class="btn btn--teal btn--sm mt8" href="' + A.P('shop.html') + '">' + t('اتفضل على المتجر', 'Browse the shop') + '</a>';
        return;
      }
      box.innerHTML = h + '<div style="overflow-x:auto"><table class="tbl tbl--rows"><thead><tr>' +
        ['#', t('التاريخ', 'Date'), t('الأصناف', 'Items'), t('الإجمالى', 'Subtotal'), t('الدفع', 'Payment'), t('الحالة', 'Status')]
          .map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
        list.map(o => '<tr><td class="ltr"><b>' + esc(o.ref) + '</b></td><td>' + esc(A.date(o.createdAt)) + '</td>' +
          '<td>' + A.num(o.items.reduce((n, i) => n + i.qty, 0)) + '</td><td>' + A.money(o.subtotal) + '</td>' +
          '<td>' + esc(payName(o.payment)) + '</td>' +
          '<td><span class="chip chip--mute">' + t('اتسجّل', 'Received') + '</span></td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="note note--soft small mt16">' + t(
          'الطلب اتسجّل عندنا وخدمة العملاء هتتواصل معاك على 19140 لتأكيد التوصيل والتركيب ورسومهم. مفيش دفع أونلاين بالبطاقة على النسخة دى.',
          'Your order is recorded and customer care will contact you on 19140 to confirm delivery, installation and their charges. Online card payment is not available on this version.') + '</div>';
    }
    function payName(k) {
      return { cod: t('الدفع عند الاستلام', 'Cash on delivery'), bank: t('تحويل بنكى', 'Bank transfer'),
               showroom: t('الدفع فى المعرض', 'Pay at a showroom') }[k] || k;
    }
  }

  window.mountAccount = mountAccount;
})();
