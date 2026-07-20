/* SQLite product catalog. `products` are identities, `offers` are per-store
   listings keyed by URL, `price_history` tracks changes over time. */
import { DatabaseSync } from 'node:sqlite';
import { identify } from './matcher.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  identity_key TEXT UNIQUE NOT NULL,
  brand TEXT, category TEXT, model_norm TEXT,
  attrs_json TEXT, title_canonical TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  domain TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  price INTEGER, currency TEXT DEFAULT 'EGP',
  in_stock INTEGER DEFAULT 1,
  title_raw TEXT,
  first_seen INTEGER, last_checked INTEGER
);
CREATE INDEX IF NOT EXISTS offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS offers_domain  ON offers(domain);
CREATE TABLE IF NOT EXISTS price_history (
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  price INTEGER NOT NULL, seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hist_offer ON price_history(offer_id);
CREATE TABLE IF NOT EXISTS crawl_state (
  domain TEXT PRIMARY KEY,
  last_sitemap_etag TEXT, cursor INTEGER DEFAULT 0,
  last_run INTEGER, status TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS offers_fts USING fts5(
  title_raw, brand, model_norm, content='', tokenize='unicode61'
);
`;

/* FTS5 treats bare '-' and '"' as syntax. Quote every term so hyphenated model
   numbers and stray quotes are literals, and OR them for recall. */
function ftsQuery(q) {
  const terms = String(q || '').split(/\s+/)
    .map(t => t.replace(/"/g, '').trim())
    .filter(Boolean);
  if (!terms.length) return null;
  return terms.map(t => `"${t}"`).join(' OR ');
}

export function openCatalog(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const findProduct = db.prepare('SELECT id FROM products WHERE identity_key = ?');
  const insProduct = db.prepare(
    'INSERT INTO products (identity_key, brand, category, model_norm, attrs_json, title_canonical) VALUES (?,?,?,?,?,?)');
  const findOffer = db.prepare('SELECT id, price FROM offers WHERE url = ?');
  const insOffer = db.prepare(
    'INSERT INTO offers (product_id, domain, url, price, currency, in_stock, title_raw, first_seen, last_checked) VALUES (?,?,?,?,?,?,?,?,?)');
  const updOffer = db.prepare(
    'UPDATE offers SET price=?, in_stock=?, title_raw=?, last_checked=?, product_id=? WHERE id=?');
  const insHist = db.prepare('INSERT INTO price_history (offer_id, price, seen_at) VALUES (?,?,?)');
  const insFts = db.prepare('INSERT INTO offers_fts (rowid, title_raw, brand, model_norm) VALUES (?,?,?,?)');
  // Contentless FTS5 ('delete' command) needs the ORIGINAL indexed values to
  // locate and remove the old postings — NULLs remove nothing and leak stale
  // tokens into the index forever. Fetch what was actually indexed last time:
  // the offer's own title_raw plus the brand/model_norm of the product it was
  // linked to at that time (products.brand/model_norm never change after
  // insert, so this reconstructs the exact row insFts wrote previously).
  const findOldFts = db.prepare(
    `SELECT o.title_raw AS title_raw, p.brand AS brand, p.model_norm AS model_norm
     FROM offers o JOIN products p ON p.id = o.product_id WHERE o.id = ?`);
  const delFts = db.prepare("INSERT INTO offers_fts (offers_fts, rowid, title_raw, brand, model_norm) VALUES ('delete', ?, ?, ?, ?)");

  return {
    db,

    upsertOffer({ domain, url, title, price, currency = 'EGP', inStock = true, now = Date.now() }) {
      // Multi-statement write (product, offer, price-history, FTS delete+insert)
      // must be all-or-nothing: a failure partway through must never leave an
      // offer with no FTS row (invisible to search) or an FTS row pointing at
      // nothing written.
      db.exec('BEGIN');
      try {
        const idy = identify(title);
        let row = findProduct.get(idy.key);
        if (!row) {
          insProduct.run(idy.key, idy.brand, idy.category, idy.model,
            JSON.stringify({ units: idy.units, specs: idy.specs }), title);
          row = findProduct.get(idy.key);
        }
        const productId = row.id;
        const existing = findOffer.get(url);
        let offerId;
        if (existing) {
          offerId = existing.id;
          const old = findOldFts.get(offerId);
          delFts.run(offerId, old.title_raw, old.brand, old.model_norm);
          updOffer.run(price, inStock ? 1 : 0, title, now, productId, offerId);
          if (existing.price !== price) insHist.run(offerId, price, now);
        } else {
          insOffer.run(productId, domain, url, price, currency, inStock ? 1 : 0, title, now, now);
          offerId = findOffer.get(url).id;
          insHist.run(offerId, price, now);
        }
        insFts.run(offerId, title, idy.brand, idy.model);
        db.exec('COMMIT');
        return { offerId, productId };
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* rollback failure must not mask the original error */ }
        throw err;
      }
    },

    search(query, limit = 200) {
      const fq = ftsQuery(query);
      if (!fq) return [];
      return db.prepare(`
        SELECT o.id AS offer_id, o.product_id, o.domain, o.url, o.price, o.currency,
               o.in_stock, o.title_raw, o.last_checked,
               p.brand, p.category, p.model_norm
        FROM offers_fts f
        JOIN offers o ON o.id = f.rowid
        JOIN products p ON p.id = o.product_id
        WHERE offers_fts MATCH ?
        ORDER BY rank LIMIT ?`).all(fq, limit);
    },

    /* Every offer belonging to the given product ids, price-ascending — the
       set ranking must actually happen over. FTS5's `search()` truncates by
       TEXT RELEVANCE before price ever enters the picture, so a genuinely
       cheaper offer of an already-matched product can rank low on relevance
       and never reach the caller. Once a product is known to match (some
       offer of it survived the FTS cut), every one of its offers — cheap or
       not, well-worded or not — belongs in the priced ranking. Same row
       shape as search() so callers can treat the two interchangeably. */
    offersForProducts(productIds) {
      const ids = [...new Set(productIds || [])];
      if (!ids.length) return [];
      const placeholders = ids.map(() => '?').join(',');
      return db.prepare(`
        SELECT o.id AS offer_id, o.product_id, o.domain, o.url, o.price, o.currency,
               o.in_stock, o.title_raw, o.last_checked,
               p.brand, p.category, p.model_norm
        FROM offers o
        JOIN products p ON p.id = o.product_id
        WHERE o.product_id IN (${placeholders})
        ORDER BY o.price ASC`).all(...ids);
    },

    /* Every offer whose product belongs to the given category, price-ascending
       — powers bare-category "browse" queries (see serve.mjs: a query with a
       category but no brand/model isn't asking "is this the same product as
       X", it's "show me washers"). Same row shape as search() and
       offersForProducts() so callers can treat all three interchangeably. */
    offersForCategory(category) {
      if (!category) return [];
      return db.prepare(`
        SELECT o.id AS offer_id, o.product_id, o.domain, o.url, o.price, o.currency,
               o.in_stock, o.title_raw, o.last_checked,
               p.brand, p.category, p.model_norm
        FROM offers o
        JOIN products p ON p.id = o.product_id
        WHERE p.category = ?
        ORDER BY o.price ASC`).all(category);
    },

    priceHistory(offerId) {
      return db.prepare('SELECT price, seen_at FROM price_history WHERE offer_id=? ORDER BY seen_at').all(offerId);
    },

    /* Resumability: how far into a store's product-URL list the last run got.
       An interrupted crawl continues rather than refetching from zero. */
    getCursor(domain) {
      const r = db.prepare('SELECT cursor FROM crawl_state WHERE domain=?').get(domain);
      return r ? r.cursor : 0;
    },
    setCursor(domain, cursor, status = 'ok') {
      db.prepare(`INSERT INTO crawl_state (domain, cursor, last_run, status) VALUES (?,?,?,?)
                  ON CONFLICT(domain) DO UPDATE SET cursor=excluded.cursor,
                    last_run=excluded.last_run, status=excluded.status`)
        .run(domain, cursor, Date.now(), status);
    },

    close() { db.close(); },
  };
}
