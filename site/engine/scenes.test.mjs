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
