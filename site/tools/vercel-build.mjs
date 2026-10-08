/* ============================================================================
   Vercel build: copy ONLY what a browser may fetch into public/.
   ----------------------------------------------------------------------------
   Vercel publishes the output directory as-is, so this is the deployed form of
   engine/static-allow.mjs: an allow-list, never a block-list. Every file is
   checked with the same isPublicPath() the Node server uses, so the databases,
   server source, tools and logs that sit beside the pages can never be served.

   Deliberately NOT copied, because the function must answer them (a static
   file would win over the rewrite in vercel.json):
     category/*.html   re-pointed at the live Ecwid category ids per request
     data/*.json       live catalogue, or the owner's edited content
   Also skipped: _preview.html (internal design board).
   ========================================================================== */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicPath } from '../engine/static-allow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');
const SKIP_PAGES = new Set(['_preview.html']);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let files = 0, bytes = 0, refused = 0;
function copy(rel) {
  const urlPath = '/' + rel.split(path.sep).join('/');
  if (!isPublicPath(urlPath)) { refused++; return; }
  const src = path.join(ROOT, rel), dst = path.join(OUT, rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst);
  files++; bytes += statSync(src).size;
}
function walk(relDir) {
  for (const name of readdirSync(path.join(ROOT, relDir))) {
    const rel = path.join(relDir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else copy(rel);
  }
}

for (const name of readdirSync(ROOT)) {
  if (name.endsWith('.html') && !SKIP_PAGES.has(name)) copy(name);
}
if (existsSync(path.join(ROOT, 'assets'))) walk('assets');

console.log(`[build] public/: ${files} files, ${(bytes / 1048576).toFixed(1)} MB` +
  (refused ? `, ${refused} refused by the allow-list` : ''));
