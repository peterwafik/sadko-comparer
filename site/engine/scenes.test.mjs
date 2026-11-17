// site/engine/scenes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../assets/js/scenes.js');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const builtIn = () => new Function(html.slice(html.indexOf('const C = id =>'), html.indexOf('/* ---- English mode')) + '; return SECTIONS;')();
const EN_TABLE = new Function(html.slice(html.indexOf('const L = {'), html.lastIndexOf('applyBuiltInEnglish = () =>')) + '; return L;')();
const DATA = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url), 'utf8'));

test('the shipped scenes.json reproduces the built-in Arabic scenes exactly', () => {
  const a = builtIn(), b = builtIn();
  assert.equal(S.apply(b, DATA, false), true);
  for (let i = 0; i < a.length; i++) {
    assert.equal(b[i].title, a[i].title);
    assert.equal(b[i].hotspots.length, a[i].hotspots.length);
    a[i].hotspots.forEach((h, j) => {
      for (const k of ['label', 'href', 'fx', 'fy', 'mfx', 'mfy', 'at', 'span']) assert.equal(b[i].hotspots[j][k], h[k], `${a[i].id}#${j}.${k}`);
    });
  }
});

test('and the built-in English copy', () => {
  const b = builtIn();
  S.apply(b, DATA, true);
  for (const s of b) {
    const e = EN_TABLE[s.id];
    assert.equal(s.title, e.title);
    s.hotspots.forEach((h, j) => assert.equal(h.label, e.spots[j]));
  }
});

test('a point with a link outside the site, or off the picture, is dropped', () => {
  const b = builtIn();
  S.apply(b, { scenes: [{ id: 'living', hotspots: [
    { label: { ar: 'أ' }, href: 'https://evil.example', fx: 0.5, fy: 0.5 },
    { label: { ar: 'ب' }, href: 'javascript:alert(1)', fx: 0.5, fy: 0.5 },
    { label: { ar: 'ج' }, href: 'category/1.html', fx: 1.5, fy: 0.5 },
    { label: { ar: 'د' }, href: 'shop.html?cat=12', fx: 0.2, fy: 0.3 },
  ] }] }, false);
  assert.deepEqual(b[0].hotspots.map(h => h.label), ['د']);
  assert.equal(b[0].hotspots[0].mfx, 0.2, 'no phone position falls back to the desktop one');
});

test('an English page with no English name falls back to the Arabic one rather than a blank marker', () => {
  const b = builtIn();
  S.apply(b, { scenes: [{ id: 'living', hotspots: [{ label: { ar: 'تليفزيونات', en: '' }, href: 'category/1.html', fx: 0.1, fy: 0.1 }] }] }, true);
  assert.equal(b[0].hotspots[0].label, 'تليفزيونات');
});

test('nothing usable leaves the built-in scenes alone', () => {
  const b = builtIn();
  assert.equal(S.apply(b, null, false), false);
  assert.equal(S.apply(b, { scenes: 'x' }, false), false);
  assert.equal(b[0].hotspots.length, 7);
});

test('index.html mounts only after the scenes load or time out', () => {
  assert.match(html, /skScenes\.load\('data\/scenes\.json', 1200\)/);
  assert.ok(html.indexOf('loadScenes.then') < html.indexOf('mountScrollWorld('));
  assert.match(html, /scenes\.js\?v=/);
});

/* The editor (admin pages-site.js) draws each room's frame from its own copy
   of the scene timing. It once used progress × duration, a different frame
   from the one the home page shows, so points placed there missed. */
test('the scene editor shows the exact frame the home page settles on', () => {
  const ED = readFileSync(new URL('../assets/js/admin/pages-site.js', import.meta.url), 'utf8');
  const ENGINE = readFileSync(new URL('../assets/js/scrub-engine.js', import.meta.url), 'utf8');
  const media = new Function(ED.slice(ED.indexOf('const MEDIA = {'), ED.indexOf('/* The clip time the home page')) + '; return MEDIA;')();
  for (const s of builtIn()) {
    const m = media[s.id];
    assert.ok(m, s.id + ' has editor media');
    assert.equal(m.at, s.showcase, s.id + ': showcase');
    assert.equal(m.linger || 0, s.linger || 0, s.id + ': linger');
    assert.equal(m.clip, s.clip, s.id + ': clip');
    assert.equal(m.phone, s.stillMobile, s.id + ': phone still');
    if (s.clipEnd != null) assert.equal(m.clipEnd, s.clipEnd, s.id + ': clipEnd');
  }
  /* Same easing as the engine, character for character. */
  const eng = /const lingerEase = \(x, L\) => \{ L = clamp\(L\); const c = x - 0\.5; return \(1 - L\) \* x \+ L \* \(4 \* c \* c \* c \+ 0\.5\); \};/;
  assert.match(ENGINE, eng, 'scrub-engine lingerEase changed: update the editor too');
  assert.match(ED, /const lingerEase = \(x, L\) => \{ const c = x - 0\.5; return \(1 - L\) \* x \+ L \* \(4 \* c \* c \* c \+ 0\.5\); \};/);
  assert.match(ED, /frameTime\(media\) \* vid\.duration/);
  assert.ok(ED.includes('blobFor(media.clip)'), 'the clip must load as a Blob, or it cannot seek past frame 0');
  /* the living room: measured at 0.46 s of the 8.04 s clip */
  const ease = (x, L) => { const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  assert.equal(Math.round(ease(0.03, 0.5) * 8.04 * 100) / 100, 0.46);
});

/* Marker positions belong to a picture. The live database held a saved copy
   whose living-room PHONE positions were placed on an older picture, and it
   put them back on top of every deploy. */
const LIVE_STALE = JSON.parse(JSON.stringify(DATA));
{
  const l = LIVE_STALE.scenes.find(s => s.id === 'living');
  const old = [[0.51, 0.49], [0.617, 0.531], [0.869, 0.388], [0.687, 0.555], [0.614, 0.672], [0.163, 0.564], [0.343, 0.531]];
  l.hotspots.forEach((h, i) => { h.mfx = old[i][0]; h.mfy = old[i][1]; h.fx = 0.4; });   // unstamped
  l.title = { ar: 'أهلاً بك فى بيت صادكو', en: 'Welcome to SADKO home' };
}

// 2026-11-17: unstamped DESKTOP positions are dropped as well. The live saved
// copy carried the living room's desktop points from an older picture and beat
// every fix in index.html after each deploy.
test('unstamped saved positions (phone AND desktop) fall back to the built-in ones; texts survive', () => {
  const a = builtIn(), b = builtIn();
  S.apply(b, LIVE_STALE, false);
  const ai = a.find(s => s.id === 'living'), bi = b.find(s => s.id === 'living');
  assert.equal(bi.title, 'أهلاً بك فى بيت صادكو');
  bi.hotspots.forEach((h, j) => {
    assert.equal(h.mfx, ai.hotspots[j].mfx, 'mfx #' + j);
    assert.equal(h.mfy, ai.hotspots[j].mfy, 'mfy #' + j);
    assert.equal(h.fx, ai.hotspots[j].fx, 'fx #' + j);
    assert.equal(h.fy, ai.hotspots[j].fy, 'fy #' + j);
  });
});

test('marker timing always comes from index.html, and the track key survives a renamed label', () => {
  const a = builtIn(), b = builtIn(), d = JSON.parse(JSON.stringify(LIVE_STALE));
  const h = d.scenes.find(s => s.id === 'living').hotspots[0];
  const builtinAr = a.find(s => s.id === 'living').hotspots[0].label;
  b.forEach(s => (s.hotspots || []).forEach(x => { x._ar = x.label; }));
  Object.assign(h, { at: 0.77, span: 0.05 });
  S.apply(b, d, false);
  const got = b.find(s => s.id === 'living').hotspots[0], want = a.find(s => s.id === 'living').hotspots[0];
  assert.equal(got.at, want.at); assert.equal(got.span, want.span);
  assert.equal(got._ar, builtinAr);
});

test('a saved position stamped with the picture the site shows is used', () => {
  const b = builtIn(), d = JSON.parse(JSON.stringify(LIVE_STALE));
  const living = b.find(s => s.id === 'living');
  const h = d.scenes.find(s => s.id === 'living').hotspots[0];
  Object.assign(h, { mfx: 0.3, mfy: 0.31, mimg: living.stillMobile + '?v=9', fx: 0.2, fy: 0.21, dimg: living.still });
  S.apply(b, d, false);
  const got = b.find(s => s.id === 'living').hotspots[0];
  assert.deepEqual([got.mfx, got.mfy, got.fx, got.fy], [0.3, 0.31, 0.2, 0.21]);
});

test('a position stamped with a different picture is dropped (the room was re-shot)', () => {
  const a = builtIn(), b = builtIn(), d = JSON.parse(JSON.stringify(DATA));
  const h = d.scenes.find(s => s.id === 'living').hotspots[2];
  Object.assign(h, { mfx: 0.1, mfy: 0.1, mimg: 'assets/img/m_living_v1.jpg', fx: 0.1, fy: 0.1, dimg: 'assets/img/still_1.jpg' });
  S.apply(b, d, false);
  const want = a.find(s => s.id === 'living').hotspots[2], got = b.find(s => s.id === 'living').hotspots[2];
  assert.deepEqual([got.mfx, got.mfy, got.fx, got.fy], [want.mfx, want.mfy, want.fx, want.fy]);
});

test('the admin editor stamps against the same pictures index.html shows', () => {
  const src = readFileSync(new URL('../assets/js/admin/pages-site.js', import.meta.url), 'utf8');
  const media = new Function(src.slice(src.indexOf('const MEDIA = {'), src.indexOf('};', src.indexOf('const MEDIA = {')) + 2) + '; return MEDIA;')();
  for (const s of builtIn()) {
    if (!media[s.id] || media[s.id].textOnly) continue;
    assert.ok(S.sameImage(media[s.id].phone, s.stillMobile), s.id + ' phone picture');
    assert.ok(S.sameImage(media[s.id].still, s.still), s.id + ' desktop still');
  }
});

/* The room titles kept "reverting" after deploys: an admin copy saved before the
   owner approved new wording replaced it whenever it loaded in time. Room text
   from a saved copy now counts only when saved against the current COPY_REV. */
const COPY_REV = (/const COPY_REV = '([^']+)'/.exec(html) || [])[1];

test('index.html and the bundled scenes.json carry the same room-text revision', () => {
  assert.ok(COPY_REV, 'index.html must declare COPY_REV');
  assert.equal(DATA.copyRev, COPY_REV, 'bump "copyRev" in data/scenes.json together with COPY_REV in index.html');
});

test('the bundled scenes.json has exactly the built-in room text, in both languages', () => {
  const a = builtIn();
  for (const s of a) {
    const d = DATA.scenes.find(x => x.id === s.id);
    if (!d) continue;
    for (const k of ['label', 'eyebrow', 'title']) {
      if (s[k]) assert.equal(String(d[k] && d[k].ar).trim(), s[k], `${s.id}.${k} (ar)`);
      const e = EN_TABLE[s.id] && EN_TABLE[s.id][k];
      if (e) assert.equal(d[k] && d[k].en, e, `${s.id}.${k} (en)`);
    }
  }
});

test('a saved copy older than COPY_REV cannot replace the room text, but its points still apply', () => {
  const saved = JSON.parse(JSON.stringify(DATA));
  delete saved.copyRev;
  saved.scenes[0].title = { ar: 'عنوان قديم', en: 'Old title' };
  saved.scenes[0].hotspots[0].href = 'soon?c=old-test';
  const b = builtIn();
  S.apply(b, saved, false, COPY_REV);
  assert.equal(b[0].title, builtIn()[0].title, 'old saved title must not show');
  assert.equal(b[0].hotspots[0].href, 'soon?c=old-test', 'saved points still apply');
  const older = { ...saved, copyRev: '2000-01-01' };
  const c = builtIn(); S.apply(c, older, true, COPY_REV);
  assert.notEqual(c[0].title, 'Old title');
});

test('a copy saved against the current revision (the owner editing later) does replace it', () => {
  const saved = JSON.parse(JSON.stringify(DATA));
  saved.copyRev = COPY_REV;
  saved.scenes[0].title = { ar: 'عنوان جديد', en: 'New title' };
  const b = builtIn(); S.apply(b, saved, true, COPY_REV);
  assert.equal(b[0].title, 'New title');
});

test('the admin editor stamps the revision on save and shows the approved text for an old copy', () => {
  const src = readFileSync(new URL('../assets/js/admin/pages-site.js', import.meta.url), 'utf8');
  assert.match(src, /if \(COPY_REV\) data\.copyRev = COPY_REV;/);
  assert.match(src, /SS\.textCurrent\(data, COPY_REV\)/);
  assert.match(html, /window\.skScenes\.apply\(SECTIONS, data, EN, COPY_REV\)/);
});
