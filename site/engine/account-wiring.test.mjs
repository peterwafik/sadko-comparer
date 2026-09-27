// site/engine/account-wiring.test.mjs
/* The accounts half of the Ecwid link. Source-level for the same reason as
   shop-wiring and order-wiring: compare-server.mjs opens databases and binds a
   port, and account.js is a browser IIFE. The mapping behaviour itself is
   covered by ecwid-customers.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const account = readFileSync(path.join(SITE, 'assets', 'js', 'account.js'), 'utf8');
const sync = readFileSync(path.join(SITE, 'engine', 'ecwid-sync.mjs'), 'utf8');
const api = readFileSync(path.join(SITE, 'engine', 'ecwid-api.mjs'), 'utf8');

/* ------------------- the limit, stated in the code --------------------- */

test('the code says plainly that Ecwid cannot authenticate a customer', () => {
  /* Ecwid has no endpoint that verifies a customer password, and its SSO runs
     the other way round — the merchant site is the identity provider. Anyone
     later asked for "log in with Ecwid" must find that written down rather
     than rediscover it. */
  const mod = readFileSync(path.join(SITE, 'engine', 'ecwid-customers.mjs'), 'utf8');
  /* \s+ rather than a literal space: the sentence wraps in the source. */
  assert.match(mod, /no\s+API\s+for\s+verifying\s+a\s+customer's\s+password/i);
});

test('no password or hash is ever sent to Ecwid', () => {
  const mod = readFileSync(path.join(SITE, 'engine', 'ecwid-customers.mjs'), 'utf8');
  const fn = /export function toEcwidCustomer[\s\S]{0,1800}?\n}/.exec(mod)[0];
  assert.ok(!/password|passwordHash|\bsalt\b/i.test(fn.replace(/no password[^\n]*/gi, '')),
    'toEcwidCustomer references a credential field');
});

/* --------------------------- the customer link -------------------------- */

test('registering links the customer in Ecwid', () => {
  const route = /'\/api\/auth\/register' && req\.method === 'POST'[\s\S]{0,1400}/.exec(src)[0];
  assert.match(route, /linkCustomer/);
});

test('the link never blocks or fails a signup', () => {
  /* An Ecwid round trip must not slow registration, and Ecwid being
     unreachable must not stop someone creating an account.

     Asserted against linkCustomerSoon() rather than against the shape of the
     call in the route: this test used to require the literal
     `try { ecwidSync().linkCustomer(...).catch(` and broke when that moved
     into a helper — which said nothing about whether a signup could still be
     blocked by Ecwid. */
  const route = /'\/api\/auth\/register' && req\.method === 'POST'[\s\S]{0,1400}/.exec(src)[0];
  assert.ok(!/await\s+\w*[lL]inkCustomer/.test(route), 'the signup awaits the Ecwid link');

  const fn = /function linkCustomerSoon\(user\)[\s\S]{0,2000}?\n\}/.exec(src);
  assert.ok(fn, 'linkCustomerSoon is gone');
  assert.match(fn[0], /try \{/, 'the call itself is not guarded');
  assert.ok(!/\bawait\b/.test(fn[0]), 'the helper must not await, or it would block the response');

  /* The rejection guard lives in chainCustomerPush now, which is where the
     promise is actually retained. Asserted there rather than dropped: an
     unhandled rejection is still the failure this test exists to prevent. */
  const chain = /function chainCustomerPush[\s\S]{0,1200}?\n\}/.exec(src);
  assert.ok(chain, 'chainCustomerPush is gone');
  assert.match(chain[0], /\.catch\(/, 'a rejected link would become an unhandled rejection');
  assert.ok(!/\bawait\b/.test(chain[0]), 'the chain must not await either');
});

test('a failed link is LOGGED, not swallowed', () => {
  /* The fault the owner hit: an account was created on the site and simply
     was not in Ecwid, with nothing anywhere saying why. The old code was
     `.catch(() => {})`. */
  const fn = /function linkCustomerSoon\(user\)[\s\S]{0,2000}?\n\}/.exec(src)[0];
  assert.match(fn, /console\.warn/);
  assert.match(fn, /403/, 'the 403 case should name itself, since it is the likely one');
  assert.ok(!/catch\(\(\) => \{\}\)/.test(fn), 'the failure must not be swallowed');
});

test('a customer who could not be linked is QUEUED, not forgotten', () => {
  /* Linking ran once, at registration. Every account created before a
     working token existed would have stayed missing from Ecwid forever. */
  const fn = /function linkCustomerSoon\(user\)[\s\S]{0,2000}?\n\}/.exec(src)[0];
  assert.match(fn, /enqueueCustomerLink\(user\.email\)/);
  assert.match(src, /linkPendingCustomers\(LINK_LOADER\)/, 'nothing works the queue');
});

test('existing accounts are backfilled into the queue at startup', () => {
  /* Otherwise the fix would only help accounts created after it shipped. */
  assert.match(src, /customerLinkRow\(u\.email\)/);
  assert.match(src, /queued for customer linking/);
});

test('the queue reads the customer from accounts at attempt time', () => {
  /* So the queue holds only an email and never becomes a second copy of the
     customer — the same reasoning that keeps guest orders out of accounts.db. */
  assert.match(src, /const LINK_LOADER = async email =>/);
  assert.match(src, /db\.getUserByEmail\(email\)/);
});

test('linkCustomer only ADDS to Ecwid, never overwrites what staff corrected', () => {
  const fn = /async function linkCustomer[\s\S]{0,3000}?\n  \}/.exec(sync)[0];
  /* The gate is a per-FIELD patch now, not a boolean: PUTting the whole payload
     would overwrite every OTHER detail staff had corrected, which is exactly why
     this used to send one hardcoded field and nothing else. */
  assert.match(fn, /customerUpdatePatch/);
  assert.match(fn, /api\.updateCustomer\(existing\.id, patch\)/,
    'only the fields that changed may be written');
  assert.ok(!/updateCustomer\([^)]*desired\)/.test(fn),
    'the whole desired payload must never be PUT wholesale');
});

test('what we last pushed is remembered, or the next push cannot tell user from staff', () => {
  /* The discriminator. With no snapshot the rule degrades to fill-only, and a
     customer who corrects their own phone never reaches Ecwid again. */
  const fn = /async function linkCustomer[\s\S]{0,3000}?\n  \}/.exec(sync)[0];
  assert.match(fn, /store\.markCustomerLinked\(desired\.email, id, desired\)/, 'on create');
  assert.match(fn, /store\.customerPushSnapshot\(desired\.email\)/, 'read back on update');
});

test('a 403 from a public_ token is a configuration state, not an error', () => {
  const fn = /async function linkCustomer[\s\S]{0,3000}?\n  \}/.exec(sync)[0];
  assert.match(fn, /no-access/);
  assert.ok(!/throw/.test(fn), 'linkCustomer throws — registration would see it');
});

/* -------------------- the orders the customer can see ------------------- */

test('THE POINT: /api/orders merges what Ecwid holds for this customer', () => {
  /* SADKO sells by phone and in showrooms; staff type those into Ecwid. A
     customer who rang 19140 used to open their account and see nothing. */
  const route = /u\.pathname === '\/api\/orders' && req\.method === 'GET'[\s\S]{0,1400}/.exec(src)[0];
  assert.match(route, /remoteOrdersCached/);
  assert.match(route, /mergeOrders\(local, remote\)/);
});

test('the local orders are returned even when Ecwid gives nothing', () => {
  const route = /u\.pathname === '\/api\/orders' && req\.method === 'GET'[\s\S]{0,1400}/.exec(src)[0];
  assert.match(route, /remote\.length \? mergeOrders\(local, remote\) : local/);
});

test('the remote read cannot throw out of the orders route', () => {
  const fn = /async function remoteOrdersCached[\s\S]{0,1400}?\n\}/.exec(src)[0];
  assert.match(fn, /catch \(e\) \{ orders = \[\]; \}/);
});

test('remoteOrdersFor swallows every failure — an outage must not empty the page', () => {
  const fn = /async function remoteOrdersFor[\s\S]{0,900}?\n  \}/.exec(sync)[0];
  assert.match(fn, /catch \(e\) \{ return \[\]; \}/);
  assert.match(fn, /if \(!api\.configured \|\| !email\) return \[\];/);
});

test('the per-customer cache is bounded, in a long-lived process', () => {
  const fn = /async function remoteOrdersCached[\s\S]{0,1400}?\n\}/.exec(src)[0];
  assert.match(fn, /REMOTE_ORDERS\.size > \d+/);
  assert.match(fn, /REMOTE_ORDERS\.delete/);
});

test('remoteOrdersCached is declared before the server, like the other shared helpers', () => {
  /* The bug this pins already cost a crashed server once, with
     ORDER_LOADERS. Position, not presence. */
  const decl = src.indexOf('async function remoteOrdersCached');
  const server = src.indexOf('http.createServer');
  assert.ok(decl > -1 && decl < server,
    'remoteOrdersCached is declared inside the request handler');
});

test('the customer reads need only a query, not a scope the app lacks silently', () => {
  assert.match(api, /customerByEmail/);
  assert.match(api, /ordersByEmail/);
  /* The 403 on a public_ token is documented where the calls are, so the next
     person does not read it as a broken endpoint. */
  assert.match(api, /public_/);
});

/* --------------------- the bug the table was hiding -------------------- */

test('the account order table shows the REAL status, not a hardcoded string', () => {
  /* This cell was the literal "اتسجّل / Received" on every row, so the whole
     status round-trip ended at a column that ignored the answer and a
     delivered order told its customer it had merely been received. */
  assert.match(account, /statusName\(o\.status\)/);
  assert.ok(!/<span class="chip chip--mute">' \+ t\('اتسجّل', 'Received'\)/.test(account),
    'the hardcoded Received cell is back');
});

test('the status vocabulary matches the mapper exactly', () => {
  /* engine/ecwid-map.mjs's FULFILMENT table is the source of truth; a status
     it can produce but this cannot name would render as a fallback. */
  const map = readFileSync(path.join(SITE, 'engine', 'ecwid-map.mjs'), 'utf8');
  const table = /const FULFILMENT = \{[\s\S]*?\};/.exec(map)[0];
  const produced = new Set([...table.matchAll(/:\s*'([a-z]+)'/g)].map(m => m[1]));
  produced.add('cancelled');                 // from DEAD_PAYMENT
  const fn = /function statusName\(k\)[\s\S]{0,900}?\n    \}/.exec(account)[0];
  for (const st of produced) {
    assert.match(fn, new RegExp('\\b' + st + ':'), 'the account page cannot name the status "' + st + '"');
  }
});

test('an unknown status is labelled, not left blank', () => {
  const fn = /function statusName\(k\)[\s\S]{0,900}?\n    \}/.exec(account)[0];
  assert.match(fn, /\|\| t\(/);
});

test('every status chip class is one app.css actually defines', () => {
  /* A class that does not exist renders an unstyled chip — the status keeps
     its text and silently loses its colour. */
  const css = readFileSync(path.join(SITE, 'assets', 'css', 'app.css'), 'utf8');
  const fn = /function statusChip\(k\)[\s\S]{0,700}?\n    \}/.exec(account)[0];
  const used = [...fn.matchAll(/'(chip--[a-z]+)'/g)].map(m => m[1]);
  assert.ok(used.length >= 3, 'the chip mapping looks empty');
  for (const cls of used) {
    assert.ok(css.includes('.' + cls), 'app.css has no ' + cls);
  }
});

test('the payment column resolves an Ecwid method id to the plan name', () => {
  /* It printed the raw id at the customer — "51353-1761549067023" instead of
     "تقسيط البنك الاهلي ( ٦ اشهر بدون فوائد )" — because payName only knew the
     three legacy keys, and an Ecwid id is what checkout sends now. */
  const fn = /function payName\(k\)[\s\S]{0,1300}?\n    \}/.exec(account)[0];
  assert.match(fn, /PAYMETHODS \|\| \[\]/);
  assert.match(fn, /String\(m\.id\) === String\(k\)/);
  assert.match(fn, /return hit\.title/);
});

test('the legacy keys still translate, for orders placed before Ecwid', () => {
  const fn = /function payName\(k\)[\s\S]{0,1300}?\n    \}/.exec(account)[0];
  for (const k of ['cod', 'bank', 'showroom']) assert.match(fn, new RegExp(k + ':'));
});

test('the method names are loaded BEFORE the table renders, not after', () => {
  /* Fetching them afterwards would print ids and then replace them. */
  const fn = /async function loadOrders\(\)[\s\S]{0,900}/.exec(account)[0];
  assert.match(fn, /Promise\.all\(\[Au\.orders\(\), loadPayMethods\(\)\]\)/);
});

test('a failed method load degrades to the legacy keys rather than breaking the page', () => {
  const fn = /function loadPayMethods\(\)[\s\S]{0,700}?\n    \}/.exec(account)[0];
  assert.match(fn, /\.catch\(/);
});

/* ---------------------------- the origin label -------------------------- */

test('an order staff created is labelled, so it does not read as an error', () => {
  assert.match(account, /o\.origin === 'ecwid'/);
  assert.match(account, /via customer care/);
});

test('the grand total is shown only when Ecwid genuinely holds one', () => {
  /* Otherwise the goods subtotal, SAID to be goods only — never a total this
     page assembled from a delivery charge nobody quoted. */
  assert.match(account, /o\.total != null \? o\.total : o\.subtotal/);
  assert.match(account, /goods only/);
});

/* ============ addresses: every route that changes a saved place ===========
   A home only reached Ecwid as a side effect of ORDERING, so a customer could
   add, rename or delete a delivery address and the control panel would never
   know. Every mutating route must push, deletion included — a mirror that only
   grows is not a mirror. */

const HOME_ROUTES = [
  ["POST",   /u\.pathname === '\/api\/auth\/homes' && req\.method === 'POST'[\s\S]{0,900}?\n      \}/],
  ["PATCH",  /u\.pathname === '\/api\/auth\/homes' && \(req\.method === 'PATCH'[\s\S]{0,900}?\n      \}/],
  ["DELETE", /u\.pathname === '\/api\/auth\/homes' && req\.method === 'DELETE'[\s\S]{0,900}?\n      \}/],
  ["active", /u\.pathname === '\/api\/auth\/homes\/active'[\s\S]{0,900}?\n      \}/],
];

for (const [name, re] of HOME_ROUTES) {
  test(`the homes ${name} route pushes the customer to Ecwid`, () => {
    const m = re.exec(src);
    assert.ok(m, `the homes ${name} route could not be found`);
    assert.match(m[0], /linkCustomerSoon\(r\.user\)/,
      'r.user is publicUser(), which carries homes, activeHomeId and address');
  });
}

test('the pushed customer payload is built from homes, not invented', () => {
  /* toEcwidCustomer omits shippingAddresses entirely when there are no homes,
     which is what stops a push from CLEARING an address Ecwid captured from a
     real order. An empty array would wipe it. */
  const cust = readFileSync(path.join(SITE, 'engine', 'ecwid-customers.mjs'), 'utf8');
  assert.match(cust, /shippingAddresses: homesToAddresses\(user\)/);
  assert.match(cust, /return out\.length \? out : undefined/,
    'no homes must mean the key is absent, never []');
});

/* ================= status, pushed UP from the admin desk ================== */

test('the admin orders desk tells Ecwid about a status it changed', () => {
  const route = /seg\[0\] === 'orders' && seg\[2\] === 'status'[\s\S]{0,1800}?\n      \}/.exec(src)[0];
  assert.match(route, /esy\.pushOrderStatus\(ref, b\.status\)/);
});

test('a failed status push does NOT fail the request — the local change happened', () => {
  /* Returning 400 would tell the operator their click did nothing, which is
     false: setOrderStatus has already committed and written the audit row. */
  const route = /seg\[0\] === 'orders' && seg\[2\] === 'status'[\s\S]{0,1800}?\n      \}/.exec(src)[0];
  assert.match(route, /catch \(e\) \{ ecwid = \{ ok: false/);
  assert.match(route, /json\(200, \{ \.\.\.r, ecwid \}\)/,
    'the outcome is reported to the caller rather than swallowed or thrown');
  const afterPush = route.slice(route.indexOf('pushOrderStatus'));
  assert.ok(!/json\(4\d\d/.test(afterPush), 'no 4xx may be returned after the local write');
});

test('the two non-failures are not logged as failures', () => {
  /* not-pushable is `confirmed`, by design; not-in-ecwid is an order still in
     the push queue, which will carry its status when it is created. Logging
     either as an error would train the owner to ignore the log. */
  const route = /seg\[0\] === 'orders' && seg\[2\] === 'status'[\s\S]{0,1800}?\n      \}/.exec(src)[0];
  assert.match(route, /reason !== 'not-pushable' && ecwid\.reason !== 'not-in-ecwid'/);
});

/* ==================== guests become customers too ======================== */

test('a guest checkout creates the Ecwid customer BEFORE pushing the order', () => {
  const route = /u\.pathname === '\/api\/orders\/guest' && req\.method === 'POST'[\s\S]*?\n  \}/.exec(src)[0];
  const cAt = route.indexOf('guestCustomerOf(order)');
  const oAt = route.indexOf('esy.pushOrder(order.ref');
  assert.ok(cAt > 0 && oAt > 0, 'both steps must be present');
  assert.ok(cAt < oAt, 'the customer must exist before the order is filed against it');
});

test('the guest queue row is created first, or the link is written to nothing', () => {
  /* linkCustomer records itself with an UPDATE on customer_link. With no row,
     the customer id and the push snapshot are silently discarded. */
  const route = /u\.pathname === '\/api\/orders\/guest' && req\.method === 'POST'[\s\S]*?\n  \}/.exec(src)[0];
  const eAt = route.indexOf('st.enqueueCustomerLink(guestCustomer.email)');
  const lAt = route.indexOf('esy.linkCustomer(guestCustomer)');
  assert.ok(eAt > 0 && lAt > 0);
  assert.ok(eAt < lAt, 'enqueue must precede the link attempt');
});

test('a guest who cannot be linked can still buy', () => {
  const route = /u\.pathname === '\/api\/orders\/guest' && req\.method === 'POST'[\s\S]*?\n  \}/.exec(src)[0];
  const block = route.slice(route.indexOf('guestCustomerOf(order)'), route.indexOf('let pushed = null'));
  assert.match(block, /catch \(e\)/, 'the link must not be able to throw out of checkout');
  assert.ok(!/return json/.test(block), 'a failed link must never abort the order');
});

/* =============== orders that never reached Ecwid, at boot ================= */

test('unsent orders are revived at startup, like accounts already are', () => {
  assert.match(src, /est\.unsentOrderRefs\(\)/);
  assert.match(src, /order\(s\) queued for push/, 'a restart says what it is about to do');
});

test('reviving a parked order restores its retry budget, not just the delay', () => {
  /* The due query filters attempts < MAX_ATTEMPTS as well as the delay, so
     clearing only next_attempt_at queues work the poller will never pick up —
     which is where SDK-DED885 sat with seven attempts and no Ecwid id. */
  const store = readFileSync(path.join(SITE, 'engine', 'ecwid-store.mjs'), 'utf8');
  assert.match(store, /UPDATE order_push SET attempts = 0, next_attempt_at = NULL/);
});

/* ======== a status the site just set must not regress on her own page ======
   FOUND BY THE END-TO-END JOURNEY, and caused by two correct things meeting:

     · mergeOrders takes the REMOTE status for an order that exists in both,
       because Ecwid is the master; and
     · remoteOrdersCached holds that remote read for 60 seconds.

   So after staff marked an order delivered on the admin desk, the customer's own
   page showed it back at "received" for up to a minute — a visible backwards
   step on the one screen she checks. The local write and the Ecwid push were
   both already correct; only the cached copy was stale.

   The fix is to drop that customer's cached remote read when the site changes
   one of their statuses, so the next page load re-reads Ecwid — which by then
   holds the pushed status. */

test('a local status change invalidates that customer\'s cached Ecwid orders', () => {
  const route = /seg\[0\] === 'orders' && seg\[2\] === 'status'[\s\S]{0,2400}?\n      \}/.exec(src)[0];
  assert.match(route, /forgetRemoteOrders/,
    'without this the customer sees the OLD status for up to the cache TTL');
});

test('the cache is dropped for the order\'s own customer, not flushed wholesale', () => {
  /* Flushing every entry would make one status change re-read Ecwid for every
     signed-in customer, which is what the cache exists to prevent. */
  const fn = /function forgetRemoteOrders[\s\S]{0,900}?\n\}/.exec(src)[0];
  assert.match(fn, /REMOTE_ORDERS\.delete/);
  assert.ok(!/REMOTE_ORDERS\.clear/.test(fn), 'a targeted delete, never a clear');
});

test('forgetting the cache cannot throw out of the status route', () => {
  /* The status change has already committed by then; a cache miss must never
     turn a successful admin action into a 500. */
  const fn = /function forgetRemoteOrders[\s\S]{0,900}?\n\}/.exec(src)[0];
  assert.match(fn, /try \{/);
  assert.match(fn, /catch/);
});

/* ============ two quick edits must not leave Ecwid on the older one =========
   FOUND BY THE END-TO-END JOURNEY, intermittently, which is the worst way to
   find anything. Adding two saved places back to back fires two fire-and-forget
   pushes for the SAME customer. Each carries the user state as it was when the
   route ran, so the second carries both places and the first carries one — and
   nothing ordered them. When the one-place push happened to land last, Ecwid was
   left holding one address and stayed that way, because the next push only
   happens when the customer edits something again.

   Pushes for one email are therefore serialised: they still never block the
   request, but they run in the order the edits happened, so the last write is
   the newest state. Different customers are unaffected and still run in
   parallel. */

test('customer pushes are serialised per email, so the newest state wins', () => {
  const fn = /function linkCustomerSoon[\s\S]{0,2600}?\n\}/.exec(src)[0];
  assert.match(fn, /chainCustomerPush\(user\.email/, 'the push must go through the chain');
  const chain = /function chainCustomerPush[\s\S]{0,1200}?\n\}/.exec(src)[0];
  assert.match(chain, /LINK_CHAIN\.get\(/, 'each push waits on the previous one for that email');
  assert.match(chain, /LINK_CHAIN\.set\(/);
});

test('the chain is keyed per customer, not one global lock', () => {
  /* A single global lock would make every customer wait behind every other,
     turning a signup spike into a queue. */
  assert.match(src, /const LINK_CHAIN = new Map\(\)/);
  const chain = /function chainCustomerPush[\s\S]{0,1200}?\n\}/.exec(src)[0];
  assert.match(chain, /String\(email\).*toLowerCase\(\)/, 'the key is the email, normalised');
  /* And it must not grow forever in a long-lived process. */
  assert.match(chain, /LINK_CHAIN\.delete\(key\)/);
});

test('signing up still never waits on Ecwid', () => {
  /* The whole point of fire-and-forget: registration must not be slowed or
     failed by the store. Serialising must not turn into awaiting. */
  const register = /u\.pathname === '\/api\/auth\/register'[\s\S]{0,1200}?\n      \}/.exec(src)[0];
  assert.match(register, /linkCustomerSoon\(r\.user\)/);
  assert.ok(!/await linkCustomerSoon/.test(src), 'it must never be awaited by a route');
});

test('a failed push does not poison the chain for later edits', () => {
  /* If a rejection propagated, every subsequent edit for that customer would
     inherit a rejected promise and never run. The .catch must come BEFORE the
     .then that runs the next push. */
  const chain = /function chainCustomerPush[\s\S]{0,1200}?\n\}/.exec(src)[0];
  /* Order matters: prev.catch(...) must come before .then(work). Checked by
     position rather than with one regex, because the arrow body carries its
     own parentheses and a character class cannot span them. */
  const c = chain.indexOf('prev.catch('), th = chain.indexOf('.then(work)');
  assert.ok(c > 0 && th > c, 'a failed predecessor must not stop its successor');
});
