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
  var HREF = /^(category\/\d{1,20}(\.html)?|shop(\.html)?(\?cat=\d{1,20}(&q=[A-Za-z0-9%._~-]{1,160})?)?|soon(\.html)?(\?c=[a-z-]{1,40})?|[a-z]+(\.html)?)$/;
  /* The old built category pages (the previous site's catalogue) that every
     point used to open. A saved copy still pointing a point at one of these
     was never changed on purpose, so it follows the built-in link instead
     (the live shop's own category, or the "under construction" page). A link
     an admin chose deliberately is anything else, and is kept. */
  var LEGACY = /^category\/(38022381|38032005|50318054|102858075|112439376|38003799|38003882|38005648|38005652|40507239)(\.html)?$/;
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

  /* ---- marker positions belong to a picture ----------------------------
     A saved position is only meaningful on the image it was placed on. The
     admin stamps each moved point with that image (`mimg` for the phone
     picture, `dimg` for the desktop still). A saved position whose stamp does
     not name the image this page shows (the room was re-shot, or it was saved
     before stamping existed) is dropped in favour of the built-in position
     from index.html, which always ships together with its image. Without
     this, an old saved copy put the living room's phone markers back on the
     previous picture's coordinates after every deploy.
     Unstamped DESKTOP positions are dropped too (since 2026-11-17). They used
     to be kept, and the live saved copy carried the living room's desktop
     points from an older picture (speakers at 0.413 instead of 0.605, the air
     purifier on a bare wall), overriding every fix made in index.html.
     A marker's TIMING (at/span) is never taken from a saved copy: it belongs to
     the clip, like the marker tracks (hotspots.js) that depend on it. */
  var norm = function (u) { return String(u || '').split('?')[0].replace(/^\.?\//, ''); };
  function sameImage(stamp, img) { return !!stamp && !!img && norm(stamp) === norm(img); }
  /* The built-in point a saved one corresponds to: same Arabic label, else
     same link at the same position in the list. A point added in the admin
     matches neither and keeps its own positions. */
  function builtinFor(defs, h, i) {
    var ar = pick(h && h.label, false), j;
    for (j = 0; j < defs.length; j++) if (ar && (defs[j]._ar || defs[j].label) === ar) return defs[j];
    if (defs[i] && h && defs[i].href === h.href) return defs[i];
    return null;
  }

  /* Returns true when anything was applied. */
  /* `copyRev` is the revision of the built-in room text (index.html COPY_REV,
     also in the bundled data/scenes.json). A saved copy's room text (label,
     eyebrow, title) is used only when that copy was saved against the same or
     a newer revision. Without this, the old saved English ("Welcome to SADKO
     home") replaced the owner's newly approved wording on every visit where
     the saved copy loaded in time, so the titles seemed to revert after each
     deploy (2026-11-18). The admin editor stamps the revision when it saves. */
  function textCurrent(data, copyRev) {
    if (!copyRev) return true;
    return !!data.copyRev && String(data.copyRev) >= String(copyRev);
  }

  function apply(sections, data, en, copyRev) {
    if (!data || !Array.isArray(data.scenes) || !Array.isArray(sections)) return false;
    var any = false;
    var useText = textCurrent(data, copyRev);
    data.scenes.forEach(function (d) {
      var s = null;
      for (var i = 0; i < sections.length; i++) if (sections[i].id === d.id) s = sections[i];
      if (!s) return;
      if (useText) ['label', 'eyebrow', 'title', 'showcaseLabel'].forEach(function (k) {
        var v = pick(d[k], en);
        if (v) { s[k] = v; any = true; }
      });
      if (Array.isArray(d.hotspots)) {
        var defs = (s.hotspots || []).slice();
        s.hotspots = d.hotspots.map(function (h, i) {
          var o = hotspot(h, en);
          if (!o) return null;
          var b = builtinFor(defs, h, i);
          if (b) {
            if (LEGACY.test(String(h.href || '')) && b.href) o.href = b.href;
            if (!sameImage(h.mimg, s.stillMobile)) {
              o.mfx = b.mfx != null ? b.mfx : b.fx; o.mfy = b.mfy != null ? b.mfy : b.fy;
            }
            if (!sameImage(h.dimg, s.still)) {
              o.fx = b.fx; o.fy = b.fy;
              if (b.sfx != null) { o.sfx = b.sfx; o.sfy = b.sfy; } else { delete o.sfx; delete o.sfy; }
            }
          }
          if (b) { o.at = b.at != null ? b.at : o.at; o.span = b.span != null ? b.span : o.span; }
          // The built-in key, so a label renamed in the admin keeps its track.
          o._ar = (b && b._ar) || pick(h.label, false);
          return o;
        }).filter(Boolean);
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

  var api = { apply: apply, load: load, HREF: HREF, sameImage: sameImage, builtinFor: builtinFor, textCurrent: textCurrent };
  root.skScenes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
