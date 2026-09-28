// site/engine/order-track.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingOf, fromEcwidOrder, mergeOrders } from './ecwid-customers.mjs';
import { phoneMatches, publicStatus } from './order-track.mjs';

/* Field names confirmed live on test order 7519 (2026-09-28): a PUT of
   trackingNumber came back as trackingNumber plus an AUTO-generated
   trackingUrl https://track.aftership.com/<number>, and shipments []. */
test('tracking is read from the order, or from its shipments', () => {
  assert.deepEqual(trackingOf({ trackingNumber: 'MVX1' }), { number: 'MVX1', url: null });
  assert.deepEqual(trackingOf({ trackingNumber: 'MVX1', trackingUrl: 'https://movex.com.eg/track/1' }),
    { number: 'MVX1', url: 'https://movex.com.eg/track/1' });
  assert.deepEqual(trackingOf({ shipments: [{ trackingNumber: 'MVX2' }] }), { number: 'MVX2', url: null });
  assert.equal(trackingOf({}), null);
  assert.equal(trackingOf({ trackingNumber: '  ' }), null);
});

test("Ecwid's auto-generated AfterShip link is dropped: every parcel goes by Movex", () => {
  assert.deepEqual(trackingOf({ trackingNumber: 'MVX-TEST-7519', trackingUrl: 'https://track.aftership.com/MVX-TEST-7519' }),
    { number: 'MVX-TEST-7519', url: null });
});

test('a site order picks up tracking from its Ecwid copy', () => {
  const local = [{ ref: 'SDK-AAAAAA', status: 'received', items: [], createdAt: '2026-09-28' }];
  const remote = [{ externalOrderId: 'SDK-AAAAAA', fulfillmentStatus: 'SHIPPED', trackingNumber: 'MVX9', items: [] }];
  const [o] = mergeOrders(local, remote);
  assert.equal(o.status, 'shipping');
  assert.deepEqual(o.tracking, { number: 'MVX9', url: null });
  assert.deepEqual(fromEcwidOrder(remote[0]).tracking, { number: 'MVX9', url: null });
});

// Review focus 4
test('phones match on the last ten digits, whatever the format', () => {
  assert.equal(phoneMatches('+201027890565', '01027890565'), true);
  assert.equal(phoneMatches('0102 789 0565', '+20 102 789 0565'), true);
  assert.equal(phoneMatches('01027890565', '01027890566'), false);
  assert.equal(phoneMatches('', ''), false);
  assert.equal(phoneMatches('123', '123'), false);
});

test('the guest lookup returns status and tracking, and nothing personal', () => {
  const s = publicStatus({ externalOrderId: 'SDK-AAAAAA', fulfillmentStatus: 'SHIPPED', trackingNumber: 'MVX9',
    email: 'x@y.z', shippingPerson: { name: 'N', phone: '010', street: 'S' }, items: [{ name: 'fridge' }], total: 5 });
  assert.deepEqual(s, { ref: 'SDK-AAAAAA', status: 'shipping', tracking: { number: 'MVX9', url: null } });
});

test('the guest lookup route is rate-limited, needs both values, and answers only publicStatus', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../compare-server.mjs', import.meta.url), 'utf8');
  const i = src.indexOf("u.pathname === '/api/orders/track' && req.method === 'POST'");
  assert.ok(i > 0, 'the route exists');
  const body = src.slice(i, i + 1800);
  assert.match(body, /guestRateOk\('track:'/, 'rate-limited per IP');
  assert.match(body, /phoneMatches\(/, 'the phone must match');
  assert.match(body, /json\(200, publicStatus\(remote\)\)/, 'only the public fields are returned');
  assert.equal((body.match(/notFound\(\)/g) || []).length >= 4, true, 'every failure looks the same');
});

test('orders.html has a "Track an order" form that asks for the number and the phone', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../orders.html', import.meta.url), 'utf8');
  assert.match(h, /id="trackForm"/);
  assert.match(h, /name="ref"/);
  assert.match(h, /name="phone"/);
  assert.match(h, /\/api\/orders\/track/);
  assert.match(h, /لم نجد طلباً بهذا الرقم وهذا الهاتف/);
});
