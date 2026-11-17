/* Home-page markers must stay on their appliances. These tests fail when
   anything a marker's position depends on changed without the marker tracks
   being regenerated (node tools/track-markers.mjs), and tools/deploy-vercel.sh
   runs the suite before every deploy, so a stale marker cannot ship. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readSections, anchorFrame, trackKey } from './marker-config.mjs';

const SITE = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', SITE), 'utf8');
const SECTIONS = readSections(html);
const TRACKS = JSON.parse(readFileSync(new URL('assets/data/marker-tracks.json', SITE), 'utf8'));
const ROOMS = SECTIONS.filter(s => s.clip && s.hotspots && s.hotspots.length);
const STALE = 'marker tracks are stale: run `node tools/track-markers.mjs` and commit assets/data/marker-tracks.json';

test('every room clip has a track file entry made from THIS clip file', () => {
  assert.ok(ROOMS.length >= 3);
  for (const s of ROOMS) {
    const t = TRACKS.clips[s.clip];
    assert.ok(t, `${s.id}: no tracks for ${s.clip}. ${STALE}`);
    const sha = createHash('sha256').update(readFileSync(new URL(s.clip, SITE))).digest('hex');
    assert.equal(t.sha256, sha, `${s.id}: ${s.clip} changed. ${STALE}`);
  }
});

test('every marker has a track that starts from its authored point on its anchor frame', () => {
  for (const s of ROOMS) {
    const t = TRACKS.clips[s.clip];
    for (const h of s.hotspots) {
      const p = t.points[trackKey(h)];
      assert.ok(p, `${s.id} / ${trackKey(h)}: no track. ${STALE}`);
      assert.equal(p.anchor, anchorFrame(s, h, t.frames), `${s.id} / ${trackKey(h)}: its at/linger/clipEnd changed. ${STALE}`);
      assert.ok(Math.abs(p.fx - h.fx) < 1e-9 && Math.abs(p.fy - h.fy) < 1e-9, `${s.id} / ${trackKey(h)}: fx/fy changed. ${STALE}`);
      const i = p.anchor - p.f0;
      assert.ok(i >= 0 && 2 * i + 1 < p.xy.length, `${s.id} / ${trackKey(h)}: anchor frame missing from its track`);
      assert.ok(Math.abs(p.xy[2 * i] - h.fx) < 2e-3 && Math.abs(p.xy[2 * i + 1] - h.fy) < 2e-3, `${s.id} / ${trackKey(h)}: track does not pass through the authored point`);
      for (let k = 0; k < p.xy.length; k++) assert.ok(p.xy[k] >= 0 && p.xy[k] <= 1, `${s.id} / ${trackKey(h)}: track leaves the frame`);
    }
  }
});

test('every encode of a room clip has the same frame count the tracks were made on', { skip: spawnSync('ffprobe', ['-version']).error ? 'ffprobe not installed' : false }, () => {
  for (const s of ROOMS) {
    const t = TRACKS.clips[s.clip];
    const base = s.clip.replace(/\.mp4$/i, '');
    const variants = [s.clip, base + '-lite.mp4', s.clipMobile, (s.clipMobile || '').replace(/\.mp4$/i, '-lite.mp4')].filter(Boolean);
    for (const v of new Set(variants)) {
      const file = new URL(v, SITE);
      if (!existsSync(file)) continue;
      const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file.pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
      assert.equal(+r.stdout.trim(), t.frames, `${v}: ${r.stdout.trim()} frames, the tracks assume ${t.frames}`);
    }
  }
});

test('the admin editor places markers on the same frame the site anchors them to', () => {
  const src = readFileSync(new URL('assets/js/admin/pages-site.js', SITE), 'utf8');
  const media = new Function(src.slice(src.indexOf('const MEDIA = {'), src.indexOf('};', src.indexOf('const MEDIA = {')) + 2) + '; return MEDIA;')();
  for (const s of ROOMS) {
    const m = media[s.id];
    assert.ok(m, s.id + ' missing from the admin MEDIA table');
    assert.equal(m.clip, s.clip, s.id + ' clip');
    assert.equal(m.at, s.hotspots[0].at, s.id + ' anchor progress');
    assert.equal(m.linger || 0, s.linger || 0, s.id + ' linger');
    assert.equal(m.clipEnd || 1, s.clipEnd || 1, s.id + ' clipEnd');
    for (const h of s.hotspots) assert.equal(h.at, s.hotspots[0].at, `${s.id} / ${trackKey(h)}: one anchor per room (the admin edits on one frame)`);
  }
});

test('the page loads the tracks and the marker layer measures the painted picture', () => {
  assert.match(html, /assets\/data\/marker-tracks\.json/);
  const hs = readFileSync(new URL('assets/js/hotspots.js', SITE), 'utf8');
  assert.match(hs, /function painted\(seg\)/);
  assert.match(hs, /trackedPoint\(seg, it, meas\.video\)/);
  assert.match(hs, /function watchPaint\(\)/);
});
