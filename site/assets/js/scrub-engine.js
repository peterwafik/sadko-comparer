/* ============================================================================
   scroll-world — portable scroll-scrubbed camera-flight engine
   ----------------------------------------------------------------------------
   Framework-agnostic. Vanilla JS, zero dependencies. It builds its own DOM and
   injects its own (namespaced) CSS into a container you give it, so it drops into
   plain HTML, Next.js (call from a ref/useEffect), Vue (onMounted), a server-
   rendered page, anything.

   USAGE
     mountScrollWorld(document.getElementById('world'), {
       brand: { name: 'Pearl & Co.', href: '#top' },
       diveScroll: 1.3,   // viewport-heights of scroll per dive clip
       connScroll: 0.9,   // ...per connector clip
       hint: 'scroll to fly in',
       nav: true,         // show the top section nav
       atmosphere: true,  // subtle gradient + drifting particles behind the clips
       sections: [
         { id, label, still, clip, clipMobile, accent,
           scroll: 1.6,   // optional per-section override of diveScroll — more scroll
                          // distance = a slower, longer dwell in this scene
           linger: 0.5,   // optional 0..1 — remaps time so the camera settles mid-scene
                          // (exactly where the copy peaks) and moves quicker at the
                          // edges. 0 = linear (default). Keep ≤ 0.6; 1 = full pause.
           eyebrow, title, body, tags:[…],
           cta:{ primary:{label,href}, secondary:{label,href} } }, // last section only
         …
       ],
       connectors: [clipUrl, …],          // length = sections.length - 1 (nulls allowed)
       connectorsMobile: [clipUrl, …],    // optional lighter connectors for phones (same length)

   MOBILE (the clipMobile/connectorsMobile variants are the opt-in "mobile beta";
   the rest of the phone handling below is always on)
     The engine is phone-aware out of the box: on a coarse-pointer / ≤860px viewport it
       - loads `clipMobile` / `connectorsMobile` when provided (encode these smaller +
         tighter-GOP — seek cost on a phone decoder is dominated by frames-from-keyframe,
         so a 720p, -g 4 file scrubs far smoother than the 1080p desktop master; see
         pipeline.md). Falls back to the desktop `clip` if no mobile variant is given.
       - coalesces seeks (never issues a new currentTime while the decoder is still
         `seeking`) so fast flicks can't pile up and freeze the video.
       - keeps the still as a live poster until the clip actually paints its first frame,
         and primes each video (muted play→pause) on first touch — this is what stops iOS
         from showing a blank scene before the first seek.
       - drops the drifting particles and ignores URL-bar-only resizes (no scroll jump).
     Nothing here is required — a config with only `clip`/`connectors` still works on
     phones; the mobile variants just make it lighter and smoother.

   THEME (CSS custom properties; set on the container or :root to override)
     --sw-bg         page background (match your scene bg for seamless posters)
     --sw-ink        primary text
     --sw-ink-soft   secondary text
     --sw-accent     default accent (each section overrides via its `accent`)
     --sw-font-display / --sw-font-body

   REQUIREMENTS ON YOUR ASSETS
     - clips encoded native-res, crf~20, -g 8, +faststart, no audio (see pipeline.md)
     - connectors' endpoints are the neighbouring dives' ACTUAL frames (see SKILL Step 5)
     - (optional) mobile variants at ~720p, -g 4 for smoother phone scrubbing
   The engine loads each clip as a Blob (always seekable) and scrubs currentTime; it does
   NOT depend on HTTP byte-range support.
   ========================================================================== */

function mountScrollWorld(container, config) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phone detection. `coarse` is captured once (input type doesn't change mid-session);
  // the ≤860px query is read live via isMobile() so a desktop resize/DevTools toggle
  // switches sources and seek behaviour without a reload.
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = window.matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;
  // Portrait phones show each scene FITTED whole (letterboxed), so the ken-burns
  // push/zoom is dropped there — it would zoom-crop the very thing we're fitting.
  const portraitMQ = window.matchMedia('(max-width: 860px) and (orientation: portrait)');
  const SECTIONS = config.sections || [];
  const CONNECTORS = config.connectors || [];
  const CONNECTORS_M = config.connectorsMobile || [];
  const DIVE_W = config.diveScroll || 1.3;
  const CONN_W = config.connScroll || 0.9;
  const CROSSFADE = (config.crossfade != null) ? config.crossfade : 0.12;  // seam dissolve width (vh)
  const N = SECTIONS.length;
  if (!N) return;

  injectCSS();
  container.classList.add('sw-root');

  // ---- build the interleaved segment chain: dive0, conn0, dive1, … diveN-1 ----
  const SEGMENTS = [];
  SECTIONS.forEach((s, i) => {
    const dive = { kind: 'dive', si: i, clip: s.clip, clipM: s.clipMobile, still: s.still, stillM: s.stillMobile, accent: s.accent,
                   w: s.scroll || DIVE_W, linger: s.linger || 0,
                   // `clipEnd` plays only the FIRST part of a leg: the section's whole
                   // scroll maps onto clip time 0..clipEnd instead of 0..1. Used to stop
                   // a flight before it arrives — see the outro below.
                   // NB: `clamp` is a const declared further down, so it is still in
                   // its temporal dead zone here — clamp inline rather than call it.
                   clipEnd: (s.clipEnd != null ? Math.min(1, Math.max(0.02, s.clipEnd)) : 1) };
    SEGMENTS.push(dive);
    s._seg = dive;
    /* A connector is optional: if neither clip exists, the two dives simply
       crossfade directly (no fly-over). Lets a page complete even when a
       connector can't be generated (e.g. a content-filter false-positive).

       A connector may also exist for ONE orientation only. A portrait phone shows
       each room as a fitted portrait image rather than the 16:9 flight, so a
       landscape connector is useless there and a portrait one is useless on the
       desktop — the two need different footage, and a page may legitimately ship
       just one of them. `portraitOnly` connectors are collapsed to zero scroll
       everywhere else (see layout()), so they cost a desktop visitor nothing:
       no scroll length, no fetch, no scene. */
    const cDesk = CONNECTORS[i], cMob = CONNECTORS_M[i];
    if (i < N - 1 && (cDesk || cMob)) {
      SEGMENTS.push({ kind: 'conn', si: i, clip: cDesk, clipM: cMob,
                      portraitOnly: !cDesk,
                      // A connector plays end to end. This has to be stated: read()
                      // computes `target = local * clipEnd`, so leaving it undefined
                      // made the target NaN, the seek test `|currentTime - NaN| > eps`
                      // always false, and the clip sat frozen on frame 0 — a
                      // connector that loaded, painted and never moved.
                      clipEnd: 1,
                      // The poster a connector holds until its own clip paints is
                      // the room it is flying INTO — in whichever shape that
                      // orientation is actually showing.
                      still: (!cDesk && SECTIONS[i + 1].stillMobile) || SECTIONS[i + 1].still,
                      accent: SECTIONS[i + 1].accent, w: CONN_W });
    }
  });
  const NSEG = SEGMENTS.length;

  // ---- DOM ----
  const sky = el('div', 'sw-sky');
  if (config.atmosphere !== false) {
    sky.appendChild(el('div', 'sw-sky__grad'));
    sky.appendChild(el('div', 'sw-sky__glow'));
  }
  const particles = el('div', 'sw-particles'); sky.appendChild(particles);

  const scrollbar = el('div', 'sw-scrollbar');
  const scrollbarFill = el('span'); scrollbar.appendChild(scrollbarFill);

  const topbar = el('div', 'sw-topbar');
  if (config.brand) {
    const brand = el('a', 'sw-brand'); brand.href = (config.brand.href || '#');
    brand.appendChild(el('span', 'sw-brand__mark'));
    const nm = el('span', 'sw-brand__name'); nm.textContent = config.brand.name || ''; brand.appendChild(nm);
    topbar.appendChild(brand);
  }
  const nav = el('nav', 'sw-nav'); if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta && config.cta.label) {
    const c = el('a', 'sw-topcta'); c.href = config.cta.href || '#'; c.textContent = config.cta.label;
    topbar.appendChild(c);
  }

  const stage = el('div', 'sw-stage');
  const copylayer = el('div', 'sw-copylayer');
  /* The side route rail — a vertical dot per section, pinned to the right edge.
     Optional (`route: false`), the same way the topbar nav is: on a page whose
     scenes carry their own edge-anchored markers it competes with them for the
     same strip of screen, and a second "which room am I in" indicator is
     redundant when the room dock already names the room. */
  const route = config.route === false ? null : el('div', 'sw-route');
  const hint = el('div', 'sw-hint');
  const hintText = el('span'); hintText.textContent = config.hint || 'scroll'; hint.appendChild(hintText);
  hint.appendChild(el('i'));
  const track = el('div', 'sw-track');

  [sky, scrollbar, topbar, stage, copylayer, route, hint, track]
    .filter(Boolean).forEach(n => container.appendChild(n));

  // segment scenes
  SEGMENTS.forEach(s => {
    const scene = el('div', 'sw-scene'); scene.style.setProperty('--sw-accent', s.accent || '');
    // Portrait phones use a bespoke, portrait-shaped scene image per room instead
    // of the desktop 16:9 video flight — the scenes simply cross-dissolve as you
    // scroll (no camera-scrub). CSS shows this in portrait and hides the video/
    // desktop-still; the desktop path is untouched.
    let mimg = null;
    if (s.stillM) {
      /* NOT lazy, and the src is attached by warmPortraitStills() rather than
         here. On a portrait phone these four images ARE the experience — there is
         no video on that path at all — so `loading="lazy"` marked the page's only
         real content as deferrable: Chrome fetches lazy images at LOW priority,
         behind the fonts, the scripts and each other. On a fast connection that is
         invisible; on a phone it meant scrolling into a room whose picture had not
         arrived, so the dissolve faded to nothing and the transition looked broken
         until enough reloads had warmed the HTTP cache.
         Desktop must still not pay for them (they are display:none there), which
         is what `loading="lazy"` was really buying — so the fetch is now gated on
         the portrait media query instead, which says exactly that and says it
         once. */
      mimg = el('img', 'sw-scene__mstill'); mimg.alt = '';
      mimg.decoding = 'async'; mimg.loading = 'eager';
      mimg.addEventListener('load', () => { s.mready = true; read(); });
      scene.appendChild(mimg);
      // Marks this as a scene the portrait breakpoint replaces with a fitted
      // image; the CSS there keys off it so connector scenes keep their video.
      scene.classList.add('sw-scene--m');
    }
    const img = el('img', 'sw-scene__still'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    // On a real touch phone with a bespoke portrait image, the desktop still is
    // never shown — skip fetching it so phones don't pay for a hi-res still they
    // won't see. (Desktop and DevTools emulation still load it as before.)
    if (s.still && !(coarse && s.stillM)) img.src = s.still;
    scene.appendChild(img); stage.appendChild(scene);
    s.el = scene; s.img = img; s.mimg = mimg; s.video = null; s.hasClip = false;
    s.loading = false; s.ready = false; s.cur = 0; s.target = 0; s.visible = false;
    // Portrait readiness is tracked separately from `ready` (which means "the
    // video has metadata"): the portrait path never loads a video, so it could
    // never use that flag.
    s.mready = false;
  });

  /* Attach the portrait scene images. Called as soon as the portrait query
     matches — at mount, or on a rotation into portrait — and never on desktop,
     where the images are display:none and would be pure waste.
     The first room is marked high priority because it is what the visitor is
     looking at while the rest arrive; the others are ordinary (not lazy) fetches,
     which is enough for them to be decoded long before a thumb can scroll to
     them. Idempotent: an already-attached image is left alone, so a rotation
     back and forth cannot restart the downloads. */
  function warmPortraitStills() {
    SEGMENTS.forEach((s, i) => {
      if (!s.mimg || s.mimg.getAttribute('src')) return;
      if (i === 0 && 'fetchPriority' in s.mimg) s.mimg.fetchPriority = 'high';
      s.mimg.src = s.stillM;
      // A cached image can finish before the load listener above is reached on
      // some engines; complete/naturalWidth is the authoritative check.
      if (s.mimg.complete && s.mimg.naturalWidth > 0) s.mready = true;
    });
  }
  if (portraitMQ.matches) warmPortraitStills();
  // Rotating a phone from landscape into portrait switches the whole scene layer
  // over to these images, so they have to exist by then.
  const onPortraitChange = () => { if (portraitMQ.matches) { warmPortraitStills(); read(); } };
  if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', onPortraitChange);
  else if (portraitMQ.addListener) portraitMQ.addListener(onPortraitChange);

  // per-section copy / route / nav
  const copies = [], dots = [];
  SECTIONS.forEach((s, i) => {
    const c = el('article', 'sw-copy'); c.style.setProperty('--sw-accent', s.accent || '');
    c.innerHTML =
      `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` +
      (s.eyebrow ? `<span class="sw-copy__eyebrow">${esc(s.eyebrow)}</span>` : '') +
      (s.title ? `<h2 class="sw-copy__title">${esc(s.title)}</h2>` : '') +
      (s.body ? `<p class="sw-copy__body">${esc(s.body)}</p>` : '') +
      (s.tags && s.tags.length ? `<ul class="sw-copy__tags">${s.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '') +
      (s.cta ? `<div class="sw-copy__cta">${ctaBtns(s.cta)}</div>` : '');
    copylayer.appendChild(c); copies.push(c);

    // `dots` stays index-aligned with SECTIONS whether or not the rail exists;
    // when it doesn't, it is simply empty and the active-state loop below is a
    // no-op, so nothing downstream needs to know.
    if (route) {
      const dot = el('button', 'sw-route__dot'); dot.style.setProperty('--sw-accent', s.accent || '');
      dot.innerHTML = `<span class="sw-route__label">${esc(s.label || '')}</span><i></i>`;
      dot.addEventListener('click', () => jumpTo(i)); route.appendChild(dot); dots.push(dot);
    }

    if (config.nav !== false) {
      const b = el('button', 'sw-nav__item'); b.textContent = s.label || '';
      b.addEventListener('click', () => jumpTo(i)); nav.appendChild(b);
    }
  });

  // ---- math ----
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  // Per-section dwell: monotone remap of scroll→time so the camera settles mid-scene
  // (where the copy peaks) and moves quicker near the seams. L=0 linear, L=1 full
  // mid-scene pause. f(0)=0, f(1)=1 always, so seam frames are untouched.
  const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  let vh = window.innerHeight, totalW = 0, activeIndex = -1, ticking = false;
  let laidOutW = window.innerWidth;   // width the current layout was computed at (see onResize)

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    let off = 0;
    /* `dead` segments take no scroll and are never drawn. That is how an
       orientation-specific connector disappears completely on the orientation it
       was not made for — recomputed here rather than fixed at mount, so rotating
       a phone adds or removes the connector's scroll length correctly (layout()
       re-runs on every width change).
       Zero-width segments must never reach read(): its progress is
       (y - start) / (end - start), which would be a division by zero, and its
       opacity would compute to a fully-visible scene sitting on top of the real
       one. So they are skipped outright there. */
    SEGMENTS.forEach(s => {
      s.dead = !!s.portraitOnly && !portraitMQ.matches;
      const w = s.dead ? 0 : s.w;
      s.start = off * vh; off += w; s.end = off * vh;
      if (s.dead) { s.el.style.opacity = 0; s.visible = false; }
    });
    totalW = off;
    track.style.height = (totalW * vh + vh) + 'px';   // +1vh so the last flight completes
    gateMax = -1;                                       // force applyGate() to re-measure
    read();
    pump();
  }

  function jumpTo(i) {
    const seg = SECTIONS[i]._seg;
    window.scrollTo({ top: seg.start + (seg.end - seg.start) * 0.5, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ---- clip loading ---------------------------------------------------------
     Every transition is a pre-rendered clip that has to be in memory before it
     can be scrubbed (a Blob is always seekable; a streamed file is not). The
     clips used to be fetched only when the reader scrolled within ~1.6 screens
     of them, so anyone who scrolled faster than a 4-12 MB file could download
     reached a room with nothing to play: its still poster was shown and simply
     cross-faded into the next one. That was the "the room fades and the next
     one pops up" report. Four things now guarantee the movement instead:

     1. EAGER, ORDERED. All clips this device will play are queued at mount and
        fetched nearest-ahead first, one or two at a time, never waiting for the
        reader to scroll near them.
     2. KEPT. A downloaded clip is stored in the Cache Storage API, so a
        returning visitor has every transition instantly, even offline.
     3. SIZED TO THE CONNECTION. Each clip has a light encode (`-lite.mp4`,
        same frames and timing, about a quarter of the bytes). It is used when
        the browser reports a slow or data-saver connection, when a download
        measures below FAST_MBPS, and for the very first clip on an unknown
        connection so the tour can start at once. On a fast connection the
        full-quality clip replaces a light one later, while it is off screen.
     4. GATED. The page is never longer than what has loaded: the scroll ends
        just before the first room whose clip is not ready, with a progress pill,
        and continues the moment it is. A download that truly stalls, or the
        reader's own "skip", releases that one room to the old cross-fade, so
        nobody is ever stuck. Failed downloads retry with backoff regardless. */
  const CLIP_CACHE = 'sadko-clips-v1';
  const LITE_ON = config.lite !== false;
  const FAST_MBPS = 6;                 // measured below this, the rest of the tour goes light
  const STALL_MS = 15000;              // no bytes for this long releases the gate for that room
  const SKIP_AFTER_MS = 8000;          // the pill offers "skip" after this long at the gate
  const liteOf = u => u.replace(/\.mp4$/i, '-lite.mp4');
  const netInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  let lite = LITE_ON && !!netInfo && !!(netInfo.saveData ||
    /(^|-)(2g|3g)$/.test(netInfo.effectiveType || '') || (netInfo.downlink && netInfo.downlink < 3));
  let speedKnown = false;              // set once one real download has been measured
  let activeLoads = 0;

  const clipSrc = s => ((isMobile() && s.clipM) ? s.clipM : (s.clip || s.clipM)) || null;
  // A segment this device will actually scrub. Portrait rooms are fitted images, and
  // reduced motion never loads clips at all.
  const wantsClip = s => !s.dead && !reduce && !(portraitMQ.matches && s.stillM) && !!clipSrc(s);
  // Whether a segment can be shown properly right now, whatever kind of scene it is.
  function sceneReady(s) {
    if (s.dead || reduce) return true;
    if (portraitMQ.matches && s.stillM) return !s.mimg || s.mready;
    if (!clipSrc(s)) return true;
    return !!s.frameReady;
  }

  async function cachedClip(url) {
    try {
      if (!('caches' in window)) return null;
      const c = await caches.open(CLIP_CACHE);
      const r = await c.match(url);
      return r ? await r.blob() : null;
    } catch (e) { return null; }
  }
  function keepClip(url, blob) {
    try {
      if (!('caches' in window)) return;
      caches.open(CLIP_CACHE)
        .then(c => c.put(url, new Response(blob, { headers: { 'content-type': 'video/mp4' } })))
        .catch(() => {});                // quota or private mode: the clip still plays, just not kept
    } catch (e) {}
  }

  /* Streams the file so the gate can show real progress and the speed can be
     measured while it arrives. A full-quality download that is clearly too slow
     for the reader to wait on is abandoned for the light one. */
  async function download(s, url, mayDowngrade) {
    const ctl = ('AbortController' in window) ? new AbortController() : null;
    const t0 = performance.now();
    s.lastByteAt = Date.now();
    // A connection that goes silent is cut, so the queue's retry takes over
    // instead of the request hanging for ever.
    const watchdog = setInterval(() => {
      if (Date.now() - s.lastByteAt > STALL_MS) { try { ctl && ctl.abort(); } catch (e) {} }
    }, 2000);
    try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : {});
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const total = +r.headers.get('content-length') || 0;
    s.total = total; s.got = 0; s.lastByteAt = Date.now();
    if (!r.body || !r.body.getReader) {
      const b = await r.blob(); s.got = b.size;
      return { blob: b, ms: performance.now() - t0 };
    }
    const reader = r.body.getReader(), parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); s.got += value.length; s.lastByteAt = Date.now();
      if (gateSeg === s) paintGate();
      const ms = performance.now() - t0;
      if (mayDowngrade && !lite && ms > 1500 && total) {
        const mbps = (s.got * 8) / ms / 1000;
        const secsLeft = ((total - s.got) * 8) / (mbps * 1e6);
        if (mbps < FAST_MBPS && secsLeft > 2.5) {
          lite = true; speedKnown = true;
          try { ctl && ctl.abort(); } catch (e) {}
          const d = new Error('downgrade'); d.downgrade = true; throw d;
        }
      }
    }
    return { blob: new Blob(parts, { type: 'video/mp4' }), ms: performance.now() - t0 };
    } finally { clearInterval(watchdog); }
  }

  async function fetchClip(s) {
    const src = clipSrc(s);
    const liteUrl = liteOf(src);
    // A clip already on this device is used whatever the connection: full first.
    let blob = await cachedClip(src), isLite = false;
    if (!blob && LITE_ON) { blob = await cachedClip(liteUrl); isLite = !!blob; }
    if (!blob) {
      // The first clip on a connection we know nothing about starts light, so the
      // tour can begin at once; its speed decides the rest.
      const goLite = LITE_ON && (lite || !speedKnown);
      let url = goLite ? liteUrl : src;
      let got;
      try { got = await download(s, url, !goLite); }
      catch (e) {
        if (e.downgrade) { url = liteUrl; got = await download(s, url, false); }
        else if (goLite && e.status === 404) { url = src; got = await download(s, url, false); }   // no light encode shipped
        else throw e;
      }
      blob = got.blob; isLite = url === liteUrl && url !== src;
      const mbps = (blob.size * 8) / Math.max(1, got.ms) / 1000;
      if (got.ms > 400) { speedKnown = true; if (LITE_ON) lite = mbps < FAST_MBPS; }
      keepClip(url, blob);
    }
    attachClip(s, blob, isLite);
  }

  function makeVideo(blob) {
    const v = document.createElement('video');
    v.className = 'sw-scene__video';
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = URL.createObjectURL(blob);
    return v;
  }

  function attachClip(s, blob, isLite) {
    const v = makeVideo(blob);
    v.addEventListener('loadedmetadata', () => { s.ready = true; read(); });
    /* Reveal the video (hide the still poster) only once a real frame has
       painted — on iOS a seeked-but-never-played muted video stays blank, so
       hiding the still on metadata alone would flash an empty scene.

       `seeked` ALONE could not deliver that at the top of the page. The scrub
       loop only writes currentTime when it differs from the target by more
       than `eps`, and at scroll 0 the target IS 0 and the video is already at
       0 — so no seek is ever issued, `seeked` never fires, and the first room
       stayed on its still indefinitely. That still is a different frame from
       the clip's, shown under a ken-burns zoom, and hotspots.js mirrors that
       zoom, so every marker in the room sat off its appliance until something
       finally moved the scroll: the reason the living room only "snapped into
       place" after clicking its dock button (which glides 58px).

       So: prefer requestVideoFrameCallback, which fires exactly when a frame
       has been PRESENTED — the guarantee the iOS note above is really asking
       for — and where it does not exist, nudge the clip off zero once so the
       existing `seeked` path fires. The nudge is a hair over frame 0, well
       inside `eps`, so the scrub loop leaves it alone. */
    const reveal = () => s.el.classList.add('has-clip');
    v.addEventListener('seeked', reveal, { once: true });
    if (typeof v.requestVideoFrameCallback === 'function') {
      try { v.requestVideoFrameCallback(reveal); } catch (e) {}
    } else {
      v.addEventListener('loadeddata', () => {
        if (v.currentTime === 0) { try { v.currentTime = 0.001; } catch (e) {} }
      }, { once: true });
    }
    v.addEventListener('loadeddata', () => {
      try { v.pause(); } catch (e) {}
      if (userReady) primeVideo(v);
      // The gate waits for this, not for metadata: a decoded first frame is what
      // makes the transition paint instead of the poster.
      s.frameReady = true; read();
    });
    s.el.appendChild(v); s.video = v; s.hasClip = true; s.isLite = !!isLite;
  }

  /* Light → full, on a connection measured fast, once nothing else is waiting.
     Swapped only while the scene is off screen (see read()), so the reader never
     sees the switch. */
  async function upgradeClip(s) {
    const src = clipSrc(s);
    let blob = await cachedClip(src);
    if (!blob) { const got = await download(s, src, false); blob = got.blob; keepClip(src, blob); }
    s.pendingUpgrade = blob;
  }
  function swapUpgraded(s) {
    const blob = s.pendingUpgrade; s.pendingUpgrade = null;
    const v = makeVideo(blob);
    v.addEventListener('loadeddata', () => {
      try { v.pause(); } catch (e) {}
      if (userReady) primeVideo(v);
      const old = s.video;
      try { v.currentTime = Math.min(0.999, s.cur) * (v.duration || 1); } catch (e) {}
      s.el.insertBefore(v, old);
      s.video = v; s.isLite = false;
      if (old) { try { URL.revokeObjectURL(old.src); } catch (e) {} old.remove(); }
    }, { once: true });
    v.style.visibility = 'hidden';       // decoding off-stage; shown once it replaces the old one
    v.addEventListener('loadeddata', () => { v.style.visibility = ''; }, { once: true });
    s.el.appendChild(v);
  }

  // The segment the reader is in (or about to enter), for ordering the queue.
  function currentSeg() {
    const y = window.scrollY || window.pageYOffset;
    let ci = 0;
    for (let i = 0; i < NSEG; i++) if (!SEGMENTS[i].dead && y >= SEGMENTS[i].start) ci = i;
    return ci;
  }

  let pumpTimer = 0;
  function pump() {
    if (reduce) return;
    const ci = currentSeg(), now = Date.now();
    const cap = lite ? 1 : 2;
    while (activeLoads < cap) {
      let best = null, bestScore = Infinity;
      for (let i = 0; i < NSEG; i++) {
        const s = SEGMENTS[i];
        if (!wantsClip(s) || s.hasClip || s.loading || now < (s.retryAt || 0)) continue;
        const d = i - ci;
        const score = d >= 0 ? d : 0.5 - d * 1.5;   // ahead first, then behind
        if (score < bestScore) { bestScore = score; best = s; }
      }
      if (!best) break;
      const s = best;
      s.loading = true; activeLoads++;
      s.lastByteAt = Date.now();         // the stall clock starts with the request, not the first byte
      fetchClip(s)
        .then(() => { s.fails = 0; })
        .catch(() => {
          s.fails = (s.fails || 0) + 1;
          const wait = Math.min(30000, 1500 * Math.pow(2, s.fails));
          s.retryAt = Date.now() + wait;
          clearTimeout(pumpTimer); pumpTimer = setTimeout(pump, wait + 50);
        })
        .finally(() => { s.loading = false; activeLoads--; read(); pump(); });
    }
    // Everything this device needs is in: upgrade light clips on a fast connection.
    if (!activeLoads && speedKnown && !lite) {
      const s = SEGMENTS.find(x => wantsClip(x) && x.hasClip && x.isLite && !x.pendingUpgrade && !x.upgrading);
      if (s) {
        s.upgrading = true; activeLoads++;
        upgradeClip(s).catch(() => {}).finally(() => { activeLoads--; pump(); });
      }
    }
  }

  /* ---- the gate ---- */
  const gatePill = el('div', 'sw-gate');
  gatePill.setAttribute('role', 'status'); gatePill.setAttribute('aria-live', 'polite');
  container.appendChild(gatePill);
  let gateSeg = null, gateAt = 0, gateMax = Infinity;
  const EN = () => /^en/i.test(document.documentElement.lang || '');
  function paintGate() {
    if (!gateSeg) return;
    const pct = gateSeg.total ? Math.min(99, Math.round((gateSeg.got || 0) / gateSeg.total * 100)) : null;
    const num = n => EN() ? String(n) : String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
    const label = EN() ? 'Preparing the tour' : 'جارٍ تجهيز الجولة';
    const skip = Date.now() - gateAt > SKIP_AFTER_MS;
    gatePill.innerHTML = '<i class="sw-gate__spin"></i><span>' + label + (pct != null ? ' ' + num(pct) + (EN() ? '%' : '٪') : '…') + '</span>' +
      (skip ? '<button type="button" class="sw-gate__skip">' + (EN() ? 'Skip' : 'تخطَّ') + '</button>' : '');
  }
  gatePill.addEventListener('click', e => {
    if (!e.target.closest('.sw-gate__skip') || !gateSeg) return;
    gateSeg.skipGate = true; read();
  });

  /* The page ends just before the first segment that cannot be shown yet. The
     cross-fade into a segment begins `fade` before its start, so the scroll stops
     there: the room being left stays on its last frame, and the next room's
     poster never starts to show. */
  function applyGate(y, fade) {
    let g = null;
    if (!reduce) {
      for (let i = 0; i < NSEG; i++) {
        const s = SEGMENTS[i];
        if (s.dead || s.skipGate || sceneReady(s)) continue;
        // A download that has gone silent, or keeps failing, releases its room.
        const stalled = s.lastByteAt && Date.now() - s.lastByteAt > STALL_MS;
        if ((s.fails || 0) >= 3 || stalled) { s.skipGate = true; continue; }
        g = s; break;
      }
    }
    const max = g ? Math.max(0, g.start - fade) : Infinity;
    if (g !== gateSeg) { gateSeg = g; gateAt = Date.now(); }
    if (max !== gateMax) {
      gateMax = max;
      track.style.height = (g ? max + vh : totalW * vh + vh) + 'px';
      document.documentElement.classList.toggle('sw-gated', !!g);
    }
    // Shown only to a reader actually waiting at the gate, not to one far above it.
    const waiting = !!g && y >= max - 2;
    gatePill.classList.toggle('is-on', waiting);
    if (waiting) paintGate();
  }
  // Keeps "skip" appearing, and a stalled download releasing, even with no scroll.
  setInterval(() => { if (gateSeg) read(); }, 1000);

  // Kept as the name the rest of the engine uses; the queue does the work now.
  function loadClip() { pump(); }

  /* ---- outro: fade the last leg out and hand off to another page ----------
     config.outro = { href, from }. Across the last section, `from`..1 of its
     scroll drives a full-bleed fade to the page colour; when it completes, the
     browser goes to `href`.

     Two guards, because a page that navigates itself is easy to get wrong:

     1. ARMING. It only fires if the reader has been ABOVE the fade zone since
        the page was shown. Without that, pressing Back — which restores this
        scroll position — would re-fire instantly and trap the reader in a loop
        they cannot escape with the Back button. `pageshow` covers the bfcache
        restore, where no script re-runs and no state resets on its own.
     2. DIRECTION. It fires on the way DOWN only, so scrolling back up THROUGH
        the zone cannot trigger it. */
  const OUTRO = config.outro && config.outro.href ? config.outro : null;
  const outroFrom = OUTRO && OUTRO.from != null ? clamp(OUTRO.from, 0, 0.98) : 0.6;
  let outroVeil = null, outroArmed = false, outroFired = false, lastY = -1, outroT = -1;
  if (OUTRO) {
    outroVeil = el('div', 'sw-outro');
    outroVeil.setAttribute('aria-hidden', 'true');
    container.appendChild(outroVeil);
    // A restore from the back/forward cache does not re-run this file, so re-arm
    // explicitly rather than relying on module state.
    window.addEventListener('pageshow', (e) => {
      outroArmed = false; outroFired = false;
      // Back restores the scroll position that triggered the hand-off, which is a
      // fully-faded screen — the reader would come back to a blank page and have
      // to guess that scrolling up is what reveals the house again. Put them at
      // the end of the last room instead, just above where the fade begins.
      // Rescue only a BACK/FORWARD return, never a fresh load. Scheduling it
      // unconditionally made a normal visit yank the reader backwards: pageshow
      // fires at scroll 0, and the deferred attempt landed ~120ms later, by which
      // time a quick flick had already carried them into the zone.
      // Gating on the scroll position at pageshow does not work either — Chrome
      // restores it AFTER this event, so it always reads 0 here. The navigation
      // type is the one signal available at this moment that is actually correct.
      let backForward = !!e.persisted;
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav && nav.type === 'back_forward') backForward = true;
      } catch (err) {}
      if (!backForward) return;
      // Chrome restores the scroll position asynchronously, and on a bfcache
      // restore it can land AFTER a single rAF — one attempt gets overwritten.
      const rescue = () => {
        const seg = SECTIONS[N - 1]._seg;
        const span = seg.end - seg.start;
        if (!span) return;
        if ((window.scrollY - seg.start) / span >= outroFrom) {
          window.scrollTo({ top: seg.start + span * Math.max(0, outroFrom - 0.1), behavior: 'auto' });
          read();
        }
      };
      requestAnimationFrame(rescue);
      setTimeout(rescue, 120);
    });
  }

  function readOutro(y) {
    if (!OUTRO || !outroVeil) return;
    const seg = SECTIONS[N - 1]._seg;
    const local = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
    const t = outroFrom >= 1 ? 0 : clamp((local - outroFrom) / (1 - outroFrom), 0, 1);
    // Called from the rAF loop as well as from read(), so skip identical writes.
    if (Math.abs(t - outroT) > 0.001) {
      outroT = t;
      outroVeil.style.opacity = t;
      outroVeil.style.pointerEvents = t > 0.98 ? 'auto' : 'none';
    }
    // Armed by leaving the zone upward — either by ending up clear of it, or by
    // scrolling up at all while inside it. The second clause matters if the
    // reposition above ever loses its race with scroll restoration: without it a
    // reader who came Back into the fade would find that scrolling down does
    // nothing (unarmed) and scrolling up is the only way out, with no way to tell.
    if (local < outroFrom - 0.02) outroArmed = true;
    else if (lastY >= 0 && y < lastY) outroArmed = true;
    // Not-going-UP rather than strictly going-down: one long flick, or a jump
    // straight to the end, produces a SINGLE readOutro call, and a strict
    // `y > lastY` left that case un-fired — a reader stranded on a blank veil with
    // no further scroll events to retry on. Arming is what actually prevents the
    // back-button loop; this only stops a fire while travelling upward.
    const notGoingUp = lastY < 0 || y >= lastY;
    lastY = y;
    // 0.995, not 1: scroll positions are fractional, so at the exact end of the
    // last segment t settled at 0.9990 and an `>= 1` test never fired. The veil is
    // visually solid well before this, so the threshold costs nothing.
    if (t >= 0.995 && outroArmed && !outroFired && notGoingUp) {
      outroFired = true;
      window.location.href = OUTRO.href;
    }
  }

  function read() {
    const y = window.scrollY || window.pageYOffset;
    // Portrait phones show static scene images with no camera-scrub, so the whole
    // transition between rooms IS the crossfade — widen it there into a clear,
    // gentle dissolve rather than the tight seam the video flight used.
    const portrait = portraitMQ.matches;
    const fade = (portrait ? 0.5 : CROSSFADE) * vh;
    let ci = 0;
    for (let i = 0; i < NSEG; i++) if (y >= SEGMENTS[i].start) ci = i;
    applyGate(y, fade);

    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (s.dead) continue;                 // collapsed to zero scroll — see layout()
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      s.target = (s.linger ? lingerEase(local, s.linger) : local) * s.clipEnd;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      let op = smooth(1 - outside / fade);
      // An <img> that has not arrived paints nothing, so fading one in is fading
      // the screen OUT. Keep an unloaded portrait scene at zero and let the
      // hold-over below decide what stays on screen instead.
      if (portrait && s.mimg && !s.mready) op = 0;
      s.el.style.opacity = op; s.visible = op > 0.001;
      if (s.pendingUpgrade && !s.visible) swapUpgraded(s);
      s.el.style.zIndex = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      if (!s.hasClip || !s.ready) {
        // '' not 'none': in portrait this element is a CONNECTOR's poster, and the
        // stylesheet's punch-in (--sw-mzoom) has to reach it. An inline 'none'
        // would win the cascade and leave the poster un-zoomed under a zoomed
        // clip — the scene would jump the moment the walk decoded.
        if (portrait) { s.img.style.transform = ''; }
        else {
          /* The poster's ken-burns starts at IDENTITY, so the still and the clip
             frame it stands in for are laid out the same way and the swap to
             video is invisible. It used to start at `translateX(2vw) scale(1.03)`
             — a constant offset the video never had — so the moment a clip
             painted, the whole room jumped sideways by 2vw and shrank by 3%,
             taking every marker with it (measured: 13–76px per marker). That is
             what made the living room look like it "settled into place" a beat
             after opening. The 2vw came from `stageX`, a leftover from a stage
             that used to be inset; .sw-stage is `inset:0` now, so there was
             nothing left for it to compensate for. */
          const sc = reduce ? 1 : 1 + local * 0.14;
          s.img.style.transform = `scale(${sc.toFixed(3)})`;
        }
      }
    }

    /* Hold-over. If the room the visitor has scrolled INTO has not finished
       downloading, the room they came from is on its way to opacity 0 and nothing
       is replacing it — the copy would be left floating over the page colour,
       which is the "the transition is broken" symptom on a slow phone. Pin the
       nearest room that IS loaded at full opacity underneath until the real one
       is ready (its `load` handler calls read() again). The cost of a slow
       connection becomes a late transition instead of an empty screen.
       Only the portrait path needs this: everywhere else the desktop still is
       already painted under the video and covers the same gap. */
    if (portrait) {
      const cur = SEGMENTS[ci];
      if (cur && cur.mimg && !cur.mready) {
        let hold = null;
        for (let i = ci - 1; i >= 0 && !hold; i--) if (SEGMENTS[i].mready) hold = SEGMENTS[i];
        for (let i = ci + 1; i < NSEG && !hold; i++) if (SEGMENTS[i].mready) hold = SEGMENTS[i];
        if (hold) { hold.el.style.opacity = 1; hold.visible = true; hold.el.style.zIndex = '119'; }
      }
    }

    for (let i = 0; i < N; i++) {
      const seg = SECTIONS[i]._seg;
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      const before = y < seg.start, after = y > seg.end;
      let cop;
      if (i === 0) cop = after ? 0 : smooth(1 - pr / 0.62);            // greets on landing
      else if (i === N - 1) cop = before ? 0 : smooth(pr / 0.4);       // holds CTA at the end
      else if (before || after) cop = 0;
      else {
        // The copy peaks at `copyAt` — the scroll progress where this room is
        // actually FRAMED (normally its `showcase` frame, i.e. the view the room
        // dock lands on), not blindly at mid-section. A room whose settle frame
        // sits late in its scroll would otherwise shout on the way in and be
        // gone by the time the reader arrives at the view it describes.
        // Rise/fall are whatever room is left on each side, so the curve is
        // identical to the old symmetric one when copyAt is the default 0.5.
        const at = SECTIONS[i].copyAt != null ? SECTIONS[i].copyAt : 0.5;
        const rise = Math.min(0.5, at), fall = Math.min(0.5, 1 - at);
        cop = pr < at ? (rise ? smooth((pr - at + rise) / rise) : 1)
                      : (fall ? smooth((at + fall - pr) / fall) : 1);
      }
      const c = copies[i];
      c.style.opacity = cop;
      // Desktop: the copy sits at a per-scene vertical anchor (copyY, a fraction
      // of viewport height — default centred) chosen so it never overlaps that
      // room's markers. Its box is centred on copyY, and the parallax shift
      // composes with the -50%. Mobile stays bottom-anchored (CSS), shift only.
      const shift = reduce ? '0vh' : `${(0.5 - pr) * 4}vh`;
      if (window.innerWidth > 860) {
        const cy = SECTIONS[i].copyY != null ? SECTIONS[i].copyY : 0.5;
        const cx = SECTIONS[i].copyX;
        c.style.top = (cy * 100).toFixed(1) + '%';
        if (cx != null) {
          // A room whose reading-start edge is crowded with appliances can pin
          // its copy to a clear patch instead (copyX, a fraction of viewport
          // width, box centred on it). Text ALIGNMENT still follows the
          // language — only the panel's position moves.
          c.style.left = (cx * 100).toFixed(1) + '%'; c.style.right = 'auto';
          c.style.transform = `translate(-50%, calc(-50% + ${shift}))`;
        } else {
          c.style.transform = `translateY(calc(-50% + ${shift}))`;
          // Horizontal side is language-driven — right for Arabic (RTL), left for
          // English (LTR). Set inline so it always wins the cascade.
          if (document.documentElement.dir === 'rtl') { c.style.right = 'clamp(18px,5vw,64px)'; c.style.left = 'auto'; }
          else { c.style.left = 'clamp(18px,5vw,64px)'; c.style.right = 'auto'; }
        }
      } else {
        // Phones: the frosted copy card is pinned per-room over a clear (marker-
        // free) patch of the portrait scene, via mCopyX/mCopyY (viewport
        // fractions, box centred on the point). Falls back to bottom-anchored.
        const my = SECTIONS[i].mCopyY, mx = SECTIONS[i].mCopyX;
        if (my != null) {
          // bottom:auto clears guide.js's dock-clearance rule, which would
          // otherwise pin the card's bottom too and stretch it full-height.
          c.style.top = (my * 100).toFixed(1) + '%'; c.style.bottom = 'auto';
          c.style.left = ((mx != null ? mx : 0.5) * 100).toFixed(1) + '%';
          c.style.right = 'auto';
          c.style.transform = `translate(-50%, calc(-50% + ${shift}))`;
        } else {
          c.style.top = ''; c.style.left = ''; c.style.right = ''; c.style.bottom = '';
          c.style.transform = `translateY(${shift})`;
        }
      }
      c.style.pointerEvents = cop > 0.5 ? 'auto' : 'none';
    }

    const cur = SEGMENTS[ci];
    const near = clamp(cur.kind === 'dive' ? cur.si
      : (((y - cur.start) / (cur.end - cur.start)) > 0.5 ? cur.si + 1 : cur.si), 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === near));
      nav.querySelectorAll('.sw-nav__item').forEach((n, k) => n.classList.toggle('is-active', k === near));
      container.style.setProperty('--sw-accent', SECTIONS[near].accent || '');
    }
    scrollbarFill.style.transform = `scaleX(${clamp(y / (totalW * vh))})`;
    hint.style.opacity = clamp(1 - y / (0.5 * vh));
    if (particles) particles.style.transform = `translate3d(0, ${-y * 0.05}px, 0)`;
    // SADKO extension: let external layers (hotspots) sync to the same scroll frame.
    container.dispatchEvent(new CustomEvent('sw:frame', { detail: { y, vh } }));
    readOutro(y);
    ticking = false;
  }

  function raf() {
    const eps = isMobile() ? 0.02 : 0.008;   // coarser seek step on phones = fewer decodes
    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (s.dead || !s.hasClip || !s.ready || !s.video) continue;
      // Never queue a seek while the decoder is still resolving the last one.
      // On phones a fast flick would otherwise pile up seeks and freeze the clip;
      // cur keeps lerping, so we snap to the latest target the moment it's free.
      if (s.video.seeking) continue;
      if (!s.visible && Math.abs(s.cur - s.target) < 0.002) continue;
      s.cur += (s.target - s.cur) * (reduce ? 1 : 0.18);
      const dur = s.video.duration || 1;
      const t = clamp(s.cur, 0, 0.999) * dur;
      if (Math.abs(s.video.currentTime - t) > eps) { try { s.video.currentTime = t; } catch (e) {} }
    }
    // Drive the hand-off from here too. read() is throttled behind a `ticking`
    // flag on scroll, so one long flick to the very bottom could leave the veil
    // fully drawn with no further scroll event to act on — a reader stranded on a
    // blank screen. This loop always runs, and readOutro() skips repeat writes.
    if (OUTRO && !outroFired) readOutro(window.scrollY || window.pageYOffset);
    requestAnimationFrame(raf);
  }

  // iOS needs a user gesture before a muted video will decode/paint reliably. On the
  // first touch we prime every loaded clip (muted play→pause) so the first seek is
  // instant instead of showing a blank frame. `userReady` also makes freshly-loaded
  // clips prime themselves (see loadClip).
  let userReady = false;
  function primeVideo(v) {
    if (!isMobile() || !v) return;
    try { const p = v.play(); if (p && p.then) p.then(() => { try { v.pause(); } catch (e) {} }).catch(() => {}); }
    catch (e) {}
  }
  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    SEGMENTS.forEach(s => primeVideo(s.video));
  }
  window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
  window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true });

  // Particles are a per-frame cost we can't afford alongside video scrubbing on a phone.
  seedParticles(particles, reduce || coarse);
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(read); } }, { passive: true });
  // Mobile browsers fire `resize` every time the URL bar slides in/out. Re-running
  // layout() there rebuilds the track height and yanks the scroll position, so on
  // touch we ignore height-only changes and only relayout when the width actually
  // changes (rotation still comes through orientationchange). layout() records the
  // width it laid out at.
  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    layout();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);
  layout();
  requestAnimationFrame(raf);

  // SADKO extension: expose enough state for companion layers (hotspots).
  const api = { sections: SECTIONS, segments: SEGMENTS, isMobile, relayout: layout,
    // QA: the hand-off is invisible until it fires, so expose why it has not.
    outroState: () => ({ on: !!OUTRO, from: outroFrom, t: outroT,
                         armed: outroArmed, fired: outroFired, lastY: lastY }),
    // QA: what each transition is doing and why the page may be holding.
    loadState: () => ({ lite, speedKnown, gate: gateSeg ? SEGMENTS.indexOf(gateSeg) : null, gateMax,
      segs: SEGMENTS.map((s, i) => ({ i, kind: s.kind, wants: wantsClip(s), ready: sceneReady(s), lite: !!s.isLite,
        got: s.got || 0, total: s.total || 0, fails: s.fails || 0, skip: !!s.skipGate })) }) };

  // ---- helpers ----
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function ctaBtns(cta) {
    let h = '';
    if (cta.primary) h += `<a class="sw-btn sw-btn--primary" href="${esc(cta.primary.href || '#')}">${esc(cta.primary.label)}</a>`;
    if (cta.secondary) h += `<a class="sw-btn sw-btn--ghost" href="${esc(cta.secondary.href || '#')}">${esc(cta.secondary.label)}</a>`;
    return h;
  }

  return api;
}

function seedParticles(host, reduce) {
  if (!host || reduce) return;
  const kinds = ['dot', 'dot', 'ring'];
  const seeds = [7, 23, 41, 58, 71, 88, 12, 34, 52, 66, 83, 95, 18, 29, 47, 63, 77, 91, 5, 38, 55, 69, 82, 97];
  for (let k = 0; k < 20; k++) {
    const s = document.createElement('span');
    s.className = 'sw-pt sw-pt--' + kinds[k % kinds.length];
    s.style.left = seeds[k % seeds.length] + 'vw';
    s.style.top = ((seeds[(k * 3) % seeds.length] * 1.3) % 100) + 'vh';
    s.style.setProperty('--sw-sc', (0.5 + ((seeds[(k * 5) % seeds.length] % 60) / 60) * 1.1).toFixed(2));
    const dur = 14 + (seeds[(k * 7) % seeds.length] % 22);
    s.style.animationDuration = dur + 's';
    s.style.animationDelay = (-(seeds[(k * 2) % seeds.length] % dur)) + 's';
    host.appendChild(s);
  }
}

function injectCSS() {
  if (document.getElementById('sw-css')) return;
  const css = `
  .sw-root{--sw-bg:#F5EDE0;--sw-ink:#241d2b;--sw-ink-soft:#6a6072;--sw-accent:#8a7bb5;
    --sw-font-display:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;
    --sw-font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    color:var(--sw-ink);font-family:var(--sw-font-body);}
  html,body{margin:0;background:var(--sw-bg,#F5EDE0);overflow-x:hidden;}
  .sw-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--sw-bg);}
  .sw-sky__grad{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--sw-accent) 12%,var(--sw-bg)) 0%,var(--sw-bg) 55%,color-mix(in srgb,var(--sw-accent) 6%,var(--sw-bg)) 100%);}
  .sw-sky__glow{position:absolute;inset:0;background:radial-gradient(60% 42% at 74% 16%,color-mix(in srgb,var(--sw-accent) 22%,transparent),transparent 70%),radial-gradient(46% 34% at 50% 50%,color-mix(in srgb,#fff 45%,transparent),transparent 70%);}
  .sw-particles{position:absolute;inset:-6% -2%;will-change:transform;}
  .sw-pt{position:absolute;width:13px;height:13px;transform:scale(var(--sw-sc,1));opacity:0;animation:sw-drift linear infinite;}
  .sw-pt::before{content:"";position:absolute;inset:0;border-radius:50%;}
  .sw-pt--dot::before{background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--sw-accent) 60%,#000),#000 82%);}
  .sw-pt--ring::before{background:transparent;border:2px solid color-mix(in srgb,var(--sw-accent) 55%,transparent);}
  @keyframes sw-drift{0%{opacity:0;transform:scale(var(--sw-sc)) translate(0,12vh) rotate(0)}12%{opacity:.5}88%{opacity:.45}100%{opacity:0;transform:scale(var(--sw-sc)) translate(4vw,-22vh) rotate(210deg)}}
  /* Outro veil: covers the whole stage as the last leg fades out. Sits above the
     scenes (z 120) and their copy, but below the fixed chrome, so the dock and the
     scroll bar stay readable through the hand-off. */
  .sw-outro{position:fixed;inset:0;z-index:125;opacity:0;pointer-events:none;background:var(--sw-bg,#f7f5f1);transition:opacity .12s linear;}
  .sw-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-scrollbar span{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--sw-accent);}
  .sw-topbar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}
  .sw-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sw-ink);}
  .sw-brand__mark{width:24px;height:28px;border-radius:7px 7px 10px 10px;background:linear-gradient(160deg,var(--sw-accent),color-mix(in srgb,var(--sw-accent) 60%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--sw-accent) 40%,transparent);}
  .sw-brand__name{font-family:var(--sw-font-display);font-weight:700;font-size:1.1rem;}
  .sw-nav{display:flex;gap:4px;padding:5px;background:color-mix(in srgb,#fff 55%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--sw-accent) 16%,transparent);border-radius:999px;}
  .sw-nav__item{font:inherit;font-size:.82rem;color:var(--sw-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 14px;border-radius:999px;transition:color .25s,background .25s;}
  .sw-nav__item:hover{color:var(--sw-ink);} .sw-nav__item.is-active{color:#fff;background:var(--sw-accent);}
  .sw-topcta{text-decoration:none;font-weight:600;font-size:.9rem;color:#fff;background:var(--sw-ink);padding:10px 20px;border-radius:999px;white-space:nowrap;}
  .sw-stage{position:fixed;inset:0;z-index:10;pointer-events:none;}
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}
  .sw-gate{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 104px);transform:translate(-50%,12px);z-index:400;display:flex;align-items:center;gap:10px;padding:9px 16px;border-radius:999px;background:rgba(255,255,255,.86);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 6px 24px rgba(36,29,43,.16);font:600 14px/1.2 var(--sw-font-body);color:var(--sw-ink);opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;white-space:nowrap;}
  .sw-gate.is-on{opacity:1;transform:translate(-50%,0);pointer-events:auto;}
  .sw-gate__spin{width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);border-top-color:var(--sw-accent);animation:sw-spin .8s linear infinite;}
  .sw-gate__skip{margin-inline-start:4px;border:0;background:transparent;color:var(--sw-accent);font:700 13px/1 var(--sw-font-body);cursor:pointer;padding:4px 2px;text-decoration:underline;}
  @keyframes sw-spin{to{transform:rotate(360deg)}}
  html.sw-gated .sk-foot{display:none !important;}
  .sw-scene__video,.sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;z-index:1;}
  .sw-scene__still{will-change:transform;} .sw-scene.has-clip .sw-scene__still{opacity:0;}
  .sw-scene__bg{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;}
  /* Portrait-phone scene image: hidden on desktop, shown (whole, letterboxed) in
     the portrait block below where it replaces the video/desktop-still entirely. */
  .sw-scene__mstill{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center center;z-index:2;}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  /* RTL (Arabic): the over-constrained scrim auto-anchors to the right edge; only
     its gradient needs flipping so the opaque side sits behind the right-hand copy. */
  [dir=rtl] .sw-copylayer::before{background:linear-gradient(270deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  /* English (LTR) copy sits on the left; the vertical anchor (top) is set per scene
     by JS. Arabic flips it to the right on desktop (below) — the reading-start side. */
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:50%;transform:translateY(-50%);width:min(42vw,460px);opacity:0;will-change:opacity,transform;}
  @media (min-width:861px){ html[dir=rtl] .sw-copy{left:auto;right:clamp(18px,5vw,64px);} }
  .sw-copy__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.12em;color:var(--sw-ink-soft);}
  .sw-copy__eyebrow{display:block;margin-top:18px;font-family:var(--sw-font-display);font-weight:800;font-size:clamp(1rem,1.25vw,1.22rem);line-height:1.35;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,var(--sw-accent) 55%,#14343a);}
  /* Arabic letters join: any letter-spacing pulls the word apart, so none in RTL */
  [dir=rtl] .sw-copy__eyebrow{letter-spacing:0;}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;margin:12px 0 0;letter-spacing:-.01em;text-shadow:0 2px 20px color-mix(in srgb,var(--sw-bg) 70%,transparent);}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;color:color-mix(in srgb,var(--sw-ink) 78%,var(--sw-ink-soft));max-width:40ch;text-shadow:0 1px 12px color-mix(in srgb,var(--sw-bg) 90%,transparent);}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-size:.82rem;font-weight:600;color:color-mix(in srgb,var(--sw-accent) 70%,#000);padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--sw-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);}
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}
  .sw-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;}
  .sw-btn--primary{color:#fff;background:var(--sw-ink);} .sw-btn--primary:hover{transform:translateY(-2px);}
  .sw-btn--ghost{color:var(--sw-ink);border:1.5px solid color-mix(in srgb,var(--sw-ink) 25%,transparent);} .sw-btn--ghost:hover{transform:translateY(-2px);}
  .sw-route{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;z-index:40;transform:translateY(-50%);display:flex;flex-direction:column;gap:22px;padding:18px 10px;}
  .sw-route::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:var(--sw-accent);opacity:.28;}
  .sw-route__dot{position:relative;border:0;background:transparent;cursor:pointer;width:14px;height:14px;display:grid;place-items:center;}
  .sw-route__dot i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--sw-accent) 40%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}
  .sw-route__dot:hover i{transform:scale(1.25);background:var(--sw-accent);}
  .sw-route__dot.is-active i{background:var(--sw-accent);transform:scale(1.4);box-shadow:0 0 0 5px color-mix(in srgb,var(--sw-accent) 22%,transparent);}
  .sw-route__label{position:absolute;right:24px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-size:.78rem;font-weight:600;color:var(--sw-ink);background:color-mix(in srgb,#fff 85%,transparent);backdrop-filter:blur(6px);padding:5px 11px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border:1px solid color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-route__dot:hover .sw-route__label,.sw-route__dot.is-active .sw-route__label{opacity:1;transform:translateY(-50%) translateX(0);}
  /* The one instruction on the page, so it has to survive being read over a
     photograph. It used to be .76rem of --sw-ink-soft in uppercase with .14em of
     tracking and nothing behind it: thin, low-contrast, and — because the default
     copy is Arabic — actively broken, since letter-spacing pulls apart the joins
     that make an Arabic word a word, and text-transform does nothing for it at
     all. Now white, bigger, and carried by shadow rather than by a panel — it sits
     directly on the scene so nothing is drawn over the artwork. */
  .sw-hint{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);
    display:flex;flex-direction:column;align-items:center;gap:11px;
    font-size:clamp(1.02rem,1.9vw,1.22rem);font-weight:400;line-height:1.3;color:#fff;
    /* No panel behind it, so the shadow IS the legibility: these rooms are bright
       cream interiors, and white on cream with nothing under it disappears. Two
       stacked shadows — a tight dark one to define the letterforms, a wide soft
       one to lift them off whatever is behind — keep it readable on the light
       floors and the dark furniture alike, without putting a box on the artwork. */
    text-shadow:0 1px 3px rgba(10,26,29,.55), 0 3px 16px rgba(10,26,29,.45);
    transition:opacity .3s;}
  /* The mouse: white to match the words, and thick enough to hold up against a
     busy scene. drop-shadow (not box-shadow) so the glow follows the rounded
     outline rather than boxing it. */
  .sw-hint i{width:25px;height:39px;border-radius:13px;
    border:2.5px solid #fff;position:relative;
    filter:drop-shadow(0 1px 3px rgba(10,26,29,.5)) drop-shadow(0 3px 12px rgba(10,26,29,.4));}
  .sw-hint i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:9px;border-radius:2px;background:#fff;transform:translateX(-50%);animation:sw-wheel 1.7s ease-in-out infinite;}
  @keyframes sw-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}
  .sw-track{position:relative;z-index:1;width:100%;pointer-events:none;}
  @media (max-width:860px){
    .sw-nav{display:none;}
    /* The copy is a content-sized frosted card the engine pins per-room over a
       clear patch of the scene (mCopyX/mCopyY) — not a bottom banner — so drop the
       bottom pinning and let JS place it. Width tracks the phone. */
    .sw-copy{width:min(74vw,340px);max-width:none;}
    /* Compact, top-centred header card: tighten the gap under the 01/04 line so
       the three lines sit close together instead of spanning a tall block. */
    .sw-copy__eyebrow{margin-top:3px;font-size:clamp(.98rem,4vw,1.12rem);}
    .sw-copy__title{margin-top:2px;font-size:clamp(1.5rem,5.8vw,2.1rem);line-height:1.12;}
    .sw-copy__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem);} .sw-scene__video,.sw-scene__still{object-position:center 46%;}
    .sw-hint{bottom:calc(20px + env(safe-area-inset-bottom));}
    .sw-route{gap:16px;right:6px;} .sw-route__label{display:none;}
  }
  /* Portrait phones use the bespoke portrait scene image (m_<room>.jpg): show it
     whole (contain, plain letterbox) and hide the desktop video/still entirely.
     Rooms cross-dissolve as you scroll — no camera-scrub here. */
  /* Scoped to .sw-scene--m — the scenes that HAVE a portrait image of their own,
     i.e. the rooms. It used to hide every video on the portrait breakpoint, which
     also silenced the connector clips that carry the movement BETWEEN rooms and
     left portrait phones with nothing but a cross-dissolve from one static room
     to the next. A connector scene has no portrait still (its footage is already
     portrait), so it keeps its video here and plays it. */
  @media (max-width:860px) and (orientation:portrait){
    .sw-scene--m .sw-scene__mstill{display:block;}
    .sw-scene--m .sw-scene__video,.sw-scene--m .sw-scene__still,.sw-scene--m .sw-scene__bg{display:none !important;}
    /* A room image and the connector clip it hands over to are the same footage
       here, so they must also be FRAMED the same: centred, like the room image
       (and like the portrait mapping hotspots.js uses to place markers). The
       landscape breakpoint above anchors video at 46% for the 16:9 flight; left
       in place it would shift the walk 4% of a screen against the room it walks
       out of, and every marker with it. */
    .sw-scene__video,.sw-scene__still{object-position:center center;}

    /* PORTRAIT PUNCH-IN. The walk footage is framed wide — the appliances live in
       the middle third and the rest is ceiling and floor — so on a phone every
       product was small. This scales the scene up about its centre and lets the
       edges crop.

       --sw-mzoom is the single source of truth: hotspots.js reads this same
       custom property (as it already does for --sw-objy) and multiplies its
       marker mapping by it, so the picture and the points scale together and a
       marker cannot drift off its appliance. Change it here and both follow.

       1.12 is the ceiling, not a taste call. It is set by the outermost markers:
       the laundry's personal-care shelf at 0.914 and the kitchen's microwave at
       0.088 sit almost at the frame edges, and past 1.12 their pulse rings start
       leaving the screen on a 360px phone. Zooming further would enlarge the
       appliances by hiding the ones on the sides. */
    :where(.sw-root),.sw-root{--sw-mzoom:1.12;}
    .sw-scene__video,.sw-scene__mstill,.sw-scene__still{
      transform:scale(var(--sw-mzoom));transform-origin:center center;}
  }
  /* Touch: give the route dots a finger-sized hit area without growing the visible dot. */
  @media (hover:none) and (pointer:coarse){
    .sw-route{padding:14px 6px;}
    .sw-route__dot{width:28px;height:28px;}
    .sw-btn{padding:15px 26px;}
  }
  @media (prefers-reduced-motion:reduce){ .sw-hint i::after{animation:none;} .sw-pt{display:none;} }
  `;
  // Wrap in a cascade layer so the page's own theme tokens (unlayered
  // :root / .sw-root { --sw-bg / --sw-ink / --sw-accent … }) always win over
  // these defaults, regardless of injection order. Enables clean dark themes.
  const style = document.createElement('style'); style.id = 'sw-css';
  style.textContent = '@layer sw {\n' + css + '\n}';
  document.head.appendChild(style);
}

// Expose for module + global use.
if (typeof module !== 'undefined' && module.exports) module.exports = { mountScrollWorld };
if (typeof window !== 'undefined') window.mountScrollWorld = mountScrollWorld;
