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
     unreachable must not stop someone creating an account. */
  const route = /'\/api\/auth\/register' && req\.method === 'POST'[\s\S]{0,1400}/.exec(src)[0];
  assert.ok(!/await\s+ecwidSync\(\)\.linkCustomer/.test(route),
    'the signup awaits the Ecwid link');
  assert.match(route, /linkCustomer\([^)]*\)\.catch\(/, 'a rejected link would become an unhandled rejection');
  assert.match(route, /try \{ ecwidSync\(\)\.linkCustomer/, 'the call itself is not guarded');
});

test('linkCustomer only ADDS to Ecwid, never overwrites what staff corrected', () => {
  const fn = /async function linkCustomer[\s\S]{0,1600}?\n  \}/.exec(sync)[0];
  assert.match(fn, /customerNeedsUpdate/);
});

test('a 403 from a public_ token is a configuration state, not an error', () => {
  const fn = /async function linkCustomer[\s\S]{0,1600}?\n  \}/.exec(sync)[0];
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
