/* ============================================================================
   SADKO guide — clear navigation + onboarding over the scroll-world.
   ----------------------------------------------------------------------------
   Mount AFTER mountScrollWorld and mountHotspots:
     mountGuide(container, api, sections)

   WHAT IT ADDS
   1. ROOM DOCK — a floating, always-visible bar of labeled buttons (one per
      room). Clicking a button glides the camera to that room's `showcase`
      frame — the designed stopping view — and lights every appliance marker
      of the room at once (via api.enterShowcase from hotspots.js). Scrolling
      keeps working exactly as before; the dock is a parallel fast lane.
      The active room is highlighted as you scroll; while a showcase view is
      held, the active button glows amber.
   2. NAV REWIRE — the engine's top nav items and route-rail dots are extended
      so they too land on the room's showcase view (their original mid-scene
      jump fires first, our showcase glide supersedes it in the same click).
   3. GUIDED TOUR — a first-visit spotlight walkthrough of the home page:
      dims the page, rings each control (scroll, dock, appliance markers,
      the per-room showcase button, the hotline CTA) and explains it in
      Egyptian Arabic. Re-openable any time from a floating "؟" help button.
      Stored under localStorage 'sadko-guide-v1'; suppressed with ?spots.
   ========================================================================== */

function mountGuide(container, api, sections) {
  const GUIDE_KEY = 'sadko-guide-v1';
  const COACH_KEY = 'sadko-hs-coach-v1';   // hotspots.js coach toast — the tour covers it

  const EN = !!(window.skLang && window.skLang.get() === 'en');
  const G = EN ? {
    dockAria: 'Quick navigation between the rooms of the house',
    dockTitle: l => `Jump straight to the ${l} — every appliance marker lights up`,
    dockBtnAria: l => `Go to the ${l} and see all its shoppable appliances`,
    helpMark: '?', helpTitle: 'How do I use this page?', helpAria: 'Show the page walkthrough',
    tourAria: 'Page walkthrough', close: 'Close', skip: 'Skip the tour',
    prev: 'Back', next: 'Next', done: 'Great, let’s explore',
  } : {
    dockAria: 'التنقل السريع بين أوض البيت',
    dockTitle: l => `اضغط تروح ${l} على طول — وكل علامات الأجهزة هتنوّر`,
    dockBtnAria: l => `روح لـ${l} وشوف كل أجهزتها القابلة للتسوّق`,
    helpMark: '؟', helpTitle: 'إزاى أستخدم الصفحة؟', helpAria: 'اعرض شرح استخدام الصفحة',
    tourAria: 'شرح استخدام الصفحة', close: 'إغلاق', skip: 'تخطّى الشرح',
    prev: 'السابق', next: 'التالى', done: 'تمام، يلّا نتفسّح',
  };

  injectGuideCSS();

  /* ---------------- room dock ---------------- */
  const dock = document.createElement('nav');
  dock.className = 'gd-dock';
  dock.setAttribute('aria-label', G.dockAria);
  const dockBtns = sections.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gd-dock__btn';
    b.innerHTML = `<em>${i + 1}</em><span>${escg(s.label || '')}</span>`;
    b.title = G.dockTitle(s.label);
    b.setAttribute('aria-label', G.dockBtnAria(s.label));
    // A section may be a LINK rather than a room: the last one hands off to the
    // shop instead of framing a scene, so its button navigates. Everything else
    // still glides the camera to that room's showcase frame.
    b.addEventListener('click', () => {
      if (s.href) { window.location.href = s.href; return; }
      if (api.enterShowcase) api.enterShowcase(i);
    });
    dock.appendChild(b);
    return b;
  });
  container.appendChild(dock);

  /* ---------------- help (؟) button ---------------- */
  const help = document.createElement('button');
  help.type = 'button';
  help.className = 'gd-help';
  help.textContent = G.helpMark;
  help.title = G.helpTitle;
  help.setAttribute('aria-label', G.helpAria);
  help.addEventListener('click', () => openTour());
  container.appendChild(help);

  /* ---- active-room highlight, synced to the engine's scroll frame ---- */
  const hsLayer = container.querySelector('.hs-layer');
  container.addEventListener('sw:frame', e => {
    const y = e.detail.y;
    let act = 0;
    sections.forEach((s, i) => { if (s._seg && y >= s._seg.start - 1) act = i; });
    dockBtns.forEach((b, i) => {
      b.classList.toggle('is-active', i === act);
      if (i === act) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    dock.classList.toggle('is-showcase', !!(hsLayer && hsLayer.classList.contains('hs-layer--showcase')));
  });

  /* ---- rewire the engine's own nav to land on the showcase views ----
     Their original listener (mid-scene jump) fires first in the same click;
     enterShowcase's scrollTo runs after and supersedes it. */
  container.querySelectorAll('.sw-nav__item').forEach((b, i) =>
    b.addEventListener('click', () => { if (api.enterShowcase) api.enterShowcase(i); }));
  container.querySelectorAll('.sw-route__dot').forEach((d, i) =>
    d.addEventListener('click', () => { if (api.enterShowcase) api.enterShowcase(i); }));

  /* ---------------- guided tour ---------------- */
  const STEPS = [
    {
      sel: () => container.querySelector('.sw-hint'),
      title: EN ? 'Explore by scrolling' : 'اتفسّح بالسكرول',
      body: EN
        ? 'Scroll with your mouse or swipe with your finger — the camera flies you through the SADKO house, room after room, from the living room to the showroom.'
        : 'اسكرول بالماوس أو اسحب بصباعك — الكاميرا هتطير بيك جوه بيت صادكو، أوضة ورا أوضة، من غرفة المعيشة لحد صالة العروض.',
    },
    {
      sel: () => dock,
      title: EN ? 'Room buttons — the fastest route' : 'أزرار الأوض — أسرع طريق',
      body: EN
        ? 'In a hurry? Click any room name here and we drop you on its best view, with every appliance marker in it lit up at once. The dots on the side of the screen do the same.'
        : 'مستعجل؟ اضغط على اسم أى أوضة هنا وهنوقّفك على أحسن لقطة فيها، وكل علامات الأجهزة اللى فيها هتنوّر مرة واحدة. النقط اللى على جنب الشاشة بتعمل نفس الحاجة.',
    },
    {
      sel: () => container.querySelector('.hs-layer .hs-group .hs-spot'),
      title: EN ? 'Pulsing markers = shop categories' : 'العلامات النابضة = فئات تسوّق',
      body: EN
        ? 'Every pulsing marker sits on an appliance in the scene. Click one and it opens a page with every product in that category — TVs, air conditioners, refrigerators… and more.'
        : 'كل علامة نابضة واقفة فوق جهاز فى المشهد. اضغط على أى علامة يفتح لك صفحة فيها كل منتجات الفئة دى — تليفزيونات، تكييفات، ثلاجات… إلخ.',
    },
    {
      sel: () => container.querySelector('.hs-scbtn'),
      title: EN ? 'The “See the appliances here” button' : 'زرار «شوف الأجهزة اللى هنا»',
      body: EN
        ? 'It lives inside each room’s copy — it lights all the room’s markers together so you can see everything shoppable in one glance.'
        : 'موجود جوه كلام كل أوضة — بينوّر كل علامات الأوضة مع بعض عشان تشوف كل اللى ينفع تتسوّقه منها فى لقطة واحدة.',
    },
    {
      sel: () => document.querySelector('.sk-hotline') || container.querySelector('.sw-topcta'),
      title: EN ? 'Order any time' : 'اطلب فى أى وقت',
      body: EN
        ? 'The 19140 hotline is always up top — tap it to call us directly. From the top strap you can open the full shop, orders, showrooms and the cart. Need this walkthrough again? Hit the “?” button.'
        : 'الخط الساخن 19140 موجود فوق على طول — دوس عليه تتصل بينا مباشرة. ومن الشريط اللى فوق تقدر تفتح المتجر الكامل والطلبات والمعارض والسلة. ولو احتجت الشرح ده تانى، دوس على علامة «؟».',
    },
  ];

  let tour = null, stepIdx = 0;

  function openTour() {
    if (tour) return;
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {}
    // The tour narrates the home (landing) view — make sure we're on it.
    window.scrollTo({ top: 0, behavior: 'auto' });
    stepIdx = 0;
    tour = document.createElement('div');
    tour.className = 'gd-tour';
    tour.innerHTML =
      `<div class="gd-tour__ring"></div>` +
      `<div class="gd-tour__card" role="dialog" aria-modal="true" aria-label="${G.tourAria}">` +
        `<button type="button" class="gd-tour__x" aria-label="${G.close}">&times;</button>` +
        `<span class="gd-tour__step"></span>` +
        `<h3></h3><p></p>` +
        `<div class="gd-tour__row">` +
          `<button type="button" class="gd-tour__skip">${G.skip}</button>` +
          `<div>` +
            `<button type="button" class="gd-tour__prev">${G.prev}</button>` +
            `<button type="button" class="gd-tour__next">${G.next}</button>` +
          `</div>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(tour);

    tour.querySelector('.gd-tour__x').addEventListener('click', closeTour);
    tour.querySelector('.gd-tour__skip').addEventListener('click', closeTour);
    tour.querySelector('.gd-tour__prev').addEventListener('click', () => { if (stepIdx > 0) { stepIdx--; renderStep(); } });
    tour.querySelector('.gd-tour__next').addEventListener('click', nextStep);
    tour.addEventListener('click', e => { if (e.target === tour) nextStep(); });
    document.addEventListener('keydown', onTourKey);
    window.addEventListener('resize', renderStep);

    // Give the engine a beat to settle the landing view (marker opacities are
    // written on the scroll frame) before measuring targets.
    setTimeout(renderStep, 150);
  }

  function nextStep() {
    if (stepIdx < STEPS.length - 1) { stepIdx++; renderStep(); }
    else closeTour();
  }

  function onTourKey(e) {
    const fwd = EN ? 'ArrowRight' : 'ArrowLeft', back = EN ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === 'Escape') closeTour();
    else if (e.key === fwd || e.key === 'Enter') nextStep();
    else if (e.key === back && stepIdx > 0) { stepIdx--; renderStep(); }
  }

  function closeTour() {
    if (!tour) return;
    document.removeEventListener('keydown', onTourKey);
    window.removeEventListener('resize', renderStep);
    tour.classList.add('is-out');
    const t = tour; tour = null;
    setTimeout(() => t.remove(), 320);
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
  }

  function renderStep() {
    if (!tour) return;
    const st = STEPS[stepIdx];
    const target = st.sel();
    const r = target && target.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2) {   // target missing/hidden → skip it
      if (stepIdx < STEPS.length - 1) { stepIdx++; renderStep(); } else closeTour();
      return;
    }
    const pad = 10, vw = window.innerWidth, vh = window.innerHeight;
    const ring = tour.querySelector('.gd-tour__ring');
    ring.style.left = (r.left - pad) + 'px';
    ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + 2 * pad) + 'px';
    ring.style.height = (r.height + 2 * pad) + 'px';

    tour.querySelector('.gd-tour__step').textContent = `${stepIdx + 1} / ${STEPS.length}`;
    tour.querySelector('h3').textContent = st.title;
    tour.querySelector('p').textContent = st.body;
    tour.querySelector('.gd-tour__prev').style.visibility = stepIdx ? 'visible' : 'hidden';
    tour.querySelector('.gd-tour__next').textContent = stepIdx === STEPS.length - 1 ? G.done : G.next;

    // Place the card near the ring: below it when there's room, else above.
    // offsetWidth forces a synchronous layout of the fresh content, so this
    // needs no async hop (rAF proved unreliable right after programmatic scrolls).
    const card = tour.querySelector('.gd-tour__card');
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let cx = r.left + r.width / 2 - cw / 2;
    cx = Math.max(12, Math.min(vw - cw - 12, cx));
    let cy = r.bottom + pad + 16;
    if (cy + ch > vh - 12) cy = r.top - pad - 16 - ch;
    if (cy < 12) cy = Math.max(12, (vh - ch) / 2);
    card.style.left = cx + 'px';
    card.style.top = cy + 'px';
    card.style.visibility = 'visible';
  }

  /* ---- auto-open on first visit (not in hotspot-tuning mode) ---- */
  const params = new URLSearchParams(location.search);
  let seen = false;
  try { seen = !!localStorage.getItem(GUIDE_KEY); } catch (e) {}
  if (!seen && !params.has('spots')) {
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {}   // tour replaces the toast
    setTimeout(openTour, 900);
  }

  function escg(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
}

function injectGuideCSS() {
  if (document.getElementById('gd-css')) return;
  const css = `
  /* ---- room dock (iOS frosted glass, centred) ---- */
  .gd-dock{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);
    z-index:55;display:flex;align-items:center;gap:2px;padding:6px;direction:rtl;max-width:96vw;
    background:rgba(252,251,248,.58);
    -webkit-backdrop-filter:blur(22px) saturate(1.9);backdrop-filter:blur(22px) saturate(1.9);
    border:1px solid rgba(255,255,255,.55);
    border-radius:999px;box-shadow:0 12px 34px rgba(18,42,47,.18), inset 0 1px 0 rgba(255,255,255,.6);}
  .gd-dock__btn{display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;
    font-family:var(--sw-font-display,inherit);font-weight:700;font-size:.85rem;color:#28464b;
    background:transparent;padding:9px 14px;border-radius:999px;white-space:nowrap;
    transition:background .22s,color .22s,transform .18s,box-shadow .22s;}
  .gd-dock__btn em{font-style:normal;direction:ltr;display:grid;place-items:center;width:20px;height:20px;flex:0 0 auto;
    font-size:.72rem;font-weight:800;border-radius:50%;background:rgba(20,52,58,.1);color:#14343a;}
  .gd-dock__btn:hover,.gd-dock__btn:focus-visible{background:rgba(46,126,136,.13);transform:translateY(-1px);}
  .gd-dock__btn.is-active{background:var(--sw-accent,#2e7e88);color:#fff;
    box-shadow:0 4px 14px color-mix(in srgb,var(--sw-accent,#2e7e88) 45%,transparent);}
  .gd-dock__btn.is-active em{background:rgba(255,255,255,.25);color:#fff;}
  .gd-dock.is-showcase .gd-dock__btn.is-active{background:var(--sadko-amber,#fe9800);color:#241a05;}
  .gd-dock.is-showcase .gd-dock__btn.is-active em{background:rgba(255,255,255,.55);color:#241a05;}

  /* ---- help (؟) button ---- */
  .gd-help{position:fixed;right:clamp(14px,2.4vw,30px);bottom:calc(18px + env(safe-area-inset-bottom));z-index:55;
    width:46px;height:46px;border-radius:50%;color:#28464b;cursor:pointer;
    border:1px solid rgba(255,255,255,.55);
    background:rgba(252,251,248,.58);
    -webkit-backdrop-filter:blur(22px) saturate(1.9);backdrop-filter:blur(22px) saturate(1.9);
    font:800 1.15rem/1 var(--sw-font-display,inherit);
    box-shadow:0 12px 34px rgba(18,42,47,.18), inset 0 1px 0 rgba(255,255,255,.6);
    transition:transform .18s,background .22s,color .22s;}
  .gd-help:hover,.gd-help:focus-visible{transform:translateY(-2px);background:var(--sw-accent,#2e7e88);color:#fff;}

  /* ---- make room for the dock in the existing chrome ---- */
  .sw-hint{bottom:calc(84px + env(safe-area-inset-bottom));}
  @media (min-width:861px){ .hs-coach{bottom:calc(88px + env(safe-area-inset-bottom));} }
  @media (max-width:860px){
    .sw-hint{bottom:calc(76px + env(safe-area-inset-bottom));}
    .sw-copy{bottom:calc(clamp(104px,18vh,160px) + env(safe-area-inset-bottom));}
  }
  @media (max-width:700px){
    .gd-dock{gap:2px;padding:6px;bottom:calc(10px + env(safe-area-inset-bottom));}
    .gd-dock__btn{padding:8px 10px;font-size:.78rem;}
    .gd-dock__btn span{display:none;}
    .gd-dock__btn.is-active span{display:inline;}
    /* keep the corner free for the dock: tuck help under the topbar instead */
    .gd-help{width:40px;height:40px;right:10px;bottom:auto;top:calc(72px + env(safe-area-inset-top));}
  }

  /* ---- guided tour ---- */
  .gd-tour{position:fixed;inset:0;z-index:220;animation:gd-in .3s ease;}
  .gd-tour.is-out{opacity:0;transition:opacity .3s ease;}
  @keyframes gd-in{from{opacity:0}to{opacity:1}}
  .gd-tour__ring{position:absolute;border-radius:18px;pointer-events:none;
    box-shadow:0 0 0 9999px rgba(7,22,26,.62),0 0 0 3px var(--sadko-amber,#fe9800),0 0 34px rgba(254,152,0,.45);
    transition:left .45s cubic-bezier(.22,.8,.24,1),top .45s cubic-bezier(.22,.8,.24,1),
      width .45s cubic-bezier(.22,.8,.24,1),height .45s cubic-bezier(.22,.8,.24,1);}
  .gd-tour__card{position:absolute;width:min(88vw,350px);direction:rtl;text-align:right;
    background:#fff;color:var(--sw-ink,#14343a);border-radius:18px;padding:18px 20px 16px;
    box-shadow:0 24px 60px rgba(7,22,26,.45);font-family:var(--sw-font-display,inherit);
    transition:left .45s cubic-bezier(.22,.8,.24,1),top .45s cubic-bezier(.22,.8,.24,1);}
  .gd-tour__step{display:inline-block;direction:ltr;font:800 .72rem/1 ui-monospace,Menlo,monospace;color:#fff;
    background:var(--sw-accent,#2e7e88);border-radius:999px;padding:5px 10px;}
  .gd-tour__card h3{margin:10px 0 6px;font-size:1.15rem;font-weight:800;line-height:1.35;}
  .gd-tour__card p{margin:0;font-size:.9rem;line-height:1.7;color:#3f5457;}
  .gd-tour__row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;}
  .gd-tour__row>div{display:flex;gap:8px;}
  .gd-tour__next{border:0;cursor:pointer;font:700 .88rem var(--sw-font-display,inherit);color:#241a05;
    background:var(--sadko-amber,#fe9800);padding:10px 18px;border-radius:999px;transition:transform .18s;}
  .gd-tour__next:hover{transform:translateY(-2px);}
  .gd-tour__prev{cursor:pointer;font:700 .85rem var(--sw-font-display,inherit);color:var(--sw-ink,#14343a);
    border:1.5px solid color-mix(in srgb,var(--sw-ink,#14343a) 25%,transparent);background:#fff;
    padding:9px 15px;border-radius:999px;}
  .gd-tour__skip{border:0;background:none;cursor:pointer;font:600 .82rem var(--sw-font-display,inherit);
    color:#7c8a8d;text-decoration:underline;padding:6px 2px;}
  .gd-tour__x{position:absolute;top:8px;left:10px;border:0;background:none;font-size:1.4rem;
    color:#9aa7a9;cursor:pointer;padding:2px 6px;}
  .gd-tour__x:hover{color:var(--sw-ink,#14343a);}
  /* English (LTR) page: mirror the rtl-authored pieces */
  html[dir=ltr] .gd-dock{direction:ltr;}
  html[dir=ltr] .gd-tour__card{direction:ltr;text-align:left;}
  html[dir=ltr] .gd-tour__x{left:auto;right:10px;}
  @media (prefers-reduced-motion:reduce){
    .gd-tour__ring,.gd-tour__card{transition:none;}
  }
  `;
  const style = document.createElement('style');
  style.id = 'gd-css';
  style.textContent = css;   // unlayered on purpose — must beat the engine's @layer sw
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') window.mountGuide = mountGuide;
