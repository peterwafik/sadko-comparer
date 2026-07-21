/* ============================================================================
   SADKO hotspots — clickable appliance markers over the scroll-world scenes.
   ----------------------------------------------------------------------------
   Each section may declare:
     hotspots: [{ fx, fy, label, href, at, span, sfx, sfy }]
     showcase: 0.81            // scroll progress of the room's "showcase" frame
     showcaseLabel: '…'        // button text (default provided)
   where fx/fy are fractions (0..1) of the SOURCE 16:9 FRAME (not the viewport).
   `at` (default 0.55) is the scroll progress within the section where this
   marker peaks — anchor it to the moment its appliance is actually framed —
   and `span` (default 0.38) is the fade half-width around it.

   SHOWCASE MODE: every section with a `showcase` progress gets a button in its
   copy panel. Clicking it glides the camera to that frame and lights up ALL of
   the room's markers at once — positioned at sfx/sfy (their coordinates in the
   showcase frame; default fx/fy), labels held open, clicks enabled — so users
   can see everything shoppable in the room. Scrolling away exits showcase and
   markers return to their per-anchor flight behaviour. A one-time coach toast
   explains that markers are clickable category links.
   The module converts frame coords -> screen px, accounting for the engine's
   object-fit: cover crop and its object-position (center 42% desktop / 46%
   mobile / 44% portrait — mirrored here via --sw-objy).

   Markers fade in while the camera is settled mid-scene (same band where the
   copy peaks) and stay clickable only then, so they never fight the flight.

   TUNING MODE: open the page with ?spots — clicking anywhere logs the frame
   coords `{fx, fy}` for that point to the console, so after the real stills
   are generated you can click each appliance and paste the coords back into
   the config.
   ========================================================================== */

function mountHotspots(container, api, sections) {
  const FRAME_W = 16, FRAME_H = 9;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const debug = new URLSearchParams(location.search).has('spots');
  // Flight visibility is capped to a tight half-band around each marker's anchor
  // so a marker fades out the instant scrolling drifts it off its appliance, and
  // only pops back when the appliance is framed again. (Scene spans stay wider
  // for the label/showcase timing; this only governs the dot's on-screen life.)
  const VIS_HALF = 0.15;

  injectHotspotCSS();

  const HS_EN = !!(window.skLang && window.skLang.get() === 'en');

  const layer = document.createElement('div');
  layer.className = 'hs-layer';
  container.appendChild(layer);

  // Build marker groups per section
  const groups = sections.map((s, i) => {
    if (!s.hotspots || !s.hotspots.length) return null;
    const g = document.createElement('div');
    g.className = 'hs-group';
    g.style.setProperty('--hs-accent', s.accent || 'var(--sw-accent)');
    const items = s.hotspots.map((h, k) => {
      const a = document.createElement('a');
      // Labels flip toward frame centre so edge markers never clip offscreen.
      a.className = 'hs-spot' + ((h.sfx ?? h.fx) > 0.5 ? ' hs-spot--flip' : '');
      a.href = h.href || '#';
      a.setAttribute('aria-label', HS_EN ? `Shop the ${h.label} category` : `تسوّق فئة ${h.label}`);
      a.title = HS_EN ? `Click to shop all ${h.label} products` : `اضغط لتسوّق كل منتجات ${h.label}`;
      a.innerHTML = `<i class="hs-spot__dot"></i><span class="hs-spot__label">${esch(h.label)}<i class="hs-spot__go" aria-hidden="true"></i></span>`;
      a.style.transitionDelay = '0ms';
      a.addEventListener('click', dismissCoach);
      g.appendChild(a);
      return { el: a, k, fx: h.fx, fy: h.fy, sfx: h.sfx ?? h.fx, sfy: h.sfy ?? h.fy,
               at: h.at ?? 0.55, span: h.span ?? 0.38 };
    });
    layer.appendChild(g);
    return { el: g, items, si: i, showcase: s.showcase };
  });

  // ---- showcase mode ------------------------------------------------------
  let showSi = -1;                       // section currently in showcase, or -1
  let showArmed = false;                 // exit check only arms once we ARRIVE
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Self-driven camera glide. Native {behavior:'smooth'} scrollTo silently
  // no-ops in some Chrome profiles (and its pacing varies wildly), so we
  // animate scrollTop ourselves. Any real user scroll input cancels it.
  let glideId = 0;
  ['wheel', 'touchstart', 'mousedown'].forEach(ev =>
    window.addEventListener(ev, () => { glideId++; }, { passive: true }));
  function glideTo(top) {
    glideId++;
    const start = window.scrollY || window.pageYOffset, dist = top - start;
    if (reduce || Math.abs(dist) < 2) { window.scrollTo(0, top); return; }
    const dur = Math.min(1600, 500 + Math.abs(dist) * 0.25);
    const t0 = performance.now(), id = glideId;
    const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    (function step() {
      if (id !== glideId) return;                       // superseded or user took over
      const p = Math.min(1, (performance.now() - t0) / dur);
      window.scrollTo(0, start + dist * ease(p));
      if (p < 1) requestAnimationFrame(step);
    })();
  }

  function enterShowcase(si) {
    const s = sections[si], seg = s._seg;
    if (!seg || s.showcase == null) return;
    showSi = si;
    showArmed = false;
    layer.classList.add('hs-layer--showcase');
    groups.forEach(gr => gr && gr.el.classList.toggle('hs-group--showcase', gr.si === si));
    place();
    glideTo(seg.start + (seg.end - seg.start) * s.showcase);
    dismissCoach();
  }
  function exitShowcase() {
    if (showSi < 0) return;
    showSi = -1;
    layer.classList.remove('hs-layer--showcase');
    groups.forEach(gr => gr && gr.el.classList.remove('hs-group--showcase'));
    place();
  }

  const copies = container.querySelectorAll('.sw-copy');

  // A small, always-on-screen eye toggle to show/hide the marker TITLES across
  // every scene. Off by default (dots stay uncluttered, titles on hover); when
  // on, every currently-framed marker shows its label. It never forces a hidden
  // marker open — a spot faded out by the flight band stays hidden.
  let forceLabels = false;
  const EYE_ON = `<svg class="hs-eye__ic" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg class="hs-eye__ic" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.1A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.6M6.2 6.2A16.7 16.7 0 0 0 2 12s3.6 7 10 7a9.5 9.5 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/></svg>`;
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'hs-eye';
  function paintEye() {
    eyeBtn.classList.toggle('is-on', forceLabels);
    eyeBtn.innerHTML = forceLabels ? EYE_ON : EYE_OFF;
    const t = forceLabels
      ? (HS_EN ? 'Hide appliance titles' : 'إخفاء أسماء الأجهزة')
      : (HS_EN ? 'Show appliance titles' : 'إظهار أسماء الأجهزة');
    eyeBtn.setAttribute('aria-label', t); eyeBtn.title = t;
    eyeBtn.setAttribute('aria-pressed', forceLabels ? 'true' : 'false');
    layer.classList.toggle('hs-layer--labels', forceLabels);
  }
  eyeBtn.addEventListener('click', () => { forceLabels = !forceLabels; paintEye(); dismissCoach(); });
  container.appendChild(eyeBtn);
  paintEye();

  // ---- one-time coach toast ----------------------------------------------
  const COACH_KEY = 'sadko-hs-coach-v1';
  let coach = null;
  function dismissCoach() {
    if (!coach) return;
    coach.classList.remove('is-in');
    setTimeout(() => coach && coach.remove(), 400);
    coach = null;
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {}
  }
  function showCoach() {
    try { if (localStorage.getItem(COACH_KEY)) return; } catch (e) {}
    coach = document.createElement('div');
    coach.className = 'hs-coach';
    coach.setAttribute('role', 'status');
    const small = window.matchMedia('(max-width: 600px)').matches;
    const msg = HS_EN
      ? 'The pulsing markers over the appliances are shop categories — click any marker to open a page with all its products. Use the <b>eye button</b> to show or hide their titles.'
      : 'العلامات النابضة فوق الأجهزة فئات تسوّق — اضغط على أى علامة تفتح صفحة كل منتجاتها. واستخدم <b>زرار العين</b> عشان تظهر أو تخفى أسماء الأجهزة.';
    coach.innerHTML =
      `<i class="hs-coach__dot"></i><p>${msg}</p>` +
      `<button type="button" class="hs-coach__x" aria-label="${HS_EN ? 'Close' : 'إغلاق'}">&times;</button>`;
    coach.querySelector('.hs-coach__x').addEventListener('click', dismissCoach);
    document.body.appendChild(coach);
    requestAnimationFrame(() => coach && coach.classList.add('is-in'));
    setTimeout(dismissCoach, 12000);
  }
  setTimeout(showCoach, 1600);

  // --- frame -> screen mapping (mirrors object-fit:cover + object-position) ---
  // Measured against the STAGE box, not window.innerWidth/Height: the fixed
  // stage excludes the scrollbar, and that difference scales with browser
  // zoom — mapping against the window is what made markers drift on zoom
  // and in mobile emulation.
  const stageEl = container.querySelector('.sw-stage') || container;
  function objY() {
    const v = getComputedStyle(container).getPropertyValue('--sw-objy').trim();
    const n = parseFloat(v);
    return isNaN(n) ? 0.42 : n / 100;
  }
  function metrics() {
    const r = stageEl.getBoundingClientRect();
    const s = Math.max(r.width / FRAME_W, r.height / FRAME_H);
    const dw = FRAME_W * s, dh = FRAME_H * s;
    return { r, dw, dh, ox: r.left + (r.width - dw) * 0.5, oy: r.top + (r.height - dh) * objY() };
  }
  function mapPoint(fx, fy, m) {
    m = m || metrics();
    return { x: m.ox + fx * m.dw, y: m.oy + fy * m.dh };
  }
  function unmapPoint(px, py) {
    const m = metrics();
    return { fx: +((px - m.ox) / m.dw).toFixed(3), fy: +((py - m.oy) / m.dh).toFixed(3) };
  }

  function place() {
    const m = metrics();
    const reduceSc = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    groups.forEach(gr => {
      if (!gr) return;
      const seg = sections[gr.si]._seg;
      const sc = gr.si === showSi;
      // Until the clip paints its first frame the engine shows the STILL with a
      // ken-burns transform (translateX((stageX-2)vw) scale(1.03+t*0.14), origin
      // center). Mirror it, or markers sit visibly off on slow loads / mobile.
      let still = null;
      if (seg && seg.el && !seg.el.classList.contains('has-clip')) {
        const local = clamp((lastY - seg.start) / (seg.end - seg.start), 0, 1);
        const stageX = window.innerWidth > 860 ? 4 : 0;
        still = {
          sc: reduceSc ? 1 : 1.03 + local * 0.14,
          tx: (stageX - 2) / 100 * window.innerWidth,
          cx: m.r.left + m.r.width / 2,
          cy: m.r.top + m.r.height / 2,
        };
      }
      gr.items.forEach(it => {
        let p = sc ? mapPoint(it.sfx, it.sfy, m) : mapPoint(it.fx, it.fy, m);
        if (still) p = { x: still.cx + (p.x - still.cx) * still.sc + still.tx,
                         y: still.cy + (p.y - still.cy) * still.sc };
        it.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        it.el.style.transitionDelay = sc ? `${it.k * 70}ms` : '0ms';
      });
    });
  }

  // --- visibility synced to the engine's scroll frame ---
  let lastY = 0;
  container.addEventListener('sw:frame', e => {
    const { y } = e.detail;
    lastY = y;
    // The ACTIVE room: markers live strictly in their own room — even inside the
    // crossfade band only the current room's markers may show, so rooms never
    // bleed markers into each other.
    let act = 0;
    sections.forEach((s, i) => { if (s._seg && y >= s._seg.start) act = i; });
    groups.forEach(gr => {
      if (!gr) return;
      const seg = sections[gr.si]._seg;
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      if (gr.si !== act && gr.si !== showSi) {
        gr.el.style.opacity = 0;
        gr.items.forEach(it => { it.el.style.pointerEvents = 'none'; });
        return;
      }
      if (gr.si === showSi) {
        // Showcase: hold every marker of this room open at its showcase spot.
        // Scrolling meaningfully away hands control back to the flight anchors.
        const sc = sections[gr.si].showcase;
        if (Math.abs(pr - sc) <= 0.1) showArmed = true;   // the glide has arrived
        if (showArmed && (Math.abs(pr - sc) > 0.24 || pr >= 0.999)) { exitShowcase(); }
        else {
          // Gate on the scene actually being on screen AND being the active room:
          // a dock jump can start the glide rooms away, and the target's markers
          // must not hover (or be clickable) over the scenes flying past.
          const on = seg.visible && gr.si === act;
          gr.items.forEach(it => { it.el.style.opacity = on ? 1 : 0; it.el.style.pointerEvents = on ? 'auto' : 'none'; });
          gr.el.style.opacity = on ? 1 : 0;
          gr.el.style.pointerEvents = 'none';
          return;
        }
      }
      // Flight mode: each marker peaks at its own anchor `at`, appearing
      // exactly when its appliance is framed and vanishing once it drifts off.
      gr.items.forEach(it => {
        const half = Math.min(it.span, VIS_HALF);
        const op = smooth(1 - Math.abs(pr - it.at) / half);
        it.el.style.opacity = op;
        it.el.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
      });
      // Gate on the engine's own scene visibility (crossfade-aware), so markers
      // exist exactly while their room is on screen — including the landing frame.
      gr.el.style.opacity = seg.visible ? 1 : 0;
      gr.el.style.pointerEvents = 'none';   // items gate their own clicks
    });
    // Copy panels are click-transparent (site.css); only their buttons are
    // interactive, and only while the panel is actually visible.
    copies.forEach(c => {
      const on = parseFloat(c.style.opacity || 0) > 0.5 ? 'auto' : 'none';
      c.querySelectorAll('.hs-scbtn, .sw-btn').forEach(b => { b.style.pointerEvents = on; });
    });
    place();   // re-project every frame: tracks the still's ken-burns until the clip paints
  });

  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', place);
  place();

  // Expose showcase controls so companion layers (the room dock / guided tour
  // in guide.js, the engine's own nav) can land users on a room's showcase view.
  api.enterShowcase = enterShowcase;
  api.exitShowcase = exitShowcase;

  if (debug) {
    const badge = document.createElement('div');
    badge.className = 'hs-debug';
    badge.textContent = 'hotspot tuning: click to log {fx, fy}';
    document.body.appendChild(badge);
    window.addEventListener('click', e => {
      const p = unmapPoint(e.clientX, e.clientY);
      // Include the active section's scroll progress so `at` can be read off.
      let at = '';
      sections.forEach((s, i) => {
        const seg = s._seg;
        if (!seg) return;
        const pr = (lastY - seg.start) / (seg.end - seg.start);
        if (pr >= 0 && pr <= 1) at = `, at: ${pr.toFixed(2)}`;
      });
      console.log(`{ fx: ${p.fx}, fy: ${p.fy}${at} },`);
      badge.textContent = `fx: ${p.fx}  fy: ${p.fy}${at}  (logged)`;
    });
  }

  function esch(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
}

function injectHotspotCSS() {
  if (document.getElementById('hs-css')) return;
  const css = `
  .hs-layer{position:fixed;inset:0;z-index:25;pointer-events:none;}
  .hs-group{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity .2s linear;}
  .hs-spot{position:absolute;top:0;left:0;width:28px;height:28px;
    text-decoration:none;will-change:transform;margin:-14px 0 0 -14px;
    opacity:0;pointer-events:none;transition:opacity .18s linear;}
  .hs-spot__dot{position:absolute;inset:0;border-radius:50%;
    background:color-mix(in srgb, var(--hs-accent) 88%, #000);
    border:2px solid rgba(255,255,255,.92);
    box-shadow:0 2px 10px rgba(0,0,0,.35);}
  .hs-spot__dot::before{content:"";position:absolute;inset:8px;border-radius:50%;background:#fff;}
  .hs-spot__dot::after{content:"";position:absolute;inset:-7px;border-radius:50%;
    border:2px solid color-mix(in srgb, var(--hs-accent) 70%, transparent);
    animation:hs-pulse 2.2s ease-out infinite;}
  @keyframes hs-pulse{0%{transform:scale(.6);opacity:.9}70%{transform:scale(1.25);opacity:0}100%{opacity:0}}
  .hs-spot__label{position:absolute;left:calc(100% + 10px);top:50%;transform:translate(-4px,-50%);
    direction:rtl;display:inline-flex;align-items:center;gap:6px;
    font-family:var(--sw-font-display);font-weight:700;font-size:.85rem;color:#fff;
    background:color-mix(in srgb, #10282c 82%, transparent);
    border:1px solid color-mix(in srgb, var(--hs-accent) 45%, transparent);
    backdrop-filter:blur(8px);padding:7px 14px;border-radius:999px;white-space:nowrap;
    opacity:0;transition:opacity .22s, transform .22s;}
  .hs-spot--flip .hs-spot__label{left:auto;right:calc(100% + 10px);transform:translate(4px,-50%);}
  .hs-spot:hover .hs-spot__label,.hs-spot:focus-visible .hs-spot__label,
  .hs-group--showcase .hs-spot__label{transform:translate(0,-50%);}
  .hs-spot:hover .hs-spot__label,.hs-spot:focus-visible .hs-spot__label{opacity:1;}
  .hs-spot:hover .hs-spot__dot{background:var(--hs-accent);}
  @media (hover:none) and (pointer:coarse){
    .hs-spot__label{opacity:1;font-size:.78rem;padding:6px 11px;}
    .hs-spot{width:24px;height:24px;margin:-12px 0 0 -12px;}
  }
  @media (prefers-reduced-motion:reduce){ .hs-spot__dot::after{animation:none;display:none;} }

  /* ---- showcase mode ---- */
  .hs-layer--showcase .hs-spot{transition:opacity .25s linear, transform .6s cubic-bezier(.22,.8,.24,1);}
  .hs-group--showcase .hs-spot__label{opacity:1;}
  .hs-group--showcase .hs-spot__dot{background:var(--hs-accent);}
  .hs-group--showcase .hs-spot__dot::after{animation-duration:1.4s;}
  .hs-spot__go{width:14px;height:14px;flex:0 0 auto;display:inline-block;margin-inline-start:8px;border-radius:50%;
    background:var(--hs-accent);position:relative;vertical-align:-2px;}
  .hs-spot__go::before{content:"";position:absolute;inset:4px 5px;border-inline-end:2px solid #fff;border-top:2px solid #fff;
    transform:rotate(-135deg);border-radius:1px;}
  .hs-spot__label{display:inline-flex;align-items:center;}

  /* ---- per-room showcase button (injected into the copy panel) ---- */
  .hs-scbtn{pointer-events:inherit;display:inline-flex;align-items:center;gap:10px;margin-top:22px;cursor:pointer;
    font-family:var(--sw-font-display);font-weight:700;font-size:.92rem;color:#fff;
    background:color-mix(in srgb, var(--sw-accent) 88%, #000);border:1px solid color-mix(in srgb,#fff 25%,transparent);
    padding:12px 20px;border-radius:999px;box-shadow:0 6px 22px color-mix(in srgb,var(--sw-accent) 35%,transparent);
    transition:transform .18s ease, box-shadow .18s ease, background .18s ease;}
  .hs-scbtn:hover,.hs-scbtn:focus-visible{transform:translateY(-2px);background:var(--sw-accent);
    box-shadow:0 10px 28px color-mix(in srgb,var(--sw-accent) 45%,transparent);}
  .hs-scbtn__dot{position:relative;width:12px;height:12px;border-radius:50%;background:#fff;flex:0 0 auto;}
  .hs-scbtn__dot::after{content:"";position:absolute;inset:-5px;border-radius:50%;
    border:2px solid color-mix(in srgb,#fff 70%,transparent);animation:hs-pulse 1.8s ease-out infinite;}
  .hs-scbtn em{font-style:normal;font-size:.78rem;font-weight:800;background:color-mix(in srgb,#fff 22%,transparent);
    border-radius:999px;padding:3px 9px;}
  @media (prefers-reduced-motion:reduce){ .hs-scbtn__dot::after{animation:none;display:none;} }

  /* ---- fixed eye toggle: show/hide marker titles across every scene ---- */
  .hs-eye{position:fixed;z-index:42;bottom:calc(20px + env(safe-area-inset-bottom));right:clamp(14px,3vw,28px);
    width:46px;height:46px;border-radius:50%;cursor:pointer;pointer-events:auto;display:grid;place-items:center;
    color:var(--sw-ink,#14343a);background:color-mix(in srgb,#fff 82%,transparent);backdrop-filter:blur(10px);
    border:1px solid color-mix(in srgb,var(--sw-accent,#2e7e88) 40%,transparent);
    box-shadow:0 6px 20px rgba(20,52,58,.16);transition:background .2s,color .2s,transform .2s,box-shadow .2s;}
  .hs-eye:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(20,52,58,.22);}
  .hs-eye.is-on{background:var(--sw-accent,#2e7e88);color:#fff;border-color:var(--sw-accent,#2e7e88);}
  .hs-eye__ic{display:block;}
  /* forced-labels mode reveals the label of every currently-framed marker
     (hidden markers keep opacity 0, so their labels stay hidden too) */
  .hs-layer--labels .hs-spot__label{opacity:1;transform:translate(0,-50%);}

  /* ---- one-time coach toast ---- */
  .hs-coach{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translate(-50%,16px);
    z-index:60;display:flex;align-items:center;gap:12px;direction:rtl;max-width:min(92vw,560px);
    background:color-mix(in srgb,#10282c 88%,transparent);backdrop-filter:blur(10px);
    border:1px solid color-mix(in srgb,var(--sw-accent,#2e7e88) 45%,transparent);
    border-radius:16px;padding:13px 16px;opacity:0;transition:opacity .35s ease, transform .35s ease;}
  .hs-coach.is-in{opacity:1;transform:translate(-50%,0);}
  .hs-coach p{margin:0;color:#fff;font-size:.88rem;line-height:1.55;font-family:var(--sw-font-display);}
  .hs-coach b{color:#ffd03f;font-weight:800;}
  .hs-coach__dot{position:relative;width:14px;height:14px;border-radius:50%;flex:0 0 auto;
    background:var(--sw-accent,#2e7e88);border:2px solid rgba(255,255,255,.9);}
  .hs-coach__dot::after{content:"";position:absolute;inset:-6px;border-radius:50%;
    border:2px solid color-mix(in srgb,var(--sw-accent,#2e7e88) 75%,transparent);animation:hs-pulse 2s ease-out infinite;}
  .hs-coach__x{flex:0 0 auto;background:none;border:0;color:#fff;opacity:.7;font-size:1.3rem;cursor:pointer;padding:2px 6px;}
  .hs-coach__x:hover{opacity:1;}
  /* On phones the copy panel owns the bottom — dock the coach under the nav. */
  @media (max-width:860px){
    .hs-coach{bottom:auto;top:calc(74px + env(safe-area-inset-top));transform:translate(-50%,-16px);}
    .hs-coach.is-in{transform:translate(-50%,0);}
    .hs-coach p{font-size:.82rem;}
  }
  .hs-debug{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:999;
    font:600 12px/1 ui-monospace,monospace;color:#fff;background:#c2410c;padding:8px 14px;border-radius:999px;}
  /* English (LTR) page: mirror the rtl-authored pieces */
  html[dir=ltr] .hs-scbtn{direction:ltr;}
  html[dir=ltr] .hs-coach{direction:ltr;}
  `;
  const style = document.createElement('style'); style.id = 'hs-css';
  style.textContent = css;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') window.mountHotspots = mountHotspots;
