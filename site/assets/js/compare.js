/* SADKO price comparer — client. Talks to /api/compare (compare-server.mjs).
   Live mode: real-time web search across Egyptian stores, cheapest crowned.
   Bilingual: the whole page renders in Arabic (default) or English — the
   choice comes from the site-wide toggle in nav.js (localStorage sadko-lang)
   and is also sent to the engine so store names/titles come back localized. */

(function () {
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-US');

  const LANG = (window.skLang && window.skLang.get()) ||
    ((() => { try { return localStorage.getItem('sadko-lang'); } catch (e) { return null; } })() === 'en' ? 'en' : 'ar');

  const T = {
    ar: {
      title: 'قارن الأسعار — صادكو جروب',
      crumbHome: 'البيت', crumbArrow: '←', crumbHere: 'قارن الأسعار',
      heroTitle: 'قارن الأسعار فى مصر',
      heroMeta: 'اكتب اسم الجهاز — وإحنا نلف على المتاجر المصرية كلها ونجيب لك أرخص سعر',
      qPh: 'مثال: ثلاجة كريازى 16 قدم نوفروست — أو Kiriazi KH 336',
      go: '🔍 قارن دلوقتى', priceFrom: 'السعر من', priceTo: 'لحد', egp: 'جنيه', optional: 'اختيارى',
      fMega: 'مواقع كبرى', fLocal: 'متاجر محلية', fOfficial: 'متجر البراند الرسمى',
      fHint: 'الفلاتر اختيارية — من غيرها بنعرض كل النتايج',
      loading: 'بنلف على المتاجر المصرية الواحد ورا التانى (أمازون، بى تك، نون، جوميا، رنين…) — ممكن ياخد ٢٠–٤٠ ثانية عشان نجيب لك أدق سعر.',
      linksLabel: 'دوّر بنفسك كمان فى:',
      empty: 'مفيش نتايج بسعر واضح للبحث ده — جرّب اسم أدق (البراند + الموديل) أو وسّع نطاق السعر.',
      addTitle: 'عارف متجر مصرى مش بنفحصه؟',
      addBody: 'اكتب الدومين وإحنا هنكتشف منصته تلقائيًا ونضيفه لسجل المحرك — وهيتفحص فى كل مقارنة من هنا ورايح. (المحرك بيكتشف متاجر جديدة لوحده كمان مع كل بحث)',
      addPh: 'مثال: newstore.com.eg', addBtn: 'سجّل المتجر',
      hotline: 'الخط الساخن', copy: '© صادكو جروب 2026 — نسخة معاد تصميمها (Rebrand Preview)',
      types: { mega: 'موقع كبير', local: 'متجر محلى', official: 'المتجر الرسمى' },
      errTimeout: 'البحث خد وقت أطول من المتوقع — جرّب تانى (النتيجة بتتخزّن فبتيجى أسرع المرة الجاية).',
      errDown: 'المحرك مش شغال — تأكد إن السيرفر شغّال: افتح الموقع من http://localhost:8082 (مش file://) بعد ما تشغّل node compare-server.mjs',
      engine: n => '⚙️ <b>محرك صادكو الذاتى</b> — سألنا ' + n.scanned + ' متجر مصرى مباشرة، ردّ ' + n.responded,
      discovered: ' · 🆕 اكتشفنا وسجّلنا متاجر جديدة: ',
      unreachable: ' · <span style="opacity:.75">مواقع رفضت الرد (حماية بوتات): ',
      joiner: '، ',
      summary: (q, best, worst, n) =>
        `أرخص سعر لـ«${q}»: <b>${fmt(best.price)} جنيه</b> من ${best.store}` +
        (n > 1 && worst.price > best.price
          ? ` — <span class="save">بتوفّر ${fmt(worst.price - best.price)} جنيه</span> عن أغلى عرض (${fmt(worst.price)} ج)` : '') +
        ` · قارنّا ${n} ${n > 2 ? 'متاجر' : 'متجر'}`,
      crown: '👑 أرخص سعر', sadkoBadge: '🛡️ صادكو — ضمان وتركيب وصيانة',
      currency: 'جنيه', view: 'شوف العرض ↗', buySadko: 'اشترى من صادكو ↗', orderVia: '🛡️ اطلبها عبر صادكو',
      ccHead: 'ميزة صادكو',
      ccSadkoBest: 'صادكو هو <b>أرخص سعر</b> فعلاً — ومعاه اللى المقارنات التانية مبتديهوش: <b>تأكيد أصالة المنتج</b> قبل ما يوصلك، <b>توصيل وتركيب</b>، و<b>صيانة معتمدة بعد البيع</b> وقت ما تحتاج.',
      ccOther: (s, p) => `لقينا سعر أرخص من ${s} (${fmt(p)} ج). بس على عكس أى موقع مقارنة، صادكو ميوقّفش عند السعر: تقدر <b>تطلب نفس المنتج من صادكو</b> فنتأكد من <b>أصالته</b>، <b>نوصّله ونركّبه</b>، و<b>نصيّنه بعد البيع</b> — راحة بال بفرق بسيط.`,
      ccSteps: ['✅ فحص وتأكيد المنتج', '🚚 توصيل وتركيب', '🔧 صيانة بعد البيع'],
      ccCta: 'اطلب أى منتج عبر صادكو — 19140',
      addChecking: 'بنفحص المتجر…',
      addOk: note => '✓ اتسجّل (' + note + ') — هيدخل فى كل مقارنة جاية',
      addExists: 'موجود بالفعل', addPlatform: 'منصة: ',
      addFail: 'مقدرناش نسجّله', addDown: '⚠️ السيرفر مش شغال',
      flag_used: '⚠️ مستعمل/استيراد', flag_bundle: '🎁 باكدج', flag_mismatch: '≠ منتج مختلف', flag_variant: '≠ موديل تانى',
      top5: n => 'أرخص ٥ — #' + n,
      checked: m => m < 1 ? 'اتفحص حالًا' : 'اتفحص من ' + m + ' دقيقة',
      srcIndex: m => ' · ⚡ نتيجة فورية من الفهرس (عمرها ' + m + ' دقيقة)',
      aiOn: ' · 🧠 طبقة نيموترون الذكية شغالة',
      refreshingNote: ' · 🔄 لسه بنفحص متاجر إضافية فى الخلفية — النتايج بتتحدث لوحدها…',
      wasPrice: 'كان ',
      interpLabel: 'بندوّر على:',
      interpAsk: 'مش قادرين نحدد نوع الجهاز بالظبط — اختر من هنا:',
      interpPick: 'اختر النوع',
      interpRemove: 'شيل الفلتر ده',
      categories: {
        tv: 'تلفزيون', fridge: 'ثلاجة', freezer: 'فريزر', washer: 'غسالة', dishwasher: 'غسالة أطباق',
        dryer: 'مجفف', ac: 'تكييف', microwave: 'ميكروويف', oven: 'فرن', cooker: 'بوتاجاز',
        fryer: 'قلاية هوائية', heater: 'سخان', cooler: 'مبرد مياه', vacuum: 'مكنسة', blender: 'خلاط',
        kettle: 'غلاية', fan: 'مروحة', laptop: 'لاب توب', phone: 'موبايل', iron: 'مكواة',
        hob: 'مسطح طباخ', food_processor: 'محضر طعام', hand_mixer: 'مضرب بيض',
      },
      units: { kg: 'كيلو', rpm: 'لفة/د', inch: 'بوصة', liter: 'لتر', feet: 'قدم', cm: 'سم',
        hp: 'حصان', watt: 'وات', gb: 'جيجا', tb: 'تيرا' },
      specWords: {
        nofrost: 'نوفروست', inverter: 'انفرتر', smart: 'سمارت', digitalOn: 'ديجيتال', digitalOff: 'ميكانيكى',
        grill: 'جريل', steam: 'بخار',
        doors: n => n + ' أبواب', burners: n => n + ' شعلة', taps: n => n + ' حنفية', drawers: n => n + ' درج',
        sets: n => n + ' فرد', ram: n => n + ' جيجا رام', cpu: v => String(v).toUpperCase(),
        resolution: v => String(v).toUpperCase(),
        loadingTop: 'تحميل علوى', loadingFront: 'تحميل أمامى',
        fuelGas: 'غاز', fuelElectric: 'كهرباء',
        modeBoth: 'بارد/ساخن', modeCool: 'تبريد فقط',
        network: v => String(v).toUpperCase(),
        typeStand: 'عمود', typeWall: 'حائط', typeCeiling: 'سقف', typeDesk: 'مكتبى',
      },
    },
    en: {
      title: 'Compare Prices — SADKO Group',
      crumbHome: 'Home', crumbArrow: '→', crumbHere: 'Compare Prices',
      heroTitle: 'Compare prices across Egypt',
      heroMeta: 'Type a product name — we sweep every Egyptian store and bring you the cheapest price',
      qPh: 'e.g.: SHARP TV 75 Inch 4K Smart — or ثلاجة كريازى 16 قدم',
      go: '🔍 Compare now', priceFrom: 'Price from', priceTo: 'to', egp: 'EGP', optional: 'optional',
      fMega: 'Major sites', fLocal: 'Local stores', fOfficial: 'Official brand store',
      fHint: 'Filters are optional — without them we show everything',
      loading: 'Sweeping Egyptian stores one by one (Amazon, B.TECH, noon, Jumia, Raneen…) — this can take 20–40 seconds to get you the most accurate price.',
      linksLabel: 'Search yourself as well on:',
      empty: 'No results with a clear price for this search — try a more specific name (brand + model) or widen the price range.',
      addTitle: 'Know an Egyptian store we don’t check?',
      addBody: 'Type the domain — we auto-detect its platform and add it to the engine registry, so it gets checked in every comparison from now on. (The engine also discovers new stores on its own with every search.)',
      addPh: 'e.g.: newstore.com.eg', addBtn: 'Register store',
      hotline: 'Hotline', copy: '© SADKO Group 2026 — Rebrand Preview',
      types: { mega: 'Major site', local: 'Local store', official: 'Official store' },
      errTimeout: 'The search took longer than expected — try again (results get cached, so the next run is faster).',
      errDown: 'The engine is not running — make sure the server is up: open the site from http://localhost:8082 (not file://) after running node compare-server.mjs',
      engine: n => '⚙️ <b>SADKO self-owned engine</b> — queried ' + n.scanned + ' Egyptian stores directly, ' + n.responded + ' responded',
      discovered: ' · 🆕 discovered & registered new stores: ',
      unreachable: ' · <span style="opacity:.75">sites that refused to answer (bot protection): ',
      joiner: ', ',
      summary: (q, best, worst, n) =>
        `Cheapest price for “${q}”: <b>${fmt(best.price)} EGP</b> from ${best.store}` +
        (n > 1 && worst.price > best.price
          ? ` — <span class="save">you save ${fmt(worst.price - best.price)} EGP</span> vs the priciest offer (${fmt(worst.price)} EGP)` : '') +
        ` · compared ${n} store${n > 1 ? 's' : ''}`,
      crown: '👑 Cheapest price', sadkoBadge: '🛡️ SADKO — warranty, installation & service',
      currency: 'EGP', view: 'View offer ↗', buySadko: 'Buy from SADKO ↗', orderVia: '🛡️ Order via SADKO',
      ccHead: 'The SADKO edge',
      ccSadkoBest: 'SADKO really is the <b>cheapest price</b> — plus what other comparers never give you: <b>product-authenticity validation</b> before it reaches you, <b>delivery & installation</b>, and <b>certified after-sale maintenance</b> whenever you need it.',
      ccOther: (s, p) => `We found a cheaper price at ${s} (${fmt(p)} EGP). But unlike any comparison site, SADKO doesn’t stop at the price: you can <b>order the same product through SADKO</b> — we validate its <b>authenticity</b>, <b>deliver & install</b> it, and <b>service it after the sale</b> — peace of mind for a small difference.`,
      ccSteps: ['✅ Product check & validation', '🚚 Delivery & installation', '🔧 After-sale service'],
      ccCta: 'Order any product via SADKO — 19140',
      addChecking: 'Checking the store…',
      addOk: note => '✓ Registered (' + note + ') — it will join every comparison from now on',
      addExists: 'already registered', addPlatform: 'platform: ',
      addFail: 'Could not register it', addDown: '⚠️ The server is not running',
      flag_used: '⚠️ Used/import', flag_bundle: '🎁 Bundle', flag_mismatch: '≠ Different product', flag_variant: '≠ Other model',
      top5: n => 'Top 5 — #' + n,
      checked: m => m < 1 ? 'checked just now' : 'checked ' + m + ' min ago',
      srcIndex: m => ' · ⚡ instant result from the index (' + m + ' min old)',
      aiOn: ' · 🧠 Nemotron AI layer active',
      refreshingNote: ' · 🔄 still sweeping more stores in the background — results update automatically…',
      wasPrice: 'was ',
      interpLabel: 'Searching for:',
      interpAsk: "We couldn't tell the appliance type — pick one:",
      interpPick: 'Pick a type',
      interpRemove: 'Remove this filter',
      categories: {
        tv: 'TV', fridge: 'Fridge', freezer: 'Freezer', washer: 'Washing machine', dishwasher: 'Dishwasher',
        dryer: 'Dryer', ac: 'AC', microwave: 'Microwave', oven: 'Oven', cooker: 'Cooker',
        fryer: 'Air fryer', heater: 'Water heater', cooler: 'Water dispenser', vacuum: 'Vacuum', blender: 'Blender',
        kettle: 'Kettle', fan: 'Fan', laptop: 'Laptop', phone: 'Phone', iron: 'Iron',
        hob: 'Hob', food_processor: 'Food processor', hand_mixer: 'Hand mixer',
      },
      units: { kg: 'kg', rpm: 'rpm', inch: 'inch', liter: 'L', feet: 'ft', cm: 'cm',
        hp: 'HP', watt: 'W', gb: 'GB', tb: 'TB' },
      specWords: {
        nofrost: 'No Frost', inverter: 'Inverter', smart: 'Smart', digitalOn: 'Digital', digitalOff: 'Mechanical',
        grill: 'Grill', steam: 'Steam',
        doors: n => n + ' doors', burners: n => n + ' burners', taps: n => n + ' taps', drawers: n => n + ' drawers',
        sets: n => n + ' sets', ram: n => n + 'GB RAM', cpu: v => String(v).toUpperCase(),
        resolution: v => String(v).toUpperCase(),
        loadingTop: 'Top load', loadingFront: 'Front load',
        fuelGas: 'Gas', fuelElectric: 'Electric',
        modeBoth: 'Cool/Heat', modeCool: 'Cooling only',
        network: v => String(v).toUpperCase(),
        typeStand: 'Stand', typeWall: 'Wall', typeCeiling: 'Ceiling', typeDesk: 'Desk',
      },
    },
  }[LANG];

  /* apply static translations (the HTML is authored in Arabic) */
  if (LANG === 'en') {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    document.title = T.title;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (typeof T[k] === 'string') el.textContent = T[k];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const k = el.getAttribute('data-i18n-ph');
      if (typeof T[k] === 'string') el.placeholder = T[k];
    });
  }

  function activeTypes() {
    return [...document.querySelectorAll('.tf')].filter(c => c.checked).map(c => c.value);
  }

  /* ---- query-interpretation bar: category select from CATEGORIES + one
     removable chip per parsed unit/spec (see engine/serve.mjs interpretation).
     Every change re-runs the search carrying the override in the query string;
     the SERVER is the source of truth for the effective (post-override)
     identity, so each edit is built on top of the last response, not tracked
     independently on the client. ---- */
  const CATEGORY_KEYS = Object.keys(T.categories);

  function specLabel(spec, value) {
    const w = T.specWords;
    switch (spec) {
      case 'nofrost': return value ? w.nofrost : null;
      case 'inverter': return value ? w.inverter : null;
      case 'smart': return value ? w.smart : null;
      case 'digital': return value === true ? w.digitalOn : value === false ? w.digitalOff : null;
      case 'grill': return value ? w.grill : null;
      case 'steam': return value ? w.steam : null;
      case 'doors': return w.doors(value);
      case 'burners': return w.burners(value);
      case 'taps': return w.taps(value);
      case 'drawers': return w.drawers(value);
      case 'sets': return w.sets(value);
      case 'ram': return w.ram(value);
      case 'cpu': return w.cpu(value);
      case 'resolution': return w.resolution(value);
      case 'loading': return value === 'top' ? w.loadingTop : value === 'front' ? w.loadingFront : null;
      case 'fuel': return value === 'gas' ? w.fuelGas : value === 'electric' ? w.fuelElectric : null;
      case 'mode': return value === 'cool-heat' ? w.modeBoth : value === 'cool' ? w.modeCool : null;
      case 'network': return w.network(value);
      case 'type': return value === 'stand' ? w.typeStand : value === 'wall' ? w.typeWall
        : value === 'ceiling' ? w.typeCeiling : value === 'desk' ? w.typeDesk : null;
      default: return value === undefined || value === null ? null : String(value);
    }
  }
  function unitLabel(unit, value) { return value + ' ' + (T.units[unit] || unit); }

  /* builds the override query params for ONE edit on top of the last
     interpretation the server returned: `edit` mutates a working copy of
     {category, units, specs}. Every unit/spec key that was present in the
     base OR survives the edit is sent explicitly (empty value = cleared) so
     a single chip removal never accidentally un-overrides its siblings. */
  function buildOverrideParams(base, edit) {
    const work = { category: base.category || null, units: { ...(base.units || {}) }, specs: { ...(base.specs || {}) } };
    edit(work);
    const p = new URLSearchParams();
    if (work.category) p.set('cat', work.category);
    const unitKeys = new Set([...Object.keys(base.units || {}), ...Object.keys(work.units)]);
    for (const k of unitKeys) p.set('u_' + k, work.units[k] !== undefined ? work.units[k] : '');
    const specKeys = new Set([...Object.keys(base.specs || {}), ...Object.keys(work.specs)]);
    for (const k of specKeys) p.set('s_' + k, work.specs[k] !== undefined ? work.specs[k] : '');
    return p;
  }

  function renderInterp(interp) {
    const bar = $('interp');
    if (!interp) { bar.style.display = 'none'; lastInterp = null; return; }
    lastInterp = interp;
    bar.style.display = 'flex';
    bar.classList.toggle('interp--ask', !!interp.ambiguous);
    $('interpLabel').textContent = interp.ambiguous ? T.interpAsk : T.interpLabel;

    const keys = interp.ambiguous && Array.isArray(interp.alternatives) && interp.alternatives.length
      ? interp.alternatives : CATEGORY_KEYS;
    const opts = [];
    if (interp.ambiguous) opts.push(`<option value="">${T.interpPick}</option>`);
    for (const k of keys)
      opts.push(`<option value="${k}"${k === interp.category ? ' selected' : ''}>${T.categories[k] || k}</option>`);
    $('interpCat').innerHTML = opts.join('');

    const chip = (kind, key, label) =>
      `<span class="interp__chip">${label} <button type="button" data-remove="${kind}:${key}" aria-label="${T.interpRemove}">✕</button></span>`;
    const chips = [];
    for (const [k, v] of Object.entries(interp.units || {})) chips.push(chip('unit', k, unitLabel(k, v)));
    for (const [k, v] of Object.entries(interp.specs || {})) {
      const label = specLabel(k, v);
      if (label) chips.push(chip('spec', k, label));
    }
    $('interpChips').innerHTML = chips.join('');
  }

  let lastInterp = null;
  $('interpCat').addEventListener('change', () => {
    if (!lastInterp) return;
    const val = $('interpCat').value;
    run(buildOverrideParams(lastInterp, w => { w.category = val || null; }));
  });
  $('interpChips').addEventListener('click', e => {
    const btn = e.target.closest('button[data-remove]');
    if (!btn || !lastInterp) return;
    const [kind, key] = btn.dataset.remove.split(':');
    run(buildOverrideParams(lastInterp, w => { delete w[kind === 'unit' ? 'units' : 'specs'][key]; }));
  });

  let pollT = 0, pollN = 0, activeQ = '';
  let lastOverrideParams = null, lastQ = '';

  async function run(overrideParams) {
    const q = $('q').value.trim();
    if (q.length < 2) { $('q').focus(); return; }
    // a fresh query the shopper typed themselves drops any stale override from
    // a previous search; an override passed in explicitly (select/chip edit)
    // always sticks, and otherwise re-running the SAME query (e.g. toggling a
    // store-type filter) keeps whatever override was already in effect
    if (overrideParams) lastOverrideParams = overrideParams;
    else if (q !== lastQ) lastOverrideParams = null;
    lastQ = q;
    clearTimeout(pollT); pollN = 0; activeQ = q;
    $('loading').style.display = 'block';
    $('results').innerHTML = ''; $('summary').style.display = 'none';
    $('empty').hidden = true; $('modebar').style.display = 'none'; $('linksWrap').style.display = 'none';
    const data = await fetchData(q, lastOverrideParams);
    $('loading').style.display = 'none';
    render(q, data);
  }

  async function fetchData(q, overrideParams) {
    const p = new URLSearchParams({ q, lang: LANG });
    if (+$('min').value) p.set('min', $('min').value);
    if (+$('max').value) p.set('max', $('max').value);
    if (overrideParams) for (const [k, v] of overrideParams) p.set(k, v);
    try {
      const r = await fetch('/api/compare?' + p, { signal: AbortSignal.timeout(70000) });
      return await r.json();
    } catch (e) {
      return { error: (e && e.name === 'TimeoutError') ? T.errTimeout : T.errDown };
    }
  }

  function render(q, data) {
    if (q !== activeQ) return;                       // a newer search took over
    if (data.error) {
      $('modebar').className = 'modebar demo';
      $('modebar').style.display = 'block';
      $('modebar').textContent = '⚠️ ' + data.error;
      renderInterp(null);
      return;
    }

    // query-interpretation bar — only the catalog path returns this; a live
    // fan-out fallback has no parsed identity to confirm/correct
    renderInterp(data.interpretation || null);

    // engine stats banner: scan counts + index/AI/refresh state
    $('modebar').style.display = 'block';
    $('modebar').className = 'modebar live';
    const st = data.stats || {};
    $('modebar').innerHTML =
      T.engine({ scanned: st.scanned || 0, responded: st.responded || 0 }) +
      (st.src === 'index' ? T.srcIndex(Math.round((st.ageMs || 0) / 60000)) : '') +
      (st.ai ? T.aiOn : '') +
      (st.discovered && st.discovered.length ? T.discovered + st.discovered.join(T.joiner) : '') +
      (st.unreachable && st.unreachable.length ? T.unreachable + st.unreachable.join(T.joiner) + '</span>' : '') +
      (data.refreshing ? T.refreshingNote : '');

    const types = activeTypes();
    const rows = (data.results || []).filter(r => types.includes(r.type));

    // store search links always available
    $('links').innerHTML = (data.links || []).map(l =>
      `<a href="${l.url}" target="_blank" rel="noopener">${l.store} ↗</a>`).join('');
    $('linksWrap').style.display = 'block';

    if (rows.length) {
      $('empty').hidden = true;
      // summary strip crowns the cheapest ELIGIBLE offer (rank 1)
      const best = rows.find(r => r.rank === 1) || rows[0];
      const worst = rows[rows.length - 1];
      $('summary').style.display = 'block';
      $('summary').innerHTML = T.summary(data.query, best, worst, rows.length);

      // SADKO concierge edge — the differentiator vs a plain comparer like Pricena
      renderConcierge(data, best);

      $('results').innerHTML = rows.map(r => {
        const isSadko = r.domain === 'sadko-group.com';
        const crowned = r.rank === 1;
        const mins = r.checkedAt ? Math.round((Date.now() - r.checkedAt) / 60000) : null;
        return `<article class="offer${crowned ? ' best' : ''}${isSadko ? ' sadko' : ''}">` +
          `<span class="fav"><img src="https://www.google.com/s2/favicons?domain=${r.domain}&sz=64" alt="" loading="lazy"></span>` +
          `<div><h3></h3><div class="meta">` +
            (crowned ? `<span class="badge crown">${T.crown}</span>` : '') +
            (r.rank > 1 ? `<span class="badge top5">${T.top5(r.rank)}</span>` : '') +
            (isSadko ? `<span class="badge sadko">${T.sadkoBadge}</span>` : '') +
            (r.flags || []).map(f => `<span class="badge warn">${T['flag_' + f] || f}</span>`).join('') +
            `<span class="badge ${r.type}">${T.types[r.type] || r.type}</span>` +
            `<span dir="ltr">${r.domain}</span>` +
            (mins != null ? `<span class="fresh">${T.checked(mins)}</span>` : '') +
          `</div></div>` +
          `<div class="buy"><span class="price">${fmt(r.price)} <small>${T.currency}</small></span>` +
            (r.prevPrice && r.prevPrice !== r.price ? `<span class="was">${T.wasPrice}${fmt(r.prevPrice)}</span>` : '') +
            `<a class="btn" href="${r.url}" target="_blank" rel="noopener">${isSadko ? T.buySadko : T.view}</a>` +
            (isSadko ? '' : `<a class="btn concierge-btn" href="tel:19140">${T.orderVia}</a>`) +
          `</div>` +
        `</article>`;
      }).join('');
      document.querySelectorAll('#results .offer h3').forEach((h, i) => {
        h.textContent = rows[i].store + ' — ' + rows[i].title;
      });
    } else if (!data.refreshing) {
      $('empty').hidden = false;
    }

    // background sweep still running → poll and re-render with fresh offers
    if (data.refreshing && pollN < 12) {
      pollN++;
      pollT = setTimeout(async () => { render(q, await fetchData(q, lastOverrideParams)); }, 6000);
    }
  }

  function renderConcierge(data, best) {
    const box = document.getElementById('concierge');
    if (!box) return;
    const cheapestIsSadko = best && best.domain === 'sadko-group.com';
    box.style.display = 'block';
    box.innerHTML =
      `<div class="cc-head"><span class="cc-shield">🛡️</span><b>${T.ccHead}</b></div>` +
      `<p class="cc-body">` +
        (cheapestIsSadko ? T.ccSadkoBest : T.ccOther(best ? best.store : '—', best ? best.price : 0)) +
      `</p>` +
      `<div class="cc-steps">` + T.ccSteps.map(s => `<span>${s}</span>`).join('') + `</div>` +
      `<a class="cc-cta" href="tel:19140">${T.ccCta}</a>`;
  }

  $('go').addEventListener('click', run);
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  document.querySelectorAll('.tf').forEach(c => c.addEventListener('change', () => { if ($('results').innerHTML) run(); }));

  // manual store registration → POST /api/stores (engine probes the platform)
  const addBtn = $('addStore');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const d = $('storeDomain').value.trim();
    if (!d) return;
    addBtn.disabled = true; addBtn.textContent = T.addChecking;
    try {
      const r = await fetch('/api/stores', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: d }) });
      const j = await r.json();
      $('addMsg').textContent = j.ok
        ? T.addOk(j.note ? T.addExists : T.addPlatform + (j.store && j.store.platform))
        : '⚠️ ' + (j.error || T.addFail);
    } catch { $('addMsg').textContent = T.addDown; }
    addBtn.disabled = false; addBtn.textContent = T.addBtn;
  });

  // deep-link: compare.html?q=...
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { $('q').value = q0; run(); }
})();
