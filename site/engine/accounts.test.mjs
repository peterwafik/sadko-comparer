// site/engine/accounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAccounts, validateEmail, validatePassword, validatePhone, cleanProfile } from './accounts.mjs';
import { openAccountsDb, importLegacyJson } from './accounts-db.mjs';

/* Windows can keep the libSQL file handle a moment after close(); a temp dir
   that cannot be removed yet is left for the OS rather than failing a test. */
function rmTemp(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (e) {}
}

async function fresh() {
  // These tests inspect the bytes on disk, so they must run on a local file,
  // never on a hosted database that happens to be configured in the shell.
  delete process.env.TURSO_DATABASE_URL;
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-acc-'));
  const file = path.join(dir, 'accounts.json');
  const db = await openAccounts(file);
  const dbFile = path.join(dir, 'accounts.db');
  assert.ok(db.__raw().local && db.__raw().url.startsWith('file:'), 'test store must be a local file');
  // Everything SQLite may have written: the database and its write-ahead log.
  const bytes = () => {
    const main = readFileSync(dbFile, 'latin1');     // throws if the file is missing: a vacuous pass is impossible
    assert.ok(main.length > 0, 'the database file is empty');
    return main + ['-wal', '-shm', '-journal']
      .map(suffix => { try { return readFileSync(dbFile + suffix, 'latin1'); } catch { return ''; } })
      .join('');
  };
  const rows = (sql) => db.__raw().prepare(sql).all();
  return {
    db, file, dbFile, bytes, rows,
    cleanup: () => { try { db.close(); } catch (e) {} rmTemp(dir); },
  };
}
const GOOD = { email: 'Nour@Example.com', password: 'sadko1234', name: 'نور', phone: '01012345678' };

test('validators accept good input and reject bad', () => {
  assert.ok(validateEmail('a@b.co'));
  assert.ok(!validateEmail('a@b'));
  assert.ok(!validateEmail('nope'));
  assert.equal(validatePassword('short1').ok, false);
  assert.equal(validatePassword('alllettersnodigit').ok, false);
  assert.equal(validatePassword('sadko1234').ok, true);
  assert.ok(validatePhone(''));                       // optional
  assert.ok(validatePhone('01012345678'));
  assert.ok(!validatePhone('12345'));
});

test('CRITICAL: the password is never stored in readable form', async () => {
  const { db, bytes, rows, cleanup } = await fresh();
  await db.register(GOOD);
  // positive control: the row really is in the bytes we search
  assert.ok(bytes().includes('nour@example.com'), 'the scan is not reading the stored data');
  assert.ok(!bytes().includes('sadko1234'), 'plaintext password found in the database file');
  const stored = (await rows('SELECT * FROM users'))[0];
  assert.ok(stored.hash && stored.hash.length === 128, 'expected a 64-byte scrypt hash');
  assert.ok(stored.salt && stored.salt.length === 32);
  assert.equal(stored.password, undefined);
  cleanup();
});

test('CRITICAL: the session cookie value is not stored on disk (only its digest)', async () => {
  const { db, bytes, cleanup } = await fresh();
  const r = await db.register(GOOD);
  assert.ok(r.session.raw.length > 20);
  assert.ok(!bytes().includes(r.session.raw), 'raw session token found on disk — a leaked file would be replayable');
  assert.equal((await db.userForToken(r.session.raw)).email, 'nour@example.com');
  cleanup();
});

test('two users with the same password get different hashes (per-user salt)', async () => {
  const { db, rows, cleanup } = await fresh();
  await db.register(GOOD);
  await db.register({ ...GOOD, email: 'other@example.com' });
  const [a, b] = await rows('SELECT * FROM users');
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
  cleanup();
});

test('email is normalised and duplicates are refused', async () => {
  const { db, cleanup } = await fresh();
  assert.equal((await db.register(GOOD)).ok, true);
  assert.equal((await db.register({ ...GOOD, email: 'NOUR@example.com' })).error, 'email-taken');
  cleanup();
});

test('login succeeds with the right password and fails vaguely otherwise', async () => {
  const { db, cleanup } = await fresh();
  await db.register(GOOD);
  assert.equal((await db.login({ email: 'nour@example.com', password: 'sadko1234' })).ok, true);
  const bad = await db.login({ email: 'nour@example.com', password: 'wrongpass1' });
  assert.equal(bad.error, 'bad-credentials');
  // An unknown email must give the SAME error, or the endpoint leaks who is registered.
  const unknown = await db.login({ email: 'nobody@example.com', password: 'whatever12' });
  assert.equal(unknown.error, 'bad-credentials');
  cleanup();
});

test('repeated failures are rate-limited per email+ip', async () => {
  const { db, cleanup } = await fresh();
  await db.register(GOOD);
  for (let i = 0; i < 8; i++) await db.login({ email: GOOD.email, password: 'nope12345', ip: '1.2.3.4' });
  assert.equal((await db.login({ email: GOOD.email, password: 'nope12345', ip: '1.2.3.4' })).error, 'too-many');
  // a different IP is not punished for it
  assert.equal((await db.login({ email: GOOD.email, password: 'sadko1234', ip: '5.6.7.8' })).ok, true);
  cleanup();
});

test('a correct login clears the failure counter', async () => {
  const { db, cleanup } = await fresh();
  await db.register(GOOD);
  for (let i = 0; i < 5; i++) await db.login({ email: GOOD.email, password: 'nope12345', ip: '9.9.9.9' });
  assert.equal((await db.login({ email: GOOD.email, password: 'sadko1234', ip: '9.9.9.9' })).ok, true);
  for (let i = 0; i < 5; i++) await db.login({ email: GOOD.email, password: 'nope12345', ip: '9.9.9.9' });
  assert.notEqual((await db.login({ email: GOOD.email, password: 'sadko1234', ip: '9.9.9.9' })).error, 'too-many');
  cleanup();
});

test('logout invalidates only that session', async () => {
  const { db, cleanup } = await fresh();
  const a = (await db.register(GOOD)).session.raw;
  const b = (await db.login({ email: GOOD.email, password: GOOD.password })).session.raw;
  await db.logout(a);
  assert.equal(await db.userForToken(a), null);
  assert.ok(await db.userForToken(b));
  cleanup();
});

test('an unknown or tampered token resolves to nobody', async () => {
  const { db, cleanup } = await fresh();
  const r = await db.register(GOOD);
  assert.equal(await db.userForToken('made-up'), null);
  assert.equal(await db.userForToken(r.session.raw.slice(0, -2) + 'xx'), null);
  assert.equal(await db.userForToken(''), null);
  cleanup();
});

test('changing the password signs every device out', async () => {
  const { db, cleanup } = await fresh();
  const a = (await db.register(GOOD)).session.raw;
  const b = (await db.login({ email: GOOD.email, password: GOOD.password })).session.raw;
  assert.equal((await db.changePassword((await db.userForToken(a)).id, 'wrong12345', 'newpass123')).error, 'bad-credentials');
  const uid = (await db.userForToken(a)).id;
  assert.equal((await db.changePassword(uid, GOOD.password, 'newpass123')).ok, true);
  assert.equal(await db.userForToken(a), null);
  assert.equal(await db.userForToken(b), null);
  assert.equal((await db.login({ email: GOOD.email, password: 'newpass123' })).ok, true);
  cleanup();
});

test('the profile whitelist drops unknown keys and caps sizes', () => {
  const p = cleanProfile({ people: 4, homeType: 'apartment', isAdmin: true, hash: 'x',
                           brands: ['Kiriazi', 'Fresh'], notes: 'x'.repeat(500) });
  assert.equal(p.people, 4);
  assert.equal(p.homeType, 'apartment');
  assert.equal(p.isAdmin, undefined, 'unknown key leaked into the stored profile');
  assert.equal(p.hash, undefined, 'a client could have overwritten the password hash');
  assert.deepEqual(p.brands, ['Kiriazi', 'Fresh']);
  assert.equal(p.notes.length, 200);
});

test('updateProfile cannot escalate or overwrite credentials', async () => {
  const { db, rows, cleanup } = await fresh();
  const r = await db.register(GOOD);
  await db.updateProfile(r.user.id, { name: 'نور ج', profile: { people: 5, hash: 'pwned', role: 'admin' } });
  const u = (await rows('SELECT * FROM users'))[0];
  assert.equal(u.name, 'نور ج');
  // profiles now live in their own table; the security properties are unchanged
  const home = JSON.parse((await rows('SELECT * FROM homes'))[0].data_json);
  assert.equal(home.people, 5);
  assert.equal(home.hash, undefined);
  assert.equal(u.role, undefined);
  assert.ok(u.hash.length === 128, 'password hash was modified by a profile update');
  cleanup();
});

test('orders are scoped to their owner', async () => {
  const { db, cleanup } = await fresh();
  const a = (await db.register(GOOD)).user;
  const b = (await db.register({ ...GOOD, email: 'b@example.com' })).user;
  const o = await db.createOrder(a.id, { items: [{ id: '1', title: 'ثلاجة', price: 100, qty: 2 }], payment: 'cod' });
  assert.equal(o.ok, true);
  assert.equal(o.order.subtotal, 200);
  assert.match(o.order.ref, /^SDK-[0-9A-F]{6}$/);
  assert.equal((await db.ordersFor(a.id)).length, 1);
  assert.equal((await db.ordersFor(b.id)).length, 0);
  assert.equal(await db.orderByRef(b.id, o.order.ref), null, 'another user could read this order');
  cleanup();
});

test('an order never claims a delivery/installation total it does not know', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register(GOOD)).user;
  const o = (await db.createOrder(u.id, { items: [{ id: '1', title: 'x', price: 100, qty: 1 }] })).order;
  assert.equal(o.totals.deliveryFee, null, 'unknown fees must stay null, not 0');
  assert.equal(o.totals.installFee, null);
  assert.equal(o.totals.grandTotal, null);
  cleanup();
});

test('order input is bounded and quantities are clamped', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register(GOOD)).user;
  assert.equal((await db.createOrder(u.id, { items: [] })).error, 'empty-cart');
  assert.equal((await db.createOrder(u.id, { items: new Array(61).fill({ id: '1', price: 1, qty: 1 }) })).error, 'too-many-items');
  const o = (await db.createOrder(u.id, { items: [{ id: '1', title: 'x', price: 10, qty: 999 }] })).order;
  assert.equal(o.items[0].qty, 20);
  cleanup();
});

test('no card fields survive into a stored order', async () => {
  const { db, bytes, cleanup } = await fresh();
  const u = (await db.register(GOOD)).user;
  await db.createOrder(u.id, { items: [{ id: '1', title: 'x', price: 1, qty: 1, cardNumber: '4111111111111111' }],
                         payment: 'cod', cardNumber: '4111111111111111', cvv: '123' });
  const raw = bytes();
  assert.ok(!raw.includes('4111111111111111'), 'card data reached storage');
  assert.ok(!raw.includes('cvv'));
  cleanup();
});

/* ===================== social sign-in ===================== */
const IDENT = { provider: 'google', sub: 'g-111', email: 'Social@Example.com', emailVerified: true, name: 'Social User' };

test('social sign-in creates a passwordless account the first time', async () => {
  const { db, cleanup } = await fresh();
  const r = await db.signInWithIdentity(IDENT);
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.user.email, 'social@example.com');
  assert.equal(r.user.hasPassword, false);
  assert.deepEqual(r.user.providers, ['google']);
  assert.ok(await db.userForToken(r.session.raw));
  cleanup();
});

test('signing in again with the same identity reuses the account', async () => {
  const { db, cleanup } = await fresh();
  const a = await db.signInWithIdentity(IDENT);
  const b = await db.signInWithIdentity(IDENT);
  assert.equal(b.created, false);
  assert.equal(a.user.id, b.user.id);
  cleanup();
});

test('CRITICAL: an unverified provider email cannot take over a password account', async () => {
  const { db, cleanup } = await fresh();
  await db.register({ ...GOOD, email: 'victim@example.com' });
  const r = await db.signInWithIdentity({ provider: 'google', sub: 'attacker', email: 'victim@example.com', emailVerified: false });
  assert.equal(r.ok, undefined);
  assert.equal(r.error, 'email-unverified');
  cleanup();
});

test('a VERIFIED provider email links to the existing password account', async () => {
  const { db, cleanup } = await fresh();
  const reg = await db.register({ ...GOOD, email: 'both@example.com' });
  const r = await db.signInWithIdentity({ provider: 'google', sub: 'g-both', email: 'both@example.com', emailVerified: true });
  assert.equal(r.ok, true);
  assert.equal(r.created, false);
  assert.equal(r.user.id, reg.user.id, 'should be the same account, not a duplicate');
  assert.equal(r.user.hasPassword, true, 'the password must still work after linking');
  assert.deepEqual(r.user.providers, ['google']);
  assert.equal((await db.login({ email: 'both@example.com', password: GOOD.password })).ok, true);
  cleanup();
});

test('CRITICAL: password login against a social-only account fails like any bad login', async () => {
  const { db, cleanup } = await fresh();
  await db.signInWithIdentity(IDENT);
  const r = await db.login({ email: 'social@example.com', password: 'anything123' });
  assert.equal(r.error, 'bad-credentials', 'must not reveal that the account is social-only');
  cleanup();
});

test('changing the password on a social-only account is refused, not crashed', async () => {
  const { db, cleanup } = await fresh();
  const r = await db.signInWithIdentity(IDENT);
  assert.equal((await db.changePassword(r.user.id, 'x', 'newpass123')).error, 'no-password');
  cleanup();
});

test('no provider token or raw identity secret is stored', async () => {
  const { db, bytes, cleanup } = await fresh();
  await db.signInWithIdentity(IDENT);
  assert.ok(!/eyJ/.test(bytes()), 'a JWT appears to have been stored');
  cleanup();
});

/* ===================== multiple home / room profiles ===================== */
test('a legacy single profile migrates into the first home', async () => {
  const { db, cleanup } = await fresh();
  const r = await db.register({ ...GOOD, profile: { people: 4, homeType: 'apartment' } });
  assert.equal(r.user.homes.length, 1);
  assert.equal(r.user.homes[0].people, 4);
  assert.equal(r.user.activeHomeId, r.user.homes[0].id);
  assert.equal(r.user.profile.people, 4, 'profile must alias the active home');
  cleanup();
});

test('a user can keep several homes and rooms, and switch between them', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register({ ...GOOD, profile: { name: 'شقة مدينة نصر', people: 4 } })).user;
  const chalet = await db.addHome(u.id, { name: 'شاليه الساحل', scope: 'home', coastal: true, people: 6 });
  const bedroom = await db.addHome(u.id, { name: 'أوضة النوم', scope: 'room', roomType: 'bedroom', roomAreaM2: 18 });
  assert.equal(chalet.ok, true);
  assert.equal(bedroom.home.scope, 'room');
  assert.equal((await db.listHomes(u.id)).length, 3);

  const sw = await db.setActiveHome(u.id, bedroom.home.id);
  assert.equal(sw.user.activeHomeId, bedroom.home.id);
  assert.equal(sw.user.profile.roomAreaM2, 18, 'the active room drives the filter');
  cleanup();
});

test('homes are capped and scoped to their owner', async () => {
  const { db, cleanup } = await fresh();
  const a = (await db.register(GOOD)).user;
  const b = (await db.register({ ...GOOD, email: 'b2@example.com' })).user;
  for (let i = 0; i < 10; i++) await db.addHome(a.id, { name: 'h' + i });
  assert.ok((await db.listHomes(a.id)).length <= 8);
  assert.equal((await db.addHome(a.id, { name: 'over' })).error, 'too-many-homes');
  assert.equal((await db.listHomes(b.id)).length, 0, 'another user must not see these homes');
  const hid = (await db.listHomes(a.id))[0].id;
  assert.equal((await db.updateHome(b.id, hid, { people: 9 })).error, 'no-home', 'cross-user edit must be refused');
  assert.equal((await db.setActiveHome(b.id, hid)).error, 'no-home');
  cleanup();
});

test('a home update cannot rewrite its id or inject unknown keys', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register(GOOD)).user;
  const h = (await db.addHome(u.id, { name: 'الشقة' })).home;
  const r = await db.updateHome(u.id, h.id, { id: 'hacked', name: 'الشقة الجديدة', isAdmin: true, hash: 'x', people: 3 });
  assert.equal(r.home.id, h.id);
  assert.equal(r.home.name, 'الشقة الجديدة');
  assert.equal(r.home.people, 3);
  assert.equal(r.home.isAdmin, undefined);
  assert.equal(r.home.hash, undefined);
  cleanup();
});

test('deleting the active home promotes another one', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register({ ...GOOD, profile: { name: 'أولى' } })).user;
  const second = (await db.addHome(u.id, { name: 'تانية' })).home;
  await db.setActiveHome(u.id, second.id);
  const r = await db.removeHome(u.id, second.id);
  assert.equal(r.user.homes.length, 1);
  assert.equal(r.user.activeHomeId, r.user.homes[0].id);
  cleanup();
});

test('updateProfile still edits the active home (old call sites keep working)', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register(GOOD)).user;                    // no profile at signup
  const r = await db.updateProfile(u.id, { profile: { people: 5, budgetBand: 'mid' } });
  assert.equal(r.user.homes.length, 1, 'a first home is created on demand');
  assert.equal(r.user.profile.people, 5);
  assert.equal(r.user.profile.budgetBand, 'mid');
  cleanup();
});

/* ===================== SQLite storage behaviours ===================== */
import { writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

test('an existing accounts.json is imported once, then set aside', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-mig-'));
  const json = path.join(dir, 'accounts.json');
  // a legacy file, in the pre-SQLite shape (single `profile`, no `homes`)
  writeFileSync(json, JSON.stringify({
    users: [{ id: 'u1', email: 'old@example.com', name: 'قديم', phone: '0100', address: 'somewhere',
              salt: 'aa', hash: 'bb', profile: { people: 3, homeType: 'villa' }, createdAt: '2026-01-01T00:00:00Z' }],
    orders: [{ ref: 'SDK-OLD001', userId: 'u1', createdAt: '2026-01-02T00:00:00Z', status: 'received',
               items: [{ id: '1', title: 'x', price: 10, qty: 1 }], subtotal: 10, payment: 'cod' }],
    sessions: [], fails: [],
  }), 'utf8');

  const db = await openAccounts(json);
  const u = await db.userForToken('nope');            // just to touch the store
  assert.equal((await db.stats()).users, 1, 'the legacy user was not imported');
  assert.equal((await db.stats()).orders, 1, 'the legacy order was not imported');
  const list = await db.listHomes('u1');
  assert.equal(list.length, 1, 'the single legacy profile should become one home');
  assert.equal(list[0].people, 3);
  assert.ok(existsSync(json + '.migrated'), 'the original file should be kept, renamed');
  assert.ok(!existsSync(json), 'the original file should no longer be read on next boot');
  assert.equal((await db.ordersFor('u1')).length, 1);

  db.close();
  // reopening must NOT double-import or fail
  const db2 = await openAccounts(json);
  assert.equal((await db2.stats()).users, 1);
  db2.close();
  rmTemp(dir);
});

test('deleting an account removes everything attached to it', async () => {
  const { db, rows, cleanup } = await fresh();
  const r = await db.register({ ...GOOD, profile: { people: 4 } });
  const uid = r.user.id;
  await db.addHome(uid, { name: 'تانى' });
  await db.createOrder(uid, { items: [{ id: '1', title: 'x', price: 5, qty: 1 }] });
  await db.signInWithIdentity({ provider: 'google', sub: 'g-del', email: GOOD.email.toLowerCase(), emailVerified: true });

  assert.ok((await rows('SELECT * FROM homes')).length >= 2);
  assert.ok((await rows('SELECT * FROM orders')).length === 1);
  assert.ok((await rows('SELECT * FROM sessions')).length >= 1);
  assert.ok((await rows('SELECT * FROM identities')).length === 1);

  assert.equal((await db.deleteUser(uid)).ok, true);
  assert.equal((await rows('SELECT * FROM users')).length, 0);
  assert.equal((await rows('SELECT * FROM homes')).length, 0, 'homes should cascade');
  assert.equal((await rows('SELECT * FROM orders')).length, 0, 'orders should cascade');
  assert.equal((await rows('SELECT * FROM sessions')).length, 0, 'sessions should cascade');
  assert.equal((await rows('SELECT * FROM identities')).length, 0, 'identities should cascade');
  assert.equal(await db.userForToken(r.session.raw), null, 'the old session must stop working');
  cleanup();
});

test('deleting an account removes its rows even without ON DELETE CASCADE (hosted Turso)', async () => {
  /* A hosted Turso connection does not keep PRAGMA foreign_keys, so the
     cascade in the schema never fires there. Switch it off here to get the
     same conditions: everything must still go, and only this user's rows. */
  const { db, rows, cleanup } = await fresh();
  await db.__raw().client.execute('PRAGMA foreign_keys = OFF');
  assert.equal((await db.__raw().prepare('PRAGMA foreign_keys').get()).foreign_keys, 0);

  const r = await db.register({ ...GOOD, profile: { people: 4 } });
  const uid = r.user.id;
  await db.addHome(uid, { name: 'تانى' });
  await db.createOrder(uid, { items: [{ id: '1', title: 'x', price: 5, qty: 1 }] });
  await db.signInWithIdentity({ provider: 'google', sub: 'g-del2', email: GOOD.email.toLowerCase(), emailVerified: true });

  const keep = await db.register({ ...GOOD, email: 'keep@example.com', profile: { people: 2 } });
  await db.createOrder(keep.user.id, { items: [{ id: '2', title: 'y', price: 7, qty: 1 }] });
  await db.signInWithIdentity({ provider: 'google', sub: 'g-keep', email: 'keep@example.com', emailVerified: true });

  assert.equal((await db.deleteUser(uid)).ok, true);
  for (const t of ['homes', 'sessions', 'orders', 'identities']) {
    const left = await db.__raw().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(uid);
    assert.equal(left.n, 0, `${t} rows of the deleted user survived`);
  }
  assert.equal((await rows('SELECT * FROM users')).length, 1);
  assert.equal(await db.userForToken(r.session.raw), null, 'the old session must stop working');
  // the other customer is untouched
  assert.ok(await db.userForToken(keep.session.raw));
  assert.equal((await db.ordersFor(keep.user.id)).length, 1);
  assert.equal((await db.listHomes(keep.user.id)).length, 1);
  assert.deepEqual((await db.getUser(keep.user.id)).identities.map(i => i.sub), ['g-keep']);
  assert.equal((await db.deleteUser(uid)).error, 'no-user');
  cleanup();
});

test('sweep() removes expired sessions and stale login failures, and nothing live', async () => {
  const { db, rows, cleanup } = await fresh();
  const live = await db.register(GOOD);
  const old = await db.login({ email: GOOD.email, password: GOOD.password });
  await db.__raw().prepare('UPDATE sessions SET expires = ? WHERE token_hash <> (SELECT token_hash FROM sessions ORDER BY created LIMIT 1)')
    .run('2020-01-01T00:00:00.000Z');
  await db.login({ email: GOOD.email, password: 'nope12345', ip: '1.1.1.1' });       // a fresh failure
  await db.__raw().prepare('INSERT INTO login_fails (key, at) VALUES (?, ?)').run('stale|ip', Date.now() - 60 * 60 * 1000);

  const r = await db.sweep();
  assert.equal(r.sessions, 1, 'exactly the expired session should go');
  assert.equal(r.fails, 1, 'exactly the stale failure should go');
  assert.equal((await rows('SELECT * FROM sessions')).length, 1);
  assert.ok(await db.userForToken(live.session.raw) || await db.userForToken(old.session.raw), 'the live session must survive');
  assert.deepEqual((await rows('SELECT key FROM login_fails')).map(x => x.key), ['nour@example.com|1.1.1.1']);
  assert.equal(typeof db.sweep, 'function');
  cleanup();
});

test('a parallel burst of bad logins cannot try more than the limit', async () => {
  /* With an async store, "check then record" would let every request in a
     burst pass the check before any failure was written. */
  const { db, cleanup } = await fresh();
  await db.register(GOOD);
  const bad = () => db.login({ email: GOOD.email, password: 'nope12345', ip: '7.7.7.7' });
  let tried = 0;
  for (let round = 0; round < 3; round++) {
    const res = await Promise.all(Array.from({ length: 20 }, bad));
    assert.ok(res.every(x => x.error === 'bad-credentials' || x.error === 'too-many'));
    tried += res.filter(x => x.error === 'bad-credentials').length;
  }
  // then keep going one at a time until the limit bites
  let last;
  for (let i = 0; i < 12 && (last = await bad()).error !== 'too-many'; i++) tried++;
  assert.equal(last.error, 'too-many', 'the limit must engage');
  assert.ok(tried <= 8, `${tried} passwords were tried in one window`);
  assert.equal((await db.login({ email: GOOD.email, password: GOOD.password, ip: '7.7.7.7' })).error, 'too-many',
    'once the limit is reached even the right password waits out the window');
  cleanup();
});

test('the legacy JSON import is skipped entirely on a hosted store', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-mig-h-'));
  const json = path.join(dir, 'accounts.json');
  writeFileSync(json, JSON.stringify({ users: [{ id: 'u1', email: 'old@example.com', name: 'x', salt: 'aa', hash: 'bb', createdAt: '2026-01-01T00:00:00Z' }] }), 'utf8');
  delete process.env.TURSO_DATABASE_URL;
  const store = await openAccountsDb(path.join(dir, 'accounts.db'));
  process.env.TURSO_DATABASE_URL = 'libsql://example.invalid';
  try {
    const r = await importLegacyJson(store, json);
    assert.equal(r.imported, 0);
    assert.equal(r.skipped, 'hosted');
  } finally { delete process.env.TURSO_DATABASE_URL; }
  assert.equal(await store.userCount(), 0);
  assert.ok(existsSync(json), 'the file must not be touched when the store is hosted');
  store.close();
  rmTemp(dir);
});

test('a data export contains the customer record but never the password', async () => {
  const { db, cleanup } = await fresh();
  const u = (await db.register({ ...GOOD, profile: { name: 'الشقة', people: 4 } })).user;
  await db.createOrder(u.id, { items: [{ id: '1', title: 'ثلاجة', price: 100, qty: 1 }] });
  const x = await db.exportUser(u.id);
  assert.equal(x.account.email, 'nour@example.com');
  assert.equal(x.places.length, 1);
  assert.equal(x.orders.length, 1);
  const blob = JSON.stringify(x);
  assert.ok(!blob.includes('sadko1234'), 'the export leaked the password');
  assert.ok(!/"hash"/.test(blob) && !/"salt"/.test(blob), 'the export leaked credential material');
  assert.equal(await db.exportUser('nobody'), null);
  cleanup();
});

test('expired sessions stop working and get swept', async () => {
  const { db, rows, cleanup } = await fresh();
  const r = await db.register(GOOD);
  // age this session past its expiry directly in the table
  await db.__raw().prepare("UPDATE sessions SET expires = ?").run('2020-01-01T00:00:00.000Z');
  assert.equal(await db.userForToken(r.session.raw), null, 'an expired session must not authenticate');
  assert.equal((await rows('SELECT * FROM sessions')).length, 0, 'it should also be removed on use');
  cleanup();
});

test('many writes in a row all land (no lost updates)', async () => {
  const { db, rows, cleanup } = await fresh();
  const u = (await db.register(GOOD)).user;
  for (let i = 0; i < 40; i++) await db.createOrder(u.id, { items: [{ id: String(i), title: 'x', price: 1, qty: 1 }] });
  assert.equal((await rows('SELECT * FROM orders')).length, 40);
  assert.equal((await db.ordersFor(u.id)).length, 40);
  cleanup();
});

/* ======================================================================
   getUser — the accessor the order push needed and did not have.

   Found from a real parked order, not from reading code: two orders sat in
   the push queue with last_error "db.getUser is not a function". Every push
   had been failing on a TypeError, which means the 403 was hiding a second,
   independent fault — order push would NOT have started working the moment
   a secret token arrived.
   ================================================================== */

test('getUser returns the account the order push needs', async () => {
  const { db, cleanup } = await fresh();
  try {
    const r = await db.register(GOOD);
    const u = await db.getUser(r.user.id);
    assert.ok(u, 'getUser must exist and find the user');
    assert.equal(u.email, 'nour@example.com');
    assert.equal(u.name, 'نور');
    assert.equal(u.phone, '01012345678');
  } finally { cleanup(); }
});

test('getUser NEVER returns the password hash or its salt', async () => {
  /* The row underneath carries both. This accessor exists to hand an account
     to the Ecwid mapper, and a credential has no business travelling there —
     or anywhere else it is not needed. */
  const { db, cleanup } = await fresh();
  try {
    const r = await db.register(GOOD);
    const u = await db.getUser(r.user.id);
    assert.equal(u.hash, undefined, 'the password hash must not leave the accounts layer');
    assert.equal(u.salt, undefined, 'the salt must not either');
    assert.ok(!JSON.stringify(u).includes('hash'));
  } finally { cleanup(); }
});

test('getUser on an unknown id is null, not a throw', async () => {
  const { db, cleanup } = await fresh();
  try {
    assert.equal(await db.getUser('nope'), null);
    assert.equal(await db.getUser(null), null);
  } finally { cleanup(); }
});

test('getUserByEmail finds an account and strips the credential too', async () => {
  /* The customer link queue holds only an email — the name and phone are
     read back through this at attempt time, which is what keeps the queue
     from becoming a second copy of the customer. */
  const { db, cleanup } = await fresh();
  try {
    await db.register(GOOD);
    const u = await db.getUserByEmail('NOUR@example.COM');
    assert.ok(u, 'the lookup must be case-insensitive, as Ecwid files emails');
    assert.equal(u.name, 'نور');
    assert.equal(u.hash, undefined);
    assert.equal(u.salt, undefined);
    assert.equal(await db.getUserByEmail('nobody@example.com'), null);
    assert.equal(await db.getUserByEmail(''), null);
  } finally { cleanup(); }
});
