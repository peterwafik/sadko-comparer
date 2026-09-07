/* ============================================================================
   SADKO funnel tracking + cart-abandonment prompt (window.skTrack).
   ----------------------------------------------------------------------------
   Beacons each step of the buying journey to /api/track so the owner can see,
   in the control room, how far people get with each product:

       view → save → add_to_cart → checkout_start → purchase

   Identity is an anonymous visitor id kept in localStorage — no personal data.
   Also: when items sit in the cart untouched for 20 minutes, it asks the shopper
   whether they want to finish, and if not, why — feeding the owner real reasons
   for abandoned carts. Dependency-free; safe to load on every page.
   ========================================================================== */
(function () {
  'use strict';
  var VID_KEY = 'sadko-vid';
  var TOUCH_KEY = 'sadko-cart-touch';       // ms timestamp of the last cart change
  var PROMPT_KEY = 'sadko-cart-prompted';   // ms timestamp of the last abandonment prompt
  var CART_KEY = 'sadko-cart-v1';
  var IDLE_MS = 20 * 60 * 1000;             // 20 minutes
  var RENAG_MS = 6 * 60 * 60 * 1000;        // don't re-ask within 6 hours

  var EN = (function () { try { return localStorage.getItem('sadko-lang') === 'en'; } catch (e) { return false; } });
  function t(ar, en) { return EN() ? en : ar; }

  function read(key, fb) { try { var v = localStorage.getItem(key); return v == null ? fb : v; } catch (e) { return fb; } }
  function write(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
  function cart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { return []; } }

  function vid() {
    var v = read(VID_KEY, null);
    if (!v) { v = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); write(VID_KEY, v); }
    return v;
  }

  /* Fire-and-forget beacon. sendBeacon survives page unload; fetch keepalive is
     the fallback. Never throws, never blocks navigation. */
  function send(path, body) {
    body.vid = vid();
    try {
      var blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
      if (navigator.sendBeacon && navigator.sendBeacon(path, blob)) return;
    } catch (e) {}
    try { fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true, credentials: 'same-origin' }); } catch (e) {}
  }

  var skTrack = {
    vid: vid,
    event: function (type, productId, meta) {
      if (!type) return;
      send('/api/track', { type: type, productId: productId != null ? String(productId) : undefined, meta: meta || undefined });
    },
    // Called by nav.js whenever the cart changes, to (re)start the idle clock.
    cartTouched: function () { write(TOUCH_KEY, String(Date.now())); },
  };
  window.skTrack = skTrack;

  /* ---- cart abandonment prompt ---------------------------------------------- */
  var shownThisPage = false;

  function onCartPage() {
    var p = (location.pathname || '').toLowerCase();
    return p.indexOf('cart.html') >= 0 || p.indexOf('checkout.html') >= 0;
  }
  function cartValue(items) { return items.reduce(function (n, i) { return n + (Number(i.price) || 0) * (Number(i.qty) || 1); }, 0); }
  function money(n) { return (Number(n) || 0).toLocaleString('en-US') + (EN() ? ' EGP' : ' ج.م'); }

  function maybePrompt() {
    if (shownThisPage || onCartPage()) return;
    var items = cart();
    if (!items.length) return;
    var touch = +read(TOUCH_KEY, 0) || 0;
    if (!touch) { skTrack.cartTouched(); return; }         // first sighting: start the clock
    if (Date.now() - touch < IDLE_MS) return;              // not idle long enough yet
    var last = +read(PROMPT_KEY, 0) || 0;
    if (Date.now() - last < RENAG_MS) return;              // asked recently — leave them be
    openPrompt(items);
  }

  var REASONS = [
    { k: 'price', ar: 'السعر مرتفع بعض الشىء', en: 'Price is a bit high' },
    { k: 'shipping', ar: 'مصاريف الشحن/التركيب', en: 'Delivery / installation cost' },
    { k: 'thinking', ar: 'ما زلت أفكر', en: 'Still thinking it over' },
    { k: 'comparing', ar: 'بقارن بأماكن تانية', en: 'Comparing other options' },
    { k: 'details', ar: 'محتاج تفاصيل أكتر', en: 'Need more details' },
    { k: 'payment', ar: 'طريقة الدفع/التوصيل', en: 'Payment / delivery method' },
    { k: 'issue', ar: 'واجهت مشكلة فى الموقع', en: 'Hit a problem on the site' },
    { k: 'other', ar: 'سبب تانى', en: 'Something else' },
  ];

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function openPrompt(items) {
    shownThisPage = true;
    write(PROMPT_KEY, String(Date.now()));
    injectCss();
    var dir = EN() ? 'ltr' : 'rtl';
    var count = items.reduce(function (n, i) { return n + (Number(i.qty) || 1); }, 0);
    var val = cartValue(items);
    var thumbs = items.slice(0, 4).map(function (i) {
      return i.image ? '<img src="' + esc(i.image) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    }).join('');

    var scrim = el('div', 'skab-scrim');
    var box = el('div', 'skab');
    box.setAttribute('dir', dir);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<button class="skab__x" aria-label="' + t('إغلاق', 'Close') + '">&times;</button>' +
      '<div class="skab__step" data-step="ask">' +
        '<div class="skab__thumbs">' + thumbs + '</div>' +
        '<h2>' + t('لسه فاكر الحاجات دى؟', 'Still thinking about these?') + '</h2>' +
        '<p>' + t('عندك ' + count + ' حاجة فى السلة بقيمة ', 'You have ' + count + ' item(s) in your cart worth ') +
          '<b>' + money(val) + '</b>' + t('. تحب تكمّل الطلب؟', '. Want to finish your order?') + '</p>' +
        '<div class="skab__row">' +
          '<button class="skab__btn skab__btn--primary" data-go="cart">' + t('كمّل الطلب', 'Finish my order') + '</button>' +
          '<button class="skab__btn skab__btn--ghost" data-go="why">' + t('مش دلوقتى', 'Not right now') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="skab__step" data-step="why" hidden>' +
        '<h2>' + t('محدش يزعل — إيه اللى وقفك؟', 'No worries — what stopped you?') + '</h2>' +
        '<p>' + t('ردّك بيساعدنا نحسّن الخدمة (اختيارى).', 'Your answer helps us do better (optional).') + '</p>' +
        '<div class="skab__reasons">' + REASONS.map(function (r) {
          return '<button class="skab__chip" data-reason="' + r.k + '">' + esc(EN() ? r.en : r.ar) + '</button>';
        }).join('') + '</div>' +
        '<textarea class="skab__note" rows="2" placeholder="' + t('اكتب سبب تانى…', 'Tell us more…') + '" hidden></textarea>' +
        '<div class="skab__row">' +
          '<button class="skab__btn skab__btn--primary" data-send="1">' + t('ابعت', 'Send') + '</button>' +
          '<button class="skab__btn skab__btn--ghost" data-go="close">' + t('تخطّى', 'Skip') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="skab__step" data-step="thanks" hidden>' +
        '<h2>' + t('شكراً لوقتك 🙏', 'Thanks for the feedback 🙏') + '</h2>' +
        '<p>' + t('السلة محفوظة لو غيّرت رأيك.', 'Your cart is saved if you change your mind.') + '</p>' +
        '<div class="skab__row"><button class="skab__btn skab__btn--primary" data-go="close">' + t('تمام', 'Done') + '</button></div>' +
      '</div>';

    document.body.appendChild(scrim);
    document.body.appendChild(box);
    requestAnimationFrame(function () { scrim.classList.add('on'); box.classList.add('on'); });

    var chosen = null;
    function step(name) {
      box.querySelectorAll('.skab__step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== name; });
    }
    function close() {
      // resetting the idle clock stops it re-firing the instant they keep browsing
      skTrack.cartTouched();
      scrim.classList.remove('on'); box.classList.remove('on');
      setTimeout(function () { scrim.remove(); box.remove(); }, 220);
    }
    function abandon(reason, note) {
      send('/api/abandon', { reason: reason || null, note: note || null, value: cartValue(items),
        items: items.map(function (i) { return { id: i.id, title: i.title, qty: i.qty || 1, price: i.price || 0 }; }) });
    }

    box.querySelector('.skab__x').addEventListener('click', close);
    scrim.addEventListener('click', close);
    box.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) {
        var to = go.getAttribute('data-go');
        if (to === 'cart') { skTrack.event('checkout_start'); location.href = 'cart.html'; return; }
        if (to === 'why') { step('why'); return; }
        if (to === 'close') { close(); return; }
      }
      var chip = e.target.closest('[data-reason]');
      if (chip) {
        chosen = chip.getAttribute('data-reason');
        box.querySelectorAll('.skab__chip').forEach(function (c) { c.classList.toggle('on', c === chip); });
        var note = box.querySelector('.skab__note');
        note.hidden = chosen !== 'other';
        if (chosen === 'other') note.focus();
        return;
      }
      if (e.target.closest('[data-send]')) {
        var noteEl = box.querySelector('.skab__note');
        abandon(chosen, chosen === 'other' ? (noteEl.value || '').slice(0, 600) : null);
        step('thanks');
      }
    });
  }

  function injectCss() {
    if (document.getElementById('skab-css')) return;
    var s = document.createElement('style'); s.id = 'skab-css';
    s.textContent =
      '.skab-scrim{position:fixed;inset:0;z-index:2000;background:rgba(12,32,36,.5);opacity:0;transition:opacity .25s;backdrop-filter:blur(2px);}' +
      '.skab-scrim.on{opacity:1;}' +
      '.skab{position:fixed;z-index:2001;left:50%;top:50%;transform:translate(-50%,-46%);opacity:0;pointer-events:none;' +
        'width:min(440px,92vw);background:#fff;border-radius:22px;padding:26px 26px 22px;font-family:"Cairo",system-ui,sans-serif;' +
        'box-shadow:0 40px 90px rgba(0,0,0,.4);transition:opacity .25s,transform .25s;}' +
      '.skab.on{opacity:1;transform:translate(-50%,-50%);pointer-events:auto;}' +
      '.skab__x{position:absolute;top:12px;inset-inline-end:14px;border:0;background:#eef2f2;width:32px;height:32px;border-radius:9px;font-size:1.2rem;color:#14343a;cursor:pointer;line-height:1;}' +
      '.skab__thumbs{display:flex;gap:8px;margin-bottom:6px;}' +
      '.skab__thumbs img{width:52px;height:52px;border-radius:11px;object-fit:cover;border:1px solid rgba(20,52,58,.12);background:#f0f4f4;}' +
      '.skab h2{margin:6px 0 6px;font-size:1.25rem;font-weight:900;color:#14343a;}' +
      '.skab p{margin:0 0 16px;color:#5b6b6e;font-weight:600;font-size:.92rem;line-height:1.7;}' +
      '.skab__row{display:flex;gap:10px;}' +
      '.skab__btn{flex:1;border:0;border-radius:12px;padding:13px;font-weight:800;font-size:.92rem;cursor:pointer;font-family:inherit;}' +
      '.skab__btn--primary{color:#fff;background:linear-gradient(180deg,#e0982a,#c97b12);box-shadow:0 10px 22px rgba(201,123,18,.3);}' +
      '.skab__btn--ghost{background:#eef2f2;color:#14343a;}' +
      '.skab__reasons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}' +
      '.skab__chip{border:1.5px solid rgba(46,126,136,.3);background:#fff;color:#28464b;border-radius:999px;padding:8px 13px;font-weight:700;font-size:.83rem;cursor:pointer;font-family:inherit;transition:all .15s;}' +
      '.skab__chip:hover{border-color:#2e7e88;}' +
      '.skab__chip.on{background:#2e7e88;color:#fff;border-color:#2e7e88;}' +
      '.skab__note{width:100%;border:1.5px solid rgba(46,126,136,.3);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:.9rem;font-weight:600;resize:vertical;margin-bottom:12px;outline:none;}' +
      '.skab__note:focus{border-color:#2e7e88;}' +
      '@media (prefers-reduced-motion:reduce){.skab-scrim,.skab{transition:none;}}';
    document.head.appendChild(s);
  }

  /* Keep the idle clock fresh on every cart change, and re-check on load + timer. */
  document.addEventListener('sk-cart-change', function () { skTrack.cartTouched(); });
  function boot() {
    if (cart().length && !(+read(TOUCH_KEY, 0))) skTrack.cartTouched();
    setTimeout(maybePrompt, 4000);          // give the page a moment to settle
    setInterval(maybePrompt, 60 * 1000);    // and check once a minute thereafter
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
