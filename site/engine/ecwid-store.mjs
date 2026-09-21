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
        paymentMethods: allPay.all().length,
        shippingMethods: allShip.all().length,
        lastSync: this.getState('last_sync'),
        lastError: this.getState('last_error'),
      };
    },

    close: () => { try { db.close(); } catch (e) {} },
  };
}
