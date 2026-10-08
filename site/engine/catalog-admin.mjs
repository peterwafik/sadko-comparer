/* ============================================================================
   SADKO catalog admin store — the owner's edits to the storefront catalogue.
   ----------------------------------------------------------------------------
   The 471-product catalogue in data/products.json is a SCRAPE: it can be
   re-crawled and regenerated at any time. So the owner's edits must NOT be
   written back into that file, or a re-crawl would wipe them. Instead this
   store keeps edits as a thin OVERLAY on top of the base file:

     • overrides  — per-product field patches (price, title, image, …)
     • custom     — products the owner added by hand
     • hidden     — products the owner removed from the storefront (soft delete)
     • settings   — site-wide values the owner controls (hotline, banners, …)
     • audit      — an append-only log of who changed what, when
     • content    — the owner's edits to editorial JSON (guides, finder, promos),
                    served in place of the bundled data/<name>.json
     • uploads    — images the owner uploaded from the control room (bytes)

   `merge(base)` folds all of that onto the base list, and the server serves the
   result at the same /data/products.json URL — so every existing page (shop,
   category, finder, product) reflects the owner's changes with zero page edits.

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

/* The only product fields the owner may set. A patch can touch nothing else, so
   a malformed or hostile request cannot inject arbitrary keys into a product. */
export const EDITABLE_FIELDS = ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand', 'badge'];

/* Upload rules: the server generates the name ('p' + base36 + extension), so
   anything else is refused outright; the size cap matches the old disk route. */
export const UPLOAD_NAME_RE = /^p[a-z0-9]+\.(png|jpg|webp|gif|avif)$/;
export const UPLOAD_MAX_BYTES = 4_500_000;
const UPLOAD_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
export const CONTENT_NAME_RE = /^[a-z0-9_-]{1,60}$/;

const fail = (code, message) => Object.assign(new Error(message || code), { code });

function cleanPatch(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of EDITABLE_FIELDS) {
    if (!(k in input)) continue;
    let v = input[k];
    if (v == null) { out[k] = null; continue; }              // null = clear the override
    if (k === 'price') { const n = Math.round(Number(v)); if (isFinite(n) && n >= 0 && n < 100000000) out[k] = n; }
    else out[k] = String(v).slice(0, k === 'description' ? 6000 : 1000);
  }
  return out;
}

export async function openCatalogAdmin(file) {
  const { spec, authToken } = storeSpec(file);
  const db = await openDb(spec, { authToken });
  await db.migrate('catalog_admin', MIGRATIONS);

  const q = {
    allOverrides: db.prepare('SELECT * FROM overrides'),
    getOverride:  db.prepare('SELECT * FROM overrides WHERE id = ?'),
    putOverride:  db.prepare('INSERT INTO overrides (id,patch_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET patch_json=excluded.patch_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by'),
    delOverride:  db.prepare('DELETE FROM overrides WHERE id = ?'),
    allCustom:    db.prepare('SELECT * FROM custom'),
    getCustom:    db.prepare('SELECT * FROM custom WHERE id = ?'),
    putCustom:    db.prepare('INSERT INTO custom (id,data_json,created_at,created_by) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json'),
    delCustom:    db.prepare('DELETE FROM custom WHERE id = ?'),
    allHidden:    db.prepare('SELECT id FROM hidden'),
    isHidden:     db.prepare('SELECT id FROM hidden WHERE id = ?'),
    hide:         db.prepare('INSERT OR IGNORE INTO hidden (id,at,by) VALUES (?,?,?)'),
    unhide:       db.prepare('DELETE FROM hidden WHERE id = ?'),
    allSettings:  db.prepare('SELECT * FROM settings'),
    getSetting:   db.prepare('SELECT value_json FROM settings WHERE key = ?'),
    putSetting:   db.prepare('INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at'),
    addAudit:     db.prepare('INSERT INTO audit (at,actor,action,target,detail_json) VALUES (?,?,?,?,?)'),
    recentAudit:  db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    getContent:   db.prepare('SELECT json_text FROM content WHERE name = ?'),
    putContent:   db.prepare('INSERT INTO content (name,json_text,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET json_text=excluded.json_text, updated_at=excluded.updated_at, updated_by=excluded.updated_by'),
    putUpload:    db.prepare('INSERT INTO uploads (name,mime,size,bytes,created_at,created_by) VALUES (?,?,?,?,?,?)'),
    getUpload:    db.prepare('SELECT mime, bytes, created_at FROM uploads WHERE name = ?'),
    counts: {
      overrides: db.prepare('SELECT COUNT(*) n FROM overrides'),
      custom:    db.prepare('SELECT COUNT(*) n FROM custom'),
      hidden:    db.prepare('SELECT COUNT(*) n FROM hidden'),
    },
  };
  const parse = (s, f) => { try { return JSON.parse(s); } catch { return f; } };
  const now = () => new Date().toISOString();

  const api = {
    /* ---- read ---- */
    async overridesMap() { const m = {}; (await q.allOverrides.all()).forEach(r => m[r.id] = parse(r.patch_json, {})); return m; },
    async customList() { return (await q.allCustom.all()).map(r => Object.assign(parse(r.data_json, {}), { id: r.id, _custom: true })); },
    async hiddenSet() { return new Set((await q.allHidden.all()).map(r => r.id)); },

    /* Fold overrides / hidden / custom onto a base product list. */
    async merge(baseList) {
      const [ov, hidden, custom] = await Promise.all([api.overridesMap(), api.hiddenSet(), api.customList()]);
      const out = [];
      for (const p of baseList) {
        if (hidden.has(String(p.id))) continue;
        const patch = ov[String(p.id)];
        out.push(patch ? Object.assign({}, p, patch) : p);
      }
      // custom products are appended (their id is prefixed so it never collides)
      for (const c of custom) if (!hidden.has(String(c.id))) out.push(c);
      return out;
    },

    /* Admin view of a single product = base ⊕ override, with edit metadata. */
    async describe(baseList, id) {
      id = String(id);
      const custom = await q.getCustom.get(id);
      if (custom) return { product: Object.assign(parse(custom.data_json, {}), { id, _custom: true }), override: null, hidden: !!(await q.isHidden.get(id)) };
      const base = baseList.find(p => String(p.id) === id);
      if (!base) return null;
      const ovRow = await q.getOverride.get(id);
      const patch = ovRow ? parse(ovRow.patch_json, {}) : null;
      return { product: patch ? Object.assign({}, base, patch) : Object.assign({}, base), base, override: patch, hidden: !!(await q.isHidden.get(id)) };
    },

    /* ---- write ---- */
    async setOverride(id, patchInput, actor) {
      id = String(id);
      const clean = cleanPatch(patchInput);
      const existing = await q.getOverride.get(id);
      const merged = Object.assign(existing ? parse(existing.patch_json, {}) : {}, clean);
      // drop keys explicitly set to null (reverting to the scraped value)
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (Object.keys(merged).length) await q.putOverride.run(id, JSON.stringify(merged), now(), actor || null);
      else await q.delOverride.run(id);
      await api.log(actor, 'product.edit', id, clean);
      return merged;
    },
    async revert(id, actor) { id = String(id); await q.delOverride.run(id); await api.log(actor, 'product.revert', id, null); },

    async createProduct(data, actor) {
      const clean = cleanPatch(data);
      if (!clean.title) return { error: 'title-required' };
      const id = 'adm-' + Math.random().toString(36).slice(2, 10);
      const product = Object.assign({ id, price: 0, image: '', description: '', categoryId: '', url: '' }, clean);
      await q.putCustom.run(id, JSON.stringify(product), now(), actor || null);
      await api.log(actor, 'product.create', id, { title: clean.title });
      return { ok: true, product: Object.assign(product, { _custom: true }) };
    },
    async updateCustom(id, data, actor) {
      id = String(id);
      const row = await q.getCustom.get(id);
      if (!row) return { error: 'not-found' };
      const cur = parse(row.data_json, {});
      const merged = Object.assign(cur, cleanPatch(data), { id });
      await q.putCustom.run(id, JSON.stringify(merged), row.created_at, null);
      await api.log(actor, 'product.edit', id, null);
      return { ok: true, product: Object.assign(merged, { _custom: true }) };
    },
    async hide(id, actor) { id = String(id); await q.hide.run(id, now(), actor || null); await api.log(actor, 'product.hide', id, null); },
    async unhide(id, actor) { id = String(id); await q.unhide.run(id); await api.log(actor, 'product.unhide', id, null); },
    async remove(id, actor) {
      id = String(id);
      if (await q.getCustom.get(id)) {
        await db.batch([q.delCustom.bind(id), q.delOverride.bind(id), q.unhide.bind(id)]);
        await api.log(actor, 'product.delete', id, null);
        return { deleted: 'custom' };
      }
      // base products can only be hidden, never truly deleted (they'd return on re-crawl)
      await api.hide(id, actor);
      return { deleted: 'hidden' };
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

    async stats() {
      const [o, c, h] = await Promise.all([q.counts.overrides.get(), q.counts.custom.get(), q.counts.hidden.get()]);
      return { overrides: o.n, custom: c.n, hidden: h.n };
    },
    close() { db.close(); },
    raw: db,
  };
  return api;
}
