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
      Modern Standard Arabic — the walkthrough was written in broad Egyptian
      colloquial ("اتفسّح", "أوضة", "دوس", "يلّا نتفسّح") which reads as too
      casual for a retailer talking to a customer it has not met yet; the rest
      of the site's own copy keeps that warmer voice.
      Re-openable any time from a floating "؟" help button.
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
    dockAria: 'التنقل السريع بين غرف المنزل',
    dockTitle: l => `اضغط للانتقال مباشرة إلى ${l} — وستضيء كل علامات الأجهزة`,
    dockBtnAria: l => `انتقل إلى ${l} وشاهد كل أجهزتها المتاحة للشراء`,
    helpMark: '؟', helpTitle: 'كيف أستخدم الصفحة؟', helpAria: 'اعرض شرح استخدام الصفحة',
    tourAria: 'شرح استخدام الصفحة', close: 'إغلاق', skip: 'تخطّى الشرح',
    prev: 'السابق', next: 'التالى', done: 'حسنًا، لنبدأ الجولة',
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
  // renderStep() treats a zero-sized target as absent and skips the step, so a
  // selector that matches a hidden element is worse than one that matches
  // nothing — it silently costs a step. Resolve to an element only if it is
  // actually on screen, which lets a step fall back down a chain of candidates.
  const visibleTarget = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 ? el : null;
  };
  // Read live rather than from a breakpoint constant: this has to stay right
  // when a window is dragged across the breakpoint or a phone is rotated
  // mid-tour, and renderStep() re-runs on resize.
  const strapCollapsed = () => !visibleTarget('.sk-nav__side');

  const STEPS = [
    {
      sel: () => container.querySelector('.sw-hint'),
      title: EN ? 'Explore the home' : 'تجوّل داخل المنزل',
      body: EN
        ? 'Move with your mouse or by swiping your finger on the screen to see every home appliance on display.'
        : 'تجوّل بالماوس أو بسحب إصبعك على الشاشة لمشاهدة كافة الأجهزة الكهربائية المعروضة.',
    },
    {
      sel: () => dock,
      title: EN ? 'Room buttons — the fastest route' : 'أزرار الغرف — أسرع طريق',
      body: EN
        // No longer mentions the side dot rail: index.html passes route:false,
        // so those dots do not exist. A walkthrough that points at absent
        // furniture is the same fault that killed the old step 4.
        ? 'In a hurry? Click any room name here and we drop you on its best view, with every appliance marker in it lit up at once.'
        : 'فى عجلة من أمرك؟ اضغط على اسم أى غرفة هنا لتنتقل مباشرة إلى أفضل لقطة فيها، مع إضاءة كل علامات الأجهزة الموجودة بها فى الوقت نفسه.',
    },
    {
      sel: () => container.querySelector('.hs-layer .hs-group .hs-spot'),
      title: EN ? 'Pulsing markers = shop categories' : 'العلامات النابضة = فئات التسوّق',
      body: EN
        ? 'Every pulsing marker sits on an appliance in the scene. Click one and it opens a page with every product in that category — TVs, air conditioners, refrigerators… and more.'
        : 'كل علامة نابضة تقف فوق جهاز فى المشهد. اضغط على أى علامة لتفتح صفحة تضم كل منتجات هذه الفئة — تليفزيونات، تكييفات، ثلاجات… وغيرها.',
    },
    /* There was a fourth step here describing a per-room «شوف الأجهزة اللى هنا»
       showcase button. That button does not exist: `.hs-scbtn` is never created
       (it survives only as dead CSS in hotspots.js and an unread `showcaseLabel`
       in index.html), so renderStep() found no target and skipped it every time.
       The tour counted "1 / 5" and could never reach five. Removed rather than
       left to skip silently — describing a control the page does not have is
       worse than one step fewer. */
    {
      /* This step points at different furniture depending on the layout, so it
         resolves its target AND its words together.

         Below the desktop breakpoint nav.js collapses .sk-nav__side into the
         hamburger drawer: the hotline, cart, saved and account are not in the
         strap at all, they are behind ☰, with the 19140 link at the foot of the
         drawer. Ringing the hotline there hit a display:none element, which
         renderStep() skips — and skipping the LAST step closes the tour, so
         phone visitors lost this step entirely. Ringing the whole strap instead
         was no better: it highlighted a bar containing none of what the words
         promised. */
      sel: () => strapCollapsed()
        ? (visibleTarget('.sk-burger') || visibleTarget('.sk-nav'))
        : (visibleTarget('.sk-nav__side') || visibleTarget('.sk-hotline') ||
           visibleTarget('.sk-nav') || container.querySelector('.sw-topcta')),
      title: () => EN
        ? (strapCollapsed() ? 'Everything is behind this button' : 'Order any time')
        : (strapCollapsed() ? 'كل الأقسام داخل هذا الزر' : 'اطلب فى أى وقت'),
      body: () => EN
        ? (strapCollapsed()
          ? 'This button opens the menu: the full shop, orders, showrooms and the cart, with the 19140 hotline at the foot of it — tap that to call us directly. Need this walkthrough again? Hit the “?” button.'
          : 'The 19140 hotline is always up top — tap it to call us directly. From the top strap you can open the full shop, orders, showrooms and the cart. Need this walkthrough again? Hit the “?” button.')
        : (strapCollapsed()
          ? 'يفتح لك هذا الزر القائمة: المتجر الكامل والطلبات والمعارض والسلة، والخط الساخن 19140 فى أسفلها — اضغط عليه للاتصال بنا مباشرة. وإذا احتجت هذا الشرح مرة أخرى، اضغط على علامة «؟».'
          : 'الخط الساخن 19140 موجود فى الأعلى دائمًا — اضغط عليه للاتصال بنا مباشرة. ومن الشريط العلوى يمكنك فتح المتجر الكامل والطلبات والمعارض والسلة. وإذا احتجت هذا الشرح مرة أخرى، اضغط على علامة «؟».'),
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
    /* Clamped to the viewport. A target as wide as the screen — the top strap on
       a phone — produced a ring starting at -10px and running 20px past the far
       edge, so the highlight bled off both sides and read as "everything" rather
       than as a control. Clamping keeps the amber outline visible on all four
       sides of whatever is being pointed at. */
    const ring = tour.querySelector('.gd-tour__ring');
    const rl = Math.max(4, r.left - pad), rt = Math.max(4, r.top - pad);
    const rr = Math.min(vw - 4, r.right + pad), rb = Math.min(vh - 4, r.bottom + pad);
    ring.style.left = rl + 'px';
    ring.style.top = rt + 'px';
    ring.style.width = Math.max(0, rr - rl) + 'px';
    ring.style.height = Math.max(0, rb - rt) + 'px';

    tour.querySelector('.gd-tour__step').textContent = `${stepIdx + 1} / ${STEPS.length}`;
    // title/body may be functions: a step whose target moves between layouts
    // (the strap collapsing into the drawer) has to describe what it is
    // actually ringing on THIS screen, not what it rings on a desktop.
    tour.querySelector('h3').textContent = typeof st.title === 'function' ? st.title() : st.title;
    tour.querySelector('p').textContent = typeof st.body === 'function' ? st.body() : st.body;
    tour.querySelector('.gd-tour__prev').style.visibility = stepIdx ? 'visible' : 'hidden';
    tour.querySelector('.gd-tour__next').textContent = stepIdx === STEPS.length - 1 ? G.done : G.next;

    // Place the card near the ring: below it when there's room, else above.
    // offsetWidth forces a synchronous layout of the fresh content, so this
    // needs no async hop (rAF proved unreliable right after programmatic scrolls).
    const card = tour.querySelector('.gd-tour__card');
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let cx = r.left + r.width / 2 - cw / 2;
    // Math.max(12, …) used to win over the right-edge clamp whenever the card
    // was wider than the viewport less its margins, pushing it off-screen
    // instead of merely up against the edge. Centre it in that case.
    cx = cw >= vw - 24 ? Math.max(0, (vw - cw) / 2)
                       : Math.max(12, Math.min(vw - cw - 12, cx));
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
  /* How far the dock floats off the bottom edge. The scroll hint and the coach
     bubble are pinned to the dock rather than to the viewport, so they are
     expressed as this plus their own gap — move the dock and they follow,
     instead of drifting into it the next time this number is tuned. */
  :root{--gd-lift:32px;}
  /* ---- room dock (iOS frosted glass, centred) ---- */
  .gd-dock{position:fixed;left:50%;bottom:calc(var(--gd-lift) + env(safe-area-inset-bottom));transform:translateX(-50%);
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
  .sw-hint{bottom:calc(var(--gd-lift) + 68px + env(safe-area-inset-bottom));}
  @media (min-width:861px){ .hs-coach{bottom:calc(var(--gd-lift) + 72px + env(safe-area-inset-bottom));} }
  @media (max-width:860px){
    .sw-hint{bottom:calc(var(--gd-lift) + 66px + env(safe-area-inset-bottom));}
    .sw-copy{bottom:calc(clamp(120px,18vh,176px) + env(safe-area-inset-bottom));}
  }
  /* Phones name every room, exactly as the desktop bar does. The rule this
     replaces hid every label but the active one, so the bar read as one word
     beside three anonymous numbers — you could see where you WERE and had no
     idea where the other three buttons went.

     Everything here is sized in vw between a floor and a ceiling, so the bar
     holds the same share of the screen across the whole phone range instead of
     being a fixed pixel size that eats a third of a 320px screen and looks
     stranded on a 430px one. The floors are what keeps it legible on the
     narrowest phones still in use; the ceilings stop it outgrowing the desktop
     bar as the viewport approaches the 700px breakpoint. */
  @media (max-width:700px){
    :root{--gd-lift:26px;}
    .gd-dock{gap:clamp(1px,.45vw,4px);padding:clamp(4px,1.1vw,7px);max-width:98vw;}
    .gd-dock__btn{font-size:clamp(8.5px,2.45vw,12.5px);gap:clamp(3px,1.1vw,7px);
      padding:clamp(5px,1.5vw,9px) clamp(6px,1.9vw,11px);}
    .gd-dock__btn em{width:clamp(13px,3.5vw,18px);height:clamp(13px,3.5vw,18px);
      font-size:clamp(7px,1.9vw,10px);}
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
  /* box-sizing is explicit because index.html loads no global reset (app.css and
     category.css carry one; the home page carries neither). Without it the 20px
     side padding sat OUTSIDE the width, so the card measured 390px and hung off
     the right edge of every phone narrower than 414px. */
  .gd-tour__card{position:absolute;box-sizing:border-box;width:min(88vw,350px);direction:rtl;text-align:right;
    background:#fff;color:var(--sw-ink,#14343a);border-radius:18px;padding:18px 20px 16px;
    box-shadow:0 24px 60px rgba(7,22,26,.45);font-family:var(--sw-font-display,inherit);
    transition:left .45s cubic-bezier(.22,.8,.24,1),top .45s cubic-bezier(.22,.8,.24,1);}
  .gd-tour__step{display:inline-block;direction:ltr;font:800 .72rem/1 ui-monospace,Menlo,monospace;color:#fff;
    background:var(--sw-accent,#2e7e88);border-radius:999px;padding:5px 10px;}
  .gd-tour__card h3{margin:10px 0 6px;font-size:1.15rem;font-weight:800;line-height:1.35;}
  .gd-tour__card p{margin:0;font-size:.9rem;line-height:1.7;color:#3f5457;}
  /* nowrap on the controls, wrap on the row: the last step's button reads
     "حسنًا، لنبدأ الجولة", which broke across two lines inside its own pill on a
     narrow card and left the footer looking collapsed. Breaking BETWEEN
     controls is fine; breaking a button's label is not. */
  .gd-tour__row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;flex-wrap:wrap;}
  .gd-tour__row>div{display:flex;gap:8px;}
  .gd-tour__next,.gd-tour__prev,.gd-tour__skip{white-space:nowrap;}
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
  /* On a phone the card is ~346px wide, ~306px of it usable. Skip + Back +
     "حسنًا، لنبدأ الجولة" measure past that at the desktop sizes, so the row is
     tightened just enough to keep all three on one line. */
  @media (max-width:430px){
    .gd-tour__card{padding:16px 16px 14px;}
    .gd-tour__card h3{font-size:1.06rem;}
    .gd-tour__card p{font-size:.86rem;line-height:1.65;}
    .gd-tour__next{padding:9px 13px;font-size:.84rem;}
    .gd-tour__prev{padding:8px 12px;font-size:.82rem;}
    .gd-tour__skip{font-size:.78rem;}
  }
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
