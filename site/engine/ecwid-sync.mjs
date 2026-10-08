/* ============================================================================
   Sync orchestration: pull, reconcile, mirror settings, and apply webhooks.

   Two design rules, both load-bearing:

     • A webhook handler IGNORES the event payload and RE-FETCHES the entity.
       We converge on current state instead of applying a diff, which makes
       replays and out-of-order delivery harmless. Never "optimise" this by
       trusting the payload — a test asserts the payload is ignored.

     • Nothing here throws. These methods run on the caller's schedule (a
       cron, or after a request; there are no timers in here) and from a
       public HTTP route; a failure records last_error and returns a zero result,
       leaving the last good mirror in place. The site must never go down, or
       serve an empty catalogue, because Ecwid did.
   ========================================================================== */

import { toSadkoProduct, toSadkoCategory, toEcwidOrder, toLocalStatus, toEcwidFulfillment } from './ecwid-map.mjs';
import { toEcwidCustomer, customerUpdatePatch, fromEcwidOrder } from './ecwid-customers.mjs';
import { withRestriction } from './ecwid-payments.mjs';
import { AD_SLOTS, buildSlotMap } from './ecwid-ads.mjs';

const PAGE = 100;

/* How long a full sync may hold the cross-instance lease. A full pull of
   ~1,500 products is well under a minute; a crashed run frees it after this. */
const SYNC_LEASE_MS = 10 * 60_000;

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

/* Ecwid gives every new manual method this title and enables it. Left as is,
   it reaches checkout as a choice with no meaning, so it is treated the same
   as a method with no title at all. */
const PLACEHOLDER_PAYMENT_TITLE = 'custom payment method name';
const isNamedPayment = m => !!m.title && m.title.toLowerCase() !== PLACEHOLDER_PAYMENT_TITLE;

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
    /* The store's own delivery policy, which staff wrote in Ecwid and the
       site was showing none of: "الحد الأقصى للشحن لعدد القطع هو 350 جنيه",
       "يرجى العلم بأن التوصيل يكون خلال 7 أيام". */
    description: String(o.description || '').trim() || null,
    /* WHY THIS FLAG EXISTS. destinationZone is {} on all twelve of this
       store's methods, so none is bound to a region and Ecwid matches the
       first enabled one — /order/calculate returns the Greater Cairo rate of
       250 for Aswan and Marsa Matrouh alike. Recorded as data so the gate in
       ecwid-shipping.mjs can refuse to quote a total, and so the admin panel
       can tell the owner what to change. It flips on its own once the zones
       are configured. */
    zoneConfigured: !!(o.destinationZone && Object.keys(o.destinationZone).length),
    /* The rate itself, which the delivery quote reads (engine/ecwid-shipping.mjs
       rateCard). Kept as Ecwid states it; interpretation happens there. */
    rates: o.ratesTable ? {
      basedOn: o.ratesTable.tableBasedOn || null,
      rows: (o.ratesTable.rates || []).map(r => {
        const c = r.conditions || {};
        const from = c.weightFrom ?? c.discountedSubtotalFrom ?? c.subtotalFrom ?? 0;
        const to = c.weightTo ?? c.discountedSubtotalTo ?? c.subtotalTo ?? null;
        const rt = r.rate || {};
        return { from: Number(from) || 0, to: to == null ? null : Number(to),
                 perOrder: Number(rt.perOrder) || 0, perItem: Number(rt.perItem) || 0 };
      }),
    } : null,
    flatRate: o.flatRate ? { type: String(o.flatRate.rateType || ''), rate: Number(o.flatRate.rate) || 0 } : null,
  };
}
export const toShippingMethodForTest = toShippingMethod;

export function createEcwidSync({ api, store, adFolders = {},
                                 map = { toSadkoProduct, toSadkoCategory, toEcwidOrder } }) {
  const fail = async (where, e) => {
    const msg = `${where}: ${(e && e.message) || e}`;
    try { await store.setState('last_error', msg); } catch (x) {}
    console.error('[ecwid] ' + msg);
  };
  const ok = async extra => {
    try {
      await store.setState('last_sync', { at: new Date().toISOString(), ...extra });
      await store.setState('last_error', null);
    } catch (x) {}
  };
  const notConfigured = async where => {
    await fail(where, new Error('ecwid is not configured'));
    return false;
  };

  async function syncProducts({ updatedFrom } = {}) {
    if (!api.configured) { await notConfigured('syncProducts'); return { written: 0, pages: 0 }; }
    let written = 0, pages = 0;
    try {
      for (let offset = 0; ; ) {
        const page = await api.listProducts({ updatedFrom, offset, limit: PAGE });
        const items = (page && page.items) || [];
        pages++;
        if (items.length) {
          await store.upsertProducts(items.map(map.toSadkoProduct));
          written += items.length;
        }
        offset += items.length;
        const total = page && page.total != null ? page.total : offset;
        if (!items.length || offset >= total) break;
      }
      await ok({ products: written, incremental: updatedFrom != null });
      return { written, pages };
    } catch (e) { await fail('syncProducts', e); return { written, pages }; }
  }

  async function syncCategories() {
    if (!api.configured) { await notConfigured('syncCategories'); return { written: 0 }; }
    try {
      const rows = (await api.listCategories()).map(map.toSadkoCategory);
      const r = await store.upsertCategories(rows);
      await ok({ categories: rows.length });
      return r;
    } catch (e) { await fail('syncCategories', e); return { written: 0 }; }
  }

  /* Payment and shipping methods, mirrored from the store profile. Only
     ENABLED methods are stored: offering one the owner switched off would take
     an order on terms SADKO cannot honour. Nor are unnamed ones. */
  async function syncSettings() {
    if (!api.configured) { await notConfigured('syncSettings'); return { payment: 0, shipping: 0 }; }
    try {
      const p = await api.getProfile();
      const pay = (p.paymentOptions || []).map(toPaymentMethod).filter(m => m.enabled && isNamedPayment(m));
      const ship = (p.shippingOptions || []).map(toShippingMethod).filter(m => m.enabled);
      await store.upsertPaymentMethods(pay);
      await store.upsertShippingMethods(ship);
      await ok({ payment: pay.length, shipping: ship.length });
      return { payment: pay.length, shipping: ship.length };
    } catch (e) { await fail('syncSettings', e); return { payment: 0, shipping: 0 }; }
  }

  /* Daily. updatedFrom can never report deletions, so the only way to find a
     removed product is to compare the full id set. The store refuses an empty
     keep-set, which is what stops a bad call from wiping the catalogue. */
  async function fullReconcile() {
    const { written } = await syncProducts({});
    if (!api.configured) return { written, removed: 0 };
    try {
      const live = await api.listAllProductIds();
      const { removed } = await store.deleteMissingProducts(live);
      await ok({ products: written, removed, reconcile: true });
      return { written, removed };
    } catch (e) { await fail('fullReconcile', e); return { written, removed: 0 }; }
  }

  /* Run fn only if no other instance holds the named lease. Resolves to
     { busy: true } without running it when the lease is taken. A store with
     no lease support (an old stub) just runs it. */
  async function runExclusive(name, ms, fn) {
    if (typeof store.acquireLease !== 'function') return { busy: false, result: await fn() };
    let owner = null;
    try { owner = await store.acquireLease(name, ms); } catch (e) { owner = null; }
    if (!owner) return { busy: true };
    try { return { busy: false, result: await fn() }; }
    finally { try { await store.releaseLease(name, owner); } catch (e) {} }
  }

  /* One full sync at a time: in THIS instance by sharing the running promise,
     and across instances by a lease in the mirror. A second instance that
     finds the lease held reports busy rather than pulling 1,500 products a
     second time in parallel. */
  let allRunning = null;
  function syncAll() {
    if (!allRunning) allRunning = syncAllOnce().finally(() => { allRunning = null; });
    return allRunning;
  }

  async function syncAllOnce() {
    if (!api.configured) {
      await notConfigured('syncAll');
      return { products: 0, categories: 0, payment: 0, shipping: 0, removed: 0 };
    }
    const r = await runExclusive('sync_all', SYNC_LEASE_MS, syncEverything);
    return r.busy
      ? { products: 0, categories: 0, payment: 0, shipping: 0, removed: 0, ads: 0, busy: true }
      : r.result;
  }

  /* Everything, in dependency order: categories and settings first so a
     product arriving in a brand-new category already has somewhere to sit. */
  async function syncEverything() {
    const c = await syncCategories();
    const s = await syncSettings();
    const r = await fullReconcile();
    /* Last, and only when folders are configured. It is one request per
       folder and it must not delay the catalogue, which is what the
       storefront actually needs first. */
    const a = await syncAdFolders(adFolders);
    return {
      products: r.written, removed: r.removed, categories: c.written,
      payment: s.payment, shipping: s.shipping, ads: a.ads,
    };
  }

  async function applyProductEvent({ entityId, eventType }) {
    if (!api.configured) { await notConfigured('applyProductEvent'); return { action: 'error' }; }
    const id = String(entityId);
    try {
      if (/deleted/i.test(String(eventType))) {
        await store.deleteProduct(id);
        await ok({ event: eventType, id });
        return { action: 'deleted' };
      }
      /* Re-fetch. The event's own payload is deliberately not read. */
      const live = await api.getProduct(id);
      if (!live) {                          // 404: it is gone, don't keep a ghost
        await store.deleteProduct(id);
        await ok({ event: eventType, id, gone: true });
        return { action: 'deleted' };
      }
      await store.upsertProducts([map.toSadkoProduct(live)]);
      await ok({ event: eventType, id });
      return { action: 'upserted' };
    } catch (e) { await fail('applyProductEvent ' + id, e); return { action: 'error' }; }
  }

  /* ---- pushing orders into Ecwid -------------------------------------
     CHECK-THEN-CREATE. If a previous attempt succeeded but its response was
     lost, creating again would put a SECOND order in front of staff and the
     customer would be shipped twice. So we always look for our ref first and
     adopt what we find. Never reorder these two calls. */
  const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

  /* Ecwid now holds the order, so this server should not.

     Only a GUEST order has a payload row here — an account order lives in
     accounts.db and is untouched by this, so the delete is a harmless no-op
     for it. The order_push row deliberately survives: it carries the Ecwid
     order id, which is what stops a retry creating the order twice.

     Wrapped, because failing to clean up must never turn a SUCCESSFUL push
     into a reported failure. A payload left behind is visible in the admin
     desk; an order pushed twice is not fixable. */
  async function dropGuestPayload(ref) {
    try { if (typeof store.dropGuestOrder === 'function') await store.dropGuestOrder(ref); }
    catch (e) { /* the row stays and shows in the desk; the order is fine */ }
  }

  async function pushOrder(ref, { loadOrder, loadUser } = {}) {
    let row = await store.pushRow(ref);
    if (row && row.ecwid_order_id)
      return { ok: true, ecwidOrderId: row.ecwid_order_id, already: true };

    /* THE CLAIM, before anything reaches Ecwid. Another serverless instance
       may be pushing this very order right now (the checkout's own push and
       the after-request retry, or two retries), and check-then-create alone
       cannot stop that: Ecwid's search may not show an order created a
       second ago. Only one caller gets the row; the other backs off WITHOUT
       spending an attempt. Every exit below either marks the row pushed or
       parks it, and both release the claim. A crash leaves it to expire. */
    if (!row) { await store.enqueueOrderPush(ref); row = await store.pushRow(ref); }
    if (!(await store.claimPush(ref))) {
      const now = await store.pushRow(ref);
      if (now && now.ecwid_order_id)
        return { ok: true, ecwidOrderId: now.ecwid_order_id, already: true };
      return { ok: false, busy: true, error: 'another worker is pushing this order' };
    }

    const attempts = row ? row.attempts : 0;
    const schedule = n => new Date(Date.now() + BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]).toISOString();
    const park = async msg => {
      await store.markPushFailed(ref, msg, schedule(attempts));
      console.error(`[ecwid] order push ${ref} failed: ${msg}`);
      return { ok: false, error: msg };
    };

    if (!api.configured) return park('ecwid is not configured');

    let payload, loaded = null;
    try {
      const order = await loadOrder(ref);
      if (!order) return park('local order not found');
      const user = await loadUser(order);
      /* Throws on an unknown payment method — a wrong payment status on a real
         order is worse than a failed push. */
      /* withRestriction, NOT the raw rows: restricted and brand are derived from
         the Arabic title rather than stored, so the raw rows always read as
         unrestricted and toEcwidOrder silently dropped the staff warning for a
         brand-restricted instalment plan. */
      payload = map.toEcwidOrder(order, user, withRestriction(await store.allPaymentMethods()));
      loaded = order;
    } catch (e) { return park(String((e && e.message) || e)); }

    /* A GUEST has no account, so nothing else will ever create their customer
       record from the details they typed. Ecwid does create one off the order's
       email, but it would carry no phone and no address — and the phone is what
       staff ring to arrange delivery. So the details go onto the customer
       record too, taken from the order's own delivery block.

       Best effort, deliberately: the ORDER is the thing that must not be lost,
       so a failed link never fails the push — and because each retry of the
       push runs this again, a link that failed once gets another chance.

       An account holder is skipped here on purpose: the link queue owns them,
       and doing it in both places would double the API calls per order. */
    if (loaded && loaded.guest) {
      try {
        const d = loaded.delivery || {};
        await linkCustomer({
          email: loaded.email,
          name: d.name || '',
          phone: d.phone || '',
          address: d.address || null,
          profile: { governorate: d.governorate || '' },
        });
      } catch (e) { /* the order matters more than the customer record */ }
    }

    try {
      const existing = await api.findOrderByRef(ref);
      if (existing && existing.id) {
        await store.markPushed(ref, existing.id);
        await dropGuestPayload(ref);
        return { ok: true, ecwidOrderId: String(existing.id), adopted: true };
      }
      const created = await api.createOrder(payload);
      const id = created && (created.id ?? created.orderId);
      if (id == null) return park('ecwid returned no order id');
      await store.markPushed(ref, id);
      await dropGuestPayload(ref);
      return { ok: true, ecwidOrderId: String(id) };
    } catch (e) { return park(String((e && e.message) || e)); }
  }

  async function pushPendingOrders(loaders) {
    let pushed = 0, failed = 0, busy = 0;
    for (let i = 0; i < 25; i++) {            // bounded: one tick cannot run forever
      const due = await store.nextDuePush();
      if (!due) break;
      const r = await pushOrder(due.ref, loaders);
      if (r.ok) { pushed++; continue; }
      /* Another instance claimed it between our read and our claim. Not a
         failure, and nextDuePush now skips it, so move on to the next. */
      if (r.busy) { busy++; continue; }
      failed++;
      /* Stop on the first failure. The next due order is almost always blocked
         by the same outage, so retrying them all now just multiplies it. */
      break;
    }
    return busy ? { pushed, failed, busy } : { pushed, failed };
  }

  /* ---- which products are advertisements, and in which slot -------------
     One request per configured folder, and only ids come back.

     Stored in the mirror rather than recomputed per request, because the
     membership cannot be derived from the products themselves: Ecwid omits a
     disabled category from a product's categoryIds, and an ad folder must be
     disabled. So this map IS the only record, and it has to survive between
     syncs the way the catalogue does.

     A folder whose fetch fails keeps its PREVIOUS contents rather than
     emptying: a transient API error must not blank the homepage's adverts.
     That is the whole reason each folder is merged individually instead of
     the map being rebuilt wholesale. */
  async function syncAdFolders(folders = adFolders) {
    const slots = AD_SLOTS.filter(sl => folders[sl]);
    /* No token: leave the stored state ALONE. That is a transient condition,
       and clearing it would drop every advert during an outage. */
    if (!api.configured) return { slots: 0, ads: 0, failed: [] };
    /* No folders configured: clear it. That is a deliberate configuration
       change, and the stored contents must not go on marking products as
       adverts — adFolderState() already refuses to use them, and this stops
       them accumulating in the mirror as well. */
    if (!slots.length) {
      try { await store.setState('ad_folders', null); adStored = null; } catch (e) {}
      return { slots: 0, ads: 0, failed: [] };
    }

    const prev = (await store.getState('ad_folders') || {});
    const prevContents = prev.contents || {};
    const contents = {};
    const failed = [];

    for (const slot of slots) {
      const id = String(folders[slot]);
      try {
        contents[id] = await api.listCategoryProductIds(id);
      } catch (e) {
        failed.push({ slot, id, error: String((e && e.message) || e) });
        if (prevContents[id]) contents[id] = prevContents[id];
      }
    }

    const { map, conflicts } = buildSlotMap(folders, contents);
    const next = { folders, contents, map, conflicts, failed, at: new Date().toISOString() };
    await store.setState('ad_folders', next);
    adStored = next;
    return { slots: slots.length, ads: Object.keys(map).length, conflicts, failed };
  }

  /* The last stored ad state THIS instance has seen. The store is async now,
     and adFolderState() is read synchronously on the storefront's hot path,
     so it works from a copy: written by syncAdFolders, re-read by
     loadAdFolderState(), or handed in by the caller from the source's
     snapshot (ecwidSource().storedAdFolders()), which refresh() keeps current
     across instances. undefined = never loaded. */
  let adStored;

  async function loadAdFolderState() {
    try { adStored = await store.getState('ad_folders'); } catch (e) { /* keep the last copy */ }
    return adFolderState();
  }

  /* The stored map, for the storefront and the admin panel. Shaped so a store
     that has never synced ads reads as "no ads configured" rather than
     throwing. Pass the stored state to use it instead of this instance's
     copy. */
  function adFolderState(stored) {
    const st = stored !== undefined ? stored : (adStored ?? null);
    if (!st || typeof st !== 'object') {
      return { folders: {}, map: {}, contents: {}, conflicts: [], failed: [], at: null };
    }
    /* The map is REBUILT from the folders configured RIGHT NOW, not read back
       from the stored one.

       The bug this fixes, measured: after a run with SADKO_ECWID_ADS_SQUARE
       set, removing the variable and restarting still served 983 products
       instead of 990 and still showed the folder's contents as adverts — the
       stored map outlived the configuration that produced it. Unsetting a
       folder has to take effect at once, not at whatever point the next sync
       happens to overwrite the state.

       Stored `contents` is keyed by folder id, so intersecting it with the
       live config is exact: a folder that is no longer configured contributes
       nothing, and one that still is keeps working from the last good read. */
    const contents = st.contents || {};
    const { map, conflicts } = buildSlotMap(adFolders, contents);
    return {
      folders: adFolders,
      map,
      contents,
      conflicts,
      failed: st.failed || [],
      at: st.at || null,
      /* What the last sync actually recorded, so the admin panel can show a
         folder that was configured, read, and then unconfigured. */
      storedFolders: st.folders || {},
    };
  }

  /* ---- link a site account to an Ecwid customer -------------------------
     By email, which is the key Ecwid itself files orders under. Creates the
     record when it is missing and otherwise only FILLS what Ecwid lacks —
     it never overwrites a detail staff corrected there, because staff are
     closer to the customer than a registration form is.

     Returns a result rather than throwing: a customer whose record cannot be
     linked must still be able to register and to order. */
  async function linkCustomer(user) {
    if (!api.configured) return { ok: false, reason: 'not-configured' };
    const desired = toEcwidCustomer(user);
    if (!desired) return { ok: false, reason: 'no-email' };
    try {
      const existing = await api.customerByEmail(desired.email);
      if (!existing) {
        const made = await api.createCustomer(desired);
        const id = made && made.id != null ? String(made.id) : null;
        /* Remember what we sent. Without this the NEXT push cannot tell a change
           the user made here from a correction staff made in Ecwid, and falls
           back to filling only what is missing. */
        await store.markCustomerLinked(desired.email, id, desired);
        return { ok: true, created: true, id };
      }
      /* Only the fields that actually changed. Sending the whole payload would
         overwrite every detail staff corrected in Ecwid, which is why this used
         to send a single hardcoded field and no more. */
      const patch = customerUpdatePatch(existing, desired, await store.customerPushSnapshot(desired.email));
      if (Object.keys(patch).length) {
        await api.updateCustomer(existing.id, patch);
        await store.markCustomerLinked(desired.email, String(existing.id), desired);
        return { ok: true, updated: true, id: String(existing.id) };
      }
      return { ok: true, id: String(existing.id) };
    } catch (e) {
      /* A public_ token answers 403 here. That is a configuration state, not
         a fault, and it must never surface to the customer. */
      const msg = String((e && e.message) || e);
      return { ok: false, reason: /ecwid-40[13]/.test(msg) ? 'no-access' : 'error', message: msg };
    }
  }

  /* ---- status, flowing back from Ecwid WITHOUT a webhook -----------------

     Staff mark an order shipped in Ecwid and the customer has to see it here.
     The webhook does that instantly, but Ecwid can only deliver a webhook to a
     PUBLIC url — so in development, and in production until the webhook is
     registered, a status change never arrived at all. This is the same job on
     the poll.

     Only orders that actually REACHED Ecwid are asked about: an order still
     sitting in the push queue has no Ecwid id, so there is nothing to ask.

     Finished orders drop out. The pushed list only ever grows, and asking
     Ecwid about every order the shop has ever taken, every five minutes,
     forever, is what would make this expensive — while a delivered or
     cancelled order cannot change again.

     An Ecwid status we do not map leaves the local one ALONE. Inventing a
     transition would lie to the customer about their order, and that is worse
     than showing a stale one. Same rule as the webhook path.

     `blocked` says the token cannot read orders at all (a public_ token
     answers 403), so the caller can report a configuration state rather than
     an error nobody can act on. */
  const TERMINAL = new Set(['delivered', 'cancelled']);

  async function syncOrderStatuses({ loadOrder, setStatus } = {}, limit = 25) {
    if (!api.configured || typeof loadOrder !== 'function') return { changed: 0, checked: 0 };
    let changed = 0, checked = 0, blocked = false;

    for (const row of await store.pushedOrders(400)) {
      if (checked >= limit) break;                  // bounded: one tick cannot run forever
      let local = null;
      try { local = await loadOrder(row.ref); } catch (e) { continue; }
      if (!local || TERMINAL.has(String(local.status))) continue;

      checked++;
      let remote = null;
      try {
        remote = await api.getOrder(row.ecwid_order_id);
      } catch (e) {
        /* 403 is "this token cannot read orders" — a configuration state, not
           a fault. Stop asking: every remaining order would answer the same. */
        if (e && (e.status === 403 || e.status === 401)) { blocked = true; break; }
        continue;
      }
      if (!remote) continue;

      const status = toLocalStatus(remote);
      if (!status || status === local.status) continue;
      try {
        await setStatus(row.ref, status);
        changed++;
        console.log(`[ecwid] order ${row.ref} -> ${status} (poll)`);
      } catch (e) { /* a rejected write is the accounts layer's to report */ }
    }
    return { changed, checked, blocked };
  }

  /* ---- work the customer link queue -------------------------------------

     The fault this fixes: linking ran once, at registration, and its failure
     was swallowed. On a public_ token every account failed silently, and
     nothing would ever have tried again — so the accounts created before a
     secret token arrived would have stayed missing from Ecwid forever, which
     is exactly what the owner noticed.

     `loadByEmail` reads the account from accounts.db. The queue holds only
     an email, so this is where the name and phone are fetched: no second
     copy of the customer is kept anywhere.

     A 403 STOPS the tick without counting an attempt against anyone. That
     matters more than it looks: burning all six attempts against a token
     that cannot write would leave every customer permanently parked the
     moment a working token arrived. */
  async function linkPendingCustomers(loadByEmail, limit = 25) {
    if (!api.configured || typeof loadByEmail !== 'function')
      return { linked: 0, dropped: 0, failed: 0 };

    let linked = 0, dropped = 0, failed = 0, blocked = false;
    const schedule = n => new Date(Date.now() + BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]).toISOString();

    for (const row of await store.dueCustomerLinks(limit)) {
      const email = row.email;
      /* Claimed first, so two instances working the queue cannot both create
         the same customer in Ecwid. Someone else has it: skip. */
      if (typeof store.claimCustomerLink === 'function' && !(await store.claimCustomerLink(email))) continue;
      const release = async () => {
        try { if (typeof store.releaseCustomerLink === 'function') await store.releaseCustomerLink(email); } catch (e) {}
      };

      let user = null;
      try { user = await loadByEmail(email); }
      catch (e) {
        /* Reading the accounts database failed — not this customer's fault
           and not a reason to spend an attempt. */
        await release();
        continue;
      }

      /* The account was deleted between enqueue and attempt. There is nothing
         to link, so it leaves the queue rather than parking for good. */
      if (!user) {
        await store.markCustomerLinked(email, null);
        dropped++;
        continue;
      }

      const r = await linkCustomer(user);
      if (r.ok) {
        await store.markCustomerLinked(email, r.id || null);
        linked++;
        continue;
      }
      if (r.reason === 'no-access') { await release(); blocked = true; break; }
      await store.markCustomerLinkFailed(email, r.message || r.reason || 'unknown', schedule(row.attempts));
      failed++;
    }

    if (blocked)
      console.warn('[ecwid] customers cannot be written with this token (403) — ' +
        (await store.pendingCustomerLinks()).length + ' waiting. A secret_ token is needed.');
    else if (linked)
      console.log('[ecwid] linked ' + linked + ' customer(s) into Ecwid');

    return { linked, dropped, failed, blocked };
  }

  /* ---- the orders Ecwid holds for one customer --------------------------
     So a phone order or a showroom sale, typed in by staff, reaches the
     customer's own account page instead of seeming to have been lost.

     An empty array on ANY failure: the customer's local orders have to render
     regardless of whether Ecwid answered. */
  async function remoteOrdersFor(email) {
    if (!api.configured || !email) return [];
    try {
      const raw = await api.ordersByEmail(email);
      return (Array.isArray(raw) ? raw : []).map(fromEcwidOrder).filter(Boolean);
    } catch (e) { return []; }
  }

  /* ---- a status set HERE, pushed UP to Ecwid -----------------------------

     Ecwid is the master for anything staff change THERE; this is the other
     direction, which simply did not exist: the admin orders desk wrote a status
     locally and the control panel stayed stale, in the one direction nobody
     watches.

     THE ECHO IS ALREADY HANDLED, and not by a timer. The push makes Ecwid fire
     order.updated straight back at us, and applyEcwidOrderEvent returns early
     when the status it computes equals the one already stored. That holds for
     every status toEcwidFulfillment will push, because each maps back to
     itself — which is exactly the property ecwid-map.test.mjs asserts, and the
     reason `confirmed` is refused here rather than mapped to PROCESSING.

     Never throws: an operator changing a status must not see a 500 because
     Ecwid was slow. */
  async function pushOrderStatus(ref, status) {
    if (!api.configured) return { ok: false, reason: 'not-configured' };
    const remote = toEcwidFulfillment(status);
    if (!remote) return { ok: false, reason: 'not-pushable' };
    const row = await store.pushRow(ref);
    /* No Ecwid id means the order is still in the push queue. Nothing to
       update, and nothing lost: toEcwidOrder carries the status when the order
       is finally created. */
    if (!row || !row.ecwid_order_id) return { ok: false, reason: 'not-in-ecwid' };
    try {
      await api.updateOrder(row.ecwid_order_id, { fulfillmentStatus: remote });
      return { ok: true, id: String(row.ecwid_order_id), fulfillmentStatus: remote };
    } catch (e) {
      const msg = String((e && e.message) || e);
      return { ok: false, reason: /ecwid-40[13]/.test(msg) ? 'no-access' : 'error', message: msg };
    }
  }

  return {
    syncProducts,
    pushOrder,
    pushOrderStatus,
    pushPendingOrders,
    linkCustomer,
    linkPendingCustomers,
    remoteOrdersFor,
    syncOrderStatuses,
    syncAdFolders,
    adFolderState,
    loadAdFolderState,
    runExclusive,
    syncCategories,
    syncSettings,
    fullReconcile,
    syncAll,
    applyProductEvent,

    async lastSyncedUnix() {
      const s = await store.getState('last_sync');
      if (!s || !s.at) return null;
      const t = Date.parse(s.at);
      return Number.isFinite(t) ? Math.floor(t / 1000) : null;
    },
  };
}
