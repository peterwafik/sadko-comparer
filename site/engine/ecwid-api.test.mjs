// site/engine/ecwid-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openEcwidApi } from './ecwid-api.mjs';

/* A fake fetch: hand it a queue of responses, it returns them in order and
   records the requests it saw. No network, so the tests are fast and honest. */
function fakeFetch(queue) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = queue.shift();
    if (!next) throw new Error('fake fetch: queue exhausted for ' + url);
    if (next.throw) throw new Error(next.throw);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}
const api = (queue, extra = {}) => openEcwidApi({
  storeId: '142682751', token: 'tkn', fetchImpl: fakeFetch(queue), baseDelayMs: 0, ...extra });

test('reports not configured when the token is absent', () => {
  const a = openEcwidApi({ storeId: '142682751', token: '', fetchImpl: fakeFetch([]) });
  assert.equal(a.configured, false);
});

test('listProducts sends the token as a bearer header and returns items', async () => {
  const f = fakeFetch([{ status: 200, body: { items: [{ id: 1 }], total: 1, count: 1 } }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  const out = await a.listProducts({});
  assert.deepEqual(out.items, [{ id: 1 }]);
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer tkn');
});

test('the store id is in the request path', async () => {
  const f = fakeFetch([{ status: 200, body: { items: [], total: 0 } }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  await a.listProducts({});
  assert.match(f.calls[0].url, /\/api\/v3\/142682751\/products/);
});

test('listProducts passes updatedFrom through as a query parameter', async () => {
  const f = fakeFetch([{ status: 200, body: { items: [], total: 0, count: 0 } }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  await a.listProducts({ updatedFrom: 1757000000 });
  assert.match(f.calls[0].url, /updatedFrom=1757000000/);
});

test('retries a 429 and then succeeds', async () => {
  const a = api([
    { status: 429, body: { error: 'slow down' } },
    { status: 200, body: { items: [{ id: 7 }], total: 1, count: 1 } },
  ]);
  const out = await a.listProducts({});
  assert.deepEqual(out.items, [{ id: 7 }]);
});

test('retries a 500 and then succeeds', async () => {
  const a = api([
    { status: 500, body: 'boom' },
    { status: 200, body: { items: [], total: 0, count: 0 } },
  ]);
  assert.deepEqual((await a.listProducts({})).items, []);
});

test('does NOT retry a 403 — a missing scope must fail loudly and fast', async () => {
  /* This is the real failure mode on the SADKO test store: /orders returns 403
     because the custom app was not granted order access. Four retries would
     turn a configuration mistake into a slow one. */
  const f = fakeFetch([{ status: 403, body: '' }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'bad', fetchImpl: f, baseDelayMs: 0 });
  await assert.rejects(() => a.listProducts({}), e => e.status === 403);
  assert.equal(f.calls.length, 1, 'a 403 must not be retried');
});

test('gives up after the retry budget and throws with the status', async () => {
  const a = api([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }], { retries: 2 });
  await assert.rejects(() => a.listProducts({}), e => e.status === 503);
});

test('malformed JSON raises a clear error rather than a TypeError', async () => {
  const a = api([{ status: 200, body: 'not json at all' }]);
  await assert.rejects(() => a.listProducts({}), /malformed JSON/i);
});

test('getProduct returns null on 404 instead of throwing', async () => {
  const a = api([{ status: 404, body: 'nope' }]);
  assert.equal(await a.getProduct('123'), null);
});

test('a network throw is retried too', async () => {
  const a = api([{ throw: 'ECONNRESET' }, { status: 200, body: { items: [], total: 0, count: 0 } }]);
  assert.deepEqual((await a.listProducts({})).items, []);
});

test('listAllProductIds pages until every id is collected', async () => {
  const a = api([
    { status: 200, body: { items: [{ id: 1 }, { id: 2 }], total: 3, count: 2 } },
    { status: 200, body: { items: [{ id: 3 }], total: 3, count: 1 } },
  ]);
  const ids = await a.listAllProductIds();
  assert.deepEqual([...ids].sort(), ['1', '2', '3']);
});

test('listCategories pages too', async () => {
  const a = api([
    { status: 200, body: { items: [{ id: 10 }], total: 2, count: 1 } },
    { status: 200, body: { items: [{ id: 11 }], total: 2, count: 1 } },
  ]);
  assert.deepEqual((await a.listCategories()).map(c => c.id), [10, 11]);
});

test('the token never appears in a thrown error message', async () => {
  const a = api([{ status: 403, body: 'forbidden' }]);
  await assert.rejects(() => a.listProducts({}), e => !String(e.message).includes('tkn'));
});

/* ---- the endpoints the real store taught us about ---- */

test('calculateOrder posts to /order/calculate, not /orders/calculate', async () => {
  /* The plural path returns 405 on the live API — found the hard way. */
  const f = fakeFetch([{ status: 200, body: { availableShippingOptions: [] } }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  await a.calculateOrder({ items: [{ productId: 1, quantity: 1 }] });
  assert.match(f.calls[0].url, /\/order\/calculate$/);
  assert.equal(f.calls[0].opts.method, 'POST');
});

test('calculateOrder returns an empty option list rather than throwing when Ecwid offers none', async () => {
  /* The live store does exactly this today: zero options for a Cairo address. */
  const a = api([{ status: 200, body: {} }]);
  const r = await a.calculateOrder({ items: [] });
  assert.deepEqual(r.shippingOptions, []);
});

test('calculateOrder normalises whichever key Ecwid used for the options', async () => {
  const a = api([{ status: 200, body: { availableShippingOptions: [{ shippingMethodName: 'القاهرة الكبرى', shippingRate: 250 }] } }]);
  const r = await a.calculateOrder({ items: [] });
  assert.equal(r.shippingOptions.length, 1);
  assert.equal(r.shippingOptions[0].name, 'القاهرة الكبرى');
  assert.equal(r.shippingOptions[0].rate, 250);
});

test('getProfile returns the payment and shipping options in a stable shape', async () => {
  const a = api([{ status: 200, body: {
    payment: { paymentOptions: [{ id: 'p1', enabled: true, checkoutTitle: 'Cash on Delivery' }] },
    shipping: { shippingOptions: [{ id: 's1', enabled: true, title: 'القاهرة الكبرى' }] },
  } }]);
  const p = await a.getProfile();
  assert.equal(p.paymentOptions.length, 1);
  assert.equal(p.shippingOptions.length, 1);
  assert.equal(p.paymentOptions[0].checkoutTitle, 'Cash on Delivery');
});

test('getProfile tolerates the flat shape as well as the nested one', async () => {
  const a = api([{ status: 200, body: { paymentOptions: [{ id: 'p1' }], shippingOptions: [] } }]);
  const p = await a.getProfile();
  assert.equal(p.paymentOptions.length, 1);
  assert.deepEqual(p.shippingOptions, []);
});

test('every method rejects with a clear code when the api is unconfigured', async () => {
  const a = openEcwidApi({ storeId: '142682751', token: '', fetchImpl: fakeFetch([]) });
  for (const call of [() => a.listProducts({}), () => a.getProfile(), () => a.calculateOrder({})])
    await assert.rejects(call, e => e.message === 'ecwid-not-configured');
});
