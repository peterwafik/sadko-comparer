/* ============================================================================
   SADKO — "أجهزتى": the after-sales record of what the visitor already owns.
   ----------------------------------------------------------------------------
   This is an ordinary account-style dashboard, deliberately NOT a 3D house:
   a list of appliances, their warranty state, their papers and their upkeep.

   Three honesty rules are enforced in the code, not just in the copy:

   1. WARRANTY is COMPUTED from purchaseDate + warrantyMonths (skStore.owned
      .warrantyEnd/daysLeft). If the purchase date is missing we say we cannot
      calculate it — we never invent a status.
   2. DOCUMENTS are NOT uploaded. There is no backend. We record the file NAME
      and the date the visitor attached it, as a personal reference, and the UI
      says so in plain words. File contents are never read into localStorage.
   3. MAINTENANCE REMINDERS come from the fixed RULES table below — editorial
      manufacturer-style intervals per category, not a generated guess. Every
      reminder can be marked done, re-scheduled with a different interval, or
      switched off entirely, and that choice is stored per appliance.

   Appliances bought from another shop are labelled as such everywhere, with the
   plain statement that SADKO does not carry that seller's warranty.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- maintenance rules (data, not AI) --------------------------------
     `months` is the default interval; the visitor can change it per appliance.
     `cats` are skApp.CATS ids. Add a row here to add a reminder. */
  const RULES = [
    {
      id: 'ac-filter', cats: ['38032005'], months: 3,
      ar: 'نظّف فلتر التكييف', en: 'Clean the air-conditioner filter',
      whyAr: 'الفلتر المتسخ يقلل التبريد ويرفع فاتورة الكهرباء، وتنظيفه بالماء والصابون يستغرق دقائق.',
      whyEn: 'A clogged filter cuts cooling and pushes up your electricity bill, and washing it takes minutes.',
    },
    {
      id: 'washer-filter', cats: ['38005652', '38003963'], months: 6,
      ar: 'نظّف فلتر الغسالة ومصفاة الطلمبة', en: 'Clean the washing-machine filter and pump trap',
      whyAr: 'الفلتر المسدود بيخلى المية ما تصرّفش كويس وبيعمل ريحة.',
      whyEn: 'A blocked filter stops the machine draining properly and causes smells.',
    },
    {
      id: 'fridge-coils', cats: ['38003882', '38005648'], months: 12,
      ar: 'نضّف مواسير التبريد ورا الثلاجة', en: 'Clean the condenser coils behind the fridge',
      whyAr: 'التراب على المواسير بيخلى الموتور يشتغل أكتر ويستهلك كهربا أكتر.',
      whyEn: 'Dust on the coils makes the compressor work harder and use more power.',
    },
    {
      id: 'heater-service', cats: ['40507239', '48143206', '48149056'], months: 12,
      ar: 'اعمل صيانة دورية للسخان', en: 'Book an annual water-heater service',
      whyAr: 'الترسيبات والأمان (صمام الضغط / تسريب الغاز) لازم يتراجعوا كل سنة على إيد فنى.',
      whyEn: 'Scale build-up and safety parts (pressure valve / gas leaks) need a yearly check by a technician.',
    },
    {
      id: 'warranty', cats: '*', kind: 'warranty', months: 0,
      ar: 'الضمان قرب يخلص', en: 'Warranty is about to expire',
      whyAr: 'إن كانت هناك مشكلة بسيطة، فهذا أوانها، قبل أن ينتهى الضمان.',
      whyEn: 'If anything is slightly off, now is the time to report it, before the cover ends.',
    },
  ];
  const RULE = id => RULES.filter(r => r.id === id)[0];

  const SOON_DAYS = 14;      // a maintenance job counts as "coming up" this close
  const WARN_DAYS = 60;      // warranty turns amber under this many days left

  function mountAppliances(root) {
    const A = window.skApp, S = window.skStore, O = S.owned;
    const t = A.t, esc = A.esc, num = A.num;

    /* transient page state — never persisted */
    const ui = { form: null, picker: false, catId: '', q: '', openId: '', msg: '' };
    let CATALOG = null;                     // lazily loaded product list
    let CATLIST = [];                       // categories that actually have products

    /* ================= helpers ================= */

    const addMonths = (d, m) => { const x = new Date(d.getTime()); x.setMonth(x.getMonth() + Number(m)); return x; };
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const isExternal = a => String(a.seller || 'sadko') !== 'sadko';
    const sellerLabel = a => isExternal(a)
      ? (a.sellerName ? a.sellerName : t('متجر تانى', 'Another shop'))
      : t('صادكو', 'SADKO');

    function ruleCfg(a, rule) {
      const c = (a.reminderCfg || {})[rule.id] || {};
      return { every: Number(c.every) > 0 ? Number(c.every) : rule.months, last: c.last || '' };
    }
    function setRuleCfg(a, ruleId, patch) {
      const cfg = Object.assign({}, a.reminderCfg || {});
      cfg[ruleId] = Object.assign({}, cfg[ruleId] || {}, patch);
      O.update(a.id, { reminderCfg: cfg });
    }
    const rulesFor = a => RULES.filter(r => r.cats === '*' || r.cats.indexOf(String(a.categoryId)) >= 0);
    const isOff = (a, rule) => (a.remindersOff || []).indexOf(rule.id) >= 0;

    /* When is this reminder next due, and is it due now? Returns null when the
       rule does not apply, is switched off, or we simply cannot know (no date). */
    function reminderState(a, rule) {
      if (rule.kind === 'warranty') {
        const dl = O.daysLeft(a);
        if (dl == null) return { unknown: true, rule: rule };
        return { rule: rule, days: dl, due: O.warrantyEnd(a), open: dl > 0 && dl <= 30, expired: dl <= 0 };
      }
      const cfg = ruleCfg(a, rule);
      const base = cfg.last || a.purchaseDate;
      if (!base) return { unknown: true, rule: rule, every: cfg.every };
      const b = new Date(base);
      if (isNaN(b)) return { unknown: true, rule: rule, every: cfg.every };
      const next = addMonths(b, cfg.every);
      const days = Math.round((next - new Date()) / 86400000);
      return { rule: rule, every: cfg.every, from: cfg.last ? 'last' : 'purchase',
               due: next, days: days, open: days <= SOON_DAYS, overdue: days < 0 };
    }

    /* Everything that wants attention right now, newest problem first. */
    function dueList() {
      const out = [];
      O.all().forEach(a => {
        rulesFor(a).forEach(rule => {
          if (isOff(a, rule)) return;
          const st = reminderState(a, rule);
          if (!st || st.unknown || !st.open) return;
          out.push({ a: a, st: st });
        });
      });
      return out.sort((x, y) => (x.st.days || 0) - (y.st.days || 0));
    }

    function warrantyChip(a) {
      if (!a.purchaseDate)
        return { cls: 'chip--mute', text: t('تاريخ الشراء ناقص، يتعذر حساب الضمان', 'Purchase date missing: we cannot calculate the warranty') };
      if (!Number(a.warrantyMonths))
        return { cls: 'chip--mute', text: t('مدة الضمان غير مسجَّلة', 'Warranty length not recorded') };
      const dl = O.daysLeft(a);
      if (dl == null)
        return { cls: 'chip--mute', text: t('يتعذر حساب الضمان', 'We cannot calculate the warranty') };
      if (dl <= 0) return { cls: 'chip--bad', text: t('الضمان انتهى', 'Warranty expired') };
      if (dl < WARN_DAYS)
        return { cls: 'chip--warn', text: t('الضمان بيخلص قريب، باقى ' + num(dl) + ' يوم', 'Warranty ending soon, ' + num(dl) + ' days left') };
      return { cls: 'chip--ok', text: t('الضمان سارى، باقى ' + num(dl) + ' يوم', 'In warranty, ' + num(dl) + ' days left') };
    }

    /* ================= rendering ================= */

    function render() {
      root.innerHTML =
        (ui.msg ? '<div class="note note--info mt0" role="status">' + esc(ui.msg) + '</div>' : '') +
        '<p class="note note--soft mt0">' + esc(S.scopeNote()) + '</p>' +
        attentionPanel() +
        toolbar() +
        (ui.picker ? pickerPanel() : '') +
        (ui.form ? formPanel() : '') +
        listPanel();
      ui.msg = '';
    }

    function toolbar() {
      const n = O.all().length;
      return '<div class="panel mt16"><div class="between">' +
        '<div><h2 class="panel__h">' + t('الأجهزة المسجّلة', 'Recorded appliances') + '</h2>' +
        '<p class="panel__sub" style="margin:2px 0 0">' +
          (n ? t('عندك ' + num(n) + ' جهاز مسجّل على الجهاز ده.', 'You have ' + num(n) + ' appliance(s) recorded on this device.')
             : t('لم تسجّل أى جهاز بعد.', 'You have not recorded any appliance yet.')) + '</p></div>' +
        '<div class="row" style="flex:0 0 auto">' +
          '<button type="button" class="btn btn--teal btn--sm" data-act="open-picker">' + t('اختار من كتالوج صادكو', 'Pick from the SADKO catalogue') + '</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-act="open-manual">' + t('سجّل جهاز اشتريته من مكان تانى', 'Add something bought elsewhere') + '</button>' +
        '</div></div></div>';
    }

    /* ---- "محتاج انتباهك" ---- */
    function attentionPanel() {
      const list = dueList();
      if (!list.length) return '';
      return '<section class="panel mt16" aria-labelledby="att-h">' +
        '<h2 class="panel__h" id="att-h">' + t('محتاج انتباهك', 'Needs your attention') +
          '<span class="badge badge--amber">' + num(list.length) + '</span></h2>' +
        '<p class="panel__sub">' + t('هذه التذكيرات محسوبة من تاريخ الشراء الذى كتبته ومن جداول صيانة ثابتة لكل نوع جهاز، لا من تخمين. ويمكنك تعديل المدة أو إيقاف أى تذكير.',
          'These reminders are calculated from the purchase date you entered and a fixed maintenance table per appliance type, not a guess. You can change the interval or switch any reminder off.') + '</p>' +
        '<div class="stack">' + list.map(x => attentionRow(x.a, x.st)).join('') + '</div></section>';
    }

    function attentionRow(a, st) {
      const r = st.rule;
      let chip, when;
      if (r.kind === 'warranty') {
        chip = '<span class="chip chip--warn">' + esc(t('باقى ' + num(st.days) + ' يوم', num(st.days) + ' days left')) + '</span>';
        when = t('الضمان بينتهى ', 'Cover ends ') + A.date(st.due);
      } else if (st.overdue) {
        chip = '<span class="chip chip--bad">' + esc(t('متأخر ' + num(Math.abs(st.days)) + ' يوم', num(Math.abs(st.days)) + ' days late')) + '</span>';
        when = t('كان مفروض ', 'Was due ') + A.date(st.due);
      } else {
        chip = '<span class="chip chip--warn">' + esc(t('باقى ' + num(st.days) + ' يوم', 'in ' + num(st.days) + ' days')) + '</span>';
        when = t('موعده ', 'Due ') + A.date(st.due);
      }
      const idAttr = 'data-id="' + esc(a.id) + '" data-rule="' + esc(r.id) + '"';
      return '<div class="note note--warn"><div class="between">' +
        '<div><strong>' + esc(t(r.ar, r.en)) + '</strong>: ' + esc(a.title || t('جهاز بدون اسم', 'Untitled appliance')) + '<br>' +
          '<span class="small muted">' + esc(when) +
          (r.kind !== 'warranty' ? esc(t(' • كل ' + num(st.every) + ' شهر', ' • every ' + num(st.every) + ' months')) : '') + '</span>' +
          '<p class="small muted" style="margin:6px 0 0">' + esc(t(r.whyAr, r.whyEn)) + '</p></div>' +
        '<div class="row" style="flex:0 0 auto">' + chip +
          (r.kind === 'warranty'
            ? '<a class="btn btn--teal btn--sm" href="care.html?ref=' + encodeURIComponent(a.id) + '">' + t('كلّم خدمة العملاء', 'Contact customer care') + '</a>'
            : '<button type="button" class="btn btn--teal btn--sm" data-act="rem-done" ' + idAttr + '>' + t('عملتها النهاردة', 'Did it today') + '</button>') +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="rem-off" ' + idAttr + '>' + t('وقّف التذكير ده', 'Turn this reminder off') + '</button>' +
        '</div></div></div>';
    }

    /* ---- catalogue picker ---- */
    function pickerPanel() {
      let body;
      if (CATALOG == null) {
        body = '<div class="empty"><p>' + t('جارى تحميل الكتالوج…', 'Loading the catalogue…') + '</p></div>';
      } else {
        const q = ui.q.trim().toLowerCase();
        let list = CATALOG.filter(p => !ui.catId || String(p.categoryId) === ui.catId);
        if (q) list = list.filter(p => String(p.title).toLowerCase().indexOf(q) >= 0);
        const shown = list.slice(0, 24);
        body = '<p class="small muted">' + esc(t('لقينا ' + num(list.length) + ' منتج، بنعرض أول ' + num(shown.length) + '.',
              num(list.length) + ' products found, showing the first ' + num(shown.length) + '.')) + '</p>' +
          (shown.length ? '<div class="grid3 mt16">' + shown.map(pickCard).join('') + '</div>'
            : '<div class="empty"><p>' + t('لا توجد نتائج لهذا البحث. جرّب كلمة أخرى أو سجّل الجهاز يدوياً.',
                'No results for that search. Try another word, or add the appliance manually.') + '</p></div>');
      }
      return '<section class="panel mt16" aria-labelledby="pick-h">' +
        '<div class="between"><h2 class="panel__h" id="pick-h">' + t('اختار من كتالوج صادكو', 'Pick from the SADKO catalogue') + '</h2>' +
        '<button type="button" class="btn btn--quiet btn--sm" data-act="close-picker">' + t('إغلاق', 'Close') + '</button></div>' +
        '<p class="panel__sub">' + t('لو اشتريت الجهاز من صادكو، اختاره من هنا وهنملى لك الاسم والصورة والماركة والفئة، وانت تكمّل تاريخ الشراء والرقم التسلسلى.',
          'If you bought it from SADKO, pick it here and we will fill in the name, image, brand and category. You add the purchase date and serial number.') + '</p>' +
        '<div class="row">' +
          '<label class="field" style="flex:1 1 220px"><span class="field__l">' + t('الفئة', 'Category') + '</span>' +
            '<select class="select" data-act="pick-cat"><option value="">' + t('كل الفئات', 'All categories') + '</option>' +
            CATLIST.map(c => '<option value="' + esc(c.id) + '"' + (ui.catId === c.id ? ' selected' : '') + '>' + esc(c.name) + ' (' + num(c.count) + ')</option>').join('') +
            '</select></label>' +
          '<label class="field" style="flex:2 1 260px"><span class="field__l">' + t('دوّر بالاسم', 'Search by name') + '</span>' +
            '<input class="input" type="search" data-act="pick-q" value="' + esc(ui.q) + '" placeholder="' + t('مثلاً: ثلاجة كريازى', 'e.g. Kiriazi fridge') + '"></label>' +
        '</div>' + body + '</section>';
    }

    function pickCard(p) {
      const sp = window.skSpecs ? window.skSpecs.of(p) : null;
      const brand = sp && sp.brand ? t(sp.brand.ar, sp.brand.en) : '';
      return '<article class="pcard">' +
        '<div class="pcard__img"><img loading="lazy" src="' + esc(p.image) + '" alt=""></div>' +
        '<div class="pcard__b"><h3 class="pcard__t">' + esc(p.title) + '</h3>' +
          '<div class="between"><span class="pcard__p">' + A.money(p.price) + '</span>' +
            (brand ? '<span class="chip chip--mute">' + esc(brand) + '</span>' : '') + '</div>' +
          '<div class="pcard__row"><button type="button" class="btn btn--teal btn--sm btn--block" data-act="pick-use" data-pid="' + esc(p.id) + '">' +
            t('هذا جهازى', 'This is mine') + '</button></div>' +
        '</div></article>';
    }

    /* ---- add / edit form ---- */
    function formPanel() {
      const f = ui.form, v = f.values || {};
      const external = String(v.seller || 'sadko') !== 'sadko';
      const catOpts = Object.keys(A.CATS).map(id =>
        '<option value="' + esc(id) + '"' + (String(v.categoryId) === id ? ' selected' : '') + '>' + esc(A.catName(id)) + '</option>').join('');
      return '<section class="panel mt16" aria-labelledby="frm-h">' +
        '<div class="between"><h2 class="panel__h" id="frm-h">' +
          (f.mode === 'edit' ? t('تعديل بيانات الجهاز', 'Edit appliance details') : t('سجّل جهاز جديد', 'Record a new appliance')) + '</h2>' +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="close-form">' + t('إلغاء', 'Cancel') + '</button></div>' +
        (v.productId ? '<p class="note note--info">' + t('هذه البيانات مأخوذة من كتالوج صادكو، عدّل ما يختلف منها.',
          'These details came from the SADKO catalogue. Change anything that does not match.') + '</p>' : '') +
        '<form id="ap-form" class="mt16" novalidate>' +
          '<input type="hidden" name="productId" value="' + esc(v.productId || '') + '">' +
          '<input type="hidden" name="image" value="' + esc(v.image || '') + '">' +
          '<label class="field"><span class="field__l">' + t('اسم الجهاز *', 'Appliance name *') + '</span>' +
            '<input class="input" name="title" required value="' + esc(v.title || '') + '" placeholder="' + t('مثلاً: ثلاجة كريازى ٤٠٠ لتر', 'e.g. Kiriazi 400 L fridge') + '"></label>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + t('الماركة', 'Brand') + '</span>' +
              '<input class="input" name="brand" value="' + esc(v.brand || '') + '"></label>' +
            '<label class="field"><span class="field__l">' + t('الطراز', 'Model') + '</span>' +
              '<input class="input ltr" name="model" value="' + esc(v.model || '') + '"></label>' +
            '<label class="field"><span class="field__l">' + t('الرقم التسلسلى', 'Serial number') + '</span>' +
              '<input class="input ltr" name="serial" value="' + esc(v.serial || '') + '">' +
              '<span class="field__hint">' + t('موجود على استيكر ورا الجهاز أو جنبه، بيسهّل أى طلب صيانة.', 'On the sticker at the back or side of the appliance: it makes any service request faster.') + '</span></label>' +
          '</div>' +
          '<label class="field"><span class="field__l">' + t('الفئة', 'Category') + '</span>' +
            '<select class="select" name="categoryId"><option value="">' + t('(اختار)', '(choose)') + '</option>' + catOpts + '</select>' +
            '<span class="field__hint">' + t('الفئة هى التى تحدد تذكيرات الصيانة المناسبة للجهاز.', 'The category decides which maintenance reminders apply.') + '</span></label>' +
          '<div class="field"><span class="field__l">' + t('اشتريته منين؟', 'Where did you buy it?') + '</span>' +
            '<div class="opts">' +
              '<label class="opt"><input type="radio" name="seller" value="sadko"' + (external ? '' : ' checked') + '><span>' + t('من صادكو', 'From SADKO') + '</span></label>' +
              '<label class="opt"><input type="radio" name="seller" value="other"' + (external ? ' checked' : '') + '><span>' + t('من متجر تانى', 'From another shop') + '</span></label>' +
            '</div>' +
            '<label class="field mt8"><span class="field__l small">' + t('اسم المتجر التانى (لو موجود)', 'Name of the other shop (if any)') + '</span>' +
              '<input class="input" name="sellerName" value="' + esc(v.sellerName || '') + '" placeholder="' + t('مثلاً: متجر النور', 'e.g. Al-Nour Store') + '"></label>' +
          '</div>' +
          '<div class="row">' +
            '<label class="field"><span class="field__l">' + t('تاريخ الشراء', 'Purchase date') + '</span>' +
              '<input class="input" type="date" name="purchaseDate" max="' + todayISO() + '" value="' + esc(v.purchaseDate || '') + '">' +
              '<span class="field__hint">' + t('دون هذا التاريخ لن نتمكن من حساب الضمان ولا مواعيد الصيانة.', 'Without this date we cannot calculate the warranty or the maintenance schedule.') + '</span></label>' +
            '<label class="field"><span class="field__l">' + t('مدة الضمان (شهور)', 'Warranty length (months)') + '</span>' +
              '<input class="input" type="number" min="0" max="120" name="warrantyMonths" value="' + esc(v.warrantyMonths == null ? 12 : v.warrantyMonths) + '">' +
              '<span class="field__hint">' + t('مكتوبة فى كارت الضمان أو الفاتورة.', 'Written on the warranty card or the invoice.') + '</span></label>' +
          '</div>' +
          '<label class="field"><span class="field__l">' + t('ملاحظات', 'Notes') + '</span>' +
            '<textarea class="textarea" name="notes" placeholder="' + t('مثلاً: مركَّب فى غرفة النوم، أوصى الفنى بتنظيفه كل صيف', 'e.g. installed in the bedroom, technician said to clean it every summer') + '">' + esc(v.notes || '') + '</textarea></label>' +
          '<div class="row"><button type="submit" class="btn btn--primary">' +
            (f.mode === 'edit' ? t('احفظ التعديلات', 'Save changes') : t('سجّل الجهاز', 'Record the appliance')) + '</button>' +
            '<button type="button" class="btn btn--quiet" data-act="close-form">' + t('إلغاء', 'Cancel') + '</button></div>' +
        '</form></section>';
    }

    /* ---- the appliance list ---- */
    function listPanel() {
      const list = O.all();
      if (!list.length) {
        return '<section class="panel mt16"><div class="empty"><p>' +
          t('هنا تجد كل جهاز سجّلته: الضمان، والفاتورة، ومواعيد الصيانة. ابدأ بجهاز واحد.',
            'This is where every appliance you record lives: warranty, invoice and maintenance dates. Start with one.') + '</p>' +
          '<div class="row" style="justify-content:center">' +
          '<button type="button" class="btn btn--teal" data-act="open-picker">' + t('اختار من كتالوج صادكو', 'Pick from the SADKO catalogue') + '</button>' +
          '<button type="button" class="btn btn--ghost" data-act="open-manual">' + t('سجّل جهاز يدوى', 'Add one manually') + '</button>' +
          '</div></div></section>';
      }
      return '<div class="grid2 mt16">' + list.map(card).join('') + '</div>';
    }

    function card(a) {
      const w = warrantyChip(a);
      const end = O.warrantyEnd(a);
      const open = ui.openId === a.id;
      const cat = a.categoryId ? A.catName(a.categoryId) : '';
      return '<article class="panel ap" aria-label="' + esc(a.title || t('جهاز', 'Appliance')) + '">' +
        '<div class="ap__top">' +
          '<div class="ap__img">' + (a.image ? '<img loading="lazy" src="' + esc(a.image) + '" alt="">' : '<span aria-hidden="true">🔌</span>') + '</div>' +
          '<div><h3 class="panel__h" style="font-size:1rem">' + esc(a.title || t('جهاز بدون اسم', 'Untitled appliance')) + '</h3>' +
            '<div class="chips mt8"><span class="chip ' + w.cls + '">' + esc(w.text) + '</span>' +
              (isExternal(a) ? '<span class="chip chip--mute">' + esc(t('من ' + sellerLabel(a), 'from ' + sellerLabel(a))) + '</span>'
                             : '<span class="chip">' + t('اتشرى من صادكو', 'Bought from SADKO') + '</span>') +
              (cat ? '<span class="chip chip--mute">' + esc(cat) + '</span>' : '') +
            '</div></div>' +
        '</div>' +
        '<ul class="specs mt16">' +
          specRow(t('العلامة التجارية والطراز', 'Brand & model'), [a.brand, a.model].filter(Boolean).join(', ')) +
          specRow(t('الرقم التسلسلى', 'Serial number'), a.serial, true) +
          specRow(t('البائع', 'Seller'), sellerLabel(a)) +
          specRow(t('تاريخ الشراء', 'Purchase date'), a.purchaseDate ? A.date(a.purchaseDate) : '') +
          specRow(t('الضمان ينتهى', 'Warranty ends'), end ? A.date(end) : '') +
          (a.notes ? specRow(t('ملاحظاتك', 'Your notes'), a.notes) : '') +
        '</ul>' +
        (isExternal(a) ? '<p class="note note--warn mt16">' +
          t('هذا الجهاز اشتُرى من ' + sellerLabel(a) + '، لا من صادكو. والضمان والتركيب والاسترجاع مسؤولية البائع الذى اشتريت منه، فصادكو لا تقدم ضماناً على مشتريات من متاجر أخرى. ويظل بإمكانك أن تسألنا نصيحة أو أن تشترى منا قطعاً أو أجهزة جديدة.',
            'This was bought from ' + sellerLabel(a) + ', not from SADKO. Its warranty, installation and returns are that seller\'s responsibility. SADKO does not provide warranty cover for purchases made elsewhere. You are still welcome to ask us for advice.') +
          '</p>' : '') +
        '<div class="row mt16">' +
          '<a class="btn btn--teal btn--sm" href="care.html?ref=' + encodeURIComponent(a.id) + '">' + t('طلب صيانة أو مساعدة', 'Service or help request') + '</a>' +
          (a.categoryId ? '<a class="btn btn--ghost btn--sm" href="' + esc(A.catHref(a.categoryId)) + '">' + t('صفحة الفئة', 'Category page') + '</a>' : '') +
          '<a class="btn btn--ghost btn--sm" href="compare.html' + (a.title ? '?q=' + encodeURIComponent(a.title) : '') + '">' + t('قارن الأسعار', 'Compare prices') + '</a>' +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="toggle-more" data-id="' + esc(a.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
            (open ? t('إخفاء المستندات والتذكيرات', 'Hide documents & reminders') : t('المستندات والتذكيرات', 'Documents & reminders')) + '</button>' +
        '</div>' +
        (open ? moreBlock(a) : '') +
        '</article>';
    }

    function specRow(k, v, ltr) {
      const has = v != null && String(v).trim() !== '';
      return '<li><span class="k">' + esc(k) + '</span><span class="v' + (has ? '' : ' unknown') + (ltr && has ? ' ltr' : '') + '">' +
        esc(has ? v : t('غير مسجَّل', 'not recorded')) + '</span></li>';
    }

    function moreBlock(a) {
      return '<div class="mt16">' + docsBlock(a) + remindersBlock(a) +
        '<div class="row mt16">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-act="edit" data-id="' + esc(a.id) + '">' + t('تعديل البيانات', 'Edit details') + '</button>' +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="del" data-id="' + esc(a.id) + '">' + t('احذف الجهاز من القائمة', 'Remove this appliance') + '</button>' +
        '</div></div>';
    }

    function docsBlock(a) {
      const docs = a.docs || [];
      return '<h4 class="panel__h" style="font-size:.95rem">' + t('المستندات', 'Documents') + '</h4>' +
        '<p class="note note--info small">' +
          t('نسجّل اسم الملف مرجعاً لك، أما الملف نفسه فلا يُرفع إلى أى مكان ولا يُخزَّن فى المتصفح. فاحتفظ بالفاتورة وبطاقة الضمان لديك على جهازك أو ورقياً.',
            'We record the file name as a reference for you. The file itself is not uploaded anywhere and is not stored in the browser. Keep the actual invoice and warranty card on your own device or on paper.') + '</p>' +
        (docs.length
          ? '<ul class="specs mt8">' + docs.map((d, i) =>
              '<li><span class="k ltr">' + esc(d.name) + '</span><span class="v small">' + esc(A.date(d.at)) +
              ' <button type="button" class="btn btn--quiet btn--sm" data-act="doc-del" data-id="' + esc(a.id) + '" data-i="' + i + '" aria-label="' +
              t('احذف ' + d.name, 'Remove ' + d.name) + '">' + t('احذف', 'Remove') + '</button></span></li>').join('') + '</ul>'
          : '<p class="small muted mt8">' + t('لا أسماء مستندات مسجَّلة.', 'No document names recorded yet.') + '</p>') +
        '<label class="field mt8"><span class="field__l small">' + t('اختر الفاتورة أو بطاقة الضمان لنسجّل اسمها', 'Choose the invoice or warranty card so we can record its name') + '</span>' +
          '<input class="input" type="file" data-doc="' + esc(a.id) + '" aria-label="' + t('اختار ملف لتسجيل اسمه', 'Choose a file to record its name') + '"></label>';
    }

    function remindersBlock(a) {
      const rows = rulesFor(a);
      return '<h4 class="panel__h mt16" style="font-size:.95rem">' + t('تذكيرات الصيانة', 'Maintenance reminders') + '</h4>' +
        '<p class="small muted">' + t('هذه المواعيد جدول ثابت بحسب نوع الجهاز، محسوب من تاريخ الشراء أو من آخر مرة أجريتها. عدّل المدة إن أوصت الشركة أو الفنى بغير ذلك.',
          'These intervals are a fixed table per appliance type, counted from the purchase date or the last time you did the job. Change the interval if the manufacturer or your technician says otherwise.') + '</p>' +
        '<div class="stack mt8">' + rows.map(r => reminderRow(a, r)).join('') + '</div>';
    }

    function reminderRow(a, rule) {
      const off = isOff(a, rule);
      const st = reminderState(a, rule);
      const idAttr = 'data-id="' + esc(a.id) + '" data-rule="' + esc(rule.id) + '"';
      let status;
      if (off) status = '<span class="chip chip--mute">' + t('موقوف', 'Off') + '</span>';
      else if (st.unknown) status = '<span class="chip chip--mute">' + t('محتاج تاريخ الشراء', 'Needs the purchase date') + '</span>';
      else if (rule.kind === 'warranty')
        status = st.expired ? '<span class="chip chip--bad">' + t('الضمان انتهى', 'Expired') + '</span>'
                            : '<span class="chip ' + (st.days <= 30 ? 'chip--warn' : 'chip--ok') + '">' + esc(t('باقى ' + num(st.days) + ' يوم', num(st.days) + ' days left')) + '</span>';
      else if (st.overdue) status = '<span class="chip chip--bad">' + esc(t('متأخر ' + num(Math.abs(st.days)) + ' يوم', num(Math.abs(st.days)) + ' days late')) + '</span>';
      else status = '<span class="chip ' + (st.open ? 'chip--warn' : 'chip--ok') + '">' + esc(t('موعده ' + A.date(st.due), 'due ' + A.date(st.due))) + '</span>';

      return '<div class="note"><div class="between">' +
        '<div><strong>' + esc(t(rule.ar, rule.en)) + '</strong>' +
          '<p class="small muted" style="margin:4px 0 0">' + esc(t(rule.whyAr, rule.whyEn)) + '</p></div>' +
        '<div class="row" style="flex:0 0 auto;align-items:center">' + status +
          (rule.kind === 'warranty' ? '' :
            '<label class="small muted" style="flex:0 0 auto">' + t('كل', 'every') + ' ' +
              '<input class="input" style="width:74px;display:inline-block" type="number" min="1" max="60" value="' + esc(ruleCfg(a, rule).every) + '" data-every="1" ' + idAttr +
              ' aria-label="' + t('عدد الشهور بين كل صيانة', 'Months between services') + '"> ' + t('شهر', 'months') + '</label>' +
            '<button type="button" class="btn btn--ghost btn--sm" data-act="rem-done" ' + idAttr + '>' + t('عملتها النهاردة', 'Did it today') + '</button>') +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="' + (off ? 'rem-on' : 'rem-off') + '" ' + idAttr + '>' +
            (off ? t('شغّل التذكير', 'Turn on') : t('وقّف', 'Turn off')) + '</button>' +
        '</div></div></div>';
    }

    /* ================= events ================= */

    function loadCatalogue() {
      if (CATALOG != null) return;
      Promise.all([A.products(), A.liveCats()]).then(res => {
        CATALOG = res[0] || []; CATLIST = res[1] || [];
        if (ui.picker) render();
      }).catch(() => { CATALOG = []; if (ui.picker) render(); });
    }

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      const act = b.getAttribute('data-act');
      const id = b.getAttribute('data-id');
      const a = id ? O.get(id) : null;

      if (act === 'open-picker') { ui.picker = true; ui.form = null; loadCatalogue(); render(); return; }
      if (act === 'close-picker') { ui.picker = false; render(); return; }
      if (act === 'open-manual') {
        ui.picker = false;
        ui.form = { mode: 'add', values: { seller: 'other', warrantyMonths: 12 } };
        render(); focusForm(); return;
      }
      if (act === 'close-form') { ui.form = null; render(); return; }
      if (act === 'pick-use') {
        const p = (CATALOG || []).filter(x => String(x.id) === b.getAttribute('data-pid'))[0];
        if (!p) return;
        const sp = window.skSpecs ? window.skSpecs.of(p) : null;
        ui.picker = false;
        ui.form = { mode: 'add', values: {
          productId: String(p.id), title: p.title, image: p.image, categoryId: String(p.categoryId || ''),
          brand: sp && sp.brand ? t(sp.brand.ar, sp.brand.en) : '', seller: 'sadko', warrantyMonths: 12,
        } };
        render(); focusForm(); return;
      }
      if (act === 'toggle-more') { ui.openId = (ui.openId === id ? '' : id); render(); return; }
      if (act === 'edit' && a) { ui.form = { mode: 'edit', id: a.id, values: Object.assign({}, a) }; render(); focusForm(); return; }
      if (act === 'del' && a) {
        if (!window.confirm(t('هنشيل «' + (a.title || '') + '» من قائمة أجهزتك على الجهاز ده. تمام؟',
                             'This will remove "' + (a.title || '') + '" from your list on this device. Continue?'))) return;
        O.remove(a.id); ui.msg = t('اتشال من القائمة.', 'Removed from your list.'); render(); return;
      }
      if (act === 'doc-del' && a) {
        const i = Number(b.getAttribute('data-i'));
        const docs = (a.docs || []).slice(); docs.splice(i, 1);
        O.update(a.id, { docs: docs }); render(); return;
      }
      if ((act === 'rem-off' || act === 'rem-on') && a) {
        const rid = b.getAttribute('data-rule');
        let off = (a.remindersOff || []).slice();
        if (act === 'rem-off') { if (off.indexOf(rid) < 0) off.push(rid); }
        else off = off.filter(x => x !== rid);
        O.update(a.id, { remindersOff: off });
        const r = RULE(rid);
        ui.msg = act === 'rem-off'
          ? t('وقّفنا تذكير «' + t(r.ar, r.en) + '» للجهاز ده.', 'Reminder "' + t(r.ar, r.en) + '" is now off for this appliance.')
          : t('رجّعنا التذكير.', 'Reminder switched back on.');
        render(); return;
      }
      if (act === 'rem-done' && a) {
        const rid = b.getAttribute('data-rule');
        setRuleCfg(a, rid, { last: todayISO() });
        const r = RULE(rid), st = reminderState(O.get(a.id), r);
        ui.msg = t('سجّلناها النهاردة، الموعد الجاى ' + A.date(st.due) + '.', 'Recorded as done today, next one due ' + A.date(st.due) + '.');
        render(); return;
      }
    });

    root.addEventListener('change', e => {
      const el = e.target;
      if (el.matches('[data-act="pick-cat"]')) { ui.catId = el.value; render(); return; }
      if (el.matches('[data-every]')) {
        const a = O.get(el.getAttribute('data-id'));
        const every = Math.max(1, Math.min(60, Number(el.value) || 1));
        if (a) { setRuleCfg(a, el.getAttribute('data-rule'), { every: every }); ui.msg = t('غيّرنا المدة.', 'Interval updated.'); render(); }
        return;
      }
      if (el.matches('input[type="file"][data-doc]')) {
        const a = O.get(el.getAttribute('data-doc'));
        const file = el.files && el.files[0];
        if (!a || !file) return;
        // Deliberately only the NAME. The file is never read, never uploaded.
        const docs = (a.docs || []).concat([{ name: file.name, at: new Date().toISOString() }]);
        O.update(a.id, { docs: docs });
        el.value = '';
        ui.msg = t('سجّلنا اسم الملف «' + file.name + '» كمرجع، الملف نفسه ما اترفعش.',
                   'Recorded the file name "' + file.name + '" as a reference. The file itself was not uploaded.');
        render();
      }
    });

    root.addEventListener('input', e => {
      if (e.target.matches('[data-act="pick-q"]')) {
        ui.q = e.target.value;
        clearTimeout(root._qt);
        root._qt = setTimeout(() => {
          render();
          const box = root.querySelector('[data-act="pick-q"]');
          if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
        }, 220);
      }
    });

    root.addEventListener('submit', e => {
      if (!e.target.matches('#ap-form')) return;
      e.preventDefault();
      const fd = new FormData(e.target);
      const rec = {
        productId: fd.get('productId') || null,
        title: String(fd.get('title') || '').trim(),
        brand: String(fd.get('brand') || '').trim(),
        model: String(fd.get('model') || '').trim(),
        serial: String(fd.get('serial') || '').trim(),
        seller: fd.get('seller') === 'other' ? 'other' : 'sadko',
        sellerName: String(fd.get('sellerName') || '').trim(),
        purchaseDate: String(fd.get('purchaseDate') || ''),
        warrantyMonths: Number(fd.get('warrantyMonths')) || 0,
        image: fd.get('image') || '',
        categoryId: String(fd.get('categoryId') || ''),
        notes: String(fd.get('notes') || '').trim(),
      };
      if (!rec.title) {
        ui.msg = t('اكتب اسم الجهاز الأول.', 'Please give the appliance a name first.');
        render(); focusForm(); return;
      }
      if (rec.seller === 'sadko') rec.sellerName = '';
      if (ui.form.mode === 'edit') {
        O.update(ui.form.id, rec);
        ui.msg = t('حفظنا التعديلات.', 'Changes saved.');
      } else {
        const a = O.add(rec);
        ui.openId = a.id;
        ui.msg = rec.purchaseDate
          ? t('سجّلنا الجهاز وحسبنا الضمان من تاريخ الشراء.', 'Appliance recorded and the warranty calculated from the purchase date.')
          : t('سجّلنا الجهاز. ودون تاريخ الشراء لن نتمكن من حساب الضمان ولا مواعيد الصيانة.',
              'Appliance recorded. Without a purchase date we cannot calculate the warranty or the maintenance schedule.');
      }
      ui.form = null;
      render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function focusForm() {
      const el = root.querySelector('#ap-form [name="title"]');
      if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }

    render();
  }

  window.mountAppliances = mountAppliances;
  window.skApplianceRules = RULES;      // exported so the rules stay inspectable
})();
