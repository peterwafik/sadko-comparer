/* ============================================================================
   SADKO checkout — turns the cart into a real, recorded order.
   ----------------------------------------------------------------------------
   PAYMENT, STATED PLAINLY: this page offers cash on delivery, bank transfer and
   paying at a showroom. It does NOT ask for a card number, and there is no
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

    const PAYMENTS = () => [
      { k: 'cod', l: t('الدفع عند الاستلام', 'Cash on delivery'),
        d: t('بتدفع للمندوب وقت التسليم. متاح داخل مناطق التوصيل.', 'Pay the courier on delivery. Available inside our delivery areas.'), ok: true },
      { k: 'bank', l: t('تحويل بنكى', 'Bank transfer'),
        d: t('سترسل لك خدمة العملاء بيانات الحساب بعد تأكيد الطلب.', 'Customer care will send you the account details after confirming the order.'), ok: true },
      { k: 'showroom', l: t('الدفع فى المعرض', 'Pay at a showroom'),
        d: t('تعاين الجهاز وتدفع فى أقرب معرض، والتوصيل من هناك.', 'Inspect the appliance and pay at your nearest showroom; delivery follows from there.'), ok: true },
      { k: 'card', l: t('بطاقة أونلاين', 'Online card payment'),
        d: t('غير متاح بعد فى هذه النسخة — فالدفع بالبطاقة يتطلب بوابة دفع معتمدة (مثل باي موب أو فورى)، ولذلك لا نطلب بيانات بطاقة هنا البتة.',
             'Not available on this version — card payment needs a certified gateway (such as Paymob or Fawry), which is why we do not ask for card details here at all.'), ok: false },
    ];

    Au.me(true).then(render);

    function render(user) {
      const items = window.skCart.items();
      if (!items.length) {
        root.innerHTML = '<div class="panel">' + A.empty(
          t('سلتك فارغة.', 'Your cart is empty.'), t('اتفضل على المتجر', 'Browse the shop'), A.P('shop.html')) + '</div>';
        return;
      }
      if (!Au.available) { root.innerHTML = offlineBox(items); return; }
      if (!user) { root.innerHTML = needSignIn(items); wireSummaryOnly(); return; }
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
        '<li><span class="k">' + t('التوصيل', 'Delivery') + '</span><span class="v unknown">' + t('تؤكده خدمة العملاء', 'confirmed by customer care') + '</span></li>' +
        '<li><span class="k">' + t('التركيب', 'Installation') + '</span><span class="v unknown">' + t('تؤكده خدمة العملاء', 'confirmed by customer care') + '</span></li>' +
        '</ul>' +
        '<div class="note note--soft small mt16">' + t(
          'تختلف رسوم التوصيل والتركيب بحسب الجهاز والعنوان، وتُؤكَّد معك قبل التنفيذ — ولذلك لا نعرضها هنا صفراً.',
          'Delivery and installation charges depend on the appliance and your address and are confirmed with you before fulfilment — which is why we do not show them as zero here.') + '</div></div>';
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
      const p = u.profile || {};
      return '<div class="grid2"><div>' +
        '<div class="panel"><h2 class="panel__h">' + t('بيانات التوصيل', 'Delivery details') + '</h2>' +
          '<form id="coForm">' +
            '<div class="row">' +
              lbl('name', t('الاسم', 'Name'), u.name) +
              lbl('phone', t('الهاتف المحمول', 'Mobile'), u.phone) +
            '</div>' +
            '<label class="field"><span class="field__l">' + t('المحافظة', 'Governorate') + '</span>' +
              '<select class="select" name="governorate">' +
              ['القاهرة|Cairo', 'الجيزة|Giza', 'الإسكندرية|Alexandria', 'الساحل الشمالى|North Coast', 'أخرى|Other']
                .map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '"' + (p.governorate === a ? ' selected' : '') + '>' + esc(t(a, e)) + '</option>'; }).join('') +
              '</select></label>' +
            '<label class="field"><span class="field__l">' + t('العنوان بالتفصيل', 'Full address') + '</span>' +
              '<textarea class="textarea" name="address" maxlength="300" required>' + esc(u.address || '') + '</textarea></label>' +
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
                '<span><b>' + esc(m.l) + (m.ok ? '' : ' <em class="badge">' + t('غير متاح', 'unavailable') + '</em>') + '</b>' +
                '<i>' + esc(m.d) + '</i></span></label>').join('') + '</div>' +

            '<div id="coErr"></div>' +
            '<button class="btn btn--primary btn--block mt16" type="submit">' + t('أكّد الطلب', 'Place the order') + '</button>' +
            '<p class="muted small mt8">' + t('بتأكيد الطلب تسجّله لدينا، وستتصل بك خدمة العملاء على 19140 لتأكيد المواعيد ورسوم التوصيل والتركيب قبل أى تنفيذ.',
              'Placing the order records it with us; customer care will call you on 19140 to confirm timing and the delivery and installation charges before anything is fulfilled.') + '</p>' +
          '</form></div></div>' +
        '<div>' + summary(items) + '</div></div>';
    }
    function lbl(name, label, value) {
      return '<label class="field" style="margin:0 0 14px"><span class="field__l">' + esc(label) + '</span>' +
        '<input class="input" name="' + name + '" value="' + esc(value || '') + '" required></label>';
    }

    function wireSummaryOnly() {}

    function wire(user, items) {
      const f = root.querySelector('#coForm');
      if (!f) return;
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(f);
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = t('جارى التسجيل…', 'Recording…');
        const r = await Au.placeOrder({
          items: items.map(i => ({ id: i.id, title: i.title, price: i.price, qty: i.qty, image: i.image })),
          payment: fd.get('payment') || 'cod',
          delivery: { name: fd.get('name'), phone: fd.get('phone'), governorate: fd.get('governorate'),
                      address: fd.get('address'), floor: fd.get('floor'), hasLift: fd.get('hasLift') === 'yes' },
          note: fd.get('note'),
        });
        btn.disabled = false; btn.textContent = t('أكّد الطلب', 'Place the order');
        if (!r.ok) {
          root.querySelector('#coErr').innerHTML = '<div class="note note--warn mt8 small">' +
            esc(r.message || t('تعذّر تسجيل الطلب.', 'Could not record the order.')) + '</div>';
          return;
        }
        // Keep the address for next time, then clear the cart.
        Au.saveProfile({ address: fd.get('address'),
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
          '<li><span class="k">' + t('التوصيل والتركيب', 'Delivery & installation') + '</span><span class="v unknown">' + t('يُؤكَّد هاتفياً', 'confirmed by phone') + '</span></li>' +
        '</ul>' +
        '<div class="chips mt24" style="justify-content:center">' +
          '<a class="btn btn--teal" href="' + A.P('account.html') + '">' + t('اعرض طلباتى', 'View my orders') + '</a>' +
          '<a class="btn btn--ghost" href="' + A.P('appliances.html') + '">' + t('ضيفه لأجهزتى', 'Add to my appliances') + '</a>' +
          '<a class="btn btn--ghost" href="tel:19140">' + t('اتصل 19140', 'Call 19140') + '</a>' +
        '</div></div>';
    }
    function payName(k) {
      return { cod: t('الدفع عند الاستلام', 'Cash on delivery'), bank: t('تحويل بنكى', 'Bank transfer'),
               showroom: t('الدفع فى المعرض', 'Pay at a showroom') }[k] || k;
    }
  }

  window.mountCheckout = mountCheckout;
})();
