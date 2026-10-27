/* ============================================================================
   Who may do what in the admin portal.

   One MASTER account (the owner) can do everything, and alone manages the
   other admins: invites, removals, and each admin's access. Every other admin
   has, per section, 'view' or 'edit' (absent means no access). The server
   checks every /api/admin request against this; the portal only hides what
   the server would refuse anyway.

   Pure: the routes and the auth store call these.
   ========================================================================== */

export const SECTIONS = ['scenes', 'ads', 'shop', 'guides', 'finder', 'site', 'orders', 'products', 'coupons',
                         'delivery', 'payments', 'customers', 'activity'];
export const FULL = Object.fromEntries(SECTIONS.map(s => [s, 'edit']));
const LEVELS = new Set(['view', 'edit']);

export function cleanPerms(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const s of SECTIONS) if (LEVELS.has(input[s])) out[s] = input[s];
  return out;
}

/* The section an /api/admin/<rest> request belongs to. 'any' is open to every
   signed-in admin; 'master' is the master's alone, which is also what an
   unmapped route gets, so a new route is closed until someone maps it. */
export function sectionOf(rest, method = 'GET') {
  const r = String(rest || '').replace(/^\/+/, '');
  const seg = r.split('/');
  if (r === 'me' || r === 'overview' || r === 'ecwid') return 'any';
  if (r === 'ecwid/sync') return 'products';
  if (seg[0] === 'store' && seg[1]) {
    const m = { orders: 'orders', products: 'products', customers: 'customers', coupons: 'coupons', payments: 'payments', delivery: 'delivery' }[seg[1]];
    if (m) return m;
  }
  if (seg[0] === 'ecwid' && (seg[1] === 'orders' || seg[1] === 'push')) return 'orders';
  if (seg[0] === 'ecwid' && (seg[1] === 'customer' || seg[1] === 'customers')) return 'customers';
  if (seg[0] === 'leftovers' || seg[0] === 'analytics') return 'products';
  if (r === 'delivery-classes') return 'delivery';
  if (seg[0] === 'ads') return 'ads';
  if (seg[0] === 'shop') return 'shop';
  if (seg[0] === 'content' && ['scenes', 'guides', 'finder'].includes(seg[1])) return seg[1];
  if (r === 'site/link-targets') return 'scenes';
  if (r === 'site/settings') return 'site';
  if (r === 'upload') return 'guides';
  if (r === 'audit') return 'activity';
  return 'master';
}

export function allowed(role, perms, section, write) {
  if (role === 'master') return true;
  if (section === 'any') return true;
  if (section === 'master') return false;
  const level = (perms || {})[section];
  return write ? level === 'edit' : level === 'view' || level === 'edit';
}
