/* ============================================================================
   SADKO analytics — the purchase funnel, per product and overall.
   ----------------------------------------------------------------------------
   Records how far each visitor gets down the buying journey, so the owner can
   see how much people interact with a product and where they drop off:

       view  →  save (like)  →  add_to_cart  →  checkout_start  →  purchase

   Events are keyed by an anonymous visitor id (a random token the browser keeps
   in localStorage) and, when the person is signed in, their user id too. No
   personal data is stored here — just which product, which step, and when.

   A second table records WHY people abandon a cart, captured by the 20-minute
   "still thinking about these?" prompt: a chosen reason (or free text), plus a
   snapshot of what was in the cart. That is the owner's most actionable signal.

   Storage is libSQL through engine/db.mjs (a local file in dev, Turso on
   Vercel). Every method that touches the database returns a Promise.
   ========================================================================== */

import { openDb, storeSpec } from './db.mjs';

/* The funnel, in order. Every event type must be one of these — a bad value can
   never reach the table. `purchase` is written server-side when an order lands. */
export const EVENT_TYPES = ['view', 'save', 'unsave', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase'];
// The ordered stages a dashboard funnel walks through (unsave/remove are signals, not stages).
export const FUNNEL_STAGES = ['view', 'save', 'add_to_cart', 'checkout_start', 'purchase'];

const MIGRATIONS = [{
  id: 1, name: 'analytics base',
  sql: `
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    vid        TEXT,
    user_id    TEXT,
    product_id TEXT,
    type       TEXT NOT NULL,
    meta_json  TEXT
  );
  CREATE INDEX IF NOT EXISTS ev_product ON events(product_id, type);
  CREATE INDEX IF NOT EXISTS ev_type    ON events(type, at);
  CREATE INDEX IF NOT EXISTS ev_at      ON events(at);
  CREATE INDEX IF NOT EXISTS ev_vid     ON events(vid, type);

  CREATE TABLE IF NOT EXISTS abandon (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    vid        TEXT,
    user_id    TEXT,
    reason     TEXT,
    note       TEXT,
    value      INTEGER,
    items_json TEXT
  );
  CREATE INDEX IF NOT EXISTS ab_at     ON abandon(at DESC);
  CREATE INDEX IF NOT EXISTS ab_reason ON abandon(reason);
  `,
}];

const RETENTION_DAYS = 365;   // keep a year of raw events; older rows are pruned on open (and by prune())

export async function openAnalytics(file) {
  const { spec, authToken } = storeSpec(file);
  const db = await openDb(spec, { authToken });
  await db.migrate('analytics', MIGRATIONS);

  const q = {
    insert:    db.prepare('INSERT INTO events (at,vid,user_id,product_id,type,meta_json) VALUES (?,?,?,?,?,?)'),
    insAband:  db.prepare('INSERT INTO abandon (at,vid,user_id,reason,note,value,items_json) VALUES (?,?,?,?,?,?,?)'),
    prune:     db.prepare('DELETE FROM events WHERE at < ?'),
    // distinct visitors that ever reached a stage (unique people, not raw hits).
    // COALESCE gives a per-row fallback key so events with no vid still count once.
    stageVisitors: db.prepare(`SELECT COUNT(DISTINCT COALESCE(vid, 'e' || id)) AS n FROM events WHERE type = ?`),
    stageHits:     db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?'),
    sinceVisitors: db.prepare(`SELECT COUNT(DISTINCT COALESCE(vid, 'e' || id)) AS n FROM events WHERE type = ? AND at > ?`),
    perProduct:    db.prepare(`SELECT product_id AS id, type, COUNT(DISTINCT COALESCE(vid, 'e' || id)) AS people, COUNT(*) AS hits
                               FROM events WHERE product_id IS NOT NULL GROUP BY product_id, type`),
    oneProduct:    db.prepare(`SELECT type, COUNT(DISTINCT COALESCE(vid, 'e' || id)) AS people, COUNT(*) AS hits
                               FROM events WHERE product_id = ? GROUP BY type`),
    topByType:     db.prepare(`SELECT product_id AS id, COUNT(DISTINCT COALESCE(vid, 'e' || id)) AS people
                               FROM events WHERE type = ? AND product_id IS NOT NULL GROUP BY product_id ORDER BY people DESC LIMIT ?`),
    recentAband:   db.prepare('SELECT * FROM abandon ORDER BY id DESC LIMIT ?'),
    reasonAgg:     db.prepare('SELECT reason, COUNT(*) AS n FROM abandon GROUP BY reason ORDER BY n DESC'),
    countEvents:   db.prepare('SELECT COUNT(*) AS n FROM events'),
    countAband:    db.prepare('SELECT COUNT(*) AS n FROM abandon'),
  };

  const now = () => new Date().toISOString();
  const clip = (s, n) => s == null ? null : String(s).slice(0, n);

  const api = {
    /* ---- housekeeping: drop events older than the retention window ---- */
    async prune() {
      try { return (await q.prune.run(new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString())).changes; }
      catch (e) { return 0; }
    },

    /* ---- write ---- */
    async record({ vid, userId, productId, type, meta }) {
      if (!EVENT_TYPES.includes(type)) return { error: 'bad-type' };
      await q.insert.run(now(), clip(vid, 40), clip(userId, 40), clip(productId, 40), type,
        meta ? JSON.stringify(meta).slice(0, 500) : null);
      return { ok: true };
    },
    // Convenience used by the order route: one purchase event per line item, in one batch.
    async recordPurchase({ vid, userId, items }) {
      const at = now();
      const stmts = [];
      for (const it of (items || [])) {
        if (!it || !it.id) continue;
        stmts.push(q.insert.bind(at, clip(vid, 40), clip(userId, 40), clip(it.id, 40), 'purchase',
          JSON.stringify({ qty: it.qty || 1, price: it.price || 0 }).slice(0, 500)));
      }
      await db.batch(stmts);
      return { ok: true };
    },
    async recordAbandon({ vid, userId, reason, note, value, items }) {
      await q.insAband.run(now(), clip(vid, 40), clip(userId, 40), clip(reason, 60), clip(note, 600),
        Math.round(Number(value) || 0), items ? JSON.stringify(items).slice(0, 4000) : null);
      return { ok: true };
    },

    /* ---- read: funnel ---- */
    async funnel(sinceIso) {
      const stages = await Promise.all(FUNNEL_STAGES.map(async type => {
        const [p, h] = await Promise.all([
          sinceIso ? q.sinceVisitors.get(type, sinceIso) : q.stageVisitors.get(type),
          q.stageHits.get(type),
        ]);
        return { stage: type, people: p.n, hits: h.n };
      }));
      // conversion of each stage relative to the first (views)
      const base = stages[0].people || 0;
      stages.forEach(s => { s.ofViews = base ? Math.round((s.people / base) * 100) : null; });
      return stages;
    },
    async productFunnel(productId) {
      const byType = {};
      (await q.oneProduct.all(String(productId))).forEach(r => { byType[r.type] = { people: r.people, hits: r.hits }; });
      return FUNNEL_STAGES.map(type => ({ stage: type, people: (byType[type] || {}).people || 0, hits: (byType[type] || {}).hits || 0 }));
    },
    // Map of productId -> {view, save, add_to_cart, checkout_start, purchase} people counts,
    // for decorating the admin product list. One query, folded in memory.
    async productStatsMap() {
      const m = {};
      (await q.perProduct.all()).forEach(r => {
        (m[r.id] || (m[r.id] = {}))[r.type] = r.people;
      });
      return m;
    },
    async topProducts(type, limit) { return q.topByType.all(type, Math.min(50, Math.max(1, limit || 8))); },

    /* ---- read: abandonment ---- */
    async abandonList(limit) {
      return (await q.recentAband.all(Math.min(500, Math.max(1, limit || 50)))).map(r => ({
        id: r.id, at: r.at, reason: r.reason, note: r.note, value: r.value,
        items: (() => { try { return JSON.parse(r.items_json || '[]'); } catch { return []; } })(),
        signedIn: !!r.user_id,
      }));
    },
    async abandonReasons() { return q.reasonAgg.all(); },

    async stats() {
      const [e, a] = await Promise.all([q.countEvents.get(), q.countAband.get()]);
      return { events: e.n, abandonments: a.n };
    },
    close() { db.close(); },
    raw: db,
  };

  await api.prune();
  return api;
}
