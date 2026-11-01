/* ============================================================================
   What the static handler may serve — an allow-list, never a block-list.

   The handler used to serve every file under site/, which on the live VM made
   https://…/data/accounts.db download the customer database, next to the other
   databases, the server source, the tools and the logs. A block-list would be
   one new file away from the same leak, so this names what the BROWSER needs
   and refuses everything else:

     *.html               the pages (site root and category/)
     assets/**            styles, scripts, images, video
     data/<six>.json      the public catalogue the pages fetch

   `p` is the already-decoded URL pathname. Anything odd about it — a dot
   segment, a dotfile, a backslash, a NUL, a leftover %, an empty segment — is
   refused outright rather than normalised, because normalising is where
   traversal bugs live. Matching is case-sensitive on purpose: Windows would
   otherwise hand /DATA/ACCOUNTS.DB to a case-insensitive filesystem.
   ========================================================================== */

const PUBLIC_DATA = new Set(['products', 'categories', 'collections', 'finder', 'guides', 'promos', 'highlights', 'scenes', 'site', 'shop']);

// Never served, even from an allowed folder: the extensions a mistake would put there.
const NEVER = /\.(db|db-wal|db-shm|sqlite|sqlite3|log|bak|env|mjs|cjs|key|pem|bat|sh)$/i;

export function isPublicPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || /[\0\\%]/.test(p)) return false;
  const segs = p.slice(1).split('/');
  if (segs.some(s => s === '' || s.startsWith('.'))) return false;
  const rel = segs.join('/');
  if (NEVER.test(rel)) return false;

  if (segs.length === 1) return /^[A-Za-z0-9_-]+\.html$/.test(rel);
  if (segs[0] === 'category') return segs.length === 2 && /^[A-Za-z0-9_-]+\.html$/.test(segs[1]);
  if (segs[0] === 'assets') return true;
  if (segs[0] === 'data') {
    const m = segs.length === 2 && /^([a-z0-9_-]+)\.json$/.exec(segs[1]);
    return !!m && PUBLIC_DATA.has(m[1]);
  }
  return false;
}
