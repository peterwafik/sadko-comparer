/* Shared by tools/track-markers.mjs and engine/markers.test.mjs: read the
   home page's scene config straight out of index.html (one source of truth)
   and compute which clip frame a marker was authored on. */

/* index.html declares `const SECTIONS = [...]` inside its DOMContentLoaded
   handler, after the link helpers it uses (C, SHOP, SOON). Evaluate exactly
   that stretch of script, nothing else. */
export function readSections(html) {
  const a = html.indexOf('const C = id');
  const b0 = html.indexOf('const SECTIONS = [');
  const b = html.indexOf('\n  ];', b0);
  if (a < 0 || b0 < 0 || b < 0) throw new Error('index.html: SECTIONS block not found');
  const src = html.slice(a, b + 5);
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn SECTIONS;')();
}

/* scrub-engine.js read(): target = lingerEase(local, linger) * clipEnd, and
   the video is sought to target * duration. duration = frames / fps, so the
   frame on screen is floor(target * frames). */
export const lingerEase = (x, L) => {
  L = Math.min(1, Math.max(0, L)); const c = x - 0.5;
  return (1 - L) * x + L * (4 * c * c * c + 0.5);
};
export function anchorTarget(s, h) {
  const at = h.at != null ? h.at : 0.55;
  const clipEnd = s.clipEnd != null ? Math.min(1, Math.max(0.02, s.clipEnd)) : 1;
  return (s.linger ? lingerEase(at, s.linger) : at) * clipEnd;
}
export function anchorFrame(s, h, frames) {
  return Math.min(frames - 1, Math.max(0, Math.floor(anchorTarget(s, h) * frames + 1e-6)));
}

/* The frames a marker is tracked over: its flight band (within
   min(span, VIS_HALF) of its `at`) and the same band around the room's
   showcase progress, plus a few frames of margin for the scrub's easing.
   Showcase mode holds markers open further out than that (hotspots.js exits
   at 0.24), but out there appliances start going behind door frames and
   columns; hotspots.js hides a marker on any frame it has no track for, so a
   marker disappears there instead of pointing at a wall. */
export const VIS_HALF = 0.15, SHOWCASE_HOLD = 0.15, RANGE_MARGIN = 4;
export function frameRange(s, h, frames) {
  const at = h.at != null ? h.at : 0.55, half = Math.min(h.span != null ? h.span : 0.38, VIS_HALF);
  let a = at - half, b = at + half;
  if (s.showcase != null) { a = Math.min(a, s.showcase - SHOWCASE_HOLD); b = Math.max(b, s.showcase + SHOWCASE_HOLD); }
  const f = p => anchorFrame(s, { at: Math.min(1, Math.max(0, p)) }, frames);
  return [Math.max(0, f(a) - RANGE_MARGIN), Math.min(frames - 1, f(b) + RANGE_MARGIN)];
}

/* A marker's identity across languages and admin edits: its Arabic label. */
export const trackKey = h => String(h._ar || h.label || '').trim();
