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

const orderHandler = /u\.pathname === '\/api\/orders' && req\.method === 'POST'[\s\S]{0,2200}/.exec(src)[0];

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
