// site/engine/delivery-wiring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAccounts } from './accounts.mjs';
import { feeMismatch, totalsWith, quoteFor } from './delivery-order.mjs';

const SRC = readFileSync(new URL('../compare-server.mjs', import.meta.url), 'utf8');
const route = (marker, len = 5000) => {
  const i = SRC.indexOf(marker);
  assert.ok(i >= 0, 'route not found: ' + marker);
  return SRC.slice(i, i + len);
};

test('the quote and governorate endpoints exist', () => {
  assert.match(SRC, /u\.pathname === '\/api\/delivery\/quote' && req\.method === 'POST'/);
  assert.match(SRC, /u\.pathname === '\/api\/delivery\/governorates'/);
});

test('both order routes recompute the fee on the server and compare the browser figure', () => {
  for (const marker of ["u.pathname === '/api/orders/guest' && req.method === 'POST'",
                        "u.pathname === '/api/orders' && req.method === 'POST'"]) {
    const body = route(marker);
    assert.match(body, /await deliveryFor\(/, marker + ' must call deliveryFor');
    assert.match(body, /feeMismatch\(/, marker + ' must compare the quoted fee');
    assert.match(body, /json\(409/, marker + ' must answer 409 on a changed fee');
  }
});

// Review focus 2: an old tab sends no quotedFee at all.
test('feeMismatch treats a missing quotedFee as a mismatch when the order is quotable', () => {
  assert.equal(feeMismatch({ quotable: true, fee: 300 }, undefined), true);
  assert.equal(feeMismatch({ quotable: true, fee: 300 }, 300), false);
  assert.equal(feeMismatch({ quotable: true, fee: 300 }, 250), true);
  assert.equal(feeMismatch({ quotable: false }, null), false);
  assert.equal(feeMismatch({ quotable: false }, undefined), false);
  assert.equal(feeMismatch({ quotable: false }, 300), true);
});

test('totalsWith adds the fee only when it was quoted', () => {
  assert.deepEqual(totalsWith(1000, { quotable: true, fee: 300, methodName: 'M', lines: [] }),
    { subtotal: 1000, deliveryFee: 300, installFee: null, grandTotal: 1300, currency: 'EGP', methodName: 'M', deliveryLines: [] });
  assert.deepEqual(totalsWith(1000, { quotable: false, reason: 'no-region' }),
    { subtotal: 1000, deliveryFee: null, installFee: null, grandTotal: null, currency: 'EGP' });
});

test('quoteFor classes each line from the served catalogue, never from the browser', () => {
  const catalogue = [{ id: '1', title: 'مروحة ستاند', categoryId: 'c1' }];
  const methods = [];   // no rates yet: first boot
  const r = quoteFor({ items: [{ id: '1', qty: 2, cls: 'xl' }], governorate: 'القاهرة', catalogue, methods,
                       categoryName: () => 'مبردات هواء ومراوح' });
  assert.deepEqual(r, { quotable: false, reason: 'no-rates' });
  const unknown = quoteFor({ items: [{ id: 'gone', qty: 1 }], governorate: 'القاهرة', catalogue,
                             methods: [{ title: 'القاهرة الكبرى', enabled: true, calcType: 'table',
                                         rates: { rows: [{ from: 0, to: null, perOrder: 200, perItem: 50 }] } }],
                             categoryName: () => '' });
  assert.deepEqual(unknown, { quotable: false, reason: 'unclassified', id: 'gone' });
});

test('createOrder stores the fee and grand total when a quote is quotable', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-deliv-'));
  const acc = openAccounts(path.join(dir, 'accounts.json'));
  const u = acc.register({ email: 'd@example.test', password: 'sadko1234', name: 'D', phone: '01012345678' });
  const uid = (u.user || u).id;
  assert.ok(uid, JSON.stringify(u));
  const items = [{ id: '1', title: 'x', price: 1000, qty: 1 }];
  const a = acc.createOrder(uid, { items, payment: 'cod', deliveryQuote: { quotable: true, fee: 300, methodName: 'القاهرة الكبرى', lines: [{ id: '1', cls: 'small', fee: 50 }] } });
  assert.deepEqual([a.order.totals.deliveryFee, a.order.totals.grandTotal, a.order.totals.methodName], [300, 1300, 'القاهرة الكبرى']);
  const b = acc.createOrder(uid, { items, payment: 'cod', deliveryQuote: { quotable: false, reason: 'no-region' } });
  assert.deepEqual([b.order.totals.deliveryFee, b.order.totals.grandTotal], [null, null]);
});

test('the admin delivery-classes route exists behind the admin guard', () => {
  const guard = SRC.indexOf("u.pathname.startsWith('/api/admin/')");
  const i = SRC.indexOf("rest === 'delivery-classes'");
  assert.ok(guard > 0 && i > guard, 'must live inside the admin block');
  assert.ok(SRC.indexOf('isAdminUser(me)', guard) < i, 'the admin check comes first');
});

test('the admin dashboard shows the delivery classes panel', () => {
  const ADMIN = readFileSync(new URL('../assets/js/admin.js', import.meta.url), 'utf8');
  assert.match(ADMIN, /api\/admin\/delivery-classes/);
  assert.match(ADMIN, /id="adm-delivery"/);
});
