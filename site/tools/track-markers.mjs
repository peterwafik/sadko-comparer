#!/usr/bin/env node
/* ============================================================================
   Marker tracks: where every home-page marker's appliance IS in every frame
   of its room's clip.
   ----------------------------------------------------------------------------
   Why: a desktop marker used to be one fixed point (fx/fy) that was only right
   on ONE frame of a moving camera flight, shown over a ±15% band of scroll in
   which the camera kept moving, and tied to a scroll fraction (`at`). Any
   change to a room's scroll length, linger, the bottom bar, or the clip itself
   silently put the markers on the wall again.

   Now each marker carries a TRACK through the clip, measured from the clip's
   own pixels: starting at the anchor frame the marker was authored on, a patch
   around the point is followed frame by frame (normalised cross-correlation,
   coarse-to-fine, sub-pixel) forward and backward until the match is lost or
   the point leaves the picture. The page then reads the frame actually on
   screen (video.currentTime) and puts the marker where its appliance is in
   THAT frame. Scroll maths, timings and layout no longer enter into it.

   The output names each clip with the SHA-256 of its bytes, and
   engine/markers.test.mjs fails (and tools/deploy-vercel.sh refuses to deploy)
   when a clip, an anchor point or the timing that defines the anchor frame
   changes without re-running this. So a stale track cannot ship.

   Usage:  node tools/track-markers.mjs            (writes assets/data/marker-tracks.json)
           node tools/track-markers.mjs --sheet DIR (also writes check images)
   Needs ffmpeg + ffprobe on PATH.
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSections, anchorFrame, frameRange, trackKey } from '../engine/marker-config.mjs';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 640, H = 360;            // tracking resolution (all clip variants are 16:9)
const P = 33, R = 22;              // patch size and search radius at W×H (wider lets a track jump to a look-alike)
const MIN_NCC = 0.8;               // a match this good is accepted as is
const SOFT_NCC = 0.62;             // between SOFT and MIN only if it survives the round trip
const FB_MAX = 1.0;                // px: tracked back one frame, it must land where it came from
const ANCHOR_MIN = +(process.env.TRACK_ANCHOR_MIN || 0.45);
                                   // ...and the patch must still look like the appliance did on
                                   // the anchor frame (zoom allowed for). An appliance passing
                                   // behind a door frame or a column fails this; frame-to-frame
                                   // matching alone happily follows the occluding edge instead.
const MIN_TEXTURE = 0.45;          // ...or when the patch has lost most of the anchor's detail:
                                   // a bare wall matches itself, so NCC alone cannot see the slip

const sheetDir = (() => { const i = process.argv.indexOf('--sheet'); return i > 0 ? process.argv[i + 1] : null; })();

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status) throw new Error('ffprobe failed on ' + file + ': ' + r.stderr);
  const s = JSON.parse(r.stdout).streams[0];
  const [a, b] = s.r_frame_rate.split('/').map(Number);
  return { frames: +s.nb_read_packets, fps: a / (b || 1) };
}

function decode(file, w, h) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area,format=gray`,
    '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error('ffmpeg failed on ' + file + ': ' + r.stderr);
  const buf = r.stdout, n = Math.floor(buf.length / (w * h)), frames = [];
  for (let i = 0; i < n; i++) frames.push(new Float32Array(buf.subarray(i * w * h, (i + 1) * w * h)));
  return frames;
}

function down2(img, w, h) {
  const w2 = w >> 1, h2 = h >> 1, o = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const i = 2 * y * w + 2 * x;
    o[y * w2 + x] = (img[i] + img[i + 1] + img[i + w] + img[i + w + 1]) / 4;
  }
  return o;
}

// bilinear patch sample centred on (cx, cy)
function patch(img, w, h, cx, cy, p) {
  const o = new Float32Array(p * p), r = (p - 1) / 2;
  let k = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    let x = cx + i, y = cy + j;
    x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y));
    const x0 = x | 0, y0 = y | 0, ax = x - x0, ay = y - y0, b = y0 * w + x0;
    o[k++] = (img[b] * (1 - ax) + img[b + 1] * ax) * (1 - ay) + (img[b + w] * (1 - ax) + img[b + w + 1] * ax) * ay;
  }
  return o;
}
function norm(t) {
  let m = 0; for (const v of t) m += v; m /= t.length;
  let s = 0; const o = new Float32Array(t.length);
  for (let i = 0; i < t.length; i++) { o[i] = t[i] - m; s += o[i] * o[i]; }
  return { t: o, s: Math.sqrt(s) || 1, std: Math.sqrt(s / t.length) };
}
// patch sampled with a pixel step (step < 1 magnifies): the anchor patch as it
// would look after the camera zoomed by 1/step
function patchStep(img, w, h, cx, cy, p, step) {
  const o = new Float32Array(p * p), r = (p - 1) / 2;
  let k = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    let x = cx + i * step, y = cy + j * step;
    x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y));
    const x0 = x | 0, y0 = y | 0, ax = x - x0, ay = y - y0, b = y0 * w + x0;
    o[k++] = (img[b] * (1 - ax) + img[b + 1] * ax) * (1 - ay) + (img[b + w] * (1 - ax) + img[b + w + 1] * ax) * ay;
  }
  return o;
}
function nccPatch(a, b) {
  const A = norm(a), B = norm(b); let c = 0;
  for (let i = 0; i < A.t.length; i++) c += A.t[i] * B.t[i];
  return c / (A.s * B.s);
}
// NCC of a normalised template against the image at integer centre (cx, cy)
function ncc(img, w, h, T, p, cx, cy) {
  const r = (p - 1) / 2;
  if (cx - r < 0 || cy - r < 0 || cx + r >= w || cy + r >= h) return -2;
  let sum = 0, sum2 = 0, cross = 0, k = 0;
  for (let j = -r; j <= r; j++) {
    let b = (cy + j) * w + cx - r;
    for (let i = 0; i < p; i++, b++, k++) { const v = img[b]; sum += v; sum2 += v * v; cross += v * T.t[k]; }
  }
  const n = p * p, varI = sum2 - sum * sum / n;
  return varI <= 1e-6 ? -2 : cross / (Math.sqrt(varI) * T.s);
}
function search(img, w, h, T, p, cx, cy, rad) {
  let best = -3, bx = cx, by = cy;
  const x0 = Math.round(cx), y0 = Math.round(cy);
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const v = ncc(img, w, h, T, p, x0 + dx, y0 + dy);
    if (v > best) { best = v; bx = x0 + dx; by = y0 + dy; }
  }
  return { x: bx, y: by, v: best };
}
// parabolic sub-pixel refinement around an integer peak
function subpix(img, w, h, T, p, x, y, v) {
  const l = ncc(img, w, h, T, p, x - 1, y), r = ncc(img, w, h, T, p, x + 1, y);
  const u = ncc(img, w, h, T, p, x, y - 1), d = ncc(img, w, h, T, p, x, y + 1);
  const ox = (l > -2 && r > -2) ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * (l - 2 * v + r) || 1))) : 0;
  const oy = (u > -2 && d > -2) ? Math.max(-0.5, Math.min(0.5, (u - d) / (2 * (u - 2 * v + d) || 1))) : 0;
  return { x: x + ox, y: y + oy };
}

/* Follow one point from frame fa in direction dir. Template = the patch
   around the point in the PREVIOUS frame (handles the steady zoom of a camera
   dolly), cross-checked against the anchor patch so slow drift cannot carry
   the marker off its appliance: when the running match and the anchor match
   disagree the track stops. */
const DEBUG = !!process.env.TRACK_DEBUG;
let curKey = '';
const why = (...a) => { if (DEBUG) console.log('    stop', curKey, ...a.map(v => typeof v === 'number' ? +v.toFixed(3) : v)); };
function follow(fr, fr2, fa, x, y, dir, lo, hi) {
  const out = [];
  let px = x, py = y;
  let prev = fr[fa];
  const anchorStd = norm(patch(fr[fa], W, H, x, y, P)).std;
  let scale = 1;                                   // appliance size now / on the anchor frame
  for (let s = 1; ; s++) {
    const f = fa + dir * s;
    if (f < lo || f > hi || f < 0 || f >= fr.length) break;
    const T = norm(patch(prev, W, H, px, py, P));
    if (T.std < Math.max(2, MIN_TEXTURE * anchorStd)) { why('texture', f, T.std, anchorStd); break; }   // slid onto something featureless
    const T2 = norm(patch(down2(prev, W, H), W >> 1, H >> 1, px / 2, py / 2, (P >> 1) | 1));
    const c = search(fr2[f], W >> 1, H >> 1, T2, (P >> 1) | 1, px / 2, py / 2, Math.ceil(R / 2));
    const fine = search(fr[f], W, H, T, P, c.x * 2, c.y * 2, 2);
    if (fine.v < SOFT_NCC) { why('ncc', f, fine.v); break; }
    const sp = subpix(fr[f], W, H, T, P, fine.x, fine.y, fine.v);
    /* A borderline match (repetitive radiator fins, a zooming shot) is kept only
       if it passes a forward-backward check: the patch found here, searched for
       in the previous frame, must come back to where the track came from. A
       track sliding onto a wall or a neighbour fails this, a real appliance whose
       look is merely changing passes it. */
    if (fine.v < MIN_NCC) {
      const B = norm(patch(fr[f], W, H, sp.x, sp.y, P));
      const back = search(prev, W, H, B, P, px, py, 3);
      const bs = subpix(prev, W, H, B, P, back.x, back.y, back.v);
      const fb = Math.hypot(bs.x - px, bs.y - py);
      if (back.v < SOFT_NCC || fb > FB_MAX) { why('fb', f, fine.v, fb); break; }
    }
    const m = (P - 1) / 2;
    if (sp.x < m || sp.y < m || sp.x > W - 1 - m || sp.y > H - 1 - m) {
      // patch would leave the picture: keep the point while it is still inside
      if (sp.x < 0 || sp.y < 0 || sp.x > W - 1 || sp.y > H - 1) break;
    }
    // Does it still look like the appliance on the anchor frame?
    const here = patch(fr[f], W, H, sp.x, sp.y, P);
    let best = -2, bestS = scale;
    for (let k = -4; k <= 4; k++) {
      const sc = scale * (1 + 0.02 * k);
      const v = nccPatch(here, patchStep(fr[fa], W, H, x, y, P, 1 / sc));
      if (v > best) { best = v; bestS = sc; }
    }
    scale = bestS;
    if (best < ANCHOR_MIN) { why('anchor', f, best, scale); break; }
    out.push({ f, x: sp.x, y: sp.y, v: fine.v, a: best });
    px = sp.x; py = sp.y; prev = fr[f];
  }
  return out;
}

const r4 = v => Math.round(v * 10000) / 10000;

function main() {
  const html = readFileSync(join(SITE, 'index.html'), 'utf8');
  const sections = readSections(html);
  const out = { _note: 'GENERATED by tools/track-markers.mjs from the clips themselves. Do not edit: change the anchor points in index.html, then re-run the tool. engine/markers.test.mjs refuses a stale file.', version: 1, clips: {} };
  for (const s of sections) {
    if (!s.clip || !s.hotspots || !s.hotspots.length) continue;
    const file = join(SITE, s.clip);
    const bytes = readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { frames, fps } = probe(file);
    const fr = decode(file, W, H);
    if (fr.length !== frames) console.warn(`  ${s.clip}: decoded ${fr.length} of ${frames} frames`);
    const fr2 = fr.map(f => down2(f, W, H));
    const clip = { sha256, frames: fr.length, fps, section: s.id, points: {} };
    console.log(`${s.id}: ${s.clip} ${fr.length} frames @${fps}`);
    for (const h of s.hotspots) {
      const fa = anchorFrame(s, h, fr.length, fps);
      curKey = trackKey(h);
      const x = h.fx * (W - 1), y = h.fy * (H - 1);
      // Only the frames this marker can ever be shown on (its visibility band
      // and the room's showcase band, plus a margin) are tracked.
      const [lo, hi] = frameRange(s, h, fr.length);
      const back = follow(fr, fr2, fa, x, y, -1, lo, hi).reverse();
      const fwd = follow(fr, fr2, fa, x, y, +1, lo, hi);
      const seq = [...back, { f: fa, x, y, v: 1 }, ...fwd];
      const f0 = seq[0].f;
      const xy = [];
      for (const q of seq) xy.push(r4(q.x / (W - 1)), r4(q.y / (H - 1)));
      clip.points[trackKey(h)] = { anchor: fa, fx: h.fx, fy: h.fy, f0, xy };
      const minV = Math.min(...seq.map(q => q.v));
      if (DEBUG) console.log('    anchor-sim', trackKey(h), 'min', Math.min(...seq.map(q => q.a ?? 1)).toFixed(2), 'at ends', (seq[0].a ?? 1).toFixed(2), (seq[seq.length - 1].a ?? 1).toFixed(2));
      console.log(`  ${trackKey(h).padEnd(22)} anchor ${fa}  frames ${f0}..${seq[seq.length - 1].f} (${seq.length})  minNCC ${minV.toFixed(2)}`);
      if (sheetDir) clip.points[trackKey(h)]._seq = seq;
    }
    if (sheetDir) writeSheet(sheetDir, s, file, clip, fr.length);
    for (const k in clip.points) delete clip.points[k]._seq;
    out.clips[s.clip] = clip;
  }
  writeFileSync(join(SITE, 'assets', 'data', 'marker-tracks.json'), JSON.stringify(out) + '\n');
  console.log('wrote assets/data/marker-tracks.json');
}

// Check images: every 12th frame with every tracked point drawn (needs ffmpeg).
function writeSheet(dir, s, file, clip, n) {
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < n; f += 12) {
    const boxes = [];
    for (const [k, p] of Object.entries(clip.points)) {
      const i = f - p.f0;
      if (i < 0 || i * 2 >= p.xy.length) continue;
      const x = Math.round(p.xy[i * 2] * 1279), y = Math.round(p.xy[i * 2 + 1] * 719);
      boxes.push(`drawbox=x=${x - 7}:y=${y - 7}:w=15:h=15:color=red@0.9:t=3`);
    }
    const vf = ['scale=1280:720', `select=eq(n\\,${f})`, ...boxes].join(',');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', vf, '-frames:v', '1', join(dir, `${s.id}-${String(f).padStart(3, '0')}.jpg`)]);
  }
}

main();
