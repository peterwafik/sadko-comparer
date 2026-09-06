/* ============================================================================
   SADKO client store — the small amount of state the buying journey needs.
   ----------------------------------------------------------------------------
   There is no account system on this site, so everything here lives in
   localStorage on the visitor's own device. That is a deliberate, honest
   trade-off rather than a stub:

     • a guest can start a shopping plan, save products and record appliances
       immediately, with no sign-up wall (the "respect" the brief asks for);
     • nothing is silently uploaded anywhere;
     • every screen that shows this data must also say where it is kept and
       that clearing the browser will lose it. `skStore.scopeNote()` returns
       that sentence so no page has to invent its own wording.

   Sharing works by encoding a plan into the URL (see encodePlan/decodePlan) —
   a real, working share link that needs no server. Multi-device sync, cross-user
   voting and push alerts genuinely require a backend and are NOT faked here.

     skStore.saved / plans / owned / profile / qa / reviews / dismiss
     document event 'sk-store-change' fires on every write.
   ========================================================================== */
(function () {
  'use strict';

  const K = {
    saved:   'sadko-saved-v1',
    plans:   'sadko-plans-v1',
    owned:   'sadko-owned-v1',
    profile: 'sadko-profile-v1',
    qa:      'sadko-qa-v1',
    reviews: 'sadko-reviews-v1',
    hidden:  'sadko-dismissed-v1',
  };

  function read(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('sk-store-change', { detail: { key } }));
    return val;
  }
  const uid = () => 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const nowISO = () => new Date().toISOString();

  /* ================= saved products (shortlist + price watch) ================= */
  const saved = {
    all: () => read(K.saved, []),
    has: id => saved.all().some(x => x.id === String(id)),
    get: id => saved.all().find(x => x.id === String(id)),
    add(p, extra) {
      const list = saved.all();
      if (list.some(x => x.id === String(p.id))) return list;
      list.push(Object.assign({
        id: String(p.id), title: p.title, price: p.price, image: p.image,
        url: p.url, categoryId: String(p.categoryId || ''), addedAt: nowISO(),
        // priceAtSave lets us show an honest "changed since you saved it" diff
        // without pretending we have a live alerting backend.
        priceAtSave: p.price, targetPrice: null,
      }, extra || {}));
      return write(K.saved, list);
    },
    remove(id) { return write(K.saved, saved.all().filter(x => x.id !== String(id))); },
    toggle(p) { return saved.has(p.id) ? (saved.remove(p.id), false) : (saved.add(p), true); },
    setTarget(id, price) {
      const list = saved.all();
      const hit = list.find(x => x.id === String(id));
      if (hit) hit.targetPrice = (price === '' || price == null) ? null : Number(price);
      return write(K.saved, list);
    },
    count: () => saved.all().length,
  };

  /* ================= shopping plans ================= */
  // A plan is a checklist of CATEGORIES (what the home needs), each of which may
  // hold candidate products and one chosen product. It deliberately never
  // renders a room — it is a buying checklist, per the brief.
  const STATUS = ['pending', 'deciding', 'selected', 'later', 'notneeded'];

  const plans = {
    all: () => read(K.plans, []),
    get: id => plans.all().find(p => p.id === id),
    current() {
      const list = plans.all();
      if (!list.length) return null;
      const id = read('sadko-plan-current', null);
      return list.find(p => p.id === id) || list[0];
    },
    setCurrent(id) { write('sadko-plan-current', id); return plans.get(id); },
    create(name, budget, rows) {
      const list = plans.all();
      const p = {
        id: uid(), name: name || 'خطة تجهيز', budget: Number(budget) || 0,
        createdAt: nowISO(), rows: (rows || []).map(r => ({
          key: r.key || uid(), categoryId: String(r.categoryId || ''),
          label: r.label, status: r.status || 'pending',
          chosen: null, options: [], note: '',
        })),
      };
      list.push(p); write(K.plans, list); write('sadko-plan-current', p.id);
      return p;
    },
    save(plan) {
      const list = plans.all();
      const i = list.findIndex(p => p.id === plan.id);
      if (i < 0) list.push(plan); else list[i] = plan;
      return write(K.plans, list);
    },
    remove(id) {
      const out = plans.all().filter(p => p.id !== id);
      write(K.plans, out);
      if (read('sadko-plan-current', null) === id) write('sadko-plan-current', out[0] ? out[0].id : null);
      return out;
    },
    addRow(planId, categoryId, label) {
      const p = plans.get(planId); if (!p) return null;
      p.rows.push({ key: uid(), categoryId: String(categoryId || ''), label, status: 'pending', chosen: null, options: [], note: '' });
      plans.save(p); return p;
    },
    removeRow(planId, key) {
      const p = plans.get(planId); if (!p) return null;
      p.rows = p.rows.filter(r => r.key !== key); plans.save(p); return p;
    },
    /* Put a product into a plan row as a candidate (and optionally choose it). */
    addProduct(planId, rowKey, product, choose) {
      const p = plans.get(planId); if (!p) return null;
      const row = p.rows.find(r => r.key === rowKey); if (!row) return null;
      const lite = { id: String(product.id), title: product.title, price: product.price, image: product.image, url: product.url };
      if (!row.options.some(o => o.id === lite.id)) row.options.push(lite);
      if (choose || !row.chosen) { row.chosen = lite.id; row.status = 'selected'; }
      else if (row.options.length > 1 && row.status === 'pending') row.status = 'deciding';
      plans.save(p); return p;
    },
    choose(planId, rowKey, productId) {
      const p = plans.get(planId); if (!p) return null;
      const row = p.rows.find(r => r.key === rowKey); if (!row) return null;
      row.chosen = productId ? String(productId) : null;
      row.status = productId ? 'selected' : (row.options.length > 1 ? 'deciding' : 'pending');
      plans.save(p); return p;
    },
    setStatus(planId, rowKey, status) {
      const p = plans.get(planId); if (!p) return null;
      const row = p.rows.find(r => r.key === rowKey); if (!row) return null;
      row.status = STATUS.indexOf(status) >= 0 ? status : 'pending';
      if (status === 'notneeded' || status === 'later') row.chosen = row.chosen;
      plans.save(p); return p;
    },
    /* Money + progress, computed — never stored, so it can't drift. */
    totals(plan) {
      let selected = 0, chosenCount = 0, decidingCount = 0, pending = 0, later = 0;
      (plan.rows || []).forEach(r => {
        const c = r.chosen && (r.options || []).find(o => o.id === r.chosen);
        if (r.status === 'selected' && c) { selected += Number(c.price) || 0; chosenCount++; }
        else if (r.status === 'deciding') decidingCount++;
        else if (r.status === 'later') later++;
        else if (r.status !== 'notneeded') pending++;
      });
      const budget = Number(plan.budget) || 0;
      return { selected, budget, remaining: budget ? budget - selected : null,
               chosenCount, decidingCount, pending, later, rows: (plan.rows || []).length };
    },
  };

  /* ---- share links: the whole plan, compressed into the URL ---- */
  function encodePlan(plan) {
    const slim = {
      n: plan.name, b: plan.budget,
      r: (plan.rows || []).map(r => ({
        l: r.label, c: r.categoryId, s: r.status, ch: r.chosen, nt: r.note || '',
        o: (r.options || []).map(o => ({ i: o.id, t: o.title, p: o.price, m: o.image })),
      })),
    };
    const json = JSON.stringify(slim);
    // encodeURIComponent → binary-safe base64 for Arabic titles
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodePlan(token) {
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b64)));
      const s = JSON.parse(json);
      return {
        id: 'shared', name: s.n, budget: s.b, shared: true,
        rows: (s.r || []).map(r => ({
          key: uid(), label: r.l, categoryId: r.c, status: r.s, chosen: r.ch, note: r.nt || '',
          options: (r.o || []).map(o => ({ id: o.i, title: o.t, price: o.p, image: o.m })),
        })),
      };
    } catch (e) { return null; }
  }

  /* ================= owned appliances ================= */
  const owned = {
    all: () => read(K.owned, []),
    get: id => owned.all().find(a => a.id === id),
    add(rec) {
      const list = owned.all();
      const a = Object.assign({
        id: uid(), addedAt: nowISO(), productId: null, title: '', brand: '', model: '',
        serial: '', seller: 'sadko', purchaseDate: '', warrantyMonths: 12,
        image: '', categoryId: '', notes: '', docs: [], remindersOff: [],
      }, rec || {});
      list.push(a); write(K.owned, list); return a;
    },
    update(id, patch) {
      const list = owned.all();
      const i = list.findIndex(a => a.id === id);
      if (i < 0) return null;
      list[i] = Object.assign(list[i], patch);
      write(K.owned, list); return list[i];
    },
    remove(id) { return write(K.owned, owned.all().filter(a => a.id !== id)); },
    warrantyEnd(a) {
      if (!a.purchaseDate || !a.warrantyMonths) return null;
      const d = new Date(a.purchaseDate);
      if (isNaN(d)) return null;
      d.setMonth(d.getMonth() + Number(a.warrantyMonths));
      return d;
    },
    daysLeft(a) {
      const end = owned.warrantyEnd(a);
      if (!end) return null;
      return Math.round((end - new Date()) / 86400000);
    },
  };

  /* ================= buyer profile (voluntary, reused by the finder) ========= */
  const profile = {
    get: () => read(K.profile, {}),
    set(patch) { return write(K.profile, Object.assign(profile.get(), patch)); },
    clear() { return write(K.profile, {}); },
  };

  /* ================= product Q&A + reviews (device-local) ==================== */
  // Real Q&A and reviews need moderation and a server. What is stored here is
  // only what THIS visitor wrote, shown back to them, clearly labelled as
  // pending review — never presented as published community content.
  const qa = {
    for: pid => read(K.qa, {})[String(pid)] || [],
    ask(pid, text) {
      const all = read(K.qa, {});
      const list = all[String(pid)] || [];
      list.push({ id: uid(), text: String(text).slice(0, 400), at: nowISO(), status: 'pending' });
      all[String(pid)] = list; return write(K.qa, all);
    },
    remove(pid, id) {
      const all = read(K.qa, {});
      all[String(pid)] = (all[String(pid)] || []).filter(q => q.id !== id);
      return write(K.qa, all);
    },
  };
  const reviews = {
    for: pid => read(K.reviews, {})[String(pid)] || [],
    add(pid, rec) {
      const all = read(K.reviews, {});
      const list = all[String(pid)] || [];
      list.push(Object.assign({ id: uid(), at: nowISO(), status: 'pending' }, rec));
      all[String(pid)] = list; return write(K.reviews, all);
    },
    remove(pid, id) {
      const all = read(K.reviews, {});
      all[String(pid)] = (all[String(pid)] || []).filter(r => r.id !== id);
      return write(K.reviews, all);
    },
  };

  /* ---- panels the visitor has closed --------------------------------------
     Every standing invitation on the site (the guided-finder call-out, the
     "filter by your home" bar) carries a close button, and a panel closed on one
     page must stay closed on the next one — otherwise the × reads as a bug: it
     works for a second and the panel is back after the first filter click, since
     the storefront re-renders its whole column on every facet change.

     Keyed by a stable panel id rather than by page, and stored beside the rest of
     the visitor's local state so `scopeNote()` already describes where it lives.
     `restore()` exists because dismissal must never be a one-way door: the
     preferences bar brings itself back when someone edits the home profile it is
     there to advertise (see prefs.js), which is the moment it becomes useful
     again. */
  const dismiss = {
    is(id) { return !!read(K.hidden, {})[id]; },
    set(id) { const all = read(K.hidden, {}); all[id] = nowISO(); return write(K.hidden, all); },
    restore(id) { const all = read(K.hidden, {}); delete all[id]; return write(K.hidden, all); },
  };

  const EN = () => !!(window.skLang && window.skLang.get() === 'en');
  function scopeNote() {
    return EN()
      ? 'Saved on this device only — no account needed. Clearing your browser data will remove it.'
      : 'محفوظ على هذا الجهاز فقط — من غير حساب. لو مسحت بيانات المتصفح هيتمسح.';
  }

  window.skStore = { saved, plans, owned, profile, qa, reviews, dismiss, encodePlan, decodePlan, scopeNote, STATUS, uid, keys: K };
})();
