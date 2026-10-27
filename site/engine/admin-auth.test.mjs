// site/engine/admin-auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { base32Encode, base32Decode, totpAt, passwordProblem, tempPassword, openAdminAuth } from './admin-auth.mjs';

/* ---- TOTP, against the RFC 6238 reference vectors (SHA-1, 8 digits there; we use the last 6) ---- */
const RFC_SECRET = Buffer.from('12345678901234567890');
test('TOTP matches the RFC 6238 SHA-1 vectors', () => {
  const at = s => totpAt(RFC_SECRET, Math.floor(s / 30));
  assert.equal(at(59), '287082');           // 94287082
  assert.equal(at(1111111109), '081804');   // 07081804
  assert.equal(at(1234567890), '005924');   // 89005924
  assert.equal(at(2000000000), '279037');   // 69279037
});

test('base32 round-trips and matches the authenticator alphabet', () => {
  assert.equal(base32Encode(Buffer.from('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), Buffer.from('12345678901234567890'));
  assert.deepEqual(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), Buffer.from('12345678901234567890'));
});

test('password rules: long, not the email, not a common one', () => {
  assert.equal(passwordProblem('short1!', 'a@b.c'), 'too-short');
  assert.equal(passwordProblem('peter.w.gamil2026', 'peter.w.gamil@gmail.com'), 'contains-email');
  assert.equal(passwordProblem('password1234', 'x@y.z'), 'too-common');
  assert.equal(passwordProblem('aaaaaaaaaaaaaa', 'x@y.z'), 'too-simple');
  assert.equal(passwordProblem('Nile-Breeze-4471', 'x@y.z'), null);
});

test('temporary passwords are 16 unambiguous characters and never repeat', () => {
  const a = tempPassword(), b = tempPassword();
  assert.match(a, /^[A-HJ-NP-Za-km-z2-9]{16}$/);
  assert.notEqual(a, b);
});

/* ---- the store ---- */
async function fresh(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adm-'));
  let clock = Date.parse('2026-10-27T10:00:00Z');
  const auth = await openAdminAuth(path.join(dir, 'admin.db'), { secret: 'test-secret-value-long-enough', now: () => clock, ...opts });
  return { auth, tick: ms => { clock += ms; }, now: () => clock };
}
const codeFor = (secret, now) => totpAt(base32Decode(secret), Math.floor(now / 30000));

async function enrolled() {
  const f = await fresh();
  const { tempPassword: tmp } = await f.auth.invite('Peter.W.Gamil@gmail.com', 'cli');
  let s = await f.auth.login('peter.w.gamil@gmail.com', tmp);
  s = await f.auth.resetPassword(s.token, 'Nile-Breeze-4471');
  const e = await f.auth.startEnroll(s.token);
  s = await f.auth.confirmEnroll(s.token, codeFor(e.secret, f.now()));
  return { ...f, secret: e.secret, token: s.token };
}

test('first sign-in: temporary password → new password → authenticator → full session', async () => {
  const { auth, now } = await fresh();
  const inv = await auth.invite('peter.w.gamil@gmail.com', 'cli');
  assert.equal(inv.email, 'peter.w.gamil@gmail.com');

  const s1 = await auth.login('PETER.W.GAMIL@gmail.com ', inv.tempPassword);
  assert.equal(s1.stage, 'reset');
  assert.equal((await auth.session(s1.token)).stage, 'reset');

  assert.equal((await auth.resetPassword(s1.token, 'short')).error, 'weak-password');
  assert.equal((await auth.resetPassword(s1.token, inv.tempPassword)).error, 'weak-password', 'cannot keep the temporary one');
  const s2 = await auth.resetPassword(s1.token, 'Nile-Breeze-4471');
  assert.equal(s2.stage, 'enroll');
  assert.notEqual(s2.token, s1.token, 'the token rotates on every stage change');
  assert.equal(await auth.session(s1.token), null);

  const e = await auth.startEnroll(s2.token);
  assert.match(e.otpauth, /^otpauth:\/\/totp\/SADKO%20Admin:peter\.w\.gamil%40gmail\.com\?secret=[A-Z2-7]+&issuer=SADKO%20Admin/);
  assert.equal((await auth.confirmEnroll(s2.token, '000000')).error, 'bad-code');
  const s3 = await auth.confirmEnroll(s2.token, codeFor(e.secret, now()));
  assert.equal(s3.stage, 'full');
  assert.equal((await auth.session(s3.token)).email, 'peter.w.gamil@gmail.com');

  /* the temporary password is dead now */
  assert.equal((await auth.login('peter.w.gamil@gmail.com', inv.tempPassword)).error, 'bad-credentials');
});

test('a setup stage cannot skip ahead', async () => {
  const { auth } = await fresh();
  const inv = await auth.invite('a@sadko.test', 'cli');
  const s = await auth.login('a@sadko.test', inv.tempPassword);
  assert.equal((await auth.startEnroll(s.token)).error, 'wrong-stage');
  assert.equal((await auth.verifyTotp(s.token, '123456')).error, 'wrong-stage');
});

test('returning admin: password, then a code; the same code never works twice', async () => {
  const { auth, secret, now, tick } = await enrolled();
  tick(31_000);
  const s = await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471');
  assert.equal(s.stage, 'totp');
  const code = codeFor(secret, now());
  const ok = await auth.verifyTotp(s.token, code);
  assert.equal(ok.stage, 'full');
  const again = await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471');
  assert.equal((await auth.verifyTotp(again.token, code)).error, 'bad-code', 'replay refused');
});

test('five failures lock the account for 15 minutes, for the right password too', async () => {
  const { auth, tick } = await enrolled();
  for (let i = 0; i < 5; i++) assert.equal((await auth.login('peter.w.gamil@gmail.com', 'wrong-one-123')).error, 'bad-credentials');
  assert.equal((await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471')).error, 'locked');
  tick(15 * 60_000 + 1);
  assert.equal((await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471')).stage, 'totp');
});

test('wrong codes count towards the lock as well', async () => {
  const { auth } = await enrolled();
  const s = await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471');
  for (let i = 0; i < 5; i++) await auth.verifyTotp(s.token, '000000');
  assert.equal((await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471')).error, 'locked');
});

test('an unknown email answers exactly like a wrong password', async () => {
  const { auth } = await fresh();
  assert.equal((await auth.login('nobody@x.y', 'whatever-123456')).error, 'bad-credentials');
});

test('a temporary password expires after 48 hours', async () => {
  const { auth, tick } = await fresh();
  const inv = await auth.invite('a@sadko.test', 'cli');
  tick(48 * 3600_000 + 1);
  assert.equal((await auth.login('a@sadko.test', inv.tempPassword)).error, 'expired');
});

test('sessions expire: setup stages after 15 minutes, full after 8 hours', async () => {
  const { auth, token, tick } = await enrolled();
  tick(8 * 3600_000 - 1000);
  assert.ok(await auth.session(token));
  tick(2000);
  assert.equal(await auth.session(token), null);
  const f = await fresh();
  const inv = await f.auth.invite('b@sadko.test', 'cli');
  const s = await f.auth.login('b@sadko.test', inv.tempPassword);
  f.tick(15 * 60_000 + 1);
  assert.equal(await f.auth.session(s.token), null);
});

test('re-inviting resets everything: new temporary password, authenticator cleared, sessions ended', async () => {
  const { auth, token } = await enrolled();
  const inv = await auth.invite('peter.w.gamil@gmail.com', 'admin@x');
  assert.equal(await auth.session(token), null);
  assert.equal((await auth.login('peter.w.gamil@gmail.com', 'Nile-Breeze-4471')).error, 'bad-credentials');
  assert.equal((await auth.login('peter.w.gamil@gmail.com', inv.tempPassword)).stage, 'reset');
});

test('the authenticator secret is not stored in readable form', async () => {
  const { auth, secret } = await enrolled();
  const raw = await auth._rawRow('peter.w.gamil@gmail.com');
  assert.ok(!JSON.stringify(raw).includes(secret));
  assert.ok(!JSON.stringify(raw).includes('Nile-Breeze-4471'));
});

test('the list never carries secrets; removing an admin ends their sessions', async () => {
  const { auth, token } = await enrolled();
  const list = await auth.list();
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['createdAt', 'createdBy', 'email', 'lastLoginAt', 'locked', 'setupDone'].sort());
  await auth.remove('peter.w.gamil@gmail.com');
  assert.equal(await auth.session(token), null);
  assert.equal((await auth.list()).length, 0);
});

test('without a long enough secret the store refuses to open', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adm-'));
  await assert.rejects(openAdminAuth(path.join(dir, 'a.db'), { secret: 'short' }), /SADKO_ADMIN_SECRET/);
});
