/* ============================================================================
   Sync orchestration: pull, reconcile, mirror settings, and apply webhooks.

   Two design rules, both load-bearing:

     • A webhook handler IGNORES the event payload and RE-FETCHES the entity.
       We converge on current state instead of applying a diff, which makes
       replays and out-of-order delivery harmless. Never "optimise" this by
       trusting the payload — a test asserts the payload is ignored.

     • Nothing here throws. These methods run from timers and from a public
       HTTP route; a failure records last_error and returns a zero result,
       leaving the last good mirror in place. The site must never go down, or
       serve an empty catalogue, because Ecwid did.
   ========================================================================== */

import { toSadkoProduct, toSadkoCategory } from './ecwid-map.mjs';

const PAGE = 100;

/* Ecwid's payment and shipping options, flattened to what checkout needs.
   Kept here rather than in ecwid-map.mjs because these come from the store
   PROFILE, not from a catalogue entity, and they are a list rather than a
   per-item translation. */
function toPaymentMethod(o, i) {
  const ins = o.instructionsForCustomer || {};
  return {
    id: String(o.id ?? o.paymentProcessorId ?? i),
    title: String(o.checkoutTitle || o.paymentProcessorTitle || '').trim(),
    enabled: o.enabled !== false,
    order: Number(o.orderBy ?? o.orderby ?? i) || 0,
    /* Real Arabic copy the owner wrote, e.g. "سيتم التواصل لارسال الرابط
       الخاص بالدفع". The storefront shows it so the customer knows what
       happens after they order — no money is taken online. */
    instructions: String(ins.instructions || ins.instructionsTitle || '').trim(),
    processor: o.paymentProcessorId ? String(o.paymentProcessorId) : null,
  };
}

function toShippingMethod(o, i) {
  return {
    id: String(o.id ?? i),
    title: String(o.title || '').trim(),
    enabled: o.enabled !== false,
    order: Number(o.orderby ?? o.orderBy ?? i) || 0,
    calcType: o.ratesCalculationType ? String(o.ratesCalculationType) : null,
    fulfilment: o.fulfilmentType ? String(o.fulfilmentType) : null,
    carrier: o.carrier ? String(o.carrier) : null,
    minimumOrderSubtotal: o.minimumOrderSubtotal ?? null,
    deliveryTimeDays: o.deliveryTimeDays ?? null,
  };
}

export function createEcwidSync({ api, store, map = { toSadkoProduct, toSadkoCategory } }) {
  const fail = (where, e) => {
    const msg = `${where}: ${(e && e.message) || e}`;
    try { store.setState('last_error', msg); } catch (x) {}
    console.error('[ecwid] ' + msg);
  };
  const ok = extra => {
    try {
      store.setState('last_sync', { at: new Date().toISOString(), ...extra });
      store.setState('last_error', null);
    } catch (x) {}
  };
  const notConfigured = where => {
    fail(where, new Error('ecwid is not configured'));
    return false;
  };

  async function syncProducts({ updatedFrom } = {}) {
    if (!api.configured) { notConfigured('syncProducts'); return { written: 0, pages: 0 }; }
    let written = 0, pages = 0;
    try {
      for (let offset = 0; ; ) {
        const page = await api.listProducts({ updatedFrom, offset, limit: PAGE });
        const items = (page && page.items) || [];
        pages++;
        if (items.length) {
          store.upsertProducts(items.map(map.toSadkoProduct));
          written += items.length;
        }
        offset += items.length;
        const total = page && page.total != null ? page.total : offset;
        if (!items.length || offset >= total) break;
      }
      ok({ products: written, incremental: updatedFrom != null });
      return { written, pages };
    } catch (e) { fail('syncProducts', e); return { written, pages }; }
  }

  async function syncCategories() {
    if (!api.configured) { notConfigured('syncCategories'); return { written: 0 }; }
    try {
      const rows = (await api.listCategories()).map(map.toSadkoCategory);
      const r = store.upsertCategories(rows);
      ok({ categories: rows.length });
      return r;
    } catch (e) { fail('syncCategories', e); return { written: 0 }; }
  }

  /* Payment and shipping methods, mirrored from the store profile. Only
     ENABLED methods are stored: offering one the owner switched off would take
     an order on terms SADKO cannot honour. */
  async function syncSettings() {
    if (!api.configured) { notConfigured('syncSettings'); return { payment: 0, shipping: 0 }; }
    try {
      const p = await api.getProfile();
      const pay = (p.paymentOptions || []).map(toPaymentMethod).filter(m => m.enabled);
      const ship = (p.shippingOptions || []).map(toShippingMethod).filter(m => m.enabled);
      store.upsertPaymentMethods(pay);
      store.upsertShippingMethods(ship);
      ok({ payment: pay.length, shipping: ship.length });
      return { payment: pay.length, shipping: ship.length };
    } catch (e) { fail('syncSettings', e); return { payment: 0, shipping: 0 }; }
  }

  /* Daily. updatedFrom can never report deletions, so the only way to find a
     removed product is to compare the full id set. The store refuses an empty
     keep-set, which is what stops a bad call from wiping the catalogue. */
  async function fullReconcile() {
    const { written } = await syncProducts({});
    if (!api.configured) return { written, removed: 0 };
    try {
      const live = await api.listAllProductIds();
      const { removed } = store.deleteMissingProducts(live);
      ok({ products: written, removed, reconcile: true });
      return { written, removed };
    } catch (e) { fail('fullReconcile', e); return { written, removed: 0 }; }
  }

  /* Everything, in dependency order: categories and settings first so a
     product arriving in a brand-new category already has somewhere to sit. */
  async function syncAll() {
    if (!api.configured) {
      notConfigured('syncAll');
      return { products: 0, categories: 0, payment: 0, shipping: 0, removed: 0 };
    }
    const c = await syncCategories();
    const s = await syncSettings();
    const r = await fullReconcile();
    return {
      products: r.written, removed: r.removed, categories: c.written,
      payment: s.payment, shipping: s.shipping,
    };
  }

  async function applyProductEvent({ entityId, eventType }) {
    if (!api.configured) { notConfigured('applyProductEvent'); return { action: 'error' }; }
    const id = String(entityId);
    try {
      if (/deleted/i.test(String(eventType))) {
        store.deleteProduct(id);
        ok({ event: eventType, id });
        return { action: 'deleted' };
      }
      /* Re-fetch. The event's own payload is deliberately not read. */
      const live = await api.getProduct(id);
      if (!live) {                          // 404: it is gone, don't keep a ghost
        store.deleteProduct(id);
        ok({ event: eventType, id, gone: true });
        return { action: 'deleted' };
      }
      store.upsertProducts([map.toSadkoProduct(live)]);
      ok({ event: eventType, id });
      return { action: 'upserted' };
    } catch (e) { fail('applyProductEvent ' + id, e); return { action: 'error' }; }
  }

  return {
    syncProducts,
    syncCategories,
    syncSettings,
    fullReconcile,
    syncAll,
    applyProductEvent,

    lastSyncedUnix() {
      const s = store.getState('last_sync');
      if (!s || !s.at) return null;
      const t = Date.parse(s.at);
      return Number.isFinite(t) ? Math.floor(t / 1000) : null;
    },
  };
}
