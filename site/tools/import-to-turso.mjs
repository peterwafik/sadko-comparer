/* ============================================================================
   Copy the VM's SQLite snapshots into the hosted Turso database, once.
   ----------------------------------------------------------------------------
   Usage (from site/, with the Turso credentials in the environment):

     node --env-file=.turso.env tools/import-to-turso.mjs ../vm-backup/data [--dry-run]

   <dir> holds the files from the VM backup (accounts.db, catalog-admin.db,
   analytics.db, ecwid.db). Each store is first opened through its own module,
   which creates the schema in Turso by running that store's migrations, so
   the target always has the CURRENT schema. Then every row of every table in
   the snapshot is copied across, matched by column name; columns the
   snapshot lacks keep their defaults. The migration bookkeeping table is
   skipped because the target keeps its own.

   ecwid.db is a cache of Ecwid's data, but it also holds the order-push queue
   and the customer links (which Ecwid ids belong to which site orders and
   accounts). Losing those would push orders twice, so it is imported too.

   Safe to re-run: rows are written with INSERT OR REPLACE on their keys.
   Prints counts only; no personal data is printed.
   ========================================================================== */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openDb, tursoEnv } from '../engine/db.mjs';
import { openAccounts } from '../engine/accounts.mjs';
import { openCatalogAdmin } from '../engine/catalog-admin.mjs';
import { openAnalytics } from '../engine/analytics.mjs';
import { openEcwidStore } from '../engine/ecwid-store.mjs';

const [dir, ...flags] = process.argv.slice(2);
const DRY = flags.includes('--dry-run');
if (!dir) { console.error('usage: node tools/import-to-turso.mjs <backup-dir> [--dry-run]'); process.exit(2); }
const TURSO = tursoEnv();
if (!TURSO.url) { console.error('TURSO_DATABASE_URL is not set: refusing to import into a local file by mistake.'); process.exit(2); }

const STORES = [
  { file: 'accounts.db',      open: () => openAccounts(path.join(dir, '__unused__.json')) },
  { file: 'catalog-admin.db', open: () => openCatalogAdmin(path.join(dir, '__unused__.db')) },
  { file: 'analytics.db',     open: () => openAnalytics(path.join(dir, '__unused__.db')) },
  { file: 'ecwid.db',         open: () => openEcwidStore(path.join(dir, '__unused__.db')) },
];
const SKIP_TABLES = /^(sqlite_|schema_migrations$|.*_migrations$)/;
const CHUNK = 200;

const target = await openDb(TURSO.url, { authToken: TURSO.authToken });
let total = 0;

for (const s of STORES) {
  const src = path.join(dir, s.file);
  if (!existsSync(src)) { console.log(`- ${s.file}: not in the backup, skipped`); continue; }

  // Opening the store runs its migrations against Turso (storeSpec picks it).
  const store = await s.open();
  try { store.close && store.close(); } catch (e) {}

  const db = new DatabaseSync(src, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map(r => r.name).filter(n => !SKIP_TABLES.test(n));

  for (const t of tables) {
    const targetCols = new Set((await target.prepare(`PRAGMA table_info(${t})`).all()).map(c => c.name));
    if (!targetCols.size) { console.log(`  ! ${s.file}/${t}: no such table in the current schema, skipped`); continue; }
    const rows = db.prepare(`SELECT * FROM ${t}`).all();
    if (!rows.length) { console.log(`  ${s.file}/${t}: 0 rows`); continue; }
    const cols = Object.keys(rows[0]).filter(c => targetCols.has(c));
    const dropped = Object.keys(rows[0]).filter(c => !targetCols.has(c));
    const ins = target.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    if (!DRY) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await target.batch(rows.slice(i, i + CHUNK).map(r => ins.bind(...cols.map(c => r[c]))));
      }
    }
    total += rows.length;
    console.log(`  ${s.file}/${t}: ${rows.length} rows${DRY ? ' (dry run)' : ''}` +
      (dropped.length ? `; columns not in the current schema: ${dropped.join(', ')}` : ''));
  }
  db.close();
}
target.close();
console.log(`${DRY ? 'Would copy' : 'Copied'} ${total} rows.`);
