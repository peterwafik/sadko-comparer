/* ============================================================================
   The Ecwid mirror — products, categories, payment and shipping methods, and
   sync state. Same discipline as the other stores: engine/db.mjs (libSQL, a
   local file or Turso), numbered migrations under the store name 'ecwid',
   prepared statements, and ONE db.batch per multi-row write. Every method
   that touches the database returns a Promise; close() stays synchronous.

   This is a CACHE of someone else's data, so deleting the file and re-syncing
   is always safe. The one thing it must never do is empty ITSELF because a
   sync went wrong — hence the empty-keep-set guard in deleteMissingProducts.

   Rows are stored as JSON documents rather than columns. The Ecwid shape is
   theirs to change, the mapper already normalises it, and the storefront reads
   whole products; splitting 18 fields into columns would buy nothing and cost
   a migration every time Ecwid adds one. The few things that need querying
   (counts, stock, discounts) are counted in SQL over json_extract.

   CATALOGUE VERSION. state.catalog_version is a counter bumped in the SAME
   batch as every write to products or categories, and to the ad-folder map
   (which changes what is served). Each serverless instance keeps its own
   in-memory snapshot (ecwid-source.mjs) and reloads it only when this number
   moves: one cheap row read instead of 1,500 products per request.

   CLAIMS. Several instances may work the push and link queues at once. A row
   is CLAIMED (claimed_until in the future) by an atomic UPDATE before anyone
   calls Ecwid, so two instances can never push the same order twice. Leases
   on whole jobs (a full sync) live in `state` as lease:<name>.
   ========================================================================== */

import { openDb, storeSpec } from './db.mjs';


const MIGRATIONS = [{
  id: 1, name: 'ecwid mirror base',
  sql: `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  `,
}, {
  id: 2, name: 'payment and shipping methods',
  sql: `
  CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shipping_methods (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, synced_at TEXT NOT NULL
  );
  `,
}, {
  id: 3, name: 'order push queue',
  sql: `
  CREATE TABLE IF NOT EXISTS order_push (
    ref TEXT PRIMARY KEY,
    ecwid_order_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    pushed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS order_push_due ON order_push(pushed_at, next_attempt_at);
  `,
}, {
  id: 4, name: 'guest order outbox',
  sql: `
  -- A guest order, held ONLY until Ecwid accepts it, then deleted. It lives
  -- here rather than in accounts.db so that no personal data accumulates in
  -- the long-lived, backed-up store. A row surviving here means the push has
  -- not succeeded yet, and the admin orders desk shows it so somebody can
  -- ring the customer.
  CREATE TABLE IF NOT EXISTS guest_order (
    ref        TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    data_json  TEXT NOT NULL
  );
  `,
}, {
  id: 5, name: 'customer link queue',
  sql: `
  -- Who still needs a customer record in Ecwid. Deliberately holds NO name,
  -- phone or address: the email is the key Ecwid files under, and the details
  -- are read from accounts.db when the attempt is made. So this is a work
  -- list, not a second copy of the customer.
  CREATE TABLE IF NOT EXISTS customer_link (
    email             TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL,
    attempts          INTEGER NOT NULL DEFAULT 0,
    next_attempt_at   TEXT,
    last_error        TEXT,
    ecwid_customer_id TEXT,
    linked_at         TEXT
  );
  CREATE INDEX IF NOT EXISTS customer_link_due ON customer_link(linked_at, next_attempt_at);
  `,
}, {
  id: 6, name: "customer link push snapshot",
  sql: `
  -- What we last SENT for this customer, as JSON. The discriminator that lets
  -- a later push tell a change the user made here (desired != pushed) from a
  -- correction staff made in Ecwid (remote != pushed), so the second is never
  -- overwritten by the first. See customerUpdatePatch in ecwid-customers.mjs.
  --
  -- Still not a copy of the customer: it is only ever compared, never read back
  -- as truth, and a NULL simply means "no snapshot yet, be conservative".
  ALTER TABLE customer_link ADD COLUMN pushed_json TEXT;
  `,
}, {
  id: 7, name: 'queue claims for concurrent workers',
  sql: `
  -- Who is working a row right now, as an ISO expiry. Taken by an atomic
  -- UPDATE ... WHERE claimed_until IS NULL OR claimed_until < now, so of two
  -- serverless instances only one ever calls Ecwid for the same order. An
  -- instance that dies mid-push simply lets its claim expire.
  ALTER TABLE order_push ADD COLUMN claimed_until TEXT;
  ALTER TABLE customer_link ADD COLUMN claimed_until TEXT;
  `,
}];

const nowISO = () => new Date().toISOString();
const inISO = ms => new Date(Date.now() + ms).toISOString();

/* How long one worker may hold an order or a customer before another may try.
   Longer than any single push (a few Ecwid calls), short enough that a
   function killed mid-push does not hold the order back for long. The
   check-then-create in pushOrder still guards an order whose claim expired
   while its first push was in flight. */
export const CLAIM_MS = 5 * 60_000;

/* State keys whose writes change what the storefront serves, so they bump the
   catalogue version like a product write does. */
const CATALOG_STATE_KEYS = new Set(['ad_folders']);

export async function openEcwidStore(file, { authToken } = {}) {
  const where = storeSpec(file);
  const db = await openDb(where.spec, { authToken: authToken ?? where.authToken });
  await db.migrate('ecwid', MIGRATIONS);

  const upsertSql = t =>
    `INSERT INTO ${t} (id, data_json, synced_at) VALUES (?,?,?) ` +
    'ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, synced_at = excluded.synced_at';

  const putP = db.prepare(upsertSql('products'));
  const putC = db.prepare(upsertSql('categories'));
  const putPay = db.prepare(upsertSql('payment_methods'));
  const putShip = db.prepare(upsertSql('shipping_methods'));

  const delP = db.prepare('DELETE FROM products WHERE id = ?');
  const allP = db.prepare('SELECT data_json FROM products');
  const allC = db.prepare('SELECT data_json FROM categories');
  const allPay = db.prepare('SELECT data_json FROM payment_methods');
  const allShip = db.prepare('SELECT data_json FROM shipping_methods');
  const idsP = db.prepare('SELECT id FROM products');

  const getS = db.prepare('SELECT value_json FROM state WHERE key = ?');
  const putS = db.prepare('INSERT INTO state (key, value_json, updated_at) VALUES (?,?,?) ' +
                          'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at');

  /* The catalogue version: an atomic increment, so two instances writing at
     once still each move it, and it never goes backwards. */
  const bumpV = db.prepare(
    "INSERT INTO state (key, value_json, updated_at) VALUES ('catalog_version', '1', ?) " +
    'ON CONFLICT(key) DO UPDATE SET ' +
    'value_json = CAST(COALESCE(CAST(state.value_json AS INTEGER), 0) + 1 AS TEXT), updated_at = excluded.updated_at');
  const bump = () => bumpV.bind(nowISO());
  const getV = db.prepare("SELECT value_json FROM state WHERE key = 'catalog_version'");
  const toVersion = r => { const n = Number(r && r.value_json); return Number.isFinite(n) ? n : 0; };

  /* Everything a storefront instance re-checks every few seconds, in ONE
     round trip: the version, the two status values the admin panel shows,
     and the payment/shipping counts. */
  const metaQ = db.prepare(
    "SELECT (SELECT value_json FROM state WHERE key = 'catalog_version') AS v, " +
    "(SELECT value_json FROM state WHERE key = 'last_sync') AS ls, " +
    "(SELECT value_json FROM state WHERE key = 'last_error') AS le, " +
    '(SELECT COUNT(*) FROM payment_methods) AS pay, ' +
    '(SELECT COUNT(*) FROM shipping_methods) AS ship');

  /* Scoped to ENABLED products on purpose. The 463 disabled shells have no
     stock tracking, so they default to in-stock; counting them would make the
     out-of-stock figure meaningless. What matters is: of the products a
     customer could see, how many cannot be bought.

     How many products carry a real weight is COUNTED rather than assumed: it
     is 0 of 1,453 in the live store, one of the two reasons delivery cannot be
     quoted, and the gate in ecwid-shipping.mjs opens by itself once staff
     start entering weights.

     One statement, so the admin panel costs one round trip on Turso. */
  const statsQ = db.prepare(
    'SELECT (SELECT COUNT(*) FROM products) AS products, ' +
    "(SELECT COUNT(*) FROM products WHERE json_extract(data_json,'$.enabled') = 1) AS enabled, " +
    "(SELECT COUNT(*) FROM products WHERE json_extract(data_json,'$.enabled') = 1 AND json_extract(data_json,'$.inStock') = 1) AS buyable, " +
    '(SELECT COUNT(*) FROM categories) AS categories, ' +
    "(SELECT COUNT(*) FROM products WHERE json_extract(data_json,'$.enabled') = 1 AND json_extract(data_json,'$.inStock') = 0) AS outOfStock, " +
    "(SELECT COUNT(*) FROM products WHERE json_extract(data_json,'$.compareToPrice') IS NOT NULL) AS discounted, " +
    "(SELECT COUNT(*) FROM products WHERE json_extract(data_json,'$.incomplete') = 1) AS incomplete, " +
    "(SELECT COUNT(*) FROM products WHERE json_extract(data_json,'$.weight') > 0) AS withWeight, " +
    '(SELECT COUNT(*) FROM payment_methods) AS paymentMethods, ' +
    '(SELECT COUNT(*) FROM shipping_methods) AS shippingMethods');

  /* ---- order push queue ----
     An order is written locally FIRST and only then queued here, so a push
     that never succeeds costs visibility, never the order itself. */
  const MAX_ATTEMPTS = 6;
  const unclaimed = '(claimed_until IS NULL OR claimed_until < ?)';
  const pqIns = db.prepare('INSERT INTO order_push (ref, attempts, next_attempt_at, created_at) VALUES (?,0,NULL,?) ' +
                           'ON CONFLICT(ref) DO NOTHING');
  const pqGet = db.prepare('SELECT * FROM order_push WHERE ref = ?');
  /* A row another worker holds is not due: it is being pushed right now. */
  const pqDue = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts < ' + MAX_ATTEMPTS +
                           ' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) AND ' + unclaimed +
                           ' ORDER BY created_at LIMIT 1');
  /* THE CLAIM. Atomic, so of two instances that both saw the order due, only
     one gets changes = 1 and goes on to call Ecwid. A pushed order can never
     be claimed again. */
  const pqClaim = db.prepare('UPDATE order_push SET claimed_until = ? WHERE ref = ? AND ecwid_order_id IS NULL AND ' + unclaimed);
  const pqRelease = db.prepare('UPDATE order_push SET claimed_until = NULL WHERE ref = ?');
  const pqOk = db.prepare('UPDATE order_push SET ecwid_order_id = ?, pushed_at = ?, last_error = NULL, claimed_until = NULL WHERE ref = ?');
  const pqBad = db.prepare('UPDATE order_push SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, claimed_until = NULL WHERE ref = ?');
  const pqPend = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts < ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const pqFail = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts >= ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  /* attempts = 0 as well as the delay. Clearing only next_attempt_at left an
     order that had burned its budget permanently invisible to nextDuePush,
     because the due query also filters attempts < MAX_ATTEMPTS — so the admin
     desk's Retry button did nothing at all on the orders that most needed it.
     resetCustomerLink always did both; this was the odd one out. */
  const pqReset = db.prepare('UPDATE order_push SET attempts = 0, next_attempt_at = NULL, last_error = NULL WHERE ref = ?');
  /* Every order Ecwid does not have, whether it was never queued, is waiting, or
     has exhausted its retries. The boot backfill's work list. */
  const pqUnsent = db.prepare('SELECT ref FROM order_push WHERE ecwid_order_id IS NULL ORDER BY created_at');
  /* The orders that actually reached Ecwid, newest first. Only these have an
     Ecwid id to ask about, and only Ecwid can say what staff did to them
     after the push. */
  const pqPushed = db.prepare('SELECT * FROM order_push WHERE ecwid_order_id IS NOT NULL '
    + 'ORDER BY pushed_at DESC LIMIT ?');
  /* INSERT OR IGNORE, not REPLACE: re-enqueueing an email that is already
     linked must not wipe its ecwid_customer_id and make it look unlinked. */
  const clIns  = db.prepare('INSERT OR IGNORE INTO customer_link (email, created_at, attempts) VALUES (?,?,0)');
  const clGet  = db.prepare('SELECT * FROM customer_link WHERE email = ?');
  const clDue  = db.prepare('SELECT * FROM customer_link WHERE linked_at IS NULL AND attempts < ' + MAX_ATTEMPTS
    + ' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) AND ' + unclaimed + ' ORDER BY created_at LIMIT ?');
  const clClaim = db.prepare('UPDATE customer_link SET claimed_until = ? WHERE email = ? AND linked_at IS NULL AND ' + unclaimed);
  const clOk   = db.prepare('UPDATE customer_link SET ecwid_customer_id = ?, linked_at = ?, last_error = NULL, claimed_until = NULL WHERE email = ?');
  /* Snapshot written separately so a link that cannot build a payload leaves the
     stored one intact: losing the discriminator silently reverts the customer to
     the conservative fill-only rule. */
  const clSnap = db.prepare('UPDATE customer_link SET pushed_json = ? WHERE email = ?');
  const clSnapGet = db.prepare('SELECT pushed_json FROM customer_link WHERE email = ?');
  const clBad  = db.prepare('UPDATE customer_link SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, claimed_until = NULL WHERE email = ?');
  const clRelease = db.prepare('UPDATE customer_link SET claimed_until = NULL WHERE email = ?');
  const clPend = db.prepare('SELECT * FROM customer_link WHERE linked_at IS NULL AND attempts < ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const clFail = db.prepare('SELECT * FROM customer_link WHERE linked_at IS NULL AND attempts >= ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const clReset = db.prepare('UPDATE customer_link SET attempts = 0, next_attempt_at = NULL WHERE email = ?');
  const clLinked = db.prepare('SELECT COUNT(*) c FROM customer_link WHERE linked_at IS NOT NULL');
  const goPut  = db.prepare('INSERT OR REPLACE INTO guest_order (ref, created_at, data_json) VALUES (?,?,?)');
  const goGet  = db.prepare('SELECT * FROM guest_order WHERE ref = ?');
  const goDrop = db.prepare('DELETE FROM guest_order WHERE ref = ?');
  const goAll  = db.prepare('SELECT * FROM guest_order ORDER BY created_at');

  /* Whole-job leases, e.g. one full sync at a time across every instance.
     The upsert only overwrites an EXPIRED lease, so changes tells us whether
     we got it. */
  const lsTake = db.prepare(
    'INSERT INTO state (key, value_json, updated_at) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at ' +
    "WHERE json_extract(state.value_json,'$.until') IS NULL OR json_extract(state.value_json,'$.until') < ?");
  const lsDrop = db.prepare("DELETE FROM state WHERE key = ? AND json_extract(value_json,'$.owner') = ?");

  const parse = rows => rows.map(r => JSON.parse(r.data_json));
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id));
  const em = e => String(e || '').trim().toLowerCase();

  /* One batch per write: a 1,453-product sync is a single atomic round trip,
     not 1,453 of them, and the catalogue version moves in the same batch. */
  async function bulk(stmt, rows) {
    if (!Array.isArray(rows) || !rows.length) return { written: 0 };
    const at = nowISO();
    await db.batch([...rows.map(r => stmt.bind(String(r.id), JSON.stringify(r), at)), bump()]);
    return { written: rows.length };
  }

  /* Payment and shipping are REPLACED wholesale, not merged: a method the
     owner disabled in Ecwid must stop being offered at checkout, and a merge
     would leave it behind for ever. */
  async function replaceAll(table, stmt, rows) {
    const at = nowISO();
    await db.batch([`DELETE FROM ${table}`, ...(rows || []).map(r => stmt.bind(String(r.id), JSON.stringify(r), at))]);
    return { written: (rows || []).length };
  }

  async function getState(key) {
    const r = await getS.get(key);
    if (!r) return null;
    try { return JSON.parse(r.value_json); } catch { return null; }
  }

  return {
    upsertProducts: rows => bulk(putP, rows),
    upsertCategories: rows => bulk(putC, rows),
    upsertPaymentMethods: rows => replaceAll('payment_methods', putPay, rows),
    upsertShippingMethods: rows => replaceAll('shipping_methods', putShip, rows),

    async deleteProduct(id) { await db.batch([delP.bind(String(id)), bump()]); },

    /* Called by the daily reconcile. An empty keep-set means the API call that
       produced it failed or returned nothing — obeying it would wipe the
       catalogue, so refuse loudly instead. */
    async deleteMissingProducts(keep) {
      if (!keep || typeof keep.has !== 'function' || !keep.size)
        throw new Error('refusing to reconcile against an empty keep-set');
      const gone = (await idsP.all()).map(r => String(r.id)).filter(id => !keep.has(id));
      if (!gone.length) return { removed: 0 };
      await db.batch([...gone.map(id => delP.bind(id)), bump()]);
      return { removed: gone.length };
    },

    allProducts: async () => parse(await allP.all()),
    allCategories: async () => parse(await allC.all()).sort(byOrder),
    allPaymentMethods: async () => parse(await allPay.all()).sort(byOrder),
    allShippingMethods: async () => parse(await allShip.all()).sort(byOrder),
    productIds: async () => new Set((await idsP.all()).map(r => String(r.id))),

    /* The counter the in-memory snapshots compare against. 0 for a store that
       has never been written. */
    catalogVersion: async () => toVersion(await getV.get()),

    /* The version plus what describe() shows, in one read. */
    async catalogMeta() {
      const r = (await metaQ.get()) || {};
      const j = v => { if (v == null) return null; try { return JSON.parse(v); } catch { return null; } };
      return {
        version: toVersion({ value_json: r.v }),
        lastSync: j(r.ls), lastError: j(r.le),
        paymentMethods: Number(r.pay) || 0, shippingMethods: Number(r.ship) || 0,
      };
    },

    MAX_PUSH_ATTEMPTS: MAX_ATTEMPTS,
    CLAIM_MS,
    async enqueueOrderPush(ref) { await pqIns.run(String(ref), nowISO()); },
    async pushRow(ref) { return (await pqGet.get(String(ref))) || null; },
    async nextDuePush(at) { const t = at || nowISO(); return (await pqDue.get(t, t)) || null; },
    /* true when THIS caller now holds the order; false when another worker
       does, or it has already reached Ecwid. */
    async claimPush(ref, ms = CLAIM_MS) {
      const r = await pqClaim.run(inISO(ms), String(ref), nowISO());
      return r.changes === 1;
    },
    async releasePush(ref) { await pqRelease.run(String(ref)); },
    async markPushed(ref, ecwidOrderId) { await pqOk.run(String(ecwidOrderId), nowISO(), String(ref)); },
    async markPushFailed(ref, error, nextAttemptAt) {
      await pqBad.run(String(error).slice(0, 500), nextAttemptAt || null, String(ref));
    },
    pendingPushes: () => pqPend.all(),
    failedPushes: () => pqFail.all(),
    async resetPush(ref) { await pqReset.run(String(ref)); },
    pushedOrders: (limit = 200) => pqPushed.all(Number(limit) || 200),
    unsentOrderRefs: async () => (await pqUnsent.all()).map(r => r.ref),

    /* ---- the customer link queue ----
       Emails are the key, so they are normalised here rather than trusting
       every caller to remember. */
    async enqueueCustomerLink(email) {
      const e = em(email);
      if (!e) return;
      await clIns.run(e, nowISO());
    },
    async customerLinkRow(email) { return (await clGet.get(em(email))) || null; },
    async dueCustomerLinks(limit = 25, at) {
      const t = at || nowISO();
      return clDue.all(t, t, Number(limit) || 25);
    },
    async claimCustomerLink(email, ms = CLAIM_MS) {
      const r = await clClaim.run(inISO(ms), em(email), nowISO());
      return r.changes === 1;
    },
    async releaseCustomerLink(email) { await clRelease.run(em(email)); },
    async markCustomerLinked(email, id, pushed) {
      const e = em(email);
      /* The snapshot only when a payload was actually sent. Passing nothing
         must not erase the snapshot a previous push stored. */
      await db.batch([
        clOk.bind(id == null ? null : String(id), nowISO(), e),
        pushed != null ? clSnap.bind(JSON.stringify(pushed), e) : null,
      ]);
    },
    /* What we last sent for this customer, or null when there is no usable
       snapshot — including a corrupt one, because "be conservative" is the
       correct behaviour for an unreadable discriminator, not a crash. */
    async customerPushSnapshot(email) {
      const row = await clSnapGet.get(em(email));
      if (!row || row.pushed_json == null) return null;
      try { return JSON.parse(row.pushed_json); } catch (e) { return null; }
    },
    async markCustomerLinkFailed(email, error, nextAttemptAt) {
      await clBad.run(String(error).slice(0, 500), nextAttemptAt || null, em(email));
    },
    pendingCustomerLinks: () => clPend.all(),
    failedCustomerLinks: () => clFail.all(),
    linkedCustomerCount: async () => (await clLinked.get()).c,
    async resetCustomerLink(email) { await clReset.run(em(email)); },

    /* ---- the guest outbox ----
       putGuestOrder / getGuestOrder / dropGuestOrder. The drop is the point:
       it runs as soon as Ecwid has the order, so a guest's name, phone and
       address normally sit on this server for a few seconds. */
    async putGuestOrder(order) {
      if (!order || !order.ref) throw new Error('putGuestOrder: no ref');
      await goPut.run(String(order.ref), order.createdAt || nowISO(), JSON.stringify(order));
    },
    async getGuestOrder(ref) {
      const r = await goGet.get(String(ref));
      if (!r) return null;
      try { return JSON.parse(r.data_json); } catch (e) { return null; }
    },
    async dropGuestOrder(ref) { await goDrop.run(String(ref)); },
    /* Everything still waiting. A non-empty list is a list of people whose
       order has not reached Ecwid — which is why the admin desk shows it. */
    async guestOrders() {
      return (await goAll.all()).map(r => {
        try { return JSON.parse(r.data_json); } catch (e) { return null; }
      }).filter(Boolean);
    },

    getState,
    async setState(key, value) {
      const put = putS.bind(key, JSON.stringify(value ?? null), nowISO());
      if (CATALOG_STATE_KEYS.has(key)) await db.batch([put, bump()]);
      else await db.batch([put]);
    },

    /* A lease on a whole job across instances. Resolves to an owner token
       when taken, null when someone else holds an unexpired one. */
    async acquireLease(name, ms = CLAIM_MS) {
      const owner = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const r = await lsTake.run('lease:' + name, JSON.stringify({ owner, until: inISO(ms) }), nowISO(), nowISO());
      return r.changes === 1 ? owner : null;
    },
    async releaseLease(name, owner) {
      if (owner) await lsDrop.run('lease:' + name, owner);
    },

    async stats() {
      const r = (await statsQ.get()) || {};
      const n = k => Number(r[k]) || 0;
      return {
        products: n('products'),
        enabled: n('enabled'),
        buyable: n('buyable'),
        categories: n('categories'),
        outOfStock: n('outOfStock'),
        discounted: n('discounted'),
        incomplete: n('incomplete'),
        withWeight: n('withWeight'),
        paymentMethods: n('paymentMethods'),
        shippingMethods: n('shippingMethods'),
        lastSync: await getState('last_sync'),
        lastError: await getState('last_error'),
      };
    },

    close: () => db.close(),
  };
}
