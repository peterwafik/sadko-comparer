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

  /* =================== admins =================== */
  A.page('admins', {
    group: 'people', icon: 'shield', label: ['المسؤولون', 'Admins'], source: 'site',
    sub: ['من يستطيع دخول هذه البوابة. كل مسؤول يدخل بكلمة مرور وتطبيق مصادقة.', 'Who can sign in here. Every admin uses a password and an authenticator app.'],
    async render(el, ctx) {
      const add = document.createElement('button');
      add.className = 'btn'; add.textContent = '+ ' + t('دعوة مسؤول', 'Invite an admin');
      add.onclick = () => invite('');
      ctx.actions.append(add);
      const r = await A.api('GET', 'admins');
      if (ctx.stale()) return;
      el.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('البريد', 'Email') + '</th><th>' + t('الحالة', 'Status') + '</th><th>' + t('آخر دخول', 'Last sign-in') + '</th><th>' +
        t('دعاه', 'Invited by') + '</th><th></th></tr></thead><tbody>' +
        r.admins.map(a => '<tr><td class="ltr"><b>' + esc(a.email) + '</b>' + (a.email === r.me ? ' <span class="chip chip--teal">' + t('أنت', 'You') + '</span>' : '') + '</td>' +
          '<td>' + (a.locked ? '<span class="chip chip--bad">' + t('موقوف مؤقتاً', 'Locked') + '</span>' : a.setupDone ? '<span class="chip chip--ok">' + t('مفعّل', 'Active') + '</span>' : '<span class="chip chip--warn">' + t('لم يُكمل الإعداد', 'Setup pending') + '</span>') + '</td>' +
          '<td class="small">' + esc(A.date(a.lastLoginAt, true)) + '</td><td class="small ltr">' + esc(a.createdBy || '-') + '</td>' +
          '<td style="white-space:nowrap">' + (a.email === r.me ? '' : '<button class="btn btn--ghost btn--sm" data-reset="' + esc(a.email) + '">' + t('إعادة دعوة', 'Re-invite') + '</button> ' +
            '<button class="btn btn--ghost btn--bad btn--sm" data-del="' + esc(a.email) + '">' + I.trash + '</button>') + '</td></tr>').join('') + '</tbody></table></div>' +
        '<p class="small muted" style="margin-top:10px">' + t('إعادة الدعوة تصنع كلمة مرور مؤقتة جديدة وتلغى تطبيق المصادقة القديم، لمن نسى كلمته أو فقد هاتفه.', 'Re-inviting makes a new temporary password and clears the old authenticator, for anyone who forgot their password or lost their phone.') + '</p>';
      el.querySelectorAll('[data-reset]').forEach(b => { b.onclick = () => invite(b.dataset.reset); });
      el.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = async () => {
          if (!(await A.confirm(t('حذف هذا المسؤول؟ لن يستطيع الدخول بعد ذلك.', 'Remove this admin? They will no longer be able to sign in.'), t('حذف', 'Remove'), true))) return;
          if (A.report(await A.api('DELETE', 'admins/' + encodeURIComponent(b.dataset.del)), t('تم الحذف.', 'Removed.'))) A.rerender();
        };
      });
    },
  });
  function invite(email) {
    A.modal({
      title: email ? t('إعادة دعوة', 'Re-invite') : t('دعوة مسؤول', 'Invite an admin'),
      body: A.field(t('البريد الإلكترونى', 'Email'), A.input('email', email, 'type="email" dir="ltr"' + (email ? ' readonly' : ''))) +
        '<p class="small muted">' + t('ستظهر كلمة مرور مؤقتة مرة واحدة فقط. أرسلها له بطريقة آمنة. صالحة ٤٨ ساعة.', 'A temporary password is shown once only. Send it to them safely. It lasts 48 hours.') + '</p>',
      actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' }, { label: t('إنشاء كلمة المرور', 'Create the password'), run: async b => {
        const r = await A.auth('POST', 'invite', { email: A.formData(b).email });
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
