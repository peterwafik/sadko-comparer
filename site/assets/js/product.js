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
    if (!id) { root.innerHTML = A.empty(t('مفيش منتج محدد.', 'No product selected.'), t('تصفّح المتجر', 'Browse the shop'), A.P('shop.html')); return; }

    Promise.all([A.byId(id), A.products()]).then(([p, all]) => {
      if (!p) { root.innerHTML = A.empty(t('المنتج ده مش موجود.', 'That product was not found.'), t('تصفّح المتجر', 'Browse the shop'), A.P('shop.html')); return; }
      const spec = S.of(p);
      const peers = all.filter(x => String(x.categoryId) === String(p.categoryId) && String(x.id) !== String(p.id));
      render(p, spec, peers);
    });

    /* ================= render ================= */
    function render(p, s, peers) {
      const U = window.skShopUI;
      // EN shoppers arrive here from a translated shop/category card — route the
      // title through the same rule-based translator so the PDP title, tab
      // title and image alt all agree with what they just clicked. Computed
      // once here and threaded into head() so the two never diverge.
      const dispTitle = (!!(window.skLang && window.skLang.get() === 'en') && window.skCatalogI18n && window.skCatalogI18n.translateTitle)
        ? window.skCatalogI18n.translateTitle(p.title) : p.title;
      document.title = dispTitle.replace(/&nbsp;/g, ' ').slice(0, 70) + ' — ' + t('صادكو جروب', 'SADKO Group');
      root.innerHTML =
        U.breadcrumb([
          { label: t('البيت', 'Home'), href: A.P('index.html') },
          { label: t('المتجر', 'Shop'), href: A.P('shop.html') },
          { label: A.catName(p.categoryId), href: A.catHref(p.categoryId) },
          { label: t('تفاصيل المنتج', 'Product details') }
        ]) +
        '<div class="pdp">' +
          '<div class="pdp__media"><div class="panel pdp__frame">' +
            '<img src="' + esc(p.image) + '" alt="' + esc(dispTitle) + '">' +
          '</div></div>' +
          '<div class="pdp__buy">' + head(p, s, dispTitle) + '</div>' +
        '</div>' +
        '<div class="grid2 mt24">' +
          '<div>' + suitability(p, s) + spaceCheck(p, s) + '</div>' +
          '<div>' + goodToKnow(p, s, peers) + energyPanel(p, s, peers) + '</div>' +
        '</div>' +
        specsPanel(p, s) +
        '<div class="grid2 mt16"><div>' + reviewsPanel(p) + '</div><div>' + qaPanel(p) + '</div></div>' +
        '<div id="guidesBox"></div>' +
        U.rail(t('منتجات مشابهة', 'Related products'), peers.slice(0, 8), A.catHref(p.categoryId), { more: t('شوف الكل', 'See all') });
      wire(p, s, peers);
      guides(p);
      U.afterGrid(root);
    }

    /* ---- headline + actions ---- */
    function head(p, s, dispTitle) {
      const saved = St.saved.has(p.id);
      return '<h1 class="pdp__title" style="font:900 clamp(1.3rem,3vw,1.9rem) Cairo,sans-serif;margin:0 0 10px;line-height:1.4">' + esc(dispTitle) + '</h1>' +
        '<div class="chips mt8">' +
          (s.brand ? '<span class="chip">' + esc(t(s.brand.ar, s.brand.en)) + '</span>' : '') +
          (s.headline ? '<span class="chip chip--mute">' + A.num(s.headline.v) + ' ' + esc(t(s.headline.u, s.headline.uEn)) + '</span>' : '') +
          (s.energy.cls ? '<span class="chip chip--ok">' + t('كفاءة طاقة ', 'Energy class ') + esc(s.energy.cls) + '</span>' : '') +
          (s.energy.inverter ? '<span class="chip chip--ok">' + t('انفرتر', 'Inverter') + '</span>' : '') +
        '</div>' +
        '<p class="pdp__price" style="font:900 1.8rem Cairo,sans-serif;color:var(--accent);margin:16px 0 4px">' + A.money(p.price) + '</p>' +
        '<p class="muted small pdp__caveat" style="margin:0 0 16px">' + t('سعر صادكو وقت آخر تحديث للكتالوج — أكّد السعر قبل الشراء.', 'SADKO price at the last catalogue update — confirm before buying.') + '</p>' +
        '<div class="chips">' +
          '<a class="btn btn--primary" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + t('اشترى من صادكو', 'Buy from SADKO') + '</a>' +
          '<a class="btn btn--teal" href="' + A.P('compare.html') + '?q=' + encodeURIComponent(cleanTitle(p.title)) + '">' + t('قارن الأسعار', 'Compare prices') + '</a>' +
          '<button class="btn btn--ghost" id="btnSave">' + (saved ? t('محفوظ ✓', 'Saved ✓') : t('احفظ', 'Save')) + '</button>' +
          '<a class="btn btn--ghost" href="' + A.P('plan.html') + '?add=' + encodeURIComponent(p.id) + '">' + t('ضيفه لخطة', 'Add to a plan') + '</a>' +
        '</div>';
    }
    function cleanTitle(x) { return String(x).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }

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
        rows.push([t('مساحة الأوضة المناسبة', 'Suitable room size'),
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
        if (b && cap.v > b.max * 1.25) return t('حسب اللى قلته قبل كده (' + prof.people + ' أفراد)، الجهاز ده أكبر من احتياجك — هتدفع فى سعره وفى كهربته من غير ما تستفيد بالفرق.',
          'Based on what you told us (' + prof.people + ' people), this is larger than you need — you would pay for capacity and power you will not use.');
        return null;
      })();

      return '<div class="panel"><h2 class="panel__h">' + t('مناسب لمين؟', 'Who is it for?') + '</h2>' +
        '<p class="panel__sub">' + t('قراءة عملية للمواصفات — مش قايمة أرقام.', 'A practical read of the specification, not a list of numbers.') + '</p>' +
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
          : '<div class="note note--warn">' + t('أبعاد الجهاز مش موجودة فى بيانات المنتج — اطلبها من المعرض أو من خدمة العملاء قبل الشراء.',
              'This product\'s dimensions are not in the catalogue data — ask the showroom or customer care before buying.') + '</div>') +
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
          t('مش هيناسب المساحة', 'It will not fit') + '</b><br>' +
          fails.map(x => esc(x[2] + t(' الجهاز ' + d[x[1]] + ' سم والمتاح عندك ' + prof[x[0]] + ' سم.', ' is ' + d[x[1]] + ' cm but you have ' + prof[x[0]] + ' cm.'))).join('<br>') + '</div>';
      }
      if (tight.length) {
        return '<div class="note note--warn"><b>' + t('يناسب، بس بالعافية', 'It fits — but only just') + '</b><br>' +
          t('الفرق أقل من ٥ سم، والأجهزة دى محتاجة مساحة تهوية حواليها. راجع تعليمات التركيب.',
            'The gap is under 5 cm and these appliances need ventilation space around them. Check the installation instructions.') + '</div>';
      }
      return '<div class="note" style="border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,#fff)"><b>' +
        t('يناسب المساحة', 'It fits your space') + '</b>' +
        // the list separator is itself localised — an Arabic comma between English
        // dimension names ("Width، Depth") is the same leak as an untranslated label.
        (unknown.length ? '<br>' + t('ملاحظة: ', 'Note: ') + unknown.map(x => esc(x[2])).join(t('، ', ', ')) + t(' مش متوفر فى بيانات المنتج.', ' not available in the product data.') : '') + '</div>';
    }

    /* ---- 3. good to know ---- */
    function goodToKnow(p, s, peers) {
      const items = [];
      (s.notes || []).forEach(n => items.push({ k: 'hm', text: t(n.ar, n.en) }));
      if (s.family === 'ac') items.push({ k: 'hm', text: t('التكييف محتاج تركيب متخصص وقاعدة خارجية — التركيب غالباً بتكلفة منفصلة.', 'An AC needs professional installation and an outdoor bracket — installation is usually charged separately.') });
      if (s.family === 'fridge' || s.family === 'freezer') items.push({ k: 'hm', text: t('سيب مسافة تهوية ٥–١٠ سم من ورا الجهاز ومن فوقه، وسيبه واقف ٤ ساعات قبل ما تشغّله بعد النقل.', 'Leave 5–10 cm of ventilation behind and above it, and let it stand for 4 hours after transport before switching on.') });
      if (s.family === 'washer') items.push({ k: 'hm', text: t('محتاجة خرطوم مياه وصرف قريب، ومسمار الأمان لازم يتشال قبل أول غسلة.', 'Needs a water inlet and drain nearby, and the transit bolts must be removed before the first wash.') });
      if (s.family === 'cooker') items.push({ k: 'hm', text: t('البوتاجاز محتاج وصلة غاز وفنى معتمد — متركبوش بنفسك.', 'A cooker needs a gas connection fitted by an approved technician — do not install it yourself.') });
      if (s.f.warranty) items.push({ k: 'ok', text: t('الوصف بيذكر ضمان ' + s.f.warranty + ' سنة — اطلب كارت الضمان والفاتورة وقت الاستلام.', 'The description mentions a ' + s.f.warranty + '-year warranty — ask for the warranty card and invoice on delivery.') });
      else items.push({ k: 'hm', text: t('مدة الضمان مش مذكورة هنا — اسأل عنها قبل الشراء واحتفظ بالفاتورة.', 'Warranty length is not stated here — ask before buying and keep the invoice.') });

      // "a cheaper model does nearly the same job" — only when it is genuinely true
      const alt = cheaperTwin(p, s, peers);
      if (alt) items.push({ k: 'ok', text: t(
        'فيه موديل أرخص بنفس السعة تقريباً: ' + cleanTitle(alt.p.title) + ' بـ ' + A.money(alt.p.price) + ' — يوفّر ' + A.money(p.price - alt.p.price) + '.',
        'A cheaper model with almost the same capacity: ' + cleanTitle(alt.p.title) + ' at ' + A.money(alt.p.price) + ' — saving ' + A.money(p.price - alt.p.price) + '.'),
        href: A.P('product.html') + '?id=' + encodeURIComponent(alt.p.id) });

      return '<div class="panel"><h2 class="panel__h">' + t('حاجات تحب تعرفها', 'Good to know') + '</h2>' +
        '<p class="panel__sub">' + t('معلومات صريحة قبل ما تدفع — مش كلام تسويق.', 'Straight information before you pay — not marketing copy.') + '</p>' +
        '<ul class="why">' + items.map(i =>
          '<li><i class="' + (i.k === 'ok' ? 'ok' : 'hm') + '">' + (i.k === 'ok' ? '✓' : 'i') + '</i><span>' + esc(i.text) +
          (i.href ? ' <a href="' + i.href + '">' + t('شوفه', 'View') + '</a>' : '') + '</span></li>').join('') + '</ul></div>';
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
          '<span class="field__hint">' + t('جنيه لكل ك.و.س — غيّره حسب شريحتك.', 'EGP per kWh — change it to match your tariff band.') + '</span></label>' +
        '<div class="note note--soft mt16 small">' + t(
          'تقدير إرشادى بناءً على معدل استهلاك نموذجى للفئة والتعريفة اللى حددتها، ومش قيمة مضمونة للفاتورة. فاتورة الكهربا فى مصر بتتحسب بشرائح، والاستهلاك الحقيقى بيختلف حسب الاستخدام والجو.',
          'A guide estimate based on a typical consumption rate for this category and the tariff you entered — not a guaranteed bill. Egyptian electricity is billed in tiers and real usage varies with habits and weather.') + '</div></div>';
    }

    /* ---- 5. raw specs, with honest gaps ---- */
    function specsPanel(p, s) {
      const d = s.dims || {};
      const rows = [
        [t('الماركة', 'Brand'), s.brand ? t(s.brand.ar, s.brand.en) : null],
        [t('السعة', 'Capacity'), s.headline ? A.num(s.headline.v) + ' ' + t(s.headline.u, s.headline.uEn) : null],
        [t('الأبعاد (ع × ع × ا)', 'Dimensions (W × D × H)'), (d.w || d.d || d.h) ? [d.w, d.d, d.h].map(x => x || '؟').join(' × ') + ' ' + t('سم', 'cm') : null],
        [t('كفاءة الطاقة', 'Energy class'), s.energy.cls || null],
        [t('انفرتر', 'Inverter'), s.energy.inverter ? t('نعم', 'Yes') : null],
        [t('اللون', 'Finish'), s.color ? t(s.color.ar, s.color.key) : null],
        [t('عدد الأبواب', 'Doors'), s.f.doors || null],
        [t('الدقة', 'Resolution'), s.f.resolution || null],
        [t('قدرة التبريد', 'Cooling capacity'), s.cap.btu ? A.num(s.cap.btu) + ' BTU' : null],
        [t('الضمان', 'Warranty'), s.f.warranty ? t(s.f.warranty + ' سنة', s.f.warranty + ' years') : null],
      ];
      return '<div class="panel mt16"><h2 class="panel__h">' + t('المواصفات', 'Specifications') + '</h2>' +
        '<p class="panel__sub">' + t('مقروءة آلياً من وصف المنتج — اللى مش مذكور بنقول عليه «غير متوفر» بدل ما نخمّن.',
          'Read automatically from the product description — anything missing is shown as "not stated" rather than guessed.') + '</p>' +
        '<ul class="specs">' + rows.map(r => '<li><span class="k">' + esc(r[0]) + '</span><span class="v' + (r[1] ? '' : ' unknown') + '">' +
          esc(r[1] == null ? t('غير متوفر', 'not stated') : r[1]) + '</span></li>').join('') + '</ul>' +
        '<details class="mt16"><summary style="cursor:pointer;font-weight:800">' + t('الوصف الأصلى من صادكو', 'Original SADKO description') + '</summary>' +
        '<p class="small muted mt8" style="line-height:1.9">' + esc(S.norm(p.description) || t('لا يوجد وصف.', 'No description.')) + '</p></details></div>';
    }

    /* ---- 6. structured reviews (device-local) ---- */
    function reviewsPanel(p) {
      const mine = St.reviews.for(p.id);
      return '<div class="panel"><h2 class="panel__h">' + t('تقييمات المستخدمين', 'Owner reviews') + '</h2>' +
        '<p class="panel__sub">' + t('التقييم المفيد بيقول لك المدة والاستخدام، مش نجوم بس.', 'A useful review tells you how long and how it is used — not just stars.') + '</p>' +
        '<div class="note note--soft small">' + t(
          'لسه مفيش تقييمات منشورة للمنتج ده. أى تقييم بتكتبه هنا بيتسجّل على جهازك وبيتبعت للمراجعة قبل النشر — مش بيظهر لباقى الزوار على طول.',
          'No published reviews for this product yet. Anything you write here is saved on your device and queued for moderation — it is not shown to other visitors immediately.') + '</div>' +
        '<form id="revForm" class="mt16">' +
          '<label class="field"><span class="field__l">' + t('التقييم', 'Rating') + '</span>' +
            '<div class="opts">' + [1, 2, 3, 4, 5].map(n => '<label class="opt"><input type="radio" name="stars" value="' + n + '"' + (n === 5 ? ' checked' : '') + '><span>' + '★'.repeat(n) + '</span></label>').join('') + '</div></label>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + t('بقالك قد إيه بتستخدمه؟', 'How long have you owned it?') + '</span>' +
              '<select class="select" name="owned"><option value="">—</option>' +
              ['أقل من شهر|Under a month', 'من شهر لـ ٦ شهور|1–6 months', 'من ٦ شهور لسنة|6–12 months', 'أكتر من سنة|Over a year'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + t('عدد أفراد البيت', 'Household size') + '</span>' +
              '<input class="input" type="number" name="people" min="1" max="15" placeholder="—"></label>' +
          '</div>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + t('صوته عالى؟', 'Is it noisy?') + '</span>' +
              '<select class="select" name="noise"><option value="">—</option>' + ['هادى|Quiet', 'عادى|Normal', 'صوته عالى|Loud'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + t('استهلاك الكهربا', 'Energy use') + '</span>' +
              '<select class="select" name="energy"><option value="">—</option>' + ['موفر|Economical', 'عادى|Average', 'عالى|High'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field"><span class="field__l">' + t('التركيب كان سهل؟', 'Was installation easy?') + '</span>' +
              '<select class="select" name="install"><option value="">—</option>' + ['سهل|Easy', 'محتاج فنى|Needed a technician', 'صعب|Difficult'].map(o => { const [a, e] = o.split('|'); return '<option value="' + esc(a) + '">' + esc(t(a, e)) + '</option>'; }).join('') + '</select></label>' +
          '</div>' +
          '<label class="field"><span class="field__l">' + t('إيه اللى المشترى الجديد لازم يعرفه؟', 'What should another buyer know?') + '</span>' +
            '<textarea class="textarea" name="text" maxlength="600" placeholder="' + t('اكتب تجربتك بصراحة…', 'Write your honest experience…') + '"></textarea></label>' +
          '<button class="btn btn--teal" type="submit">' + t('ابعت للمراجعة', 'Submit for review') + '</button>' +
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
        t('هيعدى من باب ٧٠ سم؟', 'Will it fit through a 70 cm doorway?'),
        t('التركيب متضمن فى السعر؟', 'Is installation included in the price?'),
        t('الضمان من الشركة المصنّعة ولا من المتجر؟', 'Is the warranty from the manufacturer or the seller?'),
        t('محتاج خط كهربا خاص؟', 'Does it need a dedicated electrical circuit?'),
      ];
      return '<div class="panel"><h2 class="panel__h">' + t('أسئلة عن المنتج', 'Questions about this product') + '</h2>' +
        '<p class="panel__sub">' + t('اسأل، وفريق صادكو أو حد اشترى المنتج يجاوب. كل إجابة بيتكتب جنبها مصدرها.',
          'Ask, and SADKO staff or a verified owner answers. Every answer is labelled with its source.') + '</p>' +
        '<div class="chips">' + seeds.map(s => '<button class="chip" type="button" data-seed="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
        '<form id="qaForm" class="mt16"><label class="field"><span class="field__l">' + t('سؤالك', 'Your question') + '</span>' +
          '<textarea class="textarea" name="q" maxlength="400" style="min-height:74px" placeholder="' + t('اكتب سؤالك هنا…', 'Type your question…') + '"></textarea></label>' +
          '<button class="btn btn--teal" type="submit">' + t('ابعت السؤال', 'Send question') + '</button></form>' +
        '<div class="note note--soft small mt16">' + t(
          'مفيش أسئلة منشورة للمنتج ده لسه. سؤالك بيتسجّل على جهازك وبيروح للمراجعة — لو محتاج رد فورى كلّم 19140.',
          'No published questions for this product yet. Your question is saved on your device and queued for review — for an immediate answer call 19140.') + '</div>' +
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
        box.innerHTML = '<div class="panel mt16"><h2 class="panel__h">' + t('اقرأ كمان قبل ما تشترى', 'Read this before you buy') + '</h2>' +
          '<div class="chips mt8">' + list.map(g => '<a class="chip" href="' + A.P('guides.html') + '?g=' + encodeURIComponent(g.slug) + '">' +
            esc(t(g.title.ar, g.title.en)) + '</a>').join('') + '</div></div>';
      }).catch(() => {});
    }

    /* ================= wiring ================= */
    function wire(p, s, peers) {
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
