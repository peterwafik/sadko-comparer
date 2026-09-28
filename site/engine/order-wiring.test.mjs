// site/engine/order-wiring.test.mjs
/* Asserts the server WIRES the order half together. compare-server.mjs opens
   databases and binds a port, so — like shop-wiring.test.mjs — this reads the
   source. The behaviour itself is covered by ecwid-push.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const accounts = readFileSync(path.join(SITE, 'engine', 'accounts.mjs'), 'utf8');

/* Scoped to the route's own final response rather than a character window:
   the window was 2200 and broke when catalogue re-pricing was added above
   createOrder, which said nothing about whether the order wiring still held. */
const orderHandler = /u\.pathname === '\/api\/orders' && req\.method === 'POST'[\s\S]*?return json\(200, \{ ok: true, order: r\.order \}\);/
  .exec(src)[0];

/* --------------------------- checkout -> queue --------------------------- */

test('a placed order is enqueued for Ecwid', () => {
  assert.match(orderHandler, /enqueueOrderPush/);
});

test('the local order is created BEFORE anything reaches Ecwid', () => {
  /* The customer's receipt must exist regardless of Ecwid. */
  const created = orderHandler.indexOf('createOrder');
  const queued = orderHandler.indexOf('enqueueOrderPush');
  assert.ok(created > -1 && queued > created,
    'the receipt must be written before the push is queued');
});

test('the checkout response never waits on Ecwid', () => {
  /* An Ecwid outage must not block a sale or delay the response. */
  assert.ok(!/await\s+(esy|ecwidSync\(\))\.pushOrder/.test(orderHandler),
    'checkout must not await the Ecwid push');
});

test('a failure to queue does not fail the order', () => {
  const block = /Hand the order to Ecwid[\s\S]{0,900}/.exec(orderHandler)[0];
  assert.match(block, /catch/, 'queueing must never throw out of checkout');
});

/* ------------------------ status flowing back --------------------------- */

test('the order webhook is handled, not logged and dropped', () => {
  assert.ok(!/handler arrives in Task 13/.test(src), 'the placeholder is still there');
  assert.match(src, /applyEcwidOrderEvent\(ev\)/);
});

test('the handler maps Ecwid status through toLocalStatus', () => {
  const fn = /async function applyEcwidOrderEvent[\s\S]{0,1400}/.exec(src)[0];
  assert.match(fn, /toLocalStatus\(remote\)/);
});

test('an unmapped Ecwid status leaves the local status untouched', () => {
  /* Inventing a transition would lie to the customer about their own order. */
  const fn = /async function applyEcwidOrderEvent[\s\S]{0,1400}/.exec(src)[0];
  assert.match(fn, /if \(!status\) return;/);
});

test('the handler finds our ref from the field OR the comments', () => {
  /* toEcwidOrder writes SDK-… in both places, so a store where the dedicated
     field is not queryable still works. */
  const fn = /async function applyEcwidOrderEvent[\s\S]{0,1400}/.exec(src)[0];
  assert.match(fn, /externalOrderId/);
  assert.match(fn, /SDK-/);
});

test('a status that already matches is not rewritten', () => {
  const fn = /async function applyEcwidOrderEvent[\s\S]{0,1400}/.exec(src)[0];
  assert.match(fn, /local\.status === status/);
});

test('accounts can find an order by ref alone, because a webhook has no session', () => {
  assert.match(accounts, /orderByRefAny:/);
});

test('the owner-scoped lookup still exists for anything a customer reaches', () => {
  assert.match(accounts, /orderByRef:/,
    'orderByRefAny must be an addition, not a replacement');
});

/* ------------------------------ the timer ------------------------------- */

test('parked pushes are retried on a timer', () => {
  assert.match(src, /pushPendingOrders\(ORDER_LOADERS\)/);
});

test('the loaders are defined once and shared', () => {
  /* The timer, the immediate push and the admin retry must load an order
     identically, or a retry could push something different from the original. */
  assert.equal(src.split('const ORDER_LOADERS').length - 1, 1, 'ORDER_LOADERS defined more than once');
  assert.ok(src.split('ORDER_LOADERS').length - 1 >= 4, 'expected the loaders to be reused');
});

/* ------------------------------ admin desk ------------------------------ */

test('the admin panel can see pending and failed pushes', () => {
  assert.match(src, /pendingPushes:/);
  assert.match(src, /failedPushes:/);
});

test('a parked push can be retried from admin', () => {
  assert.match(src, /seg\[1\] === 'push'/);
  assert.match(src, /resetPush\(ref\)/);
});

test('the retry is audited', () => {
  const route = /seg\[1\] === 'push'[\s\S]{0,700}/.exec(src)[0];
  assert.match(route, /cadm\.log\(actor, 'ecwid\.push'/);
});

/* --------------- what must NOT have changed ------------------- */

test('the local order status write still exists', () => {
  /* Staff need it until order status genuinely round-trips through Ecwid in
     production. Removing it would leave them unable to update an order. */
  assert.match(src, /db\.setOrderStatus\(/);
});

test('no grand total is ever synthesised on the way to Ecwid', () => {
  const map = readFileSync(path.join(SITE, 'engine', 'ecwid-map.mjs'), 'utf8');
  const fn = /export function toEcwidOrder[\s\S]{0,3000}/.exec(map)[0];
  assert.ok(!/shippingRate/.test(fn), 'a shipping rate must never be fabricated');
  assert.match(fn, /total: subtotal/, 'the total must be the items subtotal');
});

/* ------------------- scope: the bug tests did not catch ----------------- */

test('ORDER_LOADERS is declared at MODULE scope, not inside the request handler', () => {
  /* The bug this pins cost a crashed server. ORDER_LOADERS was declared inside
     the http.createServer callback, so the push timer — which lives in the
     listen callback — could not see it. The module loaded fine, `node --check`
     passed, and every source assertion above passed, because they only ask
     whether the text exists. The server then died the first time the 2-minute
     timer fired, with "ORDER_LOADERS is not defined".

     Asserting POSITION is what catches it: a declaration the timer needs must
     appear before the server is created. */
  const decl = src.indexOf('const ORDER_LOADERS');
  const server = src.indexOf('http.createServer');
  assert.ok(decl > -1, 'ORDER_LOADERS not found');
  assert.ok(server > -1, 'createServer not found');
  assert.ok(decl < server,
    'ORDER_LOADERS is declared inside the request handler — the push timer cannot see it');
});

test('applyEcwidOrderEvent is also at module scope', () => {
  const decl = src.indexOf('async function applyEcwidOrderEvent');
  const server = src.indexOf('http.createServer');
  assert.ok(decl > -1 && decl < server,
    'the order-event handler must be reachable from outside the request handler');
});

test('everything the timers reference is declared before the server is created', () => {
  /* Generalised: any identifier used inside the listen callback must be in
     scope there. These are the ones the Ecwid timers use. */
  const server = src.indexOf('http.createServer');
  for (const name of ['const ORDER_LOADERS', 'function ecwidSync', 'function ecwidSource']) {
    const at = src.indexOf(name);
    assert.ok(at > -1, name + ' not found');
    assert.ok(at < server, name + ' is declared after createServer, so the timers cannot use it');
  }
});

/* ======================================================================
   Guest checkout — buying without an account.

   The delivery form was already almost right; what matters is that the
   guest path and the account path did not fork into two forms that drift,
   and that the things a guest order MUST carry are actually carried.
   ================================================================== */

const CO = readFileSync(path.join(import.meta.dirname, '..', 'assets', 'js', 'checkout.js'), 'utf8');

test('a signed-out visitor gets the order form, not a sign-in wall', () => {
  assert.match(CO, /if \(GUEST\) \{ root\.innerHTML = form\(null, items\); wire\(null, items\); return; \}/);
});

test('guest is the DEFAULT, because the account is the detour', () => {
  assert.match(CO, /let GUEST = true;/);
});

test('ONE form serves both, so they cannot drift apart', () => {
  /* Two forms would mean a field added to one and forgotten in the other. */
  assert.equal((CO.match(/function form\(/g) || []).length, 1, 'there must be exactly one form()');
  assert.match(CO, /const guest = !u;/);
});

test('a guest is asked for an email, and it is required', () => {
  /* Ecwid files the order, and the customer record staff search, under the
     email. Without it the order lands in Ecwid as an orphan. */
  /* Anchored on the guest conditional and closed at the next `: '') +`,
     rather than guessing the punctuation in between. */
  const field = /\(guest \? '<label[\s\S]*?: ''\) \+/.exec(CO);
  assert.ok(field, 'no guest-only email field');
  assert.match(field[0], /name="email"/);
  assert.match(field[0], /required/);
  assert.match(field[0], /type="email"/);
});

test('the account-only fields are read defensively, since u is null for a guest', () => {
  /* u.name on a null user is a TypeError that blanks the whole page. */
  assert.match(CO, /\(u && u\.name\) \|\| ''/);
  assert.match(CO, /\(u && u\.phone\) \|\| ''/);
  assert.match(CO, /esc\(\(u && u\.address\) \|\| ''\)/);
  assert.match(CO, /const p = \(u && u\.profile\) \|\| \{\};/);
});

test('a guest posts to the guest route, on an absolute path', () => {
  /* A.P() would make it relative, which resolves wrongly from the generated
     /category/*.html pages. */
  assert.match(CO, /fetch\('\/api\/orders\/guest\?lang='/);
  assert.match(CO, /credentials: 'same-origin'/);
});

test('saving the address for next time is skipped for a guest', () => {
  /* There is no account to save it to, and Au.saveProfile would 401. */
  assert.match(CO, /if \(user\) Au\.saveProfile\(/);
});

test('an order that did not reach Ecwid is still reported as placed', () => {
  /* It is queued and retries, and customer care rings either way. Telling
     the customer it failed would lose a sale that was actually made. */
  const fn = /async function placeGuestOrder\([\s\S]{0,1400}?\n    \}/.exec(CO)[0];
  assert.match(fn, /inEcwid: d\.inEcwid/);
  assert.ok(!/d\.inEcwid \?|!d\.inEcwid/.test(fn.replace(/inEcwid: d\.inEcwid/, '')),
    'inEcwid must not gate whether the order counts as placed');
});

test('the guest confirmation still refuses to invent a grand total', () => {
  /* Same receipt, same rule: delivery and installation are confirmed by
     phone, and a zero would read as free delivery. */
  const fn = /async function placeGuestOrder\([\s\S]{0,1400}?\n    \}/.exec(CO)[0];
  assert.match(fn, /totals: d\.totals/);
  assert.ok(!/grandTotal:/.test(fn), 'the client must not compute a total');
});

/* ======================================================================
   Both order routes re-price against the catalogue.

   The guest route did; the signed-in one did not. A session proves who a
   customer is, not that the figures their browser posted are the ones on
   the shop page — and the order goes on to their own receipt and into
   Ecwid as the agreed price.
   ================================================================== */

test('ONE re-pricing helper serves both routes', () => {
  /* Two copies drift, and the one that drifts is the one nobody tests. */
  assert.match(src, /async function repriceOrder\(items\)/);
  /* Three callers since 2026-09-28: both order routes, and the delivery
     quote endpoint — which must price lines exactly as the order will. */
  assert.equal((src.match(/await repriceOrder\(/g) || []).length, 3,
    'both order routes and the delivery quote should call it, and only they');
  assert.match(src, /import \{ repriceLines \} from '\.\/engine\/order-pricing\.mjs';/);
});

test('the SIGNED-IN route re-prices before the order is created', () => {
  /* After createOrder would be too late: the receipt would already exist. */
  const route = /u\.pathname === '\/api\/orders' && req\.method === 'POST'[\s\S]*?return json\(200, \{ ok: true, order: r\.order \}\);/
    .exec(src);
  assert.ok(route, 'the account order route is gone');
  const at = route[0].indexOf('await repriceOrder(');
  const created = route[0].indexOf('db.createOrder(');
  assert.ok(at > -1, 'the signed-in route does not re-price');
  assert.ok(at < created, 're-pricing must happen BEFORE the order is created');
});

test('the re-priced lines are what actually get stored', () => {
  /* Re-pricing and then storing the posted body would change nothing. */
  assert.match(src, /db\.createOrder\(me\.id, \{ \.\.\.b, items: priced\.items, deliveryQuote: quote \}\)/);
});

test('an unreadable catalogue REFUSES the order rather than trusting the browser', () => {
  /* Failing open restores exactly the bug this closes. */
  const fn = /async function repriceOrder\(items\)[\s\S]{0,600}?\n\}/.exec(src)[0];
  assert.match(fn, /catalogue-unavailable/);
  assert.ok(!/\breturn \{ ok: true/.test(fn.split('catch')[1] || ''),
    'the failure path must not return a success');
  /* And both routes must handle it as a refusal, not ignore it. */
  assert.equal((src.match(/priced\.error === 'catalogue-unavailable'/g) || []).length, 2);
});
