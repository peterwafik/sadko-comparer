/* ============================================================================
   SADKO buying guides — index + article reader, driven entirely by
   data/guides.json. Adding an article means adding a record to that file:
   nothing here and nothing in guides.html needs to change.
   ----------------------------------------------------------------------------
   Two exports:
     window.mountGuides(rootEl)   the page (index, filters, article view)
     window.skGuides.forCategory(categoryId) -> Promise<[{slug,title,dek,…}]>
                                  so product/category pages can embed
                                  "اقرأ أيضاً" links without loading this page.

   Notes on the data contract (see data/guides.json):
     article = { id, slug, title{ar,en}, dek{ar,en}, minutes, tags[],
                 categoryIds[], body:[block] }
     block   = {type:"p"|"h", ar, en}
             | {type:"ul", ar:[…], en:[…]}
             | {type:"table", head:[{ar,en}], rows:[[{ar,en}]]}
             | {type:"tip"|"warn", ar, en}
     Tag labels live in the file's top-level `tags` map, so a new tag is
     still a JSON-only change.
   ========================================================================== */
(function () {
  'use strict';

  /* Path helper that does not depend on skApp — skGuides is meant to be
     callable from /category/*.html too, before or without the app shell. */
  const ROOT = /\/category\//.test(location.pathname);
  const P = p => (ROOT ? '../' : '') + p;

  const A = () => window.skApp || null;
  const EN = () => !!(window.skLang && window.skLang.get() === 'en');
  const t = (ar, en) => (A() ? A().t(ar, en) : (EN() ? en : ar));
  const esc = s => (A() ? A().esc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const num = n => (A() ? A().num(n) : String(n));
  // Pick the ar/en side of a data field.
  const L = v => (v && typeof v === 'object') ? t(v.ar, v.en) : (v == null ? '' : v);

  /* ================= data ================= */

  let _cache = null;
  function load() {
    if (_cache) return _cache;
    _cache = fetch(P('data/guides.json'))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => ({ articles: Array.isArray(d.articles) ? d.articles : [], tags: d.tags || {} }))
      .catch(() => ({ articles: [], tags: {} }));
    return _cache;
  }

  const hrefFor = slug => P('guides.html') + '?g=' + encodeURIComponent(slug);
  const hasCat = (a, cid) => (a.categoryIds || []).some(c => String(c) === String(cid));

  /* Public helper: up to 3 guides relevant to a category. Cached, and safe to
     call from any page — it only needs fetch. */
  function forCategory(categoryId, limit) {
    const n = Math.max(1, Math.min(Number(limit) || 3, 10));
    return load().then(d => d.articles.filter(a => hasCat(a, categoryId)).slice(0, n).map(a => ({
      slug: a.slug,
      title: a.title,          // {ar,en} — render with skApp.t(g.title.ar, g.title.en)
      dek: a.dek,              // {ar,en}
      minutes: a.minutes,
      tags: (a.tags || []).slice(),
      href: hrefFor(a.slug)
    })));
  }
  function all() { return load().then(d => d.articles.slice()); }
  function bySlug(slug) { return load().then(d => d.articles.find(a => a.slug === slug) || null); }

  window.skGuides = { forCategory, all, bySlug, href: hrefFor };

  /* ================= page ================= */

  function mountGuides(root) {
    if (!root) return;
    let DATA = { articles: [], tags: {} };
    let activeTag = null;                                  // null = all

    const param = k => {
      const v = new URLSearchParams(location.search).get(k);
      return v == null ? '' : v;
    };

    /* One delegated listener for the whole page: survives every re-render, so
       links stay soft-navigating even after the list is filtered and rebuilt. */
    root.addEventListener('click', onClick);

    load().then(d => {
      DATA = d;
      render();
      window.addEventListener('popstate', render);
    });

    /* ---------- router ---------- */
    function render() {
      const slug = param('g');
      const art = slug ? DATA.articles.find(a => a.slug === slug) : null;
      if (slug && !art) { root.innerHTML = notFound(slug); return; }
      if (art) { root.innerHTML = article(art); document.title = L(art.title) + ' — ' + t('صادكو جروب', 'SADKO Group'); }
      else { root.innerHTML = index(); document.title = t('أدلة الشراء — صادكو جروب', 'Buying guides — SADKO Group'); }
      root.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function go(url) {
      history.pushState({}, '', url);
      render();
    }

    function onClick(e) {
      const el = e.target && e.target.closest ? e.target : null;
      if (!el) return;

      // <a data-nav> — same-page navigation, real href kept for middle-click,
      // new-tab and copy-link.
      const a = el.closest('a[data-nav]');
      if (a) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        go(a.getAttribute('href'));
        return;
      }

      // tag filter chips
      const b = el.closest('[data-tag]');
      if (b) { setTag(b.getAttribute('data-tag')); }
    }

    function setTag(v) {
      activeTag = (v === '*' || v === activeTag) ? null : v;
      const host = root.querySelector('[data-list]');
      if (host) host.innerHTML = cards(visible());
      root.querySelectorAll('[data-tag]').forEach(x => {
        const on = (x.getAttribute('data-tag') === (activeTag || '*'));
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
        x.className = 'chip' + (on ? '' : ' chip--mute');
      });
      const c = root.querySelector('[data-count]');
      if (c) c.textContent = countLabel(visible().length);
    }

    const visible = () => (activeTag ? DATA.articles.filter(a => (a.tags || []).indexOf(activeTag) >= 0) : DATA.articles);
    const countLabel = n => (n === 1 ? t('دليل واحد', '1 guide') : t(num(n) + ' أدلة', num(n) + ' guides'));

    /* ---------- index ---------- */
    function index() {
      const tagKeys = [];
      DATA.articles.forEach(a => (a.tags || []).forEach(k => { if (tagKeys.indexOf(k) < 0) tagKeys.push(k); }));
      const tagName = k => (DATA.tags[k] ? L(DATA.tags[k]) : k);

      // The active tag survives navigating into an article and back.
      if (activeTag && tagKeys.indexOf(activeTag) < 0) activeTag = null;
      const chip = (key, label) => {
        const on = (key === '*') ? !activeTag : (key === activeTag);
        return '<button type="button" class="chip' + (on ? '' : ' chip--mute') + '" data-tag="' + esc(key) +
          '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>';
      };
      const chips =
        '<div class="chips" role="group" aria-label="' + esc(t('تصفية حسب الموضوع', 'Filter by topic')) + '">' +
        chip('*', t('الكل', 'All')) +
        tagKeys.map(k => chip(k, tagName(k))).join('') +
        '</div>';

      return crossLinks() +
        '<section class="panel">' +
          '<div class="between">' +
            '<div><h2 class="panel__h">' + esc(t('كل الأدلة', 'All guides')) + '</h2>' +
            '<p class="panel__sub" style="margin-bottom:0">' + esc(t(
              'شرح عملى بلغة ميسّرة: مقاسات، وكفاءة طاقة، وضمان، وتركيب، وصيانة. ولا ترشيح لطُرُز هنا — بل الأساس الذى يمكّنك من الاختيار بنفسك.',
              'Practical explanations in plain language: sizing, energy efficiency, warranty, installation and maintenance. No model recommendations here — just the basics that let you decide for yourself.'
            )) + '</p></div>' +
            '<span class="badge" data-count>' + esc(countLabel(visible().length)) + '</span>' +
          '</div>' +
          '<div class="mt16">' + chips + '</div>' +
          '<div class="grid3 mt24" data-list>' + cards(visible()) + '</div>' +
        '</section>' +
        '<div class="note note--soft mt16">' + esc(t(
          'هذه الأدلة معلومات عامة تساعدك على طرح الأسئلة الصحيحة. والأرقام الموصوفة بأنها تقريبية قواعد إرشادية، والرقم الرسمى لأى جهاز مذكور فى دليله أو على ملصقه.',
          'These guides are general information to help you ask the right questions. Any figure described as approximate is a rule of thumb; the official number for a given appliance is in its manual or on its label.'
        )) + '</div>';
    }

    function cards(list) {
      if (!list.length) {
        return '<div class="empty"><p>' + esc(t('لا توجد أدلة فى هذا الموضوع بعد.', 'No guides on this topic yet.')) + '</p></div>';
      }
      return list.map(a =>
        '<article class="panel" style="display:flex;flex-direction:column;gap:10px">' +
          '<div class="chips">' +
            (a.tags || []).slice(0, 3).map(k =>
              '<span class="chip chip--mute">' + esc(DATA.tags[k] ? L(DATA.tags[k]) : k) + '</span>').join('') +
          '</div>' +
          '<h3 style="margin:0;font-size:1.02rem;line-height:1.5">' +
            '<a data-nav href="' + esc(hrefFor(a.slug)) + '" style="text-decoration:none">' + esc(L(a.title)) + '</a>' +
          '</h3>' +
          '<p class="muted small" style="margin:0;line-height:1.75">' + esc(L(a.dek)) + '</p>' +
          '<div class="between" style="margin-top:auto">' +
            '<span class="muted small">' + esc(mins(a.minutes)) + '</span>' +
            '<a class="btn btn--ghost btn--sm" data-nav href="' + esc(hrefFor(a.slug)) + '">' +
              esc(t('اقرأ الدليل', 'Read guide')) + '</a>' +
          '</div>' +
        '</article>').join('');
    }

    const mins = m => t(num(m) + ' دقائق قراءة', m + ' min read');

    /* "دليل مناسب لك" — shown on the index when a category page linked here. */
    function crossLinks() {
      const cid = param('cat');
      if (!cid) return '';
      const list = DATA.articles.filter(a => hasCat(a, cid)).slice(0, 3);
      if (!list.length) return '';
      const nm = A() ? A().catName(cid) : '';
      return '<section class="panel" style="border-color:color-mix(in srgb, var(--accent) 32%, transparent)">' +
        '<h2 class="panel__h">' + esc(t('دليل مناسب لك', 'A guide for you')) +
          (nm ? ' <span class="badge">' + esc(nm) + '</span>' : '') + '</h2>' +
        '<p class="panel__sub">' + esc(t('اخترنا لك الأدلة المتصلة مباشرةً بالفئة التى تتصفحها.',
          'These guides relate directly to the category you were browsing.')) + '</p>' +
        '<ul class="specs">' + list.map(a =>
          '<li><span class="k"><a data-nav href="' + esc(hrefFor(a.slug)) + '">' + esc(L(a.title)) + '</a></span>' +
          '<span class="v">' + esc(mins(a.minutes)) + '</span></li>').join('') + '</ul>' +
        (A() ? '<div class="row mt16" style="justify-content:flex-start">' +
          '<a class="btn btn--teal btn--sm" style="flex:0 0 auto" href="' + esc(A().catHref(cid)) + '">' +
          esc(t('العودة إلى ', 'Back to ') + nm) + '</a></div>' : '') +
        '</section>';
    }

    /* ---------- article ---------- */
    function article(a) {
      return '<nav class="between mt8" aria-label="' + esc(t('تنقّل', 'Navigation')) + '">' +
          '<a class="btn btn--quiet btn--sm" data-nav href="' + esc(P('guides.html')) + '">' +
            esc(t('كل الأدلة →', '← All guides')) + '</a>' +
          '<span class="muted small">' + esc(mins(a.minutes)) + '</span>' +
        '</nav>' +
        '<article class="panel mt16 g-art">' +
          '<div class="chips">' + (a.tags || []).map(k =>
            '<span class="chip chip--mute">' + esc(DATA.tags[k] ? L(DATA.tags[k]) : k) + '</span>').join('') + '</div>' +
          '<h2 class="g-title">' + esc(L(a.title)) + '</h2>' +
          '<p class="g-dek">' + esc(L(a.dek)) + '</p>' +
          (a.body || []).map(block).join('') +
        '</article>' +
        actions(a) +
        '<div class="mt16"><a class="btn btn--quiet btn--sm" data-nav href="' + esc(P('guides.html')) + '">' +
          esc(t('كل الأدلة →', '← All guides')) + '</a></div>';
    }

    function block(b) {
      if (!b || !b.type) return '';
      switch (b.type) {
        case 'h':
          return '<h3 class="g-h">' + esc(L(b)) + '</h3>';
        case 'p':
          return '<p class="g-p">' + esc(L(b)) + '</p>';
        case 'ul': {
          const items = (EN() ? b.en : b.ar) || b.ar || [];
          return '<ul class="g-ul">' + items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
        }
        case 'table': {
          const head = (b.head || []).map(c => '<th scope="col">' + esc(L(c)) + '</th>').join('');
          const rows = (b.rows || []).map(r =>
            '<tr>' + r.map((c, i) => (i === 0
              ? '<th scope="row" style="font-weight:800;color:inherit;text-transform:none;letter-spacing:0">' + esc(L(c)) + '</th>'
              : '<td>' + esc(L(c)) + '</td>')).join('') + '</tr>').join('');
          return '<div class="g-tblwrap"><table class="tbl tbl--rows">' +
            (head ? '<thead><tr>' + head + '</tr></thead>' : '') +
            '<tbody>' + rows + '</tbody></table></div>';
        }
        case 'tip':
          return '<div class="note note--info mt16"><strong>' + esc(t('نصيحة', 'Tip')) + ':</strong> ' + esc(L(b)) + '</div>';
        case 'warn':
          return '<div class="note note--warn mt16"><strong>' + esc(t('انتبه', 'Careful')) + ':</strong> ' + esc(L(b)) + '</div>';
        default:
          return '';
      }
    }

    /* Every article ends here: the guide is the start of a decision, not the end. */
    function actions(a) {
      const cats = (a.categoryIds || []).filter(c => !A() || A().CATS[String(c)]);
      const first = cats[0] || '';
      const btns = [];
      btns.push(['btn--primary', t('ساعدنى أختار', 'Help me choose'),
        P('finder.html') + (first ? '?cat=' + encodeURIComponent(first) : '')]);
      cats.slice(0, 2).forEach(c => {
        if (!A()) return;
        btns.push(['btn--teal', t('اطّلع على ', 'Browse ') + A().catName(c), A().catHref(c)]);
      });
      btns.push(['btn--ghost', t('قارن الأسعار', 'Compare prices'), P('compare.html')]);
      btns.push(['btn--ghost', t('خطط التجهيز', 'Shopping plans'), P('plan.html')]);

      return '<section class="panel mt16">' +
        '<h3 class="panel__h">' + esc(t('الخطوة التالية', 'Your next step')) + '</h3>' +
        '<p class="panel__sub">' + esc(t(
          'طبّق ما قرأته على الكتالوج: رشّح جهازاً على مقاسك، أو تصفّح الفئة، أو قارن الطراز نفسه لدى أكثر من بائع.',
          'Take what you just read into the catalogue: get a shortlist for your home, browse the category, or compare the same model across sellers.'
        )) + '</p>' +
        '<div class="chips">' + btns.map(b =>
          '<a class="btn ' + b[0] + ' btn--sm" href="' + esc(b[2]) + '">' + esc(b[1]) + '</a>').join('') + '</div>' +
        '</section>';
    }

    function notFound(slug) {
      const msg = t('لا يوجد دليل بهذا الاسم: ', 'No guide found with that name: ') + slug;
      return (A() ? A().empty(msg, t('كل الأدلة', 'All guides'), P('guides.html'))
        : '<div class="empty"><p>' + esc(msg) + '</p></div>');
    }
  }

  window.mountGuides = mountGuides;
})();
