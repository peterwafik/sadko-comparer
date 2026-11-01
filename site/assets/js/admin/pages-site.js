/* ============================================================================
   Admin portal: the dashboard and the WEBSITE pages (scenes, ads, guides,
   finder, site bar). Ads are stored in Ecwid; the rest exist only on the site.
   ========================================================================== */
(function () {
  'use strict';
  const A = window.ADM, t = A.t, esc = A.esc, I = A.ICON;

  /* =================== dashboard =================== */
  A.page('dashboard', {
    group: 'top', icon: 'dash', label: ['لوحة المتابعة', 'Dashboard'], perm: 'any',
    sub: ['نظرة سريعة على المتجر والموقع.', 'The shop and the website at a glance.'],
    async render(el, ctx) {
      const [o, e] = await Promise.all([A.api('GET', 'overview'), A.api('GET', 'ecwid')]);
      if (ctx.stale()) return;
      if (!o.ok) { el.innerHTML = '<div class="note note--bad">' + esc(o.message || 'error') + '</div>'; return; }
      /* Each part is null when this admin may not view its section. */
      if (o.orders) A.setBadge('orders', o.orders.awaiting || 0);
      const tile = (href, k, v, s, cls) => '<a class="tile ' + (cls || '') + '" href="' + href + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</a>';
      const f = o.funnel || [];
      const stage = k => { const r = (f || []).find(x => x.stage === k); return r ? r.people : 0; };
      el.innerHTML =
        (o.ecwidConnected ? '' : '<div class="note note--bad" style="margin-bottom:14px">' + t('إكويد غير متصل، فصفحات المتجر لن تعمل.', 'Ecwid is not connected, so the store pages will not work.') + '</div>') +
        (o.orders && o.orders.parked ? '<div class="note note--bad" style="margin-bottom:14px"><b>' + A.num(o.orders.parked) + '</b> ' +
          t('طلب لم يصل إلى إكويد بعد عدة محاولات. ', 'orders could not reach Ecwid after several tries. ') + '<a href="#/orders">' + t('افتح الطلبات', 'Open orders') + '</a></div>' : '') +
        '<div class="grid grid--tiles">' +
          (o.orders ? tile('#/orders', t('طلبات بانتظار التجهيز', 'Orders awaiting processing'), A.num(o.orders.awaiting), t('من إجمالى ', 'of ') + A.num(o.orders.total), o.orders.awaiting ? 'tile--warn' : '') +
            tile('#/orders', t('لم تصل إكويد بعد', 'Not in Ecwid yet'), A.num(o.orders.pending + o.orders.parked), t('تُعاد المحاولة تلقائياً', 'retried automatically'), o.orders.parked ? 'tile--bad' : '') : '') +
          (o.products ? tile('#/products', t('منتجات معروضة', 'Products on sale'), A.num(o.products.on), A.num(o.products.off) + t(' مخفى · ', ' hidden · ') + A.num(o.products.out) + t(' نفد', ' out of stock')) : '') +
          (o.coupons ? tile('#/coupons', t('كوبونات مفعّلة', 'Active coupons'), A.num(o.coupons.active), t('من ', 'of ') + A.num(o.coupons.total)) : '') +
          (o.accounts ? tile('#/customers', t('حسابات على الموقع', 'Website accounts'), A.num(o.accounts.users ?? o.accounts.accounts ?? 0), '') : '') +
          (o.funnel ? tile('#/products', t('زيارات ← سلة ← شراء', 'Views → cart → purchase'), A.num(stage('view')) + ' → ' + A.num(stage('add_to_cart')) + ' → ' + A.num(stage('purchase')), t('أشخاص مختلفون', 'unique people')) : '') +
        '</div>' +
        (o.leftovers ? '<div class="note note--warn" style="margin-top:14px">' + t('توجد تعديلات قديمة محفوظة على الموقع بدلاً من إكويد. ', 'There are old edits saved on the website instead of Ecwid. ') +
          '<a href="#/products">' + t('راجعها', 'Review them') + '</a></div>' : '') +
        '<div class="grid grid--2" style="margin-top:14px">' +
          '<div class="card"><h2><span class="lft">' + t('الاتصال بإكويد', 'Ecwid connection') + ' ' + A.srcTag('ecwid') + '</span>' +
            (A.can('products', true) ? '<button class="btn btn--ghost btn--sm" id="syncBtn">' + t('مزامنة الآن', 'Sync now') + '</button>' : '') + '</h2>' + ecwidBox(e) + '</div>' +
          (o.audit ? '<div class="card"><h2>' + t('آخر النشاط', 'Recent activity') + '</h2>' + activity(o.audit) +
            '<a class="btn btn--quiet btn--sm" href="#/activity">' + t('كل النشاط', 'All activity') + '</a></div>' : '') +
        '</div>';
      const syncBtn = el.querySelector('#syncBtn');
      if (syncBtn) syncBtn.onclick = async ev => {
        ev.target.disabled = true; ev.target.innerHTML = '<span class="spin spin--sm"></span>';
        const r = await A.api('POST', 'ecwid/sync', {});
        A.report(r, t('تمت المزامنة.', 'Synced.'));
        A.rerender();
      };
    },
  });
  function ecwidBox(e) {
    if (!e || !e.ok || !e.ecwid) return '<p class="muted">' + t('غير متاح.', 'Not available.') + '</p>';
    const d = e.ecwid;
    /* lastSync / lastError are { at, ... } records, not bare values. */
    const at = v => (v && typeof v === 'object' ? v.at : v);
    const errText = v => (v && typeof v === 'object' ? (v.message || v.error || JSON.stringify(v)) : v);
    return '<dl class="kv"><dt>' + t('المتجر', 'Store') + '</dt><dd class="ltr">' + esc(e.storeId) + '</dd>' +
      '<dt>' + t('المصدر', 'Serving from') + '</dt><dd>' + (d.source === 'ecwid' ? t('إكويد', 'Ecwid') : esc(d.source || '-')) + '</dd>' +
      '<dt>' + t('منتجات على الموقع', 'Products on the site') + '</dt><dd>' + A.num(d.served) + '</dd>' +
      '<dt>' + t('آخر مزامنة', 'Last sync') + '</dt><dd>' + esc(A.date(at(d.lastSync), true)) + '</dd>' +
      (d.lastError ? '<dt>' + t('آخر خطأ', 'Last error') + '</dt><dd class="small" style="color:var(--bad)">' + esc(String(errText(d.lastError)).slice(0, 160)) + '</dd>' : '') +
      '</dl>';
  }
  function activity(rows) {
    if (!rows.length) return '<p class="muted">' + t('لا يوجد نشاط بعد.', 'No activity yet.') + '</p>';
    return '<div class="lines">' + rows.slice(0, 8).map(r => '<div class="small"><b>' + esc(actionName(r.action)) + '</b> ' +
      (r.target ? '<span class="muted ltr">' + esc(String(r.target).slice(0, 40)) + '</span> ' : '') +
      '<span class="muted">· ' + esc(r.actor || '') + ' · ' + esc(A.date(r.at, true)) + '</span></div>').join('') + '</div>';
  }
  const ACTIONS = {
    'ecwid.product.edit': ['تعديل منتج', 'Product edited'], 'ecwid.product.image': ['صورة منتج', 'Product picture'],
    'ecwid.order.edit': ['تحديث طلب', 'Order updated'], 'ecwid.coupon.create': ['كوبون جديد', 'Coupon created'],
    'ecwid.coupon.edit': ['تعديل كوبون', 'Coupon edited'], 'ecwid.coupon.delete': ['حذف كوبون', 'Coupon deleted'],
    'ecwid.payment.edit': ['طريقة دفع', 'Payment method'], 'ecwid.delivery.toggle': ['طريقة توصيل', 'Delivery method'],
    'ecwid.ad.create': ['إعلان جديد', 'Ad added'], 'ecwid.ad.edit': ['تعديل إعلان', 'Ad edited'], 'ecwid.ad.move': ['ترتيب إعلان', 'Ad moved'],
    'ecwid.ad.delete': ['حذف إعلان', 'Ad deleted'], 'content.save': ['حفظ محتوى', 'Content saved'], 'setting.set': ['إعداد', 'Setting'],
    'admin.invite': ['دعوة مسؤول', 'Admin invited'], 'admin.remove': ['حذف مسؤول', 'Admin removed'], 'admin.perms': ['صلاحيات مسؤول', 'Admin access changed'], 'admin.master': ['تعيين المسؤول الرئيسى', 'Master admin set'],
    'ecwid.rail.add': ['إضافة لشريط', 'Added to a rail'], 'ecwid.rail.remove': ['إخراج من شريط', 'Removed from a rail'], 'ecwid.category.image': ['صورة فئة', 'Category picture'], 'ecwid.sync': ['مزامنة', 'Sync'],
    'leftovers.discard': ['حذف تعديلات قديمة', 'Old edits discarded'], 'ecwid.order.retry': ['إعادة إرسال طلب', 'Order resent'],
  };
  const actionName = a => (ACTIONS[a] ? t(ACTIONS[a][0], ACTIONS[a][1]) : a);
  A.actionName = actionName;

  /* =================== home scenes =================== */
  /* The structure each scene's picture comes from (index.html SECTIONS): the
     clip, the room's showcase progress (`at`), its `linger`, and the phone
     still. engine/scenes.test.mjs checks these against index.html. */
  const MEDIA = {
    living: { clip: 'assets/vid/leg_1v8.mp4', at: 0.03, linger: 0.5, still: 'assets/img/still_1v8.jpg', phone: 'assets/img/m_living_v6.jpg' },
    kitchen: { clip: 'assets/vid/leg_2v8.mp4', at: 0.92, linger: 0.5, still: 'assets/img/still_2.jpg', phone: 'assets/img/m_kitchen.jpg?v=2' },
    laundry: { clip: 'assets/vid/leg_3.mp4', at: 0.50, linger: 0.45, still: 'assets/img/still_3.jpg', phone: 'assets/img/m_laundry.jpg?v=2' },
    shop: { clip: 'assets/vid/leg_4.mp4', at: 0.22, linger: 0, clipEnd: 0.22, still: 'assets/img/still_shop.jpg', phone: 'assets/img/m_laundry.jpg?v=2', textOnly: true },
  };
  /* The clip time the home page shows at a scroll progress: scrub-engine.js
     eases progress through `linger` (lingerEase) and scales by clipEnd. The
     editor once used progress × duration, a different frame with the camera
     still moving (living room: 0.24 s instead of 0.46 s), so points lined up
     here missed their appliances on the site. */
  const lingerEase = (x, L) => { const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  const frameTime = m => (m.linger ? lingerEase(m.at, m.linger) : m.at) * (m.clipEnd || 1);
  const BLOBS = {};
  const blobFor = src => BLOBS[src] || (BLOBS[src] = fetch(src).then(r => (r.ok ? r.blob() : null))
    .then(b => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  A.sceneFrameTime = frameTime;
  A.page('scenes', {
    group: 'site', icon: 'scene', label: ['مشاهد الصفحة الرئيسية', 'Home scenes'], source: 'site',
    sub: ['النصوص والنقاط التى يضغط عليها الزائر فى كل غرفة.', 'The text and the points visitors tap in each room.'],
    async render(el, ctx) {
      const [c, targets] = await Promise.all([A.api('GET', 'content/scenes'), A.api('GET', 'site/link-targets')]);
      if (ctx.stale()) return;
      let data; try { data = JSON.parse(c.json); } catch (e) { data = null; }
      if (!data || !Array.isArray(data.scenes)) { el.innerHTML = '<div class="note note--bad">' + t('ملف المشاهد غير صالح.', 'The scenes file is not valid.') + '</div>'; return; }
      const st = { i: 0, view: 'desk', sel: -1, dirty: false };
      const save = document.createElement('button');
      save.className = 'btn'; save.textContent = t('حفظ التغييرات', 'Save changes'); save.disabled = true;
      const view = document.createElement('a');
      view.className = 'btn btn--ghost'; view.href = './'; view.target = '_blank'; view.innerHTML = I.ext + t('عرض على الموقع', 'View on site');
      ctx.actions.append(view, save);
      const dirty = () => { st.dirty = true; save.disabled = false; save.textContent = t('حفظ التغييرات •', 'Save changes •'); };
      save.onclick = async () => {
        save.disabled = true;
        const r = await A.api('PUT', 'content/scenes', { json: JSON.stringify(data, null, 2) });
        if (A.report(r, t('تم الحفظ. يظهر على الموقع خلال دقيقة.', 'Saved. Live on the site within a minute.'))) { st.dirty = false; save.textContent = t('حفظ التغييرات', 'Save changes'); }
        else save.disabled = false;
      };
      window.onbeforeunload = () => (st.dirty ? true : undefined);

      const linkOptions = href => {
        const opt = (o, sel) => '<option value="' + esc(o.href) + '"' + (o.href === sel ? ' selected' : '') + '>' + esc(o.name) + '</option>';
        const all = [].concat(targets.built || [], targets.live || [], targets.pages || []);
        return (all.some(o => o.href === href) ? '' : '<option value="' + esc(href) + '" selected>' + esc(href) + '</option>') +
          '<optgroup label="' + t('صفحات الأقسام', 'Category pages') + '">' + (targets.built || []).map(o => opt(o, href)).join('') + '</optgroup>' +
          '<optgroup label="' + t('أقسام إكويد (المتجر مفلتراً)', 'Ecwid categories (filtered shop)') + '">' + (targets.live || []).map(o => opt(o, href)).join('') + '</optgroup>' +
          '<optgroup label="' + t('صفحات الموقع', 'Site pages') + '">' + (targets.pages || []).map(o => opt(o, href)).join('') + '</optgroup>';
      };

      function paint() {
        const sc = data.scenes[st.i], media = MEDIA[sc.id] || {};
        const pair = (k, label) => sc[k] ? '<div class="pair">' +
          A.field(label + ' (' + t('عربى', 'Arabic') + ')', '<input class="input" data-k="' + k + '" data-l="ar" value="' + esc(sc[k].ar) + '" dir="rtl">') +
          A.field(label + ' (' + t('إنجليزى', 'English') + ')', '<input class="input" data-k="' + k + '" data-l="en" value="' + esc(sc[k].en) + '" dir="ltr">') + '</div>' : '';
        el.innerHTML =
          '<div class="tabs">' + data.scenes.map((s, i) => '<button data-scene="' + i + '" class="' + (i === st.i ? 'on' : '') + '">' + (i + 1) + ' · ' + esc(t(s.label.ar, s.label.en || s.label.ar)) + '</button>').join('') + '</div>' +
          '<div class="card"><h2>' + t('نص المشهد', 'Scene text') + '</h2>' +
            pair('label', t('اسم الغرفة', 'Room name')) + pair('eyebrow', t('السطر الصغير', 'Small line')) + pair('title', t('العنوان', 'Title')) +
            pair('showcaseLabel', t('زر العرض', 'Showcase button')) + '</div>' +
          (media.textOnly ? '<div class="note" style="margin-top:12px">' + t('هذا المشهد هو الانتقال إلى المتجر، وليس فيه نقاط.', 'This scene is the hand-off to the shop; it has no points.') + '</div>' :
          '<div class="card"><h2><span class="lft">' + t('النقاط القابلة للضغط', 'Clickable points') + ' <span class="chip">' + A.num(sc.hotspots.length) + '</span></span>' +
            '<span class="seg"><button data-view="desk" class="' + (st.view === 'desk' ? 'on' : '') + '">' + t('كمبيوتر', 'Desktop') + '</button>' +
            '<button data-view="phone" class="' + (st.view === 'phone' ? 'on' : '') + '">' + t('موبايل', 'Phone') + '</button></span></h2>' +
            '<div class="scene-ed"><div><div class="stage ' + (st.view === 'desk' ? 'stage--desk' : 'stage--phone') + '" id="stage">' +
              (st.view === 'desk'
                ? '<img class="bg" id="still" src="' + media.still + '" alt=""><video id="vid" muted playsinline preload="auto" style="position:absolute;inset:0;opacity:0"></video>'
                : '<img class="bg" src="' + media.phone + '" alt="">') +
              sc.hotspots.map((h, i) => pinHtml(h, i)).join('') +
              '<div class="stage__hint">' + t('اسحب النقطة لتحريكها', 'Drag a point to move it') + '</div></div>' +
              (st.view === 'desk' ? '<p class="tiny muted" style="margin:6px 0 0">' + t('الصورة هى اللحظة من فيديو الغرفة التى قيست عليها النقاط.', 'The picture is the moment of the room video the points were measured on.') + '</p>' : '') +
            '</div><div id="pinSide"></div></div></div>');
        bind();
      }
      function pinHtml(h, i) {
        const x = st.view === 'desk' ? h.fx : (h.mfx ?? h.fx), y = st.view === 'desk' ? h.fy : (h.mfy ?? h.fy);
        return '<button class="pin' + (i === st.sel ? ' sel' : '') + (x < 0.5 ? ' pin--r' : ' pin--l') + '" data-pin="' + i + '" style="left:' + (x * 100) + '%;top:' + (y * 100) + '%"><i>' + esc(t(h.label.ar, h.label.en || h.label.ar)) + '</i></button>';
      }
      function paintSide() {
        const box = el.querySelector('#pinSide');
        if (!box) return;
        const sc = data.scenes[st.i];
        const h = sc.hotspots[st.sel];
        const list = '<div class="pin-list">' + sc.hotspots.map((p, i) => '<button data-pick="' + i + '" class="' + (i === st.sel ? 'on' : '') + '"><span>' +
          esc(t(p.label.ar, p.label.en || p.label.ar)) + '</span><span class="muted tiny ltr">' + esc(p.href.replace('.html', '')) + '</span></button>').join('') + '</div>';
        box.innerHTML = (h
          ? '<div class="card" style="padding:12px 14px"><h2 style="font-size:14px">' + t('النقطة المحددة', 'Selected point') + '</h2>' +
            A.field(t('الاسم بالعربى', 'Name in Arabic'), '<input class="input" data-p="ar" value="' + esc(h.label.ar) + '" dir="rtl">') +
            A.field(t('الاسم بالإنجليزى', 'Name in English'), '<input class="input" data-p="en" value="' + esc(h.label.en || '') + '" dir="ltr">') +
            A.field(t('تفتح صفحة', 'Opens'), '<select class="select" data-p="href">' + linkOptions(h.href) + '</select>') +
            '<div class="small muted" style="margin-bottom:10px">' + t('الموضع: ', 'Position: ') + '<span dir="ltr" class="ltr">↔ ' +
              Math.round((st.view === 'desk' ? h.fx : h.mfx) * 100) + '%  ↕ ' + Math.round((st.view === 'desk' ? h.fy : h.mfy) * 100) + '%</span> · ' +
              (st.view === 'desk' ? t('كمبيوتر', 'desktop') : t('موبايل', 'phone')) + '</div>' +
            '<button class="btn btn--ghost btn--bad btn--sm" id="delPin">' + I.trash + t('حذف النقطة', 'Remove point') + '</button></div>'
          : '<p class="small muted" style="margin:0 0 8px">' + t('اختر نقطة من الصورة أو من القائمة لتعديلها.', 'Pick a point on the picture or in the list to edit it.') + '</p>') +
          '<button class="btn btn--sm" id="addPin" style="margin-top:10px">' + t('+ إضافة نقطة', '+ Add a point') + '</button>' + list;
        box.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => select(Number(b.dataset.pick)); });
        box.querySelector('#addPin').onclick = () => {
          sc.hotspots.push({ label: { ar: 'نقطة جديدة', en: 'New point' }, href: 'shop.html', fx: 0.5, fy: 0.5, mfx: 0.5, mfy: 0.5,
                             at: (MEDIA[sc.id] || {}).at || 0.5, span: 0.28 });
          st.sel = sc.hotspots.length - 1; dirty(); paint();
        };
        if (!h) return;
        box.querySelectorAll('[data-p]').forEach(inp => {
          inp.oninput = inp.onchange = () => {
            if (inp.dataset.p === 'href') h.href = inp.value; else h.label[inp.dataset.p] = inp.value;
            dirty();
            const pin = el.querySelector('[data-pin="' + st.sel + '"] i');
            if (pin) pin.textContent = t(h.label.ar, h.label.en || h.label.ar);
          };
        });
        box.querySelector('#delPin').onclick = async () => {
          if (!(await A.confirm(t('حذف هذه النقطة؟', 'Remove this point?'), t('حذف', 'Remove'), true))) return;
          sc.hotspots.splice(st.sel, 1); st.sel = -1; dirty(); paint();
        };
      }
      function select(i) {
        st.sel = i;
        el.querySelectorAll('.pin').forEach(p => p.classList.toggle('sel', Number(p.dataset.pin) === i));
        paintSide();
      }
      function bind() {
        el.querySelectorAll('[data-scene]').forEach(b => { b.onclick = () => { st.i = Number(b.dataset.scene); st.sel = -1; paint(); }; });
        el.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => { st.view = b.dataset.view; paint(); }; });
        el.querySelectorAll('[data-k]').forEach(inp => {
          inp.oninput = () => { data.scenes[st.i][inp.dataset.k][inp.dataset.l] = inp.value; dirty(); };
        });
        const stage = el.querySelector('#stage');
        if (!stage) return;
        /* The exact frame: seek the room's clip to the measured moment. */
        const vid = el.querySelector('#vid');
        if (vid) {
          const media = MEDIA[data.scenes[st.i].id];
          /* As a Blob, like scrub-engine.js: a clip streamed from a server that
             does not answer byte ranges cannot seek, and stayed on frame 0, so
             the editor showed the opening still instead of the measured frame. */
          blobFor(media.clip).then(url => {
            if (!url || !document.body.contains(vid)) return;
            vid.onloadedmetadata = () => { vid.currentTime = Math.max(0, Math.min(vid.duration - 0.05, frameTime(media) * vid.duration)); };
            vid.onseeked = () => { vid.style.opacity = 1; };
            vid.src = url;
          });
        }
        const sc = data.scenes[st.i];
        stage.querySelectorAll('.pin').forEach(pin => {
          const i = Number(pin.dataset.pin);
          pin.onpointerdown = ev => {
            ev.preventDefault();
            if (st.sel !== i) select(i);
            pin.setPointerCapture(ev.pointerId);
            const rect = stage.getBoundingClientRect();
            const move = e => {
              const x = Math.min(0.99, Math.max(0.01, (e.clientX - rect.left) / rect.width));
              const y = Math.min(0.99, Math.max(0.01, (e.clientY - rect.top) / rect.height));
              const h = sc.hotspots[i];
              if (st.view === 'desk') { h.fx = round(x); h.fy = round(y); if (h.sfx != null) { h.sfx = h.fx; h.sfy = h.fy; } }
              else { h.mfx = round(x); h.mfy = round(y); }
              pin.style.left = x * 100 + '%'; pin.style.top = y * 100 + '%';
              pin.classList.toggle('pin--r', x < 0.5); pin.classList.toggle('pin--l', x >= 0.5);
              dirty();
            };
            const up = () => { pin.removeEventListener('pointermove', move); pin.removeEventListener('pointerup', up); paintSide(); };
            pin.addEventListener('pointermove', move);
            pin.addEventListener('pointerup', up);
          };
        });
        paintSide();
      }
      const round = v => Math.round(v * 1000) / 1000;
      paint();
    },
  });

  /* =================== ads by page (Ecwid) =================== */
  const SLOT_NAMES = { hero: ['البانر الرئيسى المتحرك', 'Top rotating banner'], wide: ['لافتات عريضة', 'Wide strips'], square: ['مربعات الإعلانات', 'Square tiles'] };
  const PAGE_NAMES = { shop: ['المتجر', 'Shop'], contact: ['تواصل معنا', 'Contact'], delivery: ['التوصيل', 'Delivery'], finder: ['مساعد الاختيار', 'Finder'],
    guides: ['دليلك للاختيار', 'Buying guides'], care: ['الصيانة', 'Care'], plan: ['خطط التقسيط', 'Plans'], about: ['عن صادكو', 'About'],
    showrooms: ['المعارض', 'Showrooms'], warranty: ['الضمان', 'Warranty'], values: ['قيمنا', 'Values'], index: ['الرئيسية', 'Home'] };
  A.page('ads', {
    group: 'site', icon: 'ad', label: ['الإعلانات حسب الصفحة', 'Ads by page'], source: 'ecwid',
    sub: ['الإعلانات محفوظة فى إكويد. ما تضيفه هنا يُرفع مباشرة إلى إكويد.', 'Ads are kept in Ecwid. What you add here goes straight to Ecwid.'],
    async render(el, ctx) {
      const r = await A.api('GET', 'ads');
      if (ctx.stale()) return;
      if (!r.ok) { el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
      const catName = id => ((r.categories || []).find(c => c.id === String(id)) || {}).name || id;
      const destText = d => !d ? t('بدون رابط', 'No link') : d.kind === 'page' ? t('صفحة: ', 'Page: ') + t(...(PAGE_NAMES[d.value] || [d.value, d.value]))
        : d.kind === 'cat' ? t('قسم: ', 'Category: ') + catName(d.value) : t('منتج رقم ', 'Product #') + d.value;
      // The square tiles are no longer shown anywhere on the site (the shop's ad
      // grid was removed), so their folder is neither listed nor required.
      const missing = Object.keys(r.folders).filter(s => s !== 'square' && !r.folders[s]);
      const st = { tab: ctx.query.get('tab') || 'shop', cat: ctx.query.get('cat') || '' };

      async function paint() {
        el.innerHTML = (missing.length ? '<div class="note note--warn" style="margin-bottom:14px"><b>' + t('مجلدات الإعلانات غير مجهزة فى إكويد. ', 'The ad folders are not set up in Ecwid yet. ') + '</b>' +
            t('سننشئ مجلدات مخفية فى إكويد (لا يراها العملاء) لكل نوع إعلان. حتى ذلك الحين يعرض الموقع إعلاناته المدمجة.', 'We will create hidden folders in Ecwid (customers never see them), one per ad type. Until then the site shows its built-in ads.') +
            ' <button class="btn btn--sm" id="setup" style="margin-inline-start:8px">' + t('تجهيز المجلدات', 'Set up folders') + '</button></div>' : '') +
          '<div class="tabs"><button data-tab="shop" class="' + (st.tab === 'shop' ? 'on' : '') + '">' + t('صفحة المتجر', 'Shop page') + '</button>' +
          '<button data-tab="cat" class="' + (st.tab === 'cat' ? 'on' : '') + '">' + t('صفحات الأقسام', 'Category pages') + '</button></div><div id="adBody">' + A.loading() + '</div>';
        const setup = el.querySelector('#setup');
        if (setup) setup.onclick = async () => { setup.disabled = true; const x = await A.api('POST', 'ads/setup', {}); if (A.report(x, t('تم تجهيز المجلدات فى إكويد.', 'Folders created in Ecwid.'))) A.rerender(); else setup.disabled = false; };
        el.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { st.tab = b.dataset.tab; paint(); }; });
        const body = el.querySelector('#adBody');
        if (st.tab === 'shop') return shopTab(body);
        return catTab(body);
      }

      async function shopTab(body) {
        const pv = await A.api('GET', 'ads/preview');
        body.innerHTML = ['hero', 'wide'].map(slot => {
          const list = r.slots[slot];
          const builtIn = (pv.shop && pv.shop[slot] || []).filter(a => a.source !== 'ecwid');
          return '<div class="card"><h2><span class="lft">' + esc(t(...SLOT_NAMES[slot])) + ' <span class="chip">' + esc(r.shapes[slot].label) + '</span></span>' +
            (list ? '<span class="chip chip--blue">' + A.num(list.length) + t(' فى إكويد', ' in Ecwid') + '</span>' : '') + '</h2>' +
            (list && !list.length && builtIn.length ? '<div class="note" style="margin-bottom:10px">' + t('يعرض الموقع الآن إعلاناته المدمجة هنا (', 'The site currently shows its built-in ads here (') + A.num(builtIn.length) +
              t('). أضف إعلاناً ليحل محلها.', '). Add one to replace them.') + '</div>' : '') +
            '<div class="ads ' + (slot === 'square' ? '' : 'ads--wide') + '">' +
              (list || []).map(ad => adCard(ad, slot, list.length)).join('') +
              (list ? '<div class="ad ad--add" data-add="' + slot + '">+ ' + t('إضافة إعلان', 'Add an ad') + '</div>'
                    : builtIn.map(a => '<div class="ad"><div class="ad__img ad__img--' + (slot === 'square' ? 'square' : 'wide') + '" style="background-image:url(\'' + esc(a.image) + '\')"></div>' +
                        '<div class="ad__b"><span class="chip">' + t('مدمج فى الموقع', 'Built into the site') + '</span></div></div>').join('')) +
            '</div></div>';
        }).join('');
        wireCards(body);
      }

      async function catTab(body) {
        const cats = (r.categories || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        body.innerHTML = '<div class="card"><div class="toolbar"><select class="select grow" id="catSel"><option value="">' + t('اختر قسماً…', 'Choose a category…') + '</option>' +
          cats.map(c => '<option value="' + c.id + '"' + (c.id === st.cat ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div>' +
          '<p class="small muted" style="margin:0">' + t('صفحة القسم تعرض حتى ٣ لافتات عريضة: الموجهة لهذا القسم أولاً، ثم العامة.', 'A category page shows up to 3 wide banners: the ones aimed at it first, then the general ones.') + '</p></div><div id="catBody"></div>';
        const sel = body.querySelector('#catSel');
        sel.onchange = () => { st.cat = sel.value; showCat(); };
        showCat();
        async function showCat() {
          const box = body.querySelector('#catBody');
          if (!st.cat) { box.innerHTML = ''; return; }
          box.innerHTML = A.loading();
          const pv = await A.api('GET', 'ads/preview?cat=' + encodeURIComponent(st.cat));
          const shown = pv.category || [];
          box.innerHTML = '<div class="card"><h2><span class="lft">' + t('ما يظهر الآن على صفحة ', 'What shows now on ') + esc(catName(st.cat)) + '</span>' +
            (r.folders.wide ? '<button class="btn btn--sm" data-add="wide" data-cat="' + st.cat + '">+ ' + t('إعلان لهذا القسم', 'Ad for this category') + '</button>' : '') + '</h2>' +
            (shown.length ? '<div class="ads ads--wide">' + shown.map((a, i) => '<div class="ad"><div class="ad__img ad__img--wide" style="background-image:url(\'' + esc(a.image) + '\')"><span class="pos">' + (i + 1) + '</span></div>' +
              '<div class="ad__b">' + (a.source === 'ecwid' ? A.srcTag('ecwid') : '<span class="chip">' + t('مدمج فى الموقع', 'Built into the site') + '</span>') + ' ' +
              (/[?&]cat=/.test(a.href || '') ? '<span class="chip chip--teal">' + t('موجه لهذا القسم', 'Aimed at this category') + '</span>' : '<span class="chip">' + t('عام', 'General') + '</span>') + '</div></div>').join('') + '</div>'
              : '<p class="empty">' + t('لا توجد لافتات لهذه الصفحة.', 'No banners for this page.') + '</p>') + '</div>';
          wireCards(box);
        }
      }

      function adCard(ad, slot, n) {
        return '<div class="ad"><div class="ad__img ad__img--' + (slot === 'square' ? 'square' : 'wide') + '" style="background-image:url(\'' + esc(ad.image) + '\')"><span class="pos">' + A.num(ad.position || '?') + '</span></div>' +
          '<div class="ad__b"><div class="msg">' + esc(ad.msg.ar || t('بدون رسالة', 'No message')) + '</div>' +
          (ad.msg.en ? '<div class="muted ltr" dir="ltr">' + esc(ad.msg.en) + '</div>' : '<div class="chip chip--warn" style="margin-top:4px">' + t('لا يظهر بالإنجليزية: بدون رسالة إنجليزية', 'Hidden in English: no English message') + '</div>') +
          '<div class="muted" style="margin-top:4px">↪ ' + esc(destText(ad.dest)) + '</div></div>' +
          '<div class="ad__f"><button class="icon-btn" data-move="-1" data-id="' + ad.id + '" title="' + t('تقديم', 'Move earlier') + '"' + (ad.position <= 1 ? ' disabled' : '') + '>' + (A.EN() ? I.up : I.up) + '</button>' +
          '<button class="icon-btn" data-move="1" data-id="' + ad.id + '" title="' + t('تأخير', 'Move later') + '"' + (ad.position >= n ? ' disabled' : '') + '>' + I.down + '</button>' +
          '<button class="btn btn--ghost btn--sm" data-edit="' + ad.id + '" data-slot="' + slot + '">' + I.edit + t('تعديل', 'Edit') + '</button>' +
          '<button class="btn btn--ghost btn--bad btn--sm" data-del="' + ad.id + '">' + I.trash + '</button></div></div>';
      }
      function wireCards(box) {
        box.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => adEditor(b.dataset.add, null, b.dataset.cat ? { kind: 'cat', value: b.dataset.cat } : null); });
        box.querySelectorAll('[data-edit]').forEach(b => {
          b.onclick = () => adEditor(b.dataset.slot, (r.slots[b.dataset.slot] || []).find(a => a.id === b.dataset.edit));
        });
        box.querySelectorAll('[data-move]').forEach(b => {
          b.onclick = async () => { b.disabled = true; const x = await A.api('POST', 'ads/' + b.dataset.id + '/move', { dir: Number(b.dataset.move) }); if (A.report(x)) A.rerender(); };
        });
        box.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = async () => {
            if (!(await A.confirm(t('حذف هذا الإعلان من إكويد؟', 'Delete this ad from Ecwid?'), t('حذف', 'Delete'), true))) return;
            const x = await A.api('DELETE', 'ads/' + b.dataset.del);
            if (A.report(x, t('تم الحذف.', 'Deleted.'))) A.rerender();
          };
        });
      }

      function adEditor(slot, ad, presetDest) {
        const shape = r.shapes[slot];
        const dest = ad ? ad.dest : presetDest || { kind: 'page', value: 'shop' };
        let picked = null;
        const destControl = d => {
          if (d.kind === 'page') return A.select('dval', (r.pages || []).map(p => ({ value: p, label: t(...(PAGE_NAMES[p] || [p, p])) })), d.value);
          if (d.kind === 'cat') return A.select('dval', (r.categories || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(c => ({ value: c.id, label: c.name })), d.value);
          return A.input('dval', d.value, 'dir="ltr" inputmode="numeric" placeholder="' + t('رقم المنتج فى إكويد', 'Ecwid product number') + '"');
        };
        const m = A.modal({
          title: (ad ? t('تعديل إعلان', 'Edit ad') : t('إعلان جديد', 'New ad')) + ' · ' + t(...SLOT_NAMES[slot]),
          body: '<label class="drop" id="drop"><input type="file" accept="image/png,image/jpeg,image/webp" hidden>' +
              (ad && ad.image ? '<img src="' + esc(ad.image) + '" alt="">' : '') +
              '<div><b>' + (ad ? t('استبدال الصورة (اختيارى)', 'Replace the picture (optional)') : t('اختر صورة الإعلان', 'Choose the ad picture')) + '</b></div>' +
              '<div class="small muted">' + t('المقاس المطلوب ', 'Needed size ') + '<span class="ltr">' + esc(shape.label) + '</span>' + t('، حتى ٣ ميجا', ', up to 3 MB') + '</div></label><div id="imgMsg" style="margin-top:8px"></div>' +
            '<div class="row" style="margin-top:12px">' + A.field(t('يفتح عند الضغط', 'Opens when tapped'),
              A.select('dkind', [{ value: 'page', label: t('صفحة من الموقع', 'A site page') }, { value: 'cat', label: t('قسم', 'A category') }, { value: 'product', label: t('منتج', 'A product') }], dest ? dest.kind : 'page')) +
              '<div id="dvalBox">' + A.field(' ', destControl(dest || { kind: 'page', value: 'shop' })) + '</div></div>' +
            A.field(t('رسالة الإعلان بالعربى', 'Ad message in Arabic'), A.input('ar', ad ? ad.msg.ar : '', 'dir="rtl" maxlength="300"'), t('يقرؤها قارئ الشاشة، وتظهر إن لم تُحمَّل الصورة.', 'Read out by screen readers, and shown if the picture fails to load.')) +
            A.field(t('رسالة الإعلان بالإنجليزى', 'Ad message in English'), A.input('en', ad ? ad.msg.en : '', 'dir="ltr" maxlength="300"'), t('بدونها لا يظهر الإعلان على الموقع الإنجليزى.', 'Without it the ad does not show on the English site.')),
          actions: [{ label: t('إلغاء', 'Cancel'), kind: 'btn--ghost' }, { label: t('حفظ فى إكويد', 'Save to Ecwid'), run: async b => {
            const d = A.formData(b);
            if (!ad && !picked) { A.toast(t('اختر صورة الإعلان.', 'Choose the ad picture.'), true); return false; }
            const payload = { dest: { kind: d.dkind, value: d.dval }, ar: d.ar, en: d.en };
            if (picked) payload.image = picked.dataUrl;
            const x = ad ? await A.api('PATCH', 'ads/' + ad.id, payload) : await A.api('POST', 'ads', Object.assign({ slot }, payload));
            if (!A.report(x, t('تم الحفظ فى إكويد.', 'Saved to Ecwid.'))) return false;
            A.rerender();
          } }],
        });
        const b = m.el;
        b.querySelector('select[name=dkind]').onchange = e => { b.querySelector('#dvalBox').innerHTML = A.field(' ', destControl({ kind: e.target.value, value: '' })); };
        const fileIn = b.querySelector('input[type=file]');
        fileIn.onchange = async () => {
          const img = await A.readImage(fileIn.files[0]);
          const msg = b.querySelector('#imgMsg');
          if (!img || img.error) { picked = null; msg.innerHTML = img ? '<div class="note note--bad">' + esc(img.error) + '</div>' : ''; return; }
          const ratio = img.w / img.h, want = shape.ratio;
          let warn = '';
          if (Math.abs(ratio - want) / want > 0.12) warn = t('شكل الصورة لا يناسب هذا المكان. المطلوب ', 'The picture is the wrong shape for this place. It needs ') + shape.label + '.';
          else if (img.w < shape.minW) warn = t('الصورة صغيرة جداً لهذا المكان.', 'The picture is too small for this place.');
          const drop = b.querySelector('#drop');
          let pv = drop.querySelector('img'); if (!pv) { pv = document.createElement('img'); drop.prepend(pv); }
          pv.src = img.dataUrl;
          picked = warn ? null : img;
          msg.innerHTML = warn ? '<div class="note note--bad">' + esc(warn) + ' <span class="ltr">(' + img.w + ' × ' + img.h + ')</span></div>'
                               : '<div class="note note--ok">' + t('المقاس مناسب ', 'Size is right ') + '<span class="ltr">(' + img.w + ' × ' + img.h + ')</span></div>';
        };
      }

      await paint();
    },
  });

  /* =================== the shop page (engine/shop-layout.mjs) ===================
     Section order, titles and sizes, brands and their logos, and category
     choice are the site's (Save). What the offers and best-seller rails
     CONTAIN is Ecwid category membership, and a category's picture is its
     Ecwid image: those buttons write to Ecwid at once. */
  const SECTION_NAMES = {
    brands: ['تسوّق حسب الماركة', 'Shop by brand'], offers: ['عروض صادكو', 'SADKO offers'], adWide: ['إعلان عريض', 'Wide ad'],
    categories: ['تسوّق حسب الفئة', 'Shop by category'], featured: ['مختارات صادكو (خصومات حقيقية)', 'SADKO picks (real discounts)'],
    bestSellers: ['الأكثر مبيعاً', 'Best sellers'],
  };
  const TITLED = ['brands', 'offers', 'categories', 'featured', 'bestSellers'];
  const LIMITED = ['offers', 'featured', 'bestSellers'];
  A.page('shop', {
    group: 'site', icon: 'store', label: ['صفحة المتجر', 'Shop page'],
    sub: ['ترتيب أقسام صفحة المتجر، والماركات وشعاراتها، والعروض، والأكثر مبيعاً، والفئات.', 'The order of the shop page sections, brands and their logos, offers, best sellers and categories.'],
    async render(el, ctx) {
      let r = await A.api('GET', 'shop/layout');
      if (ctx.stale()) return;
      if (!r.ok) { el.innerHTML = '<div class="note note--bad">' + esc(r.message || '') + '</div>'; return; }
      const L = r.layout;
      const save = document.createElement('button');
      save.className = 'btn'; save.textContent = t('حفظ', 'Save'); save.disabled = true;
      const view = document.createElement('a');
      view.className = 'btn btn--ghost'; view.href = 'shop'; view.target = '_blank'; view.innerHTML = I.ext + t('عرض صفحة المتجر', 'View the shop page');
      ctx.actions.append(view, save);
      let dirty = false;
      const touch = () => { dirty = true; save.disabled = false; save.textContent = t('حفظ •', 'Save •'); };
      window.onbeforeunload = () => (dirty ? true : undefined);
      save.onclick = async () => {
        save.disabled = true;
        const x = await A.api('PUT', 'shop/layout', { layout: L });
        if (A.report(x, t('تم الحفظ. يظهر على الموقع خلال دقيقة.', 'Saved. Live on the site within a minute.'))) { dirty = false; save.textContent = t('حفظ', 'Save'); }
        else save.disabled = false;
      };
      const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
      const upDown = (i, n, attr) => '<button class="icon-btn" ' + attr + '="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' title="' + t('لأعلى', 'Up') + '">' + I.up + '</button>' +
        '<button class="icon-btn" ' + attr + '="' + i + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' title="' + t('لأسفل', 'Down') + '">' + I.down + '</button>';
      const seg = (name, val) => '<span class="seg" data-seg="' + name + '"><button data-v="auto" class="' + (val === 'auto' ? 'on' : '') + '">' + t('تلقائى', 'Automatic') +
        '</button><button data-v="manual" class="' + (val === 'manual' ? 'on' : '') + '">' + t('اختيار يدوى', 'Hand-picked') + '</button></span>';
      const pickImage = () => new Promise(res => {
        const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp';
        f.onchange = async () => { const img = await A.readImage(f.files[0]); if (img && img.error) A.toast(img.error, true); res(img && !img.error ? img : null); };
        f.click();
      });

      function paint() {
        el.innerHTML = sectionsCard() + brandsCard() + railCard('offers') + railCard('bestSellers') + categoriesCard();
        wire();
      }

      /* ---- sections ---- */
      function sectionsCard() {
        return '<div class="card"><h2>' + t('أقسام الصفحة وترتيبها', 'Page sections and their order') + '</h2>' +
          '<p class="small muted" style="margin:0 0 10px">' + t('البانر الرئيسى والبحث يبقيان فى الأعلى دائماً.', 'The top banner and the search box always stay at the top.') + '</p>' +
          '<div class="lines">' + L.sections.map((s, i) => {
            const custom = L.titles[s.key] || { ar: '', en: '' };
            return '<div class="card" style="padding:10px 12px;margin:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
              upDown(i, L.sections.length, 'data-sec') + '<b style="flex:1;min-width:160px">' + esc(t(...SECTION_NAMES[s.key])) + '</b>' +
              (LIMITED.includes(s.key) ? '<label class="small muted">' + t('عدد المنتجات', 'Products') + ' <input class="input" type="number" min="1" max="24" style="width:70px;display:inline-block" data-limit="' + s.key + '" value="' + L.limits[s.key] + '"></label>' : '') +
              '<label class="check">' + A.sw('on', s.on, 'data-on="' + i + '"') + ' ' + t('ظاهر', 'Shown') + '</label></div>' +
              (TITLED.includes(s.key) ? '<div class="pair" style="margin-top:8px">' +
                '<input class="input" dir="rtl" data-title="' + s.key + '" data-l="ar" placeholder="' + esc(SECTION_NAMES[s.key][0]) + '" value="' + esc(custom.ar) + '">' +
                '<input class="input" dir="ltr" data-title="' + s.key + '" data-l="en" placeholder="' + esc(SECTION_NAMES[s.key][1]) + '" value="' + esc(custom.en) + '"></div>' : '') +
              '</div>';
          }).join('') + '</div><p class="tiny muted" style="margin:8px 0 0">' + t('اترك العنوان فارغاً لاستخدام العنوان الأصلى.', 'Leave a title empty to keep the original one.') + '</p></div>';
      }

      /* ---- brands ---- */
      const brandByKey = k => r.brands.find(b => b.key === k);
      function shownBrands() {
        return L.brands.mode === 'manual' ? L.brands.pick.map(brandByKey).filter(Boolean) : r.brands.slice(0, L.brands.max);
      }
      function brandsCard() {
        const list = shownBrands();
        const others = r.brands.filter(b => !L.brands.pick.includes(b.key));
        return '<div class="card"><h2><span class="lft">' + t('الماركات', 'Brands') + ' ' + A.srcTag('site') + '</span>' + seg('brands', L.brands.mode) + '</h2>' +
          (L.brands.mode === 'auto'
            ? '<p class="small muted" style="margin:0 0 10px">' + t('تظهر الماركات الأكثر منتجات. العدد: ', 'The brands with the most products are shown. How many: ') +
              '<input class="input" type="number" min="1" max="30" style="width:70px;display:inline-block" id="bMax" value="' + L.brands.max + '"></p>'
            : '<div class="toolbar"><select class="select grow" id="bAdd"><option value="">' + t('+ أضف ماركة…', '+ Add a brand…') + '</option>' +
              others.map(b => '<option value="' + esc(b.key) + '">' + esc(t(b.ar, b.en)) + ' (' + A.num(b.count) + ')</option>').join('') + '</select></div>') +
          '<div class="tbl-wrap"><table class="tbl"><tbody>' + list.map((b, i) => {
            const nm = L.brands.names[b.key] || { ar: '', en: '' };
            const logo = L.brands.logos[b.key] || b.logo;
            return '<tr><td style="width:64px">' + (logo ? '<img class="thumb" style="object-fit:contain;background:#fff" src="' + esc(logo) + '" alt="">' : '<div class="thumb" style="display:grid;place-items:center;font-weight:800">' + esc(String(b.en || b.ar).slice(0, 2)) + '</div>') + '</td>' +
              '<td><b>' + esc(t(b.ar, b.en)) + '</b> <span class="chip">' + A.num(b.count) + '</span>' +
              (logo ? '' : ' <span class="chip chip--warn">' + t('بدون شعار', 'No logo') + '</span>') +
              '<div class="pair" style="margin-top:6px"><input class="input" dir="rtl" data-bname="' + esc(b.key) + '" data-l="ar" placeholder="' + esc(b.ar) + '" value="' + esc(nm.ar) + '">' +
              '<input class="input" dir="ltr" data-bname="' + esc(b.key) + '" data-l="en" placeholder="' + esc(b.en) + '" value="' + esc(nm.en) + '"></div></td>' +
              '<td style="white-space:nowrap"><button class="btn btn--ghost btn--sm" data-logo="' + esc(b.key) + '">' + t('رفع شعار', 'Upload logo') + '</button>' +
              (L.brands.logos[b.key] ? ' <button class="btn btn--quiet btn--sm" data-unlogo="' + esc(b.key) + '">' + t('إزالة', 'Remove') + '</button>' : '') + '</td>' +
              (L.brands.mode === 'manual' ? '<td style="white-space:nowrap">' + upDown(i, list.length, 'data-bmove') +
                ' <button class="icon-btn" data-bdel="' + esc(b.key) + '" title="' + t('حذف', 'Remove') + '">' + I.x + '</button></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div><p class="tiny muted" style="margin:8px 0 0">' +
          t('الأسماء اختيارية: اتركها فارغة لاستخدام الاسم المعروف. الشعار يُرفع فوراً ويُحفظ على الموقع.', 'Names are optional: leave them empty to keep the known name. A logo uploads at once and is kept on the site.') + '</p></div>';
      }

      /* ---- the two Ecwid rails ---- */
      function railCard(key) {
        const rail = r.rails[key];
        const title = key === 'offers' ? t('عروض صادكو', 'SADKO offers') : t('الأكثر مبيعاً', 'Best sellers');
        if (!rail.categoryId) return '<div class="card"><h2>' + title + '</h2><div class="note note--warn">' +
          t('لا يوجد قسم فى إكويد لهذا الشريط.', 'There is no Ecwid category for this rail.') + '</div></div>';
        return '<div class="card"><h2><span class="lft">' + title + ' ' + A.srcTag('ecwid') + ' <span class="chip">' + A.num(rail.products.length) + '</span></span></h2>' +
          '<p class="small muted" style="margin:0 0 10px">' + t('المنتجات هنا هى منتجات قسم «', 'These are the products in the Ecwid category “') + esc(rail.name || '') +
          t('» فى إكويد. الإضافة والحذف يحدثان فى إكويد فوراً، والترتيب يُحفظ بزر حفظ. المنتجات غير المتاحة لا تظهر فى الشريط.', '”. Adding and removing happen in Ecwid at once; the order is kept with Save. Products that cannot be bought are left out of the rail.') + '</p>' +
          '<div class="toolbar"><input class="input grow" data-search="' + key + '" placeholder="' + t('ابحث عن منتج لإضافته…', 'Search for a product to add…') + '"></div><div data-results="' + key + '"></div>' +
          '<div class="tbl-wrap"><table class="tbl"><tbody>' + (rail.products.length ? rail.products.map((p, i) =>
            '<tr><td style="width:56px">' + (p.image ? '<img class="thumb" src="' + esc(p.image) + '" alt="" loading="lazy">' : '') + '</td><td><b>' + esc(p.title) + '</b>' +
            (!p.onSale ? ' <span class="chip chip--bad">' + t('غير معروض', 'Not on sale') + '</span>' : !p.inStock ? ' <span class="chip chip--warn">' + t('نفد', 'Out of stock') + '</span>' : '') + '</td>' +
            '<td class="num">' + A.money(p.price) + '</td><td style="white-space:nowrap">' + upDown(i, rail.products.length, 'data-rmove-' + key) +
            ' <button class="icon-btn" data-rdel="' + key + '" data-id="' + p.id + '" title="' + t('إخراج من الشريط', 'Take out of the rail') + '">' + I.x + '</button></td></tr>').join('')
            : '<tr><td class="empty">' + t('لا منتجات بعد.', 'No products yet.') + '</td></tr>') + '</tbody></table></div></div>';
      }

      /* ---- categories ---- */
      const catById = id => r.categories.find(c => c.id === String(id));
      function shownCats() {
        return L.categories.mode === 'manual' ? L.categories.pick.map(catById).filter(Boolean) : r.categories;
      }
      function categoriesCard() {
        const list = shownCats();
        const others = r.categories.filter(c => !L.categories.pick.includes(c.id));
        return '<div class="card"><h2><span class="lft">' + t('تسوّق حسب الفئة', 'Shop by category') + '</span>' + seg('cats', L.categories.mode) + '</h2>' +
          (L.categories.mode === 'auto' ? '<p class="small muted" style="margin:0 0 10px">' + t('تظهر كل الفئات التى بها منتجات.', 'Every category that has products is shown.') + '</p>'
            : '<div class="toolbar"><select class="select grow" id="cAdd"><option value="">' + t('+ أضف فئة…', '+ Add a category…') + '</option>' +
              others.map(c => '<option value="' + c.id + '">' + esc(c.name) + ' (' + A.num(c.count) + ')</option>').join('') + '</select></div>') +
          '<div class="tbl-wrap"><table class="tbl"><tbody>' + list.map((c, i) =>
            '<tr><td style="width:64px">' + (c.image ? '<img class="thumb" style="object-fit:contain;background:#fff" src="' + esc(c.image) + '" alt="">' : '<div class="thumb"></div>') + '</td>' +
            '<td><b>' + esc(c.name) + '</b> <span class="chip">' + A.num(c.count) + '</span></td>' +
            '<td style="white-space:nowrap"><button class="btn btn--ghost btn--sm" data-cimg="' + c.id + '">' + t('صورة الفئة', 'Category picture') + '</button></td>' +
            (L.categories.mode === 'manual' ? '<td style="white-space:nowrap">' + upDown(i, list.length, 'data-cmove') +
              ' <button class="icon-btn" data-cdel="' + c.id + '" title="' + t('حذف', 'Remove') + '">' + I.x + '</button></td>' : '') + '</tr>').join('') +
          '</tbody></table></div><p class="tiny muted" style="margin:8px 0 0">' + t('صورة الفئة تُرفع إلى إكويد فوراً.', 'A category picture uploads to Ecwid at once.') + '</p></div>';
      }

      async function reloadRails() {
        const x = await A.api('GET', 'shop/layout');
        if (x.ok) { r.rails = x.rails; r.brands = x.brands; r.categories = x.categories; }
        paint();
      }

      function wire() {
        const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach(n => { n[ev] = e => fn(n, e); });
        on('[data-sec]', 'onclick', b => { move(L.sections, Number(b.dataset.sec), Number(b.dataset.d)); touch(); paint(); });
        on('[data-on]', 'onchange', b => { L.sections[Number(b.dataset.on)].on = b.checked; touch(); });
        on('[data-limit]', 'oninput', b => { L.limits[b.dataset.limit] = Math.min(24, Math.max(1, Number(b.value) || 1)); touch(); });
        on('[data-title]', 'oninput', b => {
          const k = b.dataset.title; L.titles[k] = L.titles[k] || { ar: '', en: '' }; L.titles[k][b.dataset.l] = b.value;
          if (!L.titles[k].ar && !L.titles[k].en) delete L.titles[k];
          touch();
        });
        on('[data-seg]', 'onclick', (s, e) => {
          const v = e.target.dataset.v; if (!v) return;
          if (s.dataset.seg === 'brands') { if (v === 'manual' && !L.brands.pick.length) L.brands.pick = shownBrands().map(b => b.key); L.brands.mode = v; }
          else { if (v === 'manual' && !L.categories.pick.length) L.categories.pick = shownCats().map(c => c.id); L.categories.mode = v; }
          touch(); paint();
        });
        const bMax = el.querySelector('#bMax');
        if (bMax) bMax.oninput = () => { L.brands.max = Math.min(30, Math.max(1, Number(bMax.value) || 1)); touch(); };
        const bAdd = el.querySelector('#bAdd');
        if (bAdd) bAdd.onchange = () => { if (bAdd.value) { L.brands.pick.push(bAdd.value); touch(); paint(); } };
        on('[data-bmove]', 'onclick', b => { move(L.brands.pick, Number(b.dataset.bmove), Number(b.dataset.d)); touch(); paint(); });
        on('[data-bdel]', 'onclick', b => { L.brands.pick = L.brands.pick.filter(k => k !== b.dataset.bdel); touch(); paint(); });
        on('[data-bname]', 'oninput', b => {
          const k = b.dataset.bname; L.brands.names[k] = L.brands.names[k] || { ar: '', en: '' }; L.brands.names[k][b.dataset.l] = b.value;
          if (!L.brands.names[k].ar && !L.brands.names[k].en) delete L.brands.names[k];
          touch();
        });
        on('[data-logo]', 'onclick', async b => {
          const img = await pickImage(); if (!img) return;
          b.disabled = true;
          const x = await A.api('POST', 'shop/brand-logo', { key: b.dataset.logo, data: img.dataUrl });
          if (A.report(x, t('تم رفع الشعار.', 'Logo uploaded.'))) { L.brands.logos[b.dataset.logo] = x.logo; paint(); } else b.disabled = false;
        });
        on('[data-unlogo]', 'onclick', async b => {
          const x = await A.api('POST', 'shop/brand-logo', { key: b.dataset.unlogo, data: null });
          if (A.report(x, t('تمت إزالة الشعار.', 'Logo removed.'))) { delete L.brands.logos[b.dataset.unlogo]; await reloadRails(); }
        });
        for (const key of ['offers', 'bestSellers']) {
          on('[data-rmove-' + key + ']', 'onclick', b => {
            const list = r.rails[key].products; move(list, Number(b.getAttribute('data-rmove-' + key)), Number(b.dataset.d));
            L.order[key] = list.map(p => p.id); touch(); paint();
          });
          const box = el.querySelector('[data-results="' + key + '"]');
          on('[data-search="' + key + '"]', 'oninput', A.debounce(async inp => {
            const q = inp.value.trim();
            if (q.length < 2) { box.innerHTML = ''; return; }
            const x = await A.api('GET', 'store/products?per=10&view=on&q=' + encodeURIComponent(q));
            const inRail = new Set(r.rails[key].products.map(p => p.id));
            box.innerHTML = '<div class="lines" style="margin:0 0 10px">' + ((x.products || []).filter(p => !inRail.has(p.id)).map(p =>
              '<div class="l"><img src="' + esc(p.image || '') + '" alt=""><div style="flex:1"><b class="small">' + esc(p.title) + '</b><div class="tiny muted">' + A.money(p.price) + '</div></div>' +
              '<button class="btn btn--sm" data-radd="' + key + '" data-id="' + p.id + '">' + t('إضافة', 'Add') + '</button></div>').join('') ||
              '<p class="small muted">' + t('لا نتائج.', 'No results.') + '</p>') + '</div>';
            box.querySelectorAll('[data-radd]').forEach(btn => {
              btn.onclick = async () => {
                btn.disabled = true;
                const y = await A.api('POST', 'shop/rail/' + key + '/add', { productId: btn.dataset.id });
                if (A.report(y, t('أضيف فى إكويد.', 'Added in Ecwid.'))) await reloadRails(); else btn.disabled = false;
              };
            });
          }, 350));
        }
        on('[data-rdel]', 'onclick', async b => {
          if (!(await A.confirm(t('إخراج هذا المنتج من الشريط؟ سيُزال من القسم فى إكويد.', 'Take this product out of the rail? It is removed from the category in Ecwid.'), t('إخراج', 'Take out'), true))) return;
          const x = await A.api('POST', 'shop/rail/' + b.dataset.rdel + '/remove', { productId: b.dataset.id });
          if (A.report(x, t('أزيل فى إكويد.', 'Removed in Ecwid.'))) await reloadRails();
        });
        const cAdd = el.querySelector('#cAdd');
        if (cAdd) cAdd.onchange = () => { if (cAdd.value) { L.categories.pick.push(cAdd.value); touch(); paint(); } };
        on('[data-cmove]', 'onclick', b => { move(L.categories.pick, Number(b.dataset.cmove), Number(b.dataset.d)); touch(); paint(); });
        on('[data-cdel]', 'onclick', b => { L.categories.pick = L.categories.pick.filter(id => id !== b.dataset.cdel); touch(); paint(); });
        on('[data-cimg]', 'onclick', async b => {
          const img = await pickImage(); if (!img) return;
          b.disabled = true;
          const x = await A.api('POST', 'shop/category-image/' + b.dataset.cimg, { data: img.dataUrl });
          if (A.report(x, t('تم رفع الصورة إلى إكويد.', 'Picture uploaded to Ecwid.'))) await reloadRails(); else b.disabled = false;
        });
      }

      paint();
    },
  });

  /* =================== structured content editor (guides, finder) ===================
     Any JSON document as a form: an {ar, en} pair is two fields side by side,
     a list of things is a list of collapsible cards you can add to, reorder
     and remove, and keys starting with "_" (notes for developers) are hidden. */
  const KEY_NAMES = { title: ['العنوان', 'Title'], dek: ['المقدمة', 'Intro'], body: ['المحتوى', 'Body'], tags: ['الوسوم', 'Tags'],
    articles: ['المقالات', 'Articles'], slug: ['الرابط', 'Link name'], minutes: ['دقائق القراءة', 'Reading minutes'], categoryIds: ['أقسام إكويد', 'Ecwid categories'],
    type: ['النوع', 'Type'], label: ['الاسم', 'Label'], hint: ['تلميح', 'Hint'], options: ['الاختيارات', 'Options'], value: ['القيمة', 'Value'],
    families: ['العائلات', 'Families'], questions: ['الأسئلة', 'Questions'], ask: ['الأسئلة', 'Questions'], id: ['المعرّف', 'ID'], updated: ['آخر تحديث', 'Updated'],
    items: ['العناصر', 'Items'], name: ['الاسم', 'Name'], text: ['النص', 'Text'], weight: ['الوزن', 'Weight'], role: ['الدور', 'Role'], spec: ['المواصفة', 'Spec'] };
  const keyName = k => (KEY_NAMES[k] ? t(...KEY_NAMES[k]) : String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '));
  const isPair = v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length && Object.keys(v).every(k => k === 'ar' || k === 'en');
  const blankLike = v => Array.isArray(v) ? [] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)])) : typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : '';
  function summaryOf(v, i) {
    if (v && typeof v === 'object') {
      for (const k of ['title', 'label', 'name', 'text', 'ask', 'id', 'slug']) {
        const x = v[k];
        if (isPair(x)) return t(x.ar, x.en || x.ar);
        if (typeof x === 'string' && x) return x;
      }
      if (isPair(v)) return t(v.ar, v.en || v.ar);
      if (typeof v.type === 'string') return v.type + (v.ar ? ': ' + String(v.ar).slice(0, 60) : '');
    }
    return '#' + (i + 1);
  }
  function editor(value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'tree';
    const node = (val, set, label, depth) => {
      if (isPair(val)) {
        const long = String(val.ar || '').length > 70 || String(val.en || '').length > 70;
        const d = document.createElement('div');
        d.innerHTML = '<div class="pair">' +
          A.field((label ? label + ' · ' : '') + t('عربى', 'Arabic'), long ? A.textarea('ar', val.ar, 'dir="rtl"') : A.input('ar', val.ar, 'dir="rtl"')) +
          A.field((label ? label + ' · ' : '') + t('إنجليزى', 'English'), long ? A.textarea('en', val.en, 'dir="ltr"') : A.input('en', val.en, 'dir="ltr"')) + '</div>';
        d.querySelectorAll('[name]').forEach(x => { x.oninput = () => { val[x.name] = x.value; onChange(); }; });
        return d;
      }
      if (Array.isArray(val)) {
        const d = document.createElement('div');
        d.innerHTML = '<div class="field"><span>' + esc(label || '') + ' <span class="chip">' + A.num(val.length) + '</span></span></div>';
        const list = document.createElement('div');
        list.className = val.every(x => x == null || typeof x !== 'object') ? 'prim-list' : 'tree';
        const redraw = () => { list.innerHTML = ''; val.forEach((x, i) => list.appendChild(item(x, i))); };
        const item = (x, i) => {
          if (x == null || typeof x !== 'object') {
            const r = document.createElement('div'); r.className = 'r';
            r.innerHTML = '<input class="input" value="' + esc(x) + '"><button class="icon-btn" title="' + t('حذف', 'Remove') + '">' + I.trash + '</button>';
            r.querySelector('input').oninput = e => { val[i] = typeof x === 'number' ? Number(e.target.value) : e.target.value; onChange(); };
            r.querySelector('button').onclick = () => { val.splice(i, 1); onChange(); redraw(); };
            return r;
          }
          const det = document.createElement('details'); det.className = 'node';
          det.innerHTML = '<summary><span>' + esc(summaryOf(x, i)) + '</span><span class="tools">' +
            '<button class="icon-btn" data-a="up" title="' + t('لأعلى', 'Up') + '">' + I.up + '</button><button class="icon-btn" data-a="down" title="' + t('لأسفل', 'Down') + '">' + I.down + '</button>' +
            '<button class="icon-btn" data-a="dup" title="' + t('نسخ', 'Duplicate') + '">' + I.copy + '</button><button class="icon-btn" data-a="del" title="' + t('حذف', 'Remove') + '">' + I.trash + '</button></span></summary>';
          const inner = document.createElement('div'); inner.className = 'node__b';
          let built = false;
          det.ontoggle = () => { if (det.open && !built) { built = true; inner.appendChild(node(x, v => { val[i] = v; onChange(); }, '', depth + 1)); } };
          det.appendChild(inner);
          det.querySelectorAll('[data-a]').forEach(b => {
            b.onclick = async e => {
              e.preventDefault(); e.stopPropagation();
              const a = b.dataset.a;
              if (a === 'up' && i > 0) [val[i - 1], val[i]] = [val[i], val[i - 1]];
              else if (a === 'down' && i < val.length - 1) [val[i + 1], val[i]] = [val[i], val[i + 1]];
              else if (a === 'dup') val.splice(i + 1, 0, JSON.parse(JSON.stringify(x)));
              else if (a === 'del') { if (!(await A.confirm(t('حذف هذا العنصر؟', 'Remove this item?'), t('حذف', 'Remove'), true))) return; val.splice(i, 1); }
              else return;
              onChange(); redraw();
            };
          });
          return det;
        };
        redraw();
        const add = document.createElement('button');
        add.className = 'btn btn--ghost btn--sm list-add'; add.textContent = '+ ' + t('إضافة', 'Add');
        add.onclick = () => { val.push(val.length ? blankLike(val[val.length - 1]) : ''); onChange(); redraw(); const last = list.lastElementChild; if (last && last.tagName === 'DETAILS') last.open = true; };
        d.append(list, add);
        return d;
      }
      if (val && typeof val === 'object') {
        const d = document.createElement('div');
        Object.keys(val).filter(k => !k.startsWith('_')).forEach(k => {
          const v = val[k];
          if (v && typeof v === 'object' && !isPair(v) && depth < 6 && !Array.isArray(v)) {
            const det = document.createElement('details'); det.className = 'node'; det.style.marginBottom = '8px';
            det.innerHTML = '<summary><span>' + esc(keyName(k)) + '</span></summary>';
            const inner = document.createElement('div'); inner.className = 'node__b';
            let built = false;
            det.ontoggle = () => { if (det.open && !built) { built = true; inner.appendChild(node(v, nv => { val[k] = nv; onChange(); }, '', depth + 1)); } };
            det.appendChild(inner); d.appendChild(det);
          } else d.appendChild(node(v, nv => { val[k] = nv; onChange(); }, keyName(k), depth + 1));
        });
        return d;
      }
      /* a single value */
      const d = document.createElement('div');
      if (typeof val === 'boolean') {
        d.innerHTML = '<label class="check" style="margin-bottom:10px"><input type="checkbox"' + (val ? ' checked' : '') + '> ' + esc(label) + '</label>';
        d.querySelector('input').onchange = e => { set(e.target.checked); };
      } else if (typeof val === 'number') {
        d.innerHTML = A.field(label, '<input class="input" type="number" step="any" value="' + esc(val) + '" dir="ltr">');
        d.querySelector('input').oninput = e => { set(e.target.value === '' ? 0 : Number(e.target.value)); };
      } else {
        const s = String(val == null ? '' : val);
        d.innerHTML = A.field(label, s.length > 70 || s.includes('\n') ? A.textarea('v', s) : A.input('v', s));
        d.querySelector('[name=v]').oninput = e => { set(e.target.value); };
      }
      return d;
    };
    wrap.appendChild(node(value, () => onChange(), '', 0));
    return wrap;
  }
  function contentPage(key, name, icon, label, sub) {
    A.page(key, {
      group: 'site', icon, label, source: 'site', sub,
      async render(el, ctx) {
        const c = await A.api('GET', 'content/' + name);
        if (ctx.stale()) return;
        let data; try { data = JSON.parse(c.json); } catch (e) { data = null; }
        if (!data) { el.innerHTML = '<div class="note note--bad">' + t('الملف غير صالح.', 'The file is not valid.') + '</div>'; return; }
        const save = document.createElement('button');
        save.className = 'btn'; save.textContent = t('حفظ', 'Save'); save.disabled = true;
        ctx.actions.append(save);
        let dirty = false;
        window.onbeforeunload = () => (dirty ? true : undefined);
        save.onclick = async () => {
          save.disabled = true;
          const r = await A.api('PUT', 'content/' + name, { json: JSON.stringify(data, null, 2) });
          if (A.report(r, t('تم الحفظ. يظهر على الموقع خلال دقيقة.', 'Saved. Live on the site within a minute.'))) { dirty = false; save.textContent = t('حفظ', 'Save'); }
          else save.disabled = false;
        };
        el.innerHTML = '';
        const cardEl = document.createElement('div'); cardEl.className = 'card';
        cardEl.appendChild(editor(data, () => { dirty = true; save.disabled = false; save.textContent = t('حفظ •', 'Save •'); }));
        el.appendChild(cardEl);
      },
    });
  }
  /* The Buying guides editor is switched off with the page itself (nav.js
     HIDDEN_PAGES, 2026-10-31). The content and its API stay; restore this line
     to bring the editor back:
  contentPage('guides', 'guides', 'book', ['دليلك للاختيار', 'Buying guides'], ['المقالات التى تساعد العميل على الاختيار.', 'The articles that help customers choose.']); */
  contentPage('finder', 'finder', 'quiz', ['أسئلة مساعد الاختيار', 'Finder questions'], ['الأسئلة التى يجيب عنها العميل ليصل إلى الجهاز المناسب.', 'The questions customers answer to reach the right appliance.']);

  /* =================== site bar & hotline =================== */
  A.page('site', {
    group: 'site', icon: 'bar', label: ['شريط الموقع والخط الساخن', 'Site bar & hotline'], source: 'site',
    sub: ['رسالة تظهر أسفل كل صفحة، وتنبيه الصيانة، ورقم الخط الساخن.', 'A message at the bottom of every page, a maintenance notice, and the hotline number.'],
    async render(el, ctx) {
      const r = await A.api('GET', 'site/settings');
      if (ctx.stale()) return;
      const s = r.settings;
      const block = (k, title, hint) => '<div class="card"><h2><span class="lft">' + title + '</span><span class="check">' + A.sw(k + '.on', s[k].on) + ' ' + t('مفعّل', 'On') + '</span></h2>' +
        '<p class="small muted" style="margin:0 0 10px">' + hint + '</p><div class="pair">' +
        A.field(t('بالعربى', 'Arabic'), A.input(k + '.ar', s[k].ar, 'dir="rtl" maxlength="300"')) +
        A.field(t('بالإنجليزى', 'English'), A.input(k + '.en', s[k].en, 'dir="ltr" maxlength="300"')) + '</div></div>';
      el.innerHTML = '<form id="sf"><div class="card"><h2>' + t('الخط الساخن', 'Hotline') + '</h2>' +
        A.field(t('الرقم', 'Number'), A.input('hotline', s.hotline, 'dir="ltr" inputmode="tel" style="max-width:220px"'), t('يظهر فى أعلى وأسفل كل صفحة.', 'Shown at the top and bottom of every page.')) + '</div>' +
        block('announcement', t('رسالة للعملاء', 'Announcement'), t('شريط صغير أسفل الشاشة، يغلقه العميل بضغطة.', 'A slim strip at the bottom of the screen that customers can close.')) +
        block('maintenance', t('تنبيه صيانة', 'Maintenance notice'), t('بلون تحذيرى، لوقت الصيانة أو الأعطال.', 'In a warning colour, for maintenance or outages.')) +
        '<div style="margin-top:14px"><button class="btn" type="submit">' + t('حفظ', 'Save') + '</button></div></form>';
      const f = el.querySelector('#sf');
      f.onsubmit = async e => {
        e.preventDefault();
        const d = A.formData(f);
        const note = k => ({ on: d[k + '.on'], ar: d[k + '.ar'], en: d[k + '.en'] });
        const x = await A.api('PUT', 'site/settings', { hotline: d.hotline, announcement: note('announcement'), maintenance: note('maintenance') });
        A.report(x, t('تم الحفظ. يظهر على الموقع خلال دقيقة.', 'Saved. Live on the site within a minute.'));
      };
    },
  });
})();
