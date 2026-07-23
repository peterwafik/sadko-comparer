/* ============================================================================
   SADKO account storage — SQLite.
   ----------------------------------------------------------------------------
   Replaces the JSON file the accounts module started on. That file was rewritten
   whole on every single change, which means: no transactions, a torn write if
   the process dies mid-save, no indexes, and two concurrent requests able to
   clobber each other's work. Fine for a prototype, not for customers' orders.

   This module is storage only — all the security decisions (scrypt hashing,
   session issuing, rate limiting, linking rules) stay in accounts.mjs. Keeping
   them apart means the security tests keep testing security, not SQL.

   Notes on the shape:
   • `node:sqlite` ships with Node 24, so this adds no dependency.
   • WAL + `foreign_keys` on. Sessions and homes cascade with their user, so
     deleting an account genuinely removes everything attached to it.
   • Home profiles and order payloads are stored as JSON columns. They are
     read and written whole, never queried field-by-field, so a column per
     answer would be churn for nothing — but ids, emails and timestamps are
     real indexed columns because those ARE queried.
   • Schema changes go in MIGRATIONS, applied once and recorded, so an existing
     deployment upgrades itself on boot instead of needing a manual step.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

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

export function openAccountsDb(file) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)');

  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)')
        .run(m.id, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

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
    insertIdent:  db.prepare('INSERT OR REPLACE INTO identities (provider,subject,user_id,email,linked_at) VALUES (?,?,?,?,?)'),

    homesFor:     db.prepare('SELECT * FROM homes WHERE user_id = ? ORDER BY position, created_at'),
    homeById:     db.prepare('SELECT * FROM homes WHERE id = ? AND user_id = ?'),
    insertHome:   db.prepare('INSERT INTO homes (id,user_id,data_json,created_at,position) VALUES (?,?,?,?,?)'),
    updateHome:   db.prepare('UPDATE homes SET data_json = ? WHERE id = ? AND user_id = ?'),
    deleteHome:   db.prepare('DELETE FROM homes WHERE id = ? AND user_id = ?'),
    countHomes:   db.prepare('SELECT COUNT(*) AS n FROM homes WHERE user_id = ?'),

    insertSess:   db.prepare('INSERT INTO sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)'),
    sessByHash:   db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    deleteSess:   db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSs: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    pruneSess:    db.prepare('DELETE FROM sessions WHERE expires < ?'),
    countSess:    db.prepare('SELECT COUNT(*) AS n FROM sessions'),

    insertOrder:  db.prepare('INSERT INTO orders (ref,user_id,created_at,status,subtotal,payment,data_json) VALUES (?,?,?,?,?,?,?)'),
    ordersFor:    db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'),
    orderByRef:   db.prepare('SELECT * FROM orders WHERE user_id = ? AND ref = ?'),
    orderByRefAny:db.prepare('SELECT * FROM orders WHERE ref = ?'),
    allOrders:    db.prepare('SELECT * FROM orders ORDER BY created_at DESC'),
    setOrderStat: db.prepare('UPDATE orders SET status = ?, data_json = ? WHERE ref = ?'),
    ordersSince:  db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(subtotal),0) AS rev FROM orders WHERE created_at > ?"),
    countOrders:  db.prepare('SELECT COUNT(*) AS n FROM orders'),

    addFail:      db.prepare('INSERT INTO login_fails (key,at) VALUES (?,?)'),
    countFails:   db.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > ?'),
    clearFails:   db.prepare('DELETE FROM login_fails WHERE key = ?'),
    pruneFails:   db.prepare('DELETE FROM login_fails WHERE at < ?'),
  };

  const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

  /* Rows -> the object shapes accounts.mjs already works with. */
  function hydrate(row) {
    if (!row) return null;
    const homes = q.homesFor.all(row.id).map(h => Object.assign(parse(h.data_json, {}), { id: h.id, createdAt: h.created_at }));
    return {
      id: row.id, email: row.email, name: row.name, phone: row.phone || '',
      address: row.address, salt: row.salt, hash: row.hash,
      createdAt: row.created_at,
      activeHomeId: row.active_home,
      homes,
      identities: q.identsFor.all(row.id).map(i => ({ provider: i.provider, sub: i.subject, email: i.email, linkedAt: i.linked_at })),
    };
  }

  const api = {
    /* ---- users ---- */
    getUser: id => hydrate(q.userById.get(id)),
    getUserByEmail: email => hydrate(q.userByEmail.get(email)),
    createUser(u) {
      db.exec('BEGIN');
      try {
        q.insertUser.run(u.id, u.email, u.name, u.phone || '', u.address ?? null,
                         u.salt ?? null, u.hash ?? null, u.activeHomeId ?? null, u.createdAt);
        (u.homes || []).forEach((h, i) => api._putHome(u.id, h, i));
        (u.identities || []).forEach(x => q.insertIdent.run(x.provider, x.sub, u.id, x.email || null, x.linkedAt));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return api.getUser(u.id);
    },
    saveUser(u) {
      q.updateUser.run(u.name, u.phone || '', u.address ?? null, u.salt ?? null, u.hash ?? null, u.activeHomeId ?? null, u.id);
      return api.getUser(u.id);
    },
    deleteUser: id => { q.deleteUser.run(id); },          // cascades to homes/sessions/orders/identities
    userCount: () => q.countUsers.get().n,
    eachUser: fn => q.allUsers.all().forEach(r => fn(hydrate(r))),

    /* ---- identities ---- */
    userByIdentity(provider, sub) {
      const row = q.identByPair.get(provider, sub);
      return row ? api.getUser(row.user_id) : null;
    },
    linkIdentity(userId, ident) {
      q.insertIdent.run(ident.provider, ident.sub, userId, ident.email || null, ident.linkedAt || new Date().toISOString());
    },

    /* ---- homes ---- */
    _putHome(userId, home, position) {
      const { id, createdAt, ...data } = home;
      q.insertHome.run(id, userId, JSON.stringify(data), createdAt || new Date().toISOString(), position || 0);
    },
    addHome(userId, home) {
      const n = q.countHomes.get(userId).n;
      api._putHome(userId, home, n);
      return home;
    },
    updateHome(userId, homeId, home) {
      const { id, createdAt, ...data } = home;
      const r = q.updateHome.run(JSON.stringify(data), homeId, userId);
      return r.changes > 0;
    },
    removeHome(userId, homeId) { return q.deleteHome.run(homeId, userId).changes > 0; },
    homeCount: userId => q.countHomes.get(userId).n,

    /* ---- sessions ---- */
    addSession(tokenHash, userId, created, expires) { q.insertSess.run(tokenHash, userId, created, expires); },
    userForSession(tokenHash) {
      const s = q.sessByHash.get(tokenHash);
      if (!s) return null;
      if (new Date(s.expires).getTime() < Date.now()) { q.deleteSess.run(tokenHash); return null; }
      return api.getUser(s.user_id);
    },
    dropSession: tokenHash => q.deleteSess.run(tokenHash).changes,
    dropUserSessions: userId => q.deleteUserSs.run(userId).changes,
    pruneSessions: () => q.pruneSess.run(new Date().toISOString()).changes,
    sessionCount: () => q.countSess.get().n,

    /* ---- orders ---- */
    addOrder(o) {
      q.insertOrder.run(o.ref, o.userId, o.createdAt, o.status || 'received',
                        Math.round(o.subtotal || 0), o.payment || null, JSON.stringify(o));
      return o;
    },
    ordersFor: userId => q.ordersFor.all(userId).map(r => parse(r.data_json, {})),
    orderByRef: (userId, ref) => { const r = q.orderByRef.get(userId, ref); return r ? parse(r.data_json, {}) : null; },
    orderCount: () => q.countOrders.get().n,
    // admin: every order, regardless of owner (for the owner's order desk)
    allOrders: () => q.allOrders.all().map(r => parse(r.data_json, {})),
    setOrderStatus: (ref, status) => {
      const r = q.orderByRefAny.get(ref);
      if (!r) return null;
      const o = parse(r.data_json, {}); o.status = status;
      q.setOrderStat.run(status, JSON.stringify(o), ref);
      return o;
    },
    ordersSince: iso => q.ordersSince.get(iso),

    /* ---- login throttling ---- */
    failCount: (key, windowMs) => q.countFails.get(key, Date.now() - windowMs).n,
    addFail: key => q.addFail.run(key, Date.now()),
    clearFails: key => q.clearFails.run(key),
    pruneFails: windowMs => q.pruneFails.run(Date.now() - windowMs).changes,

    close: () => db.close(),
    raw: db,
  };

  return api;
}

/* One-time import of the old JSON file, so an existing deployment keeps its
   customers. The file is renamed to *.migrated rather than deleted — if
   anything looks wrong the original is still on disk. */
export function importLegacyJson(api, jsonFile) {
  if (!existsSync(jsonFile)) return { imported: 0 };
  let data;
  try { data = JSON.parse(readFileSync(jsonFile, 'utf8')); }
  catch { return { imported: 0, error: 'unreadable' }; }
  if (api.userCount() > 0) return { imported: 0, skipped: 'db-not-empty' };

  let n = 0;
  for (const u of (data.users || [])) {
    try {
      const homes = Array.isArray(u.homes) ? u.homes
        : (u.profile && Object.keys(u.profile).length ? [Object.assign({ id: 'h' + Math.random().toString(36).slice(2, 10), name: 'بيتى', createdAt: u.createdAt }, u.profile)] : []);
      api.createUser({
        id: u.id, email: u.email, name: u.name, phone: u.phone, address: u.address,
        salt: u.salt, hash: u.hash, createdAt: u.createdAt || new Date().toISOString(),
        activeHomeId: u.activeHomeId || (homes[0] && homes[0].id) || null,
        homes, identities: u.identities || [],
      });
      n++;
    } catch (e) { /* skip a corrupt row rather than abort the whole import */ }
  }
  for (const o of (data.orders || [])) {
    try { api.addOrder(o); } catch (e) {}
  }
  try { renameSync(jsonFile, jsonFile + '.migrated'); } catch (e) {}
  return { imported: n, orders: (data.orders || []).length };
}
