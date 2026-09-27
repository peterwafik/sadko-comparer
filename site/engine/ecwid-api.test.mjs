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

/* ======================================================================
   One query string.

   listCategoryProductIds is how an ad folder is read, and it needs a
   `category` parameter alongside pagination. The first version concatenated
   it onto the path and pageAll then appended its own '?', so the real URL
   was "/products?category=206629525?offset=0&limit=100" and Ecwid answered

     ecwid-400 WRONG_PARAMETER: Wrong numeric parameter 'category' value:
     not a number or a number out of range

   because the value had become "206629525?offset=0". Only the live API
   caught it, so it is pinned here.
   ================================================================== */

test('a paged request with parameters builds ONE query string', async () => {
  const urls = [];
  const api = openEcwidApi({
    storeId: 'S', token: 'T',
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [], total: 0 }) };
    },
  });
  await api.listCategoryProductIds('206629525');
  assert.equal(urls.length, 1);
  const qs = urls[0].slice(urls[0].indexOf('?'));
  assert.equal((qs.match(/\?/g) || []).length, 1, 'more than one "?" in ' + urls[0]);
  const p = new URLSearchParams(qs);
  assert.equal(p.get('category'), '206629525', 'the category value was corrupted: ' + p.get('category'));
  assert.equal(p.get('offset'), '0');
  assert.equal(p.get('limit'), '100');
});

test('the ids of every page are collected, not just the first', async () => {
  let call = 0;
  const api = openEcwidApi({
    storeId: 'S', token: 'T',
    fetchImpl: async () => {
      call++;
      const items = call === 1
        ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
        : [{ id: 101 }, { id: 102 }];
      return { ok: true, status: 200, text: async () => JSON.stringify({ items, total: 102 }) };
    },
  });
  const ids = await api.listCategoryProductIds('1');
  assert.equal(ids.length, 102);
  assert.equal(ids[0], '1');
  assert.equal(ids[101], '102');
  assert.ok(ids.every(x => typeof x === 'string'), 'ids must be strings for the slot map');
});

test('a category with no products returns an empty list, not a throw', async () => {
  const api = openEcwidApi({
    storeId: 'S', token: 'T',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ items: [], total: 0 }) }),
  });
  assert.deepEqual(await api.listCategoryProductIds('206811031'), []);
});

/* ======================================================================
   productCount — the cheap half of deletion detection.

   updatedFrom can never report a product that no longer exists, and paging
   every id to find out costs ~15 requests against this catalogue. One
   request gives the total, and it matches the mirror exactly when nothing
   is missing, so only a mismatch pays for the real reconcile.
   ================================================================== */

test('the count is fetched in ONE request', async () => {
  const urls = [];
  const api = openEcwidApi({
    storeId: 'S', token: 'T',
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ id: 1 }], total: 1462 }) };
    },
  });
  assert.equal(await api.productCount(), 1462);
  assert.equal(urls.length, 1, 'the count must not page the catalogue');
  assert.match(urls[0], /limit=1/, 'it should ask for one row, not the whole list');
});

test('a failed count returns null rather than throwing', async () => {
  /* It runs inside the minute poll; a network blip must not take the whole
     sync down or trigger a spurious reconcile. */
  const api = openEcwidApi({
    storeId: 'S', token: 'T', retries: 0,
    fetchImpl: async () => { throw new Error('network'); },
  });
  assert.equal(await api.productCount(), null);
});

test('a nonsense total is refused rather than compared', async () => {
  /* null !== <mirror count> would reconcile on every tick. */
  for (const total of [undefined, null, 'many', NaN]) {
    const api = openEcwidApi({
      storeId: 'S', token: 'T',
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ items: [], total }) }),
    });
    assert.equal(await api.productCount(), null, 'accepted a total of ' + String(total));
  }
});

test('zero is a real count, not a missing one', async () => {
  /* An emptied store must reconcile, not be mistaken for a failed call. */
  const api = openEcwidApi({
    storeId: 'S', token: 'T',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ items: [], total: 0 }) }),
  });
  assert.equal(await api.productCount(), 0);
});

/* ======================= updating an order in Ecwid =======================
   For the admin orders desk pushing a status UP. A PUT rather than a POST:
   the order already exists and only the named fields change, so nothing the
   site does not know about — a tracking number staff typed, a note — is
   disturbed. */

test('updateOrder PUTs only the fields given, to the order it names', async () => {
  const f = fakeFetch([{ status: 200, body: { updateCount: 1 } }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  const r = await a.updateOrder('7483', { fulfillmentStatus: 'SHIPPED' });
  assert.deepEqual(r, { updateCount: 1 });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/orders\/7483$/);
  assert.equal(f.calls[0].opts.method, 'PUT');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { fulfillmentStatus: 'SHIPPED' },
    'nothing beyond the named fields may be sent');
});

test('an order id needing escaping is escaped, not concatenated raw', async () => {
  const f = fakeFetch([{ status: 200, body: {} }]);
  const a = openEcwidApi({ storeId: '142682751', token: 'tkn', fetchImpl: f, baseDelayMs: 0 });
  await a.updateOrder('7 483/x', { fulfillmentStatus: 'SHIPPED' });
  assert.ok(!/\/orders\/7 483\/x/.test(f.calls[0].url), 'the id must be encoded');
  assert.match(f.calls[0].url, /7%20483%2Fx/);
});
