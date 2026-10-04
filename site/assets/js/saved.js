/* ============================================================================
   SADKO saved products — a shortlist you can come back to, plus an honest
   price watch.
   ----------------------------------------------------------------------------
   What this genuinely does: remembers the price a product had when you saved it
   and tells you what changed since, on this device. What it deliberately does
   NOT do: promise to email or push you when a price drops. Real alerting needs
   an account and a server-side job that re-checks offers — this site has
   neither, and claiming otherwise would be exactly the kind of false urgency
   the brief warns against. So the target price is stored as YOUR reminder, and
   the page says plainly when it was last checked and by what.
   ========================================================================== */
(function () {
  'use strict';

  function mountSaved(root) {
    const A = window.skApp, t = A.t, esc = A.esc, St = window.skStore;

    function render() {
      const list = St.saved.all();
      if (!list.length) {
        root.innerHTML =
          '<div class="panel">' + A.empty(
            t('لا توجد منتجات محفوظة بعد. احفظ ما تفكر فيه لتقارنه على مهلك وتعود إليه لاحقاً.',
              'Nothing saved yet. Save the products you are weighing up so you can compare them and come back later.'),
            t('ابدأ من ساعدنى أختار', 'Start with Help me choose'), A.P('finder.html')) + '</div>';
        return;
      }
      A.products().then(all => {
        const byId = {}; all.forEach(p => { byId[String(p.id)] = p; });
        root.innerHTML =
          '<div class="between"><h2 class="panel__h" style="font-size:1.2rem">' +
            t('المنتجات المحفوظة', 'Saved products') + ' <span class="badge">' + A.num(list.length) + '</span></h2>' +
            '<button class="btn btn--quiet btn--sm" id="clearAll">' + t('امسح الكل', 'Clear all') + '</button></div>' +
          '<div class="note note--soft small mt8">' + esc(St.scopeNote()) + ' ' +
            t('نقارن السعر الحالى فى الكتالوج بالسعر وقت حفظك للمنتج. ولمعرفة عروض المتاجر الأخرى، استخدم مقارنة الأسعار.',
              'We compare the current catalogue price with the price when you saved it. To see other stores\' offers, use price comparison.') + '</div>' +
          '<div class="grid3 mt16">' + list.map(s => card(s, byId[s.id])).join('') + '</div>';
        wire();
      });
    }

    function card(s, live) {
      const now = live ? live.price : null;
      const was = s.priceAtSave;
      const diff = (now != null && was != null) ? now - was : null;
      let badge = '';
      if (diff != null && diff < 0) badge = '<span class="chip chip--ok">' + t('نزل ', 'Down ') + A.money(-diff) + '</span>';
      else if (diff != null && diff > 0) badge = '<span class="chip chip--warn">' + t('زاد ', 'Up ') + A.money(diff) + '</span>';
      else if (diff === 0) badge = '<span class="chip chip--mute">' + t('السعر كما هو', 'Unchanged') + '</span>';
      else badge = '<span class="chip chip--mute">' + t('غير موجود فى الكتالوج حالياً', 'Not in the catalogue now') + '</span>';

      const hitTarget = (s.targetPrice && now != null && now <= s.targetPrice);

      return '<article class="pcard">' +
        '<div class="pcard__img"><img loading="lazy" src="' + esc(s.image) + '" alt=""></div>' +
        '<div class="pcard__b">' +
          // Titles are stored verbatim from the catalogue, which carries HTML
          // entities as literal text ("كولدير&nbsp;2 حنفية"), so esc() alone rendered
          // the entity on the card. skShopUI.clean() decodes it when storefront.js is
          // present; the &nbsp; fallback matches what line 66 below already does.
          '<h3 class="pcard__t">' + esc(window.skShopUI && window.skShopUI.clean
            ? window.skShopUI.clean(s.title)
            : String(s.title == null ? '' : s.title).replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')) + '</h3>' +
          '<div class="between"><span class="pcard__p">' + A.money(now != null ? now : was) + '</span>' + badge + '</div>' +
          (hitTarget ? '<div class="note note--info small">' + t('بلغ السعر الذى حددته (', 'It reached your target price (') + A.money(s.targetPrice) + ').</div>' : '') +
          '<label class="field small" style="margin:0"><span class="field__l">' + t('نبّهنى إذا انخفض عن', 'Remind me if it drops below') + '</span>' +
            '<input class="input" type="number" inputmode="numeric" min="0" step="100" data-target="' + esc(s.id) + '" value="' + (s.targetPrice || '') + '" placeholder="' + t('السعر الذى يناسبك', 'your price') + '">' +
            '<span class="field__hint">' + t('تذكير لك على هذا الجهاز، ولا نرسل بريداً إلكترونياً ولا إشعاراً.', 'A reminder for you on this device. We do not send email or push notifications.') + '</span></label>' +
          '<div class="pcard__row">' +
            '<a class="btn btn--teal btn--sm" href="' + A.P('product.html') + '?id=' + encodeURIComponent(s.id) + '">' + t('التفاصيل', 'Details') + '</a>' +
            '<a class="btn btn--ghost btn--sm" href="' + A.P('compare.html') + '?q=' + encodeURIComponent(String(s.title).replace(/&nbsp;/g, ' ').slice(0, 60)) + '">' + t('قارن', 'Compare') + '</a>' +
            '<a class="btn btn--ghost btn--sm" href="' + A.P('plan.html') + '?add=' + encodeURIComponent(s.id) + '">' + t('لخطة', 'To a plan') + '</a>' +
            // btn--icon: the actions in a .pcard__row share the width evenly, which is
            // right for the three labelled links but stretched this one glyph to 239px.
            '<button class="btn btn--quiet btn--sm btn--icon" data-rm="' + esc(s.id) + '" aria-label="' + t('شيل من المحفوظات', 'Remove from saved') + '">✕</button>' +
          '</div>' +
        '</div></article>';
    }

    function wire() {
      root.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { St.saved.remove(b.getAttribute('data-rm')); render(); }));
      root.querySelectorAll('[data-target]').forEach(i => i.addEventListener('change', () => { St.saved.setTarget(i.getAttribute('data-target'), i.value); render(); }));
      const c = root.querySelector('#clearAll');
      c && c.addEventListener('click', () => {
        if (confirm(t('تمسح كل المنتجات المحفوظة؟', 'Remove every saved product?'))) {
          St.saved.all().forEach(s => St.saved.remove(s.id)); render();
        }
      });
    }

    render();
  }

  window.mountSaved = mountSaved;
})();
