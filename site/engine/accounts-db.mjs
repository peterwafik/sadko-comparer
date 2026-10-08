/* ============================================================================
   SADKO account storage — libSQL (Turso hosted, or a local SQLite file).
   ----------------------------------------------------------------------------
   Replaces the JSON file the accounts module started on. That file was rewritten
   whole on every single change, which means: no transactions, a torn write if
   the process dies mid-save, no indexes, and two concurrent requests able to
   clobber each other's work. Fine for a prototype, not for customers' orders.

   This module is storage only — all the security decisions (scrypt hashing,
   session issuing, rate limiting, linking rules) stay in accounts.mjs. Keeping
   them apart means the security tests keep testing security, not SQL.

   Notes on the shape:
   • Talks to the database through engine/db.mjs, so the same code runs on a
     local file (dev, tests) and on hosted Turso (Vercel). Every method that
     touches the database returns a Promise.
   • Multi-statement writes are one `db.batch`, atomic and one round trip.
   • Hosted Turso does not keep `PRAGMA foreign_keys`, so the schema's
     ON DELETE CASCADE cannot be relied on: deleteUser removes the user's
     identities, homes, sessions and orders explicitly in the same batch.
   • Home profiles and order payloads are stored as JSON columns. They are
     read and written whole, never queried field-by-field, so a column per
     answer would be churn for nothing — but ids, emails and timestamps are
     real indexed columns because those ARE queried.
   • Schema changes go in MIGRATIONS, applied once and recorded, so an existing
     deployment upgrades itself on boot instead of needing a manual step.
   ========================================================================== */

import { existsSync, readFileSync, renameSync } from 'node:fs';
import { openDb, storeSpec } from './db.mjs';

const MIGRATIONS = [
  {
    id: 1,
    name: 'accounts base',
    sql: `
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      phone         TEXT DEFAULT '',
      address       TEXT,
      salt          TEXT,
      hash          TEXT,
      active_home   TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identities (
      provider   TEXT NOT NULL,
      subject    TEXT NOT NULL,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email      TEXT,
      linked_at  TEXT NOT NULL,
      PRIMARY KEY (provider, subject)
    );
    CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

    CREATE TABLE IF NOT EXISTS homes (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data_json  TEXT NOT NULL,
      created_at TEXT NOT NULL,
      position   INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS homes_user ON homes(user_id);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created    TEXT NOT NULL,
      expires    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user    ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);

    CREATE TABLE IF NOT EXISTS orders (
      ref        TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'received',
      subtotal   INTEGER NOT NULL DEFAULT 0,
      payment    TEXT,
      data_json  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at DESC);

    -- login throttling; rows are pruned by time, so a plain index is enough
    CREATE TABLE IF NOT EXISTS login_fails (
      key TEXT NOT NULL,
      at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fails_key ON login_fails(key, at);
    `,
  },
];

/* `file` is the local database path. When TURSO_DATABASE_URL is set the
   hosted database is used instead (storeSpec decides). */
export async function openAccountsDb(file) {
  const { spec, authToken } = storeSpec(file);
  const db = await openDb(spec, { authToken });
  await db.migrate('accounts', MIGRATIONS);

  const q = {
    userById:     db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail:  db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser:   db.prepare(`INSERT INTO users (id,email,name,phone,address,salt,hash,active_home,created_at)
                              VALUES (?,?,?,?,?,?,?,?,?)`),
    updateUser:   db.prepare(`UPDATE users SET name=?, phone=?, address=?, salt=?, hash=?, active_home=? WHERE id=?`),
    deleteUser:   db.prepare('DELETE FROM users WHERE id = ?'),
    allUsers:     db.prepare('SELECT * FROM users'),
    countUsers:   db.prepare('SELECT COUNT(*) AS n FROM users'),

    identByPair:  db.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?'),
    identsFor:    db.prepare('SELECT * FROM identities WHERE user_id = ?'),
    allIdents:    db.prepare('SELECT * FROM identities'),
    insertIdent:  db.prepare('INSERT OR REPLACE INTO identities (provider,subject,user_id,email,linked_at) VALUES (?,?,?,?,?)'),
    deleteIdents: db.prepare('DELETE FROM identities WHERE user_id = ?'),

    homesFor:     db.prepare('SELECT * FROM homes WHERE user_id = ? ORDER BY position, created_at'),
    allHomes:     db.prepare('SELECT * FROM homes ORDER BY position, created_at'),
    insertHome:   db.prepare('INSERT INTO homes (id,user_id,data_json,created_at,position) VALUES (?,?,?,?,?)'),
    // position = how many homes the user already has, computed inside the same statement
    appendHome:   db.prepare(`INSERT INTO homes (id,user_id,data_json,created_at,position)
                              VALUES (?,?,?,?,(SELECT COUNT(*) FROM homes WHERE user_id = ?))`),
    updateHome:   db.prepare('UPDATE homes SET data_json = ? WHERE id = ? AND user_id = ?'),
    deleteHome:   db.prepare('DELETE FROM homes WHERE id = ? AND user_id = ?'),
    deleteHomes:  db.prepare('DELETE FROM homes WHERE user_id = ?'),
    countHomes:   db.prepare('SELECT COUNT(*) AS n FROM homes WHERE user_id = ?'),

    insertSess:   db.prepare('INSERT INTO sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)'),
    sessByHash:   db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    deleteSess:   db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSs: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    pruneSess:    db.prepare('DELETE FROM sessions WHERE expires < ?'),
    countSess:    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires >= ?'),

    insertOrder:  db.prepare('INSERT INTO orders (ref,user_id,created_at,status,subtotal,payment,data_json) VALUES (?,?,?,?,?,?,?)'),
    ordersFor:    db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'),
    orderByRef:   db.prepare('SELECT * FROM orders WHERE user_id = ? AND ref = ?'),
    orderByRefAny:db.prepare('SELECT * FROM orders WHERE ref = ?'),
    allOrders:    db.prepare('SELECT * FROM orders ORDER BY created_at DESC'),
    orderCounts:  db.prepare('SELECT user_id, COUNT(*) AS n FROM orders GROUP BY user_id'),
    setOrderStat: db.prepare('UPDATE orders SET status = ?, data_json = ? WHERE ref = ?'),
    ordersSince:  db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(subtotal),0) AS rev FROM orders WHERE created_at > ?"),
    countOrders:  db.prepare('SELECT COUNT(*) AS n FROM orders'),
    deleteOrders: db.prepare('DELETE FROM orders WHERE user_id = ?'),

    addFail:      db.prepare('INSERT INTO login_fails (key,at) VALUES (?,?)'),
    dropFail:     db.prepare('DELETE FROM login_fails WHERE rowid = ?'),
    countFails:   db.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > ?'),
    clearFails:   db.prepare('DELETE FROM login_fails WHERE key = ?'),
    pruneFails:   db.prepare('DELETE FROM login_fails WHERE at < ?'),
  };

  const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
  const homeOf  = h => Object.assign(parse(h.data_json, {}), { id: h.id, createdAt: h.created_at });
  const identOf = i => ({ provider: i.provider, sub: i.subject, email: i.email, linkedAt: i.linked_at });

  /* Rows -> the object shapes accounts.mjs already works with. */
  function shape(row, homes, identities) {
    return {
      id: row.id, email: row.email, name: row.name, phone: row.phone || '',
      address: row.address, salt: row.salt, hash: row.hash,
      createdAt: row.created_at,
      activeHomeId: row.active_home,
      homes, identities,
    };
  }
  async function hydrate(row) {
    if (!row) return null;
    const [homes, idents] = await Promise.all([q.homesFor.all(row.id), q.identsFor.all(row.id)]);
    return shape(row, homes.map(homeOf), idents.map(identOf));
  }

  const homeStmt = (userId, home, position) => {
    const { id, createdAt, ...data } = home;
    return q.insertHome.bind(id, userId, JSON.stringify(data), createdAt || new Date().toISOString(), position || 0);
  };
  const orderStmt = o => q.insertOrder.bind(o.ref, o.userId, o.createdAt, o.status || 'received',
                                            Math.round(o.subtotal || 0), o.payment || null, JSON.stringify(o));

  const api = {
    /* ---- users ---- */
    getUser: async id => hydrate(await q.userById.get(id)),
    getUserByEmail: async email => hydrate(await q.userByEmail.get(email)),
    async createUser(u) {
      await db.batch([
        q.insertUser.bind(u.id, u.email, u.name, u.phone || '', u.address ?? null,
                          u.salt ?? null, u.hash ?? null, u.activeHomeId ?? null, u.createdAt),
        ...(u.homes || []).map((h, i) => homeStmt(u.id, h, i)),
        ...(u.identities || []).map(x => q.insertIdent.bind(x.provider, x.sub, u.id, x.email || null, x.linkedAt)),
      ]);
      return api.getUser(u.id);
    },
    async saveUser(u) {
      await q.updateUser.run(u.name, u.phone || '', u.address ?? null, u.salt ?? null, u.hash ?? null, u.activeHomeId ?? null, u.id);
      return api.getUser(u.id);
    },
    /* Everything attached to the user goes in the same atomic batch. No
       reliance on ON DELETE CASCADE: hosted Turso does not enforce it. */
    async deleteUser(id) {
      await db.batch([
        q.deleteIdents.bind(id),
        q.deleteHomes.bind(id),
        q.deleteUserSs.bind(id),
        q.deleteOrders.bind(id),
        q.deleteUser.bind(id),
      ]);
    },
    userCount: async () => (await q.countUsers.get()).n,
    /* Every user, hydrated, in three queries rather than two per user. */
    async allUsers() {
      const [users, homes, idents] = await Promise.all([q.allUsers.all(), q.allHomes.all(), q.allIdents.all()]);
      const hm = new Map(), im = new Map();
      for (const h of homes) { if (!hm.has(h.user_id)) hm.set(h.user_id, []); hm.get(h.user_id).push(homeOf(h)); }
      for (const i of idents) { if (!im.has(i.user_id)) im.set(i.user_id, []); im.get(i.user_id).push(identOf(i)); }
      return users.map(r => shape(r, hm.get(r.id) || [], im.get(r.id) || []));
    },
    async eachUser(fn) { (await api.allUsers()).forEach(fn); },

    /* ---- identities ---- */
    async userByIdentity(provider, sub) {
      const row = await q.identByPair.get(provider, sub);
      return row ? api.getUser(row.user_id) : null;
    },
    async linkIdentity(userId, ident) {
      await q.insertIdent.run(ident.provider, ident.sub, userId, ident.email || null, ident.linkedAt || new Date().toISOString());
    },

    /* ---- homes ---- */
    async addHome(userId, home) {
      const { id, createdAt, ...data } = home;
      await q.appendHome.run(id, userId, JSON.stringify(data), createdAt || new Date().toISOString(), userId);
      return home;
    },
    async updateHome(userId, homeId, home) {
      const { id, createdAt, ...data } = home;
      const r = await q.updateHome.run(JSON.stringify(data), homeId, userId);
      return r.changes > 0;
    },
    removeHome: async (userId, homeId) => (await q.deleteHome.run(homeId, userId)).changes > 0,
    homeCount: async userId => (await q.countHomes.get(userId)).n,

    /* ---- sessions ---- */
    async addSession(tokenHash, userId, created, expires) { await q.insertSess.run(tokenHash, userId, created, expires); },
    /* An expired row is never honoured, and is removed the moment it is seen,
       so it does not matter how long ago sweep() last ran. */
    async userForSession(tokenHash) {
      const s = await q.sessByHash.get(tokenHash);
      if (!s) return null;
      if (!(new Date(s.expires).getTime() >= Date.now())) { await q.deleteSess.run(tokenHash); return null; }
      return api.getUser(s.user_id);
    },
    dropSession: async tokenHash => (await q.deleteSess.run(tokenHash)).changes,
    dropUserSessions: async userId => (await q.deleteUserSs.run(userId)).changes,
    pruneSessions: async () => (await q.pruneSess.run(new Date().toISOString())).changes,
    sessionCount: async () => (await q.countSess.get(new Date().toISOString())).n,

    /* ---- orders ---- */
    async addOrder(o) { await q.insertOrder.run(...orderStmt(o).args); return o; },
    ordersFor: async userId => (await q.ordersFor.all(userId)).map(r => parse(r.data_json, {})),
    orderByRef: async (userId, ref) => { const r = await q.orderByRef.get(userId, ref); return r ? parse(r.data_json, {}) : null; },
    orderByRefAny: async ref => { const r = await q.orderByRefAny.get(ref); return r ? parse(r.data_json, {}) : null; },
    orderCount: async () => (await q.countOrders.get()).n,
    /* user id -> number of orders, in one query (admin customer list). */
    async orderCountsByUser() {
      return new Map((await q.orderCounts.all()).map(r => [r.user_id, r.n]));
    },
    // admin: every order, regardless of owner (for the owner's order desk)
    allOrders: async () => (await q.allOrders.all()).map(r => parse(r.data_json, {})),
    async setOrderStatus(ref, status) {
      const r = await q.orderByRefAny.get(ref);
      if (!r) return null;
      const o = parse(r.data_json, {}); o.status = status;
      await q.setOrderStat.run(status, JSON.stringify(o), ref);
      return o;
    },
    ordersSince: iso => q.ordersSince.get(iso),

    /* ---- login throttling ----
       Only rows inside the window are counted, so stale rows that sweep()
       has not removed yet change nothing. */
    failCount: async (key, windowMs) => (await q.countFails.get(key, Date.now() - windowMs)).n,
    /* Returns the new row's id so a caller can withdraw it (see dropFail). */
    addFail: async key => (await q.addFail.run(key, Date.now())).lastInsertRowid,
    dropFail: async rowid => { if (rowid != null) await q.dropFail.run(rowid); },
    clearFails: async key => { await q.clearFails.run(key); },
    pruneFails: async windowMs => (await q.pruneFails.run(Date.now() - windowMs)).changes,

    close: () => db.close(),
    raw: db,
  };

  return api;
}

/* One-time import of the old JSON file, so an existing deployment keeps its
   customers. The file is renamed to *.migrated rather than deleted — if
   anything looks wrong the original is still on disk.

   Only meaningful for a local store: on Vercel (TURSO_DATABASE_URL set) there
   is no legacy file to read, so this does nothing at all. */
export async function importLegacyJson(api, jsonFile) {
  if (process.env.TURSO_DATABASE_URL) return { imported: 0, skipped: 'hosted' };
  if (!existsSync(jsonFile)) return { imported: 0 };
  let data;
  try { data = JSON.parse(readFileSync(jsonFile, 'utf8')); }
  catch { return { imported: 0, error: 'unreadable' }; }
  if (await api.userCount() > 0) return { imported: 0, skipped: 'db-not-empty' };

  let n = 0;
  for (const u of (data.users || [])) {
    try {
      const homes = Array.isArray(u.homes) ? u.homes
        : (u.profile && Object.keys(u.profile).length ? [Object.assign({ id: 'h' + Math.random().toString(36).slice(2, 10), name: 'بيتى', createdAt: u.createdAt }, u.profile)] : []);
      await api.createUser({
        id: u.id, email: u.email, name: u.name, phone: u.phone, address: u.address,
        salt: u.salt, hash: u.hash, createdAt: u.createdAt || new Date().toISOString(),
        activeHomeId: u.activeHomeId || (homes[0] && homes[0].id) || null,
        homes, identities: u.identities || [],
      });
      n++;
    } catch (e) { /* skip a corrupt row rather than abort the whole import */ }
  }
  for (const o of (data.orders || [])) {
    try { await api.addOrder(o); } catch (e) {}
  }
  try { renameSync(jsonFile, jsonFile + '.migrated'); } catch (e) {}
  return { imported: n, orders: (data.orders || []).length };
}
