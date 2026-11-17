/* ============================================================================
   SADKO mode bar: "Home view" (the 3D house) or "Shop view" (the classic shop).
   ----------------------------------------------------------------------------
   One control, pinned to the bottom of the screen on every storefront page:

     [ house: low outline roof + chimney over walls holding the rooms ] [ Shop view ]

   • On the home page the house is open: it holds the room buttons and is
     marked "You are here". The amber "Go to · Shop view" button squishes the
     bar (rooms pop out, the house shrinks) and then opens the shop.
   • On every other page the house is small and closed, with a door and
     "Go to · Home view". Pressing it springs the house open, rooms bounce back
     in, and the home page opens.
   • First visit to the home page: a welcome card asks which way to shop.
     The answer is kept in localStorage 'sadko-mode' ('house' | 'shop'), and a
     returning "shop" visitor is sent straight to the shop by index.html.

   API (window.skModeBar):
     mount({ mode, rooms, active, onRoom, shopHref, houseHref, shopIsHere }) -> bar
       bar.el, bar.setActive(i), bar.go('house'|'shop')
     needsWelcome() -> bool
     showWelcome(onChoose(mode))
     get() / set(mode)
   ========================================================================== */
(function () {
  'use strict';
  if (window.skModeBar) return;

  const KEY = 'sadko-mode';
  const ROOMS_KEY = 'sadko-rooms';
  const ARRIVE_KEY = 'sadko-mode-arrive';
  const isEN = () => !!(window.skLang && window.skLang.get() === 'en');
  const S = () => isEN() ? {
    home: 'SADKO Home', shop: 'Shop', here: 'You are here', go: 'Go to',
    aria: 'Choose how to shop: the home or the shop',
    rooms: ['Living', 'Kitchen', 'Laundry'],
    cardH: 'How would you like to shop today?',
    cardSub: 'Pick one. Both have the same products and prices.',
    optHome: 'Walk through the home', optHomeSub: 'Real rooms, tap an appliance',
    optShop: 'Shop the usual way', optShopSub: 'A product list with search',
    later: 'You can change your mind any time from the bar at the bottom of the screen',
  } : {
    home: 'بيت صادكو', shop: 'المتجر', here: 'أنت هنا', go: 'انتقل إلى',
    aria: 'اختر طريقة التسوق: البيت أو المتجر',
    rooms: ['المعيشة', 'المطبخ', 'الغسيل'],
    cardH: 'كيف تحب أن تتسوق اليوم؟',
    cardSub: 'اختر طريقة واحدة. الاثنان فيهم نفس المنتجات والأسعار.',
    optHome: 'تجوّل في البيت', optHomeSub: 'غرف حقيقية، اضغط على الجهاز',
    optShop: 'تسوّق بالطريقة العادية', optShopSub: 'قائمة منتجات مع البحث',
    later: 'تقدر تغيّر رأيك في أي وقت من الشريط أسفل الشاشة',
  };

  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const ss = {
    take: k => { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // "غرفة المعيشة" -> "المعيشة", "Living Room" -> "Living": the bar has to fit a phone
  const shortLabel = l => String(l || '').replace(/^غرفة\s+/, '').replace(/\s+room$/i, '').trim();

  const IC = {
    house: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
    door: '<svg viewBox="0 0 26 30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 29V3.5A1.5 1.5 0 0 1 5.5 2h15A1.5 1.5 0 0 1 22 3.5V29"/><path d="M1.5 29h23"/><circle cx="17.5" cy="16" r="1.6" fill="currentColor" stroke="none"/></svg>',
  };

  /* ---------------------------------------------------------------- bar ---- */
  function mount(o) {
    injectCSS();
    const T = S();
    let mode = o.mode === 'house' ? 'house' : 'shop';
    let busy = false;

    // Room names: the home page passes its real ones and remembers them, so the
    // other pages can show the same names while the house springs open.
    let rooms = (o.rooms || []).map(shortLabel).filter(Boolean);
    const lang = isEN() ? 'en' : 'ar';
    if (rooms.length) ls.set(ROOMS_KEY, JSON.stringify({ lang, rooms }));
    else {
      try { const m = JSON.parse(ls.get(ROOMS_KEY) || 'null'); if (m && m.lang === lang && Array.isArray(m.rooms)) rooms = m.rooms; } catch (e) {}
      if (!rooms.length) rooms = T.rooms;
    }

    const el = document.createElement('nav');
    el.className = 'skmb';
    el.setAttribute('aria-label', T.aria);
    const shopTag = o.shopIsHere ? 'span' : 'a';
    el.innerHTML =
      '<div class="skmb__bar">' +
        '<div class="skmb__house">' +
          '<div class="skmb__roof" aria-hidden="true"><svg><path class="skmb__v"/><path class="skmb__ch"/></svg>' +
            '<span class="skmb__smoke"><i></i><i></i><i></i></span></div>' +
          '<div class="skmb__walls">' +
            '<span class="skmb__door">' + IC.door + '</span>' +
            '<span class="skmb__tag"><small></small><b>' + esc(T.home) + '</b></span>' +
            '<div class="skmb__rooms">' + rooms.map((r, i) =>
              '<button type="button" class="skmb__room" data-room="' + i + '"><em>' + (i + 1) + '</em><span>' + esc(r) + '</span></button>').join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<' + shopTag + ' class="skmb__shop"' + (shopTag === 'a' ? ' href="' + esc(o.shopHref || 'shop.html') + '"' : '') + '>' + IC.grid +
          '<span class="skmb__lab"><small></small><b>' + esc(T.shop) + '</b></span></' + shopTag + '>' +
      '</div>';
    document.body.appendChild(el);
    document.documentElement.classList.add('skmb-on');

    const $ = s => el.querySelector(s);
    const bar = $('.skmb__bar'), house = $('.skmb__house'), shop = $('.skmb__shop'),
      roomsBox = $('.skmb__rooms'), door = $('.skmb__door'), roof = $('.skmb__roof');

    function paint() {
      const onHouse = mode === 'house';
      roomsBox.hidden = !onHouse; door.hidden = onHouse;
      /* The roof and chimney only crown the small closed house (shop view);
         over the wide open house they looked stretched, so it goes flat. */
      roof.hidden = onHouse;
      house.classList.toggle('is-on', onHouse); house.classList.toggle('is-off', !onHouse);
      shop.classList.toggle('is-on', !onHouse);
      /* No visible "Go to" kicker: the labels read "SADKO Home" and "Shop" on
         their own. "Go to" survives only in the screen-reader label below. */
      const tagK = $('.skmb__tag small'), labK = $('.skmb__lab small');
      tagK.textContent = ''; tagK.hidden = true;
      labK.textContent = ''; labK.hidden = true;
      if (onHouse) { house.removeAttribute('role'); house.removeAttribute('tabindex'); house.removeAttribute('aria-label'); }
      else { house.setAttribute('role', 'link'); house.setAttribute('tabindex', '0'); house.setAttribute('aria-label', T.go + ' ' + T.home); }
      if (!onHouse) shop.setAttribute('aria-current', 'page'); else shop.removeAttribute('aria-current');
    }
    paint();

    /* The roof is drawn in real pixels so the line stays even and the chimney's
       open bottom ends exactly on the slope; redrawn every frame the house
       changes width, including during the squish. */
    function drawRoof() {
      const w = roof.offsetWidth, h = roof.offsetHeight;
      if (!w || !h) return;
      const sw = parseFloat(getComputedStyle(roof).getPropertyValue('--skmb-stroke')) || 5, half = sw / 2;
      const peak = half + 0.5, y = x => h - (h - peak) * (x <= w / 2 ? x / (w / 2) : (w - x) / (w / 2));
      const cw = h < 24 ? 10 : 13, x1 = Math.round(w * 0.2), x2 = x1 + cw, top = Math.max(half, y(x2) - (h < 24 ? 8 : 10));
      roof.querySelector('svg').setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      roof.querySelector('.skmb__v').setAttribute('d', 'M' + half + ',' + h + ' L' + (w / 2) + ',' + peak + ' L' + (w - half) + ',' + h);
      roof.querySelector('.skmb__ch').setAttribute('d', 'M' + x1 + ',' + y(x1).toFixed(1) + ' V' + top + ' H' + x2 + ' V' + y(x2).toFixed(1) + ' M' + (x1 - 3) + ',' + top + ' H' + (x2 + 3));
      const smoke = roof.querySelector('.skmb__smoke'); smoke.style.left = (x1 + cw / 2) + 'px'; smoke.style.top = top + 'px';
    }
    if (window.ResizeObserver) new ResizeObserver(drawRoof).observe(roof);
    drawRoof();
    const roofOut = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scaleY(0)' }];

    /* The squish: out-going content pops away, the house springs to its new
       width (overshoot, then settle), the bar squashes and stretches, the roof
       dips and lifts, new content springs in. Skipped for reduce-motion. */
    async function morph(to) {
      if (busy || to === mode) return;
      busy = true;
      const still = reduceMotion();
      const out = to === 'shop' ? [...roomsBox.children] : [door];
      if (!still && to === 'house') roof.animate(roofOut, { duration: 200, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
      if (!still) await Promise.all(out.map((n, i) => n.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.3) translateY(8px)' }],
        { duration: 170, delay: (out.length - 1 - i) * 40, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished));
      const w0 = house.offsetWidth;
      mode = to; paint();
      out.forEach(n => n.getAnimations().forEach(a => a.cancel()));
      roof.getAnimations().forEach(a => a.cancel());
      drawRoof();
      const w1 = house.offsetWidth, d = w1 - w0;
      if (!still) {
        house.animate([{ width: w0 + 'px' }, { width: (w1 + d * .16) + 'px', offset: .5 }, { width: (w1 - d * .06) + 'px', offset: .78 }, { width: w1 + 'px' }],
          { duration: 640, easing: 'cubic-bezier(.3,.7,.4,1)' });
        bar.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(.95,1.1)', offset: .2 }, { transform: 'scale(1.04,.93)', offset: .5 },
          { transform: 'scale(.99,1.02)', offset: .75 }, { transform: 'scale(1,1)' }], { duration: 660, easing: 'ease-out' });
        // the roof pops up onto the compressed house
        if (to === 'shop') roof.animate([{ opacity: 0, transform: 'translateY(6px) scaleY(0)' }, { opacity: 1, transform: 'translateY(-4px) scaleY(1.2)', offset: .55 },
          { transform: 'translateY(1px) scaleY(.95)', offset: .8 }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 120, easing: 'ease-out', fill: 'backwards' });
        (to === 'shop' ? shop : house).animate([{ transform: 'scale(1)' }, { transform: 'scale(.88)', offset: .25 }, { transform: 'scale(1.07)', offset: .6 }, { transform: 'scale(1)' }], { duration: 520 });
        const inn = to === 'shop' ? [door] : [...roomsBox.children];
        inn.forEach((n, i) => n.animate(
          [{ opacity: 0, transform: 'translateY(14px) scale(.4)' }, { opacity: 1, transform: 'translateY(-4px) scale(1.1)', offset: .65 }, { opacity: 1, transform: 'none' }],
          { duration: 440, delay: 170 + i * 70, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }));
        await wait(560);
      }
      busy = false;
    }

    async function go(to) {
      if (busy) return;
      ls.set(KEY, to);
      const href = to === 'shop' ? (o.shopHref || 'shop.html') : (o.houseHref || 'index.html?house');
      if (to === mode) { if (to === 'shop' && !o.shopIsHere) location.href = href; return; }
      await morph(to);
      ss.set(ARRIVE_KEY, to);
      location.href = href;
    }

    shop.addEventListener('click', e => {
      if (mode === 'house') { e.preventDefault(); go('shop'); }
      else ls.set(KEY, 'shop');
    });
    house.addEventListener('click', e => {
      const r = e.target.closest('[data-room]');
      if (r) { if (o.onRoom) o.onRoom(+r.dataset.room); return; }
      if (mode === 'shop') go('house');
    });
    house.addEventListener('keydown', e => {
      if (mode === 'shop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go('house'); }
    });

    function setActive(i) {
      [...roomsBox.children].forEach((b, k) => {
        b.classList.toggle('is-active', k === i);
        if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
    }
    if (o.active != null) setActive(o.active);

    // Arrived here through the bar: a small settle bounce ties the two pages together.
    if (ss.take(ARRIVE_KEY) === mode && !reduceMotion()) {
      bar.animate([{ transform: 'scale(.9,1.08)' }, { transform: 'scale(1.03,.96)', offset: .5 }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
    }

    return { el, setActive, go, morph };
  }

  /* ----------------------------------------------------- welcome card ---- */
  function needsWelcome() {
    return !ls.get(KEY) && !/[?&](house|spots)\b/.test(location.search);
  }
  function showWelcome(onChoose) {
    injectCSS();
    const T = S();
    const veil = document.createElement('div');
    veil.className = 'skmb-veil';
    veil.innerHTML =
      '<div class="skmb-card" role="dialog" aria-modal="true" aria-labelledby="skmb-card-h">' +
        '<h2 id="skmb-card-h">' + esc(T.cardH) + '</h2><p class="skmb-card__sub">' + esc(T.cardSub) + '</p>' +
        '<div class="skmb-card__opts">' +
          '<button type="button" class="skmb-opt skmb-opt--pri" data-mode="house"><span class="skmb-opt__ico">' + IC.house + '</span>' +
            '<span class="skmb-opt__txt"><b>' + esc(T.optHome) + '</b><span>' + esc(T.optHomeSub) + '</span></span></button>' +
          '<button type="button" class="skmb-opt" data-mode="shop"><span class="skmb-opt__ico">' + IC.grid + '</span>' +
            '<span class="skmb-opt__txt"><b>' + esc(T.optShop) + '</b><span>' + esc(T.optShopSub) + '</span></span></button>' +
        '</div>' +
        '<p class="skmb-card__later">' + esc(T.later) + '</p>' +
      '</div>';
    document.body.appendChild(veil);
    const root = document.documentElement, prevOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    setTimeout(() => { const b = veil.querySelector('.skmb-opt--pri'); if (b) b.focus({ preventScroll: true }); }, 60);
    veil.addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      const m = b.dataset.mode;
      ls.set(KEY, m);
      root.style.overflow = prevOverflow;
      veil.classList.add('is-out');
      setTimeout(() => veil.remove(), 380);
      if (onChoose) onChoose(m);
    });
  }

  /* ---------------------------------------------------------------- css ---- */
  function injectCSS() {
    if (document.getElementById('skmb-css')) return;
    const css = `
  @view-transition{navigation:auto;}
  .skmb{position:fixed;left:50%;bottom:calc(var(--skmb-lift,22px) + env(safe-area-inset-bottom));transform:translateX(-50%);
    z-index:56;font-family:'Cairo','Segoe UI',system-ui,sans-serif;view-transition-name:skmb;max-width:98vw;}
  html:has(.sk-announce) .skmb{--skmb-lift:84px;}
  .skmb__bar{display:flex;align-items:flex-end;gap:12px;transform-origin:50% 100%;white-space:nowrap;
    filter:drop-shadow(0 10px 18px rgba(20,52,58,.3));}
  .skmb [hidden]{display:none!important;}
  .skmb__house{position:relative;display:flex;flex-direction:column;text-align:center;color:#14343a;}
  .skmb__house.is-off{cursor:pointer;}
  .skmb__house:focus-visible{outline:3px solid #fe9800;outline-offset:4px;border-radius:20px;}
  .skmb__roof{--skmb-stroke:5;position:relative;height:26px;margin:0 12px -2.5px;pointer-events:none;transform-origin:50% 100%;}
  .skmb__roof svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;color:#2E7E88;transition:color .35s;
    filter:drop-shadow(0 0 1.5px rgba(255,255,255,.95)) drop-shadow(0 0 1px rgba(255,255,255,.8));}
  .skmb__roof path{fill:none;stroke:currentColor;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;}
  .skmb__house.is-off .skmb__roof svg{color:#fe9800;}
  .skmb__smoke{position:absolute;left:0;top:0;width:7px;height:7px;margin:-10px 0 0 -3.5px;}
  .skmb__smoke i{position:absolute;left:0;top:0;width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.95);
    box-shadow:0 0 0 1px rgba(20,52,58,.15);opacity:0;}
  .skmb__house.is-on .skmb__smoke i{animation:skmb-smoke 2.6s ease-out infinite;}
  .skmb__house.is-on .skmb__smoke i:nth-child(2){animation-delay:.85s;}
  .skmb__house.is-on .skmb__smoke i:nth-child(3){animation-delay:1.7s;}
  @keyframes skmb-smoke{0%{opacity:0;transform:translate(0,0) scale(.5)}20%{opacity:.9}100%{opacity:0;transform:translate(6px,-16px) scale(1.5)}}
  .skmb__walls{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:center;gap:4px;background:#fff;
    border:3.5px solid #2E7E88;border-radius:20px;padding:2px 6px;min-height:64px;overflow:hidden;transition:border-color .35s,background-color .35s;}
  .skmb__house.is-off .skmb__walls{border-color:#fe9800;}
  .skmb__house.is-off:hover .skmb__walls{background:#fff6e6;}
  .skmb__door{display:flex;align-items:center;color:#241a05;padding-inline-start:4px;}
  .skmb__door svg{width:24px;height:28px;}
  .skmb__tag{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;padding:0 10px 0 6px;color:#2A7779;}
  .skmb__tag small{font-size:12.5px;font-weight:800;opacity:.85;}
  .skmb__tag b{font-size:19px;font-weight:900;}
  .skmb__house.is-on .skmb__tag{border-inline-end:2px solid #E6F0F1;margin-inline-end:4px;padding-inline-end:14px;}
  .skmb__house.is-off .skmb__tag{color:#241a05;padding:0;}
  .skmb__rooms{display:flex;gap:4px;align-items:center;}
  .skmb__room{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;cursor:pointer;border-radius:16px;
    padding:11px 16px;font:800 17px 'Cairo',sans-serif;color:#14343a;min-height:52px;transition:background-color .2s,box-shadow .2s;}
  .skmb__room em{font-style:normal;direction:ltr;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;
    background:#E6F0F1;color:#2A7779;font-size:13px;font-weight:900;}
  .skmb__room:hover,.skmb__room:focus-visible{background:#EFF6F6;}
  .skmb__room.is-active{background:#E6F0F1;color:#2A7779;box-shadow:inset 0 0 0 2px #2E7E88;}
  .skmb__room.is-active em{background:#2E7E88;color:#fff;}
  .skmb__shop{box-sizing:border-box;display:flex;align-items:center;gap:10px;border:0;cursor:pointer;border-radius:20px;
    padding:8px 18px 8px 14px;min-height:64px;background:#fe9800;color:#241a05;text-decoration:none;transition:background-color .35s,color .35s;}
  .skmb__shop svg{width:28px;height:28px;flex:0 0 auto;}
  .skmb__lab{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;}
  .skmb__lab small{font-size:12.5px;font-weight:800;opacity:.85;}
  .skmb__lab b{font-size:19px;font-weight:900;}
  .skmb__shop.is-on{background:#2E7E88;color:#fff;box-shadow:inset 0 0 0 2px rgba(255,255,255,.6);}
  span.skmb__shop{cursor:default;}
  .skmb__shop:not(.is-on):hover{background:#ffad33;}
  .skmb__shop:focus-visible{outline:3px solid #14343a;outline-offset:3px;}
  /* the bar floats over the last thing on the page: keep the footer's small print clear of it */
  html.skmb-on .sk-foot,html.skmb-on body > footer.foot{padding-bottom:120px;}
  @media (max-width:700px){
    .skmb{--skmb-lift:12px;}
    .skmb__bar{gap:clamp(4px,1.3vw,6px);}
    .skmb__roof{--skmb-stroke:4;height:20px;margin:0 9px -2px;}
    .skmb__roof path{stroke-width:4;}
    .skmb__walls{padding:2px clamp(2px,.8vw,3px);min-height:clamp(54px,15.9vw,62px);border-radius:16px;border-width:3px;}
    .skmb__tag{padding:0 3px;}
    .skmb__house.is-on .skmb__tag{padding-inline-end:clamp(4px,1.5vw,6px);margin-inline-end:0;}
    .skmb__tag small{font-size:clamp(8.5px,2.45vw,9.5px);}
    .skmb__tag b{font-size:clamp(11.5px,3.45vw,13.5px);}
    .skmb__room{padding:8px clamp(3px,1.3vw,5px);font-size:clamp(11.5px,3.6vw,14px);min-height:clamp(42px,12.3vw,48px);border-radius:13px;}
    .skmb__room em{display:none;}
    .skmb__door svg{width:18px;height:22px;}
    .skmb__shop{flex-direction:column;gap:0;padding:6px clamp(5px,2vw,8px);min-height:clamp(54px,15.9vw,62px);border-radius:16px;}
    .skmb__shop svg{width:22px;height:22px;}
    .skmb__lab{align-items:center;}
    .skmb__lab small{font-size:clamp(8.5px,2.5vw,10px);}
    .skmb__lab b{font-size:clamp(11.5px,3.35vw,13px);}
    html.skmb-on .sk-foot,html.skmb-on body > footer.foot{padding-bottom:100px;}
  }

  /* ---- first-visit welcome card ---- */
  .skmb-veil{position:fixed;inset:0;z-index:230;display:grid;place-items:center;padding:16px;background:rgba(20,52,58,.55);
    font-family:'Cairo','Segoe UI',system-ui,sans-serif;animation:skmb-in .35s ease;}
  .skmb-veil.is-out{opacity:0;transition:opacity .35s ease;pointer-events:none;}
  @keyframes skmb-in{from{opacity:0}to{opacity:1}}
  .skmb-card{box-sizing:border-box;width:min(760px,100%);background:#fff;color:#14343a;border-radius:28px;padding:30px 34px 24px;text-align:center;
    box-shadow:0 30px 70px rgba(0,0,0,.3);animation:skmb-pop .45s cubic-bezier(.2,.8,.3,1.2);}
  @keyframes skmb-pop{from{transform:translateY(16px) scale(.96);opacity:0}to{transform:none;opacity:1}}
  .skmb-card h2{margin:0 0 4px;font-size:clamp(1.4rem,3.4vw,2rem);line-height:1.3;}
  .skmb-card__sub{margin:0 0 20px;color:#5b6b6e;font-size:clamp(.95rem,2vw,1.12rem);font-weight:600;}
  .skmb-card__opts{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .skmb-opt{display:flex;flex-direction:column;align-items:center;gap:8px;border:3px solid #e6e2da;background:#fff;border-radius:22px;
    padding:22px 16px;cursor:pointer;font-family:inherit;color:#14343a;transition:border-color .18s,background-color .18s,transform .18s;}
  .skmb-opt:hover,.skmb-opt:focus-visible{border-color:#2E7E88;background:#EFF6F6;transform:translateY(-2px);outline:none;}
  .skmb-opt--pri{border-color:#2E7E88;}
  .skmb-opt__ico{width:72px;height:72px;border-radius:20px;background:#E6F0F1;display:grid;place-items:center;color:#2E7E88;}
  .skmb-opt__ico svg{width:40px;height:40px;}
  .skmb-opt__txt b{display:block;font-size:clamp(1.15rem,2.4vw,1.5rem);font-weight:900;}
  .skmb-opt__txt span{display:block;font-size:1rem;color:#5b6b6e;font-weight:600;line-height:1.5;}
  .skmb-card__later{margin:16px 0 0;font-size:.95rem;color:#5b6b6e;font-weight:700;}
  @media (max-width:600px){
    .skmb-card{padding:22px 18px 18px;border-radius:24px;}
    .skmb-card__opts{grid-template-columns:1fr;gap:10px;}
    .skmb-opt{flex-direction:row;text-align:start;padding:12px 14px;gap:12px;}
    .skmb-opt__ico{width:54px;height:54px;flex:0 0 auto;}
    .skmb-opt__ico svg{width:30px;height:30px;}
    .skmb-opt__txt span{font-size:.85rem;}
  }
  @media (prefers-reduced-motion:reduce){
    .skmb__house.is-on .skmb__smoke i{animation:none;}
    .skmb-veil,.skmb-card{animation:none;}
  }
  `;
    const st = document.createElement('style');
    st.id = 'skmb-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  window.skModeBar = {
    mount, needsWelcome, showWelcome,
    get: () => ls.get(KEY), set: m => ls.set(KEY, m),
  };
})();
