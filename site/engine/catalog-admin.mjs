/* ============================================================================
   SADKO site admin store: what only the WEBSITE has, which Ecwid cannot hold.

     • settings   — site-wide values (hotline, announcement, maintenance, ad folder ids)
     • audit      — an append-only log of who changed what, when
     • content    — editorial JSON (guides, finder, scenes), served in place of
                    the bundled data/<name>.json
     • uploads    — images for that content (bytes)

   It used to also keep a product OVERLAY (edited prices, hand-added items,
   hidden flags) on top of the catalogue. That duplicated Ecwid and is retired:
   the admin portal writes products to Ecwid, the shop serves Ecwid as is, and
   any rows left in overrides / custom / hidden are only listed (leftovers())
   so the owner can discard them.

   Storage is libSQL through engine/db.mjs: a local file in dev, Turso on
   Vercel (no writable disk there, which is why content and uploads moved
   in here). Every method that touches the database returns a Promise.
   ========================================================================== */

import { openDb, storeSpec } from './db.mjs';

const MIGRATIONS = [{
  id: 1, name: 'catalog-admin base',
  sql: `
  CREATE TABLE IF NOT EXISTS overrides (
    id TEXT PRIMARY KEY, patch_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS custom (
    id TEXT PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT
  );
  CREATE TABLE IF NOT EXISTS hidden (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, by TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT, detail_json TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_at ON audit(at DESC);
  `,
}, {
  id: 2, name: 'catalog-admin content',
  sql: `
  CREATE TABLE IF NOT EXISTS content (
    name TEXT PRIMARY KEY, json_text TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
  );
  `,
}, {
  id: 3, name: 'catalog-admin uploads',
  sql: `
  CREATE TABLE IF NOT EXISTS uploads (
    name TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL,
    created_at TEXT NOT NULL, created_by TEXT
  );
  `,
}];

/* Upload rules: the server generates the name ('p' + base36 + extension), so
   anything else is refused outright; the size cap matches the old disk route. */
export const UPLOAD_NAME_RE = /^p[a-z0-9]+\.(png|jpg|webp|gif|avif)$/;
export const UPLOAD_MAX_BYTES = 4_500_000;
const UPLOAD_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
export const CONTENT_NAME_RE = /^[a-z0-9_-]{1,60}$/;

const fail = (code, message) => Object.assign(new Error(message || code), { code });

export async function openCatalogAdmin(file) {
  const { spec, authToken } = storeSpec(file);
  const db = await openDb(spec, { authToken });
  await db.migrate('catalog_admin', MIGRATIONS);

  const q = {
    /* Read-only: the retired overlay is listed for discarding, never written. */
    allOverrides: db.prepare('SELECT * FROM overrides'),
    allCustom:    db.prepare('SELECT * FROM custom'),
    allHidden:    db.prepare('SELECT id FROM hidden'),
    allSettings:  db.prepare('SELECT * FROM settings'),
    getSetting:   db.prepare('SELECT value_json FROM settings WHERE key = ?'),
    putSetting:   db.prepare('INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at'),
    addAudit:     db.prepare('INSERT INTO audit (at,actor,action,target,detail_json) VALUES (?,?,?,?,?)'),
    recentAudit:  db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    getContent:   db.prepare('SELECT json_text FROM content WHERE name = ?'),
    putContent:   db.prepare('INSERT INTO content (name,json_text,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET json_text=excluded.json_text, updated_at=excluded.updated_at, updated_by=excluded.updated_by'),
    putUpload:    db.prepare('INSERT INTO uploads (name,mime,size,bytes,created_at,created_by) VALUES (?,?,?,?,?,?)'),
    getUpload:    db.prepare('SELECT mime, bytes, created_at FROM uploads WHERE name = ?'),
  };
  const parse = (s, f) => { try { return JSON.parse(s); } catch { return f; } };
  const now = () => new Date().toISOString();

  const api = {
    /* ---- read ---- */
    async overridesMap() { const m = {}; (await q.allOverrides.all()).forEach(r => m[r.id] = parse(r.patch_json, {})); return m; },
    async customList() { return (await q.allCustom.all()).map(r => Object.assign(parse(r.data_json, {}), { id: r.id, _custom: true })); },
    async hiddenSet() { return new Set((await q.allHidden.all()).map(r => r.id)); },

    /* ---- leftovers of the retired product overlay ----
       Product edits, hand-added items and hidden flags used to be stored
       here, duplicating Ecwid. Nothing writes them any more and the shop no
       longer reads them; what is left is listed in the admin portal so the
       owner can carry anything still wanted over to Ecwid, then discard it. */
    async leftovers() {
      const [ov, custom, hidden, promos] = await Promise.all([api.overridesMap(), api.customList(), api.hiddenSet(), q.getContent.get('promos')]);
      return {
        overrides: Object.entries(ov).map(([id, patch]) => ({ id, patch })),
        custom: custom.map(c => ({ id: c.id, title: c.title || '', price: c.price ?? null })),
        hidden: [...hidden],
        promos: !!promos,
      };
    },
    async discard(kind, actor) {
      const sql = { overrides: 'DELETE FROM overrides', custom: 'DELETE FROM custom', hidden: 'DELETE FROM hidden',
                    promos: "DELETE FROM content WHERE name = 'promos'" }[kind];
      if (!sql) throw fail('bad-kind', 'unknown leftover kind');
      await db.prepare(sql).run();
      await api.log(actor, 'leftovers.discard', kind, null);
      return { ok: true };
    },

    /* ---- settings ---- */
    async settings() { const m = {}; (await q.allSettings.all()).forEach(r => m[r.key] = parse(r.value_json, null)); return m; },
    async getSetting(k, fallback) { const r = await q.getSetting.get(k); return r ? parse(r.value_json, fallback) : fallback; },
    async setSetting(k, v, actor) { await q.putSetting.run(String(k).slice(0, 60), JSON.stringify(v), now()); await api.log(actor, 'setting.set', String(k), null); },

    /* ---- editorial content (guides, finder, promos …) ----
       Stored as the JSON text the owner saved; null means "serve the bundled
       data/<name>.json". setContent refuses text that is not valid JSON. */
    async getContent(name) {
      name = String(name || '');
      if (!CONTENT_NAME_RE.test(name)) return null;
      const r = await q.getContent.get(name);
      return r ? r.json_text : null;
    },
    async setContent(name, jsonText, actor) {
      name = String(name || '');
      if (!CONTENT_NAME_RE.test(name)) throw fail('bad-name', 'invalid content name');
      const text = String(jsonText ?? '');
      try { JSON.parse(text); } catch { throw fail('bad-json', 'content is not valid JSON'); }
      await q.putContent.run(name, text, now(), actor || null);
      await api.log(actor, 'content.save', name, null);
      return { ok: true };
    },

    /* ---- uploaded images ----
       Throws an Error with .code 'bad-name' | 'bad-bytes' | 'too-large' |
       'bad-mime' when refused. mime defaults to the one the extension implies. */
    async putUpload({ name, mime, bytes, actor } = {}) {
      name = String(name || '');
      const m = UPLOAD_NAME_RE.exec(name);
      if (!m) throw fail('bad-name', 'invalid upload name');
      if (!bytes || typeof bytes.length !== 'number' && typeof bytes.byteLength !== 'number') throw fail('bad-bytes', 'no image bytes');
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      if (!buf.length) throw fail('bad-bytes', 'no image bytes');
      if (buf.length > UPLOAD_MAX_BYTES) throw fail('too-large', 'image is larger than ' + UPLOAD_MAX_BYTES + ' bytes');
      const type = String(mime || UPLOAD_MIME[m[1]]).toLowerCase();
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) throw fail('bad-mime', 'unsupported image type');
      await q.putUpload.run(name, type, buf.length, buf, now(), actor || null);
      await api.log(actor, 'image.upload', name, { bytes: buf.length });
      return name;
    },
    async getUpload(name) {
      name = String(name || '');
      if (!UPLOAD_NAME_RE.test(name)) return null;
      const r = await q.getUpload.get(name);
      if (!r) return null;
      return { mime: r.mime, bytes: Buffer.from(r.bytes), created_at: r.created_at };
    },

    /* ---- audit ---- */
    async log(actor, action, target, detail) {
      try { await q.addAudit.run(now(), actor || null, action, target == null ? null : String(target), detail ? JSON.stringify(detail).slice(0, 2000) : null); } catch (e) {}
    },
    async audit(limit) { return q.recentAudit.all(Math.min(500, Math.max(1, limit || 50))); },

    close() { db.close(); },
    raw: db,
  };
  return api;
}
