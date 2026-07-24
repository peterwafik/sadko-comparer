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

   Crowding is resolved at runtime: overlapping dots are eased apart (capped so
   a marker can never leave its appliance) and each label opens on whichever
   side of its dot is actually free — see declutter() and layoutLabels().
   ========================================================================== */

function mountHotspots(container, api, sections) {
  const FRAME_W = 16, FRAME_H = 9;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const coarse = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
  // --- crowding control -----------------------------------------------------
  // Two markers closer than the pulse ring's diameter read as one smudge, so a
  // relaxation pass pushes overlapping dots apart. It is capped at MAX_NUDGE of
  // the frame width, though: a marker that wanders further than that stops
  // sitting on its own appliance, which matters more than perfect spacing.
  const DOT_R    = coarse ? 8 : 9;     // dot radius (matches the CSS box) — small markers
  const RING_R   = DOT_R + 5;          // + the pulse ring
  const LBL_GAP  = 12;                 // dot edge -> label (matches the CSS)
  const PAD      = 5;                  // breathing room demanded around a label
  const MIN_GAP  = coarse ? 38 : 2 * RING_R;   // px wanted between dot centres
  const MAX_NUDGE = 0.014;             // × frame width — the "stay on the appliance" cap
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
      // First guess only: labels lean toward the frame centre so edge markers
      // never clip offscreen. layoutLabels() re-picks the side every time the
      // visible set moves, using the real neighbours.
      a.className = 'hs-spot' + ((h.sfx ?? h.fx) > 0.5 ? ' hs-spot--l' : '');
      a.href = h.href || '#';
      a.setAttribute('aria-label', HS_EN ? `Shop the ${h.label} category` : `تسوّق فئة ${h.label}`);
      a.title = HS_EN ? `Click to shop all ${h.label} products` : `اضغط لتسوّق كل منتجات ${h.label}`;
      a.innerHTML = `<i class="hs-spot__dot"></i><span class="hs-spot__label">${esch(h.label)}<i class="hs-spot__go" aria-hidden="true"></i></span>`;
      a.style.transitionDelay = '0ms';
      a.addEventListener('click', dismissCoach);
      g.appendChild(a);
      return { el: a, k, uid: i + ':' + k, lab: a.querySelector('.hs-spot__label'),
               fx: h.fx, fy: h.fy, sfx: h.sfx ?? h.fx, sfy: h.sfy ?? h.fy,
               // mfx/mfy: this appliance's spot on the portrait phone scene image
               // (m_<room>.jpg). Falls back to the desktop coords if not given.
               mfx: h.mfx ?? h.fx, mfy: h.mfy ?? h.fy,
               at: h.at ?? 0.55, span: h.span ?? 0.38,
               x: 0, y: 0, vis: false, op: 0, lw: 0, lh: 0, side: '', sx: 0, sy: 0 };
    });
    layer.appendChild(g);
    return { el: g, items, si: i, showcase: s.showcase, on: false };
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
  // Turning the titles on puts every label on screen at once, so the sides have
  // to be re-solved against each other rather than against the dots alone.
  eyeBtn.addEventListener('click', () => {
    forceLabels = !forceLabels; paintEye(); layoutLabels(true); dismissCoach();
  });
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
  // Portrait phones show a DIFFERENT scene: the bespoke portrait image
  // (m_<room>.jpg, ~1080×1610), object-fit:contain and centred. So there the
  // mapping uses that image's aspect + contain + centre, and markers read from
  // each spot's mfx/mfy. Desktop/landscape keeps the 16:9 video, cover + objY.
  const MFRAME_W = 1080, MFRAME_H = 2160;
  const containMQ = window.matchMedia('(max-width: 860px) and (orientation: portrait)');
  function metrics() {
    const r = stageEl.getBoundingClientRect();
    if (containMQ.matches) {
      // cover (fill the screen) — mirrors the scene's object-fit:cover
      const s = Math.max(r.width / MFRAME_W, r.height / MFRAME_H);
      const dw = MFRAME_W * s, dh = MFRAME_H * s;
      return { r, dw, dh, ox: r.left + (r.width - dw) * 0.5, oy: r.top + (r.height - dh) * 0.5 };
    }
    const s = Math.max(r.width / FRAME_W, r.height / FRAME_H);
    const dw = FRAME_W * s, dh = FRAME_H * s;
    // Match the scene's ACTUAL object-position Y (--sw-objy) on the desktop cover.
    return { r, dw, dh, ox: r.left + (r.width - dw) * 0.5, oy: r.top + (r.height - dh) * objY() };
  }
  function mapPoint(fx, fy, m) {
    m = m || metrics();
    return { x: m.ox + fx * m.dw, y: m.oy + fy * m.dh };
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
      if (seg && seg.el && !seg.el.classList.contains('has-clip') && !containMQ.matches) {
        const local = clamp((lastY - seg.start) / (seg.end - seg.start), 0, 1);
        const stageX = window.innerWidth > 860 ? 4 : 0;
        still = {
          sc: reduceSc ? 1 : 1.03 + local * 0.14,
          tx: (stageX - 2) / 100 * window.innerWidth,
          cx: m.r.left + m.r.width / 2,
          cy: m.r.top + m.r.height / 2,
        };
      }
      const portrait = containMQ.matches;
      const pts = gr.items.map(it => {
        // Portrait phone → the appliance's spot on the portrait scene image;
        // showcase → its showcase-frame spot; otherwise its flight coords.
        let p = portrait ? mapPoint(it.mfx, it.mfy, m)
                         : (sc ? mapPoint(it.sfx, it.sfy, m) : mapPoint(it.fx, it.fy, m));
        if (still) p = { x: still.cx + (p.x - still.cx) * still.sc + still.tx,
                         y: still.cy + (p.y - still.cy) * still.sc };
        return { it, x: p.x, y: p.y, bx: p.x, by: p.y };
      });
      declutter(pts, MAX_NUDGE * m.dw);
      pts.forEach(p => {
        p.it.x = p.x; p.it.y = p.y;
        p.it.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        p.it.el.style.transitionDelay = sc ? `${p.it.k * 70}ms` : '0ms';
      });
    });
    layoutLabels();
  }

  // Push apart any pair of SIMULTANEOUSLY VISIBLE dots that sit closer than
  // MIN_GAP, then clamp every marker back inside `cap` px of the coordinate it
  // was authored at, so it can never drift off its appliance.
  function declutter(pts, cap) {
    const live = pts.filter(p => p.it.op > 0.02);
    if (live.length < 2) return;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d >= MIN_GAP) continue;
          if (d < 0.01) { dx = (j % 2) ? 1 : 0; dy = (j % 2) ? 0 : 1; d = 1; }
          // Weight the push by the fainter of the two: a marker fading into the
          // scene eases its neighbours aside instead of snapping them.
          const w = Math.min(a.it.op, b.it.op);
          const push = (MIN_GAP - d) / 2 * w, ux = dx / d, uy = dy / d;
          if (push < 0.05) continue;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    live.forEach(p => {
      const dx = p.x - p.bx, dy = p.y - p.by, d = Math.hypot(dx, dy);
      if (d > cap) { p.x = p.bx + dx / d * cap; p.y = p.by + dy / d * cap; }
    });
  }

  // --- label side solver ----------------------------------------------------
  // A label opens on whichever side of its dot is actually free — beside it,
  // above it or below it — instead of always running off to one side and lying
  // across the neighbouring markers. Sides are scored by how much they'd cover
  // (other dots, other open labels, the copy panel, the viewport edges) and the
  // cheapest wins; ties fall back to pointing toward the frame centre.
  function labelRect(x, y, w, h, side) {
    const o = DOT_R + LBL_GAP;
    if (side === 'l') return { x1: x - o - w, y1: y - h / 2, x2: x - o,     y2: y + h / 2 };
    if (side === 't') return { x1: x - w / 2, y1: y - o - h, x2: x + w / 2, y2: y - o };
    if (side === 'b') return { x1: x - w / 2, y1: y + o,     x2: x + w / 2, y2: y + o + h };
    return               { x1: x + o,     y1: y - h / 2, x2: x + o + w, y2: y + h / 2 };
  }
  function overlap(a, b) {
    return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) *
           Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  }
  // A label may SLIDE ALONG the side it sits on to stay on screen — sideways
  // when it's above/below the dot, up/down when it's beside it. Without this a
  // wide label on a marker near the frame edge has no good side at all: every
  // choice either runs off screen or lies across a neighbour. The slide is
  // capped so the dot always stays within the label's span, i.e. it still
  // visibly belongs to that marker.
  function fitRect(r, side, vw, vh) {
    let dx = 0, dy = 0;
    if (side === 't' || side === 'b') {
      if (r.x1 < 10) dx = 10 - r.x1; else if (r.x2 > vw - 10) dx = (vw - 10) - r.x2;
      const cap = Math.max(0, (r.x2 - r.x1) / 2 - 14);
      dx = Math.max(-cap, Math.min(cap, dx));
    } else {
      if (r.y1 < 76) dy = 76 - r.y1; else if (r.y2 > vh - 10) dy = (vh - 10) - r.y2;
      const cap = Math.max(0, (r.y2 - r.y1) / 2 - 8);
      dy = Math.max(-cap, Math.min(cap, dy));
    }
    return { x1: r.x1 + dx, y1: r.y1 + dy, x2: r.x2 + dx, y2: r.y2 + dy, dx, dy };
  }

  // The visible copy panel is the other big block of text competing for the same
  // space, so labels are scored against it too. Its rect needs a real layout
  // read, which we throttle: while the still is ken-burnsing, layoutLabels runs
  // every frame, and a forced reflow per frame is exactly the jank we can't
  // afford next to video scrubbing. A slightly stale box is harmless here.
  let copyBoxAt = -1e9, copyBoxVal = null, copyBoxEl = null;
  function readCopyBox(force) {
    // Which panel is showing is free to determine (inline opacity, no layout).
    let el = null;
    copies.forEach(c => { if (parseFloat(c.style.opacity || 0) >= 0.25) el = c; });
    // Only the panel's exact rect costs a reflow, so throttle that — but never
    // across a change of panel, or a room would be laid out against the
    // neighbouring room's copy box.
    if (!force && el === copyBoxEl && performance.now() - copyBoxAt < 220) return copyBoxVal;
    copyBoxAt = performance.now();
    copyBoxEl = el;
    if (!el) return (copyBoxVal = null);
    const r = el.getBoundingClientRect();
    // Grow the text box to the frosted card actually painted behind it
    // (.sw-copy::before's inset in site.css) — that card, not the glyphs, is
    // what a label would visibly land on top of.
    copyBoxVal = r.width
      ? { x1: r.left - 40, y1: r.top - 30, x2: r.right + 40, y2: r.bottom + 30 }
      : null;
    return copyBoxVal;
  }

  let lastSig = '';
  function layoutLabels(force) {
    const live = [];
    groups.forEach(gr => { if (gr && gr.on) gr.items.forEach(it => { if (it.vis) live.push(it); }); });
    // Positions are static once a clip has painted, so only re-solve when the
    // visible set or its geometry actually moved (the still's ken-burns aside).
    // The copy panel has to be part of that signature: a marker's screen spot is
    // FIXED for the whole section, so without it the room would be solved once —
    // while the copy card happened to be up — and keep dodging a card that has
    // since faded out for the rest of the scroll. Keyed off inline styles only
    // (no layout read) and quantised to opacity quarters, so it re-solves when
    // the card meaningfully appears/moves/leaves, not every frame.
    let copyKey = '-';
    copies.forEach((c, ci) => {
      const o = parseFloat(c.style.opacity || 0);
      if (o >= 0.25) copyKey = `${ci}:${Math.round(o * 4)}:${c.style.top || ''}`;
    });
    const sig = copyKey + '|' + live.map(it => `${it.uid}@${it.x | 0},${it.y | 0}`).join('|');
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (!live.length) return;

    let unmeasured = false;
    live.forEach(it => {
      if (!it.lw && it.lab.offsetWidth) { it.lw = it.lab.offsetWidth; it.lh = it.lab.offsetHeight; }
      if (!it.lw) unmeasured = true;      // label has no box yet (webfont still loading)
    });
    // An unmeasurable label is skipped below and would otherwise keep whatever
    // side it was born with forever, since an unchanged signature suppresses the
    // next solve. Drop the signature so we retry as soon as it has a size.
    if (unmeasured) lastSig = '';

    const vw = window.innerWidth, vh = window.innerHeight;
    const dots = live.map(it => ({ x1: it.x - RING_R, y1: it.y - RING_R,
                                   x2: it.x + RING_R, y2: it.y + RING_R, it }));
    // Every label is on screen at once only in forced-titles mode (the eye
    // toggle) now — on touch, labels stay hidden until then — so they must dodge
    // each other exactly when forceLabels is on; otherwise only the dots matter.
    const allOpen = forceLabels;
    const copyBox = readCopyBox(force);

    // Solve the most hemmed-in markers first — they have the fewest options.
    // Crowding is computed once per marker, not inside the comparator: this
    // whole solve can run per frame while the still is ken-burnsing.
    const crowd = new Map();
    live.forEach(a => {
      let n = 0;
      live.forEach(b => { if (b !== a && Math.hypot(b.x - a.x, b.y - a.y) < 190) n++; });
      crowd.set(a, n);
    });
    const order = live.slice().sort((a, b) => crowd.get(b) - crowd.get(a) || a.y - b.y);

    const taken = [];
    order.forEach(it => {
      if (!it.lw) return;
      const cand = it.x < vw / 2 ? ['r', 'l', 'b', 't'] : ['l', 'r', 'b', 't'];
      let best = null;
      cand.forEach((side, ci) => {
        const r = fitRect(labelRect(it.x, it.y, it.lw, it.lh, side), side, vw, vh);
        // Preference cost is deliberately tiny next to the overlap penalties:
        // it only breaks ties between equally-clear sides.
        let s = ci * 60;
        s += (Math.max(0, 10 - r.x1) + Math.max(0, r.x2 - (vw - 10)) +
              Math.max(0, 76 - r.y1) + Math.max(0, r.y2 - (vh - 10))) * 90;
        // Score a slightly inflated box, so "just touching" still reads as a
        // collision and the solver keeps real breathing room between pills.
        const p = { x1: r.x1 - PAD, y1: r.y1 - PAD, x2: r.x2 + PAD, y2: r.y2 + PAD };
        dots.forEach(d => { if (d.it !== it) s += overlap(p, d) * 3; });
        if (allOpen) taken.forEach(t => { s += overlap(p, t) * 2; });
        if (copyBox) s += overlap(p, copyBox) * 1.5;
        if (!best || s < best.s) best = { s, side, r };
      });
      taken.push(best.r);
      if (best.side !== it.side) {
        it.side = best.side;
        it.el.classList.toggle('hs-spot--l', best.side === 'l');
        it.el.classList.toggle('hs-spot--t', best.side === 't');
        it.el.classList.toggle('hs-spot--b', best.side === 'b');
      }
      const sx = Math.round(best.r.dx), sy = Math.round(best.r.dy);
      if (sx !== it.sx) { it.sx = sx; it.lab.style.setProperty('--hs-sx', sx + 'px'); }
      if (sy !== it.sy) { it.sy = sy; it.lab.style.setProperty('--hs-sy', sy + 'px'); }
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
        gr.on = false;
        gr.items.forEach(it => { it.el.style.pointerEvents = 'none'; it.vis = false; it.op = 0; });
        return;
      }
      // Portrait phones show a STATIC scene image, so there is no per-appliance
      // flight band — every marker in the room is live the whole time that room is
      // on screen. (Labels still default hidden; the eye toggle reveals them.)
      if (containMQ.matches) {
        const on = seg.visible && gr.si === act;
        gr.items.forEach(it => { it.el.style.opacity = on ? 1 : 0; it.el.style.pointerEvents = on ? 'auto' : 'none'; it.vis = on; it.op = on ? 1 : 0; });
        gr.on = on;
        gr.el.style.opacity = on ? 1 : 0;
        gr.el.style.pointerEvents = 'none';
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
          gr.items.forEach(it => { it.el.style.opacity = on ? 1 : 0; it.el.style.pointerEvents = on ? 'auto' : 'none'; it.vis = on; it.op = on ? 1 : 0; });
          gr.on = on;
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
        it.vis = op > 0.05; it.op = op;
      });
      // Gate on the engine's own scene visibility (crossfade-aware), so markers
      // exist exactly while their room is on screen — including the landing frame.
      gr.on = seg.visible;
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

  // Cached label sizes only go stale when the type does: a resize (the pill
  // wraps nothing, but its font-size is viewport-driven) or a late webfont.
  function remeasure() {
    groups.forEach(gr => gr && gr.items.forEach(it => { it.lw = 0; it.lh = 0; }));
    place();
    layoutLabels(true);
  }
  // The engine flips a scene to .has-clip the moment its video paints its first
  // frame, which retires the still's ken-burns zoom. Markers mirror that zoom, so
  // they have to re-project right then — otherwise every marker in the room sits
  // at the magnified coordinates (visibly off its appliance, sometimes pushed
  // clean off screen) until the next scroll event happens to call place().
  const clipWatch = new MutationObserver(() => place());
  container.querySelectorAll('.sw-scene').forEach(sc =>
    clipWatch.observe(sc, { attributes: true, attributeFilter: ['class'] }));

  window.addEventListener('resize', remeasure);
  window.addEventListener('orientationchange', remeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure).catch(() => {});
  place();

  // Expose showcase controls so companion layers (the room dock / guided tour
  // in guide.js, the engine's own nav) can land users on a room's showcase view.
  api.enterShowcase = enterShowcase;
  api.exitShowcase = exitShowcase;

  function esch(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
}

function injectHotspotCSS() {
  if (document.getElementById('hs-css')) return;
  const css = `
  .hs-layer{position:fixed;inset:0;z-index:25;pointer-events:none;}
  .hs-group{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity .2s linear;}
  .hs-spot{position:absolute;top:0;left:0;width:18px;height:18px;z-index:1;
    text-decoration:none;will-change:transform;margin:-9px 0 0 -9px;
    opacity:0;pointer-events:none;transition:opacity .18s linear;}
  /* the marker you're pointing at always reads over its neighbours */
  .hs-spot:hover,.hs-spot:focus-within{z-index:9;}
  .hs-spot__dot{position:absolute;inset:0;border-radius:50%;
    background:color-mix(in srgb, var(--hs-accent) 88%, #000);
    border:2px solid rgba(255,255,255,.92);
    box-shadow:0 2px 10px rgba(0,0,0,.35);}
  .hs-spot__dot::before{content:"";position:absolute;inset:5px;border-radius:50%;background:#fff;}
  .hs-spot__dot::after{content:"";position:absolute;inset:-5px;border-radius:50%;
    border:2px solid color-mix(in srgb, var(--hs-accent) 70%, transparent);
    animation:hs-pulse 2.2s ease-out infinite;}
  @keyframes hs-pulse{0%{transform:scale(.6);opacity:.9}70%{transform:scale(1.25);opacity:0}100%{opacity:0}}
  /* Labels open on one of four sides — beside, above or below the dot. JS picks
     whichever is actually clear (see layoutLabels); --hs-b* is the anchoring
     offset for that side and --hs-o* the small slide-in the reveal animates. */
  .hs-spot__label{position:absolute;left:calc(100% + 12px);top:50%;
    --hs-bx:0px;--hs-by:-50%;--hs-ox:-4px;--hs-oy:0px;--hs-sx:0px;--hs-sy:0px;
    transform:translate(calc(var(--hs-bx) + var(--hs-ox) + var(--hs-sx)),
                        calc(var(--hs-by) + var(--hs-oy) + var(--hs-sy)));
    direction:rtl;display:inline-flex;align-items:center;gap:6px;
    font-family:var(--sw-font-display);font-weight:700;font-size:.85rem;color:#fff;
    background:color-mix(in srgb, #10282c 82%, transparent);
    border:1px solid color-mix(in srgb, var(--hs-accent) 45%, transparent);
    backdrop-filter:blur(8px);padding:7px 14px;border-radius:999px;white-space:nowrap;
    opacity:0;transition:opacity .22s, transform .22s;}
  html[dir=ltr] .hs-spot__label{direction:ltr;}
  .hs-spot--l .hs-spot__label{left:auto;right:calc(100% + 12px);--hs-ox:4px;}
  .hs-spot--t .hs-spot__label{left:50%;right:auto;top:auto;bottom:calc(100% + 12px);
    --hs-bx:-50%;--hs-by:0px;--hs-ox:0px;--hs-oy:4px;}
  .hs-spot--b .hs-spot__label{left:50%;right:auto;top:calc(100% + 12px);bottom:auto;
    --hs-bx:-50%;--hs-by:0px;--hs-ox:0px;--hs-oy:-4px;}
  .hs-spot:hover .hs-spot__label,.hs-spot:focus-visible .hs-spot__label{--hs-ox:0px;--hs-oy:0px;opacity:1;}
  .hs-spot:hover .hs-spot__dot{background:var(--hs-accent);}
  @media (hover:none) and (pointer:coarse){
    /* Titles stay HIDDEN by default on touch (no hover to reveal them one at a
       time) — they light up only when the eye toggle turns them on, via
       .hs-layer--labels below. Dots alone keep the scene uncluttered. */
    .hs-spot__label{font-size:.78rem;padding:6px 11px;}
    .hs-spot{width:16px;height:16px;margin:-8px 0 0 -8px;}
  }
  @media (prefers-reduced-motion:reduce){ .hs-spot__dot::after{animation:none;display:none;} }

  /* ---- showcase mode ---- */
  /* Showcase lights up every DOT in the room (pulsing, clickable) but keeps the
     titles hidden by default — markers are points only; a title shows on hover,
     or on all markers at once via the eye toggle. */
  .hs-layer--showcase .hs-spot{transition:opacity .25s linear, transform .6s cubic-bezier(.22,.8,.24,1);}
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
  .hs-layer--labels .hs-spot__label{opacity:1;--hs-ox:0px;--hs-oy:0px;}

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
  /* English (LTR) page: mirror the rtl-authored pieces */
  html[dir=ltr] .hs-scbtn{direction:ltr;}
  html[dir=ltr] .hs-coach{direction:ltr;}
  `;
  const style = document.createElement('style'); style.id = 'hs-css';
  style.textContent = css;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') window.mountHotspots = mountHotspots;
