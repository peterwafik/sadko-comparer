/* ============================================================================
   SADKO guided finder — rule-based, explainable product recommendation.
   ----------------------------------------------------------------------------
   Two halves:
     skFinder.evaluate(...)  the engine — pure, testable, no DOM
     mountFinder(...)        the page UI

   DESIGN RULES taken from the brief and enforced here:
   • Hard filters run BEFORE scoring, and only on facts we actually have. A
     product whose width we could not read is never silently excluded by a
     width filter — it is kept and flagged, because dropping a good product on
     missing data is worse than showing it with a caveat.
   • The output is never a bare "97% match". Every pick carries a list of plain
     sentences — what fits, what doesn't, and what we couldn't check.
   • Exclusions are counted and shown, so the shortlist can be trusted.
   ========================================================================== */
(function () {
  'use strict';

  const S = () => window.skSpecs;

  /* ================= engine ================= */

  // Clamp helper: 1 when inside [min,max], decaying outside.
  function fitRange(v, min, max) {
    if (v == null || min == null) return null;
    if (v >= min && v <= max) return 1;
    if (v < min) return Math.max(0, 1 - (min - v) / Math.max(min, 1) * 1.6);
    return Math.max(0.45, 1 - (v - max) / Math.max(max, 1) * 0.9);   // oversized is usable, just wasteful
  }

  function capacityTarget(family, answers, set) {
    // Household-size tables live in specs.js; option-level `range` overrides them.
    const q = (set.questions || []).find(x => x.spec === 'capacity');
    if (!q) return null;
    const val = answers[q.id];
    if (val == null || val === '') return null;
    if (q.type === 'number') {           // AC: room area -> HP band
      const band = S().acHpFor(Number(val));
      return band ? { min: band.min, max: band.max, unit: 'HP', from: 'room' } : null;
    }
    const opt = (q.options || []).find(o => String(o.value) === String(val));
    if (opt && opt.range) return { min: opt.range[0], max: opt.range[1], from: 'range' };
    const band = S().sizeFor(family, Number(val));
    return band ? { min: band.min, max: band.max, from: 'people' } : null;
  }

  function preferredFeatures(answers, set) {
    const want = [];
    (set.questions || []).forEach(q => {
      const v = answers[q.id];
      if (v == null) return;
      const opt = (q.options || []).find(o => String(o.value) === String(v));
      if (opt && opt.prefer) want.push.apply(want, opt.prefer);
    });
    return want;
  }

  function hasFeature(spec, key) {
    const f = spec.f || {};
    switch (key) {
      case 'noFrost': return f.noFrost === true;
      case 'doors2': return f.doors >= 2;
      case 'smart': return f.smart === true;
      case 'heating': return f.heating === true;
      case 'frontLoad': return f.frontLoad === true;
      case 'topLoad': return f.topLoad === true;
      case '4K': return String(f.resolution || '').indexOf('4K') >= 0;
      default: return false;
    }
  }
  const FEATURE_LABEL = {
    noFrost: { ar: 'نو فروست', en: 'No-frost' },
    doors2: { ar: 'بابين أو أكتر', en: 'two or more doors' },
    smart: { ar: 'سمارت / تطبيقات', en: 'smart apps' },
    heating: { ar: 'بارد وساخن', en: 'cooling & heating' },
    frontLoad: { ar: 'تحميل أمامى', en: 'front loading' },
    topLoad: { ar: 'تحميل علوى', en: 'top loading' },
    '4K': { ar: 'دقة 4K', en: '4K' },
  };

  function evaluate(list, family, answers, cfg) {
    const t = (ar, en) => (window.skApp && window.skApp.EN() ? en : ar);
    const set = (cfg.families[family] || cfg.families._default);
    const W = Object.assign({ capacity: 20, budget: 40, energy: 15, features: 15, brand: 10 }, set.weights || {});
    const target = capacityTarget(family, answers, set);
    const wantFeat = preferredFeatures(answers, set);
    const wantBrands = (answers.brand || []).filter(Boolean);
    const budget = Number(answers.budget) || 0;
    const maxW = Number(answers.maxW) || 0, maxH = Number(answers.maxH) || 0, maxD = Number(answers.maxD) || 0;
    const energyPri = answers.energy || 'mid';

    // Energy priority re-weights the model, exactly as the brief describes:
    // caring about running cost should make efficiency count for more.
    const w = Object.assign({}, W);
    const pri = energyPri === 'high' ? 1.5 : energyPri === 'low' ? 0.3 : 1;
    const moved = W.energy * (1 - pri);
    w.energy = W.energy * pri;
    w.budget = W.budget + moved;        // whatever efficiency gives up goes to price

    const eligible = [], excluded = [], nearMiss = [];

    list.forEach(p => {
      const spec = S().of(p);
      const price = spec.price;
      const R = [];                      // reasons, in display order

      /* ---- hard filters: only on facts we have ---- */
      if (budget && price > budget) {
        if (price <= budget * 1.08) nearMiss.push({ p, spec, over: price - budget });
        else excluded.push({ p, why: 'budget' });
        return;
      }
      const d = spec.dims || {};
      if (maxW && d.w && d.w > maxW) { excluded.push({ p, why: 'width' }); return; }
      if (maxH && d.h && d.h > maxH) { excluded.push({ p, why: 'height' }); return; }
      if (maxD && d.d && d.d > maxD) { excluded.push({ p, why: 'depth' }); return; }

      /* ---- scores ---- */
      const cap = spec.headline ? spec.headline.v : null;
      let sCap = 0.5;
      if (target && cap != null) {
        sCap = fitRange(cap, target.min, target.max);
        const unit = spec.headline.u;
        if (sCap === 1) R.push({ k: 'ok', text: t(
          'السعة ' + cap + ' ' + unit + ' مناسبة للاستخدام الذى وصفته (المقترح ' + target.min + '–' + target.max + ' ' + unit + ').',
          'Capacity ' + cap + ' ' + spec.headline.uEn + ' suits what you described (suggested ' + target.min + '–' + target.max + ').') });
        else if (cap < target.min) R.push({ k: 'hm', text: t(
          'السعة ' + cap + ' ' + unit + ' أقل من المقترح (' + target.min + '–' + target.max + ' ' + unit + ')، ممكن تكفى لو استخدامك خفيف.',
          'Capacity ' + cap + ' is below the suggested ' + target.min + '–' + target.max + ', fine for light use.') });
        else R.push({ k: 'hm', text: t(
          'أكبر من احتياجك (' + cap + ' ' + unit + ' مقابل مقترح ' + target.min + '–' + target.max + ')، سيستهلك مساحة وكهرباء أكثر.',
          'Larger than you need (' + cap + ' vs suggested ' + target.min + '–' + target.max + '): more space and power.') });
      } else if (target && cap == null) {
        sCap = 0.45;
        R.push({ k: 'hm', text: t('السعة غير مذكورة فى بيانات المنتج، تأكد منها قبل الشراء.', 'Capacity is not stated in the product data. Please confirm before buying.') });
      }

      let sBudget = 0.6;
      if (budget) {
        sBudget = 0.55 + 0.45 * (1 - Math.min(1, price / budget));
        R.push({ k: 'ok', text: t('ضمن ميزانيتك (' + window.skApp.money(price) + ' من ' + window.skApp.money(budget) + ').',
                                  'Within your budget (' + window.skApp.money(price) + ' of ' + window.skApp.money(budget) + ').') });
      }

      const e = spec.energy || {};
      let sEnergy = e.cls === 'A' ? 1 : e.saving ? 0.85 : (e.cls ? 0.35 : 0.5);
      if (energyPri !== 'low') {
        if (e.cls) R.push({ k: e.cls === 'A' ? 'ok' : 'hm', text: t('درجة كفاءة الطاقة: ' + e.cls + '.', 'Energy class: ' + e.cls + '.') });
        else if (e.inverter) R.push({ k: 'ok', text: t('انفرتر، بيوفر فى الكهربا مع التشغيل الطويل.', 'Inverter: saves power over long run times.') });
        else if (e.saving) R.push({ k: 'ok', text: t('الوصف بيذكر توفير فى استهلاك الكهربا.', 'The description mentions reduced power consumption.') });
        else R.push({ k: 'hm', text: t('لا توجد بيانات واضحة لكفاءة الطاقة لهذا المنتج.', 'No clear energy-efficiency data for this product.') });
      }

      let sFeat = 0.7;
      if (wantFeat.length) {
        const hit = wantFeat.filter(k => hasFeature(spec, k));
        sFeat = hit.length / wantFeat.length;
        hit.forEach(k => R.push({ k: 'ok', text: t('فيه ' + (FEATURE_LABEL[k] || {}).ar + '.', 'Has ' + (FEATURE_LABEL[k] || {}).en + '.') }));
        wantFeat.filter(k => !hit.includes(k)).forEach(k => R.push({ k: 'no',
          text: t('لسنا على يقين من وجود ' + (FEATURE_LABEL[k] || {}).ar + '، فهو غير مذكور فى بيانات المنتج.',
                  'We could not confirm ' + (FEATURE_LABEL[k] || {}).en + '. It is not in the product data.') }));
      }

      let sBrand = 0.7;
      if (wantBrands.length) {
        const b = spec.brand && spec.brand.en;
        if (b && wantBrands.includes(b)) { sBrand = 1; R.push({ k: 'ok', text: t('من العلامات التجارية التى اخترتها (' + spec.brand.ar + ').', 'One of your preferred brands (' + b + ').') }); }
        else { sBrand = 0.45; R.push({ k: 'hm', text: t('ليس من العلامات التجارية التى اخترتها.', 'Not one of your preferred brands.') }); }
      }

      // Colour preference is a nudge only, never a filter.
      if (answers.color && answers.color !== 'any') {
        if (spec.color && spec.color.key === answers.color) { sBrand = Math.min(1, sBrand + 0.15); R.push({ k: 'ok', text: t('اللون ' + spec.color.ar + ' كما تشاء.', 'Finish is ' + spec.color.key + ', as you preferred.') }); }
      }

      /* ---- space verdict ---- */
      if (maxW || maxH || maxD) {
        if (!d.w && !d.h && !d.d) R.push({ k: 'hm', text: t('أبعاد المنتج غير متوفرة لدينا، قِس المكان وتأكد قبل الشراء.', 'We do not have this product\'s dimensions. Measure and confirm before buying.') });
        else {
          const bits = [];
          if (maxW && d.w) bits.push(t('العرض ' + d.w + ' سم', 'width ' + d.w + ' cm'));
          if (maxH && d.h) bits.push(t('الارتفاع ' + d.h + ' سم', 'height ' + d.h + ' cm'));
          if (maxD && d.d) bits.push(t('العمق ' + d.d + ' سم', 'depth ' + d.d + ' cm'));
          if (bits.length) R.push({ k: 'ok', text: t('يتسع للمساحة التى حددتها (' + bits.join('، ') + ').', 'Fits the space you gave (' + bits.join(', ') + ').') });
        }
      }

      const total = (w.capacity * sCap + w.budget * sBudget + w.energy * sEnergy + w.features * sFeat + w.brand * sBrand)
                  / (w.capacity + w.budget + w.energy + w.features + w.brand);
      // "capability" ranks the higher-feature pick without letting price decide it
      const capability = 0.5 * (target && cap != null ? Math.min(1.3, (cap / Math.max(target.max, 1))) : 0.5)
                       + 0.3 * sFeat + 0.2 * sEnergy;
      eligible.push({ p, spec, score: total, capability, reasons: R, price });
    });

    eligible.sort((a, b) => b.score - a.score || a.price - b.price);

    /* ---- the three picks ---- */
    const picks = {};
    if (eligible.length) {
      const best = eligible[0];
      picks.balanced = best;
      const good = eligible.filter(x => x.score >= best.score * 0.78);
      picks.value = good.slice().sort((a, b) => a.price - b.price)[0];
      const upper = eligible.filter(x => x.price > (picks.value ? picks.value.price : 0));
      picks.premium = upper.slice().sort((a, b) => b.capability - a.capability || b.price - a.price)[0];
      // keep the three distinct where the catalogue allows it
      if (picks.value && picks.balanced && picks.value.p.id === picks.balanced.p.id) {
        const alt = good.slice().sort((a, b) => a.price - b.price).find(x => x.p.id !== picks.value.p.id);
        if (alt) picks.balanced = eligible.find(x => x.p.id !== picks.value.p.id) || picks.balanced;
      }
      if (picks.premium && picks.balanced && picks.premium.p.id === picks.balanced.p.id) {
        picks.premium = upper.slice().sort((a, b) => b.capability - a.capability)
          .find(x => x.p.id !== picks.balanced.p.id) || null;
      }
      if (picks.premium && picks.value && picks.premium.p.id === picks.value.p.id) picks.premium = null;
    }

    const stats = { total: list.length, eligible: eligible.length,
                    excluded: excluded.length, nearMiss: nearMiss.length,
                    byWhy: excluded.reduce((m, x) => (m[x.why] = (m[x.why] || 0) + 1, m), {}) };
    return { picks, ranked: eligible, excluded, nearMiss, stats, target, set, family };
  }

  window.skFinder = { evaluate, fitRange, FEATURE_LABEL, hasFeature };

  /* ================= page UI ================= */
  function mountFinder(root) {
    const A = window.skApp, t = A.t, esc = A.esc;
    let CFG = null, CAT = A.qs('cat', ''), answers = {}, BRANDS = [];

    const state = { list: [], family: '_default' };

    Promise.all([fetch(A.P('data/finder.json')).then(r => r.json()), A.products(), A.liveCats()])
      .then(([cfg, all, cats]) => { CFG = cfg; boot(all, cats); })
      .catch(() => { root.innerHTML = A.empty(t('تعذّر تحميل بيانات المساعد.', 'Could not load the finder data.')); });

    function boot(all, cats) {
      if (!CAT) return renderPicker(cats);
      state.list = all.filter(p => String(p.categoryId) === String(CAT));
      if (!state.list.length) return renderPicker(cats, t('لا توجد منتجات فى هذه الفئة حالياً، اختر فئة أخرى.', 'No products in that category yet. Pick another.'));
      state.family = window.skSpecs.FAMILY[String(CAT)] || '_default';
      BRANDS = [...new Set(state.list.map(p => { const s = window.skSpecs.of(p); return s.brand && s.brand.en; }).filter(Boolean))].sort();
      // reuse anything the visitor told us before
      const prof = window.skStore.profile.get();
      if (prof.people) answers.people = prof.people;
      if (prof.budget) answers.budget = prof.budget;
      renderForm();
    }

    function renderPicker(cats, msg) {
      root.innerHTML =
        '<div class="panel"><h2 class="panel__h">' + t('اختر الجهاز الذى تبحث عنه', 'Pick the appliance you are shopping for') + '</h2>' +
        '<p class="panel__sub">' + t('سنسألك من ٣ إلى ٦ أسئلة بسيطة عن منزلك واستخدامك، ونرشّح ٣ خيارات مع سبب واضح لكل منها.',
          'We will ask 3–6 simple questions about your home and how you use it, then suggest three options, each with a clear reason.') + '</p>' +
        (msg ? '<div class="note note--warn mt16">' + esc(msg) + '</div>' : '') +
        '<div class="chips mt16">' + cats.map(c =>
          '<a class="chip" href="?cat=' + c.id + '">' + esc(c.name) + ' <span class="muted">(' + A.num(c.count) + ')</span></a>').join('') +
        '</div></div>';
    }

    function q_choice(q) {
      return '<div class="opts">' + (q.options || []).map((o, i) =>
        '<label class="opt"><input type="radio" name="' + q.id + '" value="' + esc(o.value) + '"' +
        (String(answers[q.id]) === String(o.value) ? ' checked' : '') + '>' +
        '<span>' + esc(t(o.label.ar, o.label.en)) + '</span></label>').join('') + '</div>';
    }
    function q_space(q) {
      return '<div class="row">' +
        ['maxW,' + t('أقصى عرض', 'Max width'), 'maxH,' + t('أقصى ارتفاع', 'Max height'), 'maxD,' + t('أقصى عمق', 'Max depth')]
          .map(s => { const [k, l] = s.split(','); return '<label class="field" style="margin:0"><span class="field__l">' + esc(l) + ' <span class="muted small">' + t('سم', 'cm') + '</span></span>' +
            '<input class="input" type="number" inputmode="numeric" min="10" max="400" name="' + k + '" value="' + (answers[k] || '') + '" placeholder="-"></label>'; }).join('') +
        '</div>';
    }
    function q_budget() {
      return '<label class="field" style="margin:0"><span class="field__l">' + t('أقصى سعر', 'Maximum price') + ' <span class="muted small">' + t('جنيه', 'EGP') + '</span></span>' +
        '<input class="input" type="number" inputmode="numeric" min="0" step="100" name="budget" value="' + (answers.budget || '') + '" placeholder="' + t('مثال: 25000', 'e.g. 25000') + '"></label>';
    }
    function q_number(q) {
      return '<label class="field" style="margin:0"><span class="field__l">' + esc(t(q.label.ar, q.label.en)) +
        ' <span class="muted small">' + esc(t((q.unitLabel || {}).ar || '', (q.unitLabel || {}).en || '')) + '</span></span>' +
        '<input class="input" type="number" inputmode="numeric" min="4" max="200" name="' + q.id + '" value="' + (answers[q.id] || '') + '"></label>';
    }
    function q_brands() {
      if (!BRANDS.length) return '<p class="muted small">' + t('لا توجد علامات تجارية محددة فى هذه الفئة.', 'No brand data in this category.') + '</p>';
      const sel = answers.brand || [];
      return '<div class="opts">' + BRANDS.map(b =>
        '<label class="opt"><input type="checkbox" name="brand" value="' + esc(b) + '"' + (sel.includes(b) ? ' checked' : '') + '>' +
        '<span>' + esc(b) + '</span></label>').join('') + '</div>';
    }

    function renderForm() {
      const set = CFG.families[state.family] || CFG.families._default;
      const qs = set.questions || [];
      root.innerHTML =
        '<div class="between mt0"><div><h2 class="panel__h" style="font-size:1.25rem">' +
          t('ساعدنى أختار: ', 'Help me choose: ') + esc(A.catName(CAT)) + '</h2>' +
          '<p class="muted small" style="margin:4px 0 0">' + t('أجب عما تعرفه واترك الباقى، فكل سؤال اختيارى عدا الميزانية.',
            'Answer what you know and skip the rest: every question is optional except budget.') + '</p></div>' +
          '<a class="btn btn--quiet btn--sm" href="finder.html">' + t('غيّر الفئة', 'Change category') + '</a></div>' +
        '<form id="fq" class="mt16">' +
          qs.map(q => '<div class="panel" style="margin-bottom:14px"><div class="panel__h">' + esc(t(q.label.ar, q.label.en)) + '</div>' +
            (q.hint ? '<p class="panel__sub">' + esc(t(q.hint.ar, q.hint.en)) + '</p>' : '') +
            (q.type === 'choice' ? q_choice(q) : q.type === 'space' ? q_space(q) : q.type === 'budget' ? q_budget()
             : q.type === 'number' ? q_number(q) : q.type === 'brands' ? q_brands() : '') +
            '</div>').join('') +
          '<div class="between"><button type="submit" class="btn btn--primary">' + t('اعرض الترشيحات', 'Show my matches') + '</button>' +
          '<span class="muted small">' + t('بنقارن ', 'Comparing ') + A.num(state.list.length) + t(' منتج فى الفئة دى.', ' products in this category.') + '</span></div>' +
        '</form><div id="fres" class="mt24"></div>';

      const form = root.querySelector('#fq');
      form.addEventListener('submit', e => { e.preventDefault(); collect(form); run(); });
      form.addEventListener('change', () => collect(form));
    }

    function collect(form) {
      const fd = new FormData(form);
      answers.brand = fd.getAll('brand');
      ['budget', 'maxW', 'maxH', 'maxD'].forEach(k => { const v = fd.get(k); answers[k] = v ? Number(v) : undefined; });
      (CFG.families[state.family] || CFG.families._default).questions.forEach(q => {
        if (q.type === 'choice' || q.type === 'number') { const v = fd.get(q.id); if (v != null && v !== '') answers[q.id] = isNaN(v) ? v : Number(v); }
      });
      window.skStore.profile.set({ people: answers.people, budget: answers.budget });
    }

    function run() {
      const out = window.skFinder.evaluate(state.list, state.family, answers, CFG);
      const host = root.querySelector('#fres');
      if (!out.ranked.length) {
        host.innerHTML = '<div class="panel"><div class="note note--warn">' +
          t('لا يوجد منتج مطابق لهذه الشروط. جرّب رفع الميزانية قليلاً أو توسيع المقاسات.',
            'Nothing matches those limits. Try raising the budget or relaxing the measurements.') + '</div>' +
          excludedNote(out) + '</div>';
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const cards = [
        ['value', t('أقل سعر مناسب', 'Lowest suitable price'), t('أرخص خيار ما زال يحقق شروطك.', 'The cheapest option that still meets your requirements.')],
        ['balanced', t('الأنسب إجمالاً', 'Best balanced choice'), t('أحسن توازن بين السعر والمواصفات لطلبك.', 'The best balance of price and specification for your answers.')],
        ['premium', t('مواصفات أعلى', 'Higher-feature choice'), t('إن أمكنك الزيادة قليلاً، فهذا يقدم أكثر.', 'If you can stretch a little, this offers more.')],
      ].filter(([k]) => out.picks[k]);

      host.innerHTML =
        '<h3 class="panel__h" style="font-size:1.15rem">' + t('ترشيحاتنا', 'Our suggestions') + '</h3>' +
        '<p class="muted small" style="margin:2px 0 14px">' +
          t('اخترناهم من ', 'Chosen from ') + A.num(out.stats.eligible) + t(' منتج مطابق لشروطك.', ' products that met your requirements.') + '</p>' +
        '<div class="grid3">' + cards.map(([k, label, sub]) => card(out.picks[k], label, sub)).join('') + '</div>' +
        '<div class="panel mt16">' + excludedNote(out) +
          '<details class="mt16"><summary style="cursor:pointer;font-weight:800">' +
            t('اعرض كل المنتجات المطابقة (', 'See all matching products (') + A.num(out.ranked.length) + ')</summary>' +
            '<div class="grid3 mt16">' + out.ranked.slice(0, 24).map(r => card(r)).join('') + '</div></details>' +
        '</div>';
      wire(host);
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function excludedNote(out) {
      const s = out.stats, why = s.byWhy || {};
      const bits = [];
      if (why.budget) bits.push(A.num(why.budget) + t(' فوق الميزانية', ' over budget'));
      if (why.width) bits.push(A.num(why.width) + t(' أعرض من المساحة', ' too wide'));
      if (why.height) bits.push(A.num(why.height) + t(' أطول من المساحة', ' too tall'));
      if (why.depth) bits.push(A.num(why.depth) + t(' أعمق من المساحة', ' too deep'));
      let html = '<p class="small muted" style="margin:0">' +
        t('استبعدنا ', 'We excluded ') + A.num(s.excluded) + t(' منتج', ' products') +
        (bits.length ? ' (' + bits.join(t('، ', ', ')) + ')' : '') + '. ' +
        t('يعتمد الترتيب على إجاباتك، لا على إعلانات مدفوعة.', 'Ranking is based on your answers, not paid placement.') + '</p>';
      if (out.nearMiss.length) {
        html += '<div class="note note--warn mt16">' + t('فيه ', 'There ') + A.num(out.nearMiss.length) +
          t(' منتج أعلى من ميزانيتك بفارق بسيط (أقل من ٨٪)، فإن كانت الميزانية مرنة قليلاً فهى جديرة بالاطلاع.',
            ' product(s) sit just over your budget (under 8%), worth a look if you have a little flexibility.') + '</div>';
      }
      return html;
    }

    function card(r, label, sub) {
      const p = r.p, s = r.spec;
      const cap = s.headline ? A.num(s.headline.v) + ' ' + t(s.headline.u, s.headline.uEn) : '';
      return '<article class="pcard">' +
        (label ? '<div style="padding:12px 14px 0"><span class="badge badge--amber">' + esc(label) + '</span></div>' : '') +
        '<div class="pcard__img"><img loading="lazy" src="' + esc(p.image) + '" alt=""></div>' +
        '<div class="pcard__b">' +
          (sub ? '<p class="muted small" style="margin:0">' + esc(sub) + '</p>' : '') +
          '<h4 class="pcard__t">' + esc(p.title) + '</h4>' +
          '<div class="between"><span class="pcard__p">' + A.money(p.price) + '</span>' +
            (cap ? '<span class="chip chip--mute">' + esc(cap) + '</span>' : '') + '</div>' +
          '<ul class="why">' + r.reasons.slice(0, 5).map(x =>
            '<li><i class="' + (x.k === 'ok' ? 'ok' : x.k === 'no' ? 'no' : 'hm') + '">' +
            (x.k === 'ok' ? '✓' : x.k === 'no' ? '!' : 'i') + '</i><span>' + esc(x.text) + '</span></li>').join('') + '</ul>' +
          '<div class="pcard__row">' +
            '<a class="btn btn--teal btn--sm" href="' + A.P('product.html') + '?id=' + encodeURIComponent(p.id) + '">' + t('التفاصيل', 'Details') + '</a>' +
            '<button class="btn btn--ghost btn--sm" data-save="' + esc(p.id) + '">' + (window.skStore.saved.has(p.id) ? t('محفوظ ✓', 'Saved ✓') : t('احفظ', 'Save')) + '</button>' +
          '</div>' +
        '</div></article>';
    }

    function wire(host) {
      host.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-save');
        A.byId(id).then(p => {
          const on = window.skStore.saved.toggle(p);
          b.textContent = on ? t('محفوظ ✓', 'Saved ✓') : t('احفظ', 'Save');
        });
      }));
    }
  }

  window.mountFinder = mountFinder;
})();
