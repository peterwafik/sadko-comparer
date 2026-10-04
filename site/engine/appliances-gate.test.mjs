// site/engine/appliances-gate.test.mjs
/* "Add to my appliances" on the order confirmation asks a guest to sign in
   first, then carries them on to the appliances page. Source-level, as
   account-wiring does: checkout.js and account.js are browser IIFEs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const checkout = readFileSync(path.join(SITE, 'assets', 'js', 'checkout.js'), 'utf8');
const account = readFileSync(path.join(SITE, 'assets', 'js', 'account.js'), 'utf8');

test('the confirmation knows whether the buyer is signed in', () => {
  assert.match(checkout, /done\(r\.order, user\)/);
  assert.match(checkout, /function done\(o, user\)/);
});

test('a guest is sent to sign in, with the appliances page as where to go next', () => {
  assert.match(checkout, /user \? A\.P\('appliances\.html'\) : A\.P\('account\.html\?next=appliances\.html'\)/);
});

test('account.js only follows a bare page name, never an outside address', () => {
  /* An unchecked ?next= is an open redirect: account.html?next=//evil.example
     would send a freshly signed-in customer anywhere. */
  const m = /const NEXT = [\s\S]*?;\n/.exec(account);
  assert.ok(m, 'NEXT is read once, at mount');
  assert.match(m[0], /\/\^\[a-z\]\[a-z0-9-\]\*\\\.html\$\//);
});

test('once signed in, account.js goes on to the page it was asked for', () => {
  assert.match(account, /if \(user && NEXT\) \{ location\.replace\(A\.P\(NEXT\)\); return; \}/);
});
