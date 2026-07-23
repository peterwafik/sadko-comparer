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

   `merge(base)` folds all of that onto the base list, and the server serves the
   result at the same /data/products.json URL — so every existing page (shop,
   category, finder, product) reflects the owner's changes with zero page edits.

   Storage is SQLite (node:sqlite, zero deps), same engine and discipline as the
   accounts store: WAL, prepared statements, atomic writes.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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
}];

/* The only product fields the owner may set. A patch can touch nothing else, so
   a malformed or hostile request cannot inject arbitrary keys into a product. */
export const EDITABLE_FIELDS = ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand', 'badge'];

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

export function openCatalogAdmin(file) {
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
    try { db.exec(m.sql); db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(m.id, m.name, new Date().toISOString()); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }

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
    overridesMap() { const m = {}; q.allOverrides.all().forEach(r => m[r.id] = parse(r.patch_json, {})); return m; },
    customList() { return q.allCustom.all().map(r => Object.assign(parse(r.data_json, {}), { id: r.id, _custom: true })); },
    hiddenSet() { return new Set(q.allHidden.all().map(r => r.id)); },

    /* Fold overrides / hidden / custom onto a base product list. */
    merge(baseList) {
      const ov = api.overridesMap();
      const hidden = api.hiddenSet();
      const out = [];
      for (const p of baseList) {
        if (hidden.has(String(p.id))) continue;
        const patch = ov[String(p.id)];
        out.push(patch ? Object.assign({}, p, patch) : p);
      }
      // custom products are appended (their id is prefixed so it never collides)
      for (const c of api.customList()) if (!hidden.has(String(c.id))) out.push(c);
      return out;
    },

    /* Admin view of a single product = base ⊕ override, with edit metadata. */
    describe(baseList, id) {
      id = String(id);
      const custom = q.getCustom.get(id);
      if (custom) return { product: Object.assign(parse(custom.data_json, {}), { id, _custom: true }), override: null, hidden: !!q.isHidden.get(id) };
      const base = baseList.find(p => String(p.id) === id);
      if (!base) return null;
      const ovRow = q.getOverride.get(id);
      const patch = ovRow ? parse(ovRow.patch_json, {}) : null;
      return { product: patch ? Object.assign({}, base, patch) : Object.assign({}, base), base, override: patch, hidden: !!q.isHidden.get(id) };
    },

    /* ---- write ---- */
    setOverride(id, patchInput, actor) {
      id = String(id);
      const clean = cleanPatch(patchInput);
      const existing = q.getOverride.get(id);
      const merged = Object.assign(existing ? parse(existing.patch_json, {}) : {}, clean);
      // drop keys explicitly set to null (reverting to the scraped value)
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (Object.keys(merged).length) q.putOverride.run(id, JSON.stringify(merged), now(), actor || null);
      else q.delOverride.run(id);
      api.log(actor, 'product.edit', id, clean);
      return merged;
    },
    revert(id, actor) { id = String(id); q.delOverride.run(id); api.log(actor, 'product.revert', id, null); },

    createProduct(data, actor) {
      const clean = cleanPatch(data);
      if (!clean.title) return { error: 'title-required' };
      const id = 'adm-' + Math.random().toString(36).slice(2, 10);
      const product = Object.assign({ id, price: 0, image: '', description: '', categoryId: '', url: '' }, clean);
      q.putCustom.run(id, JSON.stringify(product), now(), actor || null);
      api.log(actor, 'product.create', id, { title: clean.title });
      return { ok: true, product: Object.assign(product, { _custom: true }) };
    },
    updateCustom(id, data, actor) {
      id = String(id);
      const row = q.getCustom.get(id);
      if (!row) return { error: 'not-found' };
      const cur = parse(row.data_json, {});
      const merged = Object.assign(cur, cleanPatch(data), { id });
      q.putCustom.run(id, JSON.stringify(merged), row.created_at, null);
      api.log(actor, 'product.edit', id, null);
      return { ok: true, product: Object.assign(merged, { _custom: true }) };
    },
    hide(id, actor) { id = String(id); q.hide.run(id, now(), actor || null); api.log(actor, 'product.hide', id, null); },
    unhide(id, actor) { id = String(id); q.unhide.run(id); api.log(actor, 'product.unhide', id, null); },
    remove(id, actor) {
      id = String(id);
      if (q.getCustom.get(id)) { q.delCustom.run(id); q.delOverride.run(id); q.unhide.run(id); api.log(actor, 'product.delete', id, null); return { deleted: 'custom' }; }
      // base products can only be hidden, never truly deleted (they'd return on re-crawl)
      api.hide(id, actor);
      return { deleted: 'hidden' };
    },

    /* ---- settings ---- */
    settings() { const m = {}; q.allSettings.all().forEach(r => m[r.key] = parse(r.value_json, null)); return m; },
    getSetting(k, fallback) { const r = q.getSetting.get(k); return r ? parse(r.value_json, fallback) : fallback; },
    setSetting(k, v, actor) { q.putSetting.run(String(k).slice(0, 60), JSON.stringify(v), now()); api.log(actor, 'setting.set', String(k), null); },

    /* ---- audit ---- */
    log(actor, action, target, detail) {
      try { q.addAudit.run(now(), actor || null, action, target == null ? null : String(target), detail ? JSON.stringify(detail).slice(0, 2000) : null); } catch (e) {}
    },
    audit(limit) { return q.recentAudit.all(Math.min(500, Math.max(1, limit || 50))); },

    stats() {
      return { overrides: q.counts.overrides.get().n, custom: q.counts.custom.get().n, hidden: q.counts.hidden.get().n };
    },
    close() { try { db.close(); } catch (e) {} },
    raw: db,
  };
  return api;
}
