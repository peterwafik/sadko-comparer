/* ============================================================================
   SADKO shopping plans — "خطط التجهيز".
   ----------------------------------------------------------------------------
   A BUYING CHECKLIST, not a room planner: one row per appliance category, each
   row holding the candidates you are comparing and (eventually) the one you
   chose. Money always comes from skStore.plans.totals(), never from a stored
   number, so the budget bar cannot drift away from the rows.

   Sharing is a real, server-free feature: the whole plan is encoded into the
   URL by skStore.encodePlan(). Anyone opening that link sees a read-only copy.
   The 👍 votes and comments a visitor leaves on a shared plan stay in THAT
   visitor's own browser and are never sent to the plan's owner — a live family
   vote needs accounts and a server, which this site does not have, and we say
   so on screen instead of faking it.

     window.mountPlan(rootEl)
   ========================================================================== */
(function () {
  'use strict';

  const A = window.skApp, S = window.skStore;
  const t = A.t, esc = A.esc, num = A.num, money = A.money;

  /* Catalogue titles are scraped and still carry HTML entities. */
  const clean = s => String(s == null ? '' : s)
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

  /* ---------- statuses ---------- */
  const STATUS = ['pending', 'deciding', 'selected', 'later', 'notneeded'];
  function statusLabel(k) {
    return ({
      pending:   t('لسه', 'Not started'),
      deciding:  t('بيقارن', 'Comparing'),
      selected:  t('اتحدد', 'Chosen'),
      later:     t('أجّلته', 'Postponed'),
      notneeded: t('مش محتاجه', 'Not needed'),
    })[k] || t('لسه', 'Not started');
  }
  const statusChip = k => k === 'selected' ? 'chip--ok' : k === 'deciding' ? 'chip--warn' : 'chip--mute';

  /* ---------- templates: they seed CATEGORY rows only, never products ---------
     Every id below is a real category from skApp.CATS. A template is a starting
     checklist, not a recommendation of any particular appliance. */
  const TEMPLATES = [
    { key: 'newhome', ar: 'تجهيز بيت جديد', en: 'Kitting out a new home',
      dAr: 'الأجهزة الأساسية اللى أى شقة جديدة بتحتاجها من أول يوم.',
      dEn: 'The core appliances a new flat needs from day one.',
      cats: ['38003882', '38005652', '38003799', '38022381', '38032005', '40507239', '57646037', '112439376'] },
    { key: 'kitchen', ar: 'أساسيات المطبخ', en: 'Kitchen essentials',
      dAr: 'كل حاجة جوه المطبخ بس — من الثلاجة للكاتيل.',
      dEn: 'Everything inside the kitchen — fridge through kettle.',
      cats: ['38003882', '38003799', '57646037', '68782006', '185355010', '185364502', '38022354'] },
    { key: 'smallflat', ar: 'شقة صغيرة', en: 'Small flat',
      dAr: 'قايمة مختصرة لمساحة صغيرة أو شقة لشخص أو اتنين.',
      dEn: 'A short list for a small space or a one-to-two person home.',
      cats: ['38003882', '38005652', '38003799', '38022381', '48149056', '50318054'] },
    { key: 'bigfamily', ar: 'عيلة كبيرة', en: 'Large family',
      dAr: 'سعات أكبر وأجهزة زيادة — فريزر وغسالة أطباق كمان.',
      dEn: 'Bigger capacities and extra machines — freezer and dishwasher too.',
      cats: ['38003882', '38005648', '38005652', '38022354', '38003799', '38032005', '38022381', '40507239', '57646037'] },
    { key: 'energy', ar: 'أجهزة موفرة للكهربا', en: 'Energy-saving picks',
      dAr: 'الفئات اللى فاتورة الكهربا بتتأثر بيها أكتر حاجة — قارن الاستهلاك فيها بعناية.',
      dEn: 'The categories that move your electricity bill the most — compare consumption carefully.',
      cats: ['38032005', '38003882', '38005652', '38022381', '40507239', '50318054'] },
    { key: 'wedding', ar: 'تجهيز فرح', en: 'Wedding list',
      dAr: 'قايمة العفش الكاملة: الأجهزة الكبيرة والصغيرة مع بعض.',
      dEn: 'The full list: large and small appliances together.',
      cats: ['38003882', '38005652', '38003799', '38022381', '38032005', '57646037', '81170222', '81167227', '68782006', '40507239'] },
  ];

  /* ---------- local feedback on a SHARED plan (device-local, honest) -------- */
  const FKEY = 'sadko-plan-feedback-v1';
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function fbRead(tok) {
    try { const all = JSON.parse(localStorage.getItem(FKEY)) || {}; return all[hash(tok)] || { votes: {}, comments: [] }; }
    catch (e) { return { votes: {}, comments: [] }; }
  }
  function fbWrite(tok, val) {
    try { const all = JSON.parse(localStorage.getItem(FKEY)) || {}; all[hash(tok)] = val; localStorage.setItem(FKEY, JSON.stringify(all)); }
    catch (e) {}
    return val;
  }

  /* ---------- small html helpers ---------- */
  function rowLabel(r) {
    const c = A.CATS[String(r.categoryId)];
    if (c && (!r.label || r.label === c.ar || r.label === c.en)) return A.catName(r.categoryId);
    return r.label || A.catName(r.categoryId);
  }
  function priceNote() {
    return '<p class="note note--info mt16">' +
      t('الأسعار دى أسعار الكتالوج وقت آخر تحديث وممكن تكون اتغيرت. قبل ما تشترى، ',
        'These are catalogue prices from the last update and may have changed. Before you buy, ') +
      '<a href="compare.html">' + t('قارن السعر فى المتاجر المدعومة', 'compare the price across supported stores') + '</a>.</p>';
  }

  /* ======================================================================== */
  function mountPlan(root) {
    if (!root) return;

    const sharedTok = A.qs('shared', '');
    const addId = A.qs('add', '');
    let CATALOG = [], LIVE = [], SHARED = null;

    const state = { picker: null, note: null, share: '', add: null, pq: '', pcat: '', msg: '' };

    root.innerHTML = '<div class="empty">' + t('جارى التحميل…', 'Loading…') + '</div>';

    A.products()
      .then(list => { CATALOG = list || []; return A.liveCats(); })
      .then(cats => { LIVE = cats || []; })
      .catch(() => {})
      .then(() => {
        if (sharedTok) { SHARED = S.decodePlan(sharedTok); return; }
        if (!addId) return;
        return A.byId(addId).then(p => { state.add = p || null; if (!p) state.msg = t('مالقيناش المنتج ده فى الكتالوج.', 'We could not find that product in the catalogue.'); });
      })
      .then(render)
      .catch(() => { root.innerHTML = A.empty(t('تعذّر تحميل الكتالوج.', 'Could not load the catalogue.')); });

    /* ---------------- events (delegated once) ---------------- */
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('submit', onSubmit);

    function act(el) { return el ? el.getAttribute('data-act') : ''; }
    function planNow() { return S.plans.current(); }
    function dropAddParam() {
      try {
        const u = new URL(location.href); u.searchParams.delete('add');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      } catch (e) {}
    }

    function onClick(e) {
      const el = e.target.closest('button[data-act], a[data-act]');
      if (!el || !root.contains(el)) return;
      const a = act(el), key = el.getAttribute('data-row') || '', pid = el.getAttribute('data-pid') || '';
      const p = planNow();

      if (a === 'tpl') {
        const tpl = TEMPLATES.find(x => x.key === el.getAttribute('data-tpl'));
        if (!tpl) return;
        S.plans.create(t(tpl.ar, tpl.en), 0, tpl.cats.map(c => ({ categoryId: c, label: A.catName(c) })));
        state.msg = t('عملنا الخطة. غيّر الأصناف زى ما تحب — دى مجرد نقطة بداية.',
                      'Plan created. Change the items however you like — this is only a starting point.');
        return render();
      }
      if (a === 'blank') {
        S.plans.create(t('خطة تجهيز', 'Shopping plan'), 0, []);
        return render();
      }
      if (a === 'dup' && p) {
        const copy = S.plans.create(p.name + t(' (نسخة)', ' (copy)'), p.budget, (p.rows || []).map(r => ({ categoryId: r.categoryId, label: r.label, status: r.status })));
        copy.rows.forEach((r, i) => {
          const src = p.rows[i] || {};
          r.options = (src.options || []).map(o => ({ id: o.id, title: o.title, price: o.price, image: o.image, url: o.url }));
          r.chosen = src.chosen || null; r.note = src.note || '';
        });
        S.plans.save(copy); state.share = ''; return render();
      }
      if (a === 'del' && p) {
        if (!confirm(t('تمسح خطة «', 'Delete the plan “') + p.name + t('»؟ مش هينفع ترجّعها.', '”? This cannot be undone.'))) return;
        S.plans.remove(p.id); state.picker = null; state.share = ''; return render();
      }
      if (a === 'share' && p) {
        state.share = location.origin + location.pathname.replace(/[^/]*$/, 'plan.html') + '?shared=' + S.encodePlan(p);
        render();
        const box = root.querySelector('#pl-share-url');
        if (box) { box.focus(); box.select(); }
        /* Clipboard access can be blocked or missing — the readonly textarea
           above is the always-available fallback, already selected for copying. */
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(state.share).then(() => {
            const n = root.querySelector('#pl-share-msg');
            if (n) n.textContent = t('اتنسخ اللينك ✓', 'Link copied ✓');
          }).catch(() => {});
        }
        return;
      }
      if (a === 'copy-share') {
        const box = root.querySelector('#pl-share-url');
        if (box) { box.focus(); box.select(); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(state.share).then(() => {
            const n = root.querySelector('#pl-share-msg');
            if (n) n.textContent = t('اتنسخ اللينك ✓', 'Link copied ✓');
          }).catch(() => {});
        }
        return;
      }
      if (a === 'share-close') { state.share = ''; return render(); }

      if (a === 'pick-open' && p) {
        state.picker = key; state.pq = '';
        const r = p.rows.find(x => x.key === key);
        const cid = r ? String(r.categoryId || '') : '';
        // Some checklist categories have nothing in the catalogue yet — start the
        // picker on "all categories" rather than on a guaranteed empty result.
        state.pcat = CATALOG.some(x => String(x.categoryId) === cid) ? cid : '';
        return render();
      }
      if (a === 'pick-close') { state.picker = null; return render(); }
      if ((a === 'pk-add' || a === 'pk-add-choose') && p) {
        const prod = CATALOG.find(x => String(x.id) === pid) || (S.saved.get(pid) || null);
        if (!prod) return;
        S.plans.addProduct(p.id, state.picker, { id: prod.id, title: clean(prod.title), price: prod.price, image: prod.image, url: prod.url }, a === 'pk-add-choose');
        state.msg = a === 'pk-add-choose' ? t('اتحدد المنتج فى الصف.', 'Product set as the choice for that row.')
                                          : t('ضفنا المنتج كخيار فى الصف.', 'Added as a candidate on that row.');
        return render();
      }
      if (a === 'row-del' && p) {
        if (!confirm(t('تشيل الصف ده من الخطة؟', 'Remove this row from the plan?'))) return;
        S.plans.removeRow(p.id, key);
        if (state.picker === key) state.picker = null;
        return render();
      }
      if (a === 'note-open') { state.note = state.note === key ? null : key; return render(); }
      if (a === 'note-cancel') { state.note = null; return render(); }
      if (a === 'note-save' && p) {
        const ta = root.querySelector('#nt-' + key);
        const row = p.rows.find(r => r.key === key);
        if (row && ta) { row.note = String(ta.value || '').slice(0, 300); S.plans.save(p); }
        state.note = null; return render();
      }
      if (a === 'unchoose' && p) { S.plans.choose(p.id, key, null); return render(); }

      /* ?add= flow */
      if (a === 'add-to-row' && p && state.add) {
        S.plans.addProduct(p.id, key, { id: state.add.id, title: clean(state.add.title), price: state.add.price, image: state.add.image, url: state.add.url }, false);
        state.add = null; dropAddParam();
        state.msg = t('ضفنا المنتج للخطة كخيار.', 'Added to the plan as a candidate.');
        return render();
      }
      if (a === 'add-new-row' && p && state.add) {
        const cid = String(state.add.categoryId || '');
        S.plans.addRow(p.id, cid, A.catName(cid));
        const fresh = S.plans.get(p.id);
        const row = fresh.rows[fresh.rows.length - 1];
        S.plans.addProduct(fresh.id, row.key, { id: state.add.id, title: clean(state.add.title), price: state.add.price, image: state.add.image, url: state.add.url }, false);
        state.add = null; dropAddParam();
        state.msg = t('عملنا صف جديد للفئة وضفنا المنتج فيه.', 'Created a row for that category and added the product.');
        return render();
      }
      if (a === 'add-dismiss') { state.add = null; dropAddParam(); return render(); }
      if (a === 'msg-x') { state.msg = ''; return render(); }

      /* shared view */
      if (a === 'clone-shared' && SHARED) {
        const copy = S.plans.create(SHARED.name || t('خطة مشتركة', 'Shared plan'), SHARED.budget,
          (SHARED.rows || []).map(r => ({ categoryId: r.categoryId, label: r.label, status: r.status })));
        copy.rows.forEach((r, i) => {
          const src = SHARED.rows[i] || {};
          r.options = (src.options || []).map(o => ({ id: o.id, title: o.title, price: o.price, image: o.image }));
          r.chosen = src.chosen || null; r.note = src.note || '';
        });
        S.plans.save(copy);
        location.href = 'plan.html';
        return;
      }
      if (a === 'vote' && sharedTok) {
        const fb = fbRead(sharedTok);
        fb.votes[pid] = !fb.votes[pid];
        fbWrite(sharedTok, fb);
        return render();
      }
      if (a === 'cmt-del' && sharedTok) {
        const fb = fbRead(sharedTok);
        fb.comments = (fb.comments || []).filter(c => c.id !== el.getAttribute('data-cid'));
        fbWrite(sharedTok, fb);
        return render();
      }
    }

    function onChange(e) {
      const el = e.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      const a = act(el), key = el.getAttribute('data-row') || '';
      const p = planNow();

      if (a === 'plan-switch') { S.plans.setCurrent(el.value); state.picker = null; state.share = ''; state.note = null; return render(); }
      /* The name and budget fields deliberately do NOT trigger a full re-render:
         a re-render on blur would detach whatever button the visitor was
         clicking and swallow that first click. They repaint in place instead. */
      if (a === 'plan-name' && p) { return saveName(el, p); }
      if (a === 'budget' && p) { return saveBudget(el, p); }
      if (a === 'status' && p) { S.plans.setStatus(p.id, key, el.value); return render(); }
      if (a === 'choose' && p) { S.plans.choose(p.id, key, el.value || null); return render(); }
      if (a === 'pk-cat') { state.pcat = el.value; return repaintPicker(); }
    }

    function onInput(e) {
      const el = e.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      const a = act(el), p = planNow();
      if (a === 'pk-q') { state.pq = el.value; return repaintPicker(); }
      if (a === 'budget' && p) return saveBudget(el, p);
      if (a === 'plan-name' && p) return saveName(el, p);
    }

    function saveName(el, p) {
      p.name = String(el.value || '').slice(0, 80) || t('خطة تجهيز', 'Shopping plan');
      S.plans.save(p);
      const opt = root.querySelector('select[data-act="plan-switch"] option[value="' + p.id + '"]');
      if (opt) opt.textContent = p.name;
    }
    function saveBudget(el, p) {
      p.budget = Math.max(0, Number(el.value) || 0);
      S.plans.save(p);
      paintBudget(p);
    }

    /* Repaint only the numbers the budget drives, so the field keeps focus. */
    function paintBudget(p) {
      const tt = S.plans.totals(p);
      const pct = tt.budget ? Math.min(100, Math.round(tt.selected / tt.budget * 100)) : 0;
      const over = tt.budget > 0 && tt.selected > tt.budget;
      const set = (sel, html) => { const n = root.querySelector(sel); if (n) n.innerHTML = html; };
      set('#bd-total', money(tt.selected));
      const rem = root.querySelector('#bd-remaining');
      if (rem) { rem.innerHTML = tt.remaining == null ? '—' : money(tt.remaining); rem.style.color = over ? 'var(--bad)' : ''; }
      const bar = root.querySelector('#bd-bar');
      if (bar) { bar.className = 'bar mt16' + (over ? ' over' : ''); if (bar.firstElementChild) bar.firstElementChild.style.width = (over ? 100 : pct) + '%'; }
      set('#bd-pct', tt.budget ? num(pct) + '% ' + t('من الميزانية', 'of the budget') : '');
      set('#bd-warn', overWarn(tt, over));
    }
    function overWarn(tt, over) {
      if (!over) return '';
      return '<div class="note note--warn mt8">' + t('انت فوق الميزانية بـ ', 'You are over budget by ') +
        money(tt.selected - tt.budget) + t('. جرّب تأجّل صنف أو تغيّر اختيار.', '. Try postponing an item or changing a choice.') + '</div>';
    }

    function onSubmit(e) {
      const form = e.target.closest('form[data-act]');
      if (!form || !root.contains(form)) return;
      e.preventDefault();
      const a = act(form), p = planNow();

      if (a === 'add-row' && p) {
        const cid = form.querySelector('[name=cat]').value;
        const label = String(form.querySelector('[name=label]').value || '').slice(0, 60);
        S.plans.addRow(p.id, cid, label || A.catName(cid));
        return render();
      }
      if (a === 'pk-form') { return repaintPicker(); }
      if (a === 'cmt-form' && sharedTok) {
        const who = String(form.querySelector('[name=who]').value || '').slice(0, 40);
        const txt = String(form.querySelector('[name=txt]').value || '').trim().slice(0, 300);
        if (!txt) return;
        const fb = fbRead(sharedTok);
        fb.comments = fb.comments || [];
        fb.comments.push({ id: S.uid(), who, txt, at: new Date().toISOString() });
        fbWrite(sharedTok, fb);
        return render();
      }
    }

    function repaintPicker() {
      const host = root.querySelector('#pk-res');
      if (host) host.innerHTML = pickerResults();
    }

    /* ---------------- render ---------------- */
    function render() {
      if (sharedTok) { root.innerHTML = SHARED ? sharedView() : badTokenView(); return; }
      const list = S.plans.all(), plan = S.plans.current();
      let h = '';
      if (state.msg) h += '<div class="note note--info between" style="margin-bottom:16px"><span>' + esc(state.msg) + '</span>' +
        '<button class="btn btn--quiet btn--sm" data-act="msg-x" aria-label="' + t('إخفاء الرسالة', 'Dismiss message') + '">✕</button></div>';
      h += addBox(plan);
      if (!plan) {
        h += emptyView();
      } else {
        h += planHeader(list, plan);
        h += budgetPanel(plan);
        h += tablePanel(plan);
        h += pickerPanel(plan);
        h += sharePanel(plan);
        h += templatesPanel(t('ابدأ خطة تانية', 'Start another plan'),
          t('كل خطة مستقلة — مثلاً خطة للشقة وخطة لتجهيز فرح.', 'Plans are independent — one for the flat, one for a wedding list, and so on.'));
      }
      h += '<p class="note note--soft mt16">' + esc(S.scopeNote()) + '</p>';
      root.innerHTML = h;
    }

    /* ---------------- empty state + templates ---------------- */
    function emptyView() {
      return '<section class="panel">' +
        '<h2 class="panel__h">' + t('ابدأ خطة التجهيز بتاعتك', 'Start your plan') + '</h2>' +
        '<p class="panel__sub">' + t('اختار قالب جاهز فيه الفئات المتوقعة — تقدر تشيل وتضيف براحتك — أو ابدأ بقايمة فاضية.',
          'Pick a template with the categories you would expect — add or remove freely — or start from an empty list.') + '</p>' +
        templateGrid() +
        '<div class="mt16"><button class="btn btn--quiet" data-act="blank">' + t('ابدأ قايمة فاضية', 'Start an empty list') + '</button></div>' +
        '</section>';
    }
    function templatesPanel(title, sub) {
      return '<section class="panel mt16"><h2 class="panel__h">' + esc(title) + '</h2>' +
        '<p class="panel__sub">' + esc(sub) + '</p>' + templateGrid() +
        '<div class="mt16"><button class="btn btn--quiet btn--sm" data-act="blank">' + t('قايمة فاضية', 'Empty list') + '</button></div></section>';
    }
    function templateGrid() {
      return '<div class="grid3">' + TEMPLATES.map(x =>
        '<div class="panel pl-tpl" style="box-shadow:none">' +
          '<h3 class="panel__h" style="font-size:.98rem">' + esc(t(x.ar, x.en)) +
            ' <span class="badge">' + num(x.cats.length) + ' ' + t('صنف', 'items') + '</span></h3>' +
          '<p class="panel__sub" style="margin-bottom:10px">' + esc(t(x.dAr, x.dEn)) + '</p>' +
          '<p class="small muted" style="margin:0 0 12px">' + esc(x.cats.map(c => A.catName(c)).join('، ')) + '</p>' +
          '<button class="btn btn--teal btn--sm btn--block" data-act="tpl" data-tpl="' + esc(x.key) + '">' +
            t('استخدم القالب ده', 'Use this template') + '</button>' +
        '</div>').join('') + '</div>' +
        '<p class="small muted mt8">' + t('القوالب بتحط فئات بس — إحنا مش بنختار لك منتج معين.',
          'Templates seed categories only — we never pick a specific product for you.') + '</p>';
    }

    /* ---------------- ?add= box ---------------- */
    function addBox(plan) {
      if (!state.add) return '';
      const p = state.add, cid = String(p.categoryId || '');
      const rows = plan ? (plan.rows || []) : [];
      const match = rows.filter(r => String(r.categoryId) === cid);
      let body;
      if (!plan) {
        body = '<p class="small" style="margin:0">' + t('ابدأ خطة الأول من القوالب تحت، وبعدين ضيف المنتج ده لصف فيها.',
          'Start a plan from the templates below first, then add this product to one of its rows.') + '</p>';
      } else {
        body = '<div class="pl-acts">' +
          (match.length ? match : rows).map(r =>
            '<button class="btn btn--teal btn--sm" data-act="add-to-row" data-row="' + esc(r.key) + '">' +
            t('ضيفه لصف: ', 'Add to: ') + esc(rowLabel(r)) + '</button>').join('') +
          (!match.length && A.CATS[cid]
            ? '<button class="btn btn--primary btn--sm" data-act="add-new-row">' +
              t('اعمل صف «', 'Create a “') + esc(A.catName(cid)) + t('» وضيفه فيه', '” row and add it') + '</button>' : '') +
          '</div>' +
          (!rows.length ? '<p class="small muted mt8" style="margin-bottom:0">' + t('الخطة فاضية — اعمل صف الأول.', 'This plan has no rows yet — create one first.') + '</p>' : '');
      }
      return '<section class="panel" style="margin-bottom:16px">' +
        '<div class="between"><h2 class="panel__h">' + t('تضيف المنتج ده للخطة؟', 'Add this product to your plan?') + '</h2>' +
        '<button class="btn btn--quiet btn--sm" data-act="add-dismiss">' + t('مش دلوقتى', 'Not now') + '</button></div>' +
        '<div class="pl-pick mt8" style="margin-bottom:12px">' +
          (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '') +
          '<div><span class="pl-t">' + esc(clean(p.title)) + '</span>' +
          '<span class="small muted">' + money(p.price) + '</span></div></div>' +
        body + '</section>';
    }

    /* ---------------- plan header ---------------- */
    function planHeader(list, plan) {
      return '<section class="panel">' +
        '<div class="between">' +
          '<div style="flex:1 1 260px">' +
            '<label class="field" style="margin:0"><span class="field__l">' + t('اسم الخطة', 'Plan name') + '</span>' +
            '<input class="input" data-act="plan-name" value="' + esc(plan.name) + '" maxlength="80"></label>' +
          '</div>' +
          (list.length > 1 ? '<div style="flex:1 1 200px"><label class="field" style="margin:0">' +
            '<span class="field__l">' + t('الخطة المفتوحة', 'Open plan') + '</span>' +
            '<select class="select" data-act="plan-switch">' + list.map(p =>
              '<option value="' + esc(p.id) + '"' + (p.id === plan.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
            '</select></label></div>' : '') +
        '</div>' +
        '<div class="pl-acts mt16">' +
          '<button class="btn btn--primary btn--sm" data-act="share">' + t('شارك الخطة', 'Share the plan') + '</button>' +
          '<button class="btn btn--quiet btn--sm" data-act="dup">' + t('نسخة منها', 'Duplicate') + '</button>' +
          '<button class="btn btn--quiet btn--sm" data-act="del">' + t('امسح الخطة', 'Delete plan') + '</button>' +
          '<span class="chip chip--mute">' + t('اتعملت ', 'Created ') + esc(A.date(plan.createdAt)) + '</span>' +
        '</div></section>';
    }

    /* ---------------- budget ---------------- */
    function budgetPanel(plan) {
      const tt = S.plans.totals(plan);
      const pct = tt.budget ? Math.min(100, Math.round(tt.selected / tt.budget * 100)) : 0;
      const over = tt.budget > 0 && tt.selected > tt.budget;
      return '<section class="panel mt16">' +
        '<h2 class="panel__h">' + t('الميزانية', 'Budget') + '</h2>' +
        '<p class="panel__sub">' + t('الإجمالى بيتحسب من الأجهزة اللى حالتها «اتحدد» بس.',
          'The total counts only the rows whose status is “Chosen”.') + '</p>' +
        '<div class="grid3">' +
          '<div><span class="muted small">' + t('إجمالى المختار', 'Chosen total') + '</span>' +
            '<span class="pl-num" id="bd-total">' + money(tt.selected) + '</span></div>' +
          '<div><label class="field" style="margin:0"><span class="field__l">' + t('الميزانية المتوقعة', 'Expected budget') + '</span>' +
            '<input class="input" type="number" min="0" step="500" inputmode="numeric" data-act="budget" value="' + (tt.budget || '') + '" placeholder="0">' +
            '<span class="field__hint">' + t('سيبها فاضية لو لسه مش محدد.', 'Leave it empty if you have not set one yet.') + '</span></label></div>' +
          '<div><span class="muted small">' + t('الباقى', 'Remaining') + '</span>' +
            '<span class="pl-num" id="bd-remaining"' + (over ? ' style="color:var(--bad)"' : '') + '>' +
            (tt.remaining == null ? '—' : money(tt.remaining)) + '</span></div>' +
        '</div>' +
        '<div class="bar mt16' + (over ? ' over' : '') + '" id="bd-bar"><span style="width:' + (over ? 100 : pct) + '%"></span></div>' +
        '<p class="small muted mt8" id="bd-pct">' + (tt.budget ? num(pct) + '% ' + t('من الميزانية', 'of the budget') : '') + '</p>' +
        '<div id="bd-warn">' + overWarn(tt, over) + '</div>' +
        '<div class="chips mt16">' +
          '<span class="chip chip--ok">' + t('اتحدد: ', 'Chosen: ') + num(tt.chosenCount) + '</span>' +
          '<span class="chip chip--warn">' + t('بيقارن: ', 'Comparing: ') + num(tt.decidingCount) + '</span>' +
          '<span class="chip chip--mute">' + t('لسه: ', 'Not started: ') + num(tt.pending) + '</span>' +
          '<span class="chip chip--mute">' + t('مؤجّل: ', 'Postponed: ') + num(tt.later) + '</span>' +
          '<span class="chip chip--mute">' + t('إجمالى الصفوف: ', 'Rows: ') + num(tt.rows) + '</span>' +
        '</div>' + priceNote() + '</section>';
    }

    /* ---------------- the checklist table ---------------- */
    function tablePanel(plan) {
      const rows = plan.rows || [];
      const body = rows.length ? rows.map(r => rowHtml(plan, r)).join('')
        : '<tr><td colspan="5" class="muted small">' + t('مفيش أصناف لسه — ضيف صف من تحت.', 'No items yet — add a row below.') + '</td></tr>';
      return '<section class="panel mt16">' +
        '<h2 class="panel__h">' + t('قايمة التجهيز', 'The checklist') + '</h2>' +
        '<p class="panel__sub">' + t('صف لكل فئة. تقدر تحط أكتر من خيار فى الصف وتقارن بينهم قبل ما تحدد واحد.',
          'One row per category. Keep several candidates on a row and compare them before choosing one.') + '</p>' +
        '<div class="pl-scroll"><table class="tbl tbl--rows">' +
          '<thead><tr>' +
            '<th>' + t('الفئة', 'Category') + '</th>' +
            '<th>' + t('المنتج المختار', 'Chosen product') + '</th>' +
            '<th>' + t('الحالة', 'Status') + '</th>' +
            '<th>' + t('السعر', 'Price') + '</th>' +
            '<th>' + t('إجراءات', 'Actions') + '</th>' +
          '</tr></thead><tbody>' + body + '</tbody></table></div>' +
        addRowForm() + '</section>';
    }

    function rowHtml(plan, r) {
      const opts = r.options || [];
      const chosen = r.chosen ? opts.find(o => String(o.id) === String(r.chosen)) : null;
      const label = rowLabel(r);

      let cell;
      if (chosen) {
        cell = '<div class="pl-pick">' + (chosen.image ? '<img src="' + esc(chosen.image) + '" alt="">' : '') +
          '<div><span class="pl-t">' + esc(clean(chosen.title)) + '</span></div></div>';
      } else if (opts.length) {
        cell = '<span class="muted small">' + t('لسه ماخترتش من الخيارات', 'No choice made yet') + '</span>';
      } else {
        cell = '<button class="btn btn--ghost btn--sm" data-act="pick-open" data-row="' + esc(r.key) + '">' +
          t('اختار منتج', 'Pick a product') + '</button>';
      }
      /* "بيقارن ٣ خيارات" — while the row is still being decided. */
      if (opts.length && (r.status === 'deciding' || !chosen)) {
        cell += '<div class="mt8"><span class="chip chip--warn">' + t('بيقارن ', 'Comparing ') +
          num(opts.length) + t(' خيارات', ' options') + '</span></div>';
      }
      if (opts.length) {
        cell += '<label class="field" style="margin:8px 0 0"><span class="sr">' + t('اختار من الخيارات', 'Choose from the candidates') + '</span>' +
          '<select class="select" data-act="choose" data-row="' + esc(r.key) + '" aria-label="' +
            t('اختار منتج لـ ', 'Choose a product for ') + esc(label) + '">' +
          '<option value=""' + (chosen ? '' : ' selected') + '>' + t('— من غير اختيار —', '— no choice yet —') + '</option>' +
          opts.map(o => '<option value="' + esc(o.id) + '"' + (chosen && String(o.id) === String(chosen.id) ? ' selected' : '') + '>' +
            esc(clean(o.title).slice(0, 60)) + ' — ' + money(o.price) + '</option>').join('') +
          '</select></label>';
      }

      const statusSel = '<select class="select" data-act="status" data-row="' + esc(r.key) + '" aria-label="' +
        t('حالة ', 'Status of ') + esc(label) + '">' +
        STATUS.map(k => '<option value="' + k + '"' + (r.status === k ? ' selected' : '') + '>' + esc(statusLabel(k)) + '</option>').join('') +
        '</select>';

      const qTitle = chosen ? clean(chosen.title) : label;
      const acts = '<div class="pl-acts">' +
        '<button class="btn btn--ghost btn--sm" data-act="pick-open" data-row="' + esc(r.key) + '">' + t('ضيف خيار', 'Add candidate') + '</button>' +
        '<a class="btn btn--quiet btn--sm" href="compare.html?q=' + encodeURIComponent(qTitle) + '">' + t('قارن الأسعار', 'Compare prices') + '</a>' +
        (A.CATS[String(r.categoryId)] ? '<a class="btn btn--quiet btn--sm" href="' + A.catHref(r.categoryId) + '">' + t('شوف الفئة', 'Browse category') + '</a>' +
          '<a class="btn btn--quiet btn--sm" href="finder.html?cat=' + encodeURIComponent(r.categoryId) + '">' + t('ساعدنى أختار', 'Help me choose') + '</a>' : '') +
        '<button class="btn btn--quiet btn--sm" data-act="note-open" data-row="' + esc(r.key) + '">' +
          (r.note ? t('عدّل الملاحظة', 'Edit note') : t('ملاحظة', 'Note')) + '</button>' +
        (chosen ? '<button class="btn btn--quiet btn--sm" data-act="unchoose" data-row="' + esc(r.key) + '">' + t('ألغى الاختيار', 'Clear choice') + '</button>' : '') +
        '<button class="btn btn--quiet btn--sm" data-act="row-del" data-row="' + esc(r.key) + '">' + t('شيل الصف', 'Remove row') + '</button>' +
        '</div>';

      let html = '<tr>' +
        '<td><strong>' + esc(label) + '</strong>' +
          (r.note && state.note !== r.key ? '<br><span class="small muted">✎ ' + esc(r.note) + '</span>' : '') + '</td>' +
        '<td>' + cell + '</td>' +
        '<td>' + statusSel + '<br><span class="chip ' + statusChip(r.status) + ' small" style="margin-top:6px;display:inline-block">' + esc(statusLabel(r.status)) + '</span></td>' +
        '<td class="nowrap">' + (chosen ? money(chosen.price) : '—') + '</td>' +
        '<td>' + acts + '</td></tr>';

      if (state.note === r.key) {
        html += '<tr><td colspan="5">' +
          '<label class="field" style="margin:0"><span class="field__l">' + t('ملاحظة على ', 'Note on ') + esc(label) + '</span>' +
          '<textarea class="textarea" id="nt-' + esc(r.key) + '" maxlength="300" placeholder="' +
            t('مثلاً: لازم يعدى من باب المطبخ — أقصى عرض ٦٠ سم', 'e.g. must fit through the kitchen door — 60 cm max width') + '">' +
            esc(r.note || '') + '</textarea></label>' +
          '<div class="pl-acts mt8">' +
            '<button class="btn btn--teal btn--sm" data-act="note-save" data-row="' + esc(r.key) + '">' + t('احفظ', 'Save') + '</button>' +
            '<button class="btn btn--quiet btn--sm" data-act="note-cancel">' + t('إلغاء', 'Cancel') + '</button>' +
          '</div></td></tr>';
      }
      return html;
    }

    function addRowForm() {
      const cats = LIVE.length ? LIVE : Object.keys(A.CATS).map(id => ({ id, name: A.catName(id), count: 0 }));
      return '<form class="row mt16" data-act="add-row">' +
        '<label class="field" style="flex:2 1 220px;margin:0"><span class="field__l">' + t('ضيف صف جديد', 'Add a row') + '</span>' +
          '<select class="select" name="cat">' + cats.map(c =>
            '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.count ? ' (' + num(c.count) + ')' : '') + '</option>').join('') +
          '</select></label>' +
        '<label class="field" style="flex:2 1 220px;margin:0"><span class="field__l">' + t('اسم مخصص (اختيارى)', 'Custom label (optional)') + '</span>' +
          '<input class="input" name="label" maxlength="60" placeholder="' + t('مثلاً: تكييف غرفة النوم', 'e.g. bedroom air conditioner') + '"></label>' +
        '<div style="flex:0 1 auto;display:flex;align-items:flex-end">' +
          '<button class="btn btn--teal" type="submit">' + t('أضف الصف', 'Add row') + '</button></div>' +
        '</form>';
    }

    /* ---------------- product picker ---------------- */
    function pickerPanel(plan) {
      if (!state.picker) return '';
      const row = (plan.rows || []).find(r => r.key === state.picker);
      if (!row) return '';
      const cats = LIVE.length ? LIVE : Object.keys(A.CATS).map(id => ({ id, name: A.catName(id), count: 0 }));
      return '<section class="panel mt16" id="pk">' +
        '<div class="between"><div><h2 class="panel__h">' + t('ضيف خيار لصف: ', 'Add a candidate to: ') + esc(rowLabel(row)) + '</h2>' +
        '<p class="panel__sub">' + t('دوّر فى كتالوج صادكو وضيف الأجهزة اللى بتقارن بينها — تقدر تضيف أكتر من واحد وتحدد بعدين.',
          'Search the SADKO catalogue and add the appliances you are comparing — add several and decide later.') + '</p></div>' +
        '<button class="btn btn--quiet btn--sm" data-act="pick-close">' + t('اقفل', 'Close') + '</button></div>' +
        '<form class="row" data-act="pk-form">' +
          '<label class="field" style="flex:2 1 240px;margin:0"><span class="field__l">' + t('ابحث بالاسم أو الماركة', 'Search by name or brand') + '</span>' +
            '<input class="input" type="search" name="q" data-act="pk-q" value="' + esc(state.pq) + '" placeholder="' +
              t('مثلاً: كريازى نوفروست', 'e.g. Kiriazi no frost') + '"></label>' +
          '<label class="field" style="flex:1 1 200px;margin:0"><span class="field__l">' + t('الفئة', 'Category') + '</span>' +
            '<select class="select" data-act="pk-cat">' +
              '<option value="">' + t('كل الفئات', 'All categories') + '</option>' +
              cats.map(c => '<option value="' + esc(c.id) + '"' + (String(state.pcat) === String(c.id) ? ' selected' : '') + '>' +
                esc(c.name) + '</option>').join('') +
            '</select></label>' +
        '</form>' +
        '<div id="pk-res" class="mt16">' + pickerResults() + '</div>' +
        savedBlock() + '</section>';
    }

    function pickerResults() {
      const q = String(state.pq || '').trim().toLowerCase();
      const cat = String(state.pcat || '');
      let list = CATALOG;
      if (cat) list = list.filter(p => String(p.categoryId) === cat);
      if (q) {
        const words = q.split(/\s+/);
        list = list.filter(p => { const hay = clean(p.title).toLowerCase(); return words.every(w => hay.indexOf(w) >= 0); });
      }
      if (!list.length) {
        return '<div class="note note--warn">' + t('مفيش نتايج للبحث ده. جرّب كلمة أقصر أو غيّر الفئة.',
          'No results for that search. Try a shorter word or a different category.') + '</div>';
      }
      const show = list.slice(0, 12);
      return '<p class="small muted" style="margin:0 0 12px">' + num(list.length) + t(' منتج مطابق — بنعرض أول ', ' matching products — showing the first ') +
          num(show.length) + '.</p>' +
        '<div class="grid3">' + show.map(p =>
          '<article class="pcard">' +
            '<div class="pcard__img"><img loading="lazy" src="' + esc(p.image) + '" alt=""></div>' +
            '<div class="pcard__b"><h4 class="pcard__t">' + esc(clean(p.title)) + '</h4>' +
              '<span class="pcard__p">' + money(p.price) + '</span>' +
              '<div class="pcard__row">' +
                '<button class="btn btn--ghost btn--sm" data-act="pk-add" data-pid="' + esc(p.id) + '">' + t('ضيفه كخيار', 'Add as candidate') + '</button>' +
                '<button class="btn btn--teal btn--sm" data-act="pk-add-choose" data-pid="' + esc(p.id) + '">' + t('ضيفه واختاره', 'Add & choose') + '</button>' +
                '<a class="btn btn--quiet btn--sm" href="product.html?id=' + encodeURIComponent(p.id) + '">' + t('التفاصيل', 'Details') + '</a>' +
              '</div></div></article>').join('') + '</div>';
    }

    function savedBlock() {
      const saved = S.saved.all();
      if (!saved.length) {
        return '<p class="small muted mt16">' + t('لما تحفظ منتجات من صفحاتها هتلاقيها هنا عشان تضيفها للخطة بضغطة.',
          'Products you save from their pages will show up here so you can drop them into a plan in one click.') + '</p>';
      }
      return '<div class="mt24"><h3 class="panel__h" style="font-size:.98rem">' + t('أضف من المحفوظات', 'Add from your saved products') + '</h3>' +
        '<p class="panel__sub">' + t('المنتجات اللى حفظتها على الجهاز ده.', 'The products you saved on this device.') + '</p>' +
        '<div class="stack">' + saved.slice(0, 12).map(p =>
          '<div class="pl-opt"><img src="' + esc(p.image) + '" alt="">' +
            '<span class="pl-t" style="flex:1 1 180px">' + esc(clean(p.title)) + '</span>' +
            '<span class="nowrap"><strong>' + money(p.price) + '</strong></span>' +
            '<span class="pl-acts">' +
              '<button class="btn btn--ghost btn--sm" data-act="pk-add" data-pid="' + esc(p.id) + '">' + t('ضيفه كخيار', 'Add as candidate') + '</button>' +
              '<button class="btn btn--teal btn--sm" data-act="pk-add-choose" data-pid="' + esc(p.id) + '">' + t('ضيفه واختاره', 'Add & choose') + '</button>' +
            '</span></div>').join('') + '</div></div>';
    }

    /* ---------------- share ---------------- */
    function sharePanel(plan) {
      if (!state.share) return '';
      return '<section class="panel mt16">' +
        '<div class="between"><h2 class="panel__h">' + t('لينك الخطة', 'Your share link') + '</h2>' +
        '<button class="btn btn--quiet btn--sm" data-act="share-close">' + t('اقفل', 'Close') + '</button></div>' +
        '<p class="panel__sub">' + t('اللينك ده فيه الخطة كلها جوّاه — اللى يفتحه هيشوف نسخة للعرض بس، من غير حساب ومن غير سيرفر.',
          'The whole plan is encoded inside this link — whoever opens it sees a read-only copy, with no account and no server involved.') + '</p>' +
        '<label class="field"><span class="sr">' + t('لينك المشاركة', 'Share link') + '</span>' +
          '<textarea class="textarea ltr" id="pl-share-url" readonly rows="3" style="min-height:80px;font-size:.78rem">' + esc(state.share) + '</textarea></label>' +
        '<div class="pl-acts"><button class="btn btn--teal btn--sm" data-act="copy-share">' + t('انسخ اللينك', 'Copy link') + '</button>' +
          '<a class="btn btn--quiet btn--sm" href="' + esc(state.share) + '">' + t('افتحه كنسخة للعرض', 'Open the read-only view') + '</a>' +
          '<span class="small muted" id="pl-share-msg">' + t('لو النسخ التلقائى مشتغلش، اختار النص فوق وانسخه يدوى.',
            'If automatic copying does not work, select the text above and copy it manually.') + '</span></div>' +
        '<div class="note note--warn mt16">' + t('اللى هيفتح اللينك يقدر يحط 👍 ويكتب تعليق، بس ده هيتحفظ على جهازه هو وانت مش هتشوفه هنا. مشاركة حية بتتحدّث لحظياً محتاجة حسابات وسيرفر، وده مش موجود فى الموقع — فبعد التصويت خللى حد يبعتلك رأيه بنفسه.',
          'Anyone opening the link can leave a 👍 and a comment, but those stay on their own device and will not appear here for you. Live shared voting needs accounts and a server, which this site does not have — so ask them to send you their thoughts directly.') + '</div>' +
        '</section>';
    }

    /* ---------------- shared (read-only) view ---------------- */
    function badTokenView() {
      return '<section class="panel"><h2 class="panel__h">' + t('اللينك ده مش مظبوط', 'That link is not valid') + '</h2>' +
        '<p class="panel__sub">' + t('يمكن اتقص وهو بيتنسخ. اطلب من اللى بعتهولك يبعته تانى كامل.',
          'It may have been cut short when it was copied. Ask whoever sent it to send the full link again.') + '</p>' +
        '<a class="btn btn--teal" href="plan.html">' + t('روح لخططى', 'Go to my plans') + '</a></section>';
    }

    function sharedView() {
      const plan = SHARED, tt = S.plans.totals(plan);
      const pct = tt.budget ? Math.min(100, Math.round(tt.selected / tt.budget * 100)) : 0;
      const over = tt.budget > 0 && tt.selected > tt.budget;
      const fb = fbRead(sharedTok);

      const rows = (plan.rows || []).map(r => {
        const opts = r.options || [];
        const chosen = r.chosen ? opts.find(o => String(o.id) === String(r.chosen)) : null;
        const label = rowLabel(r);
        const optList = opts.length ? '<div class="stack mt8">' + opts.map(o => {
          const voted = !!fb.votes[o.id];
          return '<div class="pl-opt">' + (o.image ? '<img src="' + esc(o.image) + '" alt="">' : '') +
            '<span class="pl-t" style="flex:1 1 160px">' + esc(clean(o.title)) + '</span>' +
            '<span class="nowrap"><strong>' + money(o.price) + '</strong></span>' +
            (chosen && String(chosen.id) === String(o.id) ? '<span class="chip chip--ok">' + t('المختار', 'Chosen') + '</span>' : '') +
            '<button class="btn ' + (voted ? 'btn--teal' : 'btn--quiet') + ' btn--sm" data-act="vote" data-pid="' + esc(o.id) + '" aria-label="' +
              t('صوّت للخيار ده', 'Vote for this option') + ': ' + esc(clean(o.title)) + '" aria-pressed="' + (voted ? 'true' : 'false') + '">👍 ' +
              (voted ? t('صوّتّ', 'Voted') : t('عجبنى', 'Like it')) + '</button>' +
            '</div>';
        }).join('') + '</div>' : '';
        return '<tr><td><strong>' + esc(label) + '</strong>' +
            (r.note ? '<br><span class="small muted">✎ ' + esc(r.note) + '</span>' : '') + '</td>' +
          '<td>' + (chosen ? '<div class="pl-pick">' + (chosen.image ? '<img src="' + esc(chosen.image) + '" alt="">' : '') +
              '<span class="pl-t">' + esc(clean(chosen.title)) + '</span></div>'
            : (opts.length ? '<span class="chip chip--warn">' + t('بيقارن ', 'Comparing ') + num(opts.length) + t(' خيارات', ' options') + '</span>'
                           : '<span class="muted small">' + t('لسه مفيش خيارات', 'no candidates yet') + '</span>')) +
            optList + '</td>' +
          '<td><span class="chip ' + statusChip(r.status) + '">' + esc(statusLabel(r.status)) + '</span></td>' +
          '<td class="nowrap">' + (chosen ? money(chosen.price) : '—') + '</td></tr>';
      }).join('');

      const comments = (fb.comments || []).slice().reverse();

      return '<section class="panel">' +
          '<div class="between"><h2 class="panel__h">' + esc(plan.name || t('خطة تجهيز', 'Shopping plan')) +
            ' <span class="badge badge--amber">' + t('خطة مشتركة — للعرض', 'Shared plan — view only') + '</span></h2>' +
            '<a class="btn btn--quiet btn--sm" href="plan.html">' + t('خططى أنا', 'My own plans') + '</a></div>' +
          '<p class="panel__sub">' + t('دى نسخة من خطة حد تانى، جاية جوه اللينك نفسه. مش هتقدر تعدّل فيها هنا — لو عايز تغيّر حاجة انسخها لخططك.',
            'This is a copy of someone else\'s plan, carried inside the link itself. You cannot edit it here — copy it to your own plans if you want to change anything.') + '</p>' +
          '<div class="pl-acts"><button class="btn btn--primary" data-act="clone-shared">' + t('انسخها لخططى', 'Copy it to my plans') + '</button></div>' +
        '</section>' +

        '<section class="panel mt16"><h2 class="panel__h">' + t('الميزانية', 'Budget') + '</h2>' +
          '<div class="grid3">' +
            '<div><span class="muted small">' + t('إجمالى المختار', 'Chosen total') + '</span><span class="pl-num">' + money(tt.selected) + '</span></div>' +
            '<div><span class="muted small">' + t('الميزانية المتوقعة', 'Expected budget') + '</span><span class="pl-num">' + (tt.budget ? money(tt.budget) : '—') + '</span></div>' +
            '<div><span class="muted small">' + t('الباقى', 'Remaining') + '</span><span class="pl-num"' + (over ? ' style="color:var(--bad)"' : '') + '>' +
              (tt.remaining == null ? '—' : money(tt.remaining)) + '</span></div>' +
          '</div>' +
          '<div class="bar mt16' + (over ? ' over' : '') + '"><span style="width:' + (over ? 100 : pct) + '%"></span></div>' +
          (over ? '<div class="note note--warn mt8">' + t('الخطة دى فوق الميزانية المكتوبة فيها.', 'This plan is over the budget written into it.') + '</div>' : '') +
          priceNote() + '</section>' +

        '<section class="panel mt16"><h2 class="panel__h">' + t('قايمة التجهيز', 'The checklist') + '</h2>' +
          '<div class="pl-scroll"><table class="tbl tbl--rows"><thead><tr>' +
            '<th>' + t('الفئة', 'Category') + '</th><th>' + t('الخيارات', 'Candidates') + '</th>' +
            '<th>' + t('الحالة', 'Status') + '</th><th>' + t('السعر', 'Price') + '</th>' +
          '</tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="muted small">' + t('الخطة فاضية.', 'This plan is empty.') + '</td></tr>') +
          '</tbody></table></div></section>' +

        '<section class="panel mt16"><h2 class="panel__h">' + t('رأيك فى الخطة', 'What you think') + '</h2>' +
          '<div class="note note--warn">' + t('مهم تعرف: التصويتات والتعليقات دى بتتحفظ على الجهاز ده بس، وصاحب الخطة مش هيشوفها. عشان التصويت يوصله فعلاً كان لازم يكون فيه حسابات وسيرفر، وده مش موجود فى الموقع — فلو رأيك مهم، ابعتهوله بنفسك.',
            'Important: these votes and comments are stored on this device only — the plan\'s owner will not see them. Real shared voting would need accounts and a server, which this site does not have, so please send your thoughts to them directly.') + '</div>' +
          '<form class="mt16" data-act="cmt-form">' +
            '<label class="field"><span class="field__l">' + t('اسمك (اختيارى)', 'Your name (optional)') + '</span>' +
              '<input class="input" name="who" maxlength="40" placeholder="' + t('مثلاً: ماما', 'e.g. Mum') + '"></label>' +
            '<label class="field"><span class="field__l">' + t('تعليقك', 'Your comment') + '</span>' +
              '<textarea class="textarea" name="txt" maxlength="300" placeholder="' +
                t('مثلاً: الثلاجة الكبيرة أحسن، بس استنوا العرض', 'e.g. the bigger fridge is better, but wait for the offer') + '"></textarea>' +
              '<span class="field__hint">' + t('٣٠٠ حرف كحد أقصى، ومحفوظ عندك انت بس.', 'Up to 300 characters, kept on your device only.') + '</span></label>' +
            '<button class="btn btn--teal" type="submit">' + t('احفظ التعليق', 'Save comment') + '</button>' +
          '</form>' +
          (comments.length ? '<div class="stack mt24">' + comments.map(c =>
            '<div class="note note--soft between"><span><strong>' + esc(c.who || t('مجهول', 'Anonymous')) + '</strong> · ' +
              '<span class="small muted">' + esc(A.date(c.at)) + '</span><br>' + esc(c.txt) + '</span>' +
              '<button class="btn btn--quiet btn--sm" data-act="cmt-del" data-cid="' + esc(c.id) + '" aria-label="' +
                t('امسح التعليق', 'Delete comment') + '">✕</button></div>').join('') + '</div>'
            : '<p class="small muted mt16">' + t('مفيش تعليقات على الجهاز ده لسه.', 'No comments on this device yet.') + '</p>') +
        '</section>' +
        '<p class="note note--soft mt16">' + esc(S.scopeNote()) + '</p>';
    }
  }

  window.mountPlan = mountPlan;
})();
