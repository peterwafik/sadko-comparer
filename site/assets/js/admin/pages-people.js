/* ============================================================================
   Admin portal: PEOPLE. Customers come from Ecwid; admins and the activity
   log are the site's own.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.ADM, t = A.t, esc = A.esc, I = A.ICON;

  /* =================== customers =================== */
  A.page('customers', {
    group: 'people', icon: 'users', label: ['العملاء', 'Customers'], source: 'ecwid',
    sub: ['عملاء إكويد، مع توضيح من لديه حساب على الموقع.', 'Ecwid\'s customers, marking who also has a website account.'],
    async render(el, ctx) {
      const st = { page: 1, q: '' };
      const e = await A.api('GET', 'ecwid');
      if (ctx.stale()) return;
      const waiting = e.ok && e.customers ? e.customers.pending + e.customers.parked : 0;
      el.innerHTML = (waiting ? '<div class="note note--warn" style="margin-bottom:14px"><b>' + A.num(waiting) + '</b> ' +
          t('حساب على الموقع لم يصل إلى إكويد بعد. ', 'website accounts have not reached Ecwid yet. ') + '<button class="btn btn--sm" id="pushC">' + t('أرسلها الآن', 'Send them now') + '</button></div>' : '') +
        '<div class="toolbar"><input class="input grow" id="q" placeholder="' + t('ابحث بالاسم أو البريد أو الهاتف', 'Search by name, email or phone') + '"></div><div id="list"></div>';
      const push = el.querySelector('#pushC');
      if (push) push.onclick = async () => { push.disabled = true; const r = await A.api('POST', 'ecwid/customers/link', {}); if (A.report(r, t('تم الإرسال إلى إكويد.', 'Sent to Ecwid.'))) A.rerender(); else push.disabled = false; };
      const load = async () => {
        const list = el.querySelector('#list');
        list.innerHTML = A.loading();
        const r = await A.api('GET', 'store/customers?page=' + st.page + '&q=' + encodeURIComponent(st.q));
        if (ctx.stale()) return;
        if (!r.ok) { list.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
        if (!r.customers.length) { list.innerHTML = '<div class="card empty">' + t('لا يوجد عملاء بهذا البحث.', 'No customers match.') + '</div>'; return; }
        list.innerHTML = '<p class="small muted" style="margin:0 0 8px">' + A.num(r.total) + t(' عميل', ' customers') + '</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('الاسم', 'Name') + '</th><th>' +
          t('البريد', 'Email') + '</th><th>' + t('الهاتف', 'Phone') + '</th><th>' + t('الطلبات', 'Orders') + '</th><th>' + t('منذ', 'Since') + '</th><th>' + t('حساب على الموقع', 'Website account') + '</th></tr></thead><tbody>' +
          r.customers.map(c => '<tr class="click" data-email="' + esc(c.email) + '"><td><b>' + esc(c.name || '-') + '</b></td><td class="ltr small">' + esc(c.email) + '</td><td class="ltr small">' + esc(c.phone || '') + '</td>' +
            '<td class="num">' + A.num(c.orders) + '</td><td class="small">' + esc(A.date(c.since)) + '</td><td>' + (c.websiteLogin ? '<span class="chip chip--teal">' + t('نعم', 'Yes') + '</span>' : '') + '</td></tr>').join('') +
          '</tbody></table></div>';
        list.appendChild(A.pager(st.page, r.pages, p => { st.page = p; load(); }));
        list.querySelectorAll('tr[data-email]').forEach(tr => { tr.onclick = () => customer(tr.dataset.email); });
      };
      el.querySelector('#q').oninput = A.debounce(ev => { st.q = ev.target.value.trim(); st.page = 1; load(); }, 400);
      load();
    },
  });
  async function customer(email) {
    const m = A.modal({ title: email, body: A.loading(), actions: false, wide: true });
    const r = await A.api('GET', 'ecwid/customer?email=' + encodeURIComponent(email));
    if (!r.ok) { m.el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
    const c = r.customer || {};
    m.el.innerHTML = '<dl class="kv"><dt>' + t('الاسم', 'Name') + '</dt><dd>' + esc(c.name || '-') + '</dd><dt>' + t('رقم إكويد', 'Ecwid number') + '</dt><dd class="ltr">' + esc(c.id || '-') + '</dd>' +
      '<dt>' + t('منذ', 'Since') + '</dt><dd>' + esc(A.date(c.createDate)) + '</dd></dl>' +
      '<h3 style="font-size:14px;margin:16px 0 8px">' + t('طلباته', 'Their orders') + '</h3>' +
      ((r.orders || []).length ? '<div class="tbl-wrap"><table class="tbl"><tbody>' + r.orders.map(o => '<tr><td class="ltr"><b>' + esc(o.ref || o.number || o.id || '') + '</b></td><td>' + esc(A.date(o.createdAt)) +
        '</td><td class="num">' + A.money(o.total != null ? o.total : o.subtotal) + '</td><td>' + esc(o.status || '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">' + t('لا طلبات.', 'No orders.') + '</p>');
  }

  /* =================== admins (the master's alone) ===================
     The master account cannot be removed, restricted or re-invited here; the
     server refuses it too. Each other admin gets, per section, no access,
     view only, or edit. */
  const SECTION_LABELS = {
    scenes: ['مشاهد الصفحة الرئيسية', 'Home scenes'], ads: ['الإعلانات', 'Ads'], shop: ['صفحة المتجر', 'Shop page'],
    guides: ['دليلك للاختيار', 'Buying guides'], finder: ['أسئلة مساعد الاختيار', 'Finder questions'], site: ['شريط الموقع والخط الساخن', 'Site bar & hotline'],
    orders: ['الطلبات', 'Orders'], products: ['المنتجات', 'Products'], coupons: ['الكوبونات', 'Coupons'], delivery: ['رسوم التوصيل', 'Delivery fees'],
    payments: ['طرق الدفع', 'Payment methods'], customers: ['العملاء', 'Customers'], activity: ['سجل النشاط', 'Activity log'],
  };
  const LEVEL_NAMES = { none: ['لا يرى', 'No access'], view: ['عرض فقط', 'View only'], edit: ['عرض وتعديل', 'View & edit'] };
  function accessSummary(perms, sections) {
    const n = lv => sections.filter(s => (perms[s] || 'none') === lv).length;
    if (n('edit') === sections.length) return '<span class="chip chip--ok">' + t('كل الصلاحيات', 'Full access') + '</span>';
    if (n('none') === sections.length) return '<span class="chip chip--bad">' + t('بدون صلاحيات', 'No access') + '</span>';
    return '<span class="chip chip--teal">' + A.num(n('edit')) + t(' تعديل', ' edit') + '</span> <span class="chip">' + A.num(n('view')) + t(' عرض', ' view') + '</span>';
  }
  /* The access grid: one row per section, three choices, plus quick presets. */
  function accessGrid(perms, sections) {
    return '<div class="chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-preset="edit">' + t('الكل: تعديل', 'All: edit') + '</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-preset="view">' + t('الكل: عرض فقط', 'All: view only') + '</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-preset="none">' + t('الكل: لا يرى', 'All: no access') + '</button></div>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + sections.map(s => '<tr><td><b>' + esc(t(...(SECTION_LABELS[s] || [s, s]))) + '</b></td>' +
        ['none', 'view', 'edit'].map(lv => '<td style="white-space:nowrap"><label class="check" style="font-weight:600"><input type="radio" name="p_' + s + '" value="' + lv + '"' +
          ((perms[s] || 'none') === lv ? ' checked' : '') + '> ' + esc(t(...LEVEL_NAMES[lv])) + '</label></td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }
  function readGrid(box, sections) {
    const out = {};
    sections.forEach(s => { const v = (box.querySelector('input[name="p_' + s + '"]:checked') || {}).value; if (v === 'view' || v === 'edit') out[s] = v; });
    return out;
  }
  function wirePresets(box, sections) {
    box.querySelectorAll('[data-preset]').forEach(b => {
      b.onclick = () => sections.forEach(s => { const r = box.querySelector('input[name="p_' + s + '"][value="' + b.dataset.preset + '"]'); if (r) r.checked = true; });
    });
  }

  A.page('admins', {
    group: 'people', icon: 'shield', label: ['المسؤولون', 'Admins'], source: 'site', perm: 'master',
    sub: ['أنت المسؤول الرئيسى: تدعو المسؤولين، وتحدد ما يراه ويعدله كل منهم، وتحذفهم. لا يستطيع أحد تعديل حسابك.',
          'You are the master admin: you invite admins, decide what each can see and change, and remove them. No one can change your account.'],
    async render(el, ctx) {
      const add = document.createElement('button');
      add.className = 'btn'; add.textContent = '+ ' + t('دعوة مسؤول', 'Invite an admin');
      ctx.actions.append(add);
      const r = await A.api('GET', 'admins');
      if (ctx.stale()) return;
      if (!r.ok) { el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
      // 'guides' is hidden with the Buying guides page (nav.js HIDDEN_PAGES); the
      // server still knows the section, so restoring the page needs no migration.
      const sections = (r.sections || []).filter(s => s !== 'guides');
      add.onclick = () => invite('', sections);
      el.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('البريد', 'Email') + '</th><th>' + t('الدور', 'Role') + '</th><th>' +
        t('الصلاحيات', 'Access') + '</th><th>' + t('الحالة', 'Status') + '</th><th>' + t('آخر دخول', 'Last sign-in') + '</th><th></th></tr></thead><tbody>' +
        r.admins.map(a => {
          const master = a.role === 'master';
          return '<tr><td class="ltr"><b>' + esc(a.email) + '</b>' + (a.email === r.me ? ' <span class="chip chip--teal">' + t('أنت', 'You') + '</span>' : '') + '</td>' +
            '<td>' + (master ? '<span class="chip chip--blue">' + t('المسؤول الرئيسى', 'Master') + '</span>' : '<span class="chip">' + t('مسؤول', 'Admin') + '</span>') + '</td>' +
            '<td>' + (master ? '<span class="chip chip--ok">' + t('كل شىء', 'Everything') + '</span>' : accessSummary(a.perms, sections)) + '</td>' +
            '<td>' + (a.locked ? '<span class="chip chip--bad">' + t('موقوف مؤقتاً', 'Locked') + '</span>' : a.setupDone ? '<span class="chip chip--ok">' + t('مفعّل', 'Active') + '</span>' : '<span class="chip chip--warn">' + t('لم يُكمل الإعداد', 'Setup pending') + '</span>') + '</td>' +
            '<td class="small">' + esc(A.date(a.lastLoginAt, true)) + '</td>' +
            '<td style="white-space:nowrap">' + (master ? '<span class="small muted">' + t('محمى', 'Protected') + '</span>' :
              '<button class="btn btn--ghost btn--sm" data-access="' + esc(a.email) + '">' + I.shield + t('الصلاحيات', 'Access') + '</button> ' +
              '<button class="btn btn--ghost btn--sm" data-reset="' + esc(a.email) + '">' + t('إعادة دعوة', 'Re-invite') + '</button> ' +
              '<button class="btn btn--ghost btn--bad btn--sm" data-del="' + esc(a.email) + '" title="' + t('حذف', 'Remove') + '">' + I.trash + '</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="small muted" style="margin-top:10px">' + t('إعادة الدعوة تصنع كلمة مرور مؤقتة جديدة وتلغى تطبيق المصادقة القديم، وتحتفظ بالصلاحيات. «عرض فقط» يعنى أن المسؤول يرى القسم ولا يغير فيه شيئاً.',
          'Re-inviting makes a new temporary password and clears the old authenticator, keeping the access. "View only" means the admin sees the section but cannot change anything in it.') + '</p>';
      el.querySelectorAll('[data-access]').forEach(b => {
        b.onclick = () => {
          const a = r.admins.find(x => x.email === b.dataset.access);
          const m = A.modal({
            title: t('صلاحيات ', 'Access for ') + a.email, wide: true, body: accessGrid(a.perms, sections),
            actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' }, { label: t('حفظ', 'Save'), run: async box => {
              const x = await A.api('PUT', 'admins/' + encodeURIComponent(a.email) + '/perms', { perms: readGrid(box, sections) });
              if (!A.report(x, t('تم حفظ الصلاحيات. تسرى على طلبه التالى.', 'Access saved. It applies from their next action.'))) return false;
              A.rerender();
            } }],
          });
          wirePresets(m.el, sections);
        };
      });
      el.querySelectorAll('[data-reset]').forEach(b => { b.onclick = () => invite(b.dataset.reset, sections); });
      el.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = async () => {
          if (!(await A.confirm(t('حذف هذا المسؤول؟ لن يستطيع الدخول بعد ذلك.', 'Remove this admin? They will no longer be able to sign in.'), t('حذف', 'Remove'), true))) return;
          if (A.report(await A.api('DELETE', 'admins/' + encodeURIComponent(b.dataset.del)), t('تم الحذف.', 'Removed.'))) A.rerender();
        };
      });
    },
  });
  function invite(email, sections) {
    const fresh = !email;
    const m = A.modal({
      title: fresh ? t('دعوة مسؤول', 'Invite an admin') : t('إعادة دعوة', 'Re-invite'), wide: fresh,
      body: A.field(t('البريد الإلكترونى', 'Email'), A.input('email', email, 'type="email" dir="ltr"' + (email ? ' readonly' : ''))) +
        (fresh ? '<h3 style="font-size:14px;margin:12px 0 8px">' + t('ما الذى يستطيع رؤيته وتعديله؟', 'What can they see and change?') + '</h3>' +
          accessGrid(Object.fromEntries(sections.map(s => [s, 'view'])), sections) : '') +
        '<p class="small muted">' + t('ستظهر كلمة مرور مؤقتة مرة واحدة فقط. أرسلها له بطريقة آمنة. صالحة ٤٨ ساعة.', 'A temporary password is shown once only. Send it to them safely. It lasts 48 hours.') + '</p>',
      actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' }, { label: t('إنشاء كلمة المرور', 'Create the password'), run: async b => {
        const body = { email: A.formData(b).email };
        if (fresh) body.perms = readGrid(b, sections);
        const r = await A.auth('POST', 'invite', body);
        if (!A.report(r)) return false;
        A.modal({
          title: t('كلمة المرور المؤقتة', 'Temporary password'),
          body: '<p style="margin-top:0">' + t('للمسؤول ', 'For ') + '<b class="ltr">' + esc(r.email) + '</b>. ' + t('لن تظهر مرة أخرى.', 'It will not be shown again.') + '</p>' +
            '<div class="secret" id="secret">' + esc(r.tempPassword) + '</div><p class="small muted">' + t('صالحة حتى ', 'Valid until ') + esc(A.date(r.expiresAt, true)) +
            t('. سيُطلب منه اختيار كلمة مرور جديدة وتفعيل تطبيق المصادقة.', '. They will be asked to choose a new password and set up an authenticator app.') + '</p>',
          actions: [{ label: t('نسخ', 'Copy'), kind: 'btn--ghost', run: async () => { try { await navigator.clipboard.writeText(r.tempPassword); A.toast(t('تم النسخ.', 'Copied.')); } catch (e) {} return false; } },
                    { label: t('تم', 'Done'), run: () => { A.rerender(); } }],
        });
      } }],
    });
    if (fresh) wirePresets(m.el, sections);
  }

  /* =================== activity =================== */
  A.page('activity', {
    group: 'people', icon: 'log', label: ['سجل النشاط', 'Activity log'], source: 'site',
    sub: ['كل تغيير تم من هذه البوابة، ومن قام به.', 'Every change made from this portal, and who made it.'],
    async render(el, ctx) {
      const r = await A.api('GET', 'audit?limit=300');
      if (ctx.stale()) return;
      const rows = r.audit || [];
      el.innerHTML = !rows.length ? '<div class="card empty">' + t('لا يوجد نشاط بعد.', 'No activity yet.') + '</div>' :
        '<div class="toolbar"><input class="input grow" id="q" placeholder="' + t('تصفية', 'Filter') + '"></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('الوقت', 'When') + '</th><th>' +
        t('من', 'Who') + '</th><th>' + t('ماذا', 'What') + '</th><th>' + t('على', 'On') + '</th></tr></thead><tbody>' +
        rows.map(x => '<tr><td class="small num">' + esc(A.date(x.at, true)) + '</td><td class="small ltr">' + esc(x.actor || '-') + '</td><td><b>' + esc(A.actionName(x.action)) + '</b></td>' +
          '<td class="small ltr">' + esc(String(x.target || '').slice(0, 60)) + '</td></tr>').join('') + '</tbody></table></div>';
      const q = el.querySelector('#q');
      if (q) q.oninput = () => { const v = q.value.toLowerCase(); el.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(v) ? '' : 'none'; }); };
    },
  });
})();
