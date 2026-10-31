/* ============================================================================
   SADKO house & room profiles — one definition, used everywhere.
   ----------------------------------------------------------------------------
   A customer rarely furnishes one box. They have a flat, maybe a place on the
   coast, and within those a kitchen and a bedroom with very different needs.
   So a "profile" here is a NAMED PLACE, a person can keep several, and exactly
   one is active at a time. The active place is what the "filter for my home"
   switch uses on every product grid, what the guided finder pre-fills from,
   and what the product page measures its space check against.

   This module is the single source of truth for:
     • which questions exist (FIELDS)  — add one here and it appears in the
       sign-up form, the account editor and the filter, with no other edits;
     • how a place is summarised in a sentence (summary);
     • the switcher UI shared by the account page and the preference bar.

   Everything is optional. A place with just a name still works; the filter
   simply has less to go on and says so.
   ========================================================================== */
(function () {
  'use strict';

  const EN = () => !!(window.skLang && window.skLang.get() === 'en');
  const t = (ar, en) => (EN() ? en : ar);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ICONS = ['🏠', '🏢', '🏡', '🏖️', '🛏️', '🍳', '🧺', '🛋️', '🚿', '🧒'];

  /* Quick starts, so the first place takes one click rather than a form. */
  function PRESETS() {
    return [
      { key: 'flat',    icon: '🏢', name: t('شقتى', 'My flat'),          scope: 'home', homeType: 'apartment' },
      { key: 'villa',   icon: '🏡', name: t('المنزل', 'The house'),        scope: 'home', homeType: 'villa' },
      { key: 'chalet',  icon: '🏖️', name: t('شاليه الساحل', 'Coast chalet'), scope: 'home', homeType: 'chalet', coastal: true },
      { key: 'kitchen', icon: '🍳', name: t('المطبخ', 'The kitchen'),     scope: 'room', roomType: 'kitchen' },
      { key: 'bedroom', icon: '🛏️', name: t('غرفة النوم', 'Bedroom'),     scope: 'room', roomType: 'bedroom' },
      { key: 'laundry', icon: '🧺', name: t('غرفة الغسيل', 'Laundry room'), scope: 'room', roomType: 'laundry' },
    ];
  }

  /* ---- the questions ----
     `rooms:true`  → only shown for a single-room place
     `homes:true`  → only shown for a whole-home place
     no flag       → shown for both */
  function FIELDS() {
    const yn = [['yes', t('نعم', 'Yes')], ['no', t('لا', 'No')]];
    return [
      { g: t('المكان', 'The place'), fields: [
        { k: 'name', type: 'text', max: 40, l: t('اسم المكان', 'Name this place'),
          h: t('مثل «شقة مدينة نصر» أو «شاليه الساحل»، للتمييز بينها.', 'Such as "the flat in Nasr City" or "coast chalet", so you can tell them apart.') },
        { k: 'icon', type: 'icon', l: t('أيقونة', 'Icon') },
        { k: 'scope', type: 'choice', l: t('أهو منزل كامل أم غرفة؟', 'A whole home or one room?'),
          opts: [['home', t('منزل كامل', 'Whole home')], ['room', t('غرفة واحدة', 'A single room')]] },
        { k: 'roomType', type: 'choice', rooms: true, l: t('نوع الغرفة', 'Room type'),
          opts: [['kitchen', t('مطبخ', 'Kitchen')], ['living', t('معيشة', 'Living room')], ['bedroom', t('نوم', 'Bedroom')],
                 ['laundry', t('غسيل', 'Laundry')], ['bathroom', t('حمّام', 'Bathroom')], ['other', t('غير ذلك', 'Other')]] },
      ] },

      { g: t('مين ساكن هنا', 'Who lives here'), fields: [
        { k: 'people', type: 'number', min: 1, max: 20, l: t('عدد الأفراد', 'People'),
          h: t('بنحدد بيها سعة الثلاجة والغسالة المناسبة.', 'Sets the fridge and washer capacity we suggest.') },
        { k: 'kids', type: 'choice', opts: yn, l: t('فيه أطفال؟', 'Children?'),
          h: t('نرجّح الأجهزة المزوّدة بقفل أمان.', 'We favour appliances with a child lock.') },
        { k: 'elderly', type: 'choice', opts: yn, l: t('فيه كبار سن؟', 'Anyone elderly?'),
          h: t('بنرجّح الأزرار الواضحة والتشغيل البسيط.', 'We favour clear controls and simple operation.') },
        { k: 'pets', type: 'choice', opts: yn, l: t('فيه حيوانات أليفة؟', 'Any pets?'),
          h: t('بيفرق فى اختيار المكنسة.', 'Changes which vacuum makes sense.') },
      ] },

      { g: t('العقار', 'The property'), homes: true, fields: [
        { k: 'homeType', type: 'choice', l: t('نوع السكن', 'Property type'),
          opts: [['apartment', t('شقة', 'Apartment')], ['duplex', t('دوبلكس', 'Duplex')], ['villa', t('فيلا', 'Villa')],
                 ['studio', t('استوديو', 'Studio')], ['chalet', t('شاليه', 'Chalet')]] },
        { k: 'ownership', type: 'choice', l: t('ملك ولا إيجار؟', 'Owned or rented?'),
          h: t('يؤثر ذلك فى التركيبات التى يمكنك إجراؤها.', 'Affects what you are allowed to install.'),
          opts: [['owned', t('ملك', 'Owned')], ['rented', t('إيجار', 'Rented')]] },
        { k: 'areaM2', type: 'number', min: 20, max: 2000, unit: 'م²', l: t('المساحة', 'Area') },
        { k: 'rooms', type: 'number', min: 1, max: 15, l: t('عدد الغرف', 'Rooms') },
        { k: 'governorate', type: 'choice', l: t('المحافظة', 'Governorate'),
          h: t('لنعرف ما إذا كان التوصيل والتركيب متاحين لديك.', 'So we know whether delivery and installation reach you.'),
          opts: [['القاهرة', t('القاهرة', 'Cairo')], ['الجيزة', t('الجيزة', 'Giza')], ['الإسكندرية', t('الإسكندرية', 'Alexandria')],
                 ['الساحل الشمالى', t('الساحل الشمالى', 'North Coast')], ['أخرى', t('محافظة أخرى', 'Other')]] },
        { k: 'area', type: 'text', max: 60, l: t('المنطقة', 'District') },
        { k: 'coastal', type: 'choice', opts: yn, l: t('على البحر؟', 'By the sea?'),
          h: t('الرطوبة والملح بيأثروا على عمر الأجهزة.', 'Humidity and salt shorten appliance life.') },
      ] },

      { g: t('وصول الجهاز للمكان', 'Getting an appliance in'), fields: [
        { k: 'floor', type: 'text', max: 12, l: t('الدور', 'Floor') },
        { k: 'hasLift', type: 'choice', opts: yn, l: t('فيه أسانسير؟', 'Is there a lift?') },
        { k: 'doorwayW', type: 'number', min: 40, max: 200, unit: t('سم', 'cm'), l: t('أضيق باب', 'Narrowest doorway'),
          h: t('أهم مقاس يُنسى، فإن كان الجهاز أعرض من الباب فلن يدخل أصلاً.', 'The most forgotten measurement: if it is wider than the door, it never gets in.') },
        { k: 'stairsTight', type: 'choice', opts: yn, l: t('السلم ضيق؟', 'Are the stairs tight?') },
      ] },

      { g: t('المرافق', 'Utilities'), fields: [
        { k: 'cookerFuel', type: 'choice', l: t('الغاز', 'Gas supply'),
          h: t('البوتاجاز بيختلف حسب غاز طبيعى ولا أنبوبة.', 'Cookers differ for natural gas versus a cylinder.'),
          opts: [['natural', t('غاز طبيعى', 'Natural gas')], ['cylinder', t('أنبوبة', 'Cylinder')], ['electric', t('كهربا', 'Electric')]] },
        { k: 'hasStabilizer', type: 'choice', opts: yn, l: t('عندك مثبت جهد؟', 'Do you have a voltage stabiliser?'),
          h: t('مهم لو الكهربا بتقطع أو بتضرب عندك.', 'Matters if your supply dips or spikes.') },
        { k: 'kitchenSize', type: 'choice', l: t('حجم المطبخ', 'Kitchen size'),
          opts: [['small', t('صغير', 'Small')], ['medium', t('متوسط', 'Medium')], ['large', t('كبير', 'Large')]] },
      ] },

      { g: t('مقاسات الأماكن الشاغرة', 'The gaps things must fit'), fields: [
        { k: 'fridgeSlotW', type: 'number', min: 30, max: 300, unit: t('سم', 'cm'), l: t('عرض مكان الثلاجة', 'Fridge space width') },
        { k: 'fridgeSlotH', type: 'number', min: 60, max: 300, unit: t('سم', 'cm'), l: t('ارتفاع مكان الثلاجة', 'Fridge space height') },
        { k: 'washerSlotW', type: 'number', min: 30, max: 200, unit: t('سم', 'cm'), l: t('عرض مكان الغسالة', 'Washer space width') },
        { k: 'cookerSlotW', type: 'number', min: 30, max: 200, unit: t('سم', 'cm'), l: t('عرض مكان البوتاجاز', 'Cooker space width') },
        { k: 'dishwasherSlotW', type: 'number', min: 30, max: 200, unit: t('سم', 'cm'), l: t('عرض مكان غسالة الأطباق', 'Dishwasher space width') },
      ] },

      { g: t('الغرفة نفسها', 'About the room'), rooms: true, fields: [
        { k: 'roomAreaM2', type: 'number', min: 5, max: 200, unit: 'م²', l: t('مساحة الغرفة', 'Room area'),
          h: t('بنحسب بيها قدرة التكييف المناسبة.', 'Sets the air-conditioner size we suggest.') },
        { k: 'sunFacing', type: 'choice', opts: yn, l: t('هل تتعرض للشمس معظم اليوم؟', 'In the sun most of the day?'),
          h: t('الغرفة المشمسة تحتاج تكييفاً أكبر.', 'A sunny room needs more cooling.') },
        { k: 'noiseSensitive', type: 'choice', opts: yn, l: t('الهدوء مهم هنا؟', 'Does quiet matter here?') },
      ] },

      { g: t('عاداتكم', 'Your habits'), fields: [
        { k: 'cookFrequency', type: 'choice', l: t('ما مقدار الطهى لديكم؟', 'How often do you cook?'),
          opts: [['daily', t('كل يوم', 'Daily')], ['often', t('أغلب الأيام', 'Most days')], ['rare', t('نادراً', 'Rarely')]] },
        { k: 'laundryPerWeek', type: 'number', min: 1, max: 30, l: t('غسلات فى الأسبوع', 'Washes per week') },
        { k: 'smartPreference', type: 'choice', opts: yn, l: t('تحب الأجهزة الذكية (واى فاى)؟', 'Do you like smart (Wi-Fi) appliances?') },
      ] },

      { g: t('تفضيلات الشراء', 'Buying preferences'), fields: [
        { k: 'budgetBand', type: 'choice', l: t('الميزانية المعتادة للجهاز', 'Typical budget per appliance'),
          opts: [['low', t('أقل من ١٠ آلاف', 'Under 10,000')], ['mid', t('من ١٠ لـ ٢٥ ألف', '10,000–25,000')],
                 ['high', t('من ٢٥ لـ ٦٠ ألف', '25,000–60,000')], ['open', t('بلا حد أقصى', 'No limit')]] },
        { k: 'energyPriority', type: 'choice', l: t('توفير الكهربا', 'Energy saving'),
          opts: [['high', t('أولوية كبيرة', 'Top priority')], ['mid', t('مهم', 'Matters')], ['low', t('لا فرق', 'Not a factor')]] },
        { k: 'finish', type: 'choice', l: t('اللون المفضل', 'Preferred finish'),
          opts: [['silver', t('سيلفر / ستانلس', 'Silver / stainless')], ['black', t('أسود', 'Black')],
                 ['white', t('أبيض', 'White')], ['any', t('أى لون', 'Any')]] },
        { k: 'brands', type: 'brands', l: t('ماركات تفضلها', 'Preferred brands') },
      ] },
    ];
  }

  /* ---- one-line description of a place, for switchers and cards ---- */
  function summary(h) {
    if (!h) return '';
    const bits = [];
    if (h.scope === 'room') bits.push(t('غرفة', 'room'));
    if (h.people) bits.push(t(h.people + ' أفراد', h.people + ' people'));
    if (h.governorate) bits.push(h.governorate);
    if (h.roomAreaM2) bits.push(h.roomAreaM2 + ' م²');
    if (h.budgetBand) {
      const b = (window.skPrefs && window.skPrefs.BUDGET_BANDS) ? window.skPrefs.BUDGET_BANDS[h.budgetBand] : null;
      if (b) bits.push(t(b.ar, b.en));
    }
    if (h.doorwayW) bits.push(t('باب ' + h.doorwayW + ' سم', 'door ' + h.doorwayW + ' cm'));
    return bits.join(' · ');
  }
  /* How much of a place is described — shown so people know what filtering has to work with. */
  function completeness(h) {
    const all = FIELDS().flatMap(g => g.fields).filter(f => !['name', 'icon', 'scope'].includes(f.k));
    const done = all.filter(f => h && h[f.k] != null && h[f.k] !== '' && !(Array.isArray(h[f.k]) && !h[f.k].length));
    return { done: done.length, total: all.length, pct: Math.round(100 * done.length / all.length) };
  }

  /* ---- editor ---- */
  function renderEditor(home, brands) {
    const h = home || {};
    const isRoom = h.scope === 'room';
    let html = '';
    FIELDS().forEach(group => {
      if (group.rooms && !isRoom) return;
      if (group.homes && isRoom) return;
      const fields = group.fields.filter(f => !(f.rooms && !isRoom) && !(f.homes && isRoom));
      if (!fields.length) return;
      html += '<fieldset class="hm-group"><legend>' + esc(group.g) + '</legend><div class="grid2">' +
        fields.map(f => renderField(f, h, brands)).join('') + '</div></fieldset>';
    });
    return html;
  }

  function renderField(f, h, brands) {
    const v = h[f.k];
    const lab = '<span class="field__l">' + esc(f.l) + (f.unit ? ' <span class="muted small">' + esc(f.unit) + '</span>' : '') + '</span>';
    const hint = f.h ? '<span class="field__hint">' + esc(f.h) + '</span>' : '';
    if (f.type === 'icon') {
      return '<div class="field" style="margin:0 0 12px">' + lab + '<div class="opts hm-icons">' +
        ICONS.map(i => '<label class="opt"><input type="radio" name="icon" value="' + i + '"' +
          ((v || '🏠') === i ? ' checked' : '') + '><span>' + i + '</span></label>').join('') + '</div>' + hint + '</div>';
    }
    if (f.type === 'brands') {
      const sel = Array.isArray(v) ? v : [];
      if (!brands || !brands.length) return '';
      return '<div class="field" style="margin:0 0 12px;grid-column:1/-1">' + lab + '<div class="opts">' +
        brands.map(b => '<label class="opt"><input type="checkbox" name="brands" value="' + esc(b) + '"' +
          (sel.includes(b) ? ' checked' : '') + '><span>' + esc(b) + '</span></label>').join('') + '</div>' + hint + '</div>';
    }
    if (f.type === 'choice') {
      return '<label class="field" style="margin:0 0 12px">' + lab +
        '<select class="select" name="' + f.k + '"><option value="">' + t('(اختر)', '(select)') + '</option>' +
        f.opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(v) === String(o[0]) || (v === true && o[0] === 'yes') || (v === false && o[0] === 'no') ? ' selected' : '') +
          '>' + esc(o[1]) + '</option>').join('') + '</select>' + hint + '</label>';
    }
    if (f.type === 'number') {
      return '<label class="field" style="margin:0 0 12px">' + lab +
        '<input class="input" type="number" inputmode="numeric" name="' + f.k + '" min="' + (f.min || 0) + '" max="' + (f.max || 9999) +
        '" value="' + esc(v == null ? '' : v) + '">' + hint + '</label>';
    }
    return '<label class="field" style="margin:0 0 12px">' + lab +
      '<input class="input" type="text" name="' + f.k + '" maxlength="' + (f.max || 60) + '" value="' + esc(v == null ? '' : v) + '">' + hint + '</label>';
  }

  /* Read an editor form back into a plain object. */
  function collect(form) {
    const fd = new FormData(form), out = {};
    FIELDS().flatMap(g => g.fields).forEach(f => {
      if (f.type === 'brands') { const b = fd.getAll('brands'); if (b.length) out.brands = b; return; }
      const raw = fd.get(f.k);
      if (raw == null || raw === '') return;
      if (f.type === 'number') out[f.k] = Number(raw);
      else if (f.type === 'choice' && f.opts && f.opts.length === 2 && f.opts[0][0] === 'yes') out[f.k] = (raw === 'yes');
      else out[f.k] = raw;
    });
    return out;
  }

  /* ---- switcher: the same control on the account page and above product grids ---- */
  function switcher(host, opts) {
    if (!host) return;
    const o = opts || {};
    const Au = window.skAuth;
    const draw = () => {
      const homes = Au ? Au.homes() : [];
      const active = Au ? Au.activeHome() : null;
      if (!homes.length) {
        host.innerHTML = '<a class="hm-add" href="' + ((/\/category\//.test(location.pathname)) ? '../' : '') + 'account.html#homes">' +
          t('+ عرّفنا بمنزلك', '+ Tell us about your home') + '</a>';
        return;
      }
      host.innerHTML =
        '<label class="hm-switch"><span class="sr">' + t('اختر المكان', 'Choose a place') + '</span>' +
        '<select class="hm-select" aria-label="' + t('المكان الحالى', 'Current place') + '">' +
        homes.map(h => '<option value="' + esc(h.id) + '"' + (active && h.id === active.id ? ' selected' : '') + '>' +
          esc((h.icon || '🏠') + ' ' + (h.name || t('منزلى', 'My home'))) + '</option>').join('') +
        '</select></label>' +
        (o.showSummary !== false && active ? '<span class="hm-sum">' + esc(summary(active)) + '</span>' : '');
      const sel = host.querySelector('select');
      sel && sel.addEventListener('change', async () => {
        await Au.setActiveHome(sel.value);
        if (o.onChange) o.onChange(Au.activeHome());
      });
    };
    draw();
    Au && Au.onChange(draw);
    document.addEventListener('sk-store-change', e => { if (e.detail && e.detail.key === 'sadko-homes-v1') draw(); });
    return { redraw: draw };
  }

  function injectCSS() {
    if (document.getElementById('hm-css')) return;
    const css = `
    .hm-group{border:1px solid var(--line,#e6e2da);border-radius:14px;padding:14px 16px 4px;margin:0 0 16px;}
    .hm-group legend{font:900 .86rem 'Cairo',sans-serif;color:var(--accent,#75A693);padding:0 8px;}
    .hm-icons .opt span{font-size:1.15rem;padding:8px 12px;}
    .hm-switch{display:inline-flex;align-items:center;}
    .hm-select{font:800 .85rem 'Cairo',sans-serif;color:#14343a;background:#fff;cursor:pointer;
      border:1.5px solid rgba(117,166,147,.35);border-radius:999px;padding:9px 14px;max-width:230px;}
    .hm-select:focus{outline:2px solid rgba(117,166,147,.45);}
    .hm-sum{font:600 .78rem 'Cairo',sans-serif;color:#5b6b6e;margin-inline-start:10px;}
    .hm-add{font:800 .84rem 'Cairo',sans-serif;color:#4A7666;text-decoration:none;border:1.5px dashed rgba(117,166,147,.45);
      border-radius:999px;padding:8px 14px;white-space:nowrap;}
    .hm-add:hover{background:rgba(117,166,147,.08);}
    .hm-card{border:1.5px solid var(--line,#e6e2da);border-radius:16px;padding:14px 16px;background:#fff;display:flex;
      gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;}
    .hm-card.is-active{border-color:#75A693;background:color-mix(in srgb,#75A693 6%,#fff);}
    .hm-card__i{font-size:1.5rem;line-height:1;}
    .hm-card__n{font:900 1rem 'Cairo',sans-serif;margin:0;}
    .hm-card__s{font:600 .8rem 'Cairo',sans-serif;color:#5b6b6e;margin:4px 0 0;}
    `;
    const s = document.createElement('style'); s.id = 'hm-css'; s.textContent = css;
    document.head.appendChild(s);
  }
  injectCSS();

  window.skHomes = { FIELDS, PRESETS, ICONS, renderEditor, collect, summary, completeness, switcher };
})();
