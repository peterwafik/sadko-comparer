/* ============================================================================
   SADKO checkout — turns the cart into a real, recorded order.
   ----------------------------------------------------------------------------
   PAYMENT, STATED PLAINLY: the methods come from Ecwid (GET /api/payment-methods)
   — cash on delivery plus the Egyptian instalment services SADKO has set up:
   ValU, Souhoola, Fawry, Mogo, SEVEN, Forsa and two National Bank plans. Every
   one is an OFFLINE method: the order records which the customer chose and
   staff follow up, per the Arabic instructions Ecwid carries for each. With
   Ecwid off the built-in three are used instead.
   It does NOT ask for a card number, and there is no
   hidden card form anywhere in this codebase. Accepting cards requires a
   PCI-compliant gateway (Paymob or Fawry, locally) that takes the customer to
   the provider's own hosted page; that integration does not exist yet, so a
   card form here would be collecting payment details under false pretences.
   The card option is therefore shown as unavailable, with the reason.

   The totals shown are the goods subtotal only. Delivery and installation
   depend on the product and the address, and customer care confirms them — so
   they are displayed as "تؤكده خدمة العملاء", never as 0.
   ========================================================================== */
(function () {
  'use strict';

  function mountCheckout(root) {
    const A = window.skApp, t = A.t, esc = A.esc, Au = window.skAuth;

    /* Ecwid's list, fetched once. If the request fails — offline, or the
       endpoint missing on an older server — the built-in three below are used,
       so checkout always works. */
    let LIVE = null;
    function loadPayments() {
      return fetch(A.P('api/payment-methods'))
        .then(r => (r.ok ? r.json() : null))
        .then(d => { LIVE = (d && Array.isArray(d.methods) && d.methods.length) ? d.methods : null; })
        .catch(() => { LIVE = null; });
    }

    /* Basket titles drive the eligibility hint on a restricted plan. The
       catalogue has no brand field, so this reads titles — guidance for the
       customer, never a block: customer care confirms on the call they
       already make. */
    function basketHint(m) {
      if (!m.restricted || !m.brandKey) return null;
      var titles = (window.skCart.items() || []).map(function (i) { return String(i.title || ''); }).join(' ');
      var norm = titles.replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[\u0622\u0623\u0625\u0627]/g, '\u0627')
        .replace(/\u0649/g, '\u064A').replace(/\u0629/g, '\u0647');
      if (!norm.trim()) return null;
      return norm.indexOf(m.brandKey) === -1 ? 'unlikely' : null;
    }

    /* Ecwid's methods, shaped like the built-in ones. No English titles: the
       store holds no usable translations, and the method name is what the
       customer will be told on the phone anyway. */
    function fromLive() {
      return LIVE.map(function (m) {
        var hint = basketHint(m);
        var d = m.instructions || '';
        if (m.restricted) {
          d = (d ? d + ' — ' : '') + t('متاح على منتجات ' + (m.brand || '') + ' فقط، وتؤكده خدمة العملاء.',
                                       'Available on ' + (m.brandEn || m.brand || '') + ' products only; customer care confirms.');
        }
        if (hint === 'unlikely') {
          d += ' ' + t('لا يبدو أن سلتك تحتوى على منتجات ' + (m.brand || '') + ' — راجع خدمة العملاء قبل الاختيار.',
                       'Your basket does not appear to contain ' + (m.brandEn || m.brand || '') + ' products — check with customer care first.');
        }
        return { k: m.id, l: m.title, d: d, ok: true, warn: hint === 'unlikely' };
      }).concat([CARD_NOTE()]);
    }

    /* The card row is not a method — it exists to say plainly that cards are
       not accepted, so nobody hunts for a field that is deliberately absent. */
    const CARD_NOTE = () => ({ k: 'card', l: t('بطاقة أونلاين', 'Online card payment'),
      d: t('غير متاح بعد فى هذه النسخة — فالدفع بالبطاقة يتطلب بوابة دفع معتمدة (مثل باي موب أو فورى)، ولذلك لا نطلب بيانات بطاقة هنا البتة.',
           'Not available on this version — card payment needs a certified gateway (such as Paymob or Fawry), which is why we do not ask for card details here at all.'), ok: false });

    const BUILTIN = () => [
      { k: 'cod', l: t('الدفع عند الاستلام', 'Cash on delivery'),
        d: t('بتدفع للمندوب وقت التسليم. متاح داخل مناطق التوصيل.', 'Pay the courier on delivery. Available inside our delivery areas.'), ok: true },
      { k: 'bank', l: t('تحويل بنكى', 'Bank transfer'),
        d: t('سترسل لك خدمة العملاء بيانات الحساب بعد تأكيد الطلب.', 'Customer care will send you the account details after confirming the order.'), ok: true },
      { k: 'showroom', l: t('الدفع فى المعرض', 'Pay at a showroom'),
        d: t('تعاين الجهاز وتدفع فى أقرب معرض، والتوصيل من هناك.', 'Inspect the appliance and pay at your nearest showroom; delivery follows from there.'), ok: true },
      CARD_NOTE(),
    ];

    const PAYMENTS = () => (LIVE ? fromLive() : BUILTIN());

    /* Delivery: the governorate list and the fee both come from the server,
       which prices the order with the same function (engine/delivery-order.mjs).
       This page never adds a delivery figure up itself. */
    let GOVS = null, QUOTE = null;
    function loadGovernorates() {
      return fetch('/api/delivery/governorates').then(r => r.ok ? r.json() : null)
        .then(d => { GOVS = d && d.governorates; }).catch(() => { GOVS = null; });
    }
    function requestQuote(items, governorate) {
      if (!governorate) { QUOTE = null; return Promise.resolve(null); }
      return fetch('/api/delivery/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ governorate, items: items.map(i => ({ id: i.id, qty: i.qty })) }) })
        .then(r => r.ok ? r.json() : null)
        .then(d => { QUOTE = (d && d.quote) || null; return QUOTE; })
        .catch(() => { QUOTE = null; return null; });
    }

    Promise.all([Au.me(true), loadPayments(), loadGovernorates()]).then(function (r) { render(r[0]); });

    /* Set when a signed-out visitor chooses to carry on without an account.
       Starts TRUE: the account is the detour, not the default. */
    let GUEST = true;

    function render(user) {
      const items = window.skCart.items();
      if (!items.length) {
        root.innerHTML = '<div class="panel">' + A.empty(
          t('سلتك فارغة.', 'Your cart is empty.'), t('اتفضل على المتجر', 'Browse the shop'), A.P('shop.html')) + '</div>';
        return;
      }
      if (!Au.available) { root.innerHTML = offlineBox(items); return; }
      if (!user) {
        /* Guest by default. Requiring an account to buy a refrigerator loses
           the sale, and SADKO already takes orders from people with no
           account every day on 19140 — this is the same transaction. */
        if (GUEST) { root.innerHTML = form(null, items); wire(null, items); return; }
        root.innerHTML = needSignIn(items); wireSummaryOnly(); return;
      }
      root.innerHTML = form(user, items);
      wire(user, items);
    }

    /* ---- cart summary, reused by every state ---- */
    function summary(items) {
      const subtotal = items.reduce((n, i) => n + (i.price || 0) * i.qty, 0);
      return '<div class="panel"><h2 class="panel__h">' + t('ملخص الطلب', 'Order summary') + '</h2>' +
        '<ul class="specs">' + items.map(i =>
          '<li><span class="k">' + esc(String(i.title).replace(/&nbsp;/g, ' ').slice(0, 60)) +
          (i.qty > 1 ? ' × ' + A.num(i.qty) : '') + '</span><span class="v">' + A.money((i.price || 0) * i.qty) + '</span></li>').join('') +
        '<li><span class="k"><b>' + t('إجمالى الأجهزة', 'Goods subtotal') + '</b></span><span class="v"><b>' + A.money(subtotal) + '</b></span></li>' +
        deliveryRows(subtotal) +
        '</ul>' +
        '<div class="note note--soft small mt16">' + (QUOTE && QUOTE.quotable
          ? t('رسوم التوصيل محسوبة من أسعار الشحن لمنطقتك وحجم كل جهاز. رسوم التركيب تُؤكَّد معك قبل التنفيذ.',
              'Delivery is calculated from the shipping rates for your area and the size of each appliance. Installation is confirmed with you before fulfilment.')
          : t('تختلف رسوم التوصيل والتركيب بحسب الجهاز والعنوان، وتُؤكَّد معك قبل التنفيذ — ولذلك لا نعرضها هنا صفراً.',
              'Delivery and installation charges depend on the appliance and your address and are confirmed with you before fulfilment — which is why we do not show them as zero here.')) + '</div>' +
        '</div>';
    }

    /* The delivery, installation and total rows. Every figure is the SERVER's
       quote (engine/delivery-order.mjs) — this page never adds one up. With no
       governorate yet it asks for one; with no automatic fee (Sinai, or a
       product it cannot class) customer care confirms, as before. */
    let CHOSEN_GOV = '';
    const BAND = { small: ['منتجات صغيرة', 'Small items'], medium: ['منتجات متوسطة', 'Medium items'],
                   large: ['منتجات كبيرة', 'Large items'], xl: ['منتجات كبيرة جدا', 'Extra-large items'],
                   craft: ['حرف يدوية', 'Handicrafts'] };
    function deliveryRows(subtotal) {
      const install = '<li><span class="k">' + t('التركيب', 'Installation') + '</span><span class="v unknown">' + t('تؤكده خدمة العملاء', 'confirmed by customer care') + '</span></li>';
      if (!QUOTE || !QUOTE.quotable) {
        const why = !CHOSEN_GOV ? t('اختر المحافظة لحساب التوصيل', 'choose your governorate') : t('تؤكده خدمة العملاء', 'confirmed by customer care');
        return '<li><span class="k">' + t('التوصيل', 'Delivery') + '</span><span class="v unknown">' + why + '</span></li>' + install;
      }
      /* A breakdown the customer can read — the per-order charge, then each
         size band and what it adds — rather than Ecwid's full method titles,
         which carry product lists in brackets. The full title goes to Ecwid. */
      const byBand = {};
      (QUOTE.lines || []).forEach(l => { if (l.fee > 0) byBand[l.cls] = (byBand[l.cls] || 0) + l.fee; });
      const parts = (QUOTE.perOrder || []).filter(p => p.fee > 0).map(p =>
          (/حرف/.test(p.title) ? t('حرف يدوية', 'Handicrafts') : t('رسوم الطلب', 'Per order')) + ' ' + A.money(p.fee))
        .concat(Object.keys(byBand).map(c => (BAND[c] ? t(BAND[c][0], BAND[c][1]) : c) + ' ' + A.money(byBand[c])));
      return '<li><span class="k">' + t('التوصيل إلى ', 'Delivery to ') + esc(CHOSEN_GOV) +
          (parts.length ? '<br><small class="muted">' + esc(parts.join(' · ')) + '</small>' : '') +
          '</span><span class="v">' + A.money(QUOTE.fee) + '</span></li>' +
        (QUOTE.notes && QUOTE.notes[0] ? '<li><span class="k small muted">' + esc(QUOTE.notes[0]) + '</span><span class="v"></span></li>' : '') +
        install +
        '<li class="total"><span class="k"><b>' + t('الإجمالى', 'Total') + '</b></span><span class="v"><b>' + A.money(subtotal + QUOTE.fee) + '</b></span></li>';
    }

    function offlineBox(items) {
      return '<div class="panel"><h2 class="panel__h">' + t('الطلب عبر الإنترنت غير متاح حالياً', 'Online ordering is unavailable right now') + '</h2>' +
        '<div class="note note--warn">' + esc(Au.offlineMsg()) + '</div>' +
        '<p class="mt16">' + t('يمكنك الطلب الآن هاتفياً ونحن نُتم معك:', 'You can order by phone right now and we will take it from there:') + '</p>' +
        '<div class="chips"><a class="btn btn--primary" href="tel:19140">' + t('اتصل 19140', 'Call 19140') + '</a>' +
        '<a class="btn btn--ghost" href="' + A.P('cart.html') + '">' + t('ارجع للسلة', 'Back to cart') + '</a></div></div>' + summary(items);
    }

    function needSignIn(items) {
      return '<div class="grid2"><div class="panel"><h2 class="panel__h">' + t('سجّل دخولك لإتمام الطلب', 'Sign in to complete your order') + '</h2>' +
        '<p class="panel__sub">' + t('نحتاج حساباً لتسجيل الطلب باسمك ولتتمكن من متابعته، ولحفظ عنوان التوصيل للمرات القادمة.',
          'We need an account so the order is recorded in your name, you can follow it, and your delivery address is saved for next time.') + '</p>' +
        '<div class="chips"><a class="btn btn--primary" href="' + A.P('account.html') + '">' + t('دخول أو حساب جديد', 'Sign in or create an account') + '</a>' +
        '<a class="btn btn--ghost" href="tel:19140">' + t('أو اطلب هاتفياً 19140', 'Or order by phone 19140') + '</a></div>' +
        '<p class="muted small mt16">' + t('سلتك محفوظة، ولن تضيع.', 'Your cart is saved and will not be lost.') + '</p></div>' +
        summary(items) + '</div>';
    }

    /* ---- the real form ---- */
    function form(u, items) {
      /* u is null for a guest. Everything below reads through these, so the
         one form serves both and cannot drift into two. */
      const guest = !u;
      const p = (u && u.profile) || {};
      return '<div class="grid2"><div>' +
        (guest ? '<div class="panel"><p class="panel__sub" style="margin:0">' +
            t('بتكمّل كزائر — من غير حساب. لو عندك حساب، ',
              'You are checking out as a guest, with no account. If you have an account, ') +
            '<a href="' + A.P('account.html') + '">' + t('سجّل دخولك', 'sign in') + '</a>' +
            t(' وهتلاقى عنوانك محفوظاً وتقدر تتابع طلباتك.',
              ' to have your address remembered and to follow your orders.') +
          '</p></div>' : '') +
        '<div class="panel"><h2 class="panel__h">' + t('بيانات التوصيل', 'Delivery details') + '</h2>' +
          '<form id="coForm">' +
            '<div class="row">' +
              lbl('name', t('الاسم', 'Name'), (u && u.name) || '') +
              lbl('phone', t('الهاتف المحمول', 'Mobile'), (u && u.phone) || '') +
            '</div>' +
            /* A guest has no account to take an email from, and Ecwid files
               the order — and the customer record staff search — under it. */
            (guest ? '<label class="field"><span class="field__l">' + t('البريد الإلكترونى', 'Email') +
                '</span><input class="input" type="email" name="email" required autocomplete="email" dir="ltr">' +
                '<span class="field__h">' + t('عليه نسجّل الطلب ونرسل تأكيده.',
                  'The order is filed under this, and the confirmation goes to it.') + '</span></label>' : '') +
            '<label class="field"><span class="field__l">' + t('المحافظة', 'Governorate') + '</span>' +
              /* All governorates, from the server (engine/shipping-regions.mjs).
                 A saved value no longer in the list — the old «أخرى» — leaves
                 nothing selected, so the customer picks a real one. If the list
                 could not load, the three metro areas keep checkout working. */
              '<select class="select" name="governorate" required><option value="">' + t('اختر المحافظة', 'Choose governorate') + '</option>' +
              (GOVS || [{ ar: 'القاهرة', en: 'Cairo' }, { ar: 'الجيزة', en: 'Giza' }, { ar: 'الإسكندرية', en: 'Alexandria' }])
                .map(g => '<option value="' + esc(g.ar) + '"' + (p.governorate === g.ar ? ' selected' : '') + '>' + esc(t(g.ar, g.en)) + '</option>').join('') +
              '</select></label>' +
            '<label class="field"><span class="field__l">' + t('العنوان بالتفصيل', 'Full address') + '</span>' +
              '<textarea class="textarea" name="address" maxlength="300" required>' + esc((u && u.address) || '') + '</textarea></label>' +
            '<div class="row">' +
              lbl('floor', t('الدور', 'Floor'), p.floor || '') +
              '<label class="field"><span class="field__l">' + t('فيه أسانسير؟', 'Is there a lift?') + '</span>' +
                '<select class="select" name="hasLift"><option value="yes"' + (p.hasLift ? ' selected' : '') + '>' + t('نعم', 'Yes') + '</option>' +
                '<option value="no"' + (p.hasLift ? '' : ' selected') + '>' + t('لا', 'No') + '</option></select></label>' +
            '</div>' +
            '<label class="field"><span class="field__l">' + t('ملاحظات للمندوب (اختيارى)', 'Notes for the courier (optional)') + '</span>' +
              '<textarea class="textarea" name="note" maxlength="500" style="min-height:66px"></textarea></label>' +

            '<h3 class="panel__h mt24">' + t('طريقة الدفع', 'Payment method') + '</h3>' +
            '<div class="stack">' + PAYMENTS().map((m, i) =>
              '<label class="co-pay' + (m.ok ? '' : ' is-off') + '">' +
                '<input type="radio" name="payment" value="' + m.k + '"' + (m.ok && i === 0 ? ' checked' : '') + (m.ok ? '' : ' disabled') + '>' +
                '<span><b>' + esc(m.l) + (m.ok ? '' : ' <em class="badge">' + t('غير متاح', 'unavailable') + '</em>') +
                  /* A restricted plan the basket does not appear to qualify for
                     stays selectable — customer care confirms on the call they
                     already make — but it says so, so the choice is informed. */
                  (m.warn ? ' <em class="badge badge--warn">' + t('راجع خدمة العملاء', 'check first') + '</em>' : '') + '</b>' +
                '<i>' + esc(m.d) + '</i></span></label>').join('') + '</div>' +

            '<div id="coErr"></div>' +
            '<button class="btn btn--primary btn--block mt16" type="submit">' + t('أكّد الطلب', 'Place the order') + '</button>' +
            '<p class="muted small mt8">' + t('بتأكيد الطلب تسجّله لدينا، وستتصل بك خدمة العملاء على 19140 لتأكيد المواعيد ورسوم التوصيل والتركيب قبل أى تنفيذ.',
              'Placing the order records it with us; customer care will call you on 19140 to confirm timing and the delivery and installation charges before anything is fulfilled.') + '</p>' +
          '</form></div></div>' +
        '<div id="coSummary">' + summary(items) + '</div></div>';
    }
    function lbl(name, label, value) {
      return '<label class="field" style="margin:0 0 14px"><span class="field__l">' + esc(label) + '</span>' +
        '<input class="input" name="' + name + '" value="' + esc(value || '') + '" required></label>';
    }

    function wireSummaryOnly() {}

    /* The guest post. Returns the same { ok, order } shape the account path
       returns, so done() renders one confirmation screen for both.

       A push that did not reach Ecwid is still ok:true — the order is queued
       and retries, and customer care rings either way. Telling a customer
       their order failed when it is safely recorded would lose a sale that
       was made. */
    async function placeGuestOrder(payload) {
      try {
        /* An ABSOLUTE path, like skAuth uses. A.P() would make it relative,
           which resolves wrongly from the generated /category/*.html pages. */
        const res = await fetch('/api/orders/guest?lang=' + (A.EN ? 'en' : 'ar'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ok) return { ok: false, message: d.message || '', error: d.error, quote: d.quote };
        return { ok: true, order: { ref: d.ref, subtotal: d.subtotal, payment: payload.payment,
                                    totals: d.totals, inEcwid: d.inEcwid } };
      } catch (e) {
        return { ok: false, message: '' };
      }
    }

    function wire(user, items) {
      const f = root.querySelector('#coForm');
      if (!f) return;

      /* Re-quote whenever the governorate changes, and redraw only the summary
         so nothing the customer typed is lost. */
      const box = () => root.querySelector('#coSummary');
      const gov = f.querySelector('select[name=governorate]');
      const refresh = () => {
        CHOSEN_GOV = gov.value;
        return requestQuote(items, gov.value).then(() => { if (box()) box().innerHTML = summary(items); });
      };
      gov.addEventListener('change', refresh);
      if (gov.value) refresh();

      f.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(f);
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = t('جارى التسجيل…', 'Recording…');
        const lines = items.map(i => ({ id: i.id, title: i.title, price: i.price, qty: i.qty, image: i.image }));
        const r = user
          ? await Au.placeOrder({
              items: lines,
              payment: fd.get('payment') || 'cod',
              delivery: { name: fd.get('name'), phone: fd.get('phone'), governorate: fd.get('governorate'),
                          address: fd.get('address'), floor: fd.get('floor'), hasLift: fd.get('hasLift') === 'yes' },
              note: fd.get('note'),
              quotedFee: QUOTE && QUOTE.quotable ? QUOTE.fee : null,
            })
          : await placeGuestOrder({
              items: lines,
              payment: fd.get('payment') || 'cod',
              name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'),
              governorate: fd.get('governorate'), address: fd.get('address'),
              floor: fd.get('floor'), hasLift: fd.get('hasLift') === 'yes',
              note: fd.get('note'),
              quotedFee: QUOTE && QUOTE.quotable ? QUOTE.fee : null,
            });
        btn.disabled = false; btn.textContent = t('أكّد الطلب', 'Place the order');
        /* The server's fee differs from the one shown (a rate changed, or this
           tab is older than the fee). Show the new one and let them confirm. */
        if (!r.ok && r.error === 'delivery-fee-changed') {
          QUOTE = r.quote || null;
          if (box()) box().innerHTML = summary(items);
          root.querySelector('#coErr').innerHTML = '<div class="note note--warn mt8 small">' + esc(r.message) + '</div>';
          return;
        }
        if (!r.ok) {
          root.querySelector('#coErr').innerHTML = '<div class="note note--warn mt8 small">' +
            esc(r.message || t('تعذّر تسجيل الطلب.', 'Could not record the order.')) + '</div>';
          return;
        }
        // Keep the address for next time — only meaningful for an account.
        if (user) Au.saveProfile({ address: fd.get('address'),
                         profile: { governorate: fd.get('governorate'), floor: fd.get('floor'), hasLift: fd.get('hasLift') === 'yes' } });
        window.skCart.clear();
        done(r.order);
      });
    }

    function done(o) {
      root.innerHTML = '<div class="panel" style="max-width:680px;margin:0 auto;text-align:center">' +
        '<h2 class="panel__h" style="justify-content:center">' + t('تم تسجيل طلبك', 'Your order is recorded') + '</h2>' +
        '<p style="font:900 1.6rem Cairo,sans-serif;color:var(--accent);margin:14px 0" class="ltr">' + esc(o.ref) + '</p>' +
        '<p class="muted">' + t('احتفظ برقم الطلب هذا. وستتواصل معك خدمة العملاء على الرقم الذى سجّلته لتأكيد المواعيد ورسوم التوصيل والتركيب.',
          'Keep this order reference. Customer care will contact you on the number you gave to confirm timing and the delivery and installation charges.') + '</p>' +
        '<ul class="specs mt16" style="text-align:start">' +
          '<li><span class="k">' + t('إجمالى الأجهزة', 'Goods subtotal') + '</span><span class="v">' + A.money(o.subtotal) + '</span></li>' +
          '<li><span class="k">' + t('طريقة الدفع', 'Payment') + '</span><span class="v">' + esc(payName(o.payment)) + '</span></li>' +
          (o.totals && o.totals.deliveryFee != null
            ? '<li><span class="k">' + t('التوصيل', 'Delivery') + '</span><span class="v">' + A.money(o.totals.deliveryFee) + '</span></li>' +
              '<li><span class="k">' + t('التركيب', 'Installation') + '</span><span class="v unknown">' + t('يُؤكَّد هاتفياً', 'confirmed by phone') + '</span></li>' +
              '<li><span class="k"><b>' + t('الإجمالى', 'Total') + '</b></span><span class="v"><b>' + A.money(o.totals.grandTotal) + '</b></span></li>'
            : '<li><span class="k">' + t('التوصيل والتركيب', 'Delivery & installation') + '</span><span class="v unknown">' + t('يُؤكَّد هاتفياً', 'confirmed by phone') + '</span></li>') +
        '</ul>' +
        '<div class="chips mt24" style="justify-content:center">' +
          '<a class="btn btn--teal" href="' + A.P('account.html') + '">' + t('اعرض طلباتى', 'View my orders') + '</a>' +
          '<a class="btn btn--ghost" href="' + A.P('appliances.html') + '">' + t('ضيفه لأجهزتى', 'Add to my appliances') + '</a>' +
          '<a class="btn btn--ghost" href="tel:19140">' + t('اتصل 19140', 'Call 19140') + '</a>' +
        '</div></div>';
    }
    function payName(k) {
      /* An Ecwid method id is not human-readable, so the receipt looks the
         chosen method up in whatever list was offered rather than printing a
         raw id at the customer. */
      var hit = (LIVE || []).find(function (m) { return m.id === k; });
      if (hit) return hit.title;
      return { cod: t('الدفع عند الاستلام', 'Cash on delivery'), bank: t('تحويل بنكى', 'Bank transfer'),
               showroom: t('الدفع فى المعرض', 'Pay at a showroom') }[k] || k;
    }
  }

  window.mountCheckout = mountCheckout;
})();
