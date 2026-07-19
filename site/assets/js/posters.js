/* ============================================================================
   SADKO living posters — offers & ads rotating inside the finale room's
   picture frames.
   ----------------------------------------------------------------------------
   The final scene's gallery wall is generated with three large blank cream
   canvases facing the camera at the section's settle band. This module pins
   DOM "posters" onto those canvases (same frame→screen mapping as hotspots.js,
   16:9 source frame, object-fit:cover + --sw-objy) and rotates the website's
   real offers through them with a soft crossfade — so the room's decor IS the
   ad space, no appliances needed.

   mountPosters(container, api, si, {
     at: 0.62, span: 0.3,     // scroll band of the settle frame (like hotspots)
     slots: [{fx,fy,fw,fh}],  // canvas rects, fractions of the SOURCE frame
     feeds: [{href, badge, categoryId}], // rotation feeds, one per slot (wraps)
   })

   Content comes from data/products.json (categoryId filter per feed). Cards
   show product image + title + price + a small badge, and click through to
   the feed's shop page. An "about" card (family story) is woven into the
   rotation as every 4th card on slot 0.

   TUNING: open with ?frames — click twice (top-left then bottom-right of a
   canvas) to log a {fx,fy,fw,fh} rect for pasting into the config.
   ========================================================================== */

function mountPosters(container, api, si, config) {
  const FRAME_W = 16, FRAME_H = 9;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const debug = new URLSearchParams(location.search).has('frames');
  const section = api.sections[si];
  if (!section || !section._seg) return;

  injectPosterCSS();

  const PS_EN = !!(window.skLang && window.skLang.get() === 'en');
  const psTitle = t => {
    const clean = String(t || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return PS_EN && window.skCatalogI18n ? window.skCatalogI18n.translateTitle(clean) : clean;
  };

  const layer = document.createElement('div');
  layer.className = 'ps-layer';
  layer.style.setProperty('--ps-accent', section.accent || 'var(--sw-accent)');
  container.appendChild(layer);

  // ---- slots ----
  const slots = (config.slots || []).map((r, k) => {
    const feed = config.feeds[k % config.feeds.length] || {};
    const a = document.createElement('a');
    a.className = 'ps-card';
    a.href = feed.href || '#';
    a.setAttribute('aria-label', PS_EN ? 'See this offer in the shop' : 'شوف العرض فى المتجر');
    a.innerHTML = `<span class="ps-card__badge"></span><span class="ps-card__img"></span>` +
                  `<span class="ps-card__meta"><b class="ps-card__title"></b><i class="ps-card__price"></i></span>`;
    layer.appendChild(a);
    return { el: a, rect: r, feed, items: [], idx: -1, timer: null };
  });

  // ---- content: real products from the catalog ----
  // The offers/best-sellers pages are promo collections with no product rows in
  // products.json, so each feed lists the real categoryIds to sample instead.
  fetch('data/products.json').then(r => r.json()).then(d => {
    const all = (d.products || []).filter(p => p.image);
    slots.forEach((s, k) => {
      const ids = (s.feed.categoryIds || []).map(String);
      let pool = all.filter(p => ids.includes(String(p.categoryId)));
      if (!pool.length) pool = all;
      // Cheapest-first reads as "offers"; interleave so frames differ.
      pool = pool.slice().sort((a, b) => (a.price || 9e9) - (b.price || 9e9)).slice(0, 36);
      s.items = pool.filter((_, i) => i % slots.length === k);
      if (!s.items.length) s.items = pool.slice(0, 8);
      s.about = (k === 0);           // slot 0 weaves in the family-story card
      advance(s, 0);
      // Staggered rotation: the wall ripples — one frame swaps every ~2.6s,
      // each individual frame changes every ~7.8s.
      setTimeout(() => {
        if (visible) advance(s);
        s.timer = setInterval(() => { if (visible) advance(s); }, 7800);
      }, 2600 * (k + 1));
    });
  }).catch(() => {});

  let aboutTick = 0;
  function advance(s, force) {
    if (!s.items.length) return;
    s.idx = force != null ? force : (s.idx + 1) % (s.items.length);
    const el = s.el;
    el.classList.add('is-swap');
    setTimeout(() => {
      // every 4th swap on the story slot shows the family card instead
      if (s.about && (++aboutTick % 4 === 0)) {
        el.classList.add('ps-card--about');
        el.querySelector('.ps-card__badge').textContent = PS_EN ? 'Since 1961' : 'من 1961';
        el.querySelector('.ps-card__img').style.backgroundImage = '';
        el.querySelector('.ps-card__title').textContent = PS_EN ? 'SADKO Group — a family story' : 'صادكو جروب — حكاية عيلة';
        el.querySelector('.ps-card__price').textContent = PS_EN
          ? 'An extension of the Ghabbour family legacy… service trusted by 40,000+ customers a year'
          : 'امتداد لإرث عيلة غبور… خدمة بيشهد لها +40,000 عميل سنويًا';
      } else {
        const p = s.items[s.idx];
        el.classList.remove('ps-card--about');
        el.querySelector('.ps-card__badge').textContent = s.feed.badge || (PS_EN ? 'Offer' : 'عرض');
        el.querySelector('.ps-card__img').style.backgroundImage = `url("${p.image}")`;
        el.querySelector('.ps-card__title').textContent = psTitle(p.title);
        el.querySelector('.ps-card__price').textContent = (typeof p.price === 'number') ? p.price.toLocaleString('en-US') + ' ' + (PS_EN ? 'EGP' : 'جنيه') : (p.price || '');
      }
      el.classList.remove('is-swap');
    }, 380);
  }

  // ---- frame → screen mapping (same convention as hotspots.js) ----
  // Measured against the stage box (excludes the scrollbar), not the window —
  // window-based mapping drifts with browser zoom.
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
    return { dw, dh, ox: r.left + (r.width - dw) * 0.5, oy: r.top + (r.height - dh) * objY() };
  }
  function place() {
    const m = metrics();
    slots.forEach(s => {
      const r = s.rect;
      s.el.style.left = (m.ox + r.fx * m.dw) + 'px';
      s.el.style.top = (m.oy + r.fy * m.dh) + 'px';
      s.el.style.width = (r.fw * m.dw) + 'px';
      s.el.style.height = (r.fh * m.dh) + 'px';
    });
  }

  // ---- visibility: only while the finale is settled on the wall ----
  let visible = false;
  container.addEventListener('sw:frame', e => {
    const seg = section._seg;
    const pr = clamp((e.detail.y - seg.start) / (seg.end - seg.start), 0, 1);
    const op = seg.visible ? smooth(1 - Math.abs(pr - (config.at ?? 0.62)) / (config.span ?? 0.3)) : 0;
    layer.style.opacity = op;
    visible = op > 0.35;
    layer.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
  });
  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', place);
  place();

  // ---- rect tuning helper ----
  if (debug) {
    let first = null;
    const badge = document.createElement('div');
    badge.className = 'ps-debug';
    badge.textContent = 'poster tuning: click top-left, then bottom-right of a canvas';
    document.body.appendChild(badge);
    window.addEventListener('click', e => {
      const m = metrics();
      const fx = +((e.clientX - m.ox) / m.dw).toFixed(3), fy = +((e.clientY - m.oy) / m.dh).toFixed(3);
      if (!first) { first = { fx, fy }; badge.textContent = `corner 1: ${fx}, ${fy} — now click bottom-right`; }
      else {
        const rect = `{ fx: ${first.fx}, fy: ${first.fy}, fw: ${(fx - first.fx).toFixed(3)}, fh: ${(fy - first.fy).toFixed(3)} },`;
        console.log(rect); badge.textContent = rect + ' (logged)';
        first = null;
      }
    });
  }
}

function injectPosterCSS() {
  if (document.getElementById('ps-css')) return;
  const css = `
  .ps-layer{position:fixed;inset:0;z-index:24;opacity:0;pointer-events:none;transition:opacity .25s linear;}
  .ps-card{position:absolute;display:flex;flex-direction:column;text-decoration:none;direction:rtl;
    overflow:hidden;border-radius:4px;background:#f4efe6;
    box-shadow:inset 0 0 18px rgba(60,40,20,.18), inset 0 0 3px rgba(60,40,20,.25);
    transition:opacity .38s ease, transform .38s ease;}
  .ps-card.is-swap{opacity:0;transform:scale(.985);}
  .ps-card:hover{transform:scale(1.02);}
  .ps-card__img{flex:1 1 auto;margin:7% 9% 2%;background:center/contain no-repeat;
    filter:sepia(.08) saturate(.92);}
  .ps-card__badge{position:absolute;top:5%;right:7%;z-index:2;font:800 .68rem/1 var(--sw-font-display,inherit);
    color:#241a05;background:var(--sadko-amber,#fe9800);border-radius:999px;padding:4px 9px;
    box-shadow:0 2px 8px rgba(0,0,0,.2);}
  .ps-card__meta{flex:0 0 auto;padding:2% 8% 7%;text-align:center;font-family:var(--sw-font-display,inherit);}
  .ps-card__title{display:block;font-size:clamp(.55rem,.9vw,.8rem);font-weight:800;color:#2b2318;
    line-height:1.35;max-height:2.7em;overflow:hidden;}
  .ps-card__price{display:block;font-style:normal;margin-top:3px;font-size:clamp(.6rem,.95vw,.85rem);
    font-weight:800;color:var(--sadko-teal-deep,#2e7e88);direction:ltr;}
  .ps-card--about{background:linear-gradient(160deg,#f7f2e8,#efe3cd);}
  .ps-card--about .ps-card__title{font-size:clamp(.62rem,1vw,.9rem);margin-top:14%;}
  .ps-card--about .ps-card__price{font-weight:600;color:#5c5142;direction:rtl;font-size:clamp(.5rem,.8vw,.72rem);line-height:1.5;white-space:normal;}
  .ps-debug{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:999;
    font:600 12px/1 ui-monospace,monospace;color:#fff;background:#7c3aed;padding:8px 14px;border-radius:999px;}
  /* English (LTR) page: mirror the rtl-authored pieces */
  html[dir=ltr] .ps-card,html[dir=ltr] .ps-card--about .ps-card__price{direction:ltr;}
  `;
  const style = document.createElement('style');
  style.id = 'ps-css';
  style.textContent = css;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') window.mountPosters = mountPosters;
