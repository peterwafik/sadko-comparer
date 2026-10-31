/* ============================================================================
   SADKO product page — turns a spec sheet into buying guidance.
   ----------------------------------------------------------------------------
   The catalogue gives us a title, a price and a free-text description. This page
   reads that through skSpecs and answers the questions a buyer actually has:
   is it right for my household, will it physically fit, what will it cost to
   run, and what should I know before I commit.

   Two rules run through everything here:
   • Never invent a number. Anything we could not read from the product data is
     shown as "غير متوفر" with a nudge to confirm with the seller.
   • Every running-cost figure is labelled an ESTIMATE, with the assumptions
     visible and the tariff editable — an appliance bill depends on tiered
     tariffs and real usage, and pretending otherwise would be dishonest.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- typical annual consumption models -------------------------------------
     Rule-of-thumb models, not manufacturer figures. Each returns kWh/year and
     the assumption string shown to the user, so the estimate can always be
     audited by the person reading it. */
  const ENERGY_MODELS = {
    fridge: (s) => {
      const L = (s.headline && s.headline.u === 'لتر') ? s.headline.v : 250;
      let k = 200 + 0.55 * L;
      if (s.energy.cls === 'A' || s.energy.inverter) k *= 0.78;
      else if (s.energy.saving) k *= 0.88;
      return { kwh: Math.round(k), why: { ar: 'تشغيل مستمر ٢٤ ساعة على مدار السنة، محسوب من سعة ' + L + ' لتر.', en: 'Running continuously all year, based on ' + L + ' L capacity.' } };
    },
    freezer: (s) => {
      const L = (s.headline && s.headline.u === 'لتر') ? s.headline.v : 200;
      let k = 250 + 0.6 * L;
      if (s.energy.cls === 'A' || s.energy.inverter) k *= 0.78;
      return { kwh: Math.round(k), why: { ar: 'تشغيل مستمر على مدار السنة، محسوب من سعة ' + L + ' لتر.', en: 'Running continuously all year, based on ' + L + ' L capacity.' } };
    },
    washer: (s) => {
      let k = 200;
      if (s.energy.cls === 'A' || s.energy.inverter) k *= 0.8;
      return { kwh: Math.round(k), why: { ar: 'تقدير على أساس ٤ غسلات فى الأسبوع بمياه دافئة.', en: 'Assumes about 4 warm washes a week.' } };
    },
    ac: (s) => {
      const hp = s.cap.hp || 1.5;
      let k = hp * 1250;                       // ~4 hot months, ~6 h/day
      if (s.energy.inverter) k *= 0.7;
      return { kwh: Math.round(k), why: { ar: 'تقدير على أساس ٤ شهور صيف، ٦ ساعات يومياً، لتكييف ' + hp + ' حصان.', en: 'Assumes 4 summer months at 6 h/day for a ' + hp + ' HP unit.' } };
    },
    tv: (s) => {
      const inch = s.cap.inch || 43;
      const k = Math.round(inch * 1.1 * 4 * 365 / 1000);
      return { kwh: k, why: { ar: 'تقدير على أساس ٤ ساعات مشاهدة يومياً لشاشة ' + inch + ' بوصة.', en: 'Assumes 4 hours a day on a ' + inch + '" screen.' } };
    },
    waterheater: () => ({ kwh: 1400, why: { ar: 'تقدير لسخان كهربائى لأسرة متوسطة.', en: 'Estimate for an electric heater in an average household.' } }),
    microwave: () => ({ kwh: 60, why: { ar: 'تقدير على أساس استخدام يومى قصير.', en: 'Assumes short daily use.' } }),
    watercooler: () => ({ kwh: 320, why: { ar: 'تشغيل مستمر على مدار السنة.', en: 'Running continuously all year.' } }),
  };
  const DEFAULT_TARIFF = 1.55;   // EGP/kWh — mid residential band, editable by the user

  function mountProduct(root) {
    const A = window.skApp, t = A.t, esc = A.esc, S = window.skSpecs, St = window.skStore;
    const id = A.qs('id', '');
    if (!id) { root.innerHTML = A.empty(t('لم يُحدَّد منتج.', 'No product selected.'), t('تصفّح المتجر', 'Browse the shop'), A.P('shop.html')); return; }

    /* Three reads, and only the first is required.

       detail() fetches /api/product/:id for the fields the catalogue list
       deliberately withholds — chiefly the rich description, which would add
       about a megabyte to the products.json every page of the site loads. It
       resolves to null when the Ecwid flag is off or the server is static, and
       the page then renders from the list entry exactly as it did before.

       pays() (the Ecwid payment and instalment methods) is no longer read
       here: the payment panel was taken off the product page, and checkout
       shows the same methods where the shopper actually picks one. */
    Promise.all([A.byId(id), A.products(), detail(id)]).then(([p, all, extra]) => {
      if (!p) { root.innerHTML = A.empty(t('هذا المنتج غير موجود.', 'That product was not found.'), t('تصفّح المتجر', 'Browse the shop'), A.P('shop.html')); return; }
      /* The detail is the same mapped record, freshly read, so it wins on
         every field it carries — a price or a stock flag that changed in Ecwid
         since the list was cached should not be shown stale on the one page
         the shopper is deciding from. */
      const prod = extra ? Object.assign({}, p, extra) : p;
      const spec = S.of(prod);
      const peers = all.filter(x => String(x.categoryId) === String(prod.categoryId) && String(x.id) !== String(prod.id));
      render(prod, spec, peers);
    });

    /* Both reads fail SOFT. A product page that renders without its rich
       description is a smaller failure than one that renders not at all. */
    function detail(pid) {
      return fetch(A.P('api/product/') + encodeURIComponent(pid))
        .then(r => (r.ok ? r.json() : null))
        .then(d => (d && d.product) || null)
        .catch(() => null);
    }

    /* ================= render ================= */
    function render(p, s, peers) {
      const U = window.skShopUI;
      // EN shoppers arrive here from a translated shop/category card — route the
      // title through the same rule-based translator so the PDP title, tab
      // title and image alt all agree with what they just clicked. Computed
      // once here and threaded into head() so the two never diverge.
      // U.clean() first: 193 of the 471 catalogue titles carry HTML entities as
      // literal text, and esc()ing those without decoding rendered "&nbsp;" and
      // "&amp;" on the page. The cards go through the same helper.
      const rawTitle = U.clean(p.title);
      const dispTitle = (!!(window.skLang && window.skLang.get() === 'en') && window.skCatalogI18n && window.skCatalogI18n.translateTitle)
        ? window.skCatalogI18n.translateTitle(rawTitle) : rawTitle;
      document.title = dispTitle.slice(0, 70) + ' | ' + t('صادكو جروب', 'SADKO Group');
      root.innerHTML =
        U.breadcrumb([
          { label: t('الرئيسية', 'Home'), href: A.P('index.html') },
          { label: t('المتجر', 'Shop'), href: A.P('shop.html') },
          { label: A.catName(p.categoryId), href: A.catHref(p.categoryId) },
          { label: t('تفاصيل المنتج', 'Product details') }
        ]) +
        '<div class="pdp">' +
          '<div class="pdp__media">' + gallery(p, dispTitle) + '</div>' +
          '<div class="pdp__buy">' + head(p, s, dispTitle) + '</div>' +
        '</div>' +
        /* "Who is it for?", "Will it fit?", "Good to know", "Running cost" and
           the payment/instalment panel are deliberately NOT on the product
           page: they distracted from the product itself. Household size and
           space live in the finder (finder.html), payment and instalments in
           checkout. The panel functions below are kept, unused, so any of
           them can be brought back with one line. */
        specsPanel(p, s) +
        '<div class="grid2 mt16"><div>' + reviewsPanel(p) + '</div><div>' + qaPanel(p) + '</div></div>' +
        '<div id="guidesBox"></div>' +
        U.rail(t('منتجات مشابهة', 'Related products'), peers.slice(0, 8), A.catHref(p.categoryId), { more: t('عرض الكل', 'See all') });
      wire(p, s, peers);
      guides(p);
      U.afterGrid(root);
    }

    /* ---- the gallery ----------------------------------------------------
       427 products in the store carry between 2 and 7 images and the page
       rendered only the first, which is a large part of why Ecwid's own
       product page looked more complete than ours.

       Rendered as real <button>s in a list, not a script-built carousel: the
       whole set is in the DOM at first paint, every thumbnail is reachable by
       keyboard, and a product with one image simply gets no thumbnail strip.
       Only the main image is eager — the thumbnails are small and below it. */
    function gallery(p, dispTitle) {
      const imgs = (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
      const main = imgs[0] || '';
      const frame = '<div class="panel pdp__frame">' +
        (main
          ? '<img id="pdpMain" src="' + esc(main) + '" alt="' + esc(dispTitle) + '">'
          : '<span class="pdp__noimg">' + t('لا توجد صورة', 'No image') + '</span>') +
        '</div>';
      if (imgs.length < 2) return frame;
      return frame +
        '<ul class="pdp__thumbs" role="list">' + imgs.map((src, i) =>
          '<li><button type="button" class="pdp__thumb' + (i === 0 ? ' is-on' : '') + '"' +
            ' data-src="' + esc(src) + '" aria-label="' +
            esc(t('صورة ' + (i + 1) + ' من ' + imgs.length, 'Image ' + (i + 1) + ' of ' + imgs.length)) + '">' +
            '<img loading="lazy" decoding="async" src="' + esc(src) + '" alt=""></button></li>').join('') +
        '</ul>';
    }

    /* ---- payment and instalment plans, straight from Ecwid --------------
       Staff maintain these in the Ecwid control panel; nothing here is
       hardcoded. Two of the plans are restricted to one manufacturer's
       products and Ecwid cannot enforce that on a manual method, so the
       restriction is SAID rather than silently applied — the same rule
       checkout follows, for the same reason.

       No figures: a monthly instalment depends on the term and the provider's
       own approval, and inventing one on a product page would be a quoted
       price we have no basis for. */
    function payPanel(methods) {
      const list = (methods || []).filter(m => m && m.title);
      if (!list.length) return '';
      const plans = list.filter(m => /تقسيط|مبادرة|valu|souhoola|forsa|mogo|seven|aman/i.test(m.title));
      const rest = list.filter(m => plans.indexOf(m) === -1);
      const row = m =>
        '<li><span class="k">' + esc(m.title) +
          (m.restricted ? ' <em class="badge badge--warn">' +
            esc(t('منتجات ' + (m.brand || '') + ' فقط', (m.brandEn || m.brand || '') + ' products only')) + '</em>' : '') +
        '</span><span class="v">' + esc(m.instructions || t('تؤكده خدمة العملاء', 'confirmed by customer care')) + '</span></li>';
      return '<div class="panel mt16"><h2 class="panel__h">' + t('طرق الدفع والتقسيط', 'Payment and instalment options') + '</h2>' +
        '<p class="panel__sub">' + t('المتاح فعلياً على هذا الطلب، كما تسجله صادكو، وتختاره وقت تأكيد الطلب.',
          'What is actually available on this order, as SADKO records it. You choose at checkout.') + '</p>' +
        (plans.length ? '<h3 class="small" style="font-weight:800;margin:4px 0 6px">' + t('تقسيط', 'Instalments') + '</h3>' +
          '<ul class="specs">' + plans.map(row).join('') + '</ul>' : '') +
        (rest.length ? '<h3 class="small" style="font-weight:800;margin:14px 0 6px">' + t('دفع مباشر', 'Pay outright') + '</h3>' +
          '<ul class="specs">' + rest.map(row).join('') + '</ul>' : '') +
        '<div class="note note--soft small mt16">' + t(
          'لا تُدفع أى أموال على الموقع ولا نطلب بيانات بطاقة. تُحدَّد قيمة القسط ومدته مع جهة التقسيط نفسها بعد تأكيد الطلب.',
          'No money is taken on the site and we never ask for card details. The instalment amount and term are set with the provider itself after you place the order.') +
        '</div></div>';
    }

    /* ---- headline + actions ---- */
    function head(p, s, dispTitle) {
      const saved = St.saved.has(p.id);
      /* Ecwid reports stock and a staff-entered compare-at price; the July seed
         catalogue had neither, so a product missing these fields behaves
         exactly as it always did. */
      const out = p.inStock === false;
      const was = Number(p.compareToPrice), now = Number(p.price);
      const hasWas = isFinite(was) && isFinite(now) && was > now && was > 0;
      const offPct = hasWas ? Math.round((was - now) / was * 100) : 0;
      return '<h1 class="pdp__title" style="font:900 clamp(1.3rem,3vw,1.9rem) Cairo,sans-serif;margin:0 0 10px;line-height:1.4">' + esc(dispTitle) + '</h1>' +
        '<div class="chips mt8">' +
          (s.brand ? '<span class="chip">' + esc(t(s.brand.ar, s.brand.en)) + '</span>' : '') +
          (s.headline ? '<span class="chip chip--mute">' + A.num(s.headline.v) + ' ' + esc(t(s.headline.u, s.headline.uEn)) + '</span>' : '') +
          (s.energy.cls ? '<span class="chip chip--ok">' + t('كفاءة طاقة ', 'Energy class ') + esc(s.energy.cls) + '</span>' : '') +
          (s.energy.inverter ? '<span class="chip chip--ok">' + t('انفرتر', 'Inverter') + '</span>' : '') +
        '</div>' +
        '<p class="pdp__price" style="font:900 1.8rem Cairo,sans-serif;color:var(--accent);margin:16px 0 4px">' + A.money(p.price) +
          (hasWas ? ' <s class="pdp__was" style="font-size:.62em;font-weight:600;color:var(--muted)">' + A.money(was) + '</s>' +
                    ' <em class="pdp__off">-' + offPct + '%</em>' : '') +
        '</p>' +
        '<p class="muted small pdp__caveat" style="margin:0 0 16px">' + t('سعر صادكو وقت آخر تحديث للكتالوج. أكّد السعر قبل الشراء.', 'SADKO price at the last catalogue update. Confirm before buying.') + '</p>' +
        stockLine(p) +
        (out ? '<p class="note note--warn" style="margin:0 0 16px">' +
                 t('هذا المنتج غير متوفر حالياً. يمكنك حفظه أو الاتصال بخدمة العملاء على 19140 للسؤال عن موعد توفره.',
                   'This product is out of stock. You can save it, or call customer care on 19140 to ask when it will be available.') +
               '</p>' : '') +
        '<div class="chips">' +
          /* Out of stock keeps Compare, Save and Add-to-plan — all still useful —
             but loses the buy button, because the shop cannot ship it. */
          /* This was an outbound link to p.url — Ecwid's own storefront —
             so the page that gives the buying guidance handed the buyer to a
             different shop to complete the purchase. It adds to the site's own
             cart now, and checkout pushes the order into Ecwid. */
          (out ? '' : '<button class="btn btn--primary" id="btnAdd" type="button">' + t('أضف للسلة', 'Add to cart') + '</button>') +
          (out ? '' : '<a class="btn btn--teal" id="btnBuy" href="' + A.P('checkout.html') + '">' + t('اشترى الآن', 'Buy now') + '</a>') +
          '<a class="btn btn--teal" href="' + A.P('compare.html') + '?q=' + encodeURIComponent(cleanTitle(p.title)) + '">' + t('قارن الأسعار', 'Compare prices') + '</a>' +
          '<button class="btn btn--ghost" id="btnSave">' + (saved ? t('محفوظ ✓', 'Saved ✓') : t('احفظ', 'Save')) + '</button>' +
          '<a class="btn btn--ghost" href="' + A.P('plan.html') + '?add=' + encodeURIComponent(p.id) + '">' + t('ضيفه لخطة', 'Add to a plan') + '</a>' +
        '</div>';
    }
    function cleanTitle(x) { return String(x).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }

    /* ---- availability, as Ecwid actually records it ----------------------
       Three genuinely different states, and the page used to show none of
       them. A remaining count is printed ONLY when Ecwid is tracking the
       quantity, because an untracked product's "quantity" field is not a
       stock figure and printing it would invent scarcity. The low-stock nudge
       is likewise a fact being reported, not a countdown. */
    function stockLine(p) {
      if (p.inStock === false) return '';
      const tracked = p.stockTracked === true;
      const q = Number(p.quantity);
      if (tracked && isFinite(q) && q > 0 && q <= 5) {
        return '<p class="pdp__stock pdp__stock--low small" style="margin:0 0 12px;font-weight:800;color:var(--warn,#a4551b)">' +
          esc(t('باقى ' + A.num(q) + ' فقط فى المخزن', 'Only ' + q + ' left in stock')) + '</p>';
      }
      if (p.inStock === true) {
        return '<p class="pdp__stock small" style="margin:0 0 12px;font-weight:800;color:var(--ok,#2f6b46)">' +
          t('متوفر', 'In stock') + '</p>';
      }
      return '';
    }

    /* ---- the SKU line ---------------------------------------------------
       Worth showing because it is the number customer care asks for on the
       phone, and the shopper otherwise has to read out a 60-character Arabic
       title. Banner entries never reach this page (the detail endpoint
       refuses them), so the banner- prefix cannot appear here. */
    function skuLine(p) {
      const sku = String(p.sku || '').trim();
      if (!sku) return '';
      return '<li><span class="k">' + t('كود المنتج', 'Product code') + '</span>' +
        '<span class="v ltr">' + esc(sku) + '</span></li>';
    }

    /* ---- 1. suitable for ---- */
    function suitability(p, s) {
      const rows = [];
      const prof = St.profile.get();
      const fam = s.family;
      const cap = s.headline;

      if ((fam === 'fridge' || fam === 'freezer' || fam === 'washer') && cap) {
        // Invert the sizing table: which household does this capacity suit?
        const bands = [2, 4, 6, 8].map(n => ({ n, b: S.sizeFor(fam, n) })).filter(x => x.b);
        const fits = bands.filter(x => cap.v >= x.b.min && cap.v <= x.b.max).map(x => x.n);
        rows.push([t('حجم الأسرة المناسب', 'Suits a household of'),
          fits.length ? (fits.length === 1 ? t('حوالى ' + fits[0] + ' أفراد', 'about ' + fits[0] + ' people')
                                           : t('من ' + Math.min.apply(null, fits) + ' لـ ' + Math.max.apply(null, fits) + ' أفراد', Math.min.apply(null, fits) + '–' + Math.max.apply(null, fits) + ' people'))
                      : (cap.v < bands[0].b.min ? t('استخدام فردى أو خفيف', 'single person / light use') : t('أسرة كبيرة', 'a large household')), true]);
      }
      if (fam === 'ac') {
        const hp = s.cap.hp;
        rows.push([t('مساحة الغرفة المناسبة', 'Suitable room size'),
          hp ? t('حوالى ' + Math.round(hp * 12) + ' – ' + Math.round(hp * 16) + ' متر مربع', 'about ' + Math.round(hp * 12) + '–' + Math.round(hp * 16) + ' m²') : null, !!hp]);
        if (s.f.coverM2) rows.push([t('التغطية حسب الشركة', 'Manufacturer coverage'), s.f.coverM2 + t(' متر مربع', ' m²'), true]);
      }
      if (fam === 'tv' && s.cap.inch) {
        const i = s.cap.inch;
        rows.push([t('مسافة المشاهدة المناسبة', 'Best viewing distance'), t('حوالى ' + (i * 0.05).toFixed(1) + ' – ' + (i * 0.075).toFixed(1) + ' متر', 'about ' + (i * 0.05).toFixed(1) + '–' + (i * 0.075).toFixed(1) + ' m'), true]);
      }
      if (cap) rows.push([t('السعة', 'Capacity'), A.num(cap.v) + ' ' + t(cap.u, cap.uEn), true]);
      rows.push([t('كفاءة الطاقة', 'Energy efficiency'),
        s.energy.cls ? t('درجة ' + s.energy.cls, 'Class ' + s.energy.cls)
        : s.energy.inverter ? t('انفرتر (موفر)', 'Inverter (efficient)')
        : s.energy.saving ? t('الوصف بيذكر توفير', 'Description mentions saving') : null, !!(s.energy.cls || s.energy.saving)]);
      if (s.f.doors) rows.push([t('عدد الأبواب', 'Doors'), A.num(s.f.doors), true]);
      if (s.f.rpm) rows.push([t('سرعة العصر', 'Spin speed'), A.num(s.f.rpm) + ' rpm', true]);

      const oversized = (() => {
        if (!prof.people || !cap) return null;
        const b = S.sizeFor(fam, Number(prof.people));
        if (b && cap.v > b.max * 1.25) return t('بناءً على ما ذكرته سابقاً (' + prof.people + ' أفراد)، هذا الجهاز أكبر من حاجتك، ستدفع فى ثمنه وفى كهربائه دون أن تستفيد من الفارق.',
          'Based on what you told us (' + prof.people + ' people), this is larger than you need: you would pay for capacity and power you will not use.');
        return null;
      })();

      return '<div class="panel"><h2 class="panel__h">' + t('مناسب لمين؟', 'Who is it for?') + '</h2>' +
        '<p class="panel__sub">' + t('قراءة عملية للمواصفات، لا قائمة أرقام.', 'A practical read of the specification, not a list of numbers.') + '</p>' +
        '<ul class="specs">' + rows.map(r =>
          '<li><span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? '' : ' unknown') + '">' +
          esc(r[1] || t('غير متوفر', 'not stated')) + '</span></li>').join('') + '</ul>' +
        (oversized ? '<div class="note note--warn mt16">' + esc(oversized) + '</div>' : '') +
        '</div>';
    }

    /* ---- 2. space check (numeric only — no rendering) ---- */
    function spaceCheck(p, s) {
      const d = s.dims || {};
      const prof = St.profile.get();
      const known = d.w || d.h || d.d;
      return '<div class="panel"><h2 class="panel__h">' + t('هيدخل عندك؟', 'Will it fit?') + '</h2>' +
        '<p class="panel__sub">' + t('اكتب المقاسات المتاحة عندك وهنقارنها بمقاس الجهاز. سيب ٥ سم على الأقل للتهوية.',
          'Enter the space you have and we will compare it with the appliance. Leave at least 5 cm for ventilation.') + '</p>' +
        (known
          ? '<ul class="specs mt8"><li><span class="k">' + t('مقاس الجهاز', 'Appliance size') + '</span><span class="v">' +
              [d.w ? t('عرض ', 'W ') + d.w : '', d.h ? t('ارتفاع ', 'H ') + d.h : '', d.d ? t('عمق ', 'D ') + d.d : ''].filter(Boolean).join(' × ') + ' ' + t('سم', 'cm') + '</span></li></ul>'
          : '<div class="note note--warn">' + t('أبعاد الجهاز غير واردة فى بيانات المنتج، اطلبها من المعرض أو من خدمة العملاء قبل الشراء.',
              'This product\'s dimensions are not in the catalogue data. Ask the showroom or customer care before buying.') + '</div>') +
        '<div class="row mt16">' +
          ['maxW,' + t('العرض المتاح', 'Width available'), 'maxH,' + t('الارتفاع المتاح', 'Height available'), 'maxD,' + t('العمق المتاح', 'Depth available')]
            .map(x => { const [k, l] = x.split(','); return '<label class="field" style="margin:0"><span class="field__l">' + esc(l) + ' <span class="muted small">' + t('سم', 'cm') + '</span></span>' +
              '<input class="input sc" type="number" inputmode="numeric" min="10" max="400" data-k="' + k + '" value="' + (prof[k] || '') + '"></label>'; }).join('') +
        '</div>' +
        '<div id="scOut" class="mt16"></div></div>';
    }

    function spaceVerdict(s) {
      const d = s.dims || {};
      const prof = St.profile.get();
      const pairs = [['maxW', 'w', t('العرض', 'Width')], ['maxH', 'h', t('الارتفاع', 'Height')], ['maxD', 'd', t('العمق', 'Depth')]];
      const given = pairs.filter(x => Number(prof[x[0]]) > 0);
      if (!given.length) return '';
      const unknown = given.filter(x => !d[x[1]]);
      const fails = given.filter(x => d[x[1]] && d[x[1]] > Number(prof[x[0]]));
      const tight = given.filter(x => d[x[1]] && d[x[1]] <= Number(prof[x[0]]) && (Number(prof[x[0]]) - d[x[1]]) < 5);
      if (fails.length) {
        return '<div class="note" style="border-color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,#fff)"><b>' +
          t('لن يناسب المساحة', 'It will not fit') + '</b><br>' +
          fails.map(x => esc(x[2] + t(' الجهاز ' + d[x[1]] + ' سم والمتاح عندك ' + prof[x[0]] + ' سم.', ' is ' + d[x[1]] + ' cm but you have ' + prof[x[0]] + ' cm.'))).join('<br>') + '</div>';
      }
      if (tight.length) {
        return '<div class="note note--warn"><b>' + t('يناسب، لكن بالكاد', 'It fits, but only just') + '</b><br>' +
          t('الفارق أقل من ٥ سم، وهذه الأجهزة تحتاج مساحة تهوية حولها. راجع تعليمات التركيب.',
            'The gap is under 5 cm and these appliances need ventilation space around them. Check the installation instructions.') + '</div>';
      }
      return '<div class="note" style="border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,#fff)"><b>' +
        t('يناسب المساحة', 'It fits your space') + '</b>' +
        // the list separator is itself localised — an Arabic comma between English
        // dimension names ("Width، Depth") is the same leak as an untranslated label.
        (unknown.length ? '<br>' + t('ملاحظة: ', 'Note: ') + unknown.map(x => esc(x[2])).join(t('، ', ', ')) + t(' غير متوفر فى بيانات المنتج.', ' not available in the product data.') : '') + '</div>';
    }

    /* ---- 3. good to know ---- */
    function goodToKnow(p, s, peers) {
      const items = [];
      (s.notes || []).forEach(n => items.push({ k: 'hm', text: t(n.ar, n.en) }));
      if (s.family === 'ac') items.push({ k: 'hm', text: t('التكييف محتاج تركيب متخصص وقاعدة خارجية، التركيب غالباً بتكلفة منفصلة.', 'An AC needs professional installation and an outdoor bracket. Installation is usually charged separately.') });
      if (s.family === 'fridge' || s.family === 'freezer') items.push({ k: 'hm', text: t('سيب مسافة تهوية ٥–١٠ سم من ورا الجهاز ومن فوقه، وسيبه واقف ٤ ساعات قبل ما تشغّله بعد النقل.', 'Leave 5–10 cm of ventilation behind and above it, and let it stand for 4 hours after transport before switching on.') });
      if (s.family === 'washer') items.push({ k: 'hm', text: t('محتاجة خرطوم مياه وصرف قريب، ومسمار الأمان لازم يتشال قبل أول غسلة.', 'Needs a water inlet and drain nearby, and the transit bolts must be removed before the first wash.') });
      if (s.family === 'cooker') items.push({ k: 'hm', text: t('البوتاجاز محتاج وصلة غاز وفنى معتمد، متركبوش بنفسك.', 'A cooker needs a gas connection fitted by an approved technician. Do not install it yourself.') });
      if (s.f.warranty) items.push({ k: 'ok', text: t('الوصف بيذكر ضمان ' + s.f.warranty + ' سنة، اطلب كارت الضمان والفاتورة وقت الاستلام.', 'The description mentions a ' + s.f.warranty + '-year warranty. Ask for the warranty card and invoice on delivery.') });
      else items.push({ k: 'hm', text: t('مدة الضمان غير مذكورة هنا، اسأل عنها قبل الشراء واحتفظ بالفاتورة.', 'Warranty length is not stated here. Ask before buying and keep the invoice.') });

      // "a cheaper model does nearly the same job" — only when it is genuinely true
      const alt = cheaperTwin(p, s, peers);
      if (alt) items.push({ k: 'ok', text: t(
        'يوجد طراز أرخص بالسعة نفسها تقريباً: ' + cleanTitle(alt.p.title) + ' بـ ' + A.money(alt.p.price) + '، يوفّر ' + A.money(p.price - alt.p.price) + '.',
        'A cheaper model with almost the same capacity: ' + cleanTitle(alt.p.title) + ' at ' + A.money(alt.p.price) + ', saving ' + A.money(p.price - alt.p.price) + '.'),
        href: A.P('product.html') + '?id=' + encodeURIComponent(alt.p.id) });

      return '<div class="panel"><h2 class="panel__h">' + t('أمور تودّ معرفتها', 'Good to know') + '</h2>' +
        '<p class="panel__sub">' + t('معلومات صريحة قبل أن تدفع، لا كلام تسويقى.', 'Straight information before you pay, not marketing copy.') + '</p>' +
        '<ul class="why">' + items.map(i =>
          '<li><i class="' + (i.k === 'ok' ? 'ok' : 'hm') + '">' + (i.k === 'ok' ? '✓' : 'i') + '</i><span>' + esc(i.text) +
          (i.href ? ' <a href="' + i.href + '">' + t('اعرضه', 'View') + '</a>' : '') + '</span></li>').join('') + '</ul></div>';
    }

    function cheaperTwin(p, s, peers) {
      if (!s.headline) return null;
      let best = null;
      peers.forEach(x => {
        const xs = S.of(x);
        if (!xs.headline || xs.headline.u !== s.headline.u) return;
        if (x.price >= p.price * 0.95) return;                    // must be meaningfully cheaper
        if (xs.headline.v < s.headline.v * 0.9) return;            // and not a big step down
        if (s.energy.saving && !xs.energy.saving) return;          // don't trade away efficiency
        if (!best || x.price < best.p.price) best = { p: x, s: xs };
      });
      return best && (p.price - best.p.price) > p.price * 0.08 ? best : null;
    }

    /* ---- 4. running cost ---- */
    function energyPanel(p, s, peers) {
      const model = ENERGY_MODELS[s.family];
      if (!model) return '';
      const prof = St.profile.get();
      const tariff = Number(prof.tariff) || DEFAULT_TARIFF;
      const est = model(s);
      const year = est.kwh * tariff;
      const five = year * 5;

      // category benchmark, from the same model applied to peers
      const peerCosts = peers.map(x => { const xs = S.of(x); const m = ENERGY_MODELS[xs.family]; return m ? m(xs).kwh : null; }).filter(Boolean);
      const avg = peerCosts.length ? peerCosts.reduce((a, b) => a + b, 0) / peerCosts.length : null;
      const diff = avg ? Math.round((avg - est.kwh) * tariff) : 0;

      return '<div class="panel"><h2 class="panel__h">' + t('تكلفة التشغيل', 'Running cost') + '</h2>' +
        '<p class="panel__sub">' + esc(t(est.why.ar, est.why.en)) + '</p>' +
        '<ul class="specs">' +
          '<li><span class="k">' + t('استهلاك تقديرى', 'Estimated use') + '</span><span class="v">' + A.num(est.kwh) + ' ' + t('ك.و.س / سنة', 'kWh / year') + '</span></li>' +
          '<li><span class="k">' + t('تقريباً فى السنة', 'Roughly per year') + '</span><span class="v">' + A.money(year) + '</span></li>' +
          '<li><span class="k">' + t('على ٥ سنين', 'Over 5 years') + '</span><span class="v">' + A.money(five) + '</span></li>' +
          '<li><span class="k">' + t('سعر الشراء + ٥ سنين كهربا', 'Purchase + 5 years of power') + '</span><span class="v">' + A.money(p.price + five) + '</span></li>' +
        '</ul>' +
        (avg ? '<div class="note ' + (diff > 0 ? 'note--info' : 'note--soft') + ' mt16">' +
          (diff > 0 ? t('أوفر من متوسط الفئة بحوالى ' + A.money(diff) + ' فى السنة.', 'About ' + A.money(diff) + ' a year cheaper to run than the category average.')
                    : t('استهلاكه أعلى من متوسط الفئة بحوالى ' + A.money(-diff) + ' فى السنة.', 'About ' + A.money(-diff) + ' a year more expensive to run than the category average.')) +
          '</div>' : '') +
        '<label class="field mt16" style="max-width:230px"><span class="field__l">' + t('سعر الكيلوواط عندك', 'Your electricity rate') + '</span>' +
          '<input class="input" id="tariff" type="number" step="0.05" min="0.2" max="10" value="' + tariff + '">' +
          '<span class="field__hint">' + t('جنيه لكل ك.و.س، غيّره حسب شريحتك.', 'EGP per kWh. Change it to match your tariff band.') + '</span></label>' +
        '<div class="note note--soft mt16 small">' + t(
          'تقدير إرشادى بناءً على معدل استهلاك نموذجى للفئة والتعريفة التى حددتها، وليس قيمة مضمونة للفاتورة. فَفاتورة الكهرباء فى مصر تُحتسب بشرائح، والاستهلاك الفعلى يختلف بحسب الاستخدام والطقس.',
          'A guide estimate based on a typical consumption rate for this category and the tariff you entered, not a guaranteed bill. Egyptian electricity is billed in tiers and real usage varies with habits and weather.') + '</div></div>';
    }

    /* ---- 5. raw specs, with honest gaps ---- */
    function specsPanel(p, s) {
      const d = s.dims || {};
      const rows = [
        [t('الماركة', 'Brand'), s.brand ? t(s.brand.ar, s.brand.en) : null],
        [t('السعة', 'Capacity'), s.headline ? A.num(s.headline.v) + ' ' + t(s.headline.u, s.headline.uEn) : null],
        // All three known: the usual W × D × H. Only some known: just those,
        // each named, so no "?" placeholder ever reaches the table.
        (d.w && d.d && d.h)
          ? [t('الأبعاد (ع × ع × ا)', 'Dimensions (W × D × H)'), [d.w, d.d, d.h].join(' × ') + ' ' + t('سم', 'cm')]
          : [t('الأبعاد', 'Dimensions'), (d.w || d.d || d.h)
              ? [[t('العرض', 'W'), d.w], [t('العمق', 'D'), d.d], [t('الارتفاع', 'H'), d.h]]
                  .filter(x => x[1]).map(x => x[0] + ' ' + x[1]).join(' · ') + ' ' + t('سم', 'cm')
              : null],
        [t('كفاءة الطاقة', 'Energy class'), s.energy.cls || null],
        [t('انفرتر', 'Inverter'), s.energy.inverter ? t('نعم', 'Yes') : null],
        [t('اللون', 'Finish'), s.color ? t(s.color.ar, s.color.key) : null],
        [t('عدد الأبواب', 'Doors'), s.f.doors || null],
        [t('الدقة', 'Resolution'), s.f.resolution || null],
        [t('قدرة التبريد', 'Cooling capacity'), s.cap.btu ? A.num(s.cap.btu) + ' BTU' : null],
        [t('الضمان', 'Warranty'), s.f.warranty ? t(s.f.warranty + ' سنة', s.f.warranty + ' years') : null],
      ];
      /* Not a read-from-the-description guess like the rows above — the code
         and the weight come from Ecwid's own fields, so they are appended
         after them rather than mixed in. A weight is shown only when staff
         actually entered one: 0 is Ecwid's "unset", and the mapper has
         already turned that into null. */
      const facts = skuLine(p) +
        (p.weight ? '<li><span class="k">' + t('الوزن', 'Weight') + '</span><span class="v">' +
          A.num(p.weight) + ' ' + t('كجم', 'kg') + '</span></li>' : '');
      /* Only the rows that actually have a value are shown. A field the
         product data does not state is left out entirely rather than listed
         as a blank placeholder, so the table is never a column of blanks. */
      const filled = rows.filter(r => r[1] != null && String(r[1]).trim() !== '');
      const list = filled.map(r => '<li><span class="k">' + esc(r[0]) + '</span><span class="v">' +
        esc(r[1]) + '</span></li>').join('') + facts;
      return '<div class="panel mt16"><h2 class="panel__h">' + t('المواصفات', 'Specifications') + '</h2>' +
        (list ? '<ul class="specs">' + list + '</ul>' : '') +
        /* Ecwid's own copy, with the structure it was written in.

           It used to be flattened to one paragraph by the mapper's stripHtml,
           so a bulleted spec list arrived as a run-on sentence — and it was
           folded inside a <details> that nobody opens. It is open by default
           now, because it is the manufacturer's own description of the product
           and the main thing a shopper scrolls down for.

           descriptionHtml is sanitised server-side by safeHtml(): an
           allow-list of structural tags with every attribute dropped, so no
           href, src, style or handler reaches this innerHTML. The plain
           description is the fallback when the detail endpoint is absent (the
           Ecwid flag off, or a static host). */
        '<details class="mt16" open><summary style="cursor:pointer;font-weight:800">' + t('الوصف الأصلى من صادكو', 'Original SADKO description') + '</summary>' +
        (p.descriptionHtml
          ? '<div class="pdp__desc small mt8">' + p.descriptionHtml + '</div>'
          : '<p class="small muted mt8" style="line-height:1.9">' + esc(S.norm(p.description) || t('لا يوجد وصف.', 'No description.')) + '</p>') +
        '</details></div>';
    }

    /* ---- 6. structured reviews (device-local) ---- */
    function reviewsPanel(p) {
      const mine = St.reviews.for(p.id);
      return '<div class="panel"><h2 class="panel__h">' + t('تقييمات المستخدمين', 'Owner reviews') + '</h2>' +
        '<p class="panel__sub">' + t('التقييم المفيد يذكر لك المدة والاستخدام، لا النجوم وحدها.', 'A useful review tells you how long and how it is used, not just stars.') + '</p>' +
        '<div class="note note--soft small">' + t(
          'لا توجد تقييمات منشورة لهذا المنتج بعد. وأى تقييم تكتبه هنا يُسجَّل على جهازك ويُرسَل للمراجعة قبل النشر، ولا يظهر لبقية الزوار مباشرةً.',
          'No published reviews for this product yet. Anything you write here is saved on your device and queued for moderation. It is not shown to other visitors immediately.') + '</div>' +
        '<form id="revForm" class="mt16">' +
          '<label class="field"><span class="field__l">' + t('التقييم', 'Rating') + '</span>' +
            '<div class="opts">' + [1, 2, 3, 4, 5].map(n => '<label class="opt"><input type="radio" name="stars" value="' + n + '"' + (n === 5 ? ' checked' : '') + '><span>' + '★'.repeat(n) + '</span></label>').join('') + '</div></label>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + t('منذ متى وأنت تستخدمه؟', 'How long have you owned it?') + '</span>' +
              '<select class="select" name="owned"><option value=""></option>' +
              ['أقل من شهر|Under a month', 'من شهر لـ ٦ شهور|1–6 months', 'من ٦ شهور لسنة|6–12 months', 'أكتر من سنة|Over a year'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + t('عدد أفراد المنزل', 'Household size') + '</span>' +
              '<input class="input" type="number" name="people" min="1" max="15" placeholder="-"></label>' +
          '</div>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + t('صوته عالى؟', 'Is it noisy?') + '</span>' +
              '<select class="select" name="noise"><option value=""></option>' + ['هادى|Quiet', 'عادى|Normal', 'صوته عالى|Loud'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + t('استهلاك الكهربا', 'Energy use') + '</span>' +
              '<select class="select" name="energy"><option value=""></option>' + ['موفر|Economical', 'عادى|Average', 'عالى|High'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + t('التركيب كان سهل؟', 'Was installation easy?') + '</span>' +
              '<select class="select" name="install"><option value=""></option>' + ['سهل|Easy', 'محتاج فنى|Needed a technician', 'صعب|Difficult'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
          '</div>' +
          '<label class="field"><span class="field__l">' + t('ما الذى ينبغى أن يعرفه المشترى الجديد؟', 'What should another buyer know?') + '</span>' +
            '<textarea class="textarea" name="text" maxlength="600" placeholder="' + t('اكتب تجربتك بصراحة…', 'Write your honest experience…') + '"></textarea></label>' +
          '<button class="btn btn--teal" type="submit">' + t('أرسل للمراجعة', 'Submit for review') + '</button>' +
        '</form>' +
        (mine.length ? '<div class="mt16"><h3 class="small" style="font-weight:900">' + t('تقييماتك (فى انتظار المراجعة)', 'Your reviews (awaiting moderation)') + '</h3>' +
          mine.map(r => '<div class="note note--soft mt8"><b>' + '★'.repeat(Number(r.stars) || 0) + '</b> ' +
            [r.owned, r.people ? t(r.people + ' أفراد', r.people + ' people') : '', r.noise, r.energy].filter(Boolean).map(esc).join(' · ') +
            (r.text ? '<br>' + esc(r.text) : '') +
            ' <button class="btn btn--quiet btn--sm" data-delrev="' + esc(r.id) + '">' + t('امسح', 'Delete') + '</button></div>').join('') + '</div>' : '') +
        '</div>';
    }

    /* ---- 7. Q&A ---- */
    function qaPanel(p) {
      const mine = St.qa.for(p.id);
      const seeds = [
        t('هل يمر من باب عرضه ٧٠ سم؟', 'Will it fit through a 70 cm doorway?'),
        t('التركيب متضمن فى السعر؟', 'Is installation included in the price?'),
        t('الضمان من الشركة المصنّعة ولا من المتجر؟', 'Is the warranty from the manufacturer or the seller?'),
        t('محتاج خط كهربا خاص؟', 'Does it need a dedicated electrical circuit?'),
      ];
      return '<div class="panel"><h2 class="panel__h">' + t('أسئلة عن المنتج', 'Questions about this product') + '</h2>' +
        '<p class="panel__sub">' + t('اسأل، ويجيبك فريق صادكو أو أحد من اشترى المنتج. ويُذكر مع كل إجابة مصدرها.',
          'Ask, and SADKO staff or a verified owner answers. Every answer is labelled with its source.') + '</p>' +
        '<div class="chips">' + seeds.map(s => '<button class="chip" type="button" data-seed="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
        '<form id="qaForm" class="mt16"><label class="field"><span class="field__l">' + t('سؤالك', 'Your question') + '</span>' +
          '<textarea class="textarea" name="q" maxlength="400" style="min-height:74px" placeholder="' + t('اكتب سؤالك هنا…', 'Type your question…') + '"></textarea></label>' +
          '<button class="btn btn--teal" type="submit">' + t('أرسل السؤال', 'Send question') + '</button></form>' +
        '<div class="note note--soft small mt16">' + t(
          'لا توجد أسئلة منشورة لهذا المنتج بعد. وسؤالك يُسجَّل على جهازك ويُرسَل للمراجعة، وإن احتجت رداً فورياً فاتصل على 19140.',
          'No published questions for this product yet. Your question is saved on your device and queued for review. For an immediate answer call 19140.') + '</div>' +
        (mine.length ? '<div class="mt16">' + mine.map(q => '<div class="note note--soft mt8">' + esc(q.text) +
          ' <span class="badge">' + t('فى انتظار الرد', 'awaiting answer') + '</span>' +
          ' <button class="btn btn--quiet btn--sm" data-delq="' + esc(q.id) + '">' + t('امسح', 'Delete') + '</button></div>').join('') + '</div>' : '') +
        '</div>';
    }

    /* ---- related guides ---- */
    function guides(p) {
      const box = root.querySelector('#guidesBox');
      if (!box || !window.skGuides || !window.skGuides.forCategory) return;
      Promise.resolve(window.skGuides.forCategory(String(p.categoryId))).then(list => {
        if (!list || !list.length) return;
        box.innerHTML = '<div class="panel mt16"><h2 class="panel__h">' + t('اقرأ أيضاً قبل الشراء', 'Read this before you buy') + '</h2>' +
          '<div class="chips mt8">' + list.map(g => '<a class="chip" href="' + A.P('guides.html') + '?g=' + encodeURIComponent(g.slug) + '">' +
            esc(t(g.title.ar, g.title.en)) + '</a>').join('') + '</div></div>';
      }).catch(() => {});
    }

    /* ================= wiring ================= */
    function wire(p, s, peers) {
      /* ---- gallery ----
         One listener on the strip rather than one per thumbnail. */
      const thumbs = root.querySelector('.pdp__thumbs');
      if (thumbs) {
        thumbs.addEventListener('click', e => {
          const b = e.target.closest('.pdp__thumb');
          if (!b) return;
          const main = root.querySelector('#pdpMain');
          if (main) main.src = b.getAttribute('data-src');
          thumbs.querySelectorAll('.pdp__thumb').forEach(x => x.classList.remove('is-on'));
          b.classList.add('is-on');
        });
      }

      /* ---- add to cart ----
         skCart.add refuses a product Ecwid reports out of stock, so the
         button reports that rather than pretending it worked. */
      const add = root.querySelector('#btnAdd');
      if (add) {
        add.addEventListener('click', () => {
          if (window.skCart.add(p) === false) {
            add.textContent = t('غير متوفر', 'Out of stock');
            add.disabled = true;
            return;
          }
          add.textContent = t('✓ أُضيف للسلة', '✓ Added to cart');
          add.classList.add('is-done');
          setTimeout(() => { add.textContent = t('أضف للسلة', 'Add to cart'); add.classList.remove('is-done'); }, 1600);
        });
      }

      /* ---- buy now ----
         Adds, then goes to checkout. The href is a real link so it works
         without JS; this only makes sure the item is in the cart first, and
         does not double-add when it is already there. */
      const buy = root.querySelector('#btnBuy');
      if (buy) {
        buy.addEventListener('click', e => {
          const have = (window.skCart.items() || []).some(i => String(i.id) === String(p.id));
          if (!have && window.skCart.add(p) === false) { e.preventDefault(); return; }
        });
      }

      const $ = sel => root.querySelector(sel);

      $('#btnSave') && $('#btnSave').addEventListener('click', () => {
        const on = St.saved.toggle(p);
        $('#btnSave').textContent = on ? t('محفوظ ✓', 'Saved ✓') : t('احفظ', 'Save');
      });

      const paint = () => { const o = $('#scOut'); if (o) o.innerHTML = spaceVerdict(s); };
      root.querySelectorAll('.sc').forEach(inp => inp.addEventListener('input', () => {
        const patch = {}; patch[inp.getAttribute('data-k')] = inp.value ? Number(inp.value) : undefined;
        St.profile.set(patch); paint();
      }));
      paint();

      const tf = $('#tariff');
      tf && tf.addEventListener('change', () => {
        St.profile.set({ tariff: Number(tf.value) || DEFAULT_TARIFF });
        render(p, s, peers);                       // recompute the cost panel
      });

      const rf = $('#revForm');
      rf && rf.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(rf);
        St.reviews.add(p.id, { stars: fd.get('stars'), owned: fd.get('owned'), people: fd.get('people'),
                               noise: fd.get('noise'), energy: fd.get('energy'), install: fd.get('install'), text: fd.get('text') });
        render(p, s, peers);
      });
      root.querySelectorAll('[data-delrev]').forEach(b => b.addEventListener('click', () => { St.reviews.remove(p.id, b.getAttribute('data-delrev')); render(p, s, peers); }));

      const qf = $('#qaForm');
      qf && qf.addEventListener('submit', e => {
        e.preventDefault();
        const v = new FormData(qf).get('q');
        if (String(v || '').trim()) { St.qa.ask(p.id, v); render(p, s, peers); }
      });
      root.querySelectorAll('[data-seed]').forEach(b => b.addEventListener('click', () => {
        const ta = root.querySelector('#qaForm textarea'); if (ta) { ta.value = b.getAttribute('data-seed'); ta.focus(); }
      }));
      root.querySelectorAll('[data-delq]').forEach(b => b.addEventListener('click', () => { St.qa.remove(p.id, b.getAttribute('data-delq')); render(p, s, peers); }));
    }
  }

  window.mountProduct = mountProduct;
})();
