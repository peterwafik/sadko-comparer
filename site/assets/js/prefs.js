/* ============================================================================
   SADKO preference filter — "show me what fits MY home", available everywhere.
   ----------------------------------------------------------------------------
   The home profile a customer fills in (optionally) at sign-up is only worth
   collecting if it does something. This module turns it into a filter that can
   be switched on from any page with a product grid: category pages, the shop,
   saved products.

   Rules it follows, so the filter can be trusted:
   • A product is only ever hidden for a reason we can state in words.
   • A missing spec never hides anything. If we cannot read a fridge's width we
     keep it and say the width is unknown — dropping it would quietly hide
     products the customer might want.
   • It is off by default, one click to turn off, and always reports how many
     of how many are showing.

     skPrefs.enabled() / toggle(on)
     skPrefs.match(product, spec) -> { hide, reasons:[{k,text}] }
     skPrefs.mountBar(hostEl, opts) — the on/off bar + live count
     skPrefs.applyToCards(rootEl)   — filters legacy `article.card` grids
   ========================================================================== */
(function () {
  'use strict';

  const KEY = 'sadko-prefs-on';
  const EN = () => !!(window.skLang && window.skLang.get() === 'en');
  const t = (ar, en) => (EN() ? en : ar);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ROOT = /\/category\//.test(location.pathname) ? '../' : '';

  /* Budget bands, in EGP. Deliberately wide: a band is a hint, not a wall. */
  const BUDGET_BANDS = {
    low:    { max: 10000,  ar: 'أقل من ١٠ آلاف',        en: 'under 10,000' },
    mid:    { max: 25000,  ar: 'من ١٠ إلى ٢٥ ألفاً',        en: '10,000–25,000' },
    high:   { max: 60000,  ar: 'من ٢٥ إلى ٦٠ ألفاً',        en: '25,000–60,000' },
    open:   { max: 0,      ar: 'بلا حد أقصى',           en: 'no limit' },
  };

  const prof = () => (window.skAuth ? window.skAuth.profile() : (window.skStore ? window.skStore.profile.get() : {})) || {};

  function enabled() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function toggle(on) {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    document.dispatchEvent(new CustomEvent('sk-prefs-change', { detail: { on } }));
  }
  /* Is there anything in the active place worth filtering on? */
  function hasAny() {
    const p = prof();
    return !!(p.budgetBand || (p.brands && p.brands.length) || p.people || p.energyPriority === 'high'
              || p.fridgeSlotW || p.washerSlotW || p.cookerSlotW || p.dishwasherSlotW
              || p.doorwayW || p.roomAreaM2 || p.finish);
  }

  /* ---- the actual decision ---- */
  function match(product, spec) {
    const p = prof();
    const s = spec || (window.skSpecs ? window.skSpecs.of(product) : null);
    const reasons = [];
    let hide = false;
    if (!s) return { hide: false, reasons };

    // budget — a hard-ish filter, the one people mean most literally
    const band = BUDGET_BANDS[p.budgetBand];
    if (band && band.max && s.price > band.max) {
      hide = true;
      reasons.push({ k: 'no', text: t('أغلى من الميزانية التى حددتها (' + band.ar + ').',
                                      'Above your stated budget (' + band.en + ').') });
    }

    // Doorway first: an appliance wider than the narrowest door never gets in,
    // whatever the space inside looks like.
    const door = Number(p.doorwayW) || 0;
    if (door && s.dims && s.dims.w && s.dims.w > door) {
      hide = true;
      reasons.push({ k: 'no', text: t('أعرض من أضيق باب عندك (' + s.dims.w + ' سم مقابل ' + door + ' سم)، لن يمر.',
                                      'Wider than your narrowest doorway (' + s.dims.w + ' cm vs ' + door + ' cm), so it will not get in.') });
    }

    // slot width for the appliances people actually measure a gap for
    const slot = s.family === 'fridge' ? Number(p.fridgeSlotW)
               : s.family === 'washer' ? Number(p.washerSlotW)
               : s.family === 'cooker' ? Number(p.cookerSlotW)
               : s.family === 'dishwasher' ? Number(p.dishwasherSlotW) : 0;
    if (slot && s.dims && s.dims.w) {
      if (s.dims.w > slot) {
        hide = true;
        reasons.push({ k: 'no', text: t('أعرض من المساحة المتاحة لديك (' + s.dims.w + ' سم مقابل ' + slot + ' سم).',
                                        'Wider than your space (' + s.dims.w + ' cm vs ' + slot + ' cm).') });
      } else {
        reasons.push({ k: 'ok', text: t('يدخل فى مساحتك (' + s.dims.w + ' سم).', 'Fits your space (' + s.dims.w + ' cm).') });
      }
    } else if (slot) {
      // unknown width must never hide the product
      reasons.push({ k: 'hm', text: t('عرض الجهاز غير متوفر، تأكد منه قبل الشراء.', 'Width not stated: confirm before buying.') });
    }

    // brands — a preference, never a filter on its own
    if (p.brands && p.brands.length && s.brand) {
      if (p.brands.includes(s.brand.en)) reasons.push({ k: 'ok', text: t('من ماركاتك المفضلة.', 'One of your preferred brands.') });
    }
    // energy priority — surfaced, not enforced
    if (p.energyPriority === 'high') {
      if (s.energy && (s.energy.cls === 'A' || s.energy.inverter)) reasons.push({ k: 'ok', text: t('موفّر للكهرباء.', 'Energy efficient.') });
    }
    // household size — informational
    if (p.people && s.headline && window.skSpecs) {
      const b = window.skSpecs.sizeFor(s.family, Number(p.people));
      if (b && s.headline.v >= b.min && s.headline.v <= b.max)
        reasons.push({ k: 'ok', text: t('سعته مناسبة لأسرة من ' + p.people + '.', 'Sized for a household of ' + p.people + '.') });
    }
    return { hide, reasons };
  }

  /* ---- the bar every page can drop in ----
     DISMISSAL. The bar is an invitation, and an invitation that cannot be
     declined is an advert. `skStore.dismiss` remembers the × across pages and
     sessions (see store.js) — a per-render flag would be useless here, because
     the storefront rebuilds this column on every facet click.

     Closing it while the filter is ON also turns the filter OFF. That is the
     only honest option: the bar is the sole control for a filter that HIDES
     products, so leaving it running behind a panel the visitor just closed
     would silently subtract rows from every grid with nothing on screen left to
     explain why. Closing it therefore always ends with everything visible.

     The way back is `sk-prefs-change`: editing the home profile un-dismisses the
     bar, because that is the moment it stops being a pitch and starts being a
     control the visitor asked for. */
  const DISMISS_ID = 'prefs-bar';
  const store = () => window.skStore;
  const isDismissed = () => { const s = store(); return !!(s && s.dismiss.is(DISMISS_ID)); };

  function closeBtn() {
    return '<button type="button" class="skp-x" aria-label="' +
      t('أغلق هذه اللوحة', 'Close this panel') + '" title="' +
      t('أغلق هذه اللوحة', 'Close this panel') + '">&times;</button>';
  }

  /* ---- the bar every page can drop in ---- */
  function mountBar(host, opts) {
    if (!host) return;
    const o = opts || {};
    const draw = () => {
      const on = enabled(), any = hasAny();
      if (isDismissed()) { host.className = 'skp-bar is-gone'; host.innerHTML = ''; return; }
      host.className = 'skp-bar' + (on ? ' is-on' : '');
      const wireX = () => {
        const x = host.querySelector('.skp-x');
        x && x.addEventListener('click', () => {
          if (enabled()) toggle(false);          // never hide rows behind a closed panel
          const s = store(); s && s.dismiss.set(DISMISS_ID);
          draw();
          if (o.onChange) o.onChange(enabled());
        });
      };
      if (!any) {
        host.innerHTML =
          '<div><b>' + t('تصفية حسب منزلك', 'Filter by your home') + '</b>' +
          '<p>' + t('إذا أخبرتنا قليلاً عن منزلك (عدد الأفراد، والميزانية، ومقاس موضع الجهاز)، أمكننا إخفاء ما لا يناسبك من كل صفحة.',
                    'Tell us a little about your home (household size, budget, the space you have) and we can hide what will not fit, on every page.') + '</p></div>' +
          '<a class="skp-btn" href="' + ROOT + 'account.html#home">' + t('كمّل بياناتك', 'Complete your profile') + '</a>' +
          closeBtn();
        wireX();
        return;
      }
      const many = (window.skAuth ? window.skAuth.homes() : []).length > 1;
      host.innerHTML =
        '<div><b>' + t('تصفية حسب مكانك', 'Filter by your place') + '</b>' +
        '<p id="skpCount">' + (on ? t('مُفعَّلة: نخفى ما لا يناسبك.', 'On: hiding what will not suit you.')
                                  : t('مُعطَّلة: نعرض كل المنتجات.', 'Off: showing everything.')) + '</p></div>' +
        '<div class="skp-actions">' +
          // When someone keeps several places, changing which one is active is
          // the fastest way to re-filter — so the switcher lives right here.
          '<span id="skpSwitch" class="skp-switch"></span>' +
          '<a class="skp-link" href="' + ROOT + 'account.html#homes">' + (many ? t('إدارة الأماكن', 'Manage places') : t('عدّل تفضيلاتى', 'Edit preferences')) + '</a>' +
          '<button type="button" class="skp-btn" aria-pressed="' + (on ? 'true' : 'false') + '">' +
            (on ? t('أوقف التصفية', 'Turn filter off') : t('صفِّ حسب مكانى', 'Filter for my place')) + '</button>' +
        '</div>' +
        closeBtn();
      // `.skp-btn` is the toggle; querySelector('button') would now find whichever
      // comes first in the markup, so both controls are addressed by their class.
      const b = host.querySelector('button.skp-btn');
      b && b.addEventListener('click', () => { toggle(!enabled()); draw(); if (o.onChange) o.onChange(enabled()); });
      wireX();
      if (window.skHomes) window.skHomes.switcher(host.querySelector('#skpSwitch'), {
        showSummary: false,
        onChange: () => { draw(); if (o.onChange) o.onChange(enabled()); },
      });
    };
    draw();
    document.addEventListener('sk-prefs-change', () => {
      // Editing the home profile is an explicit ask for this filter, so it
      // outranks an earlier dismissal: bring the bar back rather than leaving
      // the visitor with preferences and no control that acts on them.
      const s = store(); if (s) s.dismiss.restore(DISMISS_ID);
      draw();
      if (o.onChange) o.onChange(enabled());
    });
    return { redraw: draw, setCount };
  }

  function setCount(shown, total) {
    const el = document.getElementById('skpCount');
    if (!el) return;
    el.textContent = enabled()
      ? t('نعرض ' + shown + ' من ' + total + ' وفق تفضيلاتك.', 'Showing ' + shown + ' of ' + total + ' that suit you.')
      : t('مُعطَّلة: نعرض كل المنتجات (' + total + ').', 'Off: showing all ' + total + ' products.');
  }

  /* ---- legacy category/shop grids: filter `article.card` in place ---- */
  function applyToCards(root) {
    const cards = [...(root || document).querySelectorAll('article.card')];
    if (!cards.length) return { shown: 0, total: 0 };
    const on = enabled();
    let shown = 0;
    cards.forEach(card => {
      const prod = card.__skProduct;
      if (!on || !prod) { card.hidden = false; shown++; card.querySelectorAll('.skp-why').forEach(x => x.remove()); return; }
      const m = match(prod);
      card.hidden = m.hide;
      if (!m.hide) {
        shown++;
        card.querySelectorAll('.skp-why').forEach(x => x.remove());
        const good = m.reasons.filter(r => r.k === 'ok').slice(0, 2);
        if (good.length) {
          const body = card.querySelector('.card__body') || card;
          const n = document.createElement('p');
          n.className = 'skp-why';
          n.textContent = good.map(r => r.text).join(' · ');
          body.appendChild(n);
        }
      }
    });
    setCount(shown, cards.length);
    return { shown, total: cards.length };
  }

  function injectCSS() {
    if (document.getElementById('skp-css')) return;
    const css = `
    /* SPACING. This bar is mounted INSIDE the storefront's results column, which
       is already inset by the page gutter. It used to carry the page's own
       centring (max-width:1440px + width:calc(100% - 2*gutter)), so the gutter
       was applied a second time and the bar sat ~48px narrower than the grid it
       labels — visibly indented from the toolbar above and the cards below.
       Full width of its column now, with the site's rhythm tokens (app.css /
       category.css) instead of hardcoded pixels: the missing margin-bottom is
       why it used to touch the first row of product cards. */
    .skp-bar{display:flex;align-items:center;justify-content:space-between;
      gap:var(--sk-gap-sm,12px) var(--sk-gap-md,18px);flex-wrap:wrap;
      width:100%;margin:0 0 var(--sk-gutter,26px);
      padding:var(--sk-gap-md,18px) clamp(14px,3vw,22px);border-radius:16px;background:#fff;
      border:1px solid rgba(104,209,212,.22);box-shadow:0 2px 10px rgba(20,52,58,.05);}
    .skp-bar.is-gone{display:none;}
    /* The × is a corner control, not part of the flex rhythm: pinned to the panel's
       own top-inline-end corner so the text block keeps its full measure and the
       button lands where a close button is looked for in both RTL and LTR. */
    .skp-bar{position:relative;padding-inline-end:clamp(40px,5vw,52px);}
    .skp-x{position:absolute;top:8px;inset-inline-end:10px;width:30px;height:30px;line-height:1;
      display:grid;place-items:center;font:400 21px/1 'Cairo',sans-serif;color:#7d8b8e;
      background:transparent;border:0;border-radius:50%;cursor:pointer;transition:.18s;}
    .skp-x:hover{background:rgba(20,52,58,.07);color:#14343a;}
    .skp-x:focus-visible{outline:2px solid #68D1D4;outline-offset:2px;}
    .skp-bar.is-on{background:linear-gradient(120deg,#EDF9FA,#f7f5f1);border-color:rgba(104,209,212,.4);}
    .skp-bar b{display:block;font:800 .96rem 'Cairo',sans-serif;color:#14343a;}
    .skp-bar p{margin:4px 0 0;font:600 .82rem 'Cairo',sans-serif;color:#5b6b6e;}
    .skp-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    .skp-btn{font:800 .85rem 'Cairo',sans-serif;color:#241a05;background:#fe9800;border:0;cursor:pointer;
      padding:10px 18px;border-radius:999px;text-decoration:none;white-space:nowrap;}
    .skp-btn:hover{filter:brightness(1.06);}
    .skp-bar.is-on .skp-btn{background:#68D1D4;color:#14343a;}
    .skp-switch{display:inline-flex;}
    .skp-link{font:700 .82rem 'Cairo',sans-serif;color:#2A7779;text-decoration:none;white-space:nowrap;}
    .skp-link:hover{text-decoration:underline;}
    .skp-why{margin:6px 0 0!important;font:700 .74rem 'Cairo',sans-serif!important;color:#17795a!important;line-height:1.5;}
    `;
    const s = document.createElement('style'); s.id = 'skp-css'; s.textContent = css;
    document.head.appendChild(s);
  }

  injectCSS();
  window.skPrefs = { enabled, toggle, hasAny, match, mountBar, applyToCards, setCount, BUDGET_BANDS, prof };
})();
