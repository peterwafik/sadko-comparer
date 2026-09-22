// site/engine/admin-ecwid-wiring.test.mjs
//
// The admin panel's Ecwid cells, tested the way shop-wiring.test.mjs tests
// shop.js: admin.js is a browser IIFE, so the two pure render functions are
// extracted and evaluated in isolation.
//
// Worth pinning behaviourally rather than by screenshot, because the three
// order states each mean something different to the person reading them:
// "filed" wants a link, "waiting" wants nothing, and "stopped" is the only
// one that needs a human — and getting that wrong makes a stuck order look
// like a healthy one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'assets', 'js', 'admin.js'), 'utf8');

function functionBody(source, name) {
  const head = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*{');
  const m = head.exec(source);
  assert.ok(m, 'function ' + name + ' not found in admin.js');
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (depth > 0) {
    assert.ok(i < source.length, 'unbalanced braces while scanning ' + name + '()');
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

/* The two helpers admin.js uses, with the panel's own tiny dependencies
   supplied: esc() is the real escaper's contract, t() returns the key so an
   assertion can name the label without depending on its Arabic wording. */
const ESC = `function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function t(k){return k;}`;

const cellFn = new Function('row', 'storeId',
  ESC + '\n' + functionBody(src, 'ecwidOrderCell'));
const mapFn = new Function('d',
  ESC + '\n' + functionBody(src, 'ecwidOrderMap'));
const custFn = new Function('r',
  ESC + '\n' + functionBody(src, 'ecwidCustomerCell'));

/* --------------------------- the order cell ----------------------------- */

test('a FILED order links straight into Ecwid, by order id', () => {
  /* The point of the column: staff stop searching the Ecwid panel by hand. */
  const html = cellFn({ state: 'pushed', ref: 'SDK-AAA111', ecwidOrderId: '900' }, '142682751');
  assert.match(html, /my\.ecwid\.com\/store\/142682751#order:id=900/);
  assert.match(html, /ecwidInStore/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/, 'an outbound link needs noopener');
});

test('a STOPPED order shows its real error and the only Retry button', () => {
  /* It has exhausted its attempts and will never move on its own. If this
     reads like "waiting", the order is simply lost. */
  const html = cellFn(
    { state: 'parked', ref: 'SDK-BBB222', attempts: 6, lastError: 'ecwid-403: forbidden' },
    '142682751');
  assert.match(html, /ecwidParked/);
  assert.match(html, /ecwid-retry/, 'a parked order must offer a retry');
  assert.match(html, /data-ref="SDK-BBB222"/);
  assert.match(html, /ecwid-403/, 'the actual error is what tells someone what to do');
});

test('a WAITING order offers no button, because it retries itself', () => {
  const html = cellFn({ state: 'pending', ref: 'SDK-CCC333', attempts: 2 }, '142682751');
  assert.match(html, /ecwidWaitingPush/);
  assert.ok(!/ecwid-retry/.test(html), 'a waiting order must not invite a pointless click');
  assert.match(html, /\(2\)/, 'the attempt count is the only signal it is progressing');
});

test('an order never pushed says so rather than rendering empty', () => {
  const html = cellFn(null, '142682751');
  assert.match(html, /ecwidNotPushed/);
});

test('a hostile error string cannot inject markup', () => {
  /* last_error is an API response body. It reaches the page verbatim. */
  const html = cellFn(
    { state: 'parked', ref: 'x', attempts: 6, lastError: '<img src=x onerror=alert(1)>' },
    '1');
  assert.ok(!/<img/.test(html), 'the error must be escaped');
  assert.match(html, /&lt;img/);
});

test('a ref with a slash or hash cannot break out of the data attribute', () => {
  const html = cellFn({ state: 'parked', ref: 'a"b', attempts: 6 }, '1');
  assert.ok(!/data-ref="a"b"/.test(html));
  assert.match(html, /&quot;/);
});

test('the Ecwid order id is URL-encoded into the link', () => {
  const html = cellFn({ state: 'pushed', ref: 'r', ecwidOrderId: 'a b' }, 'a b');
  assert.match(html, /store\/a%20b#order:id=a%20b/);
});

/* ------------------------------ the map --------------------------------- */

test('the three groups collapse into one lookup, parked winning', () => {
  /* A ref can legitimately appear in more than one list as the queue moves.
     Parked is the state that needs a human, so it must not be masked. */
  const m = mapFn({
    pushed: [{ ref: 'a', ecwidOrderId: '1' }],
    pending: [{ ref: 'b' }],
    parked: [{ ref: 'b' }],
  });
  assert.equal(m.get('a').state, 'pushed');
  assert.equal(m.get('b').state, 'parked');
});

test('a missing or failed payload yields an empty map, not a crash', () => {
  /* loadEcwidOrders returns null when Ecwid is off entirely, and the orders
     desk has to keep working in that case. */
  assert.equal(mapFn(null).size, 0);
  assert.equal(mapFn({}).size, 0);
});

/* --------------------------- the customer cell -------------------------- */

test('NO ACCESS is shown as its own thing, not as "not in Ecwid"', () => {
  /* On a public_ token an unreachable customer and a non-existent one both
     look like nothing. Conflating them costs an afternoon. */
  const denied = custFn({ reason: 'no-access', linked: false });
  const absent = custFn({ linked: false });
  assert.match(denied, /403/);
  assert.notEqual(denied, absent);
  assert.match(absent, /ecwidNotLinked/);
});

test('a linked customer shows the Ecwid id and their order count there', () => {
  const html = custFn({ linked: true, customer: { id: '55' }, orders: [{}, {}, {}] });
  assert.match(html, /#55/);
  assert.match(html, /3/);
});

test('a linked customer with no Ecwid orders reads as 0, not as blank', () => {
  const html = custFn({ linked: true, customer: { id: '55' }, orders: [] });
  assert.match(html, /: 0/);
});
