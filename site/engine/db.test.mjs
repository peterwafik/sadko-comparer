import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, splitSql, dbUrl } from './db.mjs';

test('prepare/get/all/run return plain values', async () => {
  const db = await openDb(':memory:');
  await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, ok INTEGER)');
  const ins = db.prepare('INSERT INTO t (a, ok) VALUES (?, ?)');
  const r = await ins.run('x', true);
  assert.equal(r.changes, 1);
  assert.equal(r.lastInsertRowid, 1);
  const row = await db.prepare('SELECT * FROM t WHERE id = ?').get(1);
  assert.deepEqual({ ...row }, { id: 1, a: 'x', ok: 1 });
  assert.equal(JSON.stringify(row), '{"id":1,"a":"x","ok":1}');
  assert.equal(await db.prepare('SELECT * FROM t WHERE id = ?').get(9), undefined);
  assert.equal((await db.prepare('SELECT * FROM t').all()).length, 1);
});

test('undefined arguments bind as NULL instead of throwing', async () => {
  const db = await openDb(':memory:');
  await db.exec('CREATE TABLE t (a TEXT)');
  await db.prepare('INSERT INTO t VALUES (?)').run(undefined);
  assert.equal((await db.prepare('SELECT a FROM t').get()).a, null);
});

test('batch is atomic: one failing statement writes nothing', async () => {
  const db = await openDb(':memory:');
  await db.exec('CREATE TABLE t (a TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO t VALUES (?)');
  await assert.rejects(db.batch([ins.bind('a'), ins.bind(null)]));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM t').get()).n, 0);
  await db.batch([ins.bind('a'), ins.bind('b')]);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM t').get()).n, 2);
});

test('migrations run once, per store name, so stores can share one database', async () => {
  const db = await openDb(':memory:');
  const A = [{ id: 1, name: 'a', sql: 'CREATE TABLE a1 (x); CREATE INDEX a1x ON a1(x);' }];
  const B = [{ id: 1, name: 'b', sql: "CREATE TABLE b1 (x TEXT DEFAULT 'a;b')" }];
  await db.migrate('alpha', A);
  await db.migrate('beta', B);
  await db.migrate('alpha', A);                       // second boot: no "table exists" error
  const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).map(r => r.name);
  assert.ok(names.includes('a1') && names.includes('b1'));
  assert.ok(names.includes('alpha_migrations') && names.includes('beta_migrations'));
});

test('a failing migration leaves no half-applied schema', async () => {
  const db = await openDb(':memory:');
  await assert.rejects(db.migrate('x', [{ id: 1, name: 'bad', sql: 'CREATE TABLE ok1 (a); CREATE TABLE ok1 (a);' }]));
  const t = await db.prepare("SELECT name FROM sqlite_master WHERE name='ok1'").get();
  assert.equal(t, undefined);
});

test('a database made by the old DatabaseSync code keeps its migration history', async () => {
  const db = await openDb(':memory:');
  await db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT); CREATE TABLE users (id);');
  await db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run('init', 'then');
  await db.migrate('accounts', [{ id: 1, name: 'init', sql: 'CREATE TABLE users (id)' }]);   // would throw if re-run
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM accounts_migrations').get()).n, 1);
});

test('splitSql keeps semicolons inside quotes and drops comments', () => {
  assert.deepEqual(splitSql("CREATE TABLE a (x DEFAULT ';'); -- note; here\nCREATE INDEX i ON a(x);"),
    ["CREATE TABLE a (x DEFAULT ';')", 'CREATE INDEX i ON a(x)']);
});

test('dbUrl turns Windows and POSIX paths into file: URLs and passes URLs through', () => {
  assert.equal(dbUrl(':memory:'), ':memory:');
  assert.equal(dbUrl('libsql://x.turso.io'), 'libsql://x.turso.io');
  assert.match(dbUrl('D:\\tmp\\a.db'), /^file:D:\/tmp\/a\.db$/);
});
