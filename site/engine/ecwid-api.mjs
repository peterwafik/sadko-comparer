/* ============================================================================
   Ecwid REST v3 client — thin, dependency-free, and deliberately ignorant of
   SADKO's data shapes (engine/ecwid-map.mjs owns every translation).

   Three rules worth knowing before editing:

     • 429 and 5xx are retried with exponential backoff; other 4xx are NOT.
       On the SADKO test store /orders returns 403 because the custom app was
       not granted order access — a configuration mistake. Retrying it four
       times would only make the mistake slower to diagnose.

     • The token never reaches a log line or an error message. Errors carry a
       status and the response body, never the Authorization header.

     • Endpoint paths here were verified against the live store, not guessed.
       In particular the order calculator is POST /order/calculate — SINGULAR.
       The plural /orders/calculate answers 405.
   ========================================================================== */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function openEcwidApi({ storeId, token, fetchImpl, retries = 3, baseDelayMs = 400 } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const base = `https://app.ecwid.com/api/v3/${storeId}`;
  const configured = !!(storeId && token);

  async function call(pathAndQuery, { method = 'GET', body, allow404 = false } = {}) {
    if (!configured) { const e = new Error('ecwid-not-configured'); e.status = 0; throw e; }
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(baseDelayMs * 2 ** (attempt - 1));
      let res, text;
      try {
        res = await doFetch(base + pathAndQuery, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: body == null ? undefined : JSON.stringify(body),
        });
        text = await res.text();
      } catch (netErr) {
        lastErr = new Error('ecwid-network: ' + netErr.message);
        lastErr.status = 0;
        continue;                                      // network blips are retryable
      }
      if (res.status === 404 && allow404) return null;
      if (!res.ok) {
        const e = new Error(`ecwid-${res.status}: ${String(text || '').slice(0, 300)}`);
        e.status = res.status;
        if (!RETRYABLE.has(res.status)) throw e;        // fail fast on 400/401/403
        lastErr = e;
        continue;
      }
      if (!text) return null;
      try { return JSON.parse(text); }
      catch { const e = new Error('ecwid: malformed JSON in response'); e.status = res.status; throw e; }
    }
    throw lastErr || Object.assign(new Error('ecwid: exhausted retries'), { status: 0 });
  }

  const qs = o => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v));
    const s = p.toString();
    return s ? '?' + s : '';
  };

  /* Page through any Ecwid list endpoint. Ecwid returns {items,total,count}. */
  /* `params` are merged into the SAME query string as offset/limit.

     They used to be the caller's problem, which produced a real bug the live
     API caught: passing '/products' + qs({category: id}) as pathBase made
     this append a SECOND '?', so the URL read
     "/products?category=206629525?offset=0&limit=100" and Ecwid answered
     WRONG_PARAMETER — the category value had become "206629525?offset=0".
     One query string, built in one place. */
  async function pageAll(pathBase, { limit = 100, params = {} } = {}) {
    const out = [];
    for (let offset = 0; ; ) {
      const page = await call(pathBase + qs({ ...params, offset, limit }));
      const items = (page && page.items) || [];
      out.push(...items);
      offset += items.length;
      if (!items.length || offset >= (page && page.total != null ? page.total : offset)) break;
    }
    return out;
  }

  return {
    configured,

    listProducts: ({ updatedFrom, offset = 0, limit = 100 } = {}) =>
      call('/products' + qs({ updatedFrom, offset, limit })),

    getProduct: id => call(`/products/${encodeURIComponent(id)}`, { allow404: true }),

    listCategories: () => pageAll('/categories'),

    /* The product ids inside ONE category, by id.

       This is the only way to see inside a DISABLED category, and the ad
       folders have to be disabled or Ecwid shows them to its own shoppers.
       Measured against the live store: GET /products?category=<disabledId>
       returns its products (the disabled "Wedding List" answers with 32),
       even though GET /categories omits the category, hidden_categories=true
       returns it as an id-only stub with no name, and a product inside it
       does not list it in its own categoryIds.

       Ids only: the products themselves already come down in the ordinary
       catalogue sync, so re-fetching their bodies here would double the
       traffic to learn something we already have. */
    listCategoryProductIds: async categoryId => {
      const ids = [];
      /* Through `params`, NOT concatenated onto the path — see pageAll. */
      for (const p of await pageAll('/products', { params: { category: categoryId } })) {
        if (p && p.id != null) ids.push(String(p.id));
      }
      return ids;
    },

    /* How many products the store has, in ONE request.

       The cheap half of deletion detection. updatedFrom can never report a
       product that no longer exists, and paging every id to find out costs
       ~15 requests against this catalogue. Ecwid's `total` and the mirror's
       row count agree exactly when nothing is missing (measured: 1462 =
       1462), so a mismatch is a reliable trigger for the real reconcile
       below — and only then is the expensive call worth making.

       Returns null rather than throwing, so a failed count simply skips the
       check for that tick instead of failing the whole poll. */
    productCount: async () => {
      try {
        const page = await call('/products' + qs({ limit: 1 }));
        const n = page && page.total;
        return Number.isFinite(n) ? n : null;
      } catch (e) { return null; }
    },

    /* The full id set, used by the daily reconcile to find DELETIONS — which
       updatedFrom can never report. */
    listAllProductIds: async () => {
      const ids = new Set();
      for (const p of await pageAll('/products')) ids.add(String(p.id));
      return ids;
    },

    /* Store profile, normalised: Ecwid has returned both a nested
       {payment:{paymentOptions}} shape and a flat {paymentOptions} one, so
       callers get one predictable shape either way. */
    async getProfile() {
      const p = (await call('/profile')) || {};
      return {
        raw: p,
        paymentOptions: (p.payment && p.payment.paymentOptions) || p.paymentOptions || [],
        shippingOptions: (p.shipping && p.shipping.shippingOptions) || p.shippingOptions || [],
        settings: p.settings || null,
        formatsAndUnits: p.formatsAndUnits || null,
      };
    },

    /* Delivery cost, asked of Ecwid rather than computed here. Returns a
       normalised, possibly EMPTY option list — the live store currently offers
       none for a Cairo address, and that is a normal answer, not an error. */
    async calculateOrder(order) {
      const r = (await call('/order/calculate', { method: 'POST', body: order })) || {};
      const raw = r.availableShippingOptions || r.shippingOptions || [];
      return {
        raw: r,
        subtotal: r.subtotal ?? null,
        total: r.total ?? null,
        shippingOptions: raw.map(o => ({
          id: o.shippingMethodId ?? o.id ?? null,
          name: o.shippingMethodName ?? o.name ?? '',
          rate: o.shippingRate ?? o.rate ?? null,
          raw: o,
        })),
      };
    },

    /* ---- customers ---------------------------------------------------
       Ecwid can read, create and update a customer, but it cannot verify one
       password — so these support LINKING, never login. See the note at the
       top of engine/ecwid-customers.mjs.

       Every one of these needs a secret_ token. The test store's token is a
       public_ one, so they answer 403 there and every caller treats that as
       "not available" rather than as an error. */
    customerByEmail: async email => {
      const page = await call('/customers' + qs({ email: String(email || '').trim().toLowerCase(), limit: 10 }));
      const want = String(email || '').trim().toLowerCase();
      const hit = ((page && page.items) || []).find(c => String(c.email || '').toLowerCase() === want);
      return hit || null;
    },
    createCustomer: payload => call('/customers', { method: 'POST', body: payload }),
    updateCustomer: (id, payload) => call(`/customers/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),

    /* ---- a customer's orders -----------------------------------------
       Includes the ones staff created by hand, which is the whole reason for
       reading this rather than relying on what the site pushed. */
    ordersByEmail: async (email, limit = 50) => {
      const page = await call('/orders' + qs({ email: String(email || '').trim().toLowerCase(), limit }));
      return (page && page.items) || [];
    },

    createOrder: payload => call('/orders', { method: 'POST', body: payload }),
    getOrder: id => call(`/orders/${encodeURIComponent(id)}`, { allow404: true }),

    /* Idempotency support: find an order already carrying our SDK- ref, so a
       lost response cannot become a duplicate order. The exact queryable field
       is confirmed against the live API once order access is granted; until
       then this matches on the serialised order, which is correct but slower. */
    findOrderByRef: async ref => {
      const page = await call('/orders' + qs({ keywords: ref, limit: 10 }));
      const hit = ((page && page.items) || []).find(o => JSON.stringify(o).includes(ref));
      return hit ? { id: String(hit.id) } : null;
    },
  };
}
