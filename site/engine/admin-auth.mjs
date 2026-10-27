/* ============================================================================
   Admin sign-in: its own accounts, a forced first reset, and an authenticator.

   Deliberately separate from customer accounts (engine/accounts.mjs). Being an
   admin used to mean "a customer account whose email is listed in
   ADMIN_EMAILS", so a stolen customer password was a stolen admin, with no
   second step. Here:

     · the owner invites an email; the server makes a 16-character temporary
       password, shown once, valid 48 hours;
     · the first sign-in with it can do one thing: set a real password;
     · the next step can do one thing: enrol an authenticator app (TOTP);
     · only then is there a full session. Every later sign-in is password,
       then a 6-digit code.

   Every stage change ROTATES the session token, so a token seen during setup
   is worthless afterwards. Five failures, of either the password or the code,
   lock the account for 15 minutes.

   The authenticator secret is encrypted at rest (AES-256-GCM) under a key
   derived from SADKO_ADMIN_SECRET, so a copy of the database alone cannot mint
   codes. The same environment secret authorises the invite CLI.

   `now` is injectable so expiry and lockout are testable without waiting.
   ========================================================================== */

import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac,
         createCipheriv, createDecipheriv } from 'node:crypto';
import { openDb, storeSpec } from './db.mjs';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const TEMP_TTL_MS = 48 * 3600_000;
const SETUP_TTL_MS = 15 * 60_000;
const FULL_TTL_MS = 8 * 3600_000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
export const ISSUER = 'SADKO Admin';

const MIGRATIONS = [{
  id: 1, name: 'admin auth',
  sql: `
  CREATE TABLE IF NOT EXISTS admin_users (
    email TEXT PRIMARY KEY,
    salt TEXT NOT NULL, hash TEXT NOT NULL,
    must_reset INTEGER NOT NULL DEFAULT 1,
    temp_expires INTEGER,
    totp_secret TEXT, totp_pending TEXT, totp_on INTEGER NOT NULL DEFAULT 0,
    last_totp_step INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, created_by TEXT, last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    digest TEXT PRIMARY KEY, email TEXT NOT NULL, stage TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_sessions_email ON admin_sessions(email);
  `,
}];

/* ---- base32 (RFC 4648), the alphabet every authenticator app reads ---- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/* ---- TOTP (RFC 6238 over RFC 4226), SHA-1, 6 digits ---- */
export function totpAt(key, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/* The matching step within ±1 (clock drift), or null. */
function matchStep(key, code, nowMs) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(nowMs / 30000);
  for (const s of [cur, cur - 1, cur + 1]) {
    const want = Buffer.from(totpAt(key, s));
    if (timingSafeEqual(want, Buffer.from(c))) return s;
  }
  return null;
}

/* ---- passwords ---- */
const COMMON = ['password', 'passw0rd', '123456', '12345678', 'qwerty', 'admin', 'letmein', 'welcome',
                'sadko', 'iloveyou', 'abc123', 'football', 'monkey', 'dragon', 'egypt', 'cairo'];
export function passwordProblem(pw, email) {
  const p = String(pw || '');
  if (p.length < 12) return 'too-short';
  if (p.length > 200) return 'too-long';
  const lower = p.toLowerCase();
  const name = String(email || '').toLowerCase().split('@')[0];
  if (name.length >= 4 && lower.includes(name)) return 'contains-email';
  if (COMMON.some(w => lower.replace(/[^a-z0-9]/g, '').startsWith(w))) return 'too-common';
  if (new Set(p).size < 5) return 'too-simple';
  return null;
}
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function tempPassword() {
  const bytes = randomBytes(32); let out = '';
  for (const b of bytes) {
    if (b >= 228) continue;                       // 228 = 57*4: keeps the pick unbiased
    out += TEMP_ALPHABET[b % TEMP_ALPHABET.length];
    if (out.length === 16) return out;
  }
  return out + tempPassword().slice(out.length); // vanishingly rare top-up
}
const hashPw = (pw, salt) => scryptSync(String(pw), salt, SCRYPT.keylen, SCRYPT).toString('hex');
function pwMatches(pw, salt, hash) {
  const a = Buffer.from(hashPw(pw, salt), 'hex'), b = Buffer.from(String(hash), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const digest = token => createHash('sha256').update(String(token)).digest('hex');
const normEmail = e => String(e || '').trim().toLowerCase();

export async function openAdminAuth(file, { secret = process.env.SADKO_ADMIN_SECRET, now = Date.now } = {}) {
  if (!secret || String(secret).length < 24)
    throw new Error('SADKO_ADMIN_SECRET is missing or shorter than 24 characters');
  const encKey = createHash('sha256').update('sadko-admin-totp|' + secret).digest();
  const seal = plain => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', encKey, iv);
    const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join('.');
  };
  const open = sealed => {
    const [iv, tag, body] = String(sealed).split('.').map(s => Buffer.from(s, 'base64'));
    const d = createDecipheriv('aes-256-gcm', encKey, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  };

  const { spec, authToken } = storeSpec(file);
  const db = await openDb(spec, { authToken });
  await db.migrate('admin_auth', MIGRATIONS);

  const q = {
    get: db.prepare('SELECT * FROM admin_users WHERE email = ?'),
    all: db.prepare('SELECT * FROM admin_users ORDER BY created_at'),
    upsert: db.prepare(`INSERT INTO admin_users (email,salt,hash,must_reset,temp_expires,totp_secret,totp_pending,totp_on,last_totp_step,failed,locked_until,created_at,created_by)
      VALUES (?,?,?,1,?,NULL,NULL,0,0,0,0,?,?)
      ON CONFLICT(email) DO UPDATE SET salt=excluded.salt, hash=excluded.hash, must_reset=1, temp_expires=excluded.temp_expires,
        totp_secret=NULL, totp_pending=NULL, totp_on=0, last_totp_step=0, failed=0, locked_until=0`),
    del: db.prepare('DELETE FROM admin_users WHERE email = ?'),
    fail: db.prepare('UPDATE admin_users SET failed = ?, locked_until = ? WHERE email = ?'),
    okLogin: db.prepare('UPDATE admin_users SET failed = 0, locked_until = 0 WHERE email = ?'),
    setPw: db.prepare('UPDATE admin_users SET salt = ?, hash = ?, must_reset = 0, temp_expires = NULL WHERE email = ?'),
    setPending: db.prepare('UPDATE admin_users SET totp_pending = ? WHERE email = ?'),
    enable: db.prepare('UPDATE admin_users SET totp_secret = totp_pending, totp_pending = NULL, totp_on = 1, last_totp_step = ? WHERE email = ?'),
    step: db.prepare('UPDATE admin_users SET last_totp_step = ?, failed = 0, locked_until = 0, last_login_at = ? WHERE email = ?'),
    sGet: db.prepare('SELECT * FROM admin_sessions WHERE digest = ?'),
    sPut: db.prepare('INSERT INTO admin_sessions (digest,email,stage,expires_at) VALUES (?,?,?,?)'),
    sDel: db.prepare('DELETE FROM admin_sessions WHERE digest = ?'),
    sDelUser: db.prepare('DELETE FROM admin_sessions WHERE email = ?'),
    sGc: db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?'),
  };

  async function newSession(email, stage) {
    const token = randomBytes(32).toString('hex');
    const ttl = stage === 'full' ? FULL_TTL_MS : SETUP_TTL_MS;
    await q.sPut.run(digest(token), email, stage, now() + ttl);
    return { token, stage, email };
  }
  async function liveSession(token) {
    if (!token) return null;
    const row = await q.sGet.get(digest(token));
    if (!row) return null;
    if (row.expires_at <= now()) { await q.sDel.run(row.digest); return null; }
    return row;
  }
  /* Swap the session for one at the next stage (the old token stops working). */
  async function advance(row, stage) {
    await q.sDel.run(row.digest);
    return newSession(row.email, stage);
  }
  async function countFailure(user) {
    const failed = (user.failed || 0) + 1;
    const lock = failed >= MAX_FAILS ? now() + LOCK_MS : 0;
    await q.fail.run(lock ? 0 : failed, lock, user.email);
  }

  return {
    async invite(rawEmail, by) {
      const email = normEmail(rawEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'bad-email' };
      const pw = tempPassword();
      const salt = randomBytes(16).toString('hex');
      await q.upsert.run(email, salt, hashPw(pw, salt), now() + TEMP_TTL_MS, new Date(now()).toISOString(), by || null);
      await q.sDelUser.run(email);
      return { email, tempPassword: pw, expiresAt: new Date(now() + TEMP_TTL_MS).toISOString() };
    },

    async login(rawEmail, password) {
      const email = normEmail(rawEmail);
      const user = await q.get.get(email);
      if (!user) { hashPw(password, 'x'.repeat(32)); return { error: 'bad-credentials' }; }   // same cost either way
      if (user.locked_until > now()) return { error: 'locked', until: new Date(user.locked_until).toISOString() };
      if (!pwMatches(password, user.salt, user.hash)) { await countFailure(user); return { error: 'bad-credentials' }; }
      if (user.must_reset && user.temp_expires && user.temp_expires < now()) return { error: 'expired' };
      await q.okLogin.run(email);
      await q.sGc.run(now());
      if (user.must_reset) return newSession(email, 'reset');
      if (!user.totp_on) return newSession(email, 'enroll');
      return newSession(email, 'totp');
    },

    async session(token) {
      const row = await liveSession(token);
      return row ? { email: row.email, stage: row.stage } : null;
    },

    async resetPassword(token, password) {
      const row = await liveSession(token);
      if (!row) return { error: 'no-session' };
      if (row.stage !== 'reset') return { error: 'wrong-stage' };
      const user = await q.get.get(row.email);
      const problem = passwordProblem(password, row.email) || (pwMatches(password, user.salt, user.hash) ? 'same-as-temporary' : null);
      if (problem) return { error: 'weak-password', reason: problem };
      const salt = randomBytes(16).toString('hex');
      await q.setPw.run(salt, hashPw(password, salt), row.email);
      return advance(row, user.totp_on ? 'totp' : 'enroll');
    },

    async startEnroll(token) {
      const row = await liveSession(token);
      if (!row) return { error: 'no-session' };
      if (row.stage !== 'enroll') return { error: 'wrong-stage' };
      const secret = base32Encode(randomBytes(20));
      await q.setPending.run(seal(secret), row.email);
      const label = encodeURIComponent(ISSUER) + ':' + encodeURIComponent(row.email);
      return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30` };
    },

    async confirmEnroll(token, code) {
      const row = await liveSession(token);
      if (!row) return { error: 'no-session' };
      if (row.stage !== 'enroll') return { error: 'wrong-stage' };
      const user = await q.get.get(row.email);
      if (!user.totp_pending) return { error: 'no-pending' };
      const step = matchStep(base32Decode(open(user.totp_pending)), code, now());
      if (step == null) return { error: 'bad-code' };
      await q.enable.run(step, row.email);
      await q.step.run(step, new Date(now()).toISOString(), row.email);
      return advance(row, 'full');
    },

    async verifyTotp(token, code) {
      const row = await liveSession(token);
      if (!row) return { error: 'no-session' };
      if (row.stage !== 'totp') return { error: 'wrong-stage' };
      const user = await q.get.get(row.email);
      if (!user) return { error: 'no-session' };
      if (user.locked_until > now()) return { error: 'locked' };
      const step = matchStep(base32Decode(open(user.totp_secret)), code, now());
      if (step == null || step <= user.last_totp_step) { await countFailure(user); return { error: 'bad-code' }; }
      await q.step.run(step, new Date(now()).toISOString(), row.email);
      return advance(row, 'full');
    },

    async logout(token) { if (token) await q.sDel.run(digest(token)); },

    async list() {
      return (await q.all.all()).map(u => ({
        email: u.email, createdAt: u.created_at, createdBy: u.created_by || null,
        lastLoginAt: u.last_login_at || null, setupDone: !u.must_reset && !!u.totp_on,
        locked: u.locked_until > now(),
      }));
    },
    async remove(rawEmail) {
      const email = normEmail(rawEmail);
      await db.batch([q.del.bind(email), q.sDelUser.bind(email)]);
    },
    count: async () => (await q.all.all()).length,
    _rawRow: email => q.get.get(normEmail(email)),
  };
}
