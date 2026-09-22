/* ============================================================================
   The Ecwid mirror — products, categories, payment and shipping methods, and
   sync state. Same discipline as engine/accounts.mjs and
   engine/catalog-admin.mjs: node:sqlite, WAL, numbered migrations, prepared
   statements, one transaction per batch.

   This is a CACHE of someone else's data, so deleting the file and re-syncing
   is always safe. The one thing it must never do is empty ITSELF because a
   sync went wrong — hence the empty-keep-set guard in deleteMissingProducts.

   Rows are stored as JSON documents rather than columns. The Ecwid shape is
   theirs to change, the mapper already normalises it, and the storefront reads
   whole products; splitting 18 fields into columns would buy nothing and cost
   a migration every time Ecwid adds one. The few things that need querying
   (counts, stock, discounts) are counted in SQL over json_extract.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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
}];

const nowISO = () => new Date().toISOString();

export function openEcwidStore(file) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(m.id, m.name, nowISO());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

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

  const cntP = db.prepare('SELECT COUNT(*) c FROM products');
  const cntC = db.prepare('SELECT COUNT(*) c FROM categories');
  const cntEnabled = db.prepare("SELECT COUNT(*) c FROM products WHERE json_extract(data_json,'$.enabled') = 1");
  /* Scoped to ENABLED products on purpose. The 463 disabled shells have no
     stock tracking, so they default to in-stock; counting them would make the
     out-of-stock figure meaningless. What matters is: of the products a
     customer could see, how many cannot be bought. */
  const cntOos = db.prepare(
    "SELECT COUNT(*) c FROM products " +
    "WHERE json_extract(data_json,'$.enabled') = 1 AND json_extract(data_json,'$.inStock') = 0");
  const cntBuyable = db.prepare(
    "SELECT COUNT(*) c FROM products " +
    "WHERE json_extract(data_json,'$.enabled') = 1 AND json_extract(data_json,'$.inStock') = 1");
  const cntDisc = db.prepare("SELECT COUNT(*) c FROM products WHERE json_extract(data_json,'$.compareToPrice') IS NOT NULL");
  const cntIncomplete = db.prepare("SELECT COUNT(*) c FROM products WHERE json_extract(data_json,'$.incomplete') = 1");
  /* How many products carry a real weight. It is 0 of 1,453 in the live store,
     which is one of the two reasons delivery cannot be quoted — so it is
     COUNTED rather than assumed, and the gate in ecwid-shipping.mjs opens by
     itself once staff start entering weights. */
  const cntWeight = db.prepare("SELECT COUNT(*) c FROM products WHERE json_extract(data_json,'$.weight') > 0");

  /* ---- order push queue ----
     An order is written locally FIRST and only then queued here, so a push
     that never succeeds costs visibility, never the order itself. */
  const MAX_ATTEMPTS = 6;
  const pqIns = db.prepare('INSERT INTO order_push (ref, attempts, next_attempt_at, created_at) VALUES (?,0,NULL,?) ' +
                           'ON CONFLICT(ref) DO NOTHING');
  const pqGet = db.prepare('SELECT * FROM order_push WHERE ref = ?');
  const pqDue = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts < ' + MAX_ATTEMPTS +
                           ' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 1');
  const pqOk = db.prepare('UPDATE order_push SET ecwid_order_id = ?, pushed_at = ?, last_error = NULL WHERE ref = ?');
  const pqBad = db.prepare('UPDATE order_push SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE ref = ?');
  const pqPend = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts < ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const pqFail = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts >= ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const pqReset = db.prepare('UPDATE order_push SET next_attempt_at = NULL WHERE ref = ?');
  /* The orders that actually reached Ecwid, newest first. Only these have an
     Ecwid id to ask about, and only Ecwid can say what staff did to them
     after the push. */
  /* INSERT OR IGNORE, not REPLACE: re-enqueueing an email that is already
     linked must not wipe its ecwid_customer_id and make it look unlinked. */
  const clIns  = db.prepare('INSERT OR IGNORE INTO customer_link (email, created_at, attempts) VALUES (?,?,0)');
  const clGet  = db.prepare('SELECT * FROM customer_link WHERE email = ?');
  const clDue  = db.prepare('SELECT * FROM customer_link WHERE linked_at IS NULL AND attempts < ' + MAX_ATTEMPTS
    + ' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?');
  const clOk   = db.prepare('UPDATE customer_link SET ecwid_customer_id = ?, linked_at = ?, last_error = NULL WHERE email = ?');
  const clBad  = db.prepare('UPDATE customer_link SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE email = ?');
  const clPend = db.prepare('SELECT * FROM customer_link WHERE linked_at IS NULL AND attempts < ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const clFail = db.prepare('SELECT * FROM customer_link WHERE linked_at IS NULL AND attempts >= ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const clReset = db.prepare('UPDATE customer_link SET attempts = 0, next_attempt_at = NULL WHERE email = ?');
  const clLinked = db.prepare('SELECT COUNT(*) c FROM customer_link WHERE linked_at IS NOT NULL');
  const goPut  = db.prepare('INSERT OR REPLACE INTO guest_order (ref, created_at, data_json) VALUES (?,?,?)');
  const goGet  = db.prepare('SELECT * FROM guest_order WHERE ref = ?');
  const goDrop = db.prepare('DELETE FROM guest_order WHERE ref = ?');
  const goAll  = db.prepare('SELECT * FROM guest_order ORDER BY created_at');
  const pqPushed = db.prepare('SELECT * FROM order_push WHERE ecwid_order_id IS NOT NULL '
    + 'ORDER BY pushed_at DESC LIMIT ?');

  const parse = rows => rows.map(r => JSON.parse(r.data_json));
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id));

  /* One transaction per batch: a 1,453-product sync is a single commit, not
     1,453 of them. */
  function bulk(stmt, rows) {
    if (!Array.isArray(rows) || !rows.length) return { written: 0 };
    const at = nowISO();
    db.exec('BEGIN');
    try {
      for (const r of rows) stmt.run(String(r.id), JSON.stringify(r), at);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { written: rows.length };
  }

  /* Payment and shipping are REPLACED wholesale, not merged: a method the
     owner disabled in Ecwid must stop being offered at checkout, and a merge
     would leave it behind for ever. */
  function replaceAll(table, stmt, rows) {
    const at = nowISO();
    db.exec('BEGIN');
    try {
      db.exec(`DELETE FROM ${table}`);
      for (const r of rows || []) stmt.run(String(r.id), JSON.stringify(r), at);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { written: (rows || []).length };
  }

  return {
    upsertProducts: rows => bulk(putP, rows),
    upsertCategories: rows => bulk(putC, rows),
    upsertPaymentMethods: rows => replaceAll('payment_methods', putPay, rows),
    upsertShippingMethods: rows => replaceAll('shipping_methods', putShip, rows),

    deleteProduct: id => { delP.run(String(id)); },

    /* Called by the daily reconcile. An empty keep-set means the API call that
       produced it failed or returned nothing — obeying it would wipe the
       catalogue, so refuse loudly instead. */
    deleteMissingProducts(keep) {
      if (!keep || typeof keep.has !== 'function' || !keep.size)
        throw new Error('refusing to reconcile against an empty keep-set');
      const gone = idsP.all().map(r => String(r.id)).filter(id => !keep.has(id));
      if (!gone.length) return { removed: 0 };
      db.exec('BEGIN');
      try { for (const id of gone) delP.run(id); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return { removed: gone.length };
    },

    allProducts: () => parse(allP.all()),
    allCategories: () => parse(allC.all()).sort(byOrder),
    allPaymentMethods: () => parse(allPay.all()).sort(byOrder),
    allShippingMethods: () => parse(allShip.all()).sort(byOrder),
    productIds: () => new Set(idsP.all().map(r => String(r.id))),

    MAX_PUSH_ATTEMPTS: MAX_ATTEMPTS,
    enqueueOrderPush(ref) { pqIns.run(String(ref), nowISO()); },
    pushRow(ref) { return pqGet.get(String(ref)) || null; },
    nextDuePush(at) { return pqDue.get(at || nowISO()) || null; },
    markPushed(ref, ecwidOrderId) { pqOk.run(String(ecwidOrderId), nowISO(), String(ref)); },
    markPushFailed(ref, error, nextAttemptAt) {
      pqBad.run(String(error).slice(0, 500), nextAttemptAt || null, String(ref));
    },
    pendingPushes: () => pqPend.all(),
    failedPushes: () => pqFail.all(),
    resetPush(ref) { pqReset.run(String(ref)); },
    pushedOrders: (limit = 200) => pqPushed.all(Number(limit) || 200),

    /* ---- the guest outbox ----
       putGuestOrder / getGuestOrder / dropGuestOrder. The drop is the point:
       it runs as soon as Ecwid has the order, so a guest's name, phone and
       address normally sit on this server for a few seconds. */
    /* ---- the customer link queue ----
       Emails are the key, so they are normalised here rather than trusting
       every caller to remember. */
    enqueueCustomerLink(email) {
      const em = String(email || '').trim().toLowerCase();
      if (!em) return;
      clIns.run(em, nowISO());
    },
    customerLinkRow(email) { return clGet.get(String(email || '').trim().toLowerCase()) || null; },
    dueCustomerLinks(limit = 25, at) { return clDue.all(at || nowISO(), Number(limit) || 25); },
    markCustomerLinked(email, id) {
      clOk.run(id == null ? null : String(id), nowISO(), String(email || '').trim().toLowerCase());
    },
    markCustomerLinkFailed(email, error, nextAttemptAt) {
      clBad.run(String(error).slice(0, 500), nextAttemptAt || null, String(email || '').trim().toLowerCase());
    },
    pendingCustomerLinks: () => clPend.all(),
    failedCustomerLinks: () => clFail.all(),
    linkedCustomerCount: () => clLinked.get().c,
    resetCustomerLink(email) { clReset.run(String(email || '').trim().toLowerCase()); },

    putGuestOrder(order) {
      if (!order || !order.ref) throw new Error('putGuestOrder: no ref');
      goPut.run(String(order.ref), order.createdAt || nowISO(), JSON.stringify(order));
    },
    getGuestOrder(ref) {
      const r = goGet.get(String(ref));
      if (!r) return null;
      try { return JSON.parse(r.data_json); } catch (e) { return null; }
    },
    dropGuestOrder(ref) { goDrop.run(String(ref)); },
    /* Everything still waiting. A non-empty list is a list of people whose
       order has not reached Ecwid — which is why the admin desk shows it. */
    guestOrders() {
      return goAll.all().map(r => {
        try { return JSON.parse(r.data_json); } catch (e) { return null; }
      }).filter(Boolean);
    },

    getState(key) {
      const r = getS.get(key);
      if (!r) return null;
      try { return JSON.parse(r.value_json); } catch { return null; }
    },
    setState(key, value) { putS.run(key, JSON.stringify(value ?? null), nowISO()); },

    stats() {
      return {
        products: cntP.get().c,
        enabled: cntEnabled.get().c,
        buyable: cntBuyable.get().c,
        categories: cntC.get().c,
        outOfStock: cntOos.get().c,
        discounted: cntDisc.get().c,
        incomplete: cntIncomplete.get().c,
        withWeight: cntWeight.get().c,
        paymentMethods: allPay.all().length,
        shippingMethods: allShip.all().length,
        lastSync: this.getState('last_sync'),
        lastError: this.getState('last_error'),
      };
    },

    close: () => { try { db.close(); } catch (e) {} },
  };
}
