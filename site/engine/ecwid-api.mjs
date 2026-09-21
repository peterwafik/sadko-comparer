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
  async function pageAll(pathBase, { limit = 100 } = {}) {
    const out = [];
    for (let offset = 0; ; ) {
      const page = await call(pathBase + qs({ offset, limit }));
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
