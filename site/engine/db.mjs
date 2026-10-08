/* ============================================================================
   SADKO database layer: one async API over libSQL, local or hosted.
   ----------------------------------------------------------------------------
   The stores (accounts, ecwid mirror, catalogue overlay, analytics) used
   node:sqlite's DatabaseSync, which needs a disk that outlives the process.
   Vercel functions have none, so the data now lives in Turso (hosted libSQL,
   SQLite's own dialect) and every store talks to it through this file:

       const db = await openDb(url, { authToken });
       await db.migrate('accounts', MIGRATIONS);
       const byId = db.prepare('SELECT * FROM users WHERE id = ?');
       const row  = await byId.get(id);              // plain object or undefined
       await db.batch([ins.bind(a, b), upd.bind(c)]); // atomic, one round trip

   URL forms:
     libsql://<db>.turso.io   hosted (production; needs authToken)
     file:/abs/path.db        local file (dev server, the old data/*.db files)
     :memory:                 throw-away (tests)

   Two libSQL behaviours this layer exists to hide:
   • `client.transaction()` opens a SEPARATE connection, which for :memory:
     is an empty database. Every multi-statement write here is therefore a
     `batch(…, 'write')`: atomic, and one network round trip on Turso.
   • A hosted connection does not keep `PRAGMA foreign_keys` between
     requests, so no store may rely on ON DELETE CASCADE; deletes that must
     reach child rows delete them explicitly in the same batch.

   Rows come back as plain objects (column → value), never libSQL Row
   instances, so JSON.stringify and spreading behave like they did before.
   ========================================================================== */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const plain = (rs) => rs.rows.map(r => {
  const o = {};
  for (const c of rs.columns) o[c] = r[c];
  return o;
});

const toArgs = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/* A local path becomes a file: URL; anything with a scheme passes through. */
export function dbUrl(spec) {
  if (!spec || spec === ':memory:') return ':memory:';
  if (/^[a-z]+:/i.test(spec) && !/^[a-z]:[\\/]/i.test(spec)) return spec;   // libsql:, file:, http(s): — not "D:\…"
  const abs = path.resolve(spec);
  mkdirSync(path.dirname(abs), { recursive: true });
  return 'file:' + abs.replace(/\\/g, '/');
}

export async function openDb(spec, { authToken } = {}) {
  const url = dbUrl(spec);
  const local = !url.startsWith('libsql:') && !url.startsWith('http');
  /* A hosted database goes through the pure-JavaScript client (HTTP), which
     needs no native binary, so it runs on any serverless platform. Only a
     local file or :memory: loads the native engine. */
  const { createClient } = local ? await import('@libsql/client') : await import('@libsql/client/web');
  const client = createClient(local ? { url, intMode: 'number' } : { url, authToken, intMode: 'number' });
  if (local) {
    // Same settings the DatabaseSync stores used; harmless to repeat.
    await client.execute('PRAGMA foreign_keys = ON');
    if (url !== ':memory:') await client.execute('PRAGMA busy_timeout = 5000');
  }

  const exec1 = (sql, args) => client.execute({ sql, args: toArgs(args) });

  const db = {
    url, local, client,

    prepare(sql) {
      return {
        sql,
        get: async (...a) => plain(await exec1(sql, a))[0],
        all: async (...a) => plain(await exec1(sql, a)),
        run: async (...a) => {
          const rs = await exec1(sql, a);
          return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
        },
        bind: (...a) => ({ sql, args: toArgs(a) }),
      };
    },

    /* Several statements separated by ';' (schema, migrations). */
    exec: (sql) => client.executeMultiple(sql),

    /* Atomic write of bound statements ({sql,args} or plain SQL strings). */
    async batch(stmts) {
      const list = stmts.filter(Boolean);
      if (!list.length) return [];
      const out = await client.batch(list, 'write');
      return out.map(rs => ({ changes: rs.rowsAffected }));
    },

    /* Numbered migrations, recorded per store in `<name>_migrations`, so all
       four stores can share ONE hosted database without colliding. A local
       file made by the old DatabaseSync code recorded them in
       `schema_migrations`; those rows are adopted once so nothing re-runs. */
    async migrate(name, migrations) {
      const table = `${name}_migrations`;
      await client.execute(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`);
      let applied = new Set((await db.prepare(`SELECT id FROM ${table}`).all()).map(r => r.id));
      if (!applied.size && local) {
        const legacy = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
        if (legacy) {
          const rows = await db.prepare('SELECT * FROM schema_migrations').all();
          await db.batch(rows.map(r => ({ sql: `INSERT OR IGNORE INTO ${table} (id, name, applied_at) VALUES (?,?,?)`,
                                          args: [r.id, r.name ?? null, r.applied_at ?? null] })));
          applied = new Set(rows.map(r => r.id));
        }
      }
      for (const m of migrations) {
        if (applied.has(m.id)) continue;
        // executeMultiple is not atomic on its own; split so the batch is.
        const parts = splitSql(m.sql);
        await db.batch([...parts, { sql: `INSERT INTO ${table} (id, name, applied_at) VALUES (?,?,?)`,
                                    args: [m.id, m.name ?? null, new Date().toISOString()] }]);
      }
    },

    close() { try { client.close(); } catch (e) {} },
  };
  return db;
}

/* Split a migration script into statements. Migrations here are plain DDL/DML
   with no triggers, so a ';' outside quotes ends a statement. */
export function splitSql(sql) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; cur += '\n'; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* Where the stores live. On Vercel (or anywhere TURSO_DATABASE_URL is set)
   every store shares the hosted database; otherwise each keeps its own file
   under data/, exactly as before. */
export function storeSpec(localFile) {
  const { url, authToken } = tursoEnv();
  return url ? { spec: url, authToken } : { spec: localFile };
}

/* The hosted database's credentials. Vercel's Turso integration may add a
   prefix to the variable names (this project's is SADKO_), so both the plain
   and the prefixed names are accepted. */
export function tursoEnv(env = process.env) {
  return {
    url: env.TURSO_DATABASE_URL || env.SADKO_TURSO_DATABASE_URL || null,
    authToken: env.TURSO_AUTH_TOKEN || env.SADKO_TURSO_AUTH_TOKEN || undefined,
  };
}
