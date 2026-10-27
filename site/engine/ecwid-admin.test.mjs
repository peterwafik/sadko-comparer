// site/engine/ecwid-admin.test.mjs
// The admin routes need an authenticated admin session, so — like
// admin-content.test.mjs and shop-wiring.test.mjs — this asserts on the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
/* The admin portal's scripts, read as one source. */
const adminJs = ['core', 'login', 'pages-site', 'pages-store', 'pages-people']
  .map(f => readFileSync(path.join(SITE, 'assets', 'js', 'admin', f + '.js'), 'utf8')).join('\n');
const adminBlock = /if \(u\.pathname\.startsWith\('\/api\/admin\/'\)\)[\s\S]*?\n  \}/.exec(src);

test('the admin block is locatable', () => {
  assert.ok(adminBlock, '/api/admin/ block not found');
});

/* ------------------------------- routes --------------------------------- */

test('there is an Ecwid status route', () => {
  assert.match(adminBlock[0], /rest === 'ecwid' && req\.method === 'GET'/);
});

test('there is a manual sync route', () => {
  assert.match(adminBlock[0], /seg\[1\] === 'sync' && req\.method === 'POST'/);
});

test('the status route reports through describe(), not by reading env directly', () => {
  /* describe() is the only surface that is guaranteed token-free.

     Scoped to the route's own response object rather than a fixed character
     window: the window was 900 and broke when the ad-folder diagnostics were
     added above the return, which said nothing about whether describe() was
     still being used. */
  const route = /rest === 'ecwid' && req\.method === 'GET'[\s\S]*?return json\(200, \{[\s\S]*?\n        \}\);/
    .exec(adminBlock[0]);
  assert.ok(route, 'the ecwid status route is gone');
  assert.match(route[0], /ecwidSource\(\)\.describe\(\)/);
});

/* ---------------------------- token safety ------------------------------ */

test('no admin response can carry the token', () => {
  assert.ok(!/SADKO_ECWID_TOKEN/.test(adminBlock[0]),
    'the admin block must never touch the token env var');
  assert.ok(!/ECWID_TOKEN\b/.test(adminBlock[0]),
    'the admin block must not reference the token constant either');
});

test('the webhook secret is not exposed through admin either', () => {
  assert.ok(!/SADKO_ECWID_WEBHOOK_SECRET/.test(adminBlock[0]));
});

test('the admin portal never asks for or renders an Ecwid token', () => {
  assert.ok(!/ecwid[_ ]?token|secret_|public_/i.test(adminJs), 'the portal must not mention the Ecwid token');
});

/* --------------------- Ecwid-owned field protection --------------------- */

test('ECWID_OWNED_FIELDS is declared and covers what Ecwid owns', () => {
  assert.match(src, /const ECWID_OWNED_FIELDS = \[/);
  const owned = /const ECWID_OWNED_FIELDS = \[([^\]]*)\]/.exec(src)[1];
  for (const f of ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand'])
    assert.match(owned, new RegExp("'" + f + "'"), `${f} should be Ecwid-owned`);
});

test('the badge is Ecwid\'s ribbon, not a site field', () => {
  /* The overlay used to own the badge because the store set no ribbons. The
     portal now writes the ribbon in Ecwid, and the mirror reads it back. */
  const map = readFileSync(path.join(SITE, 'engine', 'ecwid-map.mjs'), 'utf8');
  assert.match(map, /badge: e\.ribbon && text\(e\.ribbon\.text\)/);
});

test('product edits go to Ecwid, never to a site overlay', () => {
  const block = adminBlock[0];
  assert.ok(block.includes('await api.updateProduct(id, patch)'));
  for (const gone of ['cadm.setOverride', 'cadm.createProduct', 'cadm.hide(', 'cadm.unhide(', 'cadm.revert(', 'cadm.merge('])
    assert.ok(!src.includes(gone), gone + ' must not be called any more');
});

test('after an Ecwid write the mirror is refreshed at once, not on the next poll', () => {
  const fn = /async function refreshProduct\(id\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.match(fn, /applyProductEvent\(\{ entityId: id/);
  assert.match(fn, /invalidate\(\)/);
});

/* ------------------------------- the panel ------------------------------ */

test('the store pages link out to the matching page of the Ecwid admin', () => {
  assert.match(adminJs, /https:\/\/my\.ecwid\.com\/store\/' \+ STORE_ID \+ '#' \+ hash/);
  assert.match(adminJs, /ecwidLink\('order:id=' \+ o\.id\)/);
  assert.match(adminJs, /ecwidLink\('product:id=' \+ p\.id/);
});

test('the dashboard has a sync-now control wired to the route', () => {
  assert.match(adminJs, /id="syncBtn"/);
  assert.match(adminJs, /A\.api\('POST', 'ecwid\/sync'/);
});

/* --------------- what Task 14 deliberately does NOT do ----------------- */

test('the order status control is still writable, because Ecwid does not own it yet', () => {
  /* The plan had the orders desk go read-only here. That is only safe once
     order status flows back FROM Ecwid (Task 13). setOrderStatus is currently
     the ONLY way any order status gets written, so removing it now would leave
     staff unable to update a single order. Deferred on purpose. */
  assert.match(src, /db\.setOrderStatus\(/,
    'the local order status write must remain until Task 13 replaces it');
});

/* ======================================================================
   Freshness: how fast an Ecwid change reaches the site.

   The complaint this answers: a banner uploaded in Ecwid did not appear.
   It would have — 15 minutes later, which is the whole poll interval and
   far too slow for the thing this integration exists to do.
   ================================================================== */

test('the poll interval is configurable, and defaults to a minute', () => {
  assert.match(src, /SADKO_ECWID_POLL_SECONDS/);
  assert.match(src, /return 60_000;/);
});

test('a typo cannot hammer the API, and 0 means webhooks only', () => {
  const fn = /const ECWID_POLL_MS = \(\(\) => \{[\s\S]{0,700}?\}\)\(\);/.exec(src)[0];
  assert.match(fn, /Math\.max\(15, n\)/, 'no floor on the interval');
  assert.match(fn, /n === 0 \? 0 :/, '0 should disable polling');
});

test('the timer and the on-demand refresh share ONE poll', () => {
  /* Two code paths asking Ecwid different questions is how they drift. */
  assert.match(src, /async function pollEcwid\(\)/);
  assert.match(src, /setInterval\(\(\) => \{\s*pollEcwid\(\)/);
  assert.match(src, /await pollEcwid\(\);/);
});

test('the poll never runs twice at once', () => {
  /* A slow call must not pile up behind itself once the interval is short. */
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /if \(ECWID_POLL_INFLIGHT\) return ECWID_POLL_INFLIGHT;/);
});

test('the poll refreshes ad-folder membership, not just products', () => {
  /* Moving an advert between folders changes no product field, so
     updatedFrom would never report it. */
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /syncAdFolders\(\)/);
  assert.match(fn, /syncProducts\(/);
  assert.match(fn, /invalidate\(\)/, 'a sync that does not invalidate serves the old cache');
});

test('the poll cannot throw out of the timer', () => {
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /catch \(e\) \{/);
});

test('the adverts and the catalogue REVALIDATE before answering', () => {
  /* This is what makes "edit in Ecwid, reload, see it" true rather than
     "wait for the next tick". */
  const promos = /u\.pathname === '\/data\/promos\.json'[\s\S]{0,400}/.exec(src)[0];
  assert.match(promos, /await ecwidFresh\(\);/);
  const products = /u\.pathname === '\/data\/products\.json'[\s\S]{0,400}/.exec(src)[0];
  assert.match(products, /await ecwidFresh\(\);/);
});

test('revalidation is bounded, so a busy page cannot stampede the API', () => {
  const fn = /async function ecwidFresh\(\)[\s\S]{0,900}?\n\}/.exec(src)[0];
  assert.match(fn, /Date\.now\(\) - ECWID_POLLED_AT < ECWID_POLL_MS/);
});

test('revalidation is a no-op when Ecwid is off or polling is disabled', () => {
  const fn = /async function ecwidFresh\(\)[\s\S]{0,900}?\n\}/.exec(src)[0];
  assert.match(fn, /if \(!ECWID_ON \|\| !ECWID_TOKEN\) return;/);
  assert.match(fn, /if \(ECWID_POLL_MS <= 0\) return;/);
});

test('the shared poll is declared before the server is created', () => {
  /* The ORDER_LOADERS crash again: a helper the timer needs, declared inside
     the request handler, passes node --check and dies on the first tick. */
  for (const name of ['async function pollEcwid', 'async function ecwidFresh', 'const ECWID_POLL_MS']) {
    const at = src.indexOf(name);
    assert.ok(at > -1, name + ' not found');
    assert.ok(at < src.indexOf('http.createServer'), name + ' is declared after createServer');
  }
});

test('the startup banner does not reference an undefined constant', () => {
  /* It first said ECWID_WEBHOOK_SECRET, which does not exist as a binding —
     a ReferenceError at boot that node --check cannot see. */
  assert.ok(!/\bECWID_WEBHOOK_SECRET\b/.test(src.replace(/SADKO_ECWID_WEBHOOK_SECRET/g, '')),
    'the startup log references an undefined ECWID_WEBHOOK_SECRET');
});

test('the poll detects DELETIONS, which updatedFrom can never report', () => {
  /* Compared by COUNT rather than by paging every id: one request instead of
     ~15 against this catalogue, and the real reconcile runs only when the
     numbers actually disagree. */
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /productCount\(\)/);
  assert.match(fn, /live !== mine/);
  assert.match(fn, /fullReconcile\(\)/);
});

test('a failed count skips the reconcile rather than triggering one', () => {
  /* live === null must not read as "the count changed". */
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /live != null && live !== mine/);
});

test('categories and settings refresh on a slower tick, not never', () => {
  /* They only came round on the daily full sync, so a new category or a
     payment method switched off took a day to show. */
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /ECWID_POLL_TICK % ECWID_SLOW_EVERY === 0/);
  assert.match(fn, /syncCategories\(\)/);
  assert.match(fn, /syncSettings\(\)/);
});

test('EVERY Ecwid-backed route revalidates before answering', () => {
  /* Only the adverts and the catalogue did, so a price change showed on the
     shop page while the product page still had the old one. */
  const routes = [
    "u.pathname.startsWith('/api/product/')",
    "u.pathname === '/api/shipping-methods'",
    "u.pathname === '/api/payment-methods'",
    "u.pathname === '/data/categories.json'",
    "u.pathname === '/data/collections.json'",
    "u.pathname === '/data/promos.json'",
    "u.pathname === '/data/products.json'",
  ];
  for (const r of routes) {
    const at = src.indexOf(r);
    assert.ok(at > -1, 'route not found: ' + r);
    const head = src.slice(at, at + 420);
    assert.match(head, /await ecwidFresh\(\);/, r + ' does not revalidate');
  }
});

/* ======================================================================
   Seeing and managing what Ecwid holds.

   Everything below existed as plumbing with no window onto it: the push
   queue was returned by the status route and never rendered, orders that
   parked after five failed attempts sat there invisibly, and there was no
   way to look up what Ecwid actually has for one customer.
   ================================================================== */

test('there is a route listing every order against its Ecwid counterpart', () => {
  assert.match(adminBlock[0], /seg\[1\] === 'orders' && req\.method === 'GET'/);
});

test('the order list separates pushed, waiting and PARKED', () => {
  /* A parked order is the one that needs a human: it has exhausted its
     retries and will never move on its own. Lumping it in with "waiting"
     is how it stays invisible. */
  /* Scoped to the route's own response object rather than a character window:
     the window was 2000 and broke when the join grew to carry a guest order's
     name and phone, which said nothing about whether the three groups were
     still being reported separately. */
  const route = /seg\[1\] === 'orders' && req\.method === 'GET'[\s\S]*?return json\(200, \{[\s\S]*?\n        \}\);/
    .exec(adminBlock[0])[0];
  for (const k of ['pushed', 'pending', 'parked'])
    assert.match(route, new RegExp(k + ':'), k + ' is not reported separately');
});

test('a parked order can be retried from the panel', () => {
  assert.match(adminBlock[0], /seg\[3\] === 'retry' && req\.method === 'POST'/);
  assert.match(adminBlock[0], /resetPush\(/);
});

test('retrying is audited, because it touches a real order', () => {
  const route = /seg\[3\] === 'retry' && req\.method === 'POST'[\s\S]{0,900}/.exec(adminBlock[0])[0];
  assert.match(route, /cadm\.log\(/);
});

test('there is a per-customer view of what Ecwid holds', () => {
  assert.match(adminBlock[0], /seg\[1\] === 'customer' && req\.method === 'GET'/);
});

test('the customer view reports NO ACCESS distinctly from "no such customer"', () => {
  /* On a public_ token both look identical — empty — and the owner would
     spend an afternoon deciding the link was broken. */
  const route = /seg\[1\] === 'customer' && req\.method === 'GET'[\s\S]{0,1800}/.exec(adminBlock[0])[0];
  assert.match(route, /no-access/);
});

test('neither new route can leak the token', () => {
  /* The whole admin block is already checked above; this pins the rule to
     the routes that newly talk to the customer and order endpoints. */
  const routes = /seg\[1\] === 'orders' && req\.method === 'GET'[\s\S]{0,3500}/.exec(adminBlock[0])[0];
  assert.ok(!/Bearer|SADKO_ECWID_TOKEN/.test(routes));
});

test('the status route says whether this token can read orders at all', () => {
  /* Six of the outstanding gaps are one 403. The panel should say so once,
     rather than showing an empty queue that looks like "no orders yet". */
  assert.match(src, /ECWID_ORDERS_READABLE/);
  const route = /rest === 'ecwid' && req\.method === 'GET'[\s\S]*?return json\(200, \{[\s\S]*?\n        \}\);/
    .exec(adminBlock[0])[0];
  assert.match(route, /ordersReadable/);
});

test('order status flows back on the POLL, not only from a webhook', () => {
  /* Ecwid can only deliver a webhook to a public URL, so before the site is
     live — and in development, always — the webhook path reaches nobody. */
  const fn = /async function pollEcwid\(\)[\s\S]{0,4000}?\n\}/.exec(src)[0];
  assert.match(fn, /syncOrderStatuses\(ORDER_LOADERS\)/);
});

test('the sync layer writes a status through the loaders, not the accounts db', () => {
  assert.match(src, /const ORDER_LOADERS = \{[\s\S]{0,900}setStatus:/);
});

test('a profile edit updates the Ecwid customer too', () => {
  /* It only ran at registration, so a corrected phone number never left the
     site — and the phone number is how staff ring the customer back. */
  const route = /u\.pathname === '\/api\/auth\/profile'[\s\S]{0,900}?\n      \}/.exec(src)[0];
  /* linkCustomerSoon, since the call moved into a helper that also queues and
     logs — what matters is that the profile route still triggers a link. */
  assert.match(route, /linkCustomerSoon\(/);
});
