/* ============================================================================
   SADKO offers board — ONE big rotating deal container on the finale room's
   gallery wall.
   ----------------------------------------------------------------------------
   The final scene's gallery wall has three blank cream canvases. This module
   pins a SINGLE wide container over the combined area of those three panels
   (their bounding box) and rotates the website's real offers/best-sellers/
   discount deals through it — one at a time, auto-advancing, with a ‹ / › arrow
   on each side to step to the previous / next deal by hand. Clicking the board
   itself opens that deal's shop page.

   mountPosters(container, api, si, {
     at, span,                 // scroll band of the settle frame (desktop only)
     slots:       [{fx,fy,fw,fh}×3],  // the panels on the DESKTOP 16:9 frame
     slotsMobile: [{fx,fy,fw,fh}×3],  // the panels on the PORTRAIT phone frame
     feeds:       [{href, badge, categoryIds}],  // collections to pull deals from
   })
   The board spans the bounding box of the three slots (incl. the gaps), so its
   "exact dimensions" match the three portraits together.
   ========================================================================== */

function mountPosters(container, api, si, config) {
  const FRAME_W = 16, FRAME_H = 9;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const section = api.sections[si];
  if (!section || !section._seg) return;

  injectPosterCSS();

  const PS_EN = !!(window.skLang && window.skLang.get() === 'en');
  const psTitle = t => {
    const clean = String(t || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return PS_EN && window.skCatalogI18n ? window.skCatalogI18n.translateTitle(clean) : clean;
  };

  // The board spans the bounding box of the three panel slots.
  const bbox = rects => {
    const x1 = Math.min(...rects.map(r => r.fx)), y1 = Math.min(...rects.map(r => r.fy));
    const x2 = Math.max(...rects.map(r => r.fx + r.fw)), y2 = Math.max(...rects.map(r => r.fy + r.fh));
    return { fx: x1, fy: y1, fw: x2 - x1, fh: y2 - y1 };
  };
  const BOX = bbox(config.slots || [{ fx: 0.25, fy: 0.24, fw: 0.5, fh: 0.32 }]);
  // Phones can carry an explicit, larger board rect (config.boardMobile) so the
  // deal board reads big on a small screen; otherwise fall back to the panels' box.
  const BOXM = config.boardMobile
    || ((config.slotsMobile && config.slotsMobile.length) ? bbox(config.slotsMobile) : BOX);

  const layer = document.createElement('div');
  layer.className = 'ps-layer';
  layer.style.setProperty('--ps-accent', section.accent || 'var(--sw-accent)');

  const stage = document.createElement('div');
  stage.className = 'ps-stage';
  const card = document.createElement('a');
  card.className = 'ps-card';
  card.setAttribute('aria-label', PS_EN ? 'Open this deal in the shop' : 'افتح العرض فى المتجر');
  card.innerHTML =
    `<span class="ps-card__img"></span>` +
    `<span class="ps-card__meta"><span class="ps-card__badge"></span>` +
    `<b class="ps-card__title"></b><i class="ps-card__price"></i>` +
    `<span class="ps-card__cta">${PS_EN ? 'Shop now' : 'اشترِ الآن'}</span></span>`;
  const prev = document.createElement('button');
  prev.type = 'button'; prev.className = 'ps-arrow ps-arrow--prev';
  prev.setAttribute('aria-label', PS_EN ? 'Previous deal' : 'العرض السابق'); prev.innerHTML = '&#8249;';
  const next = document.createElement('button');
  next.type = 'button'; next.className = 'ps-arrow ps-arrow--next';
  next.setAttribute('aria-label', PS_EN ? 'Next deal' : 'العرض التالى'); next.innerHTML = '&#8250;';
  const dots = document.createElement('div'); dots.className = 'ps-dots';
  stage.appendChild(card); stage.appendChild(prev); stage.appendChild(next); stage.appendChild(dots);
  layer.appendChild(stage);
  container.appendChild(layer);

  // ---- content: one merged deck of real deals ----
  let items = [], idx = 0, timer = null;
  fetch('data/products.json').then(r => r.json()).then(d => {
    const all = (d.products || []).filter(p => p.image);
    const feeds = config.feeds || [];
    const pools = feeds.map(feed => {
      const ids = (feed.categoryIds || []).map(String);
      let pool = all.filter(p => ids.includes(String(p.categoryId)));
      if (!pool.length) pool = all;
      // cheapest-first reads as "offers"
      pool = pool.slice().sort((a, b) => (a.price || 9e9) - (b.price || 9e9)).slice(0, 12);
      return pool.map(p => ({ image: p.image, title: psTitle(p.title), price: p.price, href: feed.href, badge: feed.badge }));
    });
    // Round-robin across the feeds so consecutive deals differ in collection.
    const merged = [];
    for (let i = 0, more = true; more; i++) {
      more = false;
      pools.forEach(pool => { if (pool[i]) { merged.push(pool[i]); more = true; } });
    }
    // Weave the family-story card in every 6th slide.
    merged.forEach((it, k) => { items.push(it); if ((k + 1) % 6 === 0) items.push({ about: true }); });
    if (!items.length) return;
    buildDots();
    idx = 0; render(); restartTimer();
  }).catch(() => {});

  function render() {
    const it = items[idx]; if (!it) return;
    const badge = card.querySelector('.ps-card__badge'), img = card.querySelector('.ps-card__img'),
          title = card.querySelector('.ps-card__title'), price = card.querySelector('.ps-card__price'),
          cta = card.querySelector('.ps-card__cta');
    if (it.about) {
      card.classList.add('ps-card--about'); card.href = '#';
      badge.textContent = PS_EN ? 'Since 1961' : 'من 1961';
      img.style.backgroundImage = '';
      title.textContent = PS_EN ? 'SADKO Group: a family story' : 'صادكو جروب: حكاية عيلة';
      price.textContent = PS_EN
        ? 'An extension of the Ghabbour family legacy, service trusted by 40,000+ customers a year'
        : 'امتداد لإرث عيلة غبور، خدمة بيشهد لها +40,000 عميل سنويًا';
      cta.style.visibility = 'hidden';
    } else {
      card.classList.remove('ps-card--about'); card.href = it.href || '#';
      badge.textContent = it.badge || (PS_EN ? 'Offer' : 'عرض');
      img.style.backgroundImage = `url("${it.image}")`;
      title.textContent = it.title;
      price.textContent = (typeof it.price === 'number') ? it.price.toLocaleString('en-US') + ' ' + (PS_EN ? 'EGP' : 'جنيه') : (it.price || '');
      cta.style.visibility = '';
    }
    [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === idx));
  }
  function go(dir) {
    if (!items.length) return;
    idx = (idx + dir + items.length) % items.length;
    card.classList.add('is-swap');
    setTimeout(() => { render(); card.classList.remove('is-swap'); }, 280);
  }
  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(() => { if (visible) go(1); }, 5200);
  }
  function buildDots() {
    dots.innerHTML = '';
    // cap the indicator so a long deck doesn't overflow the board
    const n = Math.min(items.length, 12);
    for (let k = 0; k < n; k++) { const s = document.createElement('i'); dots.appendChild(s); }
  }
  // Arrows step the deck by hand (and restart the auto-timer). stopPropagation +
  // preventDefault so the click doesn't also open the board's shop link.
  prev.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); go(-1); restartTimer(); });
  next.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); go(1); restartTimer(); });

  // ---- frame → screen mapping (same convention as hotspots.js) ----
  const stageEl = container.querySelector('.sw-stage') || container;
  function objY() {
    const v = getComputedStyle(container).getPropertyValue('--sw-objy').trim();
    const n = parseFloat(v);
    return isNaN(n) ? 0.42 : n / 100;
  }
  // Portrait phones show the bespoke portrait offers image (m_offers.jpg,
  // 1080×2160, object-fit:cover centred) with its own panel rects (slotsMobile).
  const MFRAME_W = 1080, MFRAME_H = 2160;
  const containMQ = window.matchMedia('(max-width: 860px) and (orientation: portrait)');
  function metrics() {
    const r = stageEl.getBoundingClientRect();
    if (containMQ.matches) {
      const s = Math.max(r.width / MFRAME_W, r.height / MFRAME_H);   // cover
      const dw = MFRAME_W * s, dh = MFRAME_H * s;
      return { dw, dh, ox: r.left + (r.width - dw) * 0.5, oy: r.top + (r.height - dh) * 0.5 };
    }
    const s = Math.max(r.width / FRAME_W, r.height / FRAME_H);
    const dw = FRAME_W * s, dh = FRAME_H * s;
    return { dw, dh, ox: r.left + (r.width - dw) * 0.5, oy: r.top + (r.height - dh) * objY() };
  }
  function place() {
    const m = metrics();
    const r = containMQ.matches ? BOXM : BOX;
    stage.style.left = (m.ox + r.fx * m.dw) + 'px';
    stage.style.top = (m.oy + r.fy * m.dh) + 'px';
    stage.style.width = (r.fw * m.dw) + 'px';
    stage.style.height = (r.fh * m.dh) + 'px';
  }

  // ---- visibility: only while the finale is settled on the wall ----
  let visible = false;
  container.addEventListener('sw:frame', e => {
    const seg = section._seg;
    const pr = clamp((e.detail.y - seg.start) / (seg.end - seg.start), 0, 1);
    // Portrait phones show a static scene, so the board lives the whole time the
    // offers room is on screen; desktop keeps it tied to the settle band.
    const op = containMQ.matches
      ? (seg.visible ? 1 : 0)
      : (seg.visible ? smooth(1 - Math.abs(pr - (config.at ?? 0.62)) / (config.span ?? 0.3)) : 0);
    layer.style.opacity = op;
    visible = op > 0.35;
    layer.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
  });
  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', place);
  place();
}

function injectPosterCSS() {
  if (document.getElementById('ps-css')) return;
  const css = `
  .ps-layer{position:fixed;inset:0;z-index:24;opacity:0;pointer-events:none;transition:opacity .25s linear;}
  .ps-stage{position:absolute;}
  /* the single wide deal board spanning the three panels */
  .ps-card{position:absolute;inset:0;display:flex;flex-direction:row-reverse;align-items:stretch;
    text-decoration:none;direction:rtl;overflow:hidden;border-radius:6px;background:#f6f1e8;
    box-shadow:inset 0 0 26px rgba(60,40,20,.16), 0 8px 26px rgba(0,0,0,.28);
    transition:opacity .3s ease, transform .3s ease;}
  .ps-card.is-swap{opacity:0;transform:scale(.99);}
  .ps-card:hover{transform:scale(1.008);}
  .ps-card__img{flex:0 0 40%;margin:3.5%;background:center/contain no-repeat;filter:sepia(.05) saturate(.95);}
  .ps-card__meta{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;
    padding:3% 5% 3% 3%;text-align:right;font-family:var(--sw-font-display,inherit);gap:2%;}
  .ps-card__badge{align-self:flex-start;font:800 clamp(.6rem,1.1vw,.82rem)/1 var(--sw-font-display,inherit);
    color:#241a05;background:var(--sadko-amber,#fe9800);border-radius:999px;padding:5px 11px;
    box-shadow:0 2px 8px rgba(0,0,0,.2);}
  .ps-card__title{display:block;font-size:clamp(.72rem,1.5vw,1.2rem);font-weight:800;color:#2b2318;
    line-height:1.3;max-height:2.7em;overflow:hidden;}
  .ps-card__price{display:block;font-style:normal;font-size:clamp(.8rem,1.8vw,1.35rem);
    font-weight:800;color:var(--sadko-teal-deep,#68D1D4);direction:ltr;}
  .ps-card__cta{display:inline-block;font-size:clamp(.6rem,1.1vw,.8rem);font-weight:700;color:#14343a;
    background:var(--sadko-teal-deep,#68D1D4);border-radius:999px;padding:5px 14px;margin-top:2%;}
  .ps-card--about{background:linear-gradient(160deg,#f7f2e8,#efe3cd);}
  .ps-card--about .ps-card__img{flex-basis:26%;}
  .ps-card--about .ps-card__price{font-weight:600;color:#5c5142;direction:rtl;font-size:clamp(.62rem,1.1vw,.9rem);line-height:1.5;white-space:normal;}
  /* side arrows */
  .ps-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:3;cursor:pointer;
    width:clamp(28px,3.4vw,40px);height:clamp(28px,3.4vw,40px);border-radius:50%;border:0;
    background:rgba(255,255,255,.94);color:#241a05;display:grid;place-items:center;
    font:700 clamp(18px,2.2vw,26px)/1 system-ui;padding:0 0 3px;
    /* the ‹ › glyphs are bidi-mirroring: force LTR so they look identical in
       Arabic and English (‹ always points left, › always right). */
    direction:ltr;unicode-bidi:isolate;
    box-shadow:0 3px 12px rgba(0,0,0,.34);transition:transform .15s, background .15s;}
  .ps-arrow:hover{background:#fff;transform:translateY(-50%) scale(1.08);}
  .ps-arrow--prev{left:-3%;} .ps-arrow--next{right:-3%;}
  /* slide indicator */
  .ps-dots{position:absolute;left:0;right:0;bottom:4%;display:flex;gap:5px;justify-content:center;pointer-events:none;}
  .ps-dots i{width:5px;height:5px;border-radius:50%;background:rgba(60,40,20,.28);transition:background .2s,transform .2s;}
  .ps-dots i.is-on{background:var(--sadko-teal-deep,#68D1D4);transform:scale(1.4);}
  html[dir=ltr] .ps-card,html[dir=ltr] .ps-card--about .ps-card__price{direction:ltr;}
  html[dir=ltr] .ps-card__meta{text-align:left;}
  @media (max-width:860px){
    .ps-card__meta{padding:2% 4%;} .ps-card__cta{display:none;}
    .ps-card__title{font-size:clamp(.62rem,3vw,.9rem);} .ps-card__price{font-size:clamp(.66rem,3.4vw,.95rem);}
    .ps-card__badge{font-size:clamp(.52rem,2.6vw,.72rem);padding:3px 8px;}
    .ps-arrow{width:26px;height:26px;font-size:17px;}
    .ps-dots{bottom:3%;} .ps-dots i{width:4px;height:4px;}
  }
  `;
  const style = document.createElement('style');
  style.id = 'ps-css';
  style.textContent = css;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') window.mountPosters = mountPosters;
