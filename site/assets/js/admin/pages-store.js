/* ============================================================================
   Admin portal: the STORE pages. Every one reads and writes Ecwid through the
   server; nothing is kept on the website.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.ADM, t = A.t, esc = A.esc, I = A.ICON;

  const FUL = {
    AWAITING_PROCESSING: ['بانتظار التجهيز', 'Awaiting processing', 'warn'], PROCESSING: ['قيد التجهيز', 'Processing', 'blue'],
    SHIPPED: ['تم الشحن', 'Shipped', 'blue'], OUT_FOR_DELIVERY: ['خرج للتوصيل', 'Out for delivery', 'blue'], DELIVERED: ['تم التسليم', 'Delivered', 'ok'],
    READY_FOR_PICKUP: ['جاهز للاستلام', 'Ready for pickup', 'teal'], WILL_NOT_DELIVER: ['لن يُسلَّم', 'Will not deliver', 'bad'], RETURNED: ['مرتجع', 'Returned', 'bad'],
  };
  const PAY = {
    AWAITING_PAYMENT: ['بانتظار الدفع', 'Awaiting payment', 'warn'], PAID: ['مدفوع', 'Paid', 'ok'], CANCELLED: ['ملغى', 'Cancelled', 'bad'],
    REFUNDED: ['مسترد', 'Refunded', 'bad'], PARTIALLY_REFUNDED: ['مسترد جزئياً', 'Partly refunded', 'warn'], INCOMPLETE: ['غير مكتمل', 'Incomplete', 'bad'],
  };
  const chip = (map, k) => k && map[k] ? '<span class="chip chip--' + map[k][2] + '">' + esc(t(map[k][0], map[k][1])) + '</span>' : '<span class="chip">' + esc(k || '-') + '</span>';
  const opts = map => Object.keys(map).map(k => ({ value: k, label: t(map[k][0], map[k][1]) }));
  let STORE_ID = null;
  const ecwidLink = (hash, label) => STORE_ID ? '<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://my.ecwid.com/store/' + STORE_ID + '#' + hash + '">' + I.ext + (label || t('فتح فى إكويد', 'Open in Ecwid')) + '</a>' : '';
  async function storeId() { if (!STORE_ID) { const m = await A.api('GET', 'me'); STORE_ID = m.storeId || null; } return STORE_ID; }

  /* =================== orders =================== */
  A.page('orders', {
    group: 'store', icon: 'order', label: ['الطلبات', 'Orders'], source: 'ecwid',
    sub: ['كل الطلبات من إكويد، بما فيها طلبات خدمة العملاء والمعارض.', 'Every order in Ecwid, including customer-care and showroom orders.'],
    async render(el, ctx) {
      await storeId();
      const st = { page: 1, q: ctx.query.get('q') || '', status: ctx.query.get('status') || '' };
      el.innerHTML = '<div id="queue"></div><div class="toolbar"><input class="input grow" id="q" placeholder="' + t('ابحث برقم الطلب أو الاسم أو الهاتف أو البريد', 'Search by order number, name, phone or email') + '" value="' + esc(st.q) + '">' +
        A.select('status', [{ value: '', label: t('كل الحالات', 'All statuses') }].concat(opts(FUL)), st.status, 'id="status"') + '</div><div id="list">' + A.loading() + '</div>';
      const load = async () => {
        const list = el.querySelector('#list');
        list.innerHTML = A.loading();
        const r = await A.api('GET', 'store/orders?page=' + st.page + '&q=' + encodeURIComponent(st.q) + '&status=' + st.status);
        if (ctx.stale()) return;
        if (!r.ok) { list.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
        queue(el.querySelector('#queue'), r.queue);
        if (!r.orders.length) { list.innerHTML = '<div class="card empty">' + t('لا توجد طلبات.', 'No orders.') + '</div>'; return; }
        list.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>' + t('التاريخ', 'Date') + '</th><th>' + t('العميل', 'Customer') + '</th><th>' +
          t('الإجمالى', 'Total') + '</th><th>' + t('الدفع', 'Payment') + '</th><th>' + t('التجهيز', 'Fulfilment') + '</th><th>' + t('الشحنة', 'Tracking') + '</th></tr></thead><tbody>' +
          r.orders.map(o => '<tr class="click" data-id="' + o.id + '"><td><b class="ltr">' + esc(o.number) + '</b>' + (o.ref ? '<div class="tiny muted ltr">' + esc(o.ref) + '</div>' : '<div class="tiny muted">' + t('خدمة العملاء', 'Customer care') + '</div>') + '</td>' +
            '<td class="num">' + esc(A.date(o.createdAt, true)) + '</td><td>' + esc(o.name) + '<div class="tiny muted ltr">' + esc(o.phone || o.email) + '</div></td>' +
            '<td class="num"><b>' + A.money(o.total) + '</b>' + (o.coupon ? '<div class="tiny muted">' + t('كوبون ', 'coupon ') + '<span class="ltr">' + esc(o.coupon) + '</span></div>' : '') + '</td>' +
            '<td>' + chip(PAY, o.paymentStatus) + '</td><td>' + chip(FUL, o.fulfillmentStatus) + '</td><td class="ltr small">' + esc(o.tracking || '') + '</td></tr>').join('') + '</tbody></table></div>';
        list.appendChild(A.pager(st.page, r.pages, p => { st.page = p; load(); }));
        list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => orderDetail(tr.dataset.id, load); });
      };
      el.querySelector('#q').oninput = A.debounce(e => { st.q = e.target.value.trim(); st.page = 1; load(); }, 400);
      el.querySelector('#status').onchange = e => { st.status = e.target.value; st.page = 1; load(); };
      load();
    },
  });
  function queue(box, q) {
    const rows = (q.parked || []).map(x => Object.assign({ parked: true }, x)).concat((q.pending || []).map(x => Object.assign({ parked: false }, x)));
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card" style="margin-bottom:14px;border-color:#f0c88f"><h2>' + t('طلبات من الموقع لم تصل إكويد بعد', 'Website orders not in Ecwid yet') + '</h2>' +
      '<p class="small muted" style="margin:0 0 8px">' + t('هذه الطلبات محفوظة على الموقع وتُعاد محاولة إرسالها تلقائياً. اتصل بالعميل إن طال الانتظار.', 'These are safe on the website and are retried automatically. Call the customer if it takes long.') + '</p>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + rows.map(x => '<tr><td class="ltr"><b>' + esc(x.ref) + '</b></td><td>' + esc(x.name || '') + ' <span class="ltr muted">' + esc(x.phone || '') + '</span></td>' +
        '<td class="num">' + A.money(x.total) + '</td><td>' + (x.parked ? '<span class="chip chip--bad">' + t('توقفت المحاولات', 'Stopped retrying') + '</span>' : '<span class="chip chip--warn">' + t('بانتظار إعادة المحاولة', 'Will retry') + '</span>') +
        (x.lastError ? '<div class="tiny muted">' + esc(String(x.lastError).slice(0, 90)) + '</div>' : '') + '</td>' +
        '<td><button class="btn btn--sm" data-retry="' + esc(x.ref) + '">' + t('أرسل الآن', 'Send now') + '</button></td></tr>').join('') + '</tbody></table></div></div>';
    box.querySelectorAll('[data-retry]').forEach(b => {
      b.onclick = async () => { b.disabled = true; const r = await A.api('POST', 'ecwid/orders/' + encodeURIComponent(b.dataset.retry) + '/retry', {}); if (A.report(r, t('وصل الطلب إلى إكويد.', 'The order reached Ecwid.'))) A.rerender(); else b.disabled = false; };
    });
  }
  async function orderDetail(id, reload) {
    const m = A.modal({ title: t('طلب', 'Order'), body: A.loading(), wide: true, actions: false });
    const r = await A.api('GET', 'store/orders/' + id);
    if (!r.ok) { m.el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
    const o = r.order;
    m.close();
    A.modal({
      title: t('طلب رقم ', 'Order #') + o.number + (o.ref ? ' · ' + o.ref : ''), wide: true,
      body: '<div class="grid grid--2"><div><dl class="kv">' +
          '<dt>' + t('التاريخ', 'Date') + '</dt><dd>' + esc(A.date(o.createdAt, true)) + '</dd>' +
          '<dt>' + t('العميل', 'Customer') + '</dt><dd>' + esc(o.name) + '</dd>' +
          '<dt>' + t('الهاتف', 'Phone') + '</dt><dd class="ltr">' + (o.phone ? '<a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a>' : '-') + '</dd>' +
          '<dt>' + t('البريد', 'Email') + '</dt><dd class="ltr">' + esc(o.email || '-') + '</dd>' +
          '<dt>' + t('العنوان', 'Address') + '</dt><dd>' + esc(o.address || '-') + '</dd>' +
          '<dt>' + t('الدفع', 'Payment') + '</dt><dd>' + esc(o.paymentMethod || '-') + '</dd>' +
          (o.shipping ? '<dt>' + t('التوصيل', 'Delivery') + '</dt><dd>' + esc(o.shipping.name || '') + ' · ' + A.money(o.shipping.rate) + '</dd>' : '') +
          (o.coupon ? '<dt>' + t('كوبون', 'Coupon') + '</dt><dd><span class="ltr">' + esc(o.coupon) + '</span> · −' + A.money(o.couponDiscount) + '</dd>' : '') +
          '<dt>' + t('الإجمالى', 'Total') + '</dt><dd><b>' + A.money(o.total) + '</b></dd></dl>' +
          '<div class="lines">' + o.lines.map(l => '<div class="l">' + (l.image ? '<img src="' + esc(l.image) + '" alt="">' : '') + '<div><div class="small"><b>' + esc(l.name) + '</b></div><div class="tiny muted">' +
            A.num(l.qty) + ' × ' + A.money(l.price) + '</div></div></div>').join('') + '</div>' +
          (o.comments ? '<details class="node"><summary>' + t('ملاحظات الطلب', 'Order notes') + '</summary><div class="node__b small" style="white-space:pre-wrap">' + esc(o.comments) + '</div></details>' : '') +
        '</div><div><form id="of">' +
          A.field(t('حالة التجهيز', 'Fulfilment'), A.select('fulfillmentStatus', opts(FUL), o.fulfillmentStatus)) +
          A.field(t('حالة الدفع', 'Payment status'), A.select('paymentStatus', opts(PAY), o.paymentStatus)) +
          A.field(t('رقم الشحنة', 'Tracking number'), A.input('trackingNumber', o.tracking, 'dir="ltr"'), t('يظهر للعميل فى صفحة طلباته مع رابط موفكس.', 'Shown to the customer on their orders page with a Movex link.')) +
          A.field(t('ملاحظات داخلية', 'Internal notes'), A.textarea('privateAdminNotes', o.adminNotes), t('لا يراها العميل.', 'Never shown to the customer.')) +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">' + t('حفظ فى إكويد', 'Save to Ecwid') + '</button>' + ecwidLink('order:id=' + o.id) + '</div></form></div></div>',
      actions: false,
    });
    const f = document.getElementById('of');
    f.onsubmit = async e => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      const x = await A.api('PATCH', 'store/orders/' + o.id, A.formData(f));
      btn.disabled = false;
      if (A.report(x, t('تم التحديث فى إكويد.', 'Updated in Ecwid.'))) reload();
    };
  }

  /* =================== products =================== */
  A.page('products', {
    group: 'store', icon: 'box', label: ['المنتجات', 'Products'], source: 'ecwid',
    sub: ['السعر والمخزون والظهور والشارة، تُحفظ مباشرة فى إكويد.', 'Price, stock, visibility and badge, saved straight to Ecwid.'],
    async render(el, ctx) {
      await storeId();
      const [cats, left] = await Promise.all([A.api('GET', 'ads'), A.api('GET', 'leftovers')]);
      if (ctx.stale()) return;
      const categories = ((cats && cats.categories) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      const st = { page: 1, q: '', cat: '', view: 'all' };
      const VIEWS = [['all', 'الكل', 'All'], ['on', 'معروضة', 'On sale'], ['off', 'مخفية', 'Hidden'], ['out', 'نفدت', 'Out of stock'], ['sale', 'عليها خصم', 'Discounted'], ['badge', 'لها شارة', 'With a badge']];
      const nLeft = left.ok ? left.overrides.length + left.custom.length + left.hidden.length + (left.promos ? 1 : 0) : 0;
      el.innerHTML = (nLeft ? '<div class="note note--warn" style="margin-bottom:14px"><b>' + A.num(nLeft) + '</b> ' +
          t('تعديل قديم محفوظ على الموقع بدلاً من إكويد، ولم يعد يُستخدم. ', 'old edits are saved on the website instead of Ecwid and are no longer used. ') +
          '<button class="btn btn--sm" id="leftBtn">' + t('مراجعة', 'Review') + '</button></div>' : '') +
        '<div class="toolbar"><input class="input grow" id="q" placeholder="' + t('ابحث بالاسم أو الرقم أو الكود', 'Search by name, number or SKU') + '">' +
        '<select class="select" id="cat"><option value="">' + t('كل الأقسام', 'All categories') + '</option>' + categories.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
        '<span class="seg" id="views">' + VIEWS.map(v => '<button data-v="' + v[0] + '" class="' + (v[0] === 'all' ? 'on' : '') + '">' + t(v[1], v[2]) + '</button>').join('') + '</span></div><div id="list"></div>';
      if (nLeft) el.querySelector('#leftBtn').onclick = () => leftovers(left);
      const load = async () => {
        const list = el.querySelector('#list');
        list.innerHTML = A.loading();
        const r = await A.api('GET', 'store/products?page=' + st.page + '&q=' + encodeURIComponent(st.q) + '&cat=' + st.cat + '&view=' + st.view);
        if (ctx.stale()) return;
        if (!r.ok) { list.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
        if (!r.products.length) { list.innerHTML = '<div class="card empty">' + t('لا توجد منتجات بهذا البحث.', 'No products match.') + '</div>'; return; }
        list.innerHTML = '<p class="small muted" style="margin:0 0 8px">' + A.num(r.total) + t(' منتج', ' products') + '</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>' + t('المنتج', 'Product') + '</th><th>' +
          t('السعر', 'Price') + '</th><th>' + t('المخزون', 'Stock') + '</th><th>' + t('الشارة', 'Badge') + '</th><th>' + t('الاهتمام', 'Interest') + '</th><th>' + t('معروض', 'On sale') + '</th></tr></thead><tbody>' +
          r.products.map(p => '<tr class="click" data-id="' + p.id + '"><td>' + (p.image ? '<img class="thumb" src="' + esc(p.image) + '" alt="" loading="lazy">' : '<div class="thumb"></div>') + '</td>' +
            '<td><b>' + esc(p.title) + '</b><div class="tiny muted ltr">#' + esc(p.id) + (p.sku ? ' · ' + esc(p.sku) : '') + '</div></td>' +
            '<td class="num"><b>' + A.money(p.price) + '</b>' + (p.compareToPrice ? '<div class="tiny muted" style="text-decoration:line-through">' + A.money(p.compareToPrice) + '</div>' : '') + '</td>' +
            '<td>' + (!p.stockTracked ? '<span class="chip">' + t('غير محدود', 'Not tracked') + '</span>' : Number(p.quantity) <= 0 ? '<span class="chip chip--bad">' + t('نفد', 'Out') + '</span>' : '<span class="chip chip--ok">' + A.num(p.quantity) + '</span>') + '</td>' +
            '<td>' + (p.badge ? '<span class="chip chip--teal">' + esc(p.badge) + '</span>' : '') + '</td>' +
            '<td class="small muted">' + (p.stats ? A.num(p.stats.views) + ' · ' + A.num(p.stats.carts) + ' · ' + A.num(p.stats.purchases) : '') + '</td>' +
            '<td data-stop>' + A.sw('en', p.enabled, 'data-toggle="' + p.id + '"') + '</td></tr>').join('') + '</tbody></table></div>';
        list.appendChild(A.pager(st.page, r.pages, p => { st.page = p; load(); }));
        list.querySelectorAll('[data-stop]').forEach(td => { td.onclick = e => e.stopPropagation(); });
        list.querySelectorAll('[data-toggle]').forEach(inp => {
          inp.onchange = async () => {
            inp.disabled = true;
            const x = await A.api('PATCH', 'store/products/' + inp.dataset.toggle, { enabled: inp.checked });
            inp.disabled = false;
            if (!A.report(x, inp.checked ? t('المنتج معروض الآن.', 'The product is on sale now.') : t('تم إخفاء المنتج.', 'The product is hidden.'))) inp.checked = !inp.checked;
          };
        });
        list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => productEditor(tr.dataset.id, categories, load); });
      };
      el.querySelector('#q').oninput = A.debounce(e => { st.q = e.target.value.trim(); st.page = 1; load(); }, 300);
      el.querySelector('#cat').onchange = e => { st.cat = e.target.value; st.page = 1; load(); };
      el.querySelectorAll('#views button').forEach(b => { b.onclick = () => { st.view = b.dataset.v; st.page = 1; el.querySelectorAll('#views button').forEach(x => x.classList.toggle('on', x === b)); load(); }; });
      load();
    },
  });
  async function productEditor(id, categories, reload) {
    const r = await A.api('GET', 'store/products/' + id);
    if (!A.report(r)) return;
    const p = r.product;
    let picked = null;
    const m = A.modal({
      title: p.title, wide: true,
      body: '<div class="grid grid--2"><div>' +
          '<label class="drop" id="drop"><input type="file" accept="image/png,image/jpeg,image/webp" hidden>' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '') +
          '<div><b>' + t('استبدال الصورة الرئيسية', 'Replace the main picture') + '</b></div><div class="small muted">' + t('PNG أو JPG أو WebP حتى ٣ ميجا', 'PNG, JPG or WebP up to 3 MB') + '</div></label>' +
          '<div style="margin-top:10px">' + ecwidLink('product:id=' + p.id + '&mode=edit') + '</div></div><div>' +
          A.field(t('اسم المنتج', 'Product name'), A.input('title', p.title, 'maxlength="300"')) +
          '<div class="row">' + A.field(t('السعر', 'Price'), A.input('price', p.price, 'type="number" min="0" step="0.01" dir="ltr"')) +
            A.field(t('السعر قبل الخصم', 'Was-price'), A.input('compareToPrice', p.compareToPrice, 'type="number" min="0" step="0.01" dir="ltr"'), t('اتركه فارغاً إن لم يكن هناك خصم.', 'Leave empty if there is no discount.')) + '</div>' +
          '<div class="row">' + A.field(t('المخزون', 'Stock'), A.input('quantity', p.quantity, 'type="number" min="0" step="1" dir="ltr"'), t('فارغ = غير محدود.', 'Empty = not tracked.')) +
            A.field(t('الشارة', 'Badge'), A.input('badge', p.badge, 'maxlength="40" placeholder="' + t('مثل: عرض', 'e.g. Offer') + '"')) + '</div>' +
          /* The current category is always an option and is selected. A product
             can sit in a category the list does not carry (a hidden Ecwid
             category); without this the first option would be shown, and a
             save would quietly move the product there. */
          A.field(t('القسم الرئيسى', 'Main category'), A.select('categoryId',
            (categories.some(c => c.id === p.categoryId) ? [] : [{ value: p.categoryId, label: p.categoryId
              ? t('قسم مخفى فى إكويد #', 'Hidden Ecwid category #') + p.categoryId : t('بدون قسم', 'No category') }])
              .concat(categories.map(c => ({ value: c.id, label: c.name }))), p.categoryId)) +
          '<label class="check" style="margin-bottom:12px">' + A.sw('enabled', p.enabled) + ' ' + t('معروض للبيع', 'On sale') + '</label>' +
          A.field(t('الوصف', 'Description'), A.textarea('description', p.description, 'style="min-height:140px"'), t('يُحفظ كما هو فى إكويد، بما فيه التنسيق.', 'Saved to Ecwid as it is, formatting included.')) +
        '</div></div>',
      actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' }, { label: t('حفظ فى إكويد', 'Save to Ecwid'), run: async b => {
        const d = A.formData(b);
        const patch = {};
        if (d.title !== p.title) patch.title = d.title;
        if (String(d.price) !== String(p.price ?? '')) patch.price = d.price;
        if (String(d.compareToPrice) !== String(p.compareToPrice ?? '')) patch.compareToPrice = d.compareToPrice === '' ? null : d.compareToPrice;
        if (String(d.quantity) !== String(p.quantity ?? '')) patch.quantity = d.quantity === '' ? null : Number(d.quantity);
        if (d.badge !== p.badge) patch.badge = d.badge;
        if (d.categoryId && d.categoryId !== p.categoryId) patch.categoryId = d.categoryId;
        if (d.enabled !== p.enabled) patch.enabled = d.enabled;
        if (d.description !== p.description) patch.description = d.description;
        if ('compareToPrice' in patch && !('price' in patch) && patch.compareToPrice) patch.price = p.price;
        if (Object.keys(patch).length) {
          const x = await A.api('PATCH', 'store/products/' + p.id, patch);
          if (!A.report(x)) return false;
        }
        if (picked) {
          const x = await A.api('POST', 'store/products/' + p.id + '/image', { data: picked.dataUrl });
          if (!A.report(x)) return false;
        }
        A.toast(t('تم الحفظ فى إكويد.', 'Saved to Ecwid.'));
        reload();
      } }],
    });
    const fileIn = m.el.querySelector('input[type=file]');
    fileIn.onchange = async () => {
      const img = await A.readImage(fileIn.files[0]);
      if (!img || img.error) { picked = null; if (img) A.toast(img.error, true); return; }
      picked = img;
      const drop = m.el.querySelector('#drop');
      let pv = drop.querySelector('img'); if (!pv) { pv = document.createElement('img'); drop.prepend(pv); }
      pv.src = img.dataUrl;
    };
  }
  function leftovers(l) {
    const sec = (kind, title, rows, hint) => !rows.length ? '' : '<div class="card"><h2><span class="lft">' + title + ' <span class="chip">' + A.num(rows.length) + '</span></span>' +
      '<button class="btn btn--ghost btn--bad btn--sm" data-discard="' + kind + '">' + t('حذف الكل', 'Discard all') + '</button></h2><p class="small muted" style="margin:0 0 8px">' + hint + '</p>' +
      '<div class="lines">' + rows.slice(0, 50).map(x => '<div class="small">' + x + '</div>').join('') + '</div></div>';
    const m = A.modal({
      title: t('تعديلات قديمة على الموقع', 'Old edits on the website'), wide: true, actions: false,
      body: '<p class="small" style="margin-top:0">' + t('كانت لوحة التحكم القديمة تحفظ هذه التعديلات على الموقع بدلاً من إكويد. لم تعد تُستخدم. انقل ما تحتاجه إلى إكويد من صفحة المنتجات، ثم احذفها.',
          'The old control room saved these on the website instead of in Ecwid. They are no longer used. Carry over anything you still want from the Products page, then discard them.') + '</p>' +
        sec('overrides', t('أسعار وأسماء معدلة', 'Edited prices and names'), l.overrides.map(o => '<b>' + esc(o.title || o.id) + '</b> <span class="muted ltr">' + esc(JSON.stringify(o.patch)).slice(0, 140) + '</span>'), t('هذه القيم لا تظهر على الموقع الآن.', 'These values are not on the site any more.')) +
        sec('hidden', t('منتجات كانت مخفية', 'Products that were hidden'), l.hidden.map(h => esc(h.title || h.id) + ' <span class="muted ltr">#' + esc(h.id) + '</span>'), t('لإخفائها فعلاً أطفئ «معروض» فى صفحة المنتجات.', 'To hide them for real, switch "On sale" off on the Products page.')) +
        sec('custom', t('منتجات أضيفت يدوياً', 'Products added by hand'), l.custom.map(c => esc(c.title || c.id) + ' · ' + A.money(c.price)), t('أضفها فى إكويد إن كنت ما زلت تبيعها.', 'Add them in Ecwid if you still sell them.')) +
        sec('promos', t('نسخة قديمة من الإعلانات', 'An old copy of the ads'), l.promos ? [t('ملف إعلانات محفوظ على الموقع', 'An ads file saved on the website')] : [], t('الإعلانات الآن فى إكويد.', 'Ads now live in Ecwid.')),
    });
    m.el.querySelectorAll('[data-discard]').forEach(b => {
      b.onclick = async () => {
        if (!(await A.confirm(t('حذف هذه التعديلات القديمة نهائياً؟', 'Discard these old edits for good?'), t('حذف', 'Discard'), true))) return;
        const x = await A.api('POST', 'leftovers/discard', { kind: b.dataset.discard });
        if (A.report(x, t('تم الحذف.', 'Discarded.'))) { m.close(); A.rerender(); }
      };
    });
  }

  /* =================== coupons =================== */
  const CTYPE = { PERCENT: ['نسبة ٪', 'Percent off'], ABS: ['مبلغ ثابت', 'Fixed amount off'], SHIPPING: ['توصيل مجانى', 'Free delivery'],
                  PERCENT_AND_SHIPPING: ['نسبة + توصيل مجانى', 'Percent + free delivery'], ABS_AND_SHIPPING: ['مبلغ + توصيل مجانى', 'Amount + free delivery'] };
  A.page('coupons', {
    group: 'store', icon: 'tag', label: ['الكوبونات', 'Coupons'], source: 'ecwid',
    sub: ['أكواد الخصم التى يكتبها العميل عند الدفع. إكويد هو من يقرر صلاحيتها.', 'Discount codes customers type at checkout. Ecwid decides whether each one applies.'],
    async render(el, ctx) {
      const add = document.createElement('button');
      add.className = 'btn'; add.textContent = '+ ' + t('كوبون جديد', 'New coupon');
      add.onclick = () => couponEditor(null);
      ctx.actions.append(add);
      const r = await A.api('GET', 'store/coupons');
      if (ctx.stale()) return;
      if (!r.ok) { el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
      const amount = c => /PERCENT/.test(c.type) ? A.num(c.discount) + '٪' : c.type === 'SHIPPING' ? t('توصيل مجانى', 'Free delivery') : A.money(c.discount);
      const LIM = { UNLIMITED: ['بلا حد', 'Unlimited'], ONCEPERCUSTOMER: ['مرة لكل عميل', 'Once per customer'], SINGLE: ['مرة واحدة فقط', 'Single use'] };
      el.innerHTML = !r.coupons.length ? '<div class="card empty">' + t('لا توجد كوبونات.', 'No coupons yet.') + '</div>' :
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('الكوبون', 'Coupon') + '</th><th>' + t('الخصم', 'Discount') + '</th><th>' + t('الشروط', 'Conditions') + '</th><th>' +
        t('الاستخدام', 'Used') + '</th><th>' + t('مفعّل', 'Active') + '</th><th></th></tr></thead><tbody>' +
        r.coupons.map(c => '<tr><td><b class="ltr">' + esc(c.code) + '</b><div class="tiny muted">' + esc(c.name) + '</div></td><td><b>' + amount(c) + '</b>' +
          (/SHIPPING/.test(c.type) && c.type !== 'SHIPPING' ? '<div class="tiny muted">' + t('+ توصيل مجانى', '+ free delivery') + '</div>' : '') + '</td>' +
          '<td class="small">' + (c.minSubtotal ? t('حد أدنى ', 'Min ') + A.money(c.minSubtotal) + '<br>' : '') + esc(t(...(LIM[c.usesLimit] || [c.usesLimit, c.usesLimit]))) +
          (c.to ? '<br>' + t('حتى ', 'until ') + esc(A.date(c.to)) : '') + '</td><td class="num">' + A.num(c.used) + '</td>' +
          '<td>' + (c.status === 'EXPIRED' || c.status === 'USEDUP' ? '<span class="chip chip--bad">' + (c.status === 'EXPIRED' ? t('انتهى', 'Expired') : t('استُنفد', 'Used up')) + '</span>' :
            A.sw('on', c.status === 'ACTIVE', 'data-toggle="' + c.id + '"')) + '</td>' +
          '<td style="white-space:nowrap"><button class="icon-btn" data-edit="' + c.id + '" title="' + t('تعديل', 'Edit') + '">' + I.edit + '</button> ' +
          '<button class="icon-btn" data-del="' + c.id + '" title="' + t('حذف', 'Delete') + '">' + I.trash + '</button></td></tr>').join('') + '</tbody></table></div>';
      el.querySelectorAll('[data-toggle]').forEach(inp => {
        inp.onchange = async () => {
          inp.disabled = true;
          const x = await A.api('PUT', 'store/coupons/' + inp.dataset.toggle, { status: inp.checked ? 'ACTIVE' : 'PAUSED' });
          inp.disabled = false;
          if (!A.report(x, inp.checked ? t('الكوبون مفعّل.', 'Coupon on.') : t('الكوبون متوقف.', 'Coupon paused.'))) inp.checked = !inp.checked;
        };
      });
      el.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => couponEditor(r.coupons.find(c => c.id === b.dataset.edit)); });
      el.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = async () => {
          if (!(await A.confirm(t('حذف هذا الكوبون من إكويد؟', 'Delete this coupon from Ecwid?'), t('حذف', 'Delete'), true))) return;
          if (A.report(await A.api('DELETE', 'store/coupons/' + b.dataset.del), t('تم الحذف.', 'Deleted.'))) A.rerender();
        };
      });
    },
  });
  function couponEditor(c) {
    const day = v => v ? String(v).slice(0, 10) : '';
    const lim = c ? (c.usesLimit === 'SINGLE' ? 'single' : c.usesLimit === 'ONCEPERCUSTOMER' ? 'once' : 'any') : 'any';
    A.modal({
      title: c ? t('تعديل كوبون', 'Edit coupon') : t('كوبون جديد', 'New coupon'),
      body: '<div class="row">' + A.field(t('الكود', 'Code'), A.input('code', c ? c.code : '', 'dir="ltr" maxlength="40" style="text-transform:uppercase"'), t('حروف وأرقام بدون مسافات.', 'Letters and digits, no spaces.')) +
          A.field(t('الاسم الداخلى', 'Internal name'), A.input('name', c ? c.name : '', 'maxlength="120"')) + '</div>' +
        '<div class="row">' + A.field(t('نوع الخصم', 'Discount type'), A.select('type', Object.keys(CTYPE).map(k => ({ value: k, label: t(...CTYPE[k]) })), c ? c.type : 'PERCENT')) +
          A.field(t('القيمة', 'Amount'), A.input('discount', c ? c.discount : '', 'type="number" min="0" step="0.01" dir="ltr"'), t('للنسبة: من ١ إلى ١٠٠.', 'For percent: 1 to 100.')) + '</div>' +
        '<div class="row">' + A.field(t('أقل قيمة للطلب', 'Minimum order'), A.input('minSubtotal', c ? c.minSubtotal : '', 'type="number" min="0" dir="ltr"'), t('اختيارى', 'Optional')) +
          A.field(t('عدد مرات الاستخدام', 'How often'), A.select('limit', [{ value: 'any', label: t('بلا حد', 'Unlimited') }, { value: 'once', label: t('مرة لكل عميل', 'Once per customer') }, { value: 'single', label: t('مرة واحدة فقط', 'Single use') }], lim)) + '</div>' +
        '<div class="row">' + A.field(t('يبدأ', 'Starts'), A.input('from', day(c && c.from), 'type="date" dir="ltr"')) + A.field(t('ينتهى', 'Ends'), A.input('to', day(c && c.to), 'type="date" dir="ltr"')) + '</div>' +
        '<label class="check">' + A.sw('active', !c || c.status === 'ACTIVE') + ' ' + t('مفعّل', 'Active') + '</label>',
      actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' }, { label: t('حفظ فى إكويد', 'Save to Ecwid'), run: async b => {
        const d = A.formData(b);
        const body = { code: d.code, name: d.name, type: d.type, discount: d.discount, minSubtotal: d.minSubtotal, from: d.from, to: d.to,
                       once: d.limit === 'once', single: d.limit === 'single', status: d.active ? 'ACTIVE' : 'PAUSED' };
        const x = c ? await A.api('PUT', 'store/coupons/' + c.id, body) : await A.api('POST', 'store/coupons', body);
        if (!A.report(x, t('تم الحفظ فى إكويد.', 'Saved to Ecwid.'))) return false;
        A.rerender();
      } }],
    });
  }

  /* =================== delivery =================== */
  const BANDS = { small: ['صغيرة', 'Small'], medium: ['متوسطة', 'Medium'], large: ['كبيرة', 'Large'], xl: ['كبيرة جداً', 'Extra large'], craft: ['حرف يدوية', 'Handicrafts'], none: ['بدون فئة', 'No band'] };
  A.page('delivery', {
    group: 'store', icon: 'truck', label: ['رسوم التوصيل', 'Delivery fees'], source: 'ecwid',
    sub: ['طرق الشحن فى إكويد، وفئة الحجم لكل منتج التى تحدد الرسوم.', 'The shipping methods in Ecwid, and the size band per product that sets the fee.'],
    async render(el, ctx) {
      await storeId();
      const [m, cls] = await Promise.all([A.api('GET', 'store/delivery'), A.api('GET', 'delivery-classes')]);
      if (ctx.stale()) return;
      if (!m.ok) { el.innerHTML = '<div class="note note--bad">' + esc(m.message || '') + '</div>'; return; }
      el.innerHTML = '<div class="card"><h2><span class="lft">' + t('فئات الحجم', 'Size bands') + '</span></h2><div class="grid grid--tiles">' +
          Object.keys(BANDS).map(k => '<div class="tile' + (k === 'none' && cls.counts && cls.counts.none ? ' tile--warn' : '') + '"><div class="k">' + t(...BANDS[k]) + '</div><div class="v">' + A.num(cls.counts ? cls.counts[k] : 0) + '</div></div>').join('') + '</div>' +
          (cls.unclassified && cls.unclassified.length ? '<details class="node" style="margin-top:12px"><summary>' + t('منتجات بدون فئة (تؤكد خدمة العملاء رسومها)', 'Products with no band (customer care confirms their fee)') + '</summary><div class="node__b"><div class="lines">' +
            cls.unclassified.slice(0, 80).map(u => '<div class="small">' + esc(u.title) + ' <span class="muted">· ' + esc(u.category || '') + '</span></div>').join('') + '</div></div></details>' : '') +
          ((cls.problems || []).length ? '<div class="note note--warn" style="margin-top:12px">' + t('طرق شحن لم تُقرأ أسعارها: ', 'Shipping methods whose rates could not be read: ') + esc(cls.problems.map(p => p.title).join('، ')) + '</div>' : '') + '</div>' +
        '<div class="card"><h2><span class="lft">' + t('طرق الشحن', 'Shipping methods') + '</span>' + ecwidLink('shippings', t('تعديل الأسعار فى إكويد', 'Edit rates in Ecwid')) + '</h2>' +
          '<p class="small muted" style="margin:0 0 10px">' + t('الأسعار تُعدل فى إكويد، فالموقع يقرؤها من أسماء الطرق. من هنا يمكنك إيقاف طريقة أو تشغيلها.', 'Rates are edited in Ecwid, because the site reads them from the method names. Here you can switch a method on or off.') + '</p>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('الطريقة', 'Method') + '</th><th>' + t('السعر', 'Rate') + '</th><th>' + t('مفعّلة', 'On') + '</th></tr></thead><tbody>' +
          m.methods.map(x => '<tr><td>' + esc(x.title) + (x.zone ? '<div class="tiny muted">' + esc(x.zone) + '</div>' : '') + '</td><td class="small">' +
            (x.how === 'flat' ? A.money(x.flat) : x.how === 'table' ? t('جدول (', 'Table (') + A.num(x.tableRows) + t(' صفوف)', ' rows)') : esc(x.how)) + '</td>' +
            '<td>' + A.sw('on', x.enabled, 'data-ship="' + esc(x.id) + '"') + '</td></tr>').join('') + '</tbody></table></div></div>';
      el.querySelectorAll('[data-ship]').forEach(inp => {
        inp.onchange = async () => {
          inp.disabled = true;
          const x = await A.api('PATCH', 'store/delivery/' + encodeURIComponent(inp.dataset.ship), { enabled: inp.checked });
          inp.disabled = false;
          if (!A.report(x, t('تم التحديث فى إكويد.', 'Updated in Ecwid.'))) inp.checked = !inp.checked;
        };
      });
    },
  });

  /* =================== payment methods =================== */
  A.page('payments', {
    group: 'store', icon: 'card', label: ['طرق الدفع', 'Payment methods'], source: 'ecwid',
    sub: ['الطرق التى يختار منها العميل عند الدفع، بالاسم والتعليمات.', 'What customers choose from at checkout, with the name and instructions they see.'],
    async render(el, ctx) {
      const r = await A.api('GET', 'store/payments');
      if (ctx.stale()) return;
      if (!r.ok) { el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
      el.innerHTML = '<div class="grid grid--2">' + r.methods.map(m => '<form class="card" data-pay="' + esc(m.id) + '"><h2><span class="lft">' + esc(m.title || t('بدون اسم', 'Untitled')) + '</span>' +
          '<label class="check">' + A.sw('enabled', m.enabled) + ' ' + t('مفعّلة', 'On') + '</label></h2>' +
          (m.placeholder ? '<div class="note note--warn" style="margin-bottom:10px">' + t('هذا اسم إكويد الافتراضى، لذلك يخفيها الموقع. سمّها أو أوقفها.', 'This is Ecwid\'s default name, so the site hides it. Name it or switch it off.') + '</div>' : '') +
          A.field(t('الاسم الذى يراه العميل', 'Name the customer sees'), A.input('title', m.title, 'maxlength="120"')) +
          A.field(t('التعليمات', 'Instructions'), A.textarea('instructions', m.instructions)) +
          '<button class="btn btn--sm" type="submit">' + t('حفظ فى إكويد', 'Save to Ecwid') + '</button></form>').join('') + '</div>';
      el.querySelectorAll('[data-pay]').forEach(f => {
        const id = f.dataset.pay;
        f.querySelector('input[name=enabled]').onchange = async e => {
          const x = await A.api('PATCH', 'store/payments/' + encodeURIComponent(id), { enabled: e.target.checked });
          if (!A.report(x, t('تم التحديث فى إكويد.', 'Updated in Ecwid.'))) e.target.checked = !e.target.checked;
        };
        f.onsubmit = async e => {
          e.preventDefault();
          const d = A.formData(f);
          A.report(await A.api('PATCH', 'store/payments/' + encodeURIComponent(id), { title: d.title, instructions: d.instructions }), t('تم الحفظ فى إكويد.', 'Saved to Ecwid.'));
        };
      });
    },
  });
})();
