/* ============================================================================
   Home-page scenes, as edited in the admin portal (data/scenes.json).

   index.html keeps the STRUCTURE of each scene (videos, stills, timings) and
   a built-in copy of the text and clickable points. This lays the admin's
   saved text and points over it before the world mounts. Anything missing or
   malformed keeps the built-in value, and a slow or failed fetch gives up
   after `ms` so the home page never waits on it.
   ========================================================================== */
(function (root) {
  'use strict';

  /* Where a point may send someone: a page of this site or a category page.
     Nothing absolute, no protocol, nothing that climbs out of the site. */
  var HREF = /^(category\/\d{1,20}\.html|shop\.html(\?cat=\d{1,20})?|[a-z]+\.html)$/;
  var frac = function (v) { var n = Number(v); return isFinite(n) && n >= 0 && n <= 1 ? n : null; };
  var pick = function (pair, en) {
    if (!pair || typeof pair !== 'object') return null;
    var v = en ? (pair.en || '') : (pair.ar || '');
    v = String(v).trim();
    return v ? v.slice(0, 160) : null;
  };

  function hotspot(h, en) {
    if (!h || !HREF.test(String(h.href || ''))) return null;
    var fx = frac(h.fx), fy = frac(h.fy), label = pick(h.label, en) || pick(h.label, false);
    if (fx == null || fy == null || !label) return null;
    var o = { fx: fx, fy: fy, label: label, href: String(h.href),
              at: frac(h.at) == null ? 0.5 : frac(h.at), span: frac(h.span) == null ? 0.28 : frac(h.span) };
    var mfx = frac(h.mfx), mfy = frac(h.mfy);
    o.mfx = mfx == null ? fx : mfx; o.mfy = mfy == null ? fy : mfy;
    if (frac(h.sfx) != null && frac(h.sfy) != null) { o.sfx = frac(h.sfx); o.sfy = frac(h.sfy); }
    return o;
  }

  /* Returns true when anything was applied. */
  function apply(sections, data, en) {
    if (!data || !Array.isArray(data.scenes) || !Array.isArray(sections)) return false;
    var any = false;
    data.scenes.forEach(function (d) {
      var s = null;
      for (var i = 0; i < sections.length; i++) if (sections[i].id === d.id) s = sections[i];
      if (!s) return;
      ['label', 'eyebrow', 'title', 'showcaseLabel'].forEach(function (k) {
        var v = pick(d[k], en);
        if (v) { s[k] = v; any = true; }
      });
      if (Array.isArray(d.hotspots)) {
        s.hotspots = d.hotspots.map(function (h) { return hotspot(h, en); }).filter(Boolean);
        any = true;
      }
    });
    return any;
  }

  function load(url, ms) {
    if (!root.fetch) return Promise.resolve(null);
    var timer = new Promise(function (r) { setTimeout(function () { r(null); }, ms || 1200); });
    var got = fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return Promise.race([got, timer]);
  }

  var api = { apply: apply, load: load, HREF: HREF };
  root.skScenes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
